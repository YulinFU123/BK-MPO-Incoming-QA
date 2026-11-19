'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createEncryptedRepository, restoreEncryptedBackup } = require('../adapters/encrypted/repository');
const { createPlatform } = require('../index');
const fixture = require('../fixtures/synthetic.json');

const ROOT = process.env.PLATFORM_QA_ROOT
  ? path.join(path.resolve(process.env.PLATFORM_QA_ROOT), 'storage')
  : path.resolve(__dirname, '../../../构建/当前作业/测试/storage');
const PASSWORD = 'synthetic-password-26!';
const code = value => error => error.code === value;
const file = label => {
  fs.mkdirSync(ROOT, { recursive: true });
  return path.join(ROOT, `${label}-${crypto.randomUUID()}.qav`);
};
const digest = target => crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');

async function repository(t, target = file('vault')) {
  const repo = await createEncryptedRepository({ file: target, password: PASSWORD, create: true });
  t.after(() => repo.close());
  return { repo, target };
}
async function populate(repo) {
  const platform = await createPlatform({ ...structuredClone(fixture), repository: repo });
  const preview = await platform.imports.previewRows(structuredClone(fixture));
  await platform.imports.commitPreview(preview.previewId);
  return platform;
}

test('encrypted repository persists imports and observations across close/reopen with no plaintext file', async t => {
  const { repo, target } = await repository(t);
  const platform = await populate(repo);
  assert.equal(platform.capabilities.productionPersistence, false);
  assert.equal(platform.capabilities.durableStorage, true);
  assert.equal(platform.capabilities.encryptedStorage, true);
  const before = await repo.snapshot();
  const raw = fs.readFileSync(target, 'utf8');
  assert.equal(raw.includes('0001Ab'), false);
  assert.equal(raw.includes('合成检验数据'), false);
  assert.equal(raw.includes(PASSWORD), false);
  const envelope = JSON.parse(raw);
  assert.equal(envelope.format, 'exception-analysis-platform-vault');
  assert.equal(envelope.cipher, 'aes-256-gcm');
  await repo.close();
  const reopened = await createEncryptedRepository({ file: target, password: PASSWORD });
  t.after(() => reopened.close());
  assert.deepEqual(await reopened.snapshot(), before);
  const restoredPlatform = await createPlatform({ repository: reopened });
  const report = await restoredPlatform.analysis.overview({ start: '2026-10-26', end: '2026-10-26', datasetId: fixture.dataset.id });
  assert.equal(report.observations.recordCount, 2);
  assert.equal(report.quality.rate.value, 0.02);
  const duplicate = await restoredPlatform.imports.previewRows(structuredClone(fixture));
  assert.equal((await restoredPlatform.imports.commitPreview(duplicate.previewId)).status, 'duplicate');
});

test('wrong passwords and authenticated-ciphertext tampering cannot overwrite data or retain locks', async t => {
  const { repo, target } = await repository(t);
  await populate(repo); await repo.close();
  const before = digest(target);
  await assert.rejects(createEncryptedRepository({ file: target, password: 'incorrect-password!' }), code('VAULT_AUTH_FAILED'));
  assert.equal(digest(target), before);
  assert.equal(fs.existsSync(target + '.lock'), false);
  const damaged = file('tampered');
  const envelope = JSON.parse(fs.readFileSync(target, 'utf8'));
  const bytes = Buffer.from(envelope.data, 'base64'); bytes[0] ^= 1;
  envelope.data = bytes.toString('base64');
  fs.writeFileSync(damaged, JSON.stringify(envelope));
  const damagedBefore = digest(damaged);
  await assert.rejects(createEncryptedRepository({ file: damaged, password: PASSWORD }), code('VAULT_AUTH_FAILED'));
  assert.equal(digest(damaged), damagedBefore);
  assert.equal(fs.existsSync(damaged + '.lock'), false);
});

test('new storage creation refuses overwrite, short password, relative path and legacy formats', async t => {
  const { repo, target } = await repository(t);
  const before = digest(target);
  await assert.rejects(createEncryptedRepository({ file: target, password: PASSWORD, create: true }), code('STORAGE_EXISTS'));
  await assert.rejects(createEncryptedRepository({ file: file('short'), password: '123', create: true }), code('PASSWORD_INVALID'));
  await assert.rejects(createEncryptedRepository({ file: 'relative.qav', password: PASSWORD, create: true }), code('STORAGE_PATH_INVALID'));
  assert.equal(digest(target), before);
  const old = file('old-format');
  fs.writeFileSync(old, JSON.stringify({ format: 'quality-desk-encrypted-vault', version: 1 }));
  const oldBefore = digest(old);
  await assert.rejects(createEncryptedRepository({ file: old, password: PASSWORD }), code('VAULT_FORMAT_INVALID'));
  assert.equal(digest(old), oldBefore);
  await repo.close();
});

