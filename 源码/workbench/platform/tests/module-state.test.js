'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {
  randomUUID,
  randomBytes,
  createCipheriv,
  createDecipheriv,
  createHash,
} = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const model = require('../domain/module-state');
const analysisStudio = require('../domain/analysis-studio');
const { createSQLiteStateStore } = require('../adapters/state/sqlite-state-store');
const { createModuleStateService } = require('../application/module-state-service');
const A = { scope: 'module', module: 'analysis' },
  Q = { scope: 'module', module: 'query' },
  G = { scope: 'global', module: 'shell' },
  D = { scope: 'draft', module: 'records' };
function cryptoPort() {
  const key = randomBytes(32);
  return {
    isEncryptionAvailable: async () => true,
    encryptString: async (s) => {
      const iv = randomBytes(12),
        c = createCipheriv('aes-256-gcm', key, iv);
      const b = Buffer.concat([c.update(s, 'utf8'), c.final()]);
      return Buffer.concat([iv, c.getAuthTag(), b]);
    },
    decryptString: async (b) => {
      const d = createDecipheriv('aes-256-gcm', key, b.subarray(0, 12));
      d.setAuthTag(b.subarray(12, 28));
      return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
    },
  };
}
async function setup(t) {
  const directory = path.join(
    process.env.PLATFORM_TEST_ROOT || path.resolve(__dirname, '../../../../构建/当前作业/测试'),
    'state-' + randomUUID(),
  );
  await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, 'modules.sqlite');
  const store = await createSQLiteStateStore(file),
    encryption = cryptoPort();
  let current = { unlocked: true, epoch: 1, workspace: 'cutting' };
  const context = () => current;
  const service = createModuleStateService({ store, encryption, context });
  t.after(() => store.close());
  return {
    store,
    encryption,
    context,
    service,
    file,
    directory,
    setContext: (c) => (current = c),
    save: async (a, v, expectedRevision = 0) =>
      service.save({ address: a, data: v, expectedRevision }),
  };
}
test('analysis studio and source drafts persist encrypted across workspaces and a store restart', async (t) => {
  const h = await setup(t),
    address = { scope: 'module', module: 'analysis-studio' },
    draft = { scope: 'draft', module: 'analysis-source' };
  const data = analysisStudio.defaults(),
    source = analysisStudio.freshSource('defects', 'bi');
  source.name = '装管不良';
  data.sources = [source];
  data.activeSource = 'bi';
  data.views.bi = {
    day: {
      ...analysisStudio.viewDefaults('day'),
      filters: [{ field: 'defect', op: 'in', values: ['装管反'], caseSensitive: false }],
    },
    week: analysisStudio.viewDefaults('week'),
  };
  await h.save(address, data);
  await h.save(draft, { source });
  h.setContext({ unlocked: true, epoch: 2, workspace: 'assembly' });
  assert.deepEqual((await h.service.read(address)).data.sources, []);
  assert.equal((await h.service.read(draft)).data.source, null);
  h.setContext({ unlocked: true, epoch: 3, workspace: 'cutting' });
  assert.deepEqual((await h.service.read(address)).data, data);
  await h.store.close();
  const reopened = await createSQLiteStateStore(h.file);
  t.after(() => reopened.close());
  const restored = createModuleStateService({
    store: reopened,
    encryption: h.encryption,
    context: h.context,
  });
  assert.deepEqual((await restored.read(address)).data, data);
  assert.equal((await restored.read(draft)).data.source.name, '装管不良');
});
test('calendar rules and drafts isolate workspaces and recover encrypted after restart', async (t) => {
  const h = await setup(t),
    C = require('../domain/analysis-calendar');
  const a = { scope: 'module', module: 'analysis-calendar' },
    d = { scope: 'draft', module: 'analysis-calendar' };
  const value = C.defaults();
  value.sources.bi = { ...C.ruleDefaults(), mode: 'check-time', timeColumn: 'h_0000000000000001' };
  await h.save(a, value);
  await h.save(d, { sourceId: 'bi', rule: { ...value.sources.bi, dayEnd: '' } });
  h.setContext({ unlocked: true, epoch: 2, workspace: 'assembly' });
  assert.deepEqual((await h.service.read(a)).data, C.defaults());
  assert.equal((await h.service.read(d)).data.rule, null);
  h.setContext({ unlocked: true, epoch: 3, workspace: 'cutting' });
  await h.store.close();
  const reopened = await createSQLiteStateStore(h.file);
  t.after(() => reopened.close());
  const service = createModuleStateService({
    store: reopened,
    encryption: h.encryption,
    context: h.context,
  });
  assert.equal((await service.read(a)).data.sources.bi.nightEnd, '06:40');
  assert.equal((await service.read(d)).data.rule.dayEnd, '');
  const current = await service.read(a);
  await service.reset({ address: a, expectedRevision: current.revision });
  assert.deepEqual((await service.read(a)).data, C.defaults());
});
test('state contract validates scope, input types, dates, and layered precedence', () => {
  for (const a of [
    { scope: 'global', module: 'analysis' },
    { scope: 'draft', module: 'query' },
    { scope: 'module', module: 'analysis', extra: true },
  ])
    assert.throws(() => model.address(a));
  assert.throws(() => model.validate(A, { start: '2026-02-30' }));
  assert.throws(() => model.validate(A, { start: '2026-99-01' }));
  assert.throws(() => model.validate(Q, { pageSize: 500 }));
  assert.throws(() => model.validate(G, { sidebarWidth: 0 }));
  assert.equal(model.merge(A, { chart: 'quantity' }, { chart: 'rate' }).chart, 'rate');
});
test('modules A/B and two workspace settings remain independently isolated', async (t) => {
  const h = await setup(t);
  await h.save(A, { chart: 'quantity' });
  await h.save(Q, { pageSize: 100 });
  h.setContext({ unlocked: true, epoch: 2, workspace: 'assembly' });
  assert.equal((await h.service.read(A)).data.chart, 'rate');
  await h.save(A, { filters: { process: '装管' } });
  h.setContext({ unlocked: true, epoch: 3, workspace: 'cutting' });
  assert.equal((await h.service.read(A)).data.chart, 'quantity');
  assert.equal((await h.service.read(Q)).data.pageSize, 100);
});
test('global settings survive workspace changes while template states remain separate', async (t) => {
  const h = await setup(t);
  await h.save(G, { theme: 'graphite' });
  await h.save({ ...A, templateId: 'cut' }, { chart: 'quantity' });
  assert.equal((await h.service.read({ ...A, templateId: 'tube' })).data.chart, 'rate');
  h.setContext({ unlocked: false, epoch: 4, workspace: '' });
  assert.equal((await h.service.read(G)).data.theme, 'graphite');
  assert.throws(
    () => h.service.read(A),
    (e) => e.code === 'WORKSPACE_LOCKED',
  );
});
test('independent guide progress survives restart and workspace locking without changing other settings', async (t) => {
  const h = await setup(t),
    guide = require('../domain/guides');
  const address = { scope: 'global', module: 'guides' };
  await h.save(A, { chart: 'quantity' });
  let data = guide.mark(guide.defaults(), 'legacy-entry', 'paused', 2);
  data = guide.mark(data, 'bi-daily', 'skipped', 0);
  await h.save(address, data);
  h.setContext({ unlocked: false, epoch: 2, workspace: '' });
  assert.deepEqual((await h.service.read(address)).data, data);
  await h.store.close();
  const store = await createSQLiteStateStore(h.file);
  t.after(() => store.close());
  const reopened = createModuleStateService({
    store,
    encryption: h.encryption,
    context: h.context,
  });
  assert.deepEqual((await reopened.read(address)).data.progress['legacy-entry'], {
    status: 'paused',
    step: 2,
  });
  const expanded = { scope: 'global', module: 'guides-v2' };
  await reopened.save({
    address: expanded,
    data: guide.mark(data, 'label-data', 'completed', 3),
    expectedRevision: 0,
  });
  await reopened.reset({ address: expanded, expectedRevision: 1 });
  assert.deepEqual(
    (await reopened.read(address)).data,
    data,
    'old learning progress remains intact for rollback',
  );
  h.setContext({ unlocked: true, epoch: 3, workspace: 'cutting' });
  assert.equal((await reopened.read(A)).data.chart, 'quantity');
});
test('saved values recover after SQLite close and reopen, ciphertext excludes field text', async (t) => {
  const h = await setup(t);
  await h.save(A, { filters: { operator: 'SYNTHETIC-PRIVATE-OPERATOR' } });
  await h.store.close();
  const bytes = await fs.readFile(h.file);
  assert.equal(bytes.includes(Buffer.from('SYNTHETIC-PRIVATE-OPERATOR')), false);
  const other = await createSQLiteStateStore(h.file);
  t.after(() => other.close());
  const service = createModuleStateService({
    store: other,
    encryption: h.encryption,
    context: h.context,
  });
  assert.equal((await service.read(A)).data.filters.operator, 'SYNTHETIC-PRIVATE-OPERATOR');
});
test('same revision conflicts rather than silently overwriting another client', async (t) => {
  const h = await setup(t),
    s2 = createModuleStateService({ store: h.store, encryption: h.encryption, context: h.context });
  const results = await Promise.allSettled([
    h.save(Q, { pageSize: 100 }),
    s2.save({ address: Q, data: { pageSize: 25 }, expectedRevision: 0 }),
  ]);
  assert.equal(results.filter((x) => x.status === 'fulfilled').length, 1);
  assert.equal(results.find((x) => x.status === 'rejected').reason.code, 'STATE_CONFLICT');
});
test('reset is one module only; named plans survive and can be applied again', async (t) => {
  const h = await setup(t);
  await h.save(A, { chart: 'quantity' });
  await h.save(Q, { pageSize: 100 });
  const plan = await h.service.saveProfile({ address: A, name: '夜班方案', expectedRevision: 0 });
  const reset = await h.service.reset({ address: A, expectedRevision: 1 });
  assert.equal(reset.data.chart, 'rate');
  assert.equal((await h.service.read(Q)).data.pageSize, 100);
  const applied = await h.service.applyProfile({
    address: A,
    id: plan.data.profiles[0].id,
    expectedRevision: 2,
  });
  assert.equal(applied.data.chart, 'quantity');
});
test('named profile updates and copies require a valid catalog revision', async (t) => {
  const h = await setup(t);
  const first = await h.service.saveProfile({ address: A, name: '一', expectedRevision: 0 });
  await assert.rejects(
    h.service.saveProfile({ address: A, name: '二', expectedRevision: 0 }),
    (e) => e.code === 'STATE_CONFLICT',
  );
  const second = await h.service.saveProfile({ address: A, name: '二', expectedRevision: 1 });
  assert.equal(second.data.profiles.length, 2);
  assert.throws(() => h.service.profiles(D));
  assert.notEqual(first.data.profiles[0].id, second.data.profiles[1].id);
});
test('deleted draft stays empty across restart and is never submitted as a business record', async (t) => {
  const h = await setup(t);
  await h.save(D, { templateId: 't', values: { sn: '00012', note: '草稿' } });
  await h.service.reset({ address: D, expectedRevision: 1 });
  await h.store.close();
  const other = await createSQLiteStateStore(h.file);
  t.after(() => other.close());
  const s = createModuleStateService({
    store: other,
    encryption: h.encryption,
    context: h.context,
  });
  const draft = await s.read(D);
  assert.deepEqual(draft.data.values, {});
  assert.equal(draft.reset, true);
  assert.equal(Object.hasOwn(draft.data, 'records'), false);
});
test('corrupt ciphertext uses safe defaults, blocks overwrite, and restores explicitly from history', async (t) => {
  const h = await setup(t);
  await h.save(A, { chart: 'quantity' });
  const key = createHash('sha256')
    .update(JSON.stringify(['cutting', 'module', 'analysis', '', '']))
    .digest('hex');
  await h.store.write({ key, expected: 1, payload: Buffer.from('damaged'), updated: Date.now() });
  const broken = await h.service.read(A);
  assert.equal(broken.corrupt, true);
  assert.equal(broken.data.chart, 'rate');
  await assert.rejects(
    h.save(A, { chart: 'rate' }, 2),
    (e) => e.code === 'STATE_RECOVERY_REQUIRED',
  );
  const restored = await h.service.restore({ address: A, revision: 1, expectedRevision: 2 });
  assert.equal(restored.revision, 3);
  assert.equal(restored.data.chart, 'quantity');
  assert.equal((await h.store.revision(key, 2)).payload.length, 7);
});
test('unavailable encryption never falls back to plaintext or advances revision', async (t) => {
  const h = await setup(t);
  h.encryption.isEncryptionAvailable = async () => false;
  await assert.rejects(
    h.save(A, { chart: 'quantity' }),
    (e) => e.code === 'STATE_ENCRYPTION_UNAVAILABLE',
  );
  assert.equal((await h.service.read(A)).revision, 0);
});
test('workspace changes during asynchronous encryption cancel the pending save', async (t) => {
  const h = await setup(t),
    original = h.encryption.encryptString;
  h.encryption.encryptString = async (value) => {
    h.setContext({ unlocked: true, epoch: 2, workspace: 'assembly' });
    return original(value);
  };
  await assert.rejects(h.save(A, { chart: 'quantity' }), (e) => e.code === 'SESSION_CHANGED');
  assert.equal((await h.service.read(A)).revision, 0);
});
test('no-op state does not generate disk writes and each module retains only 20 historical revisions', async (t) => {
  const h = await setup(t);
  assert.equal((await h.save(A, {})).unchanged, true);
  for (let n = 0; n < 24; n++) await h.save(A, { filters: { process: 'p' + n } }, n);
  const history = await h.service.history(A);
  assert.equal(history.length, 20);
  assert.equal(history[0].revision, 24);
  assert.equal(history.at(-1).revision, 5);
});
test('SQLite backup can independently restore committed encrypted state', async (t) => {
  const h = await setup(t);
  await h.save(Q, { pageSize: 25 });
  const backup = path.join(h.directory, 'backup.sqlite');
  await h.store.backup(backup);
  const other = await createSQLiteStateStore(backup);
  t.after(() => other.close());
  const s = createModuleStateService({
    store: other,
    encryption: h.encryption,
    context: h.context,
  });
  assert.equal((await s.read(Q)).data.pageSize, 25);
  assert.equal((await other.check()).integrity, 'ok');
});
test('newer schemas and damaged databases are preserved without automatic recreation', async (t) => {
  const h = await setup(t);
  await h.store.close();
  const d = new DatabaseSync(h.file);
  d.exec('PRAGMA user_version=999');
  d.close();
  const before = await fs.readFile(h.file);
  await assert.rejects(createSQLiteStateStore(h.file), (e) => e.code === 'STATE_SCHEMA_NEWER');
  assert.deepEqual(await fs.readFile(h.file), before);
  const broken = path.join(h.directory, 'corrupt.sqlite');
  await fs.writeFile(broken, 'test-damaged-original');
  await assert.rejects(createSQLiteStateStore(broken));
  assert.equal(await fs.readFile(broken, 'utf8'), 'test-damaged-original');
});
test('accessor, executable, unsafe-key and oversized state payloads are rejected', async (t) => {
  const h = await setup(t);
  let invoked = false;
  const data = {};
  Object.defineProperty(data, 'chart', {
    enumerable: true,
    get() {
      invoked = true;
      return 'rate';
    },
  });
  await assert.rejects(h.save(A, data));
  assert.equal(invoked, false);
  assert.throws(() =>
    h.service.save({ address: A, data: JSON.parse('{"__proto__":{}}'), expectedRevision: 0 }),
  );
  await assert.rejects(
    h.save(D, {
      values: Object.fromEntries(
        Array.from({ length: 20 }, (_, i) => ['x' + i, 'a'.repeat(10000)]),
      ),
    }),
    (e) => e.code === 'STATE_TOO_LARGE',
  );
});

