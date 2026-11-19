'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs/promises'),
  path = require('node:path'),
  { randomUUID, createHash } = require('node:crypto');
const M = require('../domain/analysis-studio');
const { encryption } = require('./helpers/state-crash.cjs');
const { createWorkspaceController } = require('../desktop/workspace-controller');
const { createUnifiedRepository } = require('../adapters/encrypted/repository');
const { createManagedWorkspaceHost } = require('../desktop/managed-workspace-host');
const { createModuleStateHost } = require('../desktop/module-state-host');
const { createAnalysisStudioHost } = require('../desktop/analysis-studio-host');
const { createManagedBIPreview } = require('../desktop/managed-bi-preview');

test('manager previews real BI in unopened workspaces, isolates sources, preserves files and honors the manual choice', async (t) => {
  assert.ok(process.env.PLATFORM_PYTHON);
  const root = path.resolve(
      process.env.PLATFORM_TEST_ROOT ||
        path.join(__dirname, '../../../../构建/当前作业/工作区BI数据预览/验证'),
      'manager-bi-' + randomUUID(),
    ),
    directory = path.join(root, 'managed');
  await fs.mkdir(directory, { recursive: true });
  const controller = createWorkspaceController({
    dialogs: {},
    repositoryFactory: createUnifiedRepository,
    legacyEnabled: true,
  });
  const moduleDirectory = path.join(root, 'modules');
  const preview = createManagedBIPreview({
    directory: path.join(directory, 'data'),
    moduleDirectory,
    encryption,
    python: process.env.PLATFORM_PYTHON,
    script: path.resolve(__dirname, '../desktop/lab_preview_worker.py'),
  });
  let previewReads = 0;
  const host = await createManagedWorkspaceHost({
    directory,
    encryption,
    controller,
    clock: () => Date.parse('2026-11-02T08:00:00Z'),
    readBI: async (args) => {
      previewReads++;
      return preview.read(args);
    },
    closeBI: () => preview.close(),
  });
  t.after(async () => {
    await controller.lock();
    await host.close();
  });
  const old = await host.managedCreate({ name: '旧工作区自动识别' }),
    second = await host.managedCreate({ name: '另一个来源', dataSourceMode: 'bi' }),
    empty = await host.managedCreate({ name: '空BI工作区', dataSourceMode: 'bi' });
  async function imported(item, qty) {
    const file = path.join(directory, 'data', item.id + '.eap'),
      downloads = path.join(root, item.id);
    await fs.mkdir(downloads);
    await fs.writeFile(
      path.join(downloads, '20261016.csv'),
      `日期,工序,班次,不良项,数量,Employee in Charge,Reported By,SN\n2026-10-16,装管,晚班,装管反,${qty},合成员工,合成报检人,0012\n`,
    );
    const scoped = {
      hostContext: () => ({ unlocked: true, mode: 'file', file, sessionId: item.id }),
    };
    const memory = await createModuleStateHost({
      controller: scoped,
      directory: moduleDirectory,
      encryption,
    });
    const engine = createAnalysisStudioHost({
      controller: scoped,
      memory,
      profile: root,
      python: process.env.PLATFORM_PYTHON,
      script: path.resolve(__dirname, '../desktop/lab_worker.py'),
    });
    try {
      const config = M.defaults(),
        source = M.freshSource('defects', 'same-source');
      source.folder = downloads;
      const info = await engine.request({ action: 'inspect', sourceId: source.id, draft: source });
      Object.assign(source, {
        sheet: info.sheet,
        headerRow: info.headerRow,
        schema: info.schema,
        mapping: info.mapping,
        columns: info.columns.map(({ id, label, type }) => ({ id, label, type })),
        confirmed: true,
      });
      config.sources = [source];
      config.activeSource = source.id;
      await memory.saveModuleState({
        address: { scope: 'module', module: 'analysis-studio' },
        data: config,
        expectedRevision: 0,
      });
      const result = await engine.request({ action: 'import', sourceId: source.id });
      assert.equal(result.errors, 0);
    } finally {
      await engine.close();
      await memory.close();
    }
    return file;
  }
  const firstFile = await imported(old, 100);
  await imported(second, 7);
  const hash = async (file) =>
    createHash('sha256')
      .update(await fs.readFile(file))
      .digest('hex');
  const watched = [
    firstFile + '.analysis-data/analysis-v1.sqlite',
    path.join(moduleDirectory, 'modules.sqlite'),
  ];
  const before = await Promise.all(watched.map(hash)),
    statusBefore = controller.status();
  const one = await host.managedReport({ id: old.id });
  assert.equal(one.primary.available, true, one.biSource.message);
  assert.equal(one.primary.source, 'bi');
  assert.equal(one.biSource.quantity, 100);
  assert.equal(one.biSource.rowCount, 1);
  assert.equal(one.recordCount, 0);
  assert.equal(one.biSource.rows[0].reporter, '合成报检人');
  assert.equal((await host.managedReport({ id: second.id })).biSource.quantity, 7);
  const list = await host.managedList();
  assert.equal(list.items.find((x) => x.id === old.id).summary.quantity, 100);
  assert.equal(list.items.find((x) => x.id === empty.id).summary.quantity, null);
  const filtered = await host.managedReport({
    id: old.id,
    biFilter: { field: 'employee', value: '不匹配员工' },
  });
  assert.equal(filtered.biSource.rowCount, 0);
  const saved = {
    range: 'custom',
    start: '2026-11-01',
    end: '2026-11-02',
    grain: 'day',
    datasetId: '',
  };
  await host.managedUpdate({ id: old.id, analysis: saved });
  const missing = await host.managedReport({ id: old.id });
  assert.equal(missing.primary.source, 'bi');
  assert.equal(missing.primary.available, false);
  assert.equal(missing.biSource.availableRowCount, 1);
  await host.managedUpdate({ id: old.id, analysis: { ...saved, range: 'all' } });
  const all = await host.managedReport({ id: old.id });
  assert.equal(all.biSource.quantity, 100);
  assert.equal(all.scope.start, '2026-10-16');
  assert.deepEqual(
    controller.status(),
    statusBefore,
    'preview must not switch or unlock the active workspace',
  );
  assert.deepEqual(
    await Promise.all(watched.map(hash)),
    before,
    'preview must not alter BI or module data',
  );
  await host.managedUpdate({ id: old.id, dataSourceMode: 'records' });
  const reads = previewReads;
  const manual = await host.managedReport({ id: old.id });
  assert.equal(manual.primary.source, 'records');
  assert.equal(previewReads, reads);
});

test('BI summary never converts missing coverage into manual zero or a workflow completion rate', () => {
  const Q = require('../domain/workspace-query');
  const r = Q.summary({
    primary: { source: 'bi', available: false },
    scope: { start: '2026-11-01', end: '2026-11-02' },
    biSource: {
      state: 'out-of-range',
      availableRowCount: 1919,
      availableRange: { start: '2026-10-16', end: '2026-10-16' },
    },
  });
  assert.equal(r.quantity, null);
  assert.equal(r.rows, null);
  assert.equal(r.closedRate, undefined);
  assert.equal(r.availableRowCount, 1919);
});
