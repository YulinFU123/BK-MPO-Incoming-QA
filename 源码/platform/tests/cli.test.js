'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseArgs } = require('../cli/file-workbench');
const platformRoot = path.resolve(__dirname, '..');
const qaRoot = process.env.PLATFORM_QA_ROOT || path.resolve(platformRoot, '../../构建/当前作业/测试');

function run(args, input) {
  return spawnSync(process.execPath, ['cli/file-workbench.js', ...args], { cwd: platformRoot, input, encoding: 'utf8', timeout: 30000 });
}

test('CLI rejects unknown/password arguments and requires explicit flags', () => {
  assert.throws(() => parseArgs(['import', '--password', 'secret']), error => error.code === 'INVALID_ARGUMENT');
  assert.throws(() => parseArgs(['import', '--store']), error => error.code === 'INVALID_ARGUMENT');
  assert.deepEqual(parseArgs(['import', '--create', '--store', 'analysis.qav']), { command: 'import', create: true, store: 'analysis.qav' });
});

test('CLI inspect/import/report/backup/restore works offline in separate processes', () => {
  fs.mkdirSync(qaRoot, { recursive: true });
  const folder = fs.mkdtempSync(path.join(qaRoot, 'cli-'));
  const file = path.join(platformRoot, 'tests/fixtures/openpyxl-synthetic-quality.xlsx');
  const configuration = path.join(platformRoot, 'fixtures/excel-mapping.example.json');
  const store = path.join(folder, '中文独立分析.qav');
  const backup = path.join(folder, '加密备份.qav');
  const restored = path.join(folder, '恢复验证.qav');
  const password = 'Synthetic-only-2026!';
  let result = run(['inspect', '--file', file]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(JSON.parse(result.stdout).sheets[0].name, '检验明细');
  result = run(['import', '--file', file, '--config', configuration, '--store', store, '--create', '--yes', '--password-stdin'], password + '\n');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.ok(result.stdout.includes('"status": "imported"'));
  assert.equal(result.stdout.includes(password), false);
  assert.equal(fs.readFileSync(store, 'utf8').includes('装管'), false);
  result = run(['report', '--store', store, '--dataset', 'demoQuality', '--start', '2026-10-26', '--end', '2026-10-26', '--password-stdin'], password + '\n');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(JSON.parse(result.stdout).quality.rate.value, 0.02);
  result = run(['backup', '--store', store, '--output', backup, '--password-stdin'], password + '\n');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  result = run(['restore', '--file', backup, '--store', restored, '--password-stdin'], password + '\n');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  result = run(['report', '--store', restored, '--dataset', 'demoQuality', '--start', '2026-10-26', '--end', '2026-10-26', '--password-stdin'], password + '\n');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(JSON.parse(result.stdout).quality.totals.defectiveUnits, 2);
  result = run(['import', '--file', file, '--config', configuration, '--store', store, '--yes', '--password-stdin'], password + '\n');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.ok(result.stdout.includes('"status": "duplicate"'));
  const before = fs.readFileSync(restored);
  result = run(['restore', '--file', backup, '--store', restored, '--password-stdin'], password + '\n');
  assert.notEqual(result.status, 0);
  assert.deepEqual(fs.readFileSync(restored), before);
});
