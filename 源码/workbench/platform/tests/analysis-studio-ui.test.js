'use strict';
// DOM model checks event wiring and state, not actual Windows visual rendering.
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm');
const M = require('../domain/analysis-studio'),
  C = require('../domain/analysis-calendar'),
  P = require('../domain/analysis-panels'),
  A = require('../domain/a4-report'),
  createClient = require('../desktop/app/module-state-client');
function harness(t, options = {}) {
  class Node {
    constructor(tag) {
      this.tagName = tag;
      this.children = [];
      this._text = '';
      this.classList = { toggle() {} };
      this.value = '';
      this.checked = false;
    }
    set textContent(v) {
      this._text = String(v);
      this.children = [];
    }
    get textContent() {
      return this._text + this.children.map((c) => c.textContent).join('');
    }
    append(...nodes) {
      for (const n of nodes) {
        n.parent = this;
        this.children.push(n);
      }
    }
    replaceChildren(...nodes) {
      this.children.forEach((c) => (c.parent = null));
      this.children = [];
      this._text = '';
      this.append(...nodes);
    }
    setAttribute(key, v) {
      this[key] = v;
    }
    removeAttribute(key) {
      delete this[key];
    }
    add(n) {
      this.append(n);
    }
    get lastChild() {
      return this.children.at(-1);
    }
    get isConnected() {
      return this === root || !!this.parent?.isConnected;
    }
    showModal() {
      this.open = true;
    }
    close() {
      this.open = false;
      this.onclose?.();
    }
    remove() {
      if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
      this.parent = null;
    }
    focus() {}
    set innerHTML(v) {
      this.markup = v;
    }
  }
  const root = new Node('div');
  root.id = 'analysisStudioRoot';
  const all = () => {
    const walk = (n) => [n, ...n.children.flatMap(walk)];
    return walk(root);
  };
  const document = {
    createElement: (tag) => new Node(tag),
    getElementById: (id) => all().find((n) => n.id === id),
  };
  class Option extends Node {
    constructor(label, value) {
      super('option');
      this.textContent = label;
      this.value = value;
    }
  }
  let config = M.defaults(),
    calendar = C.defaults(),
    calendarDraft = { sourceId: '', rule: null },
    draft = null;
  const source = M.freshSource('defects', 'bi');
  source.columns = [{ id: 'h_0000000000000001', label: '不良项', type: 'text' }];
  source.columns.push({ id: 'h_0000000000000002', label: '日期', type: 'date' });
  if (options.breakdown) {
    source.columns.push({ id: 'h_0000000000000003', label: '工序', type: 'text' });
    source.mapping.process = 'h_0000000000000003';
  }
  if (options.importRun) {
    source.confirmed = true;
    source.mapping.date = source.columns[1].id;
    source.mapping.defect = source.columns[0].id;
  }
  if (options.mlightGuide) {
    source.sheet = 'container';
    source.columns.push({ id: 'h_0000000000000010', label: '判定原因', type: 'text' });
  }
  config.sources = [source];
  config.activeSource = 'bi';
  if (options.dailyProduction) {
    source.unit = 'units';
    for (const [id, label] of [['h_0000000000000004', '不良数量'], ['h_0000000000000005', '班次'], ['h_0000000000000006', '责任员工']])
      source.columns.push({ id, label, type: label === '不良数量' ? 'number' : 'text' });
    source.mapping = { ...source.mapping, quantity: 'h_0000000000000004', shift: 'h_0000000000000005', employee: 'h_0000000000000006' };
    const production = M.freshSource('production', 'production');
    production.name = '生产跟踪表';
    production.columns = source.columns.map((column) => ({ ...column }));
    production.mapping = Object.fromEntries(['date', 'process', 'shift', 'quantity'].filter((role) => source.mapping[role]).map((role) => [role, source.mapping[role]]));
    config.sources.push(production);
    if (options.secondProduction) config.sources.push({ ...structuredClone(production), id: 'production-b', name: '另一产量表' });
    config.dailyReports.bi = { ...M.dailyReport(config, 'bi'), productionId: 'production' };
  }
  if (options.templateMaps) {
    config.templateMaps = options.templateMaps;
    config.activeTemplateMap = options.templateMaps[0]?.id || '';
  }
  if (options.dailySettings)
    config.dailyReports.bi = { ...M.dailyReport(config, 'bi'), ...structuredClone(options.dailySettings) };
  let panelState = P.defaults(config),
    panelSignature = 'initial';
  if (options.badField)
    panelState.sources.bi.schemes[0].periods.day.query.dimension = { column: 'Missing field' };
  const calls = [],
    saved = [];
  let guideInspectAttempt = 0, templateAttempt = 0;
  async function api(method, body) {
    calls.push({ method, body: structuredClone(body) });
    if (method === 'readModuleState')
      return {
        data:
          body.module === 'analysis-calendar'
            ? structuredClone(body.scope === 'draft' ? calendarDraft : calendar)
            : body.module === 'analysis-studio'
              ? structuredClone(config)
              : { source: draft },
        revision: 1,
        corrupt: false,
      };
    if (method === 'saveModuleState') {
      if (options.failSave) throw Error('合成保存失败');
      if (body.address.module === 'analysis-calendar') {
        if (body.address.scope === 'draft') calendarDraft = C.draft(body.data);
        else calendar = C.validate(body.data);
      } else if (body.address.module === 'analysis-studio') config = M.validate(body.data);
      else draft = structuredClone(body.data.source);
      saved.push(body);
      return { data: body.data, revision: body.expectedRevision + 1 };
    }
    if (method === 'analysisStudio') {
      if (body.action === 'panelsLoad')
        return {
          state: structuredClone(panelState),
          signature: panelSignature,
          file: '合成配置.json',
          writable: true,
          persisted: true,
        };
      if (body.action === 'panelsSave') {
        if (options.failPanelsSave) throw Error('合成板块保存失败');
        assert.equal(body.signature, panelSignature);
        panelState = P.validate(body.panelState);
        panelState.revision++;
        panelSignature = 'revision-' + panelState.revision;
        return {
          state: structuredClone(panelState),
          signature: panelSignature,
          file: '合成配置.json',
          writable: true,
          persisted: true,
        };
      }
      if (body.action === 'panelsExport') return { shared: true, file: '合成分享.json' };
      if (body.action === 'scan' && options.importRun)
        return { files: [{ name: '已就绪.xlsx', status: '待核对' }, { name: '占用.xlsx', status: '待核对' }] };
      if (body.action === 'import' && options.importRun)
        return body.names
          ? { importedRows: 2, files: [{ name: '占用.xlsx', status: '已导入', rows: 2 }] }
          : { importedRows: 4, files: [
              { name: '已就绪.xlsx', status: '已导入', rows: 4 },
              {
                name: '占用.xlsx', status: '未导入',
                error: '关闭后重试', rows: 0,
              },
            ] };
      if (options.importHistory && body.action === 'importHistory')
        return { sourceId: body.sourceId, revision: options.importHistory.withdrawn ? 2 : 1,
          offset: 0, total: 1, more: false, batches: [{
            batchId: 'session-batch-1', name: '合成误导入.csv', created: '2026-11-19T01:00:00Z',
            rowCount: 2, visibleRows: options.importHistory.withdrawn ? 0 : 2,
            status: options.importHistory.withdrawn ? '已撤销' : '已导入',
            canChange: true, legacy: false, withdrawn: !!options.importHistory.withdrawn,
          }] };
      if (options.importHistory && body.action === 'setImportBatch') {
        options.importHistory.withdrawn = !body.enabled;
        return { changed: true, message: body.enabled ? '已恢复该导入批次。' : '已撤销该导入批次。' };
      }
      if (body.action === 'inspect' && options.inspect) {
        if (options.liveGuide && guideInspectAttempt++ === 0) throw Error('文件被 Excel 占用');
        return structuredClone(options.inspect);
      }
      if (body.action === 'analyze') {
        if (options.emptyMain && body.query.dimension === 'employee')
          return { empty: true, message: '公共条件无数据' };
        if (options.waitAnalyze) await options.waitAnalyze();
        return {
          empty: false,
          sourceId: 'bi',
          revision: 1,
          ...(options.breakdown
            ? {
                breakdown: {
                  groups: [
                    {
                      key: '装管',
                      quantity: 5,
                      rows: 1,
                      previous: null,
                      change: null,
                      issueCount: 1,
                      issues: [{ key: '装管反', quantity: 5, rows: 1, share: 1 }],
                    },
                  ],
                  totalGroups: 1,
                },
              }
            : {}),
          range: { start: '2026-09-19', end: '2026-09-20' },
          query: body.query,
          period: body.period,
          columns: source.columns,
          quantity: 5,
          metricLabel: '不良数量',
          recordCount: 2,
          canExportOriginalReport: Boolean(options.originalTemplate || body.templateMap),
          production: null,
          rate: { value: null, reason: '未选择产量数据源' },
          warnings: ['未选择产量数据源'],
          comparison: { change: null },
          categoryCount: 2,
          defects: [
            { label: '装管反', quantity: 2 },
            { label: '断裂', quantity: 3 },
            ...(options.blankChart ? [{ label: '', quantity: 1 }] : []),
          ],
          trend: [
            { label: '09-19', quantity: 2, rate: null },
            { label: '09-20', quantity: 3, rate: null },
          ],
          points: [{ label: '张三', quantity: 5, rate: null }],
          details: options.breakdown
            ? [{ file: 'BI.xlsx', row: 42, date: '2026-09-19', quantity: 5, values: {} }]
            : [],
          page: 1,
          pages: 1,
          pageSize: 50,
        };
      }
      if (body.action === 'facets') {
        const values = [
          { label: '装管反', value: '装管反', count: 1 },
          { label: '断裂', value: '断裂', count: 1 },
          ...(options.mlightGuide ? [{ label: 'CN_MPO_装管反', value: 'CN_MPO_装管反', count: 1 }] : []),
        ].filter(({ label }) => label.includes(body.search || ''));
        return {
          values,
          total: values.length,
          rowCount: values.reduce((sum, value) => sum + value.count, 0),
          more: false,
        };
      }
      if (body.action === 'reportData')
        return {
          title: '合成报告',
          revision: 1,
          signature: 'test',
          charts: config.report.charts.map((c) => ({
            id: c.id,
            title: c.title,
            type: c.type,
            metric: c.metric,
            data: [{ label: '张三', value: 5 }],
          })),
        };
      if (body.action === 'previewDailyRate') {
        if (options.previewGate) await options.previewGate();
        return options.ratePreview || {
        title: '每日不良率趋势', scope: '按已绑定产量核算',
        trend: [{ label: '11-01', quantity: 2, production: 100, rate: .02, rateReason: '' },
          { label: '11-02', quantity: 3, production: 100, rate: .03, rateReason: '' },
          { label: '11-03', quantity: 3, production: null, rate: null, rateReason: '产量待补充' },
          { label: '11-04', quantity: 1, production: 100, rate: .01, rateReason: '' }],
        };
      }
      if (body.action === 'dailyProductionCohorts')
        return { cohorts: structuredClone(options.dailyCohorts || []) };
      if (body.action === 'pick') return options.liveGuide
        ? { folder: 'C:/导入实操测试' }
        : { cancelled: true };
      if (body.action === 'export' && options.liveGuide) return { cancelled: false };
      if (body.action === 'exportQuickReport') return { recordCount: 2, fileName: '测试目标表.xlsx' };
      if (body.action === 'chooseOriginalTemplate' && options.pickedReport) return structuredClone(options.pickedReport);
      if (body.action === 'chooseOriginalTemplate' && options.templateGuide) {
        templateAttempt++;
        if (templateAttempt === 1) return { cancelled: true };
        if (templateAttempt === 2) throw Error('模板工作表或表头与原始异常品查询工作簿不符。');
        return { fileName: '目标模板.xlsx', sheets: ['总表', '物料穿错-穿反', '并反', '装管反', 'PIN堵', '内断'],
          templateToken: 'template-test' };
      }
      if (body.action === 'exportOriginalReport')
        return options.originalExportResult || {
          recordCount: 2, groups: { 装管反: 1 }, uncategorized: 1,
          fileName: '导出结果.xlsx', sheets: ['总表', '物料穿错-穿反', '并反', '装管反', 'PIN堵', '内断'],
        };
      return { cancelled: true };
    }
    throw Error('unexpected ' + method);
  }
  const context = {
    window: {
      AnalysisStudio: M,
      BIFieldLabels: require('../desktop/app/bi-field-labels'),
      AnalysisCalendar: C,
      AnalysisPanels: P,
      A4Report: A,
      createModuleStateClient: createClient,
    },
    document,
    Option,
    structuredClone,
    crypto: require('node:crypto'),
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    console,
  };
  vm.createContext(context);
  for (const name of ['analysis-source-ui.js', 'analysis-panels-ui.js', 'daily-report-ui.js', 'analysis-studio-ui.js'])
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../desktop/app', name), 'utf8'), context);
  const ui = context.window.createAnalysisStudioUI({
    api,
    unlocked: () => true,
    renderTools: () => {
      const tools = new Node('div');
      tools.className = 'test-bi-tools';
      return tools;
    },
  });
  t.after(() => {
    ui.deactivate();
    ui.clear();
  });
  const button = (text) => {
    const n = all().find((n) => n.tagName === 'button' && n.textContent === text);
    assert.ok(n, 'missing button ' + text);
    return n;
  };
  return {
    ui,
    all,
    calls,
    saved,
    button,
    config: () => config,
    calendar: () => calendar,
    panelState: () => panelState,
    draft: () => draft,
    root,
    async click(text) {
      return button(text).onclick();
    },
  };
}
test('daily report settings remember rate options and preview the applied query with percentage labels', async (t) => {
  const h = harness(t, { dailyProduction: true, originalTemplate: true });
  await h.ui.openTab('day');
  const applied = h.calls.filter((x) => x.body?.action === 'analyze').at(-1).body;
  await h.click('每日导表配置');
  assert(h.root.textContent.includes('表头与目标模板'));
  assert(h.button('配置原表对应列'));
  const checkbox = h.all().find((node) => node.tagName === 'input' && node.type === 'checkbox' && node.parent.textContent.includes('附加不良率'));
  checkbox.checked = true;
  await checkbox.onchange();
  await h.ui.flush();
  assert.equal(h.config().dailyReports.bi.includeRate, true);
  assert.equal(h.config().dailyReports.bi.productionId, 'production');
  assert.equal(h.config().productionSource, '', 'daily export binding does not replace the homepage analysis denominator');
  await h.click('核对不良率数据与折线图');
  const preview = h.calls.find((x) => x.body?.action === 'previewDailyRate').body;
  assert.deepEqual(preview.query.filters, applied.query.filters);
  assert.equal(preview.query.start, '2026-09-19');
  assert(h.root.textContent.includes('2.00%'));
  assert(h.root.textContent.includes('产量待补充'));
  await h.click('完成配置');
  await h.click('每日导表配置');
  assert(h.all().some((node) => node.type === 'checkbox' && node.checked));
});

