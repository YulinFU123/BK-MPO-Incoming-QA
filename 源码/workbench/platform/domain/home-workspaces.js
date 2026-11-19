'use strict';
(function (root, factory) {
  const m = factory(
    typeof module === 'object' && module.exports
      ? require('./workspace-query')
      : root.WorkspaceQuery,
  );
  if (typeof module === 'object' && module.exports) module.exports = m;
  else root.HomeWorkspaces = m;
})(typeof window === 'object' ? window : this, (query) => {
  const panels = ['trend', 'issues', 'process', 'records', 'owners', 'comparison', 'time'];
  const filterKeys = [
    'process',
    'issue',
    'owner',
    'reporter',
    'shift',
    'status',
    'templateId',
    'relatedCode',
    'serialNumber',
  ];
  const base = () => ({
    id: 'overview',
    name: '全部异常',
    datasetId: '',
    range: '30',
    start: '',
    end: '',
    filters: {},
    grain: 'week',
    density: 'comfortable',
    panels: panels.slice(),
    open: true,
    sort: query.defaultSort(),
  });
  const defaults = () => ({ activeId: 'overview', settingsOpen: false, views: [base()] });
  const text = (x, n = 128) => typeof x === 'string' && x.length <= n && !/[\x00-\x1f]/.test(x);
  const obj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
  const fields = (x, keys) => obj(x) && Object.keys(x).every((k) => keys.includes(k));
  const date = (x) =>
    x === '' ||
    (typeof x === 'string' &&
      /^\d{4}-\d\d-\d\d$/.test(x) &&
      Number.isFinite(Date.parse(x + 'T00:00:00Z')) &&
      new Date(x + 'T00:00:00Z').toISOString().slice(0, 10) === x);
  function validate(value) {
    const bad = () => {
      throw Error('分析工作区配置无效，原业务数据未改变。');
    };
    if (
      !fields(value, ['activeId', 'settingsOpen', 'views']) ||
      !text(value.activeId, 64) ||
      typeof value.settingsOpen !== 'boolean' ||
      !Array.isArray(value.views) ||
      !value.views.length ||
      value.views.length > 33 ||
      (value.views.length === 33 && !value.views.some((v) => v?.id === 'managed-overview'))
    )
      bad();
    value = structuredClone(value);
    for (const view of value.views)
      if (obj(view) && view.sort === undefined) view.sort = query.defaultSort();
    const ids = new Set();
    for (const v of value.views) {
      if (
        !fields(v, Object.keys(base())) ||
        !text(v.id, 64) ||
        !v.id ||
        ids.has(v.id) ||
        !text(v.name, 64) ||
        !v.name.trim() ||
        !text(v.datasetId) ||
        !query.ranges.includes(v.range) ||
        !date(v.start) ||
        !date(v.end) ||
        (v.range === 'custom' && (!v.start || !v.end || v.start > v.end)) ||
        !fields(v.filters, filterKeys) ||
        Object.values(v.filters).some((x) => !text(x, 512)) ||
        !['day', 'week', 'month'].includes(v.grain) ||
        !['comfortable', 'compact'].includes(v.density) ||
        typeof v.open !== 'boolean' ||
        !Array.isArray(v.panels) ||
        v.panels.some((x) => !panels.includes(x)) ||
        new Set(v.panels).size !== v.panels.length
      )
        bad();
      try {
        query.sort(v.sort);
      } catch {
        bad();
      }
      ids.add(v.id);
    }
    if (!value.views.some((v) => v.id === value.activeId && v.open)) bad();
    return structuredClone(value);
  }
  function inheritWorkspace(value, preferences, name) {
    const next = validate(value),
      p = query.normalize(preferences);
    let v = next.views.find((x) => x.id === 'managed-overview');
    if (!v) {
      v = { ...base(), id: 'managed-overview' };
      next.views.push(v);
    }
    Object.assign(v, p, {
      name: String(name || '工作区').slice(0, 48) + ' · 当前范围',
      filters: {},
      open: true,
    });
    next.activeId = v.id;
    return validate(next);
  }
  function legacy(value) {
    if (
      value.views.length > 32 ||
      value.views.some(
        (v) => v.sort !== undefined || !['7', '30', '90', 'custom', 'all'].includes(v.range),
      )
    )
      throw Error('旧版分析配置格式不支持这些设置。');
    const v = validate(value);
    v.views.forEach((x) => delete x.sort);
    return v;
  }
  const legacyDefaults = () => {
    const v = defaults();
    v.views.forEach((x) => delete x.sort);
    return v;
  };
  return { panels, filterKeys, base, defaults, validate, inheritWorkspace, legacy, legacyDefaults };
});
