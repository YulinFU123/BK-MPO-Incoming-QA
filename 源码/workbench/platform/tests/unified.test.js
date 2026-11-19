'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createMemoryRepository } = require('../adapters/memory/quality-repository');
const { createEncryptedRepository, createUnifiedRepository, restoreUnifiedBackup } = require('../adapters/encrypted/repository');
const { createPlatform } = require('../index');
const fixture = require('../fixtures/synthetic.json');
const ROOT = process.env.PLATFORM_QA_ROOT ? path.join(path.resolve(process.env.PLATFORM_QA_ROOT), 'unified') : path.resolve(__dirname, '../../../构建/当前作业/测试/unified');
const PASSWORD = 'Synthetic-Unified-2026!';
const NEXT = 'Synthetic-Unified-Next-2026!';
const code = expected => error => error.code === expected;
const target = name => { fs.mkdirSync(ROOT, { recursive: true }); return path.join(ROOT, `${name}-${crypto.randomUUID()}.qav`); };
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function fullLegacyState() {
  const state = structuredClone(fixture.legacyState);
  state.prefix = 'Synthetic-project'; state.activeTemplateId = 'incoming';
  state.records[0].workflow = { status: '处理中', owner: '合成测试人员', dueDate: '2026-10-30', result: '' };
  state.records[0].history = [{ at: '2026-10-26T01:02:00Z', action: '修改内容', values: { silk: '0012' }, workflow: { status: '待处理' } }];
  state.deletedRecords = [{ ...structuredClone(state.records[1]), id: 'deleted-synthetic' }];
  state.batchDraft = { templateId: 'incoming', snId: 'sn', values: { process: '装管' }, codes: ['00PendingAb'] };
  state.pendingUI = { templateId: 'incoming', values: { silk: '0012', sn: '00Draft' }, savedLocalDate: '2026-10-26', view: 'entry', settingsDraft: { custom: 'synthetic' } };
  state.customFutureSetting = { preserve: true, choice: ['0012', '12', 'Ab12'] };
  return state;
}

async function unified(t) {
  const file = target('workspace');
  const repository = await createUnifiedRepository({ file, password: PASSWORD, create: true });
  t.after(() => repository.close());
  return { repository, file };
}

test('unified memory mode preserves full legacy state without changing default snapshot shape', async () => {
  const ordinary = createMemoryRepository();
  assert.equal(ordinary.unified, false);
  assert.deepEqual(Object.keys(await ordinary.snapshot()).sort(), ['batches', 'datasets', 'facts', 'observations']);
  const repository = createMemoryRepository({ legacyStateEnabled: true });
  assert.equal(repository.unified, true);
  assert.equal((await repository.snapshot()).legacyState, null);
  const state = fullLegacyState();
  await repository.transaction(tx => tx.replaceLegacyState(state));
  state.customFutureSetting.preserve = false;
  assert.equal((await repository.snapshot()).legacyState.customFutureSetting.preserve, true);
  await assert.rejects(repository.transaction(tx => { tx.replaceLegacyState(null); throw new Error('synthetic rollback'); }));
  assert.equal((await repository.snapshot()).legacyState.customFutureSetting.preserve, true);
  repository.replaceLegacySync(state);
  assert.equal((await repository.snapshot()).legacyState.customFutureSetting.preserve, false);
});

test('synchronous memory saves reject pending transactions and platform construction never replaces an existing full snapshot', async () => {
  const repository = createMemoryRepository({ legacyStateEnabled: true });
  const legacy = fullLegacyState();
  repository.replaceLegacySync(legacy);
  let release;
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const pending = repository.transaction(async () => { started(); await new Promise(resolve => { release = resolve; }); });
  await ready;
  assert.throws(() => repository.replaceLegacySync(fixture.legacyState), code('STORAGE_BUSY'));
  release(); await pending;
  await createPlatform({ repository, legacyState: fixture.legacyState });
  assert.deepEqual((await repository.snapshot()).legacyState, legacy);
});

test('one unified encrypted file retains BI facts and the complete unmodified legacy workflow snapshot', async t => {
  const { repository, file } = await unified(t);
  const legacy = fullLegacyState();
  const expectedLegacy = structuredClone(legacy);
  repository.saveLegacy(legacy);
  legacy.customFutureSetting.choice[0] = 'changed';
  const platform = await createPlatform({ repository });
  const preview = await platform.imports.previewRows(structuredClone(fixture));
  await platform.imports.commitPreview(preview.previewId);
  const snapshot = await repository.snapshot();
  assert.deepEqual(snapshot.legacyState, expectedLegacy);
  assert.equal(snapshot.facts.length, 2);
  assert.equal(snapshot.legacyState.records.length, 2);
  assert.equal((await platform.analysis.overview({ start: '2026-10-26', end: '2026-10-26', datasetId: fixture.dataset.id })).observations.recordCount, 2);
  const envelope = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(envelope.format, 'exception-unified-platform');
  assert.equal(fs.readFileSync(file, 'utf8').includes('customFutureSetting'), false);
  assert.equal(repository.unified, true);
  await repository.close();
  const reopened = await createUnifiedRepository({ file, password: PASSWORD });
  t.after(() => reopened.close());
  assert.deepEqual(await reopened.snapshot(), snapshot);
});

