'use strict';
(function (root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  else root.AnalysisStudio = value;
})(typeof window === 'object' ? window : null, () => {
  const periods = ['day', 'week', 'month'];
  const roles = [
    'date',
    'quantity',
    'defect',
    'employee',
    'reporter',
    'process',
    'shift',
    'floor',
    'product',
    'serial',
  ];
  const dimensions = [
    'employee',
    'reporter',
    'process',
    'shift',
    'defect',
    'floor',
    'product',
    'date',
    'week',
    'month',
  ];
  const operators = [
    'in',
    'notIn',
    'equals',
    'notEquals',
    'contains',
    'notContains',
    'startsWith',
    'endsWith',
    'gte',
    'lte',
    'between',
    'empty',
    'notEmpty',
  ];
  const types = ['bar', 'column', 'pie', 'line'];
  const labels = {
    date: '日期',
    quantity: '数量',
    defect: '不良项',
    employee: '责任员工',
    reporter: '报检人',
    process: '工序',
    shift: '班次',
    floor: '楼层',
    product: '产品',
    serial: 'SN',
    week: '周',
    month: '月',
  };
  const text = (v, n = 128) =>
    typeof v === 'string' &&
    v.length <= n &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v);
  const object = (v) => v && typeof v === 'object' && !Array.isArray(v);
  const keys = (v, allowed) => object(v) && Object.keys(v).every((k) => allowed.includes(k));
  const id = (v) => typeof v === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(v);
  const field = (v) => roles.includes(v) || /^h_[a-f0-9]{16}$/.test(v);
  const date = (v) =>
    v === '' ||
    (typeof v === 'string' &&
      /^\d{4}-\d\d-\d\d$/.test(v) &&
      Number.isFinite(Date.parse(v + 'T00:00:00Z')) &&
      new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v);
  const fail = () => {
    throw Error('自由分析配置无效，请检查字段、范围和输入长度。');
  };
  const viewDefaults = (period) => ({
    range: period === 'week' ? 'recent8w' : period === 'month' ? 'recent6m' : 'recent14',
    start: '',
    end: '',
    filters: [],
    dimension: 'employee',
    chartType: 'bar',
    metric: 'quantity',
    sort: { field: 'date', direction: 'desc' },
    pageSize: 50,
    topN: 10,
    ignorePendingDecisions: true,
  });
  function query(v) {
    if (
      !keys(v, [
        'range',
        'start',
        'end',
        'filters',
        'dimension',
        'chartType',
        'metric',
        'sort',
        'pageSize',
        'topN',
        'ignorePendingDecisions',
      ]) || (v.ignorePendingDecisions !== undefined && typeof v.ignorePendingDecisions !== 'boolean') ||
      ![
        'recent14',
        'recent7',
        'recent30',
        'recent8w',
        'recent6m',
        'latest',
        'week',
        'month',
        'all',
        'custom',
      ].includes(v.range) ||
      !date(v.start) ||
      !date(v.end) ||
      (v.start && v.end && v.start > v.end) ||
      !(dimensions.includes(v.dimension) || /^h_[a-f0-9]{16}$/.test(v.dimension)) ||
      !types.includes(v.chartType) ||
      !['quantity', 'rate'].includes(v.metric) ||
      !Array.isArray(v.filters) ||
      v.filters.length > 20 ||
      !keys(v.sort, ['field', 'direction']) ||
      !field(v.sort.field) ||
      !['asc', 'desc'].includes(v.sort.direction) ||
      ![25, 50, 100].includes(v.pageSize) ||
      ![0, 5, 10, 20, 50].includes(v.topN)
    )
      fail();
    for (const f of v.filters)
      if (
        !keys(f, ['field', 'op', 'values', 'caseSensitive']) ||
        !field(f.field) ||
        !operators.includes(f.op) ||
        !Array.isArray(f.values) ||
        f.values.length > 500 ||
        f.values.some((x) => !text(x, 512)) ||
        typeof f.caseSensitive !== 'boolean'
      )
        fail();
    for (const f of v.filters) {
      const empty = ['empty', 'notEmpty'].includes(f.op),
        multi = ['in', 'notIn'].includes(f.op);
      if (
        empty
          ? f.values.length !== 0
          : multi
            ? f.values.length < 1
            : f.values.length !== (f.op === 'between' ? 2 : 1)
      )
        throw Error('筛选条件缺少值，区间规则需要完整的上下限。');
      if (['gte', 'lte', 'between'].includes(f.op)) {
        const numeric = f.values.every(
          (x) => x.trim() !== '' && Number.isFinite(Number(x.replace(/,/g, ''))),
        );
        const dates = f.values.every((x) => x !== '' && date(x));
        if (!numeric && !dates) throw Error('比较条件请填写数字，或YYYY-MM-DD格式的日期。');
        if (
          f.op === 'between' &&
          (numeric
            ? Number(f.values[0].replace(/,/g, '')) > Number(f.values[1].replace(/,/g, ''))
            : f.values[0] > f.values[1])
        )
          throw Error('区间下限不能大于上限。');
      }
    }
    return structuredClone(v);
  }
  const defaults = () => ({
    version: 1,
    sources: [],
    activeSource: '',
    productionSource: '',
    tab: 'day',
    views: {},
    report: {
      title: '{日期}{工序}不良分析',
      singlePage: true,
      margin: 8,
      gap: 4,
      titleSize: 24,
      charts: [],
    },
    templateMaps: [],
    activeTemplateMap: '',
    sharedAnalysis: null,
    quickExports: {},
    dailyReports: {},
  });
  const defaultRateKeywords = () => [
    { label: '物料穿错', keywords: ['穿错物料'] },
    { label: '物料穿错', keywords: ['物料穿反'] },
    { label: '物料穿错', keywords: ['物料少穿'] },
    { label: '物料穿错', keywords: ['多穿'] },
    ...['MPO', 'MMC'].map((product) => ({ label: product + '并纤反', keywords: [product, '并纤反'] })),
    ...['MPO', 'MMC', 'LCD'].map((product) => ({ label: product + '装管反', keywords: [product, '装管反'] })),
    ...['MPO', 'MMC', 'LCD'].map((product) => ({ label: product + '插芯内断纤', keywords: [product, '插芯', '断纤'] })),
    ...['MPO', 'MMC', 'LCD'].flatMap((product) => ['纤缩', '无纤'].map((reason) => ({
      label: product + '纤缩/无纤', keywords: [product, reason],
    }))),
    ...['MPO', 'MMC'].map((product) => ({ label: product + ' PIN孔堵', keywords: [product, 'PIN孔堵'] })),
  ];
  const dailyReportDefaults = () => ({
    includeRate: false,
    productionId: '',
    productionMode: 'bound',
    manualProduction: [],
    rateTitle: '每日不良率趋势',
    period: 'day',
    rateBasis: 'same-scope',
    templatePath: '',
    chartLayout: 'readable',
    reasonGroups: [],
    reasonColumn: '',
    sheetReasons: null,
    dailyTitle: '',
    rateKeywords: [],
  });
  function dailyReport(state, sourceId = state.activeSource) {
    return { ...dailyReportDefaults(), ...structuredClone(state.dailyReports?.[sourceId] || {}) };
  }
  function validateReasonGroups(groups) {
    if (!Array.isArray(groups) || groups.length > 32)
      throw Error('每个来源最多保存 32 个判定原因组合。');
    const assigned = new Set();
    return Array.from(groups, (group, index) => {
      const name = group?.name === undefined ? '' : group.name;
      if (!keys(group, ['name', 'reasons']) ||
          !text(name, 512) || /[\r\n\t]/.test(name) || name.trim().length > 31 ||
          !Array.isArray(group.reasons) || group.reasons.length < 1 || group.reasons.length > 16)
        throw Error(`第 ${index + 1} 组短名最多 31 个字符，每组需选择 1 至 16 个判定原因。`);
      for (const reason of group.reasons) {
        if (!text(reason, 512) || !reason.trim())
          throw Error(`第 ${index + 1} 组包含无效的原始判定原因。`);
        if (assigned.has(reason))
          throw Error('同一判定原因只能选择一次，不能重复加入组合。');
        // Preserve source values exactly; similar descriptions may be different reasons.
        assigned.add(reason);
      }
      return { name: name.trim(), reasons: [...group.reasons] };
    });
  }
  function validateRateKeywords(rules) {
    if (!Array.isArray(rules) || rules.length > 100)
      throw Error('每个来源最多保存 100 条不良率关键词规则。');
    return rules.map((rule, index) => {
      if (!keys(rule, ['label', 'keywords']) || !text(rule.label, 36) || !rule.label.trim() ||
          /[\r\n\t]/.test(rule.label) || !Array.isArray(rule.keywords) || !rule.keywords.length ||
          rule.keywords.length > 8 || rule.keywords.some((word) =>
            !text(word, 80) || !word.trim() || /[\r\n\t]/.test(word)))
        throw Error('第 ' + (index + 1) + ' 条需填写项目名和 1 至 8 个关键词。');
      return { label: rule.label.trim(), keywords: rule.keywords.map((word) => word.trim()) };
    });
  }
  function validateManualProduction(rows) {
    if (!Array.isArray(rows) || rows.length > 366)
      throw Error('每个来源最多保存 366 条手填产量。');
    const seen = new Set();
    return rows.map((entry, index) => {
      if (!keys(entry, ['date', 'process', 'shift', 'quantity']) ||
          typeof entry.date !== 'string' || !entry.date || !date(entry.date) || entry.date.startsWith('0000-') ||
          !text(entry.process, 160) || !entry.process.trim() ||
          !text(entry.shift, 160) || !entry.shift.trim() || entry.shift.trim() === '未归班' ||
          /[\r\n\t]/.test(entry.process + entry.shift) ||
          !Number.isSafeInteger(entry.quantity) || entry.quantity < 0 || entry.quantity > 1e12)
        throw Error(`手填产量第 ${index + 1} 条有误，请核对日期、工序、班次和非负整数产量。`);
      const row = { ...entry, process: entry.process.trim(), shift: entry.shift.trim() };
      const key = JSON.stringify([row.date, row.process, row.shift]);
      if (seen.has(key)) throw Error(`手填产量第 ${index + 1} 条日期、工序和班次重复。`);
      seen.add(key);
      return row;
    });
  }
  function productionBinding(v) {
    if (!keys(v, ['layout', 'fillDown', 'processAliases', 'shiftAliases', 'missingQuantity']) || v.layout !== 'rows' ||
        !Array.isArray(v.fillDown) || v.fillDown.length > 2 ||
        v.fillDown.some((x) => !['date', 'process'].includes(x)) ||
        new Set(v.fillDown).size !== v.fillDown.length) fail();
    const out = { layout: 'rows', fillDown: [...v.fillDown], missingQuantity: v.missingQuantity || 'reject' };
    if (!['reject', 'pending'].includes(out.missingQuantity)) fail();
    for (const key of ['processAliases', 'shiftAliases']) {
      const aliases = v[key];
      if (!object(aliases) || Object.keys(aliases).length > 200) fail();
      out[key] = {};
      for (const [name, target] of Object.entries(aliases)) {
        if (!text(name, 160) || !name.trim() || !text(target, 160) || !target.trim() ||
            ['__proto__', 'constructor', 'prototype'].includes(name.trim()) ||
            Object.hasOwn(out[key], name.trim())) fail();
        out[key][name.trim()] = target.trim();
      }
    }
    return out;
  }
  function mappingConflicts(mapping) {
    const columns = new Map();
    for (const role of roles) {
      const id = mapping[role];
      if (!id) continue;
      if (!columns.has(id)) columns.set(id, []);
      columns.get(id).push(role);
    }
    return [...columns].filter(([, assigned]) => assigned.length > 1);
  }
  function source(v) {
    if (
      !keys(v, [
        'id',
        'name',
        'kind',
        'folder',
        'sheet',
        'headerRow',
        'mapping',
        'columns',
        'schema',
        'confirmed',
        'unit',
        'cutoff',
        'auto',
        'dateFromFilename',
        'uniqueColumns',
        'updateMode',
        'coverage',
        'dateFormat',
        'productionBinding',
      ]) ||
      !id(v.id) ||
      !text(v.name, 80) ||
      !v.name.trim() ||
      !['defects', 'production'].includes(v.kind) ||
      !text(v.folder, 4096) ||
      !text(v.sheet, 128) ||
      !Number.isInteger(v.headerRow) ||
      v.headerRow < 0 ||
      v.headerRow > 100 ||
      !keys(v.mapping, roles) ||
      Object.values(v.mapping).some((x) => x !== '' && !/^h_[a-f0-9]{16}$/.test(x)) ||
      !Array.isArray(v.columns) ||
      v.columns.length > 128 ||
      v.columns.some(
        (c) =>
          !keys(c, ['id', 'label', 'type']) ||
          !/^h_[a-f0-9]{16}$/.test(c.id) ||
          !text(c.label, 256) ||
          !['text', 'number', 'date', 'mixed'].includes(c.type),
      ) ||
      !text(v.schema, 64) ||
      typeof v.confirmed !== 'boolean' ||
      !['events', 'units'].includes(v.unit) ||
      !Number.isInteger(v.cutoff) ||
      v.cutoff < 0 ||
      v.cutoff > 23 ||
      typeof v.auto !== 'boolean' ||
      typeof v.dateFromFilename !== 'boolean' ||
      !Array.isArray(v.uniqueColumns) ||
      v.uniqueColumns.length > 8 ||
      v.uniqueColumns.some((x) => !/^h_[a-f0-9]{16}$/.test(x)) ||
      !['replace_dates', 'append'].includes(v.updateMode) ||
      !['rows', 'daily_complete'].includes(v.coverage) ||
      !['auto', 'ymd', 'mdy', 'dmy', 'excel'].includes(v.dateFormat)
    )
      fail();
    const allowed = new Set(v.columns.map((c) => c.id));
    const conflicts = mappingConflicts(v.mapping);
    if (conflicts.length) {
      const detail = conflicts.map(([id, assigned]) =>
        '原表列「' + (v.columns.find(c => c.id === id)?.label || id) + '」同时选给了' + assigned.map(r => '「' + labels[r] + '」').join('、'));
      throw Error(detail.join('；') + '。同一列只能对应一个业务字段，请修改重复选择。');
    }
    if (
      new Set(v.columns.map((c) => c.id)).size !== v.columns.length ||
      Object.values(v.mapping).some((x) => x && !allowed.has(x)) ||
      v.uniqueColumns.some((x) => !allowed.has(x))
    )
      fail();
    if (
      v.confirmed &&
      ((!v.mapping.date && !v.dateFromFilename) ||
        (v.kind === 'defects' && !v.mapping.defect) ||
        (v.kind === 'production' &&
          (!v.mapping.quantity || !v.mapping.process || !v.mapping.shift)))
    )
      fail();
    const out = structuredClone(v);
    if (v.productionBinding !== undefined) {
      if (v.kind !== 'production') fail();
      out.productionBinding = productionBinding(v.productionBinding);
    }
    return out;
  }
  // A named export-column mapping: which source column fills each of the 25
  // fixed template headers. Empty string means "leave this template column
  // blank". sourceId links the map to the data source it was designed for.
  const TEMPLATE_HEADERS = Object.freeze([
    '容器号', '数量', '状态', '工单', '报告人', '产品', '产品平台', '报告时间', '报告说明',
    '报告异常代码', '产线', '工序', '判定人', '判定异常代码', '报废原因', '判定类型', '判定时间',
    '判定说明', '责任人', '责任工序', '判定原因', '异常原因分类', '处理意见', '报废类型', '工位',
  ]);
  function templateMap(v) {
    if (!keys(v, ['id', 'name', 'sourceId', 'columns'])) fail();
    if (!id(v.id) || !text(v.name, 80) || !v.name.trim() || !text(v.sourceId, 64) || !object(v.columns))
      fail();
    if (Object.keys(v.columns).length > TEMPLATE_HEADERS.length) fail();
    for (const [header, columnId] of Object.entries(v.columns)) {
      if (!TEMPLATE_HEADERS.includes(header) ||
          (columnId !== '' && !/^h_[a-f0-9]{16}$/.test(columnId)))
        fail();
    }
    return structuredClone(v);
  }

  function exportLayout(v, selectedSource) {
    const fields = new Set(['date', 'quantity', ...selectedSource.columns.map((c) => c.id)]);
    if (
      !keys(v, ['columns', 'groupBy']) ||
      !fields.has(v.groupBy) ||
      !Array.isArray(v.columns) ||
      !v.columns.length ||
      v.columns.length > 256
    ) throw Error('请选择有效的汇总字段和至少一列导出表头。');
    const used = new Set(), titles = new Set();
    for (const c of v.columns) {
      if (!keys(c, ['field', 'title']) || !fields.has(c.field) || !text(c.title, 120) || !c.title.trim())
        throw Error('导出列已变更或表头为空，请重新选择。');
      const title = c.title.trim().toLowerCase();
      if (used.has(c.field) || titles.has(title)) throw Error('导出字段和表头名称不能重复。');
      used.add(c.field);
      titles.add(title);
    }
    return { groupBy: v.groupBy, columns: v.columns.map((c) => ({ field: c.field, title: c.title.trim() })) };
  }
  function validate(v) {
    if (
      !keys(v, [
        'version',
        'sources',
        'activeSource',
        'productionSource',
        'tab',
        'views',
        'report',
        'templateMaps',
        'activeTemplateMap',
        'sharedAnalysis',
        'quickExports',
        'dailyReports',
      ]) ||
      v.version !== 1 ||
      !Array.isArray(v.sources) ||
      v.sources.length > 12 ||
      !text(v.activeSource, 64) ||
      !text(v.productionSource, 64) ||
      ![...periods, 'sources', 'report'].includes(v.tab) ||
      !object(v.views)
    )
      fail();
    const out = structuredClone(v);
    out.sources = v.sources.map(source);
    const ids = new Set(out.sources.map((x) => x.id));
    // Older configs have no templateMaps; fill it in so callers can rely on it.
    const maps = v.templateMaps === undefined ? [] : v.templateMaps;
    if (!Array.isArray(maps) || maps.length > 24) fail();
    out.templateMaps = maps.map(templateMap);
    if (new Set(out.templateMaps.map((m) => m.id)).size !== out.templateMaps.length ||
        out.templateMaps.some((m) => !ids.has(m.sourceId)))
      fail();
    out.activeTemplateMap = v.activeTemplateMap === undefined ? '' : v.activeTemplateMap;
    if (typeof out.activeTemplateMap !== 'string' || out.activeTemplateMap.length > 64 ||
        (out.activeTemplateMap && !out.templateMaps.some((m) => m.id === out.activeTemplateMap)))
      fail();
    if (
      ids.size !== out.sources.length ||
      (v.activeSource &&
        !out.sources.some((x) => x.id === v.activeSource && x.kind === 'defects')) ||
      (v.productionSource &&
        !out.sources.some((x) => x.id === v.productionSource && x.kind === 'production'))
    )
      fail();
    for (const [key, views] of Object.entries(v.views)) {
      if (!ids.has(key) || !keys(views, periods)) fail();
      for (const row of Object.values(views)) query(row);
    }
    out.quickExports = {};
    if (v.quickExports !== undefined) {
      if (!object(v.quickExports) || Object.keys(v.quickExports).length > 12) fail();
      for (const [key, layout] of Object.entries(v.quickExports)) {
        const match = out.sources.find((s) => s.id === key && s.kind === 'defects');
        if (!match) fail();
        out.quickExports[key] = exportLayout(layout, match);
      }
    }
    out.dailyReports = {};
    if (v.dailyReports !== undefined) {
      if (!object(v.dailyReports) || Object.keys(v.dailyReports).length > 12) fail();
      for (const [sourceId, settings] of Object.entries(v.dailyReports)) {
        if (!out.sources.some((s) => s.id === sourceId && s.kind === 'defects') ||
            !keys(settings, Object.keys(dailyReportDefaults()))) fail();
        const setting = { ...dailyReportDefaults(), ...settings };
        if (typeof setting.includeRate !== 'boolean' || !text(setting.productionId, 64) ||
            (setting.productionId && !out.sources.some((s) => s.id === setting.productionId && s.kind === 'production')) ||
            !text(setting.rateTitle, 160) || !setting.rateTitle.trim() || !periods.includes(setting.period) ||
            !['same-scope', 'selected-defects'].includes(setting.rateBasis) ||
            !['bound', 'manual'].includes(setting.productionMode) ||
            !['original', 'readable', 'hidden', 'reason-columns'].includes(setting.chartLayout) ||
            !text(setting.templatePath, 4096) ||
            (setting.templatePath && !/\.xlsx$/i.test(setting.templatePath))) fail();
        if (Object.hasOwn(settings, 'manualProduction')) {
          setting.manualProduction = validateManualProduction(settings.manualProduction);
        } else delete setting.manualProduction;
        if (Object.hasOwn(settings, 'reasonGroups')) {
          setting.reasonGroups = validateReasonGroups(settings.reasonGroups);
        } else delete setting.reasonGroups;
        if (Object.hasOwn(settings, 'reasonColumn')) {
          const source = out.sources.find((s) => s.id === sourceId);
          if (!text(setting.reasonColumn, 128) || (setting.reasonColumn &&
              !source.columns.some((c) => c.id === setting.reasonColumn))) fail();
        } else delete setting.reasonColumn;
        if (Object.hasOwn(settings, 'sheetReasons')) {
          if (setting.sheetReasons !== null && (!Array.isArray(setting.sheetReasons) ||
              !setting.sheetReasons.length || setting.sheetReasons.length > 200 ||
              setting.sheetReasons.some((value) => !text(value, 512) || !value.trim()) ||
              new Set(setting.sheetReasons).size !== setting.sheetReasons.length)) fail();
        } else delete setting.sheetReasons;
        if (Object.hasOwn(settings, 'dailyTitle')) {
          if (!text(setting.dailyTitle, 80) || /[\r\n\t]/.test(setting.dailyTitle)) fail();
          setting.dailyTitle = setting.dailyTitle.trim();
        } else delete setting.dailyTitle;
        if (Object.hasOwn(settings, 'rateKeywords')) {
          setting.rateKeywords = validateRateKeywords(settings.rateKeywords);
        } else delete setting.rateKeywords;
        // A read of older settings must not rewrite them in a newer format.
        if (!Object.hasOwn(settings, 'productionMode')) delete setting.productionMode;
        if (!Object.hasOwn(settings, 'chartLayout')) delete setting.chartLayout;
        out.dailyReports[sourceId] = setting;
      }
    }
    out.sharedAnalysis = null;
    if (v.sharedAnalysis != null) {
      const shared = v.sharedAnalysis;
      if (!keys(shared, ['sourceId', 'period', 'query']) ||
          !out.sources.some((s) => s.id === shared.sourceId && s.kind === 'defects') ||
          !periods.includes(shared.period)) fail();
      out.sharedAnalysis = { ...shared, query: query(shared.query) };
    }
    const r = v.report;
    if (
      !keys(r, ['title', 'singlePage', 'margin', 'gap', 'titleSize', 'charts']) ||
      !text(r.title, 160) ||
      typeof r.singlePage !== 'boolean' ||
      !Number.isFinite(r.margin) ||
      r.margin < 5 ||
      r.margin > 20 ||
      !Number.isFinite(r.gap) ||
      r.gap < 2 ||
      r.gap > 12 ||
      !Number.isFinite(r.titleSize) ||
      r.titleSize < 14 ||
      r.titleSize > 36 ||
      !Array.isArray(r.charts) ||
      r.charts.length > 24
    )
      fail();
    for (const chart of r.charts)
      if (
        !keys(chart, [
          'id',
          'sourceId',
          'productionId',
          'period',
          'query',
          'title',
          'type',
          'dimension',
          'metric',
          'defect',
        ]) ||
        !id(chart.id) ||
        !ids.has(chart.sourceId) ||
        (chart.productionId && !ids.has(chart.productionId)) ||
        !periods.includes(chart.period) ||
        !text(chart.title, 160) ||
        !types.includes(chart.type) ||
        !(dimensions.includes(chart.dimension) || /^h_[a-f0-9]{16}$/.test(chart.dimension)) ||
        !['quantity', 'rows', 'rate'].includes(chart.metric) ||
        !text(chart.defect, 512) ||
        !query(chart.query)
      )
        fail();
    if (new Set(r.charts.map((c) => c.id)).size !== r.charts.length) fail();
    return out;
  }
  function freshSource(kind = 'defects', value = 'source') {
    return {
      id: value,
      name: kind === 'production' ? '产量数据' : 'BI不良数据',
      kind,
      folder: '',
      sheet: '',
      headerRow: 0,
      mapping: {},
      columns: [],
      schema: '',
      confirmed: false,
      unit: 'events',
      cutoff: 0,
      auto: false,
      dateFromFilename: false,
      uniqueColumns: [],
      updateMode: 'replace_dates',
      coverage: 'rows',
      dateFormat: 'auto',
    };
  }
  function currentView(state, period = state.tab) {
    return structuredClone(state.views[state.activeSource]?.[period] || viewDefaults(period));
  }
  function reconcileMapping(previous, inspection) {
    const valid = new Set(inspection.columns.map((c) => c.id)),
      mapping = {},
      used = new Set();
    for (const [role, id] of Object.entries(previous.mapping || {}))
      if (id && valid.has(id)) {
        mapping[role] = id;
        used.add(id);
      }
    for (const [role, id] of Object.entries(inspection.mapping || {}))
      if (
        !mapping[role] &&
        valid.has(id) &&
        !used.has(id) &&
        !(role === 'date' && previous.dateFromFilename && !previous.mapping?.date)
      ) {
        mapping[role] = id;
        used.add(id);
      }
    return mapping;
  }
  return Object.freeze({
    reconcileMapping,
    mappingConflicts,
    defaults,
    validate,
    source,
    query,
    freshSource,
    currentView,
    viewDefaults,
    periods,
    roles,
    dimensions,
    types,
    labels,
    operators,
    templateHeaders: TEMPLATE_HEADERS,
    exportLayout,
    dailyReport,
    defaultRateKeywords,
    validateReasonGroups,
  });
});
