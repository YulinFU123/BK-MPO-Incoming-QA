'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  path = require('node:path');
const M = require('../domain/analysis-studio'),
  A = require('../domain/a4-report'),
  state = require('../domain/module-state');
const { createAnalysisStudioHost } = require('../desktop/analysis-studio-host');
test('reinspection preserves explicit date choice, fills Work Date only when missing, and respects filename dates', () => {
  const columns = [
      { id: 'h_0000000000000001' },
      { id: 'h_0000000000000002' },
      { id: 'h_0000000000000003' },
    ],
    inspection = { columns, mapping: { date: columns[0].id, defect: columns[2].id } };
  assert.equal(
    M.reconcileMapping({ mapping: { date: columns[1].id } }, inspection).date,
    columns[1].id,
  );
  assert.equal(M.reconcileMapping({ mapping: {} }, inspection).date, columns[0].id);
  assert.equal(
    M.reconcileMapping({ mapping: {}, dateFromFilename: true }, inspection).date,
    undefined,
  );
  assert.equal(
    M.reconcileMapping({ mapping: { date: 'h_9999999999999999' } }, inspection).date,
    columns[0].id,
  );
});
function config() {
  const c = M.defaults(),
    s = M.freshSource('defects', 'test');
  s.folder = 'C:\\合成资料';
  c.sources = [s];
  c.activeSource = s.id;
  return c;
}
test('daily export settings are source-scoped, optional for old configs, and reject mismatched denominator bindings', () => {
  const c = config();
  c.sources.push(M.freshSource('production', 'output'), M.freshSource('defects', 'second'));
  c.dailyReports.test = { ...M.dailyReport(c, 'test'), includeRate: true, productionId: 'output',
    templatePath: 'D:\\模板\\每日目标.xlsx', rateBasis: 'selected-defects' };
  const restored = M.validate(JSON.parse(JSON.stringify(c)));
  assert.equal(M.dailyReport(restored, 'test').productionId, 'output');
  assert.equal(M.dailyReport(restored, 'second').includeRate, false);
  assert.throws(() => M.validate({ ...c, dailyReports: { test: { ...c.dailyReports.test, productionId: 'second' } } }));
  delete c.dailyReports;
  assert.deepEqual(M.validate(c).dailyReports, {});
  const p = M.freshSource('production', 'output');
  p.productionBinding = { layout: 'rows', fillDown: ['date'], processAliases: {}, shiftAliases: { 晚班: '夜班' }, missingQuantity: 'pending' };
  assert.deepEqual(M.source(p).productionBinding, p.productionBinding);
  assert.throws(() => M.source({ ...p, productionBinding: { ...p.productionBinding, missingQuantity: 'zero' } }));
});

test('daily keyword defaults remain editable independent copies and support source-scoped OR rules', () => {
  const defaults = M.defaultRateKeywords();
  assert.equal(new Set(defaults.map(({ label }) => label)).size, 14);
  assert(defaults.filter(({ label }) => label === '物料穿错').length > 1);
  assert(defaults.some(({ label, keywords }) => label === 'MPO纤缩/无纤' && keywords.includes('纤缩')));
  assert(defaults.some(({ label, keywords }) => label === 'MPO纤缩/无纤' && keywords.includes('无纤')));
  defaults[0].keywords.push('edited');
  assert(!M.defaultRateKeywords()[0].keywords.includes('edited'));
  const settings = config();
  settings.sources.push(M.freshSource('defects', 'other'));
  const rules = [
    { label: 'MPO并纤反', keywords: ['MPO', '并纤反'] },
    { label: 'MPO并纤反', keywords: ['MPO', '并反'] },
  ];
  settings.dailyReports.test = { dailyTitle: '日报标题', rateKeywords: rules };
  const restored = M.validate(JSON.parse(JSON.stringify(settings)));
  assert.deepEqual(M.dailyReport(restored, 'test').rateKeywords, rules);
  assert.equal(M.dailyReport(restored, 'test').dailyTitle, '日报标题');
  assert.deepEqual(M.dailyReport(restored, 'other').rateKeywords, []);
  restored.dailyReports.test.rateKeywords = [];
  assert.deepEqual(M.dailyReport(M.validate(restored), 'test').rateKeywords, []);
  assert.equal(new Set(M.defaultRateKeywords().map(({ label }) => label)).size, 14);
});

