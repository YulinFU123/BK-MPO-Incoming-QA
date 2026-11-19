'use strict';
const { PlatformError } = require('../domain/errors');
const { dateRange } = require('../domain/validation');
const { assertJSONData } = require('../ports/dto');
const LABELS = {
  process: '工序',
  model: '型号',
  materialLot: '物料批次',
  operator: '人员',
  area: '区域',
  group: '分组',
  relatedCode: '关联编号',
};
const MEASURES = {
  inspectedUnits: '检验件数',
  defectiveUnits: '不良件数',
  productionUnits: '产量',
  defectEvents: '缺陷次数',
};
const own = (object, key) => Object.hasOwn(object || {}, key);

function createQueryService({ repository }) {
  return Object.freeze({
    async catalog() {
      const state = await repository.snapshot();
      const dates = [
        ...state.facts.map((item) => item.businessDate),
        ...state.observations.map((item) => item.observedOn),
      ].sort();
      const dimensionOptions = {};
      for (const dataset of state.datasets) {
        dimensionOptions[dataset.id] = {};
        for (const field of dataset.grainFields) {
          dimensionOptions[dataset.id][field] = [
            ...new Set(
              state.facts
                .filter((item) => item.datasetId === dataset.id)
                .map((item) => item.dimensions[field]),
            ),
          ]
            .sort()
            .slice(0, 1000);
        }
      }
      return {
        datasets: state.datasets,
        batches: state.batches.slice().sort((a, b) => b.committedAt - a.committedAt),
        dateRange: dates.length ? { start: dates[0], end: dates.at(-1) } : null,
        dimensionOptions,
        legacyQuality: state.legacyQuality || null,
      };
    },
    async listData(input) {
      assertJSONData(input);
      const {
        datasetId,
        source = 'quality',
        start,
        end,
        filters = {},
        search = '',
        sort = {},
        page = 1,
        pageSize = 50,
        rowIds = [],
      } = input;
      dateRange(start, end);
      if (
        !['quality', 'observations'].includes(source) ||
        !Number.isSafeInteger(page) ||
        page < 1 ||
        page > 100000 ||
        !Number.isSafeInteger(pageSize) ||
        pageSize < 1 ||
        pageSize > 200 ||
        typeof search !== 'string' ||
        search.length > 128 ||
        !filters ||
        typeof filters !== 'object' ||
        Array.isArray(filters) ||
        Object.values(filters).some((value) => typeof value !== 'string') ||
        !Array.isArray(rowIds) ||
        rowIds.length > 20 ||
        rowIds.some((value) => typeof value !== 'string' || !value || value.length > 1024)
      ) {
        throw new PlatformError('INVALID_QUERY', '查询条件无效。');
      }
      const state = await repository.snapshot();
      const dataset = state.datasets.find((item) => item.id === datasetId);
      if (source === 'quality' && !dataset)
        throw new PlatformError('DATASET_REQUIRED', '请选择有效数据集。');
      const candidates =
        source === 'quality'
          ? state.facts.filter((item) => item.datasetId === datasetId)
          : state.observations;
      const dimensions = [
        ...new Set(candidates.flatMap((item) => Object.keys(item.dimensions))),
      ].sort();
      const allowedTop =
        source === 'quality' ? [] : ['templateId', 'serialNumber', 'issue', 'relatedCode'];
      if (
        Object.keys(filters).some(
          (key) =>
            !allowedTop.includes(key) &&
            !(source === 'quality' ? dataset.grainFields : dimensions).includes(key),
        )
      ) {
        throw new PlatformError('UNSUPPORTED_FILTER', '当前来源不支持此筛选条件。');
      }
      const columns =
        source === 'quality'
          ? [{ key: 'businessDate', label: '业务日期', type: 'date' }]
          : [
              { key: 'observedOn', label: '发现日期', type: 'date' },
              { key: 'serialNumber', label: 'SN', type: 'text' },
              { key: 'issue', label: '异常现象', type: 'text' },
              { key: 'relatedCode', label: '关联编号', type: 'text' },
            ];
      for (const key of dimensions)
        columns.push({ key: `dim:${key}`, label: LABELS[key] || key, type: 'text' });
      if (source === 'quality') {
        for (const [key, label] of Object.entries(MEASURES))
          columns.push({ key, label, type: 'number' });
        columns.push({ key: 'sourceRow', label: '来源行', type: 'number' });
      }
      const dateField = source === 'quality' ? 'businessDate' : 'observedOn';
      const query = search.trim().toLocaleLowerCase();
      const requestedIds = new Set(rowIds);
      let rows = candidates
        .filter(
          (item) =>
            (!requestedIds.size || requestedIds.has(item.id)) &&
            item[dateField] >= start &&
            item[dateField] <= end &&
            Object.entries(filters).every(([key, value]) =>
              allowedTop.includes(key)
                ? item[key] === value
                : own(item.dimensions, key) && item.dimensions[key] === value,
            ),
        )
        .map((item) => {
          const row = { id: item.id, [dateField]: item[dateField] };
          for (const key of dimensions) row[`dim:${key}`] = item.dimensions[key] ?? '';
          if (source === 'quality') {
            Object.assign(row, item.measures);
            row.sourceRow = item.source.rowNumber;
          } else for (const key of ['serialNumber', 'issue', 'relatedCode']) row[key] = item[key];
          return row;
        });
      if (query)
        rows = rows.filter((row) =>
          columns.some((column) =>
            String(row[column.key] ?? '')
              .toLocaleLowerCase()
              .includes(query),
          ),
        );
      const field = sort.field || dateField;
      const direction = sort.direction || 'desc';
      const column = columns.find((item) => item.key === field);
      if (!column || !['asc', 'desc'].includes(direction))
        throw new PlatformError('INVALID_SORT', '排序列无效。');
      rows.sort((a, b) => {
        const av = a[field],
          bv = b[field];
        if (av === null || av === '')
          return bv === null || bv === '' ? a.id.localeCompare(b.id) : 1;
        if (bv === null || bv === '') return -1;
        const compared =
          column.type === 'number'
            ? av - bv
            : String(av).localeCompare(String(bv), 'zh-CN', { numeric: false });
        return (direction === 'asc' ? compared : -compared) || a.id.localeCompare(b.id);
      });
      const total = rows.length;
      const actualPage = Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
      return {
        columns,
        rows: rows.slice((actualPage - 1) * pageSize, actualPage * pageSize),
        total,
        page: actualPage,
        pageSize,
      };
    },
  });
}
module.exports = { createQueryService };
