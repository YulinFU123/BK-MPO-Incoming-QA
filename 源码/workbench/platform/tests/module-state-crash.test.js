'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs/promises'),
  path = require('node:path');
const { spawn } = require('node:child_process'),
  { once } = require('node:events'),
  { randomUUID } = require('node:crypto');
const { createSQLiteStateStore } = require('../adapters/state/sqlite-state-store');
const { createModuleStateService } = require('../application/module-state-service');
const { encryption, context } = require('./helpers/state-crash.cjs');
test('abrupt process termination rolls back incomplete transaction and recovers last committed settings', async (t) => {
  const dir = path.join(
    process.env.PLATFORM_TEST_ROOT || path.resolve(__dirname, '../../../../构建/当前作业/测试'),
    'state-crash-' + randomUUID(),
  );
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'modules.sqlite');
  const child = spawn(process.execPath, [path.join(__dirname, 'helpers/state-crash.cjs'), file], {
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  t.after(() => {
    if (child.exitCode === null) child.kill('SIGKILL');
  });
  await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(Error('synthetic crash fixture timed out')), 10000);
    child.stdout.on('data', (b) => {
      output += b.toString();
      if (output.includes('UNCOMMITTED_READY')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on('exit', (code) => {
      if (!output.includes('UNCOMMITTED_READY')) {
        clearTimeout(timer);
        reject(Error('fixture exit ' + code));
      }
    });
  });
  const exited = once(child, 'exit');
  child.kill('SIGKILL');
  await exited;
  const store = await createSQLiteStateStore(file);
  t.after(() => store.close());
  const service = createModuleStateService({ store, encryption, context });
  const row = await service.read({ scope: 'module', module: 'query' });
  assert.equal(row.revision, 1);
  assert.equal(row.data.pageSize, 100);
  assert.equal((await store.check()).integrity, 'ok');
});