test('independent day/week/month and source configurations round-trip without changing legacy state', () => {
  const c = config();
  c.views.test = {
    day: M.viewDefaults('day'),
    week: M.viewDefaults('week'),
    month: M.viewDefaults('month'),
  };
  c.views.test.day.filters = [
    { field: 'defect', op: 'in', values: ['装管反', '断裂'], caseSensitive: false },
  ];
  const restored = state.validate({ scope: 'module', module: 'analysis-studio' }, c);
  assert.equal(restored.views.test.week.range, 'recent8w');
  assert.equal(restored.views.test.month.range, 'recent6m');
  assert.deepEqual(restored.views.test.week.filters, []);
  restored.views.test.day.filters[0].values.push('其他');
  assert.equal(c.views.test.day.filters[0].values.length, 2);
  assert.deepEqual(state.defaultData({ scope: 'module', module: 'analysis' }), {
    datasetId: '',
    start: '',
    end: '',
    filters: {},
    chart: 'rate',
  });
  assert.throws(() => M.validate({ ...c, activeSource: 'missing' }));
  assert.throws(() => M.query({ ...M.viewDefaults('day'), start: '2026-02-30' }));
});

test('manual production stores explicit zero and rejects duplicate or invalid cohort entries', () => {
  const c = config();
  c.sources.push(M.freshSource('defects', 'other'));
  const row = { date: '2026-11-16', process: ' 剪线 ', shift: '白班', quantity: 0 };
  c.dailyReports.test = { productionMode: 'manual', chartLayout: 'hidden', manualProduction: [row] };
  const saved = M.validate(c);
  assert.deepEqual(M.dailyReport(saved, 'test').manualProduction, [{ ...row, process: '剪线' }]);
  assert.deepEqual(M.dailyReport(saved, 'other').manualProduction, []);
  assert.equal(M.dailyReport(saved, 'other').chartLayout, 'readable');
  c.dailyReports.test.manualProduction.push({ ...row, process: '剪线' });
  assert.throws(() => M.validate(c), /重复/);
  c.dailyReports.test.manualProduction = [{ ...row, quantity: '' }];
  assert.throws(() => M.validate(c), /非负整数/);
  c.dailyReports.test.manualProduction = [{ ...row, date: '2026-02-30' }];
  assert.throws(() => M.validate(c), /日期/);
});
test('reason groups persist per source with the exact original reasons and legacy settings stay compatible', () => {
  const c = config();
  c.sources.push(M.freshSource('defects', 'other'));
  c.dailyReports.test = { chartLayout: 'reason-columns', reasonGroups: [
    { name: ' 组合甲 ', reasons: ['CN-MPO裂纹', 'T-MPO裂纹'] },
    { name: '', reasons: ['裂纹\n需返修'] },
  ] };
  c.dailyReports.other = { chartLayout: 'readable' };
  const stateType = { scope: 'module', module: 'analysis-studio' };
  const saved = state.validate(stateType, JSON.parse(JSON.stringify(c)));
  assert.deepEqual(M.dailyReport(saved, 'test').reasonGroups, [
    { name: '组合甲', reasons: ['CN-MPO裂纹', 'T-MPO裂纹'] },
    { name: '', reasons: ['裂纹\n需返修'] },
  ]);
  assert.deepEqual(M.dailyReport(saved, 'other').reasonGroups, []);
  assert.equal(Object.hasOwn(saved.dailyReports.other, 'reasonGroups'), false);
  M.dailyReport(saved, 'test').reasonGroups[0].reasons.pop();
  assert.equal(saved.dailyReports.test.reasonGroups[0].reasons.length, 2);
});