test('daily report titles and keyword groups save without replacing exact groups or production rules', async (t) => {
  const original = {
    chartLayout: 'reason-columns', includeRate: true,
    reasonGroups: [{ name: '已选分表', reasons: ['CN_MPO_并纤反'] }],
    manualProduction: [{ date: '2026-09-19', process: '装管', shift: '白班', quantity: 180 }],
  };
  const h = harness(t, { dailyProduction: true, originalTemplate: true, dailySettings: original });
  await h.ui.openTab('day');
  await h.click('每日导表配置');
  const detail = () => h.all().find((node) => node.className === 'lab-daily-keywords');
  const editField = (label, value) => {
    const input = h.all().find((node) => node['aria-label'] === label ||
      (node.tagName === 'input' && node.parent._text === label));
    assert(input, label);
    input.value = value;
    input.oninput();
  };
  assert.equal(detail().open, false);
  detail().open = true;
  detail().ontoggle();
  assert.match(detail().textContent, /07:00.*使用示例报表的默认项目/);
  await h.click('编辑日报标题与关键词');
  if (M.defaultRateKeywords?.().length) {
    await h.click('载入示例项目');
    assert.equal(h.all().filter((node) => /^项目名称（规则 /.test(node['aria-label'] || '')).length,
      M.defaultRateKeywords().length);
    await h.click('改用默认项目');
  }
  editField('日报标题后缀', '装管人员对照');
  await h.click('添加项目规则');
  editField('项目名称（规则 1）', 'MPO并纤反');
  editField('关键词（规则 1）', 'MPO "并纤 反"');
  await h.click('添加项目规则');
  editField('项目名称（规则 2）', 'MPO并纤反');
  editField('关键词（规则 2）', 'MMC "错码');
  await h.click('保存日报标题与关键词');
  assert.match(detail().textContent, /第 2 行：请为带空格的关键词配对使用双引号/);
  await h.click('导出每日目标 Excel');
  await h.click('核对不良率数据与折线图');
  assert(!h.calls.some(({ body }) => ['exportOriginalReport', 'previewDailyRate'].includes(body?.action)));
  editField('关键词（规则 2）', 'MPO 并反');
  await h.click('保存日报标题与关键词');
  const asSaved = h.config().dailyReports.bi;
  assert.equal(asSaved.dailyTitle, '装管人员对照');
  assert.deepEqual(asSaved.rateKeywords, [
    { label: 'MPO并纤反', keywords: ['MPO', '并纤 反'] },
    { label: 'MPO并纤反', keywords: ['MPO', '并反'] },
  ]);
  assert.deepEqual(asSaved.reasonGroups, original.reasonGroups);
  assert.deepEqual(asSaved.manualProduction, original.manualProduction);
  assert.equal(asSaved.productionId, 'production');
  await h.click('完成配置');
  await h.click('每日导表配置');
  assert.equal(detail().open, false);
  detail().open = true;
  detail().ontoggle();
  assert.match(detail().textContent, /装管人员对照.*自定义 2 条规则/);
  await h.click('编辑日报标题与关键词');
  const remove = h.all().find((node) => node['aria-label'] === '移除第 2 条项目规则');
  await remove.onclick();
  assert(!h.all().some((node) => node['aria-label'] === '项目名称（规则 2）'));
  await h.click('取消关键词编辑');
  assert.deepEqual(h.config().dailyReports.bi.rateKeywords, asSaved.rateKeywords);
  await h.click('导出每日目标 Excel');
  assert(h.calls.some(({ body }) => body?.action === 'exportOriginalReport'));
});

