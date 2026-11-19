'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { registerPlatformIpc, CHANNELS } = require('../desktop/register-platform-ipc');
const { PlatformError } = require('../domain/errors');

function setup(overrides = {}) {
  const handlers = new Map();
  const removed = [];
  const calls = [];
  const ipcMain = {
    handle(channel, callback) {
      if (handlers.has(channel)) throw new Error('duplicate handler');
      handlers.set(channel, callback);
    },
    removeHandler(channel) { removed.push(channel); handlers.delete(channel); }
  };
  const platform = {
    capabilities: { status: 'development', automaticBiExport: false, productionPersistence: false },
    imports: {
      previewRows: async input => { calls.push(['preview', input]); return { previewId: 'preview-1' }; },
      commitPreview: async id => { calls.push(['commit', id]); return { status: 'imported' }; },
      cancelPreview: id => { calls.push(['cancel', id]); return true; }
    },
    analysis: { overview: async input => { calls.push(['overview', input]); return { recordCount: 2 }; } }
  };
  const dispose = registerPlatformIpc({ ipcMain, isTrusted: () => true, isUnlocked: () => true, platform, ...overrides });
  return { handlers, removed, calls, ipcMain, platform, dispose, invoke: (channel, ...args) => handlers.get(channel)({}, ...args) };
}

test('desktop adapter registers exactly the reserved channels and routes valid calls', async () => {
  const host = setup();
  assert.deepEqual([...host.handlers.keys()], CHANNELS);
  assert.equal((await host.invoke('platform:capabilities')).value.status, 'development');
  assert.equal((await host.invoke('platform:preview-rows', { rows: [], dataset: {}, mapping: {} })).value.previewId, 'preview-1');
  assert.equal((await host.invoke('platform:commit-preview', 'preview-1')).value.status, 'imported');
  assert.equal((await host.invoke('platform:overview', { start: '2026-10-26', end: '2026-10-26' })).value.recordCount, 2);
  assert.equal((await host.invoke('platform:cancel-preview', 'preview-1')).value, true);
  assert.equal(host.calls.length, 4);
  assert.equal(host.handlers.has('platform:read-file'), false);
});

test('desktop adapter rejects untrusted and locked senders for every channel', async () => {
  for (const [overrides, code] of [[{ isTrusted: () => false }, 'UNTRUSTED_SENDER'], [{ isUnlocked: () => false }, 'WORKSPACE_LOCKED']]) {
    const host = setup(overrides);
    for (const channel of CHANNELS) assert.equal((await host.invoke(channel)).error.code, code);
    assert.equal(host.calls.length, 0);
  }
});

test('desktop adapter does not cache unlock status while trust decisions await', async () => {
  let resolveTrust;
  let unlocked = true;
  const host = setup({ isTrusted: () => new Promise(resolve => { resolveTrust = resolve; }), isUnlocked: () => unlocked });
  const response = host.invoke('platform:overview', {});
  unlocked = false;
  resolveTrust(true);
  assert.equal((await response).error.code, 'WORKSPACE_LOCKED');
  assert.equal(host.calls.length, 0);
});

test('desktop adapter validates JSON before invoking application methods', async () => {
  const host = setup();
  let getterCalled = false;
  const accessor = {};
  Object.defineProperty(accessor, 'secret', { enumerable: true, get() { getterCalled = true; return 'secret'; } });
  const deep = {};
  let pointer = deep;
  for (let i = 0; i < 20; i++) pointer = pointer.next = {};
  const unsafe = JSON.parse('{"__proto__":{"polluted":true}}');
  for (const value of [null, [], () => {}, { callback() {} }, accessor, deep, unsafe,
    { payload: 'x'.repeat(8 * 1024 * 1024 + 1) }, { items: Array.from({ length: 250001 }, () => null) }]) {
    const response = await host.invoke('platform:overview', value);
    assert.equal(response.ok, false);
  }
  assert.equal(getterCalled, false);
  assert.equal(host.calls.length, 0);
  assert.equal({}.polluted, undefined);
  assert.equal((await host.invoke('platform:overview', {}, {})).error.code, 'INVALID_ARGUMENT');
  assert.equal((await host.invoke('platform:capabilities', {})).error.code, 'INVALID_ARGUMENT');
  for (const id of ['', ' ', 1, {}, 'a'.repeat(129)]) assert.equal((await host.invoke('platform:commit-preview', id)).ok, false);
});