test('reason groups reject overlap, blank reasons and unsupported configuration shapes', () => {
  const c = config();
  const a = { name: '', reasons: ['CN-MPO断裂'] };
  assert.deepEqual(M.validateReasonGroups([{ reasons: ['CN-MPO断裂', 'T-MPO断裂'] }]), [
    { name: '', reasons: ['CN-MPO断裂', 'T-MPO断裂'] },
  ]);
  for (const [groups, message] of [
    [[a, { name: '重复组', reasons: ['CN-MPO断裂'] }], /重复/],
    [[{ ...a, reasons: ['同一项', '同一项'] }], /重复/],
    [[{ ...a, reasons: [' '] }], /无效/],
    [[{ ...a, reasons: ['字'.repeat(513)] }], /无效/],
    [[{ ...a, name: '长'.repeat(32) }], /31/],
    [[{ ...a, name: '多\n行' }], /31/],
    [[{ ...a, reasons: Array.from({ length: 17 }, (_, i) => String(i)) }], /16/],
    [Array.from({ length: 33 }, (_, i) => ({ name: '', reasons: [String(i)] })), /32/],
    [[{ ...a, extra: true }], /16/],
    [null, /32/],
  ]) {
    c.dailyReports.test = { reasonGroups: groups };
    assert.throws(() => M.validate(c), message);
  }
});
test('unconfirmed source drafts remain separate and cannot bypass production field requirements', () => {
  const s = M.freshSource('production', 'draft');
  s.name = '';
  assert.deepEqual(
    state.validate({ scope: 'draft', module: 'analysis-source' }, { source: s }).source,
    s,
  );
  assert.throws(() => M.source({ ...s, name: '产量', confirmed: true }));
  assert.deepEqual(M.defaults().sources, []);
});
const charts = (n) =>
  Array.from({ length: n }, (_, i) => ({
    id: 'c' + i,
    title: '9月19日装管反人员 ' + (i + 1),
    type: 'bar',
    metric: 'quantity',
    data: [
      { label: '张三', value: 10 },
      { label: '李四', value: 6 },
      { label: '王五', value: 3 },
    ],
  }));
