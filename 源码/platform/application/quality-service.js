'use strict';
const { dateRange } = require('../domain/validation');
const { scopeKey } = require('../domain/identity');
const { PlatformError } = require('../domain/errors');
const { assertJSONData } = require('../ports/dto');

function createQualityService({ repository, legacyAudit }) {
  if (typeof legacyAudit !== 'function')
    throw new PlatformError('INVALID_QUALITY_PORT', '原异常核对接口未配置。');
  return Object.freeze({
    async inspect(input) {
      assertJSONData(input);
      const { start, end, datasetId = '', filters = {} } = input || {};
      const range = dateRange(start, end);
      if (
        typeof datasetId !== 'string' ||
        !filters ||
        Array.isArray(filters) ||
        typeof filters !== 'object' ||
        Object.values(filters).some((v) => typeof v !== 'string')
      )
        throw new PlatformError('INVALID_QUERY', '核对范围无效。');
      const state = await repository.snapshot();
      const dataset = state.datasets.find((row) => row.id === datasetId);
      if (datasetId && !dataset)
        throw new PlatformError('DATASET_REQUIRED', '请选择有效的数据集。');
      if (Object.keys(filters).some((key) => !dataset?.grainFields.includes(key)))
        throw new PlatformError('UNSUPPORTED_FILTER', '此核对数据集不支持当前筛选。');
      const facts = state.facts.filter(
        (row) =>
          (!datasetId || row.datasetId === datasetId) &&
          row.businessDate >= start &&
          row.businessDate <= end &&
          Object.entries(filters).every(([key, value]) => row.dimensions[key] === value),
      );
      const checks = [];
      const add = (
        id,
        source,
        title,
        count,
        explanation,
        samples = [],
        severity = 'warning',
        action = null,
      ) =>
        checks.push({
          id,
          source,
          title,
          count,
          explanation,
          severity: count ? severity : 'ok',
          samples: samples.slice(0, 20),
          samplesTruncated: count > Math.min(samples.length, 20),
          action,
        });
      const location = (row) => ({
        factId: row.id,
        datasetId: row.datasetId,
        date: row.businessDate,
        rowNumber: row.source.rowNumber,
        batchId: row.source.batchId,
      });
      const checkFacts = (id, title, predicate, explanation) => {
        const rows = facts.filter(predicate);
        add(
          id,
          'quantity',
          title,
          rows.length,
          explanation,
          rows.slice(0, 21).map(location),
          'warning',
          'data',
        );
      };
      const dates = new Set(facts.map((row) => row.businessDate));
      const gaps = range.dates.filter((date) => !dates.has(date));
      add(
        'quantity-gaps',
        'quantity',
        '当前筛选无记录的日期',
        gaps.length,
        '不等同于数据错误；需核对停产、未导入或未采集，不自动补零。',
        gaps.slice(0, 21).map((date) => ({ date })),
        'notice',
      );
      checkFacts(
        'quantity-denominator',
        '缺少检验件数',
        (row) => row.measures.inspectedUnits === null,
        '这些行无法计算不良率。',
      );
      checkFacts(
        'quantity-zero',
        '检验件数为零',
        (row) => row.measures.inspectedUnits === 0,
        '分母为零时不计算不良率；零不良与零检验分开。',
      );
      checkFacts(
        'quantity-numerator',
        '缺少不良件数',
        (row) => row.measures.defectiveUnits === null,
        '不会把空值默认为零。',
      );
      checkFacts(
        'quantity-invalid',
        '数量或分母关系无效',
        (row) =>
          Object.values(row.measures).some(
            (value) => value !== null && (!Number.isSafeInteger(value) || value < 0),
          ) ||
          (row.measures.inspectedUnits !== null &&
            row.measures.defectiveUnits !== null &&
            row.measures.defectiveUnits > row.measures.inspectedUnits),
        '核对负值、无效数值或不良件数大于检验件数；不会静默修正。',
      );
      const seen = new Set(),
        duplicates = [];
      for (const row of facts) {
        const key = scopeKey(row);
        if (seen.has(key)) duplicates.push(row);
        else seen.add(key);
      }
      add(
        'quantity-duplicates',
        'quantity',
        '重复日期与统计维度的后续行',
        duplicates.length,
        '使用数据集的原统计粒度；每组第一行不计入此项。',
        duplicates.slice(0, 21).map(location),
        'warning',
        'data',
      );
      const batchIds = new Set(facts.map((row) => row.source.batchId));
      const warnings = state.batches.filter(
        (row) => batchIds.has(row.id) && (row.warningCount || row.warningCodes?.length),
      );
      add(
        'import-warnings',
        'quantity',
        '含已确认警告的导入批次',
        warnings.length,
        '此项是导入时已确认的警告记录，不代表该批导入失败。',
        warnings
          .slice(0, 21)
          .map((row) => ({ batchId: row.id, message: (row.warningCodes || []).join('、') })),
        'notice',
        'import',
      );
      const legacy = state.legacyQuality || { stats: { rejected: 0 }, errors: [] };
      const invalidSamples = (legacy.errors || []).map((row) => ({
        rowNumber: row.rowNumber,
        recordId: state.legacyState?.records[row.rowNumber - 1]?.id || '',
        message: row.message,
      }));
      add(
        'legacy-projection',
        'observations',
        '无法进入分析的原异常记录',
        legacy.stats.rejected || 0,
        '来自整个工作区的分析投影检查；无法识别日期的记录不能归入所选日期范围。',
        invalidSamples,
        'warning',
        'legacy-records',
      );
      const audit = legacyAudit(state.legacyState, state.observations, { start, end });
      add(
        'legacy-rules',
        'observations',
        '原输入与唯一值规则待核对项',
        audit.count,
        '按各表头原规则和现有记录顺序核对，只报告每条记录的首个问题。未勾选唯一值的字段不按重复拒绝；不自动判定误扫或删除。',
        audit.samples,
        'warning',
        'legacy-records',
      );
      return {
        scope: { start, end, datasetId, filters: structuredClone(filters) },
        checks,
        checked: { facts: facts.length, legacy: audit.checked, batches: batchIds.size },
        checkedAt: null,
        limits: [
          '检查已保存数据；导入前被拒绝的行仍需在原导入预览核对。',
          '不同检查可能涉及同一行，不能直接相加当作问题记录数。',
          '原异常核对只按所选日期，检验维度筛选不套用到原异常。',
        ],
        productionAccepted: false,
      };
    },
  });
}
module.exports = { createQualityService };
