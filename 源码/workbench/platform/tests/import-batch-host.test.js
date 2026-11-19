'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const M = require('../domain/analysis-studio');
const C = require('../domain/analysis-calendar');
const { createAnalysisStudioHost } = require('../desktop/analysis-studio-host');

test('batch handles bind to the published source and current workspace session', async () => {
  const config = M.defaults();
  config.sources = [M.freshSource('defects', 'source-a'), M.freshSource('defects', 'source-b')];
  config.activeSource = 'source-a';
  let context = { unlocked: true, mode: 'file', file: path.resolve('synthetic.eap'), sessionId: 'one' };
  const calls = [];
  const key = 'a'.repeat(32);
  const host = createAnalysisStudioHost({
    controller: { hostContext: () => context },
    memory: { readModuleState: async address => ({ data: address.module === 'analysis-calendar' ? C.defaults() : config, revision: 0 }) },
    profile: '.', python: 'unused', script: 'unused.py',
    pickFolder: async () => null, saveFile: async () => null, pickBackup: async () => null,
    workerFactory: () => ({
      ready: Promise.resolve(), abort() {},
      async request({ body }) {
        calls.push(body);
        if (body.action === 'importHistory') return {
          revision: 3, offset: 0, total: 1, more: false, batches: [{ batchId: key, name: 'synthetic.csv', canChange: true }],
        };
        return { changed: true, enabled: body.enabled, revision: 4 };
      },
    }),
  });
  const listing = await host.request({ action: 'importHistory', sourceId: 'source-a' });
  const token = listing.batches[0].batchId;
  assert.notEqual(token, key);
  const change = { action: 'setImportBatch', sourceId: 'source-a', batchId: token, enabled: false, revision: 3 };
  await assert.rejects(host.request({ ...change, batchId: key }), /选择已失效/);
  await assert.rejects(host.request({ ...change, sourceId: 'source-b' }), /选择已失效/);
  await assert.rejects(host.request({ ...change, batchId: 'C:/source/wrong.xlsx' }), /选择已失效/);
  await assert.rejects(host.request({ ...change, path: 'C:/source/wrong.xlsx' }), /参数无效/);
  await assert.rejects(host.request({ ...change, enabled: 'false' }), /状态或版本无效/);
  await host.request(change);
  assert.equal(calls.at(-1).batchId, key);
  assert.equal(calls.at(-1).config.sources[0].id, 'source-a');
  const fresh = await host.request({ action: 'importHistory', sourceId: 'source-a' });
  await assert.rejects(host.request(change), /选择已失效/);
  const valid = { ...change, batchId: fresh.batches[0].batchId };
  context = { ...context, file: path.resolve('other.eap'), sessionId: 'two' };
  await assert.rejects(host.request(valid), /选择已失效/);
  await host.close();
});