test('1/2/3/4/6/9 charts fit one landscape A4 without overlap, missing categories or clipped geometry', () => {
  for (const n of [1, 2, 3, 4, 6, 9]) {
    const p = A.compose(charts(n), M.defaults().report, {
      title: '9月19日装管失效人员',
      subtitle: '合成数据，仅供验证',
    });
    assert.equal(p.pages.length, 1);
    assert.equal(p.pages[0].charts.length, n);
    const boxes = p.pages[0].boxes;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      assert.ok(b.x >= 8 && b.y >= 8 && b.x + b.width <= 289.01 && b.y + b.height <= 202);
      for (let j = i + 1; j < boxes.length; j++) {
        const c = boxes[j];
        assert.ok(
          b.x + b.width <= c.x + 0.001 ||
            c.x + c.width <= b.x + 0.001 ||
            b.y + b.height <= c.y + 0.001 ||
            c.y + c.height <= b.y + 0.001,
        );
      }
    }
    assert.equal(
      p.pages[0].commands.filter((c) => c.kind === 'text' && c.text === '张三').length,
      n,
    );
  }
});
test('long titles and categories wrap; unreadable reports request explicit pagination without dropping data', () => {
  const rows = charts(6);
  rows.forEach(
    (c) => (c.data = Array.from({ length: 20 }, (_, i) => ({ label: '员工' + i, value: i + 1 }))),
  );
  assert.throws(
    () => A.compose(rows, M.defaults().report, { title: '完整报表' }),
    /放不下|无法|分页/,
  );
  const p = A.compose(
    rows,
    { ...M.defaults().report, singlePage: false },
    { title: '质量改善分析：不同不良类型的人员分布与日期统计' },
  );
  assert.ok(p.pages.length > 1);
  assert.deepEqual(
    p.pages.flatMap((p) => p.charts),
    rows.map((c) => c.id),
  );
  assert.throws(() => A.chartSvg({ ...rows[0], type: 'pie', metric: 'rate' }), /不良率不能/);
});
test('trend SVG labels every valid point, leaves gaps and escapes user text', () => {
  const svg = A.chartSvg({
    title: '<script>标题',
    type: 'line',
    metric: 'quantity',
    data: [
      { label: '周一', value: 8 },
      { label: '周二', value: null },
      { label: '周三', value: 4 },
    ],
  });
  assert.ok(svg.includes('&lt;script&gt;'));
  assert.equal((svg.match(/<circle /g) || []).length, 2);
  assert.ok(svg.includes('周二'));
  assert.ok(svg.includes('>8</text>'));
  assert.ok(svg.includes('>4</text>'));
  assert.ok(!svg.includes('<polyline '));
});
function hostHarness({ template = null, output = null, layoutOnly = false } = {}) {
  let c = {
      unlocked: true,
      mode: 'file',
      file: path.resolve(process.env.PLATFORM_TEST_ROOT || '.', 'synthetic.eap'),
      sessionId: 'one',
    },
    data = config(),
    calls = [],
    abort = 0,
    saveFailure = false;
  const worker = {
    ready: Promise.resolve(),
    abort() {
      abort++;
    },
    request: async ({ body }) => {
      calls.push(body);
      if (body.action === 'inspectOriginalTemplate')
        return { fileName: '目标模板.xlsx', sheets: ['总表'], ...(layoutOnly ? { layoutOnly: true } : {}) };
      if (body.action === 'inspectBackup') return { config: data };
      if (body.action === 'restore') return { config: data, revision: 9 };
      return { done: true };
    },
  };
  const host = createAnalysisStudioHost({
    controller: { hostContext: () => c },
    memory: {
      readModuleState: async (a) => ({
        data:
          a.module === 'analysis-calendar'
            ? require('../domain/analysis-calendar').defaults()
            : data,
        revision: 0,
      }),
      saveModuleState: async () => {
        if (saveFailure) throw Error('write failed');
      },
    },
    profile: '.',
    python: 'unused',
    script: 'unused.py',
    workerFactory: () => worker,
    pickFolder: async () => null,
    saveFile: async () => output,
    pickOriginalTemplate: async () => template,
    pickBackup: async () => '/synthetic.labpack',
  });
  return {
    host,
    calls,
    setData: (v) => {
      data = v;
    },
    setContext: (v) => {
      c = v;
    },
    failSave: () => {
      saveFailure = true;
    },
    aborts: () => abort,
  };
}
test('native Excel export uses only dialog paths and an analyzed query', async () => {
  const template = 'C:\\测试\\模板.xlsx',
    output = 'C:\\测试\\输出.xlsx',
    h = hostHarness({ template, output }),
    settings = config(),
    input = {
      action: 'exportOriginalReport',
      sourceId: settings.sources[0].id,
      query: { ...M.viewDefaults('day'), range: 'all' },
      revision: 3,
    };
  await assert.rejects(() => h.host.request({ ...input, template: 'unchecked.xlsx' }));
  await assert.rejects(() => h.host.request({ ...input, revision: -1 }), /先查询/);
  assert.deepEqual(await hostHarness().host.request(input), { cancelled: true });
  assert.deepEqual(await hostHarness({ template }).host.request(input), { cancelled: true });
  await h.host.request(input);
  assert.deepEqual(h.calls[0], { action: 'inspectOriginalTemplate', template });
  const request = h.calls[1];
  assert.equal(h.calls.length, 2);
  assert.equal(request.template, template);
  assert.equal(request.output, output);
  assert.equal(request.query.range, 'all');
  assert.equal(request.revision, 3);
  assert.equal(request.config.dailyReports.test.chartLayout, 'readable');
});
test('template tutorial validates the picked file and restricts its token to the active workspace', async () => {
  const template = 'C:/合成/目标模板.xlsx', output = 'C:/合成/目标表.xlsx';
  const h = hostHarness({ template, output });
  const chosen = await h.host.request({ action: 'chooseOriginalTemplate' });
  assert.deepEqual(h.calls[0], { action: 'inspectOriginalTemplate', template });
  assert.equal(chosen.fileName, '目标模板.xlsx');
  assert.equal(Object.hasOwn(chosen, 'template'), false);
  const input = { action: 'exportOriginalReport', sourceId: 'test',
    query: M.viewDefaults('day'), revision: 2, templateToken: chosen.templateToken };
  await assert.rejects(h.host.request({ ...input, templateToken: 'unknown' }), /模板选择已失效/);
  await h.host.request(input);
  assert.equal(h.calls.at(-1).template, template);
  assert.equal(h.calls.at(-1).output, output);
  h.setContext({ unlocked: true, mode: 'file', file: 'other.eap', sessionId: 'two' });
  await assert.rejects(h.host.request(input), /模板选择已失效/);
});