test('desktop adapter withholds a pending analysis result if workspace relocks', async () => {
  let unlocked = true;
  const host = setup({ isUnlocked: () => unlocked });
  host.platform.analysis.overview = async () => { unlocked = false; return { sensitive: 'result' }; };
  const response = await host.invoke('platform:overview', {});
  assert.equal(response.error.code, 'WORKSPACE_LOCKED');
  assert.equal(Object.hasOwn(response, 'value'), false);
});

test('desktop adapter clones caller arguments and returned values', async () => {
  const host = setup();
  const input = { rows: [{ text: '0012' }] };
  await host.invoke('platform:preview-rows', input);
  input.rows[0].text = 'changed';
  assert.equal(host.calls[0][1].rows[0].text, '0012');
  const capabilities = await host.invoke('platform:capabilities');
  capabilities.value.status = 'changed';
  assert.equal(host.platform.capabilities.status, 'development');
});

test('desktop adapter permits explicit warning acknowledgement without accepting host controls', async () => {
  const host = setup();
  let options;
  host.platform.imports.commitPreview = async (id, input) => { options = input; return { id }; };
  const response = await host.invoke('platform:commit-preview', { previewId: 'preview-1', acknowledgeWarnings: true });
  assert.equal(response.value.id, 'preview-1');
  assert.equal(options.acknowledgeWarnings, true);
  assert.equal(typeof options.authorize, 'function');
  assert.equal((await host.invoke('platform:commit-preview', { previewId: 'preview-1', authorize: true })).error.code, 'INVALID_ARGUMENT');
  assert.equal((await host.invoke('platform:commit-preview', { previewId: 'preview-1', acknowledgeWarnings: 'yes' })).error.code, 'INVALID_ARGUMENT');
});

test('desktop adapter returns safe business errors and hides unexpected stack/details', async () => {
  const host = setup();
  host.platform.analysis.overview = async () => { throw new PlatformError('INVALID_RANGE', '日期范围无效。', { password: 'secret' }); };
  const expected = await host.invoke('platform:overview', {});
  assert.deepEqual(expected, { ok: false, error: { code: 'INVALID_RANGE', message: '日期范围无效。' } });
  host.platform.analysis.overview = async () => { throw new Error('secret path C:\\private'); };
  const unexpected = await host.invoke('platform:overview', {});
  assert.equal(unexpected.error.code, 'INTERNAL_ERROR');
  assert.equal(JSON.stringify(unexpected).includes('private'), false);
  assert.equal(JSON.stringify(unexpected).includes('stack'), false);
});

test('desktop adapter disposer only removes own installed channels and is idempotent', () => {
  const host = setup();
  host.ipcMain.handle('unrelated:existing', () => true);
  host.dispose();
  host.dispose();
  assert.deepEqual([...host.handlers.keys()], ['unrelated:existing']);
  assert.equal(host.removed.length, CHANNELS.length);
});

test('desktop adapter partial registration failure preserves existing handlers', () => {
  const handlers = new Map([['platform:overview', () => 'existing']]);
  const removed = [];
  const ipcMain = {
    handle(channel, fn) { if (handlers.has(channel)) throw new Error('duplicate'); handlers.set(channel, fn); },
    removeHandler(channel) { removed.push(channel); handlers.delete(channel); }
  };
  const platform = { imports: { previewRows() {}, commitPreview() {}, cancelPreview() {} }, analysis: { overview() {} } };
  assert.throws(() => registerPlatformIpc({ ipcMain, platform, isTrusted: () => true, isUnlocked: () => true }), /duplicate/);
  assert.deepEqual([...handlers.keys()], ['platform:overview']);
  assert.deepEqual(removed.sort(), CHANNELS.slice(0, 3).sort());
});

test('disposed desktop adapter cannot return an old pending result after a new session opens', async () => {
  const host = setup();
  let release;
  host.platform.analysis.overview = () => new Promise(resolve => { release = resolve; });
  const pending = host.invoke('platform:overview', {});
  while (!release) await Promise.resolve();
  host.dispose();
  release({ sensitive: 'old-session' });
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'DESKTOP_ADAPTER_DISPOSED');
  assert.equal(Object.hasOwn(result, 'value'), false);
});