test('exclusive process lock prevents a second opener and does not delete an uncertain pre-existing lock', async t => {
  const { repo, target } = await repository(t);
  await assert.rejects(createEncryptedRepository({ file: target, password: PASSWORD }), code('STORAGE_IN_USE'));
  assert.equal(fs.existsSync(target + '.lock'), true);
  await repo.close();
  assert.equal(fs.existsSync(target + '.lock'), false);
  const stale = file('stale');
  const payload = JSON.stringify({ token: 'unknown-owner', pid: 0 });
  fs.writeFileSync(stale + '.lock', payload);
  await assert.rejects(createEncryptedRepository({ file: stale, password: PASSWORD, create: true }), code('STORAGE_IN_USE'));
  assert.equal(fs.readFileSync(stale + '.lock', 'utf8'), payload);
  assert.equal(fs.existsSync(stale), false);
});

test('transaction callback failure and invalid candidate preserve both memory and encrypted file', async t => {
  const { repo, target } = await repository(t);
  const before = digest(target);
  await assert.rejects(repo.transaction(tx => { tx.putDataset(fixture.dataset); throw new Error('synthetic failure'); }));
  assert.equal(digest(target), before);
  assert.equal((await repo.snapshot()).datasets.length, 0);
  await assert.rejects(repo.transaction(tx => tx.addBatch({ identity: 'not-a-valid-batch' })), code('STORAGE_STATE_INVALID'));
  assert.equal(digest(target), before);
  assert.equal((await repo.snapshot()).batches.length, 0);
});

test('a failed atomic replacement rolls back visible memory and leaves no partial ciphertext temp', async t => {
  const { repo, target } = await repository(t);
  const before = digest(target);
  const originalRename = fs.renameSync;
  fs.renameSync = (from, to) => {
    if (to === target) { const error = new Error('synthetic disk failure'); error.code = 'EIO'; throw error; }
    return originalRename(from, to);
  };
  try {
    await assert.rejects(repo.transaction(tx => tx.putDataset(fixture.dataset)), code('STORAGE_WRITE_FAILED'));
  } finally { fs.renameSync = originalRename; }
  assert.equal(digest(target), before);
  assert.equal((await repo.snapshot()).datasets.length, 0);
  assert.equal(fs.readdirSync(ROOT).some(name => name.startsWith(path.basename(target) + '.pending-')), false);
  const recoveryPrefix = path.basename(target) + '.recovery-';
  assert.equal(fs.readdirSync(ROOT).filter(name => name.startsWith(recoveryPrefix)).length, 1);
  await repo.transaction(tx => tx.putDataset(fixture.dataset));
  assert.equal((await repo.snapshot()).datasets.length, 1);
  for (const name of fs.readdirSync(ROOT).filter(entry => entry.startsWith(recoveryPrefix)))
    fs.unlinkSync(path.join(ROOT, name));
});

test('snapshot clones and serialized concurrent transactions preserve isolation', async t => {
  const { repo } = await repository(t);
  const events = [];
  await Promise.all([
    repo.transaction(async tx => { events.push('a-start'); await Promise.resolve(); tx.putDataset(fixture.dataset); events.push('a-end'); }),
    repo.transaction(tx => { events.push('b-start'); assert.equal(tx.getDataset(fixture.dataset.id).version, '1'); events.push('b-end'); })
  ]);
  assert.deepEqual(events, ['a-start', 'a-end', 'b-start', 'b-end']);
  const state = await repo.snapshot(); state.datasets[0].version = 'changed';
  assert.equal((await repo.snapshot()).datasets[0].version, '1');
});

test('locking during an awaited transaction rejects its commit and every later operation', async t => {
  const { repo, target } = await repository(t);
  const before = digest(target);
  let release;
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const pending = repo.transaction(async tx => { started(); await new Promise(resolve => { release = resolve; }); tx.putDataset(fixture.dataset); });
  await ready;
  const closed = repo.lock();
  release();
  await assert.rejects(pending, code('WORKSPACE_LOCKED'));
  await closed;
  await assert.rejects(repo.snapshot(), code('WORKSPACE_LOCKED'));
  await assert.rejects(repo.transaction(() => {}), code('WORKSPACE_LOCKED'));
  await assert.rejects(repo.backup({ file: file('locked-backup') }), code('WORKSPACE_LOCKED'));
  assert.equal(digest(target), before);
  assert.equal(fs.existsSync(target + '.lock'), false);
});

