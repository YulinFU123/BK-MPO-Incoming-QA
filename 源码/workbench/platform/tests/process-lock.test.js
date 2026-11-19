'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { createInterface } = require('node:readline');
const { acquireProcessLock } = require('../adapters/encrypted/process-lock');
const { createUnifiedRepository } = require('../adapters/encrypted/repository');
const fixture = require('../fixtures/synthetic.json');
const ROOT = path.resolve(
  process.env.PLATFORM_QA_ROOT || path.join(__dirname, '../../../../构建/当前作业/测试'),
  'process-lock',
);
fs.mkdirSync(ROOT, { recursive: true });
const file = () => path.join(ROOT, randomUUID() + '.eap');
const digest = (p) => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const password = 'Synthetic-crash-lock-2026!';
function child(t, target, mode = 'lock') {
  const process = spawn(
    global.process.execPath,
    [path.join(__dirname, 'helpers/process-lock-owner.cjs'), target, mode],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  const messages = [],
    waiting = [];
  createInterface({ input: process.stdout }).on('line', (line) => {
    const item = JSON.parse(line);
    if (waiting.length) waiting.shift()(item);
    else messages.push(item);
  });
  t.after(() => {
    if (process.exitCode === null) process.kill();
  });
  return {
    process,
    send: (value) => process.stdin.write(value + '\n'),
    next: () =>
      messages.length
        ? Promise.resolve(messages.shift())
        : new Promise((resolve) => waiting.push(resolve)),
  };
}

test(
  'crashed repository owner is recovered automatically without changing encrypted records',
  { timeout: 20000 },
  async (t) => {
    const target = file();
    const original = await createUnifiedRepository({
      file: target,
      password,
      create: true,
      initialLegacyState: fixture.legacyState,
    });
    const expected = await original.snapshot();
    await original.close();
    const before = digest(target),
      owner = child(t, target, 'repository');
    assert.equal((await owner.next()).state, 'ready');
    owner.send('acquire');
    assert.equal((await owner.next()).state, 'owned');
    const ended = once(owner.process, 'exit');
    owner.process.kill();
    await ended;
    assert.equal(fs.existsSync(target + '.lock'), true);
    const reopened = await createUnifiedRepository({ file: target, password });
    t.after(() => reopened.close());
    assert.deepEqual(await reopened.snapshot(), expected);
    assert.equal(digest(target), before);
    await reopened.close();
    assert.equal(fs.existsSync(target + '.lock'), false);
  },
);

test('simultaneous crash recovery permits exactly one writer', { timeout: 20000 }, async (t) => {
  const target = file(),
    old = child(t, target);
  await old.next();
  old.send('acquire');
  const prior = await old.next();
  assert.equal(prior.state, 'owned');
  const ended = once(old.process, 'exit');
  old.process.kill();
  await ended;
  const contenders = Array.from({ length: 4 }, () => child(t, target));
  await Promise.all(contenders.map((c) => c.next()));
  contenders.forEach((c) => c.send('acquire'));
  const results = await Promise.all(contenders.map((c) => c.next()));
  assert.equal(results.filter((r) => r.state === 'owned').length, 1);
  assert.equal(results.filter((r) => r.state === 'STORAGE_IN_USE').length, 3);
  const owner = results.find((r) => r.state === 'owned');
  assert.equal(JSON.parse(fs.readFileSync(target + '.lock')).pid, owner.pid);
  await Promise.all(
    contenders.map(async (c) => {
      const done = once(c.process, 'exit');
      c.send('release');
      await done;
    }),
  );
  const release = acquireProcessLock(target);
  release();
});

test('live legacy owners, malformed locks and permission-unknown owners are preserved', () => {
  for (const owner of [
    { format: 'exception-analysis-lock', pid: process.pid, token: randomUUID() },
    { pid: 0 },
    null,
  ]) {
    const target = file(),
      bytes = JSON.stringify(owner);
    fs.writeFileSync(target + '.lock', bytes);
    assert.throws(() => acquireProcessLock(target), { code: 'STORAGE_IN_USE' });
    assert.equal(fs.readFileSync(target + '.lock', 'utf8'), bytes);
  }
  const target = file(),
    bytes = JSON.stringify({
      format: 'exception-analysis-lock',
      pid: 2147483646,
      token: randomUUID(),
    });
  fs.writeFileSync(target + '.lock', bytes);
  const kill = process.kill;
  process.kill = () => {
    const e = new Error('Synthetic denied');
    e.code = 'EPERM';
    throw e;
  };
  try {
    assert.throws(() => acquireProcessLock(target), { code: 'STORAGE_IN_USE' });
  } finally {
    process.kill = kill;
  }
  assert.equal(fs.readFileSync(target + '.lock', 'utf8'), bytes);
});

test('releasing an obsolete handle preserves replacement metadata and is idempotent', () => {
  const target = file(),
    release = acquireProcessLock(target);
  const replacement = JSON.stringify({
    format: 'exception-analysis-lock',
    pid: process.pid,
    token: randomUUID(),
  });
  fs.writeFileSync(target + '.lock', replacement);
  release();
  release();
  assert.equal(fs.readFileSync(target + '.lock', 'utf8'), replacement);
});

test('failed lock metadata write releases both the lease and the owned lock', () => {
  const target = file(),
    write = fs.writeFileSync;
  fs.writeFileSync = () => {
    throw new Error('Synthetic disk failure');
  };
  try {
    assert.throws(() => acquireProcessLock(target), { code: 'STORAGE_LOCK_FAILED' });
  } finally {
    fs.writeFileSync = write;
  }
  assert.equal(fs.existsSync(target + '.lock'), false);
  const release = acquireProcessLock(target);
  release();
});

test('a corrupt lease file fails safely without touching business bytes or old metadata', () => {
  const target = file();
  fs.writeFileSync(target, 'protected-original');
  fs.writeFileSync(target + '.lock.sqlite', 'not a sqlite database'.repeat(100));
  const before = digest(target);
  assert.throws(() => acquireProcessLock(target), { code: 'STORAGE_LOCK_FAILED' });
  assert.equal(digest(target), before);
  assert.equal(fs.existsSync(target + '.lock'), false);
});
