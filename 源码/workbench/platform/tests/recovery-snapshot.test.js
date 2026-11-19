'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  createUnifiedRepository,
  listRecoverySnapshots,
  inspectRecoverySnapshot,
  restoreRecoverySnapshot,
} = require('../adapters/encrypted/repository');
const fixture = require('../fixtures/synthetic.json');
const PASSWORD = 'Synthetic-recovery-QA-2026!';
const ROOT = path.resolve(
  process.env.PLATFORM_TEST_ROOT ||
    path.join(__dirname, '../../..', '构建/当前作业/测试'),
  'recovery-snapshot',
);
fs.mkdirSync(ROOT, { recursive: true });

async function workspace(t) {
  const file = path.join(ROOT, '恢复验证-' + crypto.randomUUID() + '.eap');
  const repository = await createUnifiedRepository({
    file,
    password: PASSWORD,
    create: true,
  });
  t.after(() => repository.close().catch(() => {}));
  return { repository, file };
}

test('a failed replacement keeps a decryptable recovery copy of the new data', async (t) => {
  const { repository, file } = await workspace(t);
  const before = fs.readFileSync(file);
  const original = fs.renameSync;
  fs.renameSync = (from, to) => {
    if (to === file) throw Object.assign(new Error('synthetic sharing fault'), { code: 'EPERM' });
    return original(from, to);
  };
  let caught;
  try {
    repository.saveLegacy(structuredClone(fixture.legacyState));
  } catch (error) {
    caught = error;
  } finally {
    fs.renameSync = original;
  }
  assert.equal(caught?.code, 'STORAGE_WRITE_FAILED');
  assert.equal(caught.details.recoverable, true);
  assert.match(caught.details.recoveryFile, /\.recovery-[0-9a-f-]{36}$/);
  assert.deepEqual(fs.readFileSync(file), before);

  const snapshots = listRecoverySnapshots(file);
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].name, caught.details.recoveryFile);
  const inspected = await inspectRecoverySnapshot({
    file,
    recoveryFile: snapshots[0].name,
    password: PASSWORD,
  });
  assert.deepEqual(inspected.state.legacyState, fixture.legacyState);
  await assert.rejects(
    inspectRecoverySnapshot({
      file,
      recoveryFile: snapshots[0].name,
      password: 'not-the-password',
    }),
    { code: 'VAULT_AUTH_FAILED' },
  );

  const result = await restoreRecoverySnapshot({
    file,
    recoveryFile: snapshots[0].name,
    password: PASSWORD,
  });
  assert.equal(result.restoredFrom, snapshots[0].name);
  assert.ok(fs.existsSync(path.join(path.dirname(file), result.preRestoreBackup)));
  assert.equal(listRecoverySnapshots(file).length, 0);
  assert.notDeepEqual(fs.readFileSync(file), before);

  // The recovery tool is an offline operation: release the live handle first.
  await repository.close();
  const reopened = await createUnifiedRepository({ file, password: PASSWORD });
  t.after(() => reopened.close().catch(() => {}));
  assert.deepEqual((await reopened.snapshot()).legacyState, fixture.legacyState);
});

test('recovery rejects unknown or foreign snapshot names before touching the workspace', async (t) => {
  const { repository, file } = await workspace(t);
  const before = fs.readFileSync(file);
  for (const name of ['../other.eap', 'other.eap.recovery-abc', path.basename(file) + '.pending-x']) {
    await assert.rejects(
      restoreRecoverySnapshot({ file, recoveryFile: name, password: PASSWORD }),
      { code: 'RECOVERY_INVALID' },
    );
  }
  assert.deepEqual(fs.readFileSync(file), before);
  await repository.close();
});

test('successful saves prune old recovery copies down to the newest three', async (t) => {
  const { repository, file } = await workspace(t);
  const prefix = path.basename(file) + '.recovery-';
  for (let index = 0; index < 5; index++) {
    fs.writeFileSync(
      path.join(path.dirname(file), prefix + `${index}`.padStart(8, '0') +
        '-0000-0000-0000-000000000000'),
      Buffer.from('synthetic-ciphertext'),
    );
  }
  const original = fs.renameSync;
  fs.renameSync = (from, to) => {
    if (to === file && path.basename(from).startsWith(path.basename(file) + '.pending-'))
      throw Object.assign(new Error('synthetic sharing fault'), { code: 'EPERM' });
    return original(from, to);
  };
  try {
    assert.throws(() => repository.saveLegacy(structuredClone(fixture.legacyState)));
  } finally {
    fs.renameSync = original;
  }
  repository.saveLegacy(structuredClone(fixture.legacyState));
  assert.ok(listRecoverySnapshots(file).length <= 3);
  await repository.close();
});
