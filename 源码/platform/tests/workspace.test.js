'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createWorkspaceController } = require('../desktop/workspace-controller');
const fixture = require('../fixtures/excel-mapping.example.json');
const ROOT = process.env.PLATFORM_QA_ROOT || path.resolve(__dirname, '../../../构建/当前作业/测试');
const makeDir = () => { fs.mkdirSync(ROOT, { recursive: true }); return fs.mkdtempSync(path.join(ROOT, 'workspace-')); };
const code = expected => error => error.code === expected;

test('desktop controller owns paths and supports explicit encrypted UI workflow with fresh session recovery', async () => {
  const dir = makeDir(), file = path.join(dir, '独立.qav'), backupFile = path.join(dir, '备份.qav');
  const workbook = path.join(__dirname, 'fixtures/openpyxl-synthetic-quality.xlsx');
  const dialogs = { chooseWorkspace: async () => file, pickWorkbook: async () => workbook, backup: async () => backupFile };
  const controller = createWorkspaceController({ dialogs });
  const selected = await controller.chooseWorkspace({ create: true });
  assert.equal(JSON.stringify(selected).includes(dir), false);
  await controller.unlock({ selectionToken: selected.selectionToken, password: 'Synthetic-UI-26!' });
  assert.equal(controller.status().mode, 'file');
  const picked = await controller.pickWorkbook();
  assert.equal(JSON.stringify(picked).includes(dir), false);
  const preview = await controller.previewImport({ ...fixture, workbookToken: picked.workbookToken });
  assert.equal(preview.stats.validRowCount, 2);
  const imported = await controller.commitImport({ previewId: preview.previewId, acknowledgeWarnings: true });
  assert.equal(imported.status, 'imported');
  await controller.backup();
  await controller.lock();
  await assert.rejects(controller.overview({}), code('WORKSPACE_LOCKED'));
  assert.equal(controller.status().mode, 'locked');
  const fresh = createWorkspaceController({ dialogs });
  const selection = await fresh.chooseWorkspace({ create: false });
  await fresh.unlock({ selectionToken: selection.selectionToken, password: 'Synthetic-UI-26!' });
  const report = await fresh.overview({ start: '2026-10-26', end: '2026-10-26', datasetId: fixture.dataset.id });
  assert.equal(report.quality.rate.value, 0.02);
  await fresh.lock();
});

test('session epoch rejects a delayed old picker after lock/reopen without changing the new session', async () => {
  let release;
  const controller = createWorkspaceController({ dialogs: { pickWorkbook: () => new Promise(resolve => { release = resolve; }) }, clock: () => new Date('2026-10-26T12:00:00Z').getTime() });
  await controller.openDemo();
  const pending = controller.pickWorkbook();
  await controller.lock();
  await controller.openDemo();
  release(path.join(__dirname, 'fixtures/openpyxl-synthetic-quality.xlsx'));
  await assert.rejects(pending, code('SESSION_CHANGED'));
  assert.equal(controller.status().mode, 'demo');
  assert.equal((await controller.catalog()).datasets.length, 1);
  await controller.lock();
});

test('demo is explicit and a cancelled workbook preview cannot commit', async () => {
  const controller = createWorkspaceController({ dialogs: { pickWorkbook: async () => path.join(__dirname, 'fixtures/openpyxl-synthetic-quality.xlsx') } });
  assert.equal(controller.status().unlocked, false);
  await controller.openDemo();
  assert.equal(controller.status().mode, 'demo');
  assert.equal(controller.status().capabilities.durableStorage, false);
  const selected = await controller.pickWorkbook();
  const preview = await controller.previewImport({ ...fixture, dataset: { ...fixture.dataset, id: 'another' }, workbookToken: selected.workbookToken });
  assert.equal(controller.cancelImport({ previewId: preview.previewId }), true);
  await assert.rejects(controller.commitImport({ previewId: preview.previewId }), code('PREVIEW_EXPIRED'));
  await assert.rejects(controller.backup(), code('DEMO_NOT_SAVED'));
  await controller.lock();
});

test('closing during password derivation waits for cleanup and leaves no orphan lock', async () => {
  const directory = makeDir(), file = path.join(directory, '关闭测试.qav');
  const controller = createWorkspaceController({ dialogs: { chooseWorkspace: async () => file }, onLocked: () => { throw new Error('synthetic notification failure'); } });
  const selection = await controller.chooseWorkspace({ create: true });
  const opening = controller.unlock({ selectionToken: selection.selectionToken, password: 'Synthetic-Close-26!' }).catch(error => error);
  await controller.lock();
  assert.equal(fs.existsSync(file + '.lock'), false);
  assert.equal((await opening).code, 'SESSION_CHANGED');
  assert.equal(controller.status().unlocked, false);
});
