'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createUnifiedRepository } = require('../adapters/encrypted/repository');
const fixture = require('../fixtures/synthetic.json');
const PASSWORD = 'Synthetic-storage-failure-only-2026!';
const ROOT = path.resolve(
  process.env.PLATFORM_TEST_ROOT || path.join(__dirname, '../../../../构建/当前作业/测试'),
  'storage-failure',
);
fs.mkdirSync(ROOT, { recursive: true });
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

async function workspace(t) {
  const file = path.join(ROOT, `synthetic-${crypto.randomUUID()}.eap`);
  const repository = await createUnifiedRepository({ file, password: PASSWORD, create: true });
  t.after(() => repository.close());
  return { repository, file };
}

for (const [method, phase, reason] of [
  ['openSync', 'create-temporary', 'EACCES'],
  ['writeFileSync', 'write-temporary', 'ENOSPC'],
  ['fsyncSync', 'sync-temporary', 'EIO'],
  ['closeSync', 'close-temporary', 'EIO'],
]) {
  test(`${phase}: failed save preserves bytes/cache, reports safe cause and can retry`, async (t) => {
    const { repository, file } = await workspace(t);
    const before = hash(file);
    const state = await repository.snapshot();
    const original = fs[method];
    let fired = false;
    fs[method] = (...args) => {
      if (!fired) {
        fired = true;
        throw Object.assign(new Error(`private path / employee / SN ${file}`), {
          code: reason,
          path: file,
        });
      }
      return original(...args);
    };
    try {
      assert.throws(
        () => repository.saveLegacy(structuredClone(fixture.legacyState)),
        (error) => {
          assert.equal(error.code, 'STORAGE_WRITE_FAILED');
          assert.equal(error.details.phase, phase);
          assert.equal(error.details.reason, reason);
          assert.equal(error.details.attempts, 1);
          assert.equal(error.details.temporaryCleaned, true);
          assert.equal(error.details.recoverable, false);
          assert.ok(Number.isInteger(error.details.elapsedMs) && error.details.elapsedMs >= 0);
          assert.ok(!JSON.stringify(error).includes(file));
          assert.ok(!error.message.includes('private path'));
          assert.match(error.message, /保留当前输入/);
          return true;
        },
      );
    } finally {
      fs[method] = original;
    }
    assert.equal(hash(file), before);
    assert.deepEqual(await repository.snapshot(), state);
    assert.ok(
      !fs.readdirSync(ROOT).some((name) => name.startsWith(path.basename(file) + '.pending-')),
    );
    repository.saveLegacy(structuredClone(fixture.legacyState));
    await repository.close();
    const reopened = await createUnifiedRepository({ file, password: PASSWORD });
    t.after(() => reopened.close());
    assert.deepEqual((await reopened.snapshot()).legacyState, fixture.legacyState);
  });
}

test('a temporary the operation did not create is never removed after exclusive-create failure', async (t) => {
  const { repository, file } = await workspace(t);
  const open = fs.openSync;
  const unlink = fs.unlinkSync;
  let removed = 0;
  fs.openSync = () => {
    throw Object.assign(new Error('synthetic collision'), { code: 'EEXIST' });
  };
  fs.unlinkSync = () => {
    removed++;
  };
  try {
    assert.throws(
      () => repository.saveLegacy(structuredClone(fixture.legacyState)),
      (error) => error.code === 'STORAGE_EXISTS',
    );
  } finally {
    fs.openSync = open;
    fs.unlinkSync = unlink;
  }
  assert.equal(removed, 0);
  assert.equal((await repository.snapshot()).legacyState, null);
  assert.ok(fs.existsSync(file));
});

test('cleanup denial is visible, leaves only encrypted temporary and never changes original', async (t) => {
  const { repository, file } = await workspace(t);
  const before = hash(file);
  const write = fs.writeFileSync;
  const unlink = fs.unlinkSync;
  fs.writeFileSync = () => {
    throw Object.assign(new Error('private row values'), { code: 'EIO' });
  };
  fs.unlinkSync = () => {
    throw Object.assign(new Error('private path'), { code: 'EACCES' });
  };
  try {
    assert.throws(
      () => repository.saveLegacy(structuredClone(fixture.legacyState)),
      (error) => {
        assert.equal(error.details.phase, 'write-temporary');
        assert.equal(error.details.reason, 'EIO');
        assert.equal(error.details.temporaryCleaned, false);
        return true;
      },
    );
  } finally {
    fs.writeFileSync = write;
    fs.unlinkSync = unlink;
  }
  assert.equal(hash(file), before);
  const leftovers = fs
    .readdirSync(ROOT)
    .filter((name) => name.startsWith(path.basename(file) + '.pending-'));
  assert.equal(leftovers.length, 1);
  // Exact synthetic files owned by this test only; do not remove uncertain app files.
  for (const name of leftovers) {
    const ownedFile = path.join(ROOT, name);
    assert.equal(fs.readFileSync(ownedFile, 'utf8').includes('private row values'), false);
    fs.unlinkSync(ownedFile);
  }
});