test('encrypted backup authenticates before restore, restores to a new file and never overwrites', async t => {
  const { repo, target } = await repository(t);
  await populate(repo);
  const backupFile = file('backup');
  const result = await repo.backup({ file: backupFile });
  assert.ok(result.bytes > 0);
  assert.equal(fs.readFileSync(backupFile, 'utf8').includes('0001Ab'), false);
  await assert.rejects(repo.backup({ file: backupFile }), code('STORAGE_EXISTS'));
  const wrongDestination = file('wrong-restore');
  await assert.rejects(restoreEncryptedBackup({ backupFile, file: wrongDestination, password: 'wrong-password-26!' }), code('VAULT_AUTH_FAILED'));
  assert.equal(fs.existsSync(wrongDestination), false);
  const destination = file('restored');
  const restored = await restoreEncryptedBackup({ backupFile, file: destination, password: PASSWORD });
  t.after(() => restored.close());
  assert.deepEqual(await restored.snapshot(), await repo.snapshot());
  assert.notEqual(digest(destination), digest(backupFile));
  const before = digest(target);
  await assert.rejects(restoreEncryptedBackup({ backupFile, file: target, password: PASSWORD }), code('STORAGE_EXISTS'));
  assert.equal(digest(target), before);
});

test('warning totals and truncation metadata survive persistence while invalid totals are rejected', async t => {
  const { repo, target } = await repository(t);
  await populate(repo);
  const snapshot = await repo.snapshot();
  const batch = snapshot.batches[0];
  await repo.transaction(tx => tx.addBatch({
    ...batch, id: 'synthetic-warning-batch', identity: crypto.randomBytes(32).toString('hex'),
    factCount: 0, warningCodes: ['CACHED_FORMULA'], warningCount: 123, warningsTruncated: true,
    warningsAcknowledged: true
  }));
  const before = digest(target);
  for (const value of [-1, 1.5, 1000001, '3']) {
    await assert.rejects(repo.transaction(tx => tx.addBatch({
      ...batch, id: crypto.randomUUID(), identity: crypto.randomBytes(32).toString('hex'),
      factCount: 0, warningCodes: [], warningCount: value, warningsTruncated: false
    })), code('STORAGE_STATE_INVALID'));
    assert.equal(digest(target), before);
  }
  await assert.rejects(repo.transaction(tx => tx.addBatch({
    ...batch, id: crypto.randomUUID(), identity: crypto.randomBytes(32).toString('hex'),
    factCount: 0, warningCodes: ['CACHED_FORMULA'], warningCount: 0, warningsTruncated: true
  })), code('STORAGE_STATE_INVALID'));
  await assert.rejects(repo.transaction(tx => tx.addBatch({
    ...batch, id: crypto.randomUUID(), identity: crypto.randomBytes(32).toString('hex'),
    factCount: 0, warningCodes: [], warningCount: 0, warningsTruncated: 'yes'
  })), code('STORAGE_STATE_INVALID'));
  assert.equal(digest(target), before);
  await repo.close();
  const reopened = await createEncryptedRepository({ file: target, password: PASSWORD });
  t.after(() => reopened.close());
  const retained = (await reopened.snapshot()).batches.find(item => item.id === 'synthetic-warning-batch');
  assert.equal(retained.warningCount, 123);
  assert.equal(retained.warningsTruncated, true);
});

test('sparse warning arrays with extra numeric properties cannot corrupt a saved vault', async t => {
  const { repo, target } = await repository(t);
  const beforeFile = digest(target);
  const beforeState = await repo.snapshot();
  const malformed = new Array(1);
  malformed['4294967295'] = 'SYNTHETIC_WARNING';
  await assert.rejects(repo.transaction(tx => {
    tx.putDataset(fixture.dataset);
    tx.addBatch({
      id: 'synthetic-sparse-batch', identity: 'a'.repeat(64),
      datasetId: fixture.dataset.id, datasetVersion: fixture.dataset.version,
      mappingFingerprint: 'b'.repeat(64), factCount: 0, committedAt: 1,
      provenance: { identityBasis: 'normalized-rows-sha256', contentHash: 'c'.repeat(64), sheetName: 'Synthetic', headerRow: 1 },
      warningCodes: malformed, warningCount: 1, warningsTruncated: false,
      warningsAcknowledged: true
    });
  }), code('STORAGE_STATE_INVALID'));
  assert.equal(digest(target), beforeFile);
  assert.deepEqual(await repo.snapshot(), beforeState);
  await repo.close();
  const reopened = await createEncryptedRepository({ file: target, password: PASSWORD });
  t.after(() => reopened.close());
  assert.deepEqual(await reopened.snapshot(), beforeState);
});
