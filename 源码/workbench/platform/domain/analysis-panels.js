'use strict';
(function (root, factory) {
  const value = factory(
    typeof module === 'object' && module.exports
      ? require('./analysis-studio')
      : root.AnalysisStudio,
  );
  if (typeof module === 'object' && module.exports) module.exports = value;
  else root.AnalysisPanels = value;
})(typeof window === 'object' ? window : null, (M) => {
  const FORMAT = 'bkmpo.analysis-panels.settings';
  const SHARE = 'bkmpo.analysis-panels.scheme';
  const periods = M.periods;
  const kinds = ['trend', 'chart', 'table', 'metric'];
  const scopes = ['page', 'filters', 'independent'];
  const text = (v, max = 120) =>
    typeof v === 'string' && v.length <= max && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v);
  const object = (v) =>
    v && typeof v === 'object' && Object.prototype.toString.call(v) === '[object Object]';
  const keys = (v, names) => object(v) && Object.keys(v).every((k) => names.includes(k));
  const id = (v) =>
    typeof v === 'string' &&
    /^[a-zA-Z0-9-]{1,64}$/.test(v) &&
    !['constructor', 'prototype', '__proto__'].includes(v);
  const fail = (message) => {
    throw Error(message || '分析板块配置无效；原配置未改变。');
  };
  const clone = (v) => structuredClone(v);
  const roles = [...new Set([...M.roles, ...M.dimensions])];
  function validateRef(v) {
    if (typeof v === 'string' && roles.includes(v)) return v;
    if (keys(v, ['column']) && text(v.column, 256) && v.column.trim()) return v;
    return fail('方案字段应为业务角色或原始表头名称，不能包含本机列ID。');
  }
  function portableQuery(q, source) {
    q = M.query(q);
    const ref = (field) => {
      if (roles.includes(field)) return field;
      const c = source.columns.find((c) => c.id === field);
      if (!c) return fail('当前字段已不存在，未保存方案。');
      if (source.columns.filter((x) => x.label === c.label).length !== 1)
        return fail('表头“' + c.label + '”重复，需先明确字段名称再分享或保存。');
      return { column: c.label };
    };
    return {
      ...q,
      dimension: ref(q.dimension),
      sort: { ...q.sort, field: ref(q.sort.field) },
      filters: q.filters.map((f) => ({ ...f, field: ref(f.field) })),
    };
  }
  function validateQuery(q) {
    if (!object(q) || !Array.isArray(q.filters) || !object(q.sort)) return fail();
    const ref = (v) => (validateRef(v), typeof v === 'string' ? v : 'h_0000000000000000');
    M.query({
      ...q,
      dimension: ref(q.dimension),
      sort: { ...q.sort, field: ref(q.sort.field) },
      filters: q.filters.map((f) => ({ ...f, field: ref(f.field) })),
    });
    return clone(q);
  }
  function bindQuery(q, source) {
    validateQuery(q);
    const field = (ref) => {
      if (typeof ref === 'string') return ref;
      const matches = source.columns.filter((c) => c.label === ref.column);
      if (matches.length !== 1)
        return fail('方案需要唯一表头“' + ref.column + '”，当前来源未提供或存在重名。');
      return matches[0].id;
    };
    return M.query({
      ...q,
      dimension: field(q.dimension),
      sort: { ...q.sort, field: field(q.sort.field) },
      filters: q.filters.map((f) => ({ ...f, field: field(f.field) })),
    });
  }
  function panel(p) {
    if (
      !keys(p, [
        'id',
        'title',
        'kind',
        'scope',
        'query',
        'width',
        'height',
        'enabled',
        'statMetric',
      ]) ||
      !id(p.id) ||
      !text(p.title) ||
      !kinds.includes(p.kind) ||
      !scopes.includes(p.scope) ||
      ![1, 2].includes(p.width) ||
      !Number.isInteger(p.height) ||
      p.height < 200 ||
      p.height > 900 ||
      typeof p.enabled !== 'boolean' ||
      !['records', 'quantity', 'production', 'rate'].includes(p.statMetric)
    )
      return fail();
    validateQuery(p.query);
    if (p.kind === 'chart' && p.query.metric === 'rate' && p.query.chartType === 'pie')
      return fail('不良率不适合构成饼图，请改用数量或其他图种。');
    return clone(p);
  }
  function seedPanel(kind, identifier, q, source) {
    return {
      id: identifier,
      title: kind === 'trend' ? '变化趋势' : '分类分析',
      kind,
      scope: 'page',
      query: portableQuery(q, source),
      width: 1,
      height: 360,
      enabled: true,
      statMetric: 'quantity',
    };
  }
  function scheme(s) {
    if (
      !keys(s, ['id', 'name', 'showSummary', 'periods']) ||
      !id(s.id) ||
      !text(s.name, 80) ||
      !s.name.trim() ||
      typeof s.showSummary !== 'boolean' ||
      !keys(s.periods, periods) ||
      periods.some((p) => !s.periods[p])
    )
      return fail();
    for (const period of periods) {
      const view = s.periods[period];
      if (
        !keys(view, ['query', 'panels']) ||
        !Array.isArray(view.panels) ||
        view.panels.length > 64
      )
        return fail();
      validateQuery(view.query);
      view.panels.forEach(panel);
      if (new Set(view.panels.map((p) => p.id)).size !== view.panels.length)
        return fail('板块ID重复。');
    }
    return clone(s);
  }
  function validate(state) {
    if (
      !keys(state, ['format', 'version', 'revision', 'sources']) ||
      state.format !== FORMAT ||
      state.version !== 1 ||
      !Number.isSafeInteger(state.revision) ||
      state.revision < 0 ||
      !object(state.sources) ||
      Object.keys(state.sources).length > 32
    )
      return fail();
    for (const [sourceId, slot] of Object.entries(state.sources)) {
      if (
        !id(sourceId) ||
        !keys(slot, ['active', 'schemes']) ||
        !id(slot.active) ||
        !Array.isArray(slot.schemes) ||
        !slot.schemes.length ||
        slot.schemes.length > 32
      )
        return fail();
      slot.schemes.forEach(scheme);
      if (
        new Set(slot.schemes.map((s) => s.id)).size !== slot.schemes.length ||
        !slot.schemes.some((s) => s.id === slot.active)
      )
        return fail();
    }
    return clone(state);
  }
  function createSlot(source, config) {
    const views = Object.fromEntries(
      periods.map((period) => {
        const q = M.currentView(config, period, source.id);
        return [
          period,
          {
            query: portableQuery(q, source),
            panels: [
              seedPanel('trend', 'trend', q, source),
              seedPanel('chart', 'ranking', q, source),
            ],
          },
        ];
      }),
    );
    return {
      active: 'default',
      schemes: [{ id: 'default', name: '默认分析', showSummary: true, periods: views }],
    };
  }
  function ensure(state, source, config) {
    state.sources[source.id] ||= createSlot(source, { ...config, activeSource: source.id });
    return state.sources[source.id];
  }
  function defaults(config) {
    const state = { format: FORMAT, version: 1, revision: 0, sources: {} };
    config.sources.filter((s) => s.kind === 'defects').forEach((s) => ensure(state, s, config));
    return validate(state);
  }
  function active(state, sourceId) {
    const slot = state.sources[sourceId];
    return slot?.schemes.find((s) => s.id === slot.active);
  }
  function effective(panel, base, source) {
    panel = clone(panel);
    const own = bindQuery(panel.query, source);
    if (panel.scope === 'page') return M.query(base);
    if (panel.scope === 'independent') return own;
    return M.query({
      ...own,
      range: base.range,
      start: base.start,
      end: base.end,
      filters: [...base.filters, ...own.filters],
    });
  }
  function share(s) {
    return { format: SHARE, version: 1, scheme: scheme(s) };
  }
  function readShare(value, source) {
    if (
      !keys(value, ['format', 'version', 'scheme']) ||
      value.format !== SHARE ||
      value.version !== 1
    )
      return fail('请选择本软件导出的分析方案JSON，当前配置未改变。');
    const next = scheme(value.scheme);
    for (const v of Object.values(next.periods)) {
      bindQuery(v.query, source);
      v.panels.forEach((p) => bindQuery(p.query, source));
    }
    return next;
  }
  return Object.freeze({
    FORMAT,
    SHARE,
    kinds,
    scopes,
    periods,
    validate,
    panel,
    scheme,
    defaults,
    createSlot,
    ensure,
    active,
    portableQuery,
    validateQuery,
    bindQuery,
    effective,
    seedPanel,
    share,
    readShare,
  });
});