test('host scopes manual production to the selected report and uses its saved layout', async () => {
  const settings = config();
  const h = hostHarness({ template: 'C:/模板/日报.xlsx', output: 'C:/测试/输出.xlsx' });
  const request = { sourceId: 'test', query: M.viewDefaults('day'), revision: 2 };
  await h.host.request({ ...request, action: 'dailyProductionCohorts' });
  assert.equal(h.calls.at(-1).config.dailyReports.test.chartLayout, 'readable');
  settings.dailyReports.test = { includeRate: true, productionMode: 'manual', chartLayout: 'hidden' };
  h.setData(settings);
  await assert.rejects(h.host.request({ ...request, action: 'exportOriginalReport' }), /填写并保存/);
  settings.dailyReports.test.manualProduction = [{ date: '2026-11-16', process: '包材', shift: '白班', quantity: 500 }];
  await h.host.request({ ...request, action: 'exportOriginalReport' });
  assert.equal(h.calls.at(-1).config.dailyReports.test.manualProduction[0].quantity, 500);
  assert.equal(h.calls.at(-1).config.dailyReports.test.chartLayout, 'hidden');
});
test('host lets reason-column previews and exports proceed with missing production while old layouts require it', async () => {
  for (const productionMode of ['bound', 'manual']) {
    const settings = config();
    settings.dailyReports.test = { includeRate: true, productionMode, chartLayout: 'readable' };
    const h = hostHarness({ template: 'C:/模板/日报.xlsx', output: 'C:/测试/输出.xlsx' });
    h.setData(settings);
    const request = { sourceId: 'test', query: M.viewDefaults('day'), revision: 2 };
    await assert.rejects(h.host.request({ ...request, action: 'exportOriginalReport' }), /产量/);
    settings.dailyReports.test.chartLayout = 'reason-columns';
    settings.dailyReports.test.dailyTitle = '装管人员日报';
    settings.dailyReports.test.rateKeywords = [{ label: '并纤反', keywords: ['MPO', '并纤反'] }];
    await h.host.request({ ...request, action: 'previewDailyRate' });
    const preview = h.calls.at(-1);
    assert.equal(preview.action, 'previewDailyRate');
    assert.equal(preview.config.dailyReports.test.dailyTitle, '装管人员日报');
    assert.deepEqual(preview.config.dailyReports.test.rateKeywords, settings.dailyReports.test.rateKeywords);
    assert.equal(preview.config.dailyReports.test.chartLayout, 'reason-columns');
    await h.host.request({ ...request, action: 'exportOriginalReport' });
    assert.equal(h.calls.at(-1).action, 'exportOriginalReport');
    assert.equal(h.calls.at(-1).config.dailyReports.test.productionMode, productionMode);
  }
});

test('host forwards the persisted reason chart layout and leaves other sources at their default', async () => {
  const settings = config();
  const secondary = M.freshSource('defects', 'other');
  settings.sources.push(secondary);
  const savedGroups = [{ name: '组合甲', reasons: ['CN-MPO裂纹', 'T-MPO裂纹'] }];
  settings.dailyReports.test = { chartLayout: 'reason-columns', reasonGroups: savedGroups };
  const normalized = M.validate(settings);
  assert.equal(M.dailyReport(normalized, 'other').chartLayout, 'readable');
  assert.equal(M.dailyReport(normalized, 'test').chartLayout, 'reason-columns');

  const h = hostHarness({ template: 'C:/模板/日报.xlsx', output: 'C:/测试/输出.xlsx' });
  h.setData(settings);
  const request = { action: 'exportOriginalReport', sourceId: 'test',
    query: M.viewDefaults('day'), revision: 2 };
  await assert.rejects(h.host.request({ ...request, reasonGroups: [] }), /参数无效/);
  assert.equal(h.calls.length, 0);
  await h.host.request(request);
  assert.equal(h.calls.at(-1).config.dailyReports.test.chartLayout, 'reason-columns');
  assert.deepEqual(h.calls.at(-1).config.dailyReports.test.reasonGroups, savedGroups);
});

test('analysis workbook layout is derived from the inspected file across all three export paths', async (t) => {
  const template = 'C:/合成/旧分析报表.xlsx', output = 'C:/合成/输出.xlsx';
  const input = { action: 'exportOriginalReport', sourceId: 'test',
    query: M.viewDefaults('day'), revision: 2 };
  for (const route of ['guide', 'saved-path', 'file-picker']) {
    await t.test(route, async () => {
      const h = hostHarness({ template, output, layoutOnly: true });
      const settings = config();
      settings.sources.push(M.freshSource('defects', 'other'));
      settings.dailyReports.test = { chartLayout: 'hidden',
        ...(route === 'saved-path' ? { templatePath: template } : {}) };
      settings.dailyReports.other = { chartLayout: 'original' };
      h.setData(settings);
      const choice = route === 'guide'
        ? await h.host.request({ action: 'chooseOriginalTemplate' }) : null;
      if (choice) assert.equal(choice.layoutOnly, true);
      await h.host.request({ ...input, ...(choice ? { templateToken: choice.templateToken } : {}) });
      assert.deepEqual(h.calls[0], { action: 'inspectOriginalTemplate', template });
      const request = h.calls.at(-1);
      assert.equal(request.output, output);
      assert.equal(request.template, template);
      assert.equal(request.config.dailyReports.test.chartLayout, 'reason-columns');
      assert.equal(request.config.dailyReports.other.chartLayout, 'original');
      assert.equal(settings.dailyReports.test.chartLayout, 'hidden', 'layout override remains scoped to the export request');
    });
  }
  const h = hostHarness({ template, output });
  await assert.rejects(h.host.request({ ...input, layoutOnly: true }), /参数无效/);
});

