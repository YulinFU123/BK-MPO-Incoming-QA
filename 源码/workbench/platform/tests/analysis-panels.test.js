'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs/promises'),
  os = require('node:os'),
  path = require('node:path');
const M = require('../domain/analysis-studio'),
  P = require('../domain/analysis-panels');
const { createAnalysisPanelsHost } = require('../desktop/analysis-panels-host');
function config() {
  const c = M.defaults(),
    s = M.freshSource('defects', 'bi');
  s.folder = 'C:\\private-downloads';
  s.columns = [{ id: 'h_0000000000000001', label: 'Employee Name', type: 'text' }];
  c.sources = [s];
  c.activeSource = s.id;
  return c;
}
async function harness(t) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'panel-config-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const c = config();
  let current = {
    mode: 'file',
    file: path.join(folder, 'one.eap'),
    sessionId: 'one',
    unlocked: true,
  };
  let selected = null,
    output = path.join(folder, 'shared.json');
  const create = (io = fs) =>
    createAnalysisPanelsHost({
      context: () => ({ ...current }),
      check: (captured) => {
        assert.equal(captured.sessionId, current.sessionId, 'session changed');
      },
      root: (ctx) => ctx.file + '.analysis-data',
      readConfig: async () => c,
      saveFile: async () => output,
      pickScheme: async () => selected,
      io,
    });
  const host = create();
  return {
    folder,
    c,
    host,
    create,
    setContext: (v) => (current = v),
    setSelected: (v) => (selected = v),
    setOutput: (v) => (output = v),
    output: () => output,
    load: () => host.request({ action: 'panelsLoad' }),
    save: (r) =>
      host.request({ action: 'panelsSave', panelState: r.state, signature: r.signature }),
  };
}
test('existing source/day/week queries migrate once; panels and file do not copy records or source paths', () => {
  const c = config();
  c.views.bi = {
    day: {
      ...M.viewDefaults('day'),
      filters: [{ field: 'process', op: 'in', values: ['装管'], caseSensitive: false }],
    },
  };
  const state = P.defaults(c),
    s = P.active(state, 'bi');
  assert.equal(s.periods.day.query.filters[0].values[0], '装管');
  s.periods.day.panels[0].title = '日';
  assert.equal(s.periods.week.panels[0].title, '变化趋势');
  assert.ok(!JSON.stringify(P.share(s)).includes('private-downloads'));
  assert.equal(c.views.bi.day.filters.length, 1);
});
test('portable custom columns rebind by exact unique header, missing or ambiguous targets are rejected', () => {
  const c = config(),
    source = c.sources[0],
    q = { ...M.viewDefaults('day'), dimension: source.columns[0].id };
  const portable = P.portableQuery(q, source);
  assert.deepEqual(portable.dimension, { column: 'Employee Name' });
  const other = { ...source, columns: [{ ...source.columns[0], id: 'h_0000000000000002' }] };
  assert.equal(P.bindQuery(portable, other).dimension, other.columns[0].id);
  assert.throws(() => P.bindQuery(portable, { ...other, columns: [] }));
  assert.throws(() =>
    P.bindQuery(portable, { ...other, columns: [...other.columns, ...other.columns] }),
  );
});
test('panel scopes follow all, follow filters with local dimension, or use an independent date range', () => {
  const c = config(),
    s = c.sources[0],
    base = {
      ...M.viewDefaults('day'),
      range: 'latest',
      filters: [{ field: 'process', op: 'equals', values: ['装管'], caseSensitive: false }],
    };
  const p = P.seedPanel('chart', 'p', M.viewDefaults('day'), s);
  p.query.dimension = 'shift';
  p.query.filters = [{ field: 'defect', op: 'equals', values: ['装管反'], caseSensitive: false }];
  assert.deepEqual(P.effective(p, base, s), base);
  p.scope = 'filters';
  assert.equal(P.effective(p, base, s).dimension, 'shift');
  assert.equal(P.effective(p, base, s).filters.length, 2);
  p.scope = 'independent';
  assert.equal(P.effective(p, base, s).range, 'recent14');
  assert.equal(P.effective(p, base, s).filters.length, 1);
});
test('bad kinds, malicious fields, impossible rate pie and duplicate IDs never validate', () => {
  const c = config(),
    state = P.defaults(c),
    v = state.sources.bi.schemes[0].periods.day;
  v.panels[1].query.metric = 'rate';
  v.panels[1].query.chartType = 'pie';
  assert.throws(() => P.validate(state));
  v.panels[1].query.metric = 'quantity';
  v.panels[1].id = v.panels[0].id;
  assert.throws(() => P.validate(state));
  assert.throws(() =>
    P.readShare(
      { format: P.SHARE, version: 1, scheme: { id: 'x', name: 'x', password: 'x' } },
      c.sources[0],
    ),
  );
});
test('disk configuration survives a new host and external replacement with unchanged revision is detected', async (t) => {
  const h = await harness(t),
    r = await h.load();
  r.state.sources.bi.schemes[0].name = '装管';
  const saved = await h.save(r);
  const reopened = await h.create().request({ action: 'panelsLoad' });
  assert.equal(reopened.state.sources.bi.schemes[0].name, '装管');
  const external = structuredClone(saved.state);
  external.sources.bi.schemes[0].name = '剪线';
  await fs.writeFile(saved.file, JSON.stringify(external));
  const changed = await h.load();
  assert.notEqual(changed.signature, saved.signature);
  assert.equal(changed.state.revision, saved.state.revision);
  await assert.rejects(h.save(saved), /外部修改/);
  assert.equal((await h.load()).state.sources.bi.schemes[0].name, '剪线');
});
test('partial or corrupt external JSON preserves last working state and cannot be overwritten by autosave', async (t) => {
  const h = await harness(t),
    r = await h.load();
  r.state.sources.bi.schemes[0].name = '有效方案';
  const saved = await h.save(r);
  await fs.writeFile(saved.file, '{"partial":');
  const held = await h.load();
  assert.equal(held.writable, false);
  assert.equal(held.state.sources.bi.schemes[0].name, '有效方案');
  await assert.rejects(h.save(held));
  assert.equal(await fs.readFile(saved.file, 'utf8'), '{"partial":');
  await fs.writeFile(saved.file, JSON.stringify(saved.state));
  assert.equal((await h.load()).writable, true);
});
test('missing config uses recovery snapshot after restart instead of resetting unrelated business data', async (t) => {
  const h = await harness(t),
    r = await h.load();
  r.state.sources.bi.schemes[0].name = '下一次';
  const saved = await h.save(r);
  await fs.unlink(saved.file);
  const recovery = await h.create().request({ action: 'panelsLoad' });
  assert.equal(recovery.writable, false);
  assert.match(recovery.warning, /缺失/);
  assert.ok(await fs.stat(saved.file + '.last-good'));
});
test('two workspaces isolate all schemes while file operations queued before a switch never apply to the new one', async (t) => {
  const h = await harness(t),
    a = await h.load();
  a.state.sources.bi.schemes[0].name = '工作区A';
  await h.save(a);
  h.setContext({
    mode: 'file',
    file: path.join(h.folder, 'two.eap'),
    sessionId: 'two',
    unlocked: true,
  });
  const b = await h.load();
  assert.equal(b.state.sources.bi.schemes[0].name, '默认分析');
  const pending = h.host.request({
    action: 'panelsSave',
    panelState: b.state,
    signature: b.signature,
  });
  h.setContext({
    mode: 'file',
    file: path.join(h.folder, 'one.eap'),
    sessionId: 'one-again',
    unlocked: true,
  });
  await assert.rejects(pending, /session changed/);
  assert.equal((await h.load()).state.sources.bi.schemes[0].name, '工作区A');
});
test('sharing and importing transfer definition, preserve original scheme, and never restore source directories', async (t) => {
  const h = await harness(t),
    r = await h.load();
  r.state.sources.bi.schemes[0].name = '可分享';
  const saved = await h.save(r);
  await h.host.request({
    action: 'panelsExport',
    sourceId: 'bi',
    schemeId: 'default',
    panelState: saved.state,
  });
  const bytes = await fs.readFile(h.output(), 'utf8');
  assert.ok(!bytes.includes('private-downloads'));
  assert.ok(!bytes.includes('one.eap'));
  h.setSelected(h.output());
  const imported = await h.host.request({
    action: 'panelsImport',
    sourceId: 'bi',
    signature: saved.signature,
  });
  assert.equal(imported.state.sources.bi.schemes.length, 2);
  assert.equal(imported.state.sources.bi.schemes[0].id, 'default');
  assert.notEqual(imported.state.sources.bi.active, 'default');
});
test('write failure never reports saved and the original file remains readable', async (t) => {
  const h = await harness(t),
    r = await h.load();
  const broken = Object.create(fs);
  broken.rename = async () => {
    const e = Error('synthetic no space');
    e.code = 'ENOSPC';
    throw e;
  };
  const bad = h.create(broken);
  await bad.request({ action: 'panelsLoad' });
  r.state.sources.bi.schemes[0].name = '不能落盘';
  await assert.rejects(
    bad.request({ action: 'panelsSave', panelState: r.state, signature: r.signature }),
    /no space/,
  );
  assert.equal((await h.load()).state.sources.bi.schemes[0].name, '默认分析');
});
test('demo is explicitly non-persistent and does not create a settings file', async (t) => {
  const h = await harness(t);
  h.setContext({ mode: 'demo', file: null, sessionId: 'demo', unlocked: true });
  const r = await h.load();
  assert.equal(r.persisted, false);
  assert.equal(r.file, null);
  await h.save(r);
  assert.deepEqual(await fs.readdir(h.folder), []);
});
test('share export cannot overwrite the active settings file, including Windows case variants', async (t) => {
  const h = await harness(t),
    r = await h.load();
  h.setOutput(process.platform === 'win32' ? r.file.toUpperCase() : r.file);
  await assert.rejects(
    h.host.request({
      action: 'panelsExport',
      sourceId: 'bi',
      schemeId: 'default',
      panelState: r.state,
    }),
    /不能覆盖/,
  );
  assert.equal((await h.load()).signature, r.signature);
});
test('an incompatible imported field leaves the active scheme byte-identical', async (t) => {
  const h = await harness(t),
    r = await h.load(),
    value = P.share(P.active(r.state, 'bi'));
  value.scheme.periods.day.query.dimension = { column: 'Missing Column' };
  const file = path.join(h.folder, 'incompatible.json');
  await fs.writeFile(file, JSON.stringify(value));
  h.setSelected(file);
  await assert.rejects(
    h.host.request({ action: 'panelsImport', sourceId: 'bi', signature: r.signature }),
    /Missing Column/,
  );
  assert.equal((await h.load()).signature, r.signature);
});
test('an oversized configuration is rejected before any file replacement', async (t) => {
  const h = await harness(t),
    r = await h.load();
  r.state.sources.bi.schemes[0].periods.day.query.filters = Array.from({ length: 20 }, () => ({
    field: 'defect',
    op: 'in',
    values: Array(500).fill('x'.repeat(512)),
    caseSensitive: false,
  }));
  await assert.rejects(h.save(r), /4MB/);
  assert.equal((await h.load()).signature, r.signature);
});
