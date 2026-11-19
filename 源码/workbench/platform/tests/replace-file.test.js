'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { replaceFile } = require('../adapters/encrypted/replace-file');
const { createUnifiedRepository } = require('../adapters/encrypted/repository');
const fixture = require('../fixtures/synthetic.json');
const PASSWORD = 'Synthetic-only-QA-2026!';
const ROOT = path.resolve(
  process.env.PLATFORM_TEST_ROOT || path.join(__dirname, '../../..', '构建/当前作业/测试'),
  'atomic-save',
);
fs.mkdirSync(ROOT, { recursive: true });
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const fault = (code) => Object.assign(new Error('synthetic I/O fault'), { code });

async function workspace(t) {
  const file = path.join(ROOT, '构造数据-' + crypto.randomUUID() + '.eap');
  const repository = await createUnifiedRepository({ file, password: PASSWORD, create: true });
  t.after(() => repository.close());
  return { repository, file };
}

test('transient Windows sharing failures retry the same atomic operation and commit once', () => {
  let calls = 0,
    commits = 0;
  const waits = [];
  const receipt = replaceFile('synthetic-source', 'synthetic-target', {
    platform: 'win32',
    wait: (ms) => waits.push(ms),
    rename: () => {
      calls++;
      if (calls < 3) throw fault(calls === 1 ? 'EPERM' : 'EBUSY');
      commits++;
    },
  });
  assert.equal(commits, 1);
  assert.equal(receipt.attempts, 3);
  assert.equal(waits.length, 2);
  assert.ok(waits.every((ms) => ms > 0) && waits.reduce((a, b) => a + b, 0) < 1000);
});

test('persistent access denial has a bounded wait and preserves the original I/O cause', () => {
  let calls = 0,
    waited = 0;
  assert.throws(
    () =>
      replaceFile('source', 'target', {
        platform: 'win32',
        wait: (ms) => {
          waited += ms;
        },
        rename: () => {
          calls++;
          throw fault('EACCES');
        },
      }),
    (error) => error.code === 'EACCES' && error.atomicAttempts === calls,
  );
  assert.ok(calls > 1 && calls <= 8 && waited > 0 && waited <= 1000);
});

test('disk capacity, corruption and missing source failures are not retried', () => {
  for (const code of ['ENOSPC', 'EIO', 'ENOENT']) {
    let calls = 0;
    assert.throws(
      () =>
        replaceFile('source', 'target', {
          platform: 'win32',
          wait: () => assert.fail('non-transient failure must not wait'),
          rename: () => {
            calls++;
            throw fault(code);
          },
        }),
      (error) => error.code === code && error.atomicAttempts === 1,
    );
    assert.equal(calls, 1);
  }
});

test('other operating systems do not mask permission failures as Windows sharing', () => {
  assert.throws(
    () =>
      replaceFile('source', 'target', {
        platform: 'linux',
        wait: () => assert.fail('must stop'),
        rename: () => {
          throw fault('EPERM');
        },
      }),
    (error) => error.code === 'EPERM' && error.atomicAttempts === 1,
  );
});

test(
  'a transient legacy save retains the file format and reopens with exactly the committed state',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const { repository, file } = await workspace(t);
    const before = hash(file),
      original = fs.renameSync;
    let refused = 0;
    fs.renameSync = (from, to) => {
      if (to === file && refused++ < 2) throw fault('EPERM');
      return original(from, to);
    };
    try {
      repository.saveLegacy(structuredClone(fixture.legacyState));
    } finally {
      fs.renameSync = original;
    }
    assert.notEqual(hash(file), before);
    const snapshot = await repository.snapshot();
    assert.deepEqual(snapshot.legacyState, fixture.legacyState);
    await repository.close();
    const reopened = await createUnifiedRepository({ file, password: PASSWORD });
    t.after(() => reopened.close());
    assert.deepEqual(await reopened.snapshot(), snapshot);
  },
);