test('host accepts preview drafts only for inspection and prevents cancelled dialogs from writing', async () => {
  const h = hostHarness(),
    s = M.freshSource('defects', 'new');
  s.folder = 'C:\\合成';
  await h.host.request({ action: 'inspect', sourceId: s.id, draft: s });
  assert.equal(h.calls[0].config.sources.at(-1).id, 'new');
  assert.equal(h.calls[0].draft, undefined);
  await assert.rejects(
    () => h.host.request({ action: 'import', sourceId: s.id, draft: s }),
    /仅可扫描/,
  );
  assert.deepEqual(await h.host.request({ action: 'pick' }), { cancelled: true });
  assert.deepEqual(await h.host.request({ action: 'backup' }), { cancelled: true });
  assert.equal(h.calls.length, 1);
  await assert.rejects(() => h.host.request({ action: 'unknown' }));
  await assert.rejects(() => h.host.request({ action: 'status', output: 'arbitrary' }));
  await h.host.request({ action: 'cancel' });
  assert.equal(h.aborts(), 1);
});
test('failed configuration persistence compensates an empty-workspace restore instead of claiming success', async () => {
  const h = hostHarness();
  h.setData(M.defaults());
  h.failSave();
  await assert.rejects(() => h.host.request({ action: 'restore' }), /未可靠保存/);
  assert.equal(h.calls.at(-1).action, 'rollbackRestore');
  assert.equal(h.calls.at(-1).revision, 9);
});

// Export-column mapping schemes: named, saved, switchable, strict template.
test('export column maps round-trip, honour the fixed 25 headers and stay source-scoped', () => {
  const c = config();
  const cid = (n) => 'h_' + n.toString(16).padStart(16, '0');
  assert.equal(M.templateHeaders.length, 25);
  assert.equal(M.templateHeaders[0], '容器号');
  assert.equal(c.templateMaps.length, 0, 'new config starts with no maps');
  assert.equal(c.activeTemplateMap, '');

  c.templateMaps = [
    { id: 'map1', name: 'BI表导出', sourceId: c.activeSource,
      columns: { '容器号': cid(1), '数量': cid(2), '判定原因': cid(3), '责任人': '' } },
  ];
  c.activeTemplateMap = 'map1';
  const restored = M.validate(c);
  assert.equal(restored.templateMaps.length, 1);
  assert.equal(restored.templateMaps[0].columns['容器号'], cid(1));
  assert.equal(restored.templateMaps[0].columns['责任人'], '', 'blank mapping preserved');
  assert.equal(restored.activeTemplateMap, 'map1');
});

test('legacy config without export maps validates and gets safe defaults', () => {
  const c = config();
  delete c.templateMaps;
  delete c.activeTemplateMap;
  const restored = M.validate(c);
  assert.deepEqual(restored.templateMaps, []);
  assert.equal(restored.activeTemplateMap, '');
});

test('export map validation rejects unknown template columns, bad ids and dangling sources', () => {
  const c = config();
  const cid = 'h_' + '1'.repeat(16);
  const base = { id: 'map1', name: 'x', sourceId: c.activeSource, columns: { '容器号': cid } };
  assert.throws(() => M.validate({ ...c, templateMaps: [{ ...base, columns: { '假列': cid } }] }));
  assert.throws(() => M.validate({ ...c, templateMaps: [{ ...base, columns: { '容器号': 'not-a-column' } }] }));
  assert.throws(() => M.validate({ ...c, templateMaps: [{ ...base, sourceId: 'missing-source' }] }));
  assert.throws(() => M.validate({ ...c, templateMaps: [base], activeTemplateMap: 'no-such-map' }));
  assert.throws(() => M.validate({ ...c, templateMaps: [{ ...base, name: '' }] }));
  assert.throws(() => M.validate({ ...c, templateMaps: [{ ...base, id: 'map1' }, { ...base }] }),
    'duplicate map ids rejected');
});