test('decision-reason report previews missing production without enabling automatic fill', async (t) => {
  const scope = '判定时间按 07:00 划分业务日；产量未填写，可在导出的 Excel 中填写。';
  const h = harness(t, { originalTemplate: true,
    dailySettings: { chartLayout: 'reason-columns', includeRate: false },
    ratePreview: { title: '日报不良率', scope, trend: [
      { label: '2026-09-19', quantity: 2, production: null, rate: null, rateReason: '产量未填写' },
      { label: '2026-09-20', quantity: 3, production: null, rate: null, rateReason: '产量未填写' },
    ] },
  });
  await h.ui.openTab('day');
  const query = h.calls.findLast(({ body }) => body?.action === 'analyze').body.query;
  await h.click('每日导表配置');
  assert.equal(h.config().dailyReports.bi?.includeRate, false);
  assert(!h.all().some((node) => node.tagName === 'select' && node.parent._text === '折线图汇总周期'));
  await h.click('核对不良率数据与折线图');
  const request = h.calls.findLast(({ body }) => body?.action === 'previewDailyRate').body;
  assert.deepEqual(request.query.filters, query.filters);
  assert.equal(request.query.start, '2026-09-19');
  const preview = h.all().find((node) => node.id === 'labDailyRatePreview');
  assert.match(preview.textContent, /判定时间按 07:00.*产量未填写/);
  assert.match(preview.textContent, /先核对下方不良数和产量说明/);
  assert(preview.children.some((node) => node.className === 'lab-table-scroll'));
  assert(!preview.textContent.includes('0.00%'), 'missing denominator is never represented as zero');
  const enable = h.all().find((node) => node.type === 'checkbox' && node.parent.textContent.includes('用已确认的产量'));
  enable.checked = true;
  await enable.onchange();
  assert(h.all().some((node) => node.tagName === 'select' && node.parent._text === '自动产量匹配口径'));
  assert(!h.all().some((node) => node.tagName === 'input' && node.parent._text === '折线图标题'));
});

test('daily manual production suggestions remain blank and saved values stay separate from source binding', async (t) => {
  const farDate = { date: '2026-09-18', process: '装管', shift: '白班', quantity: 180 };
  const h = harness(t, {
    dailyProduction: true,
    originalTemplate: true,
    dailySettings: { includeRate: true, manualProduction: [farDate] },
    dailyCohorts: [{ date: '2026-09-20', process: '装管', shift: '晚班', quantity: 5 }],
  });
  await h.ui.openTab('day');
  const applied = h.calls.filter((x) => x.body?.action === 'analyze').at(-1).body;
  await h.click('每日导表配置');
  const mode = h.all().find((n) => n.tagName === 'select' && n.parent._text === '产量录入方式');
  mode.value = 'manual';
  await mode.onchange();
  assert(h.root.textContent.includes('另有 1 行不在当前范围'));
  await h.click('按当前筛选带出日期和班次');
  const request = h.calls.find((x) => x.body?.action === 'dailyProductionCohorts').body;
  assert.deepEqual(request.query.filters, applied.query.filters);
  assert.equal(request.query.end, '2026-09-20');
  const input = h.all().find((n) => n['aria-label'] === '实际产量（第 1 行）');
  assert.equal(input.value, '', 'defect amount must remain a reference');
  await h.click('按当前筛选带出日期和班次');
  assert.equal(h.all().filter((n) => n['aria-label']?.startsWith('实际产量（')).length, 1);
  const edit = h.all().find((n) => n['aria-label'] === '实际产量（第 1 行）');
  edit.value = '120';
  edit.oninput();
  await h.click('导出每日目标 Excel');
  assert.equal(h.calls.some((x) => x.body?.action === 'exportOriginalReport'), false);
  await h.click('保存手填产量');
  assert.deepEqual(h.config().dailyReports.bi.manualProduction, [farDate,
    { date: '2026-09-20', process: '装管', shift: '晚班', quantity: 120 }]);
  assert.equal(h.config().dailyReports.bi.productionId, 'production');
  assert.equal(h.config().productionSource, '');
  const layout = h.all().find((n) => n.tagName === 'select' && n.parent._text === '总表图表排版');
  assert.equal(layout.value, 'readable');
  layout.value = 'hidden';
  await layout.onchange();
  await h.click('导出每日目标 Excel');
  assert.equal(h.calls.some((x) => x.body?.action === 'exportOriginalReport'), true);
  assert.equal(h.config().dailyReports.bi.chartLayout, 'hidden');
});

test('decision-reason column layout remembers the setting and exports the applied reason filter', async (t) => {
  const h = harness(t, {
    mlightGuide: true, originalTemplate: true, importRun: true,
    originalExportResult: { recordCount: 2, chartLayout: 'reason-columns' },
  });
  const filters = [{ field: 'h_0000000000000010', op: 'in', values: ['CN_物料少穿/多穿', 'CN_MPO_装管反'], caseSensitive: false }];
  const query = { ...M.viewDefaults('day'), filters };
  await h.ui.openTab('day', { sourceId: 'bi', query, drill: true });
  await h.click('每日导表配置');
  const layout = () => h.all().find((n) => n.tagName === 'select' && n.parent._text === '总表图表排版');
  assert(layout().children.some((option) => option.value === 'reason-columns' && /按判定原因分表/.test(option.textContent)));
  layout().value = 'reason-columns';
  await layout().onchange();
  assert.match(h.root.textContent, /可把指定原因合到一张分类表/);
  assert.match(h.root.textContent, /每张分类表在总表对应一张完整簇状柱形图，包含全部姓名和独立系列/);
  assert.match(h.root.textContent, /人员日报每组一图/);
  assert.match(h.root.textContent, /总表含不良率折线，图表按横向 A4 排版/);
  await h.click('完成配置');
  await h.click('每日导表配置');
  assert.equal(layout().value, 'reason-columns');
  await h.click('导出每日目标 Excel');
  const request = h.calls.findLast(({ body }) => body.action === 'exportOriginalReport').body;
  assert.deepEqual(request.query.filters, filters);
  assert.equal(h.config().dailyReports.bi.chartLayout, 'reason-columns');
  assert.match(h.root.textContent, /已导出总表 2 条。 已按判定原因分表/);
});

test('daily reason groups use the applied mapped reason column, preserve earlier groups and save exact assignments', async (t) => {
  const rawReasonColumn = 'h_0000000000000010';
  const earlier = { name: '历史分组', reasons: ['旧不良'] };
  const h = harness(t, {
    mlightGuide: true, originalTemplate: true, importRun: true,
    templateMaps: [{ id: 'reason-map', name: '按判定原因',
      sourceId: 'bi', columns: { 判定原因: rawReasonColumn } }],
    dailySettings: { chartLayout: 'reason-columns', reasonGroups: [earlier] },
  });
  const filters = [{ field: rawReasonColumn, op: 'in',
    values: ['CN_MPO_装管反', '断裂'], caseSensitive: false }];
  const query = { ...M.viewDefaults('day'), filters };
  await h.ui.openTab('day', { sourceId: 'bi', query, drill: true });
  await h.click('每日导表配置');
  const details = () => h.all().find((n) => n.className === 'lab-daily-reason-groups');
  assert.equal(details().open, false);
  assert.equal(h.calls.some(({ body }) => body.action === 'facets'), false);
  details().open = true;
  details().ontoggle();
  const button = (label) => h.all().find((n) => n.tagName === 'button' && n['aria-label'] === label);
  const option = (label) => h.all().find((n) => n.className === 'lab-check' && n.textContent === label)?.children[0];

  await button('编辑历史分组').onclick();
  assert.equal(option('旧不良').checked, true);
  await h.click('取消编辑');

  await h.click('添加分组');
  const request = h.calls.findLast(({ body }) => body.action === 'facets').body;
  assert.equal(request.field, rawReasonColumn);
  assert.equal(request.matchOp, 'contains');
  assert.equal(request.query.range, 'custom');
  assert.deepEqual(request.query.filters, filters);
  const name = h.all().find((n) => n._text === '工作表名称').children[0];
  name.value = '装管和断裂';
  name.oninput();
  for (const reason of filters[0].values) {
    const checkbox = option(reason);
    checkbox.checked = true;
    await checkbox.onchange();
  }
  await h.click('导出每日目标 Excel');
  assert.equal(h.calls.some(({ body }) => body.action === 'exportOriginalReport'), false);
  await h.click('保存分组');
  const next = { name: '装管和断裂', reasons: filters[0].values };
  assert.deepEqual(h.config().dailyReports.bi.reasonGroups, [earlier, next]);
  assert.equal(details().open, true);

  await h.click('添加分组');
  assert.equal(option('断裂（已在装管和断裂）').disabled, true);
  assert.equal(option('CN_MPO_装管反（已在装管和断裂）').disabled, true);
  await h.click('取消编辑');
  await button('移除历史分组').onclick();
  await h.click('完成配置');
  await h.click('每日导表配置');
  assert.equal(details().open, false);
  assert.deepEqual(h.config().dailyReports.bi.reasonGroups, [next]);
  await h.click('导出每日目标 Excel');
  assert.deepEqual(h.calls.findLast(({ body }) => body.action === 'exportOriginalReport').body.query.filters, filters);
});

