'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  path = require('node:path'),
  fs = require('node:fs/promises'),
  { randomUUID, createHash } = require('node:crypto');
const { createModuleStateHost } = require('../desktop/module-state-host');
const { createSQLiteStateStore } = require('../adapters/state/sqlite-state-store');
const { createModuleStateService } = require('../application/module-state-service');
const { encryption } = require('./helpers/state-crash.cjs');
const A = { scope: 'module', module: 'analysis' };
const hash = (b) => createHash('sha256').update(b).digest('hex');
async function directory() {
  const d = path.join(
    process.env.PLATFORM_TEST_ROOT || path.resolve(__dirname, '../../../../构建/当前作业/测试'),
    'state-host-' + randomUUID(),
  );
  await fs.mkdir(d, { recursive: true });
  return d;
}
test('host backup import restores one module using a read-only unchanged backup', async (t) => {
  const dir = await directory();
  let selected = null;
  const controller = {
    hostContext: () => ({
      mode: 'file',
      file: path.join(dir, 'synthetic.eap'),
      unlocked: true,
      sessionId: 1,
    }),
  };
  const h = await createModuleStateHost({
    controller,
    directory: dir,
    encryption,
    pickBackup: async () => selected,
  });
  t.after(() => h.close());
  await h.saveModuleState({ address: A, data: { chart: 'quantity' }, expectedRevision: 0 });
  const b = await h.backupModuleState();
  selected = path.join(dir, 'backups', b.fileName);
  const before = hash(await fs.readFile(selected));
  await h.saveModuleState({ address: A, data: { chart: 'rate' }, expectedRevision: 1 });
  await assert.rejects(
    h.importModuleStateBackup({ address: A, expectedRevision: 2, confirmed: false }),
  );
  const v = await h.importModuleStateBackup({ address: A, expectedRevision: 2, confirmed: true });
  assert.equal(v.data.chart, 'quantity');
  assert.equal(v.revision, 3);
  assert.equal(hash(await fs.readFile(selected)), before);
});
test('independent SQLite connections reject stale revisions rather than losing a writer', async (t) => {
  const dir = await directory(),
    file = path.join(dir, 'store.sqlite'),
    one = await createSQLiteStateStore(file),
    two = await createSQLiteStateStore(file);
  t.after(() => one.close());
  t.after(() => two.close());
  const context = () => ({ unlocked: true, workspace: 'independent', epoch: 1 }),
    s1 = createModuleStateService({ store: one, encryption, context }),
    s2 = createModuleStateService({ store: two, encryption, context });
  const r = await Promise.allSettled([
    s1.save({ address: A, data: { chart: 'quantity' }, expectedRevision: 0 }),
    s2.save({
      address: A,
      data: { chart: 'rate', filters: { process: '合成' } },
      expectedRevision: 0,
    }),
  ]);
  assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1);
  assert.equal(r.find((x) => x.status === 'rejected').reason.code, 'STATE_CONFLICT');
  assert.equal((await one.check()).integrity, 'ok');
});

test('demo module memory is released on host restart while global preferences remain durable', async (t) => {
  const dir = await directory(),
    controller = {
      hostContext: () => ({ mode: 'demo', file: null, unlocked: true, sessionId: 1 }),
    };
  const first = await createModuleStateHost({ controller, directory: dir, encryption });
  t.after(() => first.close());
  await first.saveModuleState({ address: A, data: { chart: 'quantity' }, expectedRevision: 0 });
  await first.saveModuleState({
    address: { scope: 'global', module: 'shell' },
    data: { theme: 'graphite' },
    expectedRevision: 0,
  });
  assert.equal((await first.readModuleState(A)).data.chart, 'quantity');
  await first.close();
  const second = await createModuleStateHost({ controller, directory: dir, encryption });
  t.after(() => second.close());
  assert.equal((await second.readModuleState(A)).revision, 0);
  assert.equal(
    (await second.readModuleState({ scope: 'global', module: 'shell' })).data.theme,
    'graphite',
  );
});