test(
  'persistent Windows refusal leaves ciphertext, cache and pending drafts intact',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const { repository, file } = await workspace(t);
    const before = hash(file),
      state = await repository.snapshot(),
      original = fs.renameSync;
    fs.renameSync = (from, to) => {
      if (to === file) throw fault('EPERM');
      return original(from, to);
    };
    try {
      assert.throws(
        () => repository.saveLegacy(structuredClone(fixture.legacyState)),
        (error) =>
          error.code === 'STORAGE_WRITE_FAILED' &&
          error.details.reason === 'EPERM' &&
          error.details.phase === 'replace-existing' &&
          error.details.temporaryCleaned === true &&
          error.details.recoverable === true &&
          typeof error.details.recoveryFile === 'string' &&
          error.details.attempts > 1,
      );
    } finally {
      fs.renameSync = original;
    }
    assert.equal(hash(file), before);
    assert.deepEqual(await repository.snapshot(), state);
    assert.ok(
      !fs.readdirSync(ROOT).some((name) => name.startsWith(path.basename(file) + '.pending-')),
    );
    // The failed edit must survive as an encrypted recovery snapshot.
    const recovery = fs
      .readdirSync(ROOT)
      .filter((name) => name.startsWith(path.basename(file) + '.recovery-'));
    assert.equal(recovery.length, 1);
    repository.saveLegacy(structuredClone(fixture.legacyState));
    assert.deepEqual((await repository.snapshot()).legacyState, fixture.legacyState);
    for (const name of fs
      .readdirSync(ROOT)
      .filter((entry) => entry.startsWith(path.basename(file) + '.recovery-')))
      fs.unlinkSync(path.join(ROOT, name));
  },
);

async function holdReadLock(t, file, seconds) {
  const script = `import ctypes as c,sys,time
from ctypes import wintypes as w
k=c.WinDLL('kernel32',use_last_error=True)
k.CreateFileW.argtypes=(w.LPCWSTR,w.DWORD,w.DWORD,w.LPVOID,w.DWORD,w.DWORD,w.HANDLE)
k.CreateFileW.restype=w.HANDLE
k.CloseHandle.argtypes=(w.HANDLE,)
h=k.CreateFileW(sys.argv[1],0x80000000,1,None,3,0,None)
if h==c.c_void_p(-1).value: raise OSError(c.get_last_error(),'synthetic lock could not open')
print('ready',flush=True)
time.sleep(float(sys.argv[2]))
k.CloseHandle(h)
`;
  const child = spawn(
    process.env.PLATFORM_PYTHON,
    ['-I', '-B', '-c', script, file, String(seconds)],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) =>
      code === 0 ? resolve() : reject(new Error('controlled lock helper failed')),
    );
  });
  done.catch(() => {});
  t.after(async () => {
    if (child.exitCode === null) child.kill();
    await done.catch(() => {});
  });
  await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('controlled lock startup timeout')), 5000);
    child.stdout.on('data', (bytes) => {
      output += bytes;
      if (output.includes('ready')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once('error', reject);
    child.once('close', () => {
      clearTimeout(timer);
      if (!output.includes('ready')) reject(new Error('controlled lock did not start'));
    });
  });
  return { done };
}

const noWindowsRuntime = process.platform !== 'win32' || !process.env.PLATFORM_PYTHON;
test(
  'real Windows read handle sharing: release during bounded retry permits a readable commit',
  { skip: noWindowsRuntime },
  async (t) => {
    const { repository, file } = await workspace(t);
    const { done } = await holdReadLock(t, file, 0.12);
    repository.saveLegacy(structuredClone(fixture.legacyState));
    await done;
    const expected = await repository.snapshot();
    await repository.close();
    const reopened = await createUnifiedRepository({ file, password: PASSWORD });
    t.after(() => reopened.close());
    assert.deepEqual(await reopened.snapshot(), expected);
  },
);

test(
  'real Windows persistent read lock fails safely and accepts an explicit retry after release',
  { skip: noWindowsRuntime },
  async (t) => {
    const { repository, file } = await workspace(t);
    const before = hash(file),
      state = await repository.snapshot();
    const { done } = await holdReadLock(t, file, 1.4);
    let failure;
    assert.throws(
      () => repository.saveLegacy(structuredClone(fixture.legacyState)),
      (error) => {
        failure = error;
        return (
          error.code === 'STORAGE_WRITE_FAILED' &&
          error.details.phase === 'replace-existing' &&
          ['EPERM', 'EACCES', 'EBUSY'].includes(error.details.reason) &&
          error.details.temporaryCleaned === true &&
          error.details.recoverable === true
        );
      },
    );
    assert.equal(hash(file), before);
    assert.deepEqual(await repository.snapshot(), state);
    assert.ok(fs.readdirSync(path.dirname(file)).includes(failure.details.recoveryFile));
    await done;
    try {
      repository.saveLegacy(structuredClone(fixture.legacyState));
    } catch (error) {
      t.diagnostic(
        JSON.stringify({ afterControlledRelease: true, code: error.code, details: error.details }),
      );
      throw error;
    }
    assert.deepEqual((await repository.snapshot()).legacyState, fixture.legacyState);
  },
);