test('daily report manual reason binding and selected reasons persist after reopening the renderer settings', async (t) => {
  const column = 'h_0000000000000001';
  const h = harness(t, { mlightGuide: true, originalTemplate: true, importRun: true,
    dailySettings: { chartLayout: 'reason-columns', sheetReasons: ['CN_MPO_装管反'],
      reasonGroups: [{ name: '旧列分组', reasons: ['CN_MPO_装管反'] }] },
  });
  const filters = [{ field: column, op: 'in', values: ['断裂', '装管反'], caseSensitive: false }];
  await h.ui.openTab('day', { sourceId: 'bi', query: { ...M.viewDefaults('day'), filters }, drill: true });
  await h.click('每日导表配置');
  const bound = () => h.all().find((node) => node.tagName === 'select' && node.parent._text === '判定原因列');
  bound().value = column;
  await bound().onchange();
  await h.click('保存判定原因列');
  assert.equal(h.config().dailyReports.bi.reasonColumn, column);
  assert.equal(h.config().dailyReports.bi.sheetReasons, null);
  assert.deepEqual(h.config().dailyReports.bi.reasonGroups, []);
  await h.click('选择要分表的原因');
  await new Promise(setImmediate);
  const request = h.calls.findLast(({ body }) => body?.action === 'facets').body;
  assert.equal(request.field, column, 'the explicit column overrides the automatic 判定原因 match');
  assert.deepEqual(request.query.filters, filters);
  const option = (label) => h.all().find((node) =>
    node.className === 'lab-check' && node.textContent === label + '（1 条）')?.children[0];
  for (const value of ['断裂', '装管反']) {
    const checkbox = option(value);
    assert(checkbox, value);
    checkbox.checked = true;
    await checkbox.onchange();
  }
  await h.click('保存分表选择');
  assert.deepEqual(h.config().dailyReports.bi.sheetReasons, ['断裂', '装管反']);
  await h.click('完成配置');
  await h.click('每日导表配置');
  assert.equal(bound().value, column);
  assert.match(h.root.textContent, /已指定 2 项分表/);
  await h.click('选择要分表的原因');
  await new Promise(setImmediate);
  assert.equal(option('断裂').checked, true);
  assert.equal(option('装管反').checked, true);
  assert.equal(option('CN_MPO_装管反').checked, false);
  await h.click('取消');
  await h.click('导出每日目标 Excel');
  assert.deepEqual(h.calls.findLast(({ body }) => body?.action === 'exportOriginalReport').body.query.filters, filters);
});

test('choosing an exported workbook in daily settings remembers its format for the selected source', async (t) => {
  const templatePath = 'C:/合成/旧分析报表.xlsx';
  const h = harness(t, { originalTemplate: true,
    pickedReport: { layoutOnly: true, fileName: '旧分析报表.xlsx', templatePath } });
  await h.ui.openTab('day');
  await h.click('每日导表配置');
  await h.click('选择目标模板');
  assert.equal(h.config().dailyReports.bi.templatePath, templatePath);
  assert.equal(h.config().dailyReports.bi.chartLayout, 'reason-columns');
  assert.match(h.root.textContent, /已记住模板：旧分析报表.xlsx/);
  await h.click('完成配置');
  await h.click('每日导表配置');
  const layout = h.all().find((n) => n.tagName === 'select' && n.parent._text === '总表图表排版');
  assert.equal(layout.value, 'reason-columns');
});

test('manual production reports duplicate rows and retains draft on closing', async (t) => {
  const h = harness(t, { originalTemplate: true, dailySettings: {
    productionMode: 'manual',
    manualProduction: [{ date: '2026-09-20', process: '装管', shift: '晚班', quantity: 12 }],
  } });
  await h.ui.openTab('day');
  await h.click('每日导表配置');
  await h.click('添加一行');
  for (const [label, value] of [['工序', '装管'], ['班次', '晚班'], ['实际产量', '0']]) {
    const input = h.all().find((n) => n['aria-label'] === `${label}（第 2 行）`);
    input.value = value;
    input.oninput();
  }
  await h.click('保存手填产量');
  assert(h.root.textContent.includes('重复，请合并为一行'));
  assert.equal(h.config().dailyReports.bi.manualProduction.length, 1);
  await h.click('完成配置');
  assert(h.root.textContent.includes('请先保存手填产量'));
  const remove = h.all().find((n) => n['aria-label'] === '移除第 1 行手填产量');
  await remove.onclick();
  await h.click('保存手填产量');
  assert.equal(h.config().dailyReports.bi.manualProduction[0].quantity, 0);
  await h.click('完成配置');
  assert.equal(h.all().some((n) => n.tagName === 'dialog'), false);
});

test('export mapping presents actual template header names and isolates schemes to the source', async (t) => {
  const h = harness(t);
  await h.ui.openTab('day');
  await h.click('配置导出列映射');
  assert(h.all().some((node) => node.tagName === 'td' && node.textContent === '判定原因'));
  assert(h.root.textContent.includes('当前数据源的列'));
});

test('daily rate preview discards a response after its settings change', async (t) => {
  let release, started;
  const pending = new Promise((resolve) => { release = resolve; });
  const entered = new Promise((resolve) => { started = resolve; });
  const h = harness(t, { dailyProduction: true, originalTemplate: true,
    previewGate: async () => { started(); await pending; } });
  await h.ui.openTab('day');
  await h.click('每日导表配置');
  const enable = h.all().find((n) => n.type === 'checkbox' && n.parent.textContent.includes('附加不良率'));
  enable.checked = true;
  await enable.onchange();
  const task = h.click('核对不良率数据与折线图');
  await entered;
  const title = h.all().find((n) => n.tagName === 'input' && n.parent.textContent.includes('折线图标题'));
  title.value = '修改后的标题';
  await title.onchange();
  release();
  await task;
  assert.equal(h.all().find((n) => n.id === 'labDailyRatePreview').textContent, '');
  assert(h.root.textContent.includes('配置已改变，请重新核对'));
});

test('switching production sources cancels a pending daily-only binding', async (t) => {
  const h = harness(t, { dailyProduction: true, secondProduction: true, importRun: true, breakdown: true });
  await h.ui.openTab('day');
  await h.click('每日导表配置');
  await h.click('核对产量表头与数值');
  await h.click('另一产量表 · 产量');
  const confirm = h.all().find((n) => n.type === 'checkbox' && n.parent.textContent.includes('已核对字段'));
  confirm.checked = true;
  await confirm.onchange();
  await h.click('确认映射并保存来源');
  await h.ui.flush();
  assert.equal(h.config().dailyReports.bi.productionId, 'production');
  assert.equal(h.config().productionSource, 'production-b');
});

test('BI homepage shortcuts open source/report tabs directly and keep period navigation valid', async (t) => {
  const h = harness(t);
  await h.ui.openTab('sources');
  assert.equal(h.button('数据源与导入')['aria-current'], 'true');
  const bar = h.all().find((n) => n.className === 'lab-workbench-bar');
  assert.equal(bar.children[1].className, 'test-bi-tools');
  await h.ui.flush();
  assert.equal(h.config().tab, 'sources');
  assert.equal(
    h.calls.filter((x) => x.body?.action === 'analyze').length,
    0,
    'opening import must not first analyze the previous tab',
  );
  await h.ui.openTab('report');
  await h.ui.flush();
  assert.equal(h.config().tab, 'report');
  await h.ui.openTab('analysis');
  await h.ui.flush();
  assert(['day', 'week', 'month'].includes(h.config().tab));
  assert(h.calls.some((x) => x.body?.action === 'analyze'));
  await h.click('每周');
  await h.click('横向A4报告');
  await h.click('分析与筛选');
  await h.ui.flush();
  assert.equal(h.config().tab, 'week');
  assert.equal(h.button('每周')['aria-current'], 'true');
  assert.equal(h.button('重试保存').hidden, true);
  assert.equal(h.all().find((n) => n.id === 'labSaveFeedback').hidden, true);
  assert.equal(
    h.all().find((n) => n.tagName === 'details' && n.children[0]?._text === '详细配置').open,
    false,
  );
});

