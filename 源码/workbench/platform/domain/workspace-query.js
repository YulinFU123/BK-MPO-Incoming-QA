'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WorkspaceQuery = api;
})(typeof window === 'object' ? window : this, () => {
  const ranges = ['1', '7', '30', '90', 'month', 'last-month', 'all', 'custom'];
  const sortFields = [
    'sequence',
    'date',
    'sn',
    'process',
    'issue',
    'owner',
    'reporter',
    'shift',
    'status',
  ];
  const defaultSort = () => ({ field: 'date', direction: 'desc' });
  const date = (v) =>
    typeof v === 'string' &&
    /^\d{4}-\d\d-\d\d$/.test(v) &&
    Number.isFinite(Date.parse(v + 'T00:00:00Z')) &&
    new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
  function sort(value = defaultSort()) {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).some((k) => !['field', 'direction'].includes(k)) ||
      !sortFields.includes(value.field) ||
      !['asc', 'desc'].includes(value.direction)
    )
      throw Error('排序规则无效。');
    return { ...value };
  }
  function normalize(value = {}) {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).some(
        (k) => !['range', 'start', 'end', 'grain', 'datasetId', 'sort'].includes(k),
      )
    )
      throw Error('分析范围无效。');
    const p = {
      range: '30',
      start: '',
      end: '',
      grain: 'week',
      datasetId: '',
      sort: defaultSort(),
      ...value,
    };
    if (
      !ranges.includes(p.range) ||
      !['day', 'week', 'month'].includes(p.grain) ||
      typeof p.datasetId !== 'string' ||
      p.datasetId.length > 128 ||
      typeof p.start !== 'string' ||
      typeof p.end !== 'string' ||
      (p.start && !date(p.start)) ||
      (p.end && !date(p.end)) ||
      (p.range === 'custom' && (!date(p.start) || !date(p.end) || p.start > p.end))
    )
      throw Error('请填写有效的日期和分析设置。');
    p.sort = sort(p.sort);
    return p;
  }
  function shift(day, delta) {
    const d = new Date(day + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + delta);
    return d.toISOString().slice(0, 10);
  }
  function resolve(value, today, bounds = {}) {
    const p = normalize(value);
    if (!date(today)) throw Error('当前日期无效。');
    let start,
      end = today;
    if (p.range === 'custom') {
      start = p.start;
      end = p.end;
    } else if (p.range === 'all') {
      start = bounds?.start || today;
      end = bounds?.end && bounds.end > today ? bounds.end : today;
    } else if (p.range === 'month') start = today.slice(0, 7) + '-01';
    else if (p.range === 'last-month') {
      end = shift(today.slice(0, 7) + '-01', -1);
      start = end.slice(0, 7) + '-01';
    } else start = shift(today, 1 - Number(p.range));
    return { start, end, datasetId: p.datasetId, grain: p.grain, sort: { ...p.sort } };
  }
  function summary(report) {
    if (report.primary?.source === 'bi') {
      const b = report.biSource || {},
        available = report.primary.available;
      return {
        source: 'bi',
        available,
        sourceName: b.sourceName || b.dailyScope || '',
        state: b.state,
        message: b.message || '',
        quantity: available ? b.quantity : null,
        rows: available ? b.rowCount : null,
        coverageDays: available ? b.coverageDays : null,
        previousQuantity: available ? b.previousQuantity : null,
        unit: b.unitLabel || '未确认',
        availableRange: b.availableRange || null,
        availableRowCount: b.availableRowCount ?? null,
        period: { start: report.scope.start, end: report.scope.end },
        trend: (b.trend || []).map((x) => ({ date: x.start, end: x.end, count: x.quantity })),
      };
    }
    return {
      records: report.recordCount,
      pending: report.pending,
      overdue: report.overdue,
      closedRate:
        report.workflowAvailable && report.recordCount
          ? (report.recordCount - report.pending) / report.recordCount
          : null,
      period: { start: report.scope.start, end: report.scope.end },
      trend: report.trend.map((x) => ({ date: x.start, count: x.recordCount })),
    };
  }
  function legacy(value, today) {
    const p = normalize(value);
    if (['1', 'month', 'last-month'].includes(p.range)) {
      const r = resolve(p, today);
      p.range = 'custom';
      p.start = r.start;
      p.end = r.end;
    }
    const { sort, ...old } = p;
    return old;
  }
  return { ranges, sortFields, defaultSort, sort, normalize, resolve, summary, legacy };
});