test('synchronous legacy saves reject busy work rather than overwriting an asynchronous BI transaction', async t => {
  const { repository, file } = await unified(t);
  assert.throws(() => repository.legacyBackup(), code('LEGACY_STATE_MISSING'));
  const before = hash(file);
  let release;
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const pending = repository.transaction(async tx => { started(); await new Promise(resolve => { release = resolve; }); tx.putDataset(fixture.dataset); });
  await ready;
  assert.throws(() => repository.saveLegacy(fullLegacyState()), code('STORAGE_BUSY'));
  assert.equal(hash(file), before);
  release(); await pending;
  repository.saveLegacy(fullLegacyState());
  const current = await repository.snapshot();
  assert.equal(current.datasets.length, 1);
  assert.equal(current.legacyState.batchDraft.codes[0], '00PendingAb');
  const saved = hash(file);
  assert.throws(() => repository.saveLegacy(null));
  assert.equal(hash(file), saved);
});

test('legacy save failure preserves the unified cache, BI facts and original ciphertext', async t => {
  const { repository, file } = await unified(t);
  repository.saveLegacy(fullLegacyState());
  const before = await repository.snapshot();
  const encrypted = hash(file);
  const next = fullLegacyState(); next.prefix = 'changed';
  const originalRename = fs.renameSync;
  fs.renameSync = (from, to) => { if (to === file) { const error = new Error('synthetic write fault'); error.code = 'EIO'; throw error; } return originalRename(from, to); };
  try { assert.throws(() => repository.saveLegacy(next), code('STORAGE_WRITE_FAILED')); }
  finally { fs.renameSync = originalRename; }
  assert.equal(hash(file), encrypted);
  assert.deepEqual(await repository.snapshot(), before);
});

test('unified password rotation authenticates current password and retains both data models', async t => {
  const { repository, file } = await unified(t);
  repository.saveLegacy(fullLegacyState());
  const platform = await createPlatform({ repository });
  const preview = await platform.imports.previewRows(structuredClone(fixture));
  await platform.imports.commitPreview(preview.previewId);
  const before = await repository.snapshot();
  assert.equal(before.facts.length, 2);
  const raw = hash(file);
  await assert.rejects(repository.changePassword('incorrect-synthetic', NEXT), code('VAULT_AUTH_FAILED'));
  assert.equal(hash(file), raw);
  await repository.changePassword(PASSWORD, NEXT);
  assert.notEqual(hash(file), raw);
  assert.deepEqual(await repository.snapshot(), before);
  await repository.close();
  await assert.rejects(createUnifiedRepository({ file, password: PASSWORD }), code('VAULT_AUTH_FAILED'));
  const reopened = await createUnifiedRepository({ file, password: NEXT });
  t.after(() => reopened.close());
  assert.deepEqual(await reopened.snapshot(), before);
});

test('failed password replacement preserves the old key and ciphertext, and locking cancels pending rotation', async t => {
  const { repository, file } = await unified(t);
  repository.saveLegacy(fullLegacyState());
  const before = hash(file);
  const originalRename = fs.renameSync;
  fs.renameSync = (from, to) => { if (to === file) { const error = new Error('synthetic rotation write fault'); error.code = 'EIO'; throw error; } return originalRename(from, to); };
  try { await assert.rejects(repository.changePassword(PASSWORD, NEXT), code('STORAGE_WRITE_FAILED')); }
  finally { fs.renameSync = originalRename; }
  assert.equal(hash(file), before);
  const { legacyRoot } = require('../adapters/legacy/full-state');
  const codec = require(path.join(legacyRoot(), 'vault.js'));
  const verified = await codec.open(repository.legacyBackup(), PASSWORD);
  verified.key.fill(0);
  const changing = repository.changePassword(PASSWORD, NEXT);
  await Promise.resolve();
  const closing = repository.close();
  await assert.rejects(changing, code('WORKSPACE_LOCKED'));
  await closing;
  assert.equal(hash(file), before);
  const reopened = await createUnifiedRepository({ file, password: PASSWORD });
  t.after(() => reopened.close());
  assert.equal((await reopened.snapshot()).legacyState.customFutureSetting.preserve, true);
});

test('unified backups restore all state to a new file and legacy exports open with the original vault codec', async t => {
  const { repository } = await unified(t);
  const legacy = fullLegacyState(); repository.saveLegacy(legacy);
  const backup = target('full-backup');
  await repository.backup({ file: backup });
  const destination = target('full-restored');
  const restored = await restoreUnifiedBackup({ backupFile: backup, file: destination, password: PASSWORD });
  t.after(() => restored.close());
  assert.deepEqual(await restored.snapshot(), await repository.snapshot());
  const { legacyRoot } = require('../adapters/legacy/full-state');
  const originalCodec = require(path.join(legacyRoot(), 'vault.js'));
  const opened = await originalCodec.open(repository.legacyBackup(), PASSWORD);
  try { assert.deepEqual(opened.data, legacy); } finally { opened.key.fill(0); }
  const exported = JSON.parse(repository.legacyBackup());
  assert.equal(exported.format, 'quality-desk-encrypted-vault');
  assert.equal(exported.version, 1);
});

test('early analysis files require explicit copy migration and never get overwritten by unified open', async t => {
  const file = target('early-analysis');
  const previous = await createEncryptedRepository({ file, password: PASSWORD, create: true });
  await previous.close();
  const before = hash(file);
  await assert.rejects(createUnifiedRepository({ file, password: PASSWORD }), code('MIGRATION_REQUIRES_COPY'));
  assert.equal(hash(file), before);
  assert.equal(fs.existsSync(file + '.lock'), false);
});