test('live import guide follows actual controls, waits on errors, and finishes after export', async (t) => {
  const columns = [
    { id: 'h_0000000000000001', label: '报告异常代码', type: 'text' },
    { id: 'h_0000000000000002', label: '报告时间', type: 'date' },
  ];
  const h = harness(t, { liveGuide: true, importRun: true, inspect: {
    name: '测试.xlsx', sheet: 'container', sheets: ['container'], headerRow: 1, rowCount: 2,
    schema: 'guide', confidence: {}, preview: [], columns,
    mapping: { defect: columns[0].id, date: columns[1].id },
  } });
  await h.ui.activate();
  await h.ui.openTab('sources');
  const target = (step, text) => {
    const nodes = h.all().filter((node) => node['data-import-guide-target'] === step);
    assert(nodes.length, `missing guide target for ${step}`);
    if (text) assert(nodes.some((node) => node.textContent.includes(text)), text);
  };
  const files = () => h.calls.filter(({ body }) => ['pick', 'inspect', 'scan', 'import', 'export'].includes(body?.action));
  await h.click('导入实操引导');
  target('source', '添加BI文件夹');
  assert.equal(files().length, 0);
  await h.click('BI不良数据 · 不良');
  target('folder', '选择文件夹');
  await h.click('选择文件夹');
  target('inspect', '识别最新文件表头');
  await h.click('识别最新文件表头');
  assert.match(h.root.textContent, /文件被 Excel 占用/);
  target('inspect', '识别最新文件表头');
  await h.click('识别最新文件表头');
  target('columns', '导入列');
  await h.click('列已勾好，去核对字段');
  target('mapping', '确认映射并保存来源');
  await h.click('确认映射并保存来源');
  target('mapping', '确认映射并保存来源');
  const confirm = h.all().find(
    (node) => node.tagName === 'input' && node.type === 'checkbox' &&
      node.parent.textContent.includes('已核对字段'),
  );
  confirm.checked = true;
  await confirm.onchange();
  await h.click('确认映射并保存来源');
  target('scan', '扫描文件');
  await h.click('扫描文件');
  target('import', '导入目录内符合映射的文件');
  await h.click('导入目录内符合映射的文件');
  target('import', '重试此文件');
  await h.click('重试此文件');
  target('analysis', '分析与筛选');
  await h.click('分析与筛选');
  target('filter', '添加筛选');
  await h.click('添加筛选');
  target('filter', '应用筛选');
  const option = h.all().find(
    (node) => node.tagName === 'input' && node.type === 'checkbox' &&
      node.parent.textContent.includes('装管反'),
  );
  option.checked = true;
  await option.onchange();
  await h.click('应用筛选');
  target('export', '加入当前图表到报告');
  await h.click('加入当前图表到报告');
  target('report', '横向A4报告');
  await h.click('横向A4报告');
  target('preview', '预览横向A4');
  await h.click('预览横向A4');
  target('saveReport', '导出Excel');
  await h.click('导出Excel');
  assert.match(h.root.textContent, /导出文件已保存/);
  await h.click('关闭引导');
  assert(!h.all().some((node) => node['data-import-guide-target']));
});

test('retry selects only the failed file and preserves other import results', async (t) => {
  const h = harness(t, { importRun: true });
  await h.ui.activate();
  await h.ui.openTab('sources');
  await h.click('BI不良数据 · 不良');
  await h.click('扫描文件');
  await h.click('导入目录内符合映射的文件');
  assert.match(h.root.textContent, /1 个文件未导入/);
  await h.click('重试此文件');
  const last = h.calls.filter(({ body }) => body?.action === 'import').at(-1).body;
  assert.deepEqual(last.names, ['占用.xlsx']);
  assert.match(h.root.textContent, /已就绪.xlsx已导入4 行/);
  assert.match(h.root.textContent, /占用.xlsx已导入2 行/);
});

test('a chart split on empty defects applies an empty filter', async (t) => {
  const h = harness(t, { blankChart: true });
  await h.ui.activate();
  await h.click('按不良项拆分加入报告');
  const blank = h.all().find(
    (n) => n.tagName === 'input' && n.type === 'checkbox' && n.parent.textContent.includes('（空白）'),
  );
  assert(blank);
  blank.checked = true;
  await blank.onchange();
  await h.click('加入报告');
  await h.ui.flush();
  assert.deepEqual(h.config().report.charts[0].query.filters.at(-1),
    { field: 'defect', op: 'empty', values: [], caseSensitive: false });
});

test('native Excel export freezes the currently displayed BI date range and query', async (t) => {
  const h = harness(t, { originalTemplate: true });
  await h.ui.activate();
  const analyzed = h.calls.filter(({ body }) => body?.action === 'analyze').at(-1).body;
  await h.click('按原表导出 Excel');
  const request = h.calls.find(({ body }) => body?.action === 'exportOriginalReport').body;
  assert.equal(request.sourceId, analyzed.sourceId);
  assert.equal(request.revision, 1);
  assert.deepEqual(request.query, {
    ...analyzed.query, range: 'custom', start: '2026-09-19', end: '2026-09-20',
  });
  assert.match(h.root.textContent, /已导出总表 2 条/);
});

test('a source without template columns offers A4 export through the report', async (t) => {
  const h = harness(t);
  await h.ui.activate();
  assert(h.button('加入当前图表到报告'));
  assert(!h.all().some((n) => n.tagName === 'button' && n.textContent === '按原表导出 Excel'));
});

test('A4 charts default to quantity and support independently mixed metrics', async (t) => {
  const h = harness(t);
  await h.ui.activate();
  const controls = (label) =>
    h.all().filter((n) => n.tagName === 'select' && n.parent?._text === label);
  const set = async (control, value) => {
    assert.ok(control);
    control.value = value;
    await control.onchange();
  };
  await set(controls('指标')[0], 'rate');
  await h.click('加入当前图表到报告');
  await h.ui.openTab('report');
  await h.ui.flush();
  assert.equal(h.config().report.charts[0].metric, 'quantity');
  await h.click('复制图表');
  await set(controls('图表指标')[1], 'rows');
  await set(controls('图表维度')[1], 'date');
  await h.ui.flush();
  assert.deepEqual(
    h.config().report.charts.map((chart) => chart.metric),
    ['quantity', 'rows'],
  );
  assert.equal(h.config().report.charts[1].dimension, 'date');
  await set(controls('图表指标')[0], 'rate');
  await h.click('将报告中的不良率图改为数量图');
  await h.ui.flush();
  assert.deepEqual(
    h.config().report.charts.map((chart) => chart.metric),
    ['quantity', 'rows'],
  );
});

test('BI group drill keeps the date and opens the matching source row without changing filters', async (t) => {
  const h = harness(t, { breakdown: true });
  await h.ui.activate();
  assert(h.button('工序 · 全部 ▾'));
  await h.click('5 · 查明细');
  const request = h.calls.filter(({ body }) => body?.action === 'analyze').at(-1).body;
  assert.deepEqual(request.query.filters[0].values, ['装管']);
  assert.equal(request.query.filters[0].field, 'process');
  assert.equal(request.query.start, '2026-09-19');
  assert(h.all().some((node) => node._text.includes('BI.xlsx / 42')));
  assert.equal(h.panelState().sources.bi.schemes[0].periods.day.query.filters.length, 0);
});

test('facet search previews choices before applying and clears a no-match keyword', async (t) => {
  const h = harness(t);
  await h.ui.activate();
  await h.click('添加筛选');
  const search = h.all().find((n) => n['aria-label'] === '搜索筛选值');
  const choices = () =>
    h.all().filter((n) => n.className === 'lab-check' && n.parent.className === 'lab-facet-list');
  assert.equal(choices().length, 2);
  search.value = '并';
  search.oninput({ isComposing: true });
  assert.equal(choices().length, 2);
  search.oncompositionend();
  assert.equal(h.button('全选当前页').disabled, true);
  await search.onkeydown({ key: 'Enter', preventDefault() {} });
  assert.equal(choices().length, 0);
  assert(h.all().some((n) => n._text.includes('没有匹配此关键词')));
  await h.click('清除搜索');
  assert.equal(choices().length, 2);
  assert.equal(h.button('全选当前页').disabled, false);
  assert.equal(h.panelState().sources.bi.schemes[0].periods.day.query.filters.length, 0);
});

