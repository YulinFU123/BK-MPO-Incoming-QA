'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ROOT = path.resolve(
  process.env.PLATFORM_TEST_ROOT || path.join(__dirname, '../../../../构建/当前作业/测试'),
  'diagnostic-observer',
);
fs.mkdirSync(ROOT, { recursive: true });
const observer = path.resolve(__dirname, '../scripts/storage-diagnostics.cjs');

function child(directory, script, extra = {}) {
  return spawnSync(process.execPath, ['--require', observer, '-e', script], {
    encoding: 'utf8',
    windowsHide: true,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      PLATFORM_QA_ROOT: directory,
      PLATFORM_STORAGE_DIAGNOSTICS: path.join(directory, 'events'),
      ...extra,
    },
  });
}

test('opt-in diagnostics records safe OS metadata without paths, payloads or replacing the error', () => {
  const directory = fs.mkdtempSync(path.join(ROOT, 'safe-'));
  const result = child(
    directory,
    `
    const fs = require('node:fs'), path = require('node:path');
    const root = process.env.PLATFORM_QA_ROOT;
    try { fs.renameSync(path.join(root, 'private-SN.pending-secret'), path.join(root, 'private-employee.eap')); }
    catch (error) { if (error.code !== 'ENOENT') process.exit(3); }
  `,
  );
  assert.equal(result.status, 0, result.stderr);
  const logs = fs.readdirSync(path.join(directory, 'events'));
  assert.equal(logs.length, 1);
  const text = fs.readFileSync(path.join(directory, 'events', logs[0]), 'utf8');
  const data = JSON.parse(text);
  assert.equal(data.code, 'ENOENT');
  assert.equal(data.syscall, 'rename');
  assert.equal(data.source.exists, false);
  assert.match(data.targetToken, /^[a-f0-9]{64}$/);
  for (const secret of [directory, 'private-SN', 'private-employee', 'secret'])
    assert.equal(text.includes(secret), false);
});

test('non-QA source paths produce no diagnostic record', () => {
  const directory = fs.mkdtempSync(path.join(ROOT, 'scope-'));
  const result = child(
    directory,
    `
    const fs = require('node:fs'), path = require('node:path');
    const outside = path.join(process.env.PLATFORM_QA_ROOT, '..', 'synthetic-outside.pending-file');
    try { fs.renameSync(outside, outside + '.eap'); } catch (error) {
      if (error.code !== 'ENOENT') process.exit(3);
    }
  `,
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readdirSync(path.join(directory, 'events')).length, 0);
});

test('diagnostic output failure preserves the actual rename failure', () => {
  const directory = fs.mkdtempSync(path.join(ROOT, 'log-failure-'));
  const result = child(
    directory,
    `
    const fs = require('node:fs'), path = require('node:path');
    fs.appendFileSync = () => { throw Object.assign(new Error('log full'), {code:'ENOSPC'}); };
    const file = path.join(process.env.PLATFORM_QA_ROOT, 'synthetic.pending-file');
    try { fs.renameSync(file, file + '.eap'); process.exit(4); }
    catch (error) { if (error.code !== 'ENOENT') process.exit(3); }
  `,
  );
  assert.equal(result.status, 0, result.stderr);
});

test('observer rejects a diagnostic destination outside the explicitly isolated QA directory', () => {
  const directory = fs.mkdtempSync(path.join(ROOT, 'reject-'));
  const result = child(directory, '', {
    PLATFORM_STORAGE_DIAGNOSTICS: path.join(ROOT, 'outside-events'),
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /inside the isolated QA directory/);
  assert.equal(fs.existsSync(path.join(ROOT, 'outside-events')), false);
});
