'use strict';
((factory) => {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  else window.DashboardModel = value;
})(() => {
  const finite = (n) => typeof n === 'number' && Number.isFinite(n);
  const number = (n) => (finite(n) ? n.toLocaleString('zh-CN', { maximumFractionDigits: 4 }) : '—');
  const percent = (n) => (finite(n) ? (n * 100).toFixed(2) + '%' : '—');
  function summarize(report, fallbackCount = null, reasonLabels = {}) {
    const q = report?.quality;
    const o = report?.observations;
    const count = o ? (o.status === 'available' ? o.recordCount : null) : fallbackCount;
    const totals = q?.totals || {};
    const rate = q?.rate?.status === 'available' ? q.rate.value : null;
    const delta = report?.comparison?.recordCount?.absolute;
    const cards = [
      {
        id: 'records',
        title: '异常记录',
        value: count,
        display: number(count),
        unit: '条',
        source: 'observations',
        note: finite(delta)
          ? `较同长前期 ${delta > 0 ? '+' : ''}${number(delta)} 条`
          : '按发现日期统计',
        formula: '统计范围内有效异常记录的条数；不是不良件数。',
      },
      {
        id: 'inspected',
        title: '检验件数',
        value: totals.inspectedUnits,
        display: number(totals.inspectedUnits),
        unit: '件',
        source: 'quality',
        note: q ? `${number(q.factCount)} 行检验事实汇总` : '尚无检验数据集',
        formula: '对相同数据集、周期和筛选范围内的检验件数求和。缺失值不按零计算。',
      },
      {
        id: 'defective',
        title: '不良件数',
        value: totals.defectiveUnits,
        display: number(totals.defectiveUnits),
        unit: '件',
        source: 'quality',
        note: '件数与缺陷次数分别统计',
        formula: '对同范围检验事实中的不良件数求和，不从异常记录条数推算。',
      },
      {
        id: 'rate',
        title: '不良率',
        value: rate,
        display: percent(rate),
        unit: '',
        source: 'quality',
        note: finite(rate)
          ? `${number(totals.defectiveUnits)} ÷ ${number(totals.inspectedUnits)} × 100%`
          : q?.rate?.reasons?.length
            ? [
                ...new Set(q.rate.reasons.map((code) => reasonLabels[code] || '统计口径需要核对')),
              ].join('；')
            : '缺少有效分子/分母或口径需核对',
        formula: '不良率 = 不良件数合计 ÷ 检验件数合计 × 100%。不是逐行不良率的平均值。',
      },
    ];
    const issues =
      o?.status === 'available'
        ? (o.issues || []).map((item) => ({
            ...item,
            share: count > 0 ? item.count / count : 0,
          }))
        : [];
    return {
      cards,
      issues,
      recordCount: count,
      observationAvailable: !o || o.status === 'available',
      trend: o?.status === 'available' ? o.trend || [] : [],
      rate,
    };
  }
  function detailQuery(scope, source, { date, issue, rowId, page = 1 } = {}) {
    const result = {
      ...scope,
      filters: { ...scope.filters },
      source,
      search: '',
      page,
      pageSize: 25,
      sort: { field: source === 'quality' ? 'businessDate' : 'observedOn', direction: 'desc' },
    };
    if (date) result.start = result.end = date;
    if (issue !== undefined) result.filters.issue = issue;
    if (rowId) result.rowIds = [rowId];
    return result;
  }
  return Object.freeze({ summarize, detailQuery, number, percent });
});