test('real analysis UI isolates three panels, remembers filters and freezes report dates', async (t) => {
  const h = harness(t);
  await h.ui.activate();
  await h.click('添加筛选');
  const checkbox = h
    .all()
    .find(
      (n) =>
        n.tagName === 'input' && n.type === 'checkbox' && n.parent.textContent.includes('装管反'),
    );
  assert.ok(checkbox);
  checkbox.checked = true;
  await checkbox.onchange();
  await h.click('应用筛选');
  await h.ui.flush();
  assert.equal(
    h.panelState().sources.bi.schemes[0].periods.day.query.filters[0].values[0],
    '装管反',
  );
  await h.click('加入当前图表到报告');
  await h.ui.flush();
  const c = h.config().report.charts[0];
  assert.equal(c.query.range, 'custom');
  assert.equal(c.query.start, '2026-09-19');
  assert.equal(c.query.filters[0].values[0], '装管反');
  await h.click('每周');
  await h.ui.flush();
  assert.equal(h.calls.filter((c) => c.body?.action === 'analyze').at(-1).body.period, 'week');
  assert.deepEqual(h.panelState().sources.bi.schemes[0].periods.week.query.filters, []);
  await h.click('每日');
  await h.ui.flush();
  assert.equal(
    h.calls.filter((c) => c.body?.action === 'analyze').at(-1).body.query.filters[0].values[0],
    '装管反',
  );
  await h.click('横向A4报告');
  const title = h.all().find((n) => n.tagName === 'input' && n.parent._text === '图表标题');
  title.value = '第一次标题';
  await title.onchange();
  title.value = '连续编辑后的标题';
  await title.onchange();
  await h.ui.flush();
  assert.equal(h.config().report.charts[0].title, '连续编辑后的标题');
  await h.click('预览横向A4');
  await h.click('导出PDF');
  assert.equal(h.calls.filter((c) => c.body?.action === 'export').length, 1);
});
test('source drafts persist without becoming confirmed sources and cancelled folder pick retains edits', async (t) => {
  const h = harness(t);
  await h.ui.activate();
  await h.click('数据源与导入');
  await h.click('添加产量文件夹');
  const name = h.all().find((n) => n.tagName === 'input' && n.parent._text === '名称');
  name.value = '车间产量';
  name.onchange();
  await h.ui.flush();
  assert.equal(h.draft().name, '车间产量');
  assert.equal(h.config().sources.length, 1);
  await h.click('选择文件夹');
  assert.equal(h.draft().name, '车间产量');
});
test('sequential field mapping edits preserve each other before confirmation', async (t) => {
  const h = harness(t);
  await h.ui.activate();
  await h.click('数据源与导入');
  await h.click('BI不良数据 · 不良');
  const date = h.all().find((n) => n.tagName === 'select' && n.parent._text === '日期 *');
  date.value = 'h_0000000000000002';
  await date.onchange();
  const defect = h.all().find((n) => n.tagName === 'select' && n.parent._text === '不良项 *');
  defect.value = 'h_0000000000000001';
  await defect.onchange();
  await h.ui.flush();
  assert.equal(h.draft().mapping.date, 'h_0000000000000002');
  assert.equal(h.draft().mapping.defect, 'h_0000000000000001');
  assert.equal(h.config().sources[0].confirmed, false);
});
test('import column choices persist through preview and can be restored', async (t) => {
  const columns = [
    { id: 'h_0000000000000001', label: '不良项', type: 'text' },
    { id: 'h_0000000000000002', label: '日期', type: 'date' },
    { id: 'h_0000000000000003', label: '责任人', type: 'text' },
    { id: 'h_0000000000000004', label: '备用日期', type: 'date' },
  ];
  const h = harness(t, { inspect: {
    name: '导入.xlsx', sheet: 'container', sheets: ['container'], headerRow: 1, rowCount: 1,
    schema: 'columns-test', confidence: {}, preview: [], columns,
    mapping: { defect: columns[0].id, date: columns[1].id, employee: columns[2].id },
  } });
  await h.ui.activate();
  await h.ui.openTab('sources');
  await h.click('BI不良数据 · 不良');
  await h.click('识别最新文件表头');
  const control = (index) => h.all().find((n) => n.id === `lab-import-${columns[index].id}`);
  assert.equal(control(0).disabled, true);
  assert.equal(control(2).checked, true);
  control(2).checked = false;
  await control(2).onchange();
  await h.ui.flush();
  assert.equal(h.draft().mapping.employee, undefined);
  assert.deepEqual(h.draft().columns.map((column) => column.id), [columns[0].id, columns[1].id, columns[3].id]);
  await h.click('识别最新文件表头');
  assert.equal(control(2).checked, false);
  await h.click('全选列');
  await h.ui.flush();
  assert.equal(control(2).checked, true);
  assert.equal(h.draft().columns.length, 4);
  const dateField = h.all().find((n) => n.tagName === 'select' && n.parent._text === '日期 *');
  dateField.value = columns[3].id;
  await dateField.onchange();
  assert.equal(control(1).disabled, false);
  assert.equal(control(3).disabled, true);
});

test('actual source editor reinspection keeps the selected date column and shows its sample', async (t) => {
  const inspection = {
    name: 'BI.xlsx',
    sheet: 'Data',
    headerRow: 1,
    rowCount: 1,
    sheets: ['Data'],
    schema: 'test',
    confidence: { date: 'review' },
    columns: [
      { id: 'h_0000000000000001', label: '不良项', type: 'text', examples: ['装管反'] },
      { id: 'h_0000000000000002', label: '日期', type: 'date', examples: ['2026-09-19'] },
      { id: 'h_0000000000000003', label: 'Work Date', type: 'date', examples: ['2026-11-01'] },
    ],
    mapping: { date: 'h_0000000000000003', defect: 'h_0000000000000001' },
    preview: [['装管反', '2026-09-19', '2026-11-01']],
  };
  const h = harness(t, { inspect: inspection });
  await h.ui.activate();
  await h.click('数据源与导入');
  await h.click('BI不良数据 · 不良');
  const select = h.all().find((n) => n.tagName === 'select' && n.parent._text === '日期 *');
  select.value = 'h_0000000000000002';
  await select.onchange();
  await h.click('识别最新文件表头');
  await h.ui.flush();
  assert.equal(h.draft().mapping.date, 'h_0000000000000002');
  assert.ok(
    h
      .all()
      .some(
        (n) =>
          n.className === 'lab-date-mapping-note' &&
          n.textContent.includes('统计日期使用：日期；样例：2026-09-19'),
      ),
  );
});
test('recommended BI mapping is explicit, previews workflow semantics and persists independent Check Date rules', async (t) => {
  const inspection = {
    name: 'BI.xlsx',
    sheet: 'Data',
    sheets: ['Data'],
    headerRow: 1,
    rowCount: 1,
    schema: 'test',
    confidence: {},
    columns: [
      { id: 'h_0000000000000001', label: '不良项', type: 'text', examples: ['装管反'] },
      { id: 'h_0000000000000002', label: 'Work Date', type: 'date', examples: ['2026-10-16'] },
      {
        id: 'h_0000000000000003',
        label: 'Check Date',
        type: 'date',
        examples: ['2026-10-17 02:30:00'],
      },
      {
        id: 'h_0000000000000004',
        label: 'Workflow Step in Charge',
        type: 'text',
        examples: ['CN-MPO-装管'],
      },
    ],
    mapping: {
      date: 'h_0000000000000003',
      defect: 'h_0000000000000001',
      process: 'h_0000000000000004',
    },
    preview: [],
  };
  const h = harness(t, { inspect: inspection });
  await h.ui.activate();
  await h.click('数据源与导入');
  await h.click('BI不良数据 · 不良');
  await h.click('识别最新文件表头');
  await h.click('应用推荐字段与Check Date班次口径');
  assert.ok(h.root.textContent.includes('责任工序'));
  assert.ok(h.root.textContent.includes('08:00–18:40'));
  const advanced = h
    .all()
    .find((n) => n.tagName === 'details' && n.textContent.includes('调整班次时间与名称'));
  advanced.open = true;
  const clock = h.all().find((n) => n.tagName === 'input' && n.parent._text === '白班开始');
  clock.value = '08:10';
  await clock.onchange();
  assert.ok(
    h.all().includes(advanced),
    'editing a clock must not rebuild or close advanced controls',
  );
  assert.equal(advanced.open, true);
  clock.value = '08:00';
  await clock.onchange();
  assert.equal(
    h.calendar().sources.bi,
    undefined,
    'recommendation remains a draft until confirmation',
  );
  const check = h
    .all()
    .find(
      (n) =>
        n.tagName === 'input' &&
        n.type === 'checkbox' &&
        n.parent.textContent.includes('已核对字段'),
    );
  check.checked = true;
  await check.onchange();
  await h.click('确认映射并保存来源');
  await h.ui.flush();
  assert.equal(h.calendar().sources.bi.timeColumn, 'h_0000000000000003');
  assert.equal(h.config().sources[0].mapping.process, 'h_0000000000000004');
  await h.ui.reload();
  assert.equal(h.calendar().sources.bi.mode, 'check-time');
});

