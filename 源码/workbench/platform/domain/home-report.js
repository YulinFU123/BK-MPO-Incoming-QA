'use strict';
const { dateRange, shiftISODate, strictISODate } = require('./validation');
const { summarizeQualityFacts } = require('./metrics');
const { PlatformError } = require('./errors');
const { createHash } = require('node:crypto');
const { filterKeys } = require('./home-workspaces');
const own = (o, k) => Object.hasOwn(o || {}, k);
function bucket(date, grain) {
  if (grain === 'month') return date.slice(0, 7) + '-01';
  if (grain === 'week') {
    const day = new Date(date + 'T00:00:00Z').getUTCDay();
    return shiftISODate(date, -((day + 6) % 7));
  }
  return date;
}
function buildHomeReport(snapshot, input, { today } = {}) {
  const {
    start,
    end,
    datasetId = '',
    filters = {},
    grain = 'week',
    search = '',
    followup = '',
    page = 1,
    pageSize = 10,
    sort = { field: 'date', direction: 'desc' },
  } = input;
  const range = dateRange(start, end);
  strictISODate(today);
  if (
    !filters ||
    typeof filters !== 'object' ||
    Array.isArray(filters) ||
    Object.keys(filters).some((k) => !filterKeys.includes(k)) ||
    Object.values(filters).some((v) => typeof v !== 'string' || v.length > 512) ||
    !['', 'notClosed', 'overdue'].includes(followup) ||
    !['day', 'week', 'month'].includes(grain) ||
    typeof search !== 'string' ||
    search.length > 128 ||
    !Number.isSafeInteger(page) ||
    page < 1 ||
    ![5, 10, 20, 50].includes(pageSize) ||
    ![
      'sequence',
      'date',
      'sn',
      'process',
      'issue',
      'owner',
      'reporter',
      'shift',
      'status',
    ].includes(sort.field) ||
    !['asc', 'desc'].includes(sort.direction)
  )
    throw new PlatformError('INVALID_QUERY', '首页筛选或排序条件无效。');
  const legacy = snapshot.legacyState,
    raw = new Map((legacy?.records || []).map((r, i) => [r.id, { r, i }]));
  const templates = legacy?.templates || [];
  const rows = (snapshot.observations || []).map((o, index) => {
    const entry = raw.get(o.id),
      r = entry?.r,
      t = templates.find((t) => t.id === o.templateId);
    const field = (id, labels) => {
      const col = t?.columns?.find((c) => c.id === id || labels.includes(c.label));
      return col ? String(r?.values?.[col.id] ?? '') : '';
    };
    return {
      id: o.id,
      sequence: (entry?.i ?? index) + 1,
      date: o.observedOn,
      sn: o.serialNumber || '',
      issue: o.issue || '',
      templateId: o.templateId,
      process: o.dimensions?.process || '',
      relatedCode: o.relatedCode || '',
      owner: entry ? String(r.workflow?.owner || '') : '',
      reporter: field('reporter', ['报检人']),
      shift: field('shift', ['报检班别', 'Shift']),
      status: entry ? r.workflow?.status || '待处理' : '未提供跟进信息',
      dueDate: entry ? r.workflow?.dueDate || '' : '',
      workflowAvailable: !!entry,
    };
  });
  const passes = (r) =>
    Object.entries(filters).every(
      ([key, value]) => r[key === 'serialNumber' ? 'sn' : key] === value,
    ) &&
    (!followup ||
      (followup === 'notClosed'
        ? r.workflowAvailable && r.status !== '已关闭'
        : r.workflowAvailable && r.status !== '已关闭' && r.dueDate && r.dueDate < today)) &&
    (!search ||
      Object.values(r).some(
        (v) =>
          typeof v === 'string' &&
          v.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
      ));
  const selected = rows.filter((r) => r.date >= start && r.date <= end && passes(r));
  const prevStart = shiftISODate(start, -range.days),
    prevEnd = shiftISODate(start, -1);
  const previous = rows.filter((r) => r.date >= prevStart && r.date <= prevEnd && passes(r));
  const rank = (items, key) => {
    const m = new Map();
    for (const r of items) m.set(r[key] || '', (m.get(r[key] || '') || 0) + 1);
    return [...m]
      .map(([value, count]) => ({ value, count, share: items.length ? count / items.length : 0 }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, 'zh-CN'));
  };
  const options = {};
  for (const key of filterKeys)
    options[key] = [
      ...new Set(
        rows
          .map((r) => r[key === 'serialNumber' ? 'sn' : key])
          .filter((v) => typeof v === 'string' && v !== ''),
      ),
    ].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  const dataset = (snapshot.datasets || []).find((d) => d.id === datasetId);
  const qualityFilters = {
    ...filters,
    ...(search.trim() ? { _search: search } : {}),
    ...(followup ? { _followup: followup } : {}),
  }; // Unsupported dimensions suppress quantities; never silently drop them.
  const quality = dataset
    ? summarizeQualityFacts(snapshot.facts, { start, end, datasetId, filters: qualityFilters })
    : null;
  const previousQuality = dataset
    ? summarizeQualityFacts(snapshot.facts, {
        start: prevStart,
        end: prevEnd,
        datasetId,
        filters: qualityFilters,
      })
    : null;
  const bins = new Map();
  for (const date of range.dates) {
    const key = bucket(date, grain);
    if (!bins.has(key))
      bins.set(key, { key, start: date, end: date, count: 0, previousCount: 0, facts: [] });
    bins.get(key).end = date;
  }
  for (const r of selected) bins.get(bucket(r.date, grain)).count++;
  for (const r of previous) {
    const aligned = shiftISODate(r.date, range.days),
      b = bins.get(bucket(aligned, grain));
    if (b) b.previousCount++;
  }
  for (const fact of snapshot.facts || [])
    if (
      dataset &&
      fact.datasetId === datasetId &&
      fact.businessDate >= start &&
      fact.businessDate <= end
    )
      bins.get(bucket(fact.businessDate, grain))?.facts.push(fact);
  const trend = [...bins.values()].map((b) => {
    const q = dataset
      ? summarizeQualityFacts(b.facts, {
          start: b.start,
          end: b.end,
          datasetId,
          filters: qualityFilters,
        })
      : null;
    return {
      key: b.key,
      start: b.start,
      end: b.end,
      recordCount: b.count,
      previousCount: b.previousCount,
      defectiveUnits: q?.totals.defectiveUnits ?? null,
      inspectedUnits: q?.totals.inspectedUnits ?? null,
    };
  });
  const followupAvailable = !!legacy && selected.every((r) => r.workflowAvailable),
    pending = followupAvailable ? selected.filter((r) => r.status !== '已关闭').length : null,
    overdue = followupAvailable
      ? selected.filter(
          (r) => r.status !== '已关闭' && /^\d{4}-\d\d-\d\d$/.test(r.dueDate) && r.dueDate < today,
        ).length
      : null;
  const currentCount = selected.length,
    delta = currentCount - previous.length;
  const sorted = selected.slice().sort((a, b) => {
    const av = a[sort.field],
      bv = b[sort.field];
    return (
      (sort.direction === 'asc' ? 1 : -1) *
        (typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv), 'zh-CN')) ||
      a.id.localeCompare(b.id)
    );
  });
  const actualPage = Math.min(page, Math.max(1, Math.ceil(sorted.length / pageSize)));
  return {
    scope: { start, end, filters: structuredClone(filters), datasetId, grain, search },
    observationRevision: createHash('sha256').update(JSON.stringify(selected)).digest('hex'),
    recordCount: currentCount,
    previousCount: previous.length,
    recordDelta: delta,
    recordChange: previous.length ? delta / previous.length : null,
    quality,
    previousQuality,
    pending,
    overdue,
    workflowAvailable: followupAvailable,
    issues: rank(selected, 'issue'),
    processes: rank(selected, 'process'),
    owners: rank(selected, 'owner'),
    shifts: rank(selected, 'shift'),
    trend,
    filterOptions: options,
    templates: templates.map((t) => ({ id: t.id, name: t.name })),
    rows: sorted.slice((actualPage - 1) * pageSize, actualPage * pageSize),
    page: actualPage,
    pageSize,
    total: sorted.length,
    selectedIdCount: new Set(selected.map((r) => r.id)).size,
    omittedObservations: snapshot.legacyQuality?.stats?.rejected || 0,
    dateBasis: { observations: '发现日期', quality: '检验业务日' },
    note: '关联条数不是人员责任判定；件数来自选定检验数据集，不从异常记录条数推算。',
  };
}
module.exports = { buildHomeReport, bucket };