test('BI export filter memory is separate from analysis and other workspaces', async (t) => {
  const h = await setup(t),
    B = { scope: 'module', module: 'bi-export' };
  await h.save(B, { filters: { SN: { mode: 'include', values: ['0012', '12'] } } });
  await h.save(A, { chart: 'quantity' });
  assert.deepEqual((await h.service.read(B)).data.filters.SN.values, ['0012', '12']);
  h.setContext({ unlocked: true, epoch: 2, workspace: 'assembly' });
  assert.deepEqual((await h.service.read(B)).data.filters, {});
  await h.save(B, { filters: { Shift: { mode: 'include', values: ['晚班'] } } });
  h.setContext({ unlocked: true, epoch: 3, workspace: 'cutting' });
  assert.deepEqual((await h.service.read(B)).data.filters.SN.values, ['0012', '12']);
  const saved = await h.service.read(B);
  await h.service.reset({ address: B, expectedRevision: saved.revision });
  assert.equal((await h.service.read(A)).data.chart, 'quantity');
});

test('home tabs and layouts persist independently by view and data file', async (t) => {
  const h = await setup(t),
    B = { scope: 'module', module: 'home-workspaces-v2' },
    m = require('../domain/home-workspaces');
  const d = m.defaults();
  d.views[0].filters = { process: '装管' };
  const v = {
    ...m.base(),
    id: 'other',
    name: '研磨分析',
    filters: { process: '研磨' },
    panels: ['trend', 'records'],
  };
  d.views.push(v);
  d.activeId = 'other';
  await h.save(B, d);
  const saved = await h.service.read(B);
  assert.equal(saved.data.views[0].filters.process, '装管');
  assert.equal(saved.data.views[1].filters.process, '研磨');
  h.setContext({ unlocked: true, epoch: 2, workspace: 'other-file' });
  assert.equal((await h.service.read(B)).data.views.length, 1);
  h.setContext({ unlocked: true, epoch: 3, workspace: 'cutting' });
  assert.deepEqual((await h.service.read(B)).data.views[1].panels, ['trend', 'records']);
  await h.service.reset({ address: B, expectedRevision: saved.revision });
  assert.equal((await h.service.read(B)).data.views.length, 1);
});

