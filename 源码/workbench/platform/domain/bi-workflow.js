'use strict';
(function (root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  else root.BIWorkflow = value;
})(typeof window === 'object' ? window : null, () => {
  const groups = [
    {
      title: '1　获取与导入',
      note: '日报文件/网页接收，与历史原表分别管理。',
      routes: ['bi-daily', 'bi-data'],
    },
    {
      title: '2　筛选与字典',
      note: '以下为历史报表规则；日报筛选在日报页面内。',
      routes: ['bi-schemes', 'bi-groups', 'bi-people', 'bi-defects'],
    },
    {
      title: '3　分析变化',
      note: '历史趋势和改善；日报分析仍在同一日报页完成。',
      routes: ['bi-trends', 'bi-improve'],
    },
    {
      title: '4　报表与图表',
      note: '完整历史Excel及图表配置；日报Excel/PNG在日报页导出。',
      routes: ['bi-home', 'bi-charts'],
    },
    {
      title: '辅助配置',
      note: '低频设置，保留原有能力。',
      routes: ['bi-dash', 'bi-alerts', 'bi-chk', 'bi-tools'],
    },
  ];
  const pages = groups.flatMap((g) => g.routes);
  const defaults = () => ({ acquisitionOpen: false, scriptOpen: false });
  function preferences(value = {}) {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).some((k) => !Object.hasOwn(defaults(), k)) ||
      Object.values(value).some((v) => typeof v !== 'boolean')
    )
      throw Error('BI收纳设置无效。');
    return { ...defaults(), ...value };
  }
  function latestQuery(current, latest) {
    if (!current || !latest?.scope || !latest.period?.start || !latest.period?.end)
      throw Error('最近接收范围不完整。');
    return {
      ...structuredClone(current),
      scope: latest.scope,
      start: latest.period.start,
      end: latest.period.end,
    };
  }
  function context({ page, daily = {}, history = {}, dirty = false }) {
    const isDaily = page === 'daily',
      isTrend = page === 'trends',
      q = isDaily ? daily : history;
    const filters = isDaily
      ? [
          ['不良项', q.items],
          ['工序', q.process],
          ['人员', q.employees],
          ['排除人员', q.exclude],
          ['班别', q.shift],
          ['楼层', q.floor],
          ['产品', q.product],
        ]
      : [
          ['不良项', q.items],
          ['工序', q.processes],
          ['排除工序', q.exclude_processes],
          ['人员', q.employees],
          ['排除人员', q.exclude_employees],
          ['人员组', q.employee_groups],
          ['工序组', q.process_groups],
          ['班别', q.shifts],
          ['产品', q.products],
        ];
    const summary =
      filters
        .filter(([, values]) => Array.isArray(values) && values.length)
        .map(
          ([label, values]) =>
            `${label}：${values.slice(0, 3).join('、')}${values.length > 3 ? `等${values.length}项` : ''}`,
        )
        .join('；') || '未额外限制不良项、工序、人员和班别';
    return {
      lane: isDaily ? '日报数据' : '历史数据',
      range:
        isDaily || isTrend
          ? `${q.start || '起始日未设置'} 至 ${q.end || '结束日未设置'}`
          : '以当前页报表窗口为准，不套用趋势临时日期',
      scope: isDaily ? q.scope || '未选择日报来源范围' : '历史原表及全局规则',
      status: isDaily
        ? {
            'Rework,Scrap': '返工与报废',
            Rework: '返工',
            Scrap: '报废',
            Release: '放行',
            'Awaiting Disposition': '待判定',
          }[q.status] ||
          q.status ||
          '全部处置状态'
        : '沿用历史全局筛选',
      filters:
        isDaily || isTrend
          ? '本地条件：' + summary
          : '本页使用历史全局规则和各方案设置，不自动套用趋势临时条件。',
      notice: dirty
        ? '请更新分析后再导出；筛选分别记忆，不会自动覆盖首页或其他分析页。'
        : '首页、日报和历史分别记忆。网页字段筛选控制下载；业务日期与日报共享，本地人员/不良项条件另设。',
    };
  }
  return { groups, pages, defaults, preferences, latestQuery, context };
});