test('recommendation preserves Work Date for business dates when Check Date is incomplete', async (t) => {
  const workDate = 'h_0000000000000002';
  const checkDate = 'h_0000000000000003';
  const h = harness(t, {
    inspect: {
      name: 'BI.xlsx', sheet: 'Data', sheets: ['Data'], headerRow: 1, rowCount: 2,
      schema: 'test', confidence: {}, preview: [],
      dateFallback: { missingCheckDates: 1 },
      columns: [
        { id: 'h_0000000000000001', label: '不良项', type: 'text' },
        { id: workDate, label: 'Work Date', type: 'date' },
        { id: checkDate, label: 'Check Date', type: 'date' },
      ],
      mapping: { date: workDate, defect: 'h_0000000000000001' },
    },
  });
  await h.ui.activate();
  await h.click('数据源与导入');
  await h.click('BI不良数据 · 不良');
  await h.click('识别最新文件表头');
  assert.match(h.root.textContent, /Check Date 有 1 行为空/);
  await h.click('应用 Work Date 与班次设置');
  await h.ui.flush();
  assert.equal(h.draft().mapping.date, workDate);
  const confirm = h.all().find(
    (n) => n.tagName === 'input' && n.type === 'checkbox' && n.parent.textContent.includes('已核对字段'),
  );
  confirm.checked = true;
  await confirm.onchange();
  await h.click('确认映射并保存来源');
  await h.ui.flush();
  assert.equal(h.config().sources[0].mapping.date, workDate);
  assert.equal(h.calendar().sources.bi.timeColumn, checkDate);
  assert.equal(h.calendar().sources.bi.dateBasis, 'mapped');
});

test('existing report-time source can switch to judgment time and keeps the night shift date rule', async (t) => {
  const defect = 'h_0000000000000001';
  const report = 'h_0000000000000002';
  const judgment = 'h_0000000000000003';
  const h = harness(t, { importRun: true, inspect: {
    name: '异常品.xlsx', sheet: 'container', sheets: ['container'], headerRow: 1, rowCount: 2,
    schema: 'test', confidence: {}, preview: [], decisionDateColumn: judgment,
    columns: [{ id: defect, label: '不良项', type: 'text' },
      { id: report, label: '报告时间', type: 'date' },
      { id: judgment, label: '判定时间', type: 'date' }],
    mapping: { date: judgment, defect },
  } });
  await h.ui.openTab('sources');
  await h.click('BI不良数据 · 不良');
  await h.click('识别最新文件表头');
  assert.match(h.root.textContent, /报告时间/);
  await h.click('改用判定时间');
  assert.match(h.root.textContent, /判定时间的归班日期/);
  const confirm = h.all().find((n) => n.type === 'checkbox' && n.parent.textContent.includes('已核对字段'));
  confirm.checked = true;
  await confirm.onchange();
  await h.click('确认映射并保存来源');
  assert.equal(h.config().sources[0].mapping.date, judgment);
  assert.equal(h.calendar().sources.bi.timeColumn, judgment);
  assert.equal(h.calendar().sources.bi.dateBasis, 'start');
  assert.match(h.root.textContent, /重新导入|扫描并导入/);
});
test('late analysis replies cannot repopulate a cleared workspace', async (t) => {
  let release;
  const h = harness(t, { waitAnalyze: () => new Promise((r) => (release = r)) });
  const opening = h.ui.activate();
  for (let i = 0; i < 20 && !release; i++) await new Promise((r) => setImmediate(r));
  assert.ok(release);
  h.ui.clear();
  release();
  await opening;
  assert.equal(h.root.children.length, 0);
});

test('custom panels can be added, copied, moved, deleted, and recovered on reload without changing records', async (t) => {
  const h = harness(t);
  await h.ui.activate();
  await h.click('新增板块');
  const title = h.all().find((n) => n.tagName === 'input' && n.parent._text === '板块标题');
  title.value = '装管班次分析';
  await title.onchange();
  const dimension = h
    .all()
    .find(
      (n) =>
        n.tagName === 'select' &&
        n.parent._text === '分析维度' &&
        n.parent.parent.className === 'lab-panel-form',
    );
  dimension.value = 'shift';
  await dimension.onchange();
  await h.click('完成并自动保存');
  await h.ui.flush();
  const day = () => h.panelState().sources.bi.schemes[0].periods.day;
  assert.equal(day().panels.length, 3);
  assert.equal(day().panels[2].query.dimension, 'shift');
  const custom = () => h.all().find((n) => n['data-panel-id'] === day().panels[2].id);
  const menu = custom()
    .children.flatMap((n) => n.children)
    .find((n) => n.tagName === 'details' && n.children[0]?._text === '板块操作');
  assert.ok(menu);
  assert.ok(!menu.open);
  menu.open = true;
  const copy = menu.children
    .flatMap((n) => n.children)
    .find((n) => n.tagName === 'button' && n.textContent === '复制');
  assert.ok(copy);
  await copy.onclick();
  await h.ui.flush();
  assert.equal(day().panels.length, 4);
  assert.equal(day().panels[3].title, '装管班次分析 副本');
  await h.ui.reload();
  assert.equal(day().panels.length, 4);
  assert.ok(h.root.textContent.includes('装管班次分析'));
  assert.equal(h.config().report.charts.length, 0);
});

test('sharing is wired to a scheme export and day/month panel edits stay isolated', async (t) => {
  const h = harness(t);
  await h.ui.activate();
  await h.click('管理与分享');
  await h.click('分享当前方案');
  assert.equal(h.calls.filter((c) => c.body?.action === 'panelsExport').length, 1);
  await h.click('完成');
  await h.click('每月');
  await h.click('新增板块');
  await h.click('完成并自动保存');
  await h.ui.flush();
  const s = h.panelState().sources.bi.schemes[0];
  assert.equal(s.periods.month.panels.length, 3);
  assert.equal(s.periods.day.panels.length, 2);
});

test('independent dimension panels still render when the public query has no rows', async (t) => {
  const h = harness(t, { emptyMain: true });
  await h.ui.activate();
  await h.click('新增板块');
  const dimension = h
    .all()
    .find(
      (n) =>
        n.tagName === 'select' &&
        n.parent._text === '分析维度' &&
        n.parent.parent.className === 'lab-panel-form',
    );
  dimension.value = 'shift';
  await dimension.onchange();
  await h.click('完成并自动保存');
  await h.ui.flush();
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
  assert.ok(
    h.calls.some((c) => c.body?.action === 'analyze' && c.body.query.dimension === 'shift'),
  );
  assert.ok(h.root.textContent.includes('张三') || h.all().some((n) => n.markup?.includes('张三')));
});
test('a missing shared field blocks analysis while keeping reset controls usable', async (t) => {
  const h = harness(t, { badField: true });
  await h.ui.activate();
  assert.equal(h.calls.filter((c) => c.body?.action === 'analyze').length, 0);
  assert.ok(h.root.textContent.includes('Missing field'));
  await h.click('重置本面板');
  assert.ok(h.calls.some((c) => c.body?.action === 'analyze'));
});

test('configured export map is sent with analyze and export, enabling the native template', async (t) => {
  const columns = { '容器号': 'h_0000000000000001', '数量': 'h_0000000000000002', '判定原因': 'h_0000000000000003' };
  const h = harness(t, {
    templateMaps: [{ id: 'map1', name: 'BI转异常品', sourceId: 'bi', columns }],
  });
  await h.ui.activate();
  await h.ui.openTab('analysis');
  await h.ui.flush();
  const analyzed = h.calls.filter(({ body }) => body?.action === 'analyze').at(-1).body;
  assert.deepEqual(analyzed.templateMap, columns, 'analyze carries the active map');
  // The mapping makes the export button available even for a foreign source.
  await h.click('按原表导出 Excel');
  const request = h.calls.filter(({ body }) => body?.action === 'exportOriginalReport').at(-1).body;
  assert.deepEqual(request.templateMap, columns, 'export carries the same map');
});

test('export mapping editor is offered and can be opened for a foreign source', async (t) => {
  const h = harness(t);
  await h.ui.activate();
  await h.ui.openTab('analysis');
  await h.ui.flush();
  assert(h.button('配置导出列映射'), 'mapping editor entry is shown without a native template');
  await h.click('配置导出列映射');
  const dialog = h.all().find((n) => n.tagName === 'dialog');
  assert(dialog, 'mapping dialog opens');
  const selects = h.all().filter((n) => n.tagName === 'select');
  // One scheme selector + one source-column selector per 25 template header.
  assert.ok(selects.length >= 26, `expected 26 selects, got ${selects.length}`);
});

test('mLight guided export moves the pointer from date query through the decision-reason column to the saved Excel', async (t) => {
  const h = harness(t, { mlightGuide: true, originalTemplate: true, importRun: true });
  const pointer = () => h.all().find((n) => n['data-analysis-guide-pointer'] === '');
  await h.ui.openTab('analysis');
  await h.click('筛选导出引导');
  assert.equal(pointer().textContent, '查询');
  await h.click('用全部日期查询');
  assert.equal(pointer().textContent, '筛选判定原因');
  await h.click('筛选判定原因');
  const search = h.all().find((n) => n['aria-label'] === '搜索筛选值');
  assert.equal(pointer().children[0], search);
  search.value = '装管反';
  await search.onkeydown({ key: 'Enter', preventDefault() {} });
  assert.equal(pointer().className, 'lab-facet-list');
  for (const label of pointer().children) {
    const box = label.children[0];
    box.checked = true;
    await box.onchange();
  }
  assert.equal(pointer().textContent, '应用筛选');
  await h.click('应用筛选');
  assert.equal(pointer().textContent, '按原表导出 Excel');
  await h.click('按原表导出 Excel');
  const request = h.calls.findLast((x) => x.body.action === 'exportOriginalReport').body;
  assert.equal(request.query.range, 'custom');
  assert.deepEqual(request.query.filters, [{
    field: 'h_0000000000000010', op: 'in', values: ['装管反', 'CN_MPO_装管反'], caseSensitive: false,
  }]);
  assert.match(h.root.textContent, /导出文件已保存/);
});