test('homepage source preference survives reopening, isolates workspaces and resets independently', async (t) => {
  const h = await setup(t),
    S = { scope: 'module', module: 'home-data-source' };
  const value = {
    mode: 'bi',
    channel: 'daily',
    dailyScope: 'Synthetic floor A',
    employee: '合成员工',
  };
  await h.save(S, value);
  assert.deepEqual((await h.service.read(S)).data, value);
  const reopened = createModuleStateService({
    store: h.store,
    encryption: h.encryption,
    context: h.context,
  });
  assert.deepEqual((await reopened.read(S)).data, value);
  h.setContext({ unlocked: true, epoch: 2, workspace: 'other-workspace' });
  assert.equal((await reopened.read(S)).data.mode, 'auto');
  await reopened.save({ address: S, data: { ...value, mode: 'records' }, expectedRevision: 0 });
  h.setContext({ unlocked: true, epoch: 3, workspace: 'cutting' });
  const saved = await reopened.read(S);
  assert.deepEqual(saved.data, value);
  await reopened.reset({ address: S, expectedRevision: saved.revision });
  assert.equal((await reopened.read(S)).data.mode, 'auto');
});

test('BI workflow disclosure preferences isolate workspaces and reset without touching BI export settings', async (t) => {
  const h = await setup(t),
    a = { scope: 'module', module: 'bi-workflow' };
  await h.save(a, { acquisitionOpen: true, scriptOpen: true });
  assert.equal((await h.service.read(a)).data.scriptOpen, true);
  h.setContext({ unlocked: true, epoch: 2, workspace: 'other' });
  assert.deepEqual((await h.service.read(a)).data, { acquisitionOpen: false, scriptOpen: false });
  h.setContext({ unlocked: true, epoch: 3, workspace: 'cutting' });
  const r = await h.service.read(a);
  await h.service.reset({ address: a, expectedRevision: r.revision });
  assert.equal((await h.service.read(a)).data.acquisitionOpen, false);
  assert.deepEqual((await h.service.read({ scope: 'module', module: 'bi-export' })).data, {
    filters: {},
    dictionary: {},
  });
});
