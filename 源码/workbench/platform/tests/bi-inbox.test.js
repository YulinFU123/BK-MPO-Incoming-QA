'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict');
const { createInboxHost } = require('../desktop/bi-inbox-host');
const schema = require('../domain/module-state');
test('inbox settings use a separate validated module and do not carry business rows', () => {
  const address = schema.address({ scope: 'module', module: 'bi-inbox' }),
    defaults = schema.defaultData(address);
  assert.equal(defaults.enabled, false);
  assert.equal(defaults.replace, false);
  assert.throws(() => schema.validate(address, { enabled: true }));
  assert.throws(() => schema.validate(address, { rows: [{ sn: 'private' }] }));
  const next = schema.validate(address, {
    folder: 'D:/synthetic',
    scope: 'Scope A',
    enabled: true,
  });
  assert.equal(next.scope, 'Scope A');
  assert.notDeepEqual(address, schema.address({ scope: 'module', module: 'bi-export' }));
});
test('inbox grants a folder only through pick or remembered settings and cancels a stale workspace', async () => {
  let epoch = 1,
    release;
  let stored = {
    data: { folder: '', scope: '', floor: '', enabled: false, replace: false },
    revision: 0,
  };
  const grants = [];
  const memory = {
    readModuleState: async () => structuredClone(stored),
    saveModuleState: async (row) => {
      stored = { data: row.data, revision: stored.revision + 1 };
      return stored;
    },
  };
  const host = createInboxHost({
    memory,
    active: () => epoch,
    pick: async () => new Promise((r) => (release = r)),
    grant: async (p) => grants.push(p),
    request: async () => ({ ok: true }),
  });
  await assert.rejects(
    host({ action: 'save', data: { ...stored.data, folder: 'C:/not-picked' } }),
    (e) => e.code === 'INBOX_PICK_REQUIRED',
  );
  const pending = host({ action: 'pick' });
  await new Promise((r) => setImmediate(r));
  epoch = 2;
  release('D:/synthetic');
  await assert.rejects(pending, (e) => e.code === 'SESSION_CHANGED');
  assert.deepEqual(grants, []);
  assert.equal(stored.revision, 0);
});
test('two overlapping polls cannot double-import and settings are not overwritten', async () => {
  let finish;
  const data = { folder: 'D:/synthetic', scope: 'A', floor: '', enabled: true, replace: false };
  const host = createInboxHost({
    memory: { readModuleState: async () => ({ data, revision: 3 }) },
    active: () => 1,
    pick: async () => null,
    grant: async () => {},
    request: async () => new Promise((r) => (finish = r)),
  });
  const first = host({ action: 'poll' });
  await new Promise((r) => setImmediate(r));
  await assert.rejects(host({ action: 'poll' }), (e) => e.code === 'BI_BUSY');
  finish({ ok: true, completedCount: 1 });
  assert.equal((await first).completedCount, 1);
  assert.equal(data.scope, 'A');
});