test('quick report uses the applied query and remembers custom headers for this source', async (t) => {
  const h = harness(t, { mlightGuide: true, importRun: true });
  await h.ui.openTab('day');
  const first = h.config().sharedAnalysis;
  assert.equal(first.period, 'day');
  assert.equal(first.query.range, 'custom');
  await h.click('编辑导出表头');
  const title = h.all().find((n) => n['aria-label'] === '导出表头 判定原因');
  title.value = '判定分类';
  title.oninput();
  await h.click('保存并导出');
  const request = h.calls.findLast((x) => x.body.action === 'exportQuickReport').body;
  assert.equal(request.sourceId, first.sourceId);
  assert.deepEqual(request.query, first.query);
  assert.deepEqual(request.layout, h.config().quickExports[first.sourceId]);
  assert.ok(request.layout.columns.some((c) => c.title === '判定分类'));
  await h.click('快捷导出 Excel');
  assert.deepEqual(h.calls.findLast((x) => x.body.action === 'exportQuickReport').body.layout, request.layout);
});

test('template tutorial advances after actual facet selection and valid template, then exports the selected workbook', async (t) => {
  const h = harness(t, { mlightGuide: true, originalTemplate: true, importRun: true, templateGuide: true });
  const pointer = () => h.all().find((n) => n['data-template-guide-cursor'] === '');
  await h.ui.openTab('analysis');
  await h.click('模板导出教程');
  assert.equal(pointer().tagName, 'label');
  await h.click('继续核对日期');
  assert.equal(pointer().textContent, '查询');
  await h.click('用全部日期查询');
  assert.equal(pointer().textContent, '筛选判定原因');
  await h.click('筛选判定原因');
  const search = h.all().find((n) => n['aria-label'] === '搜索筛选值');
  search.value = '装管反';
  await search.onkeydown({ key: 'Enter', preventDefault() {} });
  const checked = pointer().children[0].children[0];
  checked.checked = true;
  await checked.onchange();
  assert.equal(pointer().textContent, '应用筛选');
  await h.click('应用筛选');
  assert.equal(pointer().textContent, '选择目标模板');
  await h.click('选择目标模板');
  assert.equal(pointer().textContent, '选择目标模板');
  await h.click('选择目标模板');
  assert.match(h.root.textContent, /模板工作表或表头/);
  assert.equal(pointer().textContent, '选择目标模板');
  await h.click('选择目标模板');
  assert.equal(pointer().textContent, '保存目标 Excel');
  await h.click('保存目标 Excel');
  const action = h.calls.findLast(({ body }) => body.action === 'exportOriginalReport').body;
  assert.equal(action.templateToken, 'template-test');
  assert.equal(action.query.filters[0].field, 'h_0000000000000010');
  assert.equal(h.calls.some(({body}) => body.action === 'exportQuickReport'), false);
  assert.match(h.root.textContent, /教程完成.*导出结果.xlsx.*总表 2 条/);
  assert.match(h.root.textContent, /总表、物料穿错-穿反、并反、装管反、PIN堵、内断/);
  await h.click('关闭引导');
  assert.equal(pointer(), undefined);
});

test('template guide shows dynamic layout and remembers the selected analysis workbook', async (t) => {
  const templatePath = 'C:/合成/旧分析报表.xlsx';
  const h = harness(t, { mlightGuide: true, originalTemplate: true, importRun: true,
    pickedReport: { layoutOnly: true, fileName: '旧分析报表.xlsx', templatePath,
      templateToken: 'analyzed-template', sheets: ['总表', '旧判定原因'] } });
  await h.ui.openTab('analysis');
  await h.click('模板导出教程');
  await h.click('继续核对日期');
  await h.click('用全部日期查询');
  await h.click('筛选判定原因');
  const search = h.all().find((n) => n['aria-label'] === '搜索筛选值');
  search.value = '装管反';
  await search.onkeydown({ key: 'Enter', preventDefault() {} });
  const selected = h.all().find((n) => n['data-template-guide-cursor'] === '').children[0].children[0];
  selected.checked = true;
  await selected.onchange();
  await h.click('应用筛选');
  await h.click('选择目标模板');
  assert.equal(h.config().dailyReports.bi.templatePath, templatePath);
  assert.equal(h.config().dailyReports.bi.chartLayout, 'reason-columns');
  assert.match(h.root.textContent, /旧分析报表.xlsx · 按当前筛选生成分类页与图表/);
  assert.doesNotMatch(h.root.textContent, /输出 2 张表/);
  await h.click('保存目标 Excel');
  const request = h.calls.findLast(({ body }) => body.action === 'exportOriginalReport').body;
  assert.equal(request.templateToken, 'analyzed-template');
});

test('homepage detail opens with its exact query without replacing the published homepage query', async (t) => {
  const h = harness(t, { mlightGuide: true, importRun: true });
  await h.ui.openTab('day');
  const shared = h.config().sharedAnalysis;
  const query = { ...shared.query, start: '2026-09-19', end: '2026-09-19',
    filters: [{ field: 'defect', op: 'in', values: ['装管反'], caseSensitive: true }] };
  await h.ui.openTab('day', { sourceId: shared.sourceId, query, drill: true });
  const body = h.calls.findLast((x) => x.body.action === 'analyze').body;
  assert.equal(body.sourceId, shared.sourceId);
  assert.deepEqual(body.query, query);
  assert.deepEqual(h.config().sharedAnalysis, shared);
});

test('import history confirms reversible changes and refreshes the source-bound batch revision', async (t) => {
  const h = harness(t, { importHistory: {}, importRun: true });
  await h.ui.openTab('sources');
  await h.click('BI不良数据 · 不良');
  await h.click('查看导入历史');
  assert(h.root.textContent.includes('合成误导入.csv'));
  await h.click('撤销此批次');
  assert(h.all().some((node) => node.tagName === 'dialog' && node.open));
  assert.equal(h.calls.some(({ body }) => body.action === 'setImportBatch'), false);
  await h.click('取消');
  assert.equal(h.calls.some(({ body }) => body.action === 'setImportBatch'), false);
  await h.click('撤销此批次');
  const confirm = h.all().findLast((node) => node.tagName === 'button' && node.textContent === '撤销此批次');
  await confirm.onclick();
  const withdrawal = h.calls.findLast(({ body }) => body.action === 'setImportBatch').body;
  assert.deepEqual({ ...withdrawal }, {
    action: 'setImportBatch', sourceId: 'bi', batchId: 'session-batch-1', enabled: false, revision: 1,
  });
  assert(h.root.textContent.includes('已撤销'));
  await h.click('恢复此批次');
  await h.all().findLast((node) => node.tagName === 'button' && node.textContent === '恢复此批次').onclick();
  const restoration = h.calls.findLast(({ body }) => body.action === 'setImportBatch').body;
  assert.equal(restoration.enabled, true);
  assert.equal(restoration.revision, 2);
  h.ui.clear();
  await h.ui.openTab('sources');
  await h.click('BI不良数据 · 不良');
  assert(h.button('查看导入历史'));
  assert(!h.root.textContent.includes('合成误导入.csv'));
});

test('contains previews a live rule, then reopens the same keyword for editing', async (t) => {
  const h = harness(t, { mlightGuide: true, importRun: true });
  await h.ui.openTab('day');
  await h.click('添加筛选');
  const dialog = () => h.all().find((n) => n.tagName === 'dialog');
  const rule = () => dialog().children[1].children.find((n) => n._text === '规则').lastChild;
  const keyword = () => dialog().children[1].children.find((n) => n._text === '规则内容').lastChild;
  rule().value = 'contains';
  await rule().onchange();
  keyword().value = ' 装管反 ';
  await keyword().onkeydown({ key: 'Enter', preventDefault() {} });
  const preview = h.calls.findLast(({ body }) => body?.action === 'facets').body;
  assert.equal(preview.search, '装管反');
  assert.equal(preview.matchOp, 'contains');
  assert.match(dialog().textContent, /命中 2 条记录 · 2 个不同值/);
  await h.click('应用筛选');
  const applied = h.calls.findLast(({ body }) => body?.action === 'analyze').body.query.filters;
  assert.deepEqual(applied, [{ field: 'defect', op: 'contains', values: ['装管反'], caseSensitive: false }]);
  await h.click('不良项 · 包含文字 · 装管反');
  assert.equal(rule().value, 'contains');
  assert.equal(keyword().value, '装管反');
  assert.deepEqual(h.calls.findLast(({ body }) => body?.action === 'facets').body.query.filters, []);
});
