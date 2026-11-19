'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs/promises'),
  path = require('node:path');
const { randomUUID } = require('node:crypto');
const { encryption } = require('./helpers/state-crash.cjs');
const { createManagedWorkspaceHost } = require('../desktop/managed-workspace-host');
const { createWorkspaceController } = require('../desktop/workspace-controller');
const { createUnifiedRepository } = require('../adapters/encrypted/repository');
const { metadata, emptyState } = require('../domain/managed-workspaces');
test('managed source choice persists outside legacy metadata and returns in controller status', async (t) => {
  const c = await setup(t),
    a = await c.host.managedCreate({ name: 'BI工作区', dataSourceMode: 'bi' });
  assert.equal(a.dataSourceMode, 'bi');
  await c.host.managedOpen({ id: a.id });
  assert.equal(c.controller.status().dataSourceMode, 'bi');
  await c.host.managedUpdate({ id: a.id, dataSourceMode: 'records' });
  assert.equal(c.controller.status().dataSourceMode, 'records');
  await c.restart();
  assert.equal((await c.host.managedList()).items[0].dataSourceMode, 'records');
  await assert.rejects(c.host.managedCreate({ name: 'invalid-mode', dataSourceMode: 'both' }));
});
test('custom analysis dates are persisted per workspace and invalid dates do not change saved settings', async (t) => {
  const c = await setup(t),
    a = await c.host.managedCreate({ name: '自定义日期' });
  await c.host.managedUpdate({
    id: a.id,
    analysis: {
      range: 'custom',
      start: '2026-10-01',
      end: '2026-10-10',
      grain: 'day',
      datasetId: '',
    },
  });
  const r = await c.host.managedReport({ id: a.id });
  assert.equal(r.scope.start, '2026-10-01');
  assert.equal(r.scope.end, '2026-10-10');
  await assert.rejects(
    c.host.managedUpdate({
      id: a.id,
      analysis: {
        range: 'custom',
        start: '2026-10-31',
        end: '2026-10-01',
        grain: 'day',
        datasetId: '',
      },
    }),
  );
  await c.restart();
  assert.equal((await c.host.managedList()).items[0].analysis.start, '2026-10-01');
});
test('workspace manager links use inherited real routes and do not point at missing placeholders', async () => {
  const model = require('../desktop/app/navigation-model');
  const source = await fs.readFile(
    path.join(__dirname, '../desktop/app/workspace-manager.js'),
    'utf8',
  );
  const refs = [...source.matchAll(/enter\(selected,\s*'([^']+)'\)/g)].map((m) => m[1]);
  assert(refs.includes('legacy-settings'));
  assert(refs.includes('legacy-entry'));
  for (const ref of refs)
    assert(
      model.routes.some((r) => r.id === ref),
      ref,
    );
});
async function setup(t, extra = {}) {
  const directory = path.join(
    process.env.PLATFORM_TEST_ROOT || path.resolve(__dirname, '../../../../构建/当前作业/测试'),
    'managed-' + randomUUID(),
  );
  await fs.mkdir(directory, { recursive: true });
  const controller = createWorkspaceController({
    dialogs: {},
    repositoryFactory: createUnifiedRepository,
    legacyEnabled: true,
    clock: () => Date.parse('2026-10-29T08:00:00Z'),
  });
  const options = {
    directory,
    encryption,
    controller,
    beforeSwitch: () => controller.lock(),
    clock: () => Date.parse('2026-10-29T08:00:00Z'),
    ...extra,
  };
  let host = await createManagedWorkspaceHost(options);
  t.after(async () => {
    await controller.lock();
    await host.close();
  });
  return {
    directory,
    controller,
    get host() {
      return host;
    },
    async restart() {
      await controller.lock();
      await host.close();
      host = await createManagedWorkspaceHost(options);
    },
  };
}
test('managed workspace opens without user password and exposes no paths or secrets', async (t) => {
  const c = await setup(t);
  const made = await c.host.managedCreate({ name: '剪线异常', process: '剪线' });
  assert.equal(made.state, 'ready');
  const status = await c.host.managedOpen({ id: made.id });
  assert.equal(status.managedId, made.id);
  assert.equal(status.workspaceName, '剪线异常');
  const list = await c.host.managedList();
  assert.equal(list.items[0].summary.records, 0);
  const dto = JSON.stringify([list, made, status]);
  assert.equal(dto.includes(c.directory), false);
  assert.equal(/secret|password/.test(dto), false);
  const files = await fs.readdir(c.directory);
  assert(files.includes('catalog.sqlite'));
  const raw = await fs.readFile(path.join(c.directory, 'catalog.sqlite'));
  assert.equal(raw.includes(Buffer.from('剪线异常')), false);
});
test('managed workspaces keep records and analysis settings isolated across restart', async (t) => {
  const c = await setup(t),
    a = await c.host.managedCreate({ name: '甲工作区' }),
    b = await c.host.managedCreate({ name: '乙工作区' });
  await c.host.managedOpen({ id: a.id });
  const data = await c.controller.legacyBootstrap();
  data.records.push({
    id: 'real-synthetic-test',
    templateId: 'general',
    createdAt: '2026-10-29T01:00:00Z',
    values: { sn: '0012Ab', found_date: '2026-10-29', issue: '测试异常', process: '剪线' },
  });
  c.controller.legacySave(data);
  await c.host.managedUpdate({ id: a.id, analysis: { range: '7', grain: 'month', datasetId: '' } });
  assert.equal((await c.host.managedReport({ id: a.id })).recordCount, 1);
  assert.equal((await c.host.managedReport({ id: b.id })).recordCount, 0);
  await c.restart();
  const list = await c.host.managedList();
  assert.equal(list.items.find((x) => x.id === a.id).analysis.grain, 'month');
  assert.equal(list.items.find((x) => x.id === b.id).analysis.grain, 'week');
  await c.host.managedOpen({ id: a.id });
  assert.equal((await c.controller.legacyBootstrap()).records[0].values.sn, '0012Ab');
});
test('copying a managed workspace retains custom fields and copies no records or drafts', async (t) => {
  const c = await setup(t),
    a = await c.host.managedCreate({ name: '原配置' });
  await c.host.managedOpen({ id: a.id });
  const s = await c.controller.legacyBootstrap();
  s.templates[0].columns.push({ id: 'custom', label: '特有字段', type: 'text' });
  s.pendingUI = { entry: { sn: '未提交' } };
  s.records.push({
    id: 'r1',
    templateId: 'general',
    createdAt: '2026-10-29T01:00:00Z',
    values: { sn: 'A', found_date: '2026-10-29', issue: '异常' },
  });
  c.controller.legacySave(s);
  const b = await c.host.managedCreate({ name: '复制配置', copyFrom: a.id });
  await c.host.managedOpen({ id: b.id });
  const copied = await c.controller.legacyBootstrap();
  assert.equal(copied.records.length, 0);
  assert.equal(copied.pendingUI, undefined);
  assert(copied.templates[0].columns.some((x) => x.id === 'custom'));
});
test('archive and layout changes preserve data and reopenable metadata', async (t) => {
  const c = await setup(t),
    a = await c.host.managedCreate({ name: '归档保留' });
  await c.host.managedUpdate({ id: a.id, archived: true, favorite: true });
  await c.host.managedLayout({ view: 'list', sort: 'name', selectedId: a.id });
  await c.restart();
  const r = await c.host.managedList();
  assert.equal(r.items[0].archived, true);
  assert.equal(r.layout.view, 'list');
  await c.host.managedOpen({ id: a.id });
  assert(c.controller.status().unlocked);
});
test('deleting a managed workspace closes it and restores records, drafts and preferences after restart', async (t) => {
  const c = await setup(t);
  const a = await c.host.managedCreate({ name: '误建可恢复', dataSourceMode: 'records' });
  const b = await c.host.managedCreate({ name: '另一个工作区', dataSourceMode: 'records' });
  await c.host.managedOpen({ id: a.id });
  const state = await c.controller.legacyBootstrap();
  state.pendingUI = { entry: { sn: '草稿0012' } };
  state.records.push({ id: 'kept-record', templateId: 'general',
    createdAt: '2026-10-29T01:00:00Z',
    values: { sn: '00012', found_date: '2026-10-29', issue: '保留测试' } });
  await c.controller.legacySave(state);
  await c.host.managedUpdate({ id: a.id, analysis: { range: '7', grain: 'month', datasetId: '' } });
  await c.host.managedDelete({ id: a.id });
  assert.equal(c.controller.status().managedId, null);
  const file = path.join(c.directory, 'data', a.id + '.eap');
  const bytes = await fs.readFile(file);
  const files = (await fs.readdir(path.dirname(file))).sort();
  const list = await c.host.managedList();
  assert.deepEqual(list.items.map((item) => item.id), [b.id]);
  assert.equal(list.layout.selectedId, '');
  assert.equal(list.deletedItems[0].id, a.id);
  assert(list.deletedItems[0].deletedAt > 0);
  assert.equal(list.deletedItems[0].analysis.grain, 'month');
  assert.equal(/secret|password/.test(JSON.stringify(list.deletedItems)), false);
  for (const method of ['managedOpen', 'managedReport', 'managedFields', 'managedUpdate', 'managedBackup'])
    await assert.rejects(c.host[method]({ id: a.id }), (error) => error.code === 'WORKSPACE_DELETED', method);
  await c.restart();
  assert.equal((await c.host.managedList()).deletedItems[0].id, a.id);
  const restored = await c.host.managedRecover({ id: a.id });
  assert.equal(restored.id, a.id);
  assert.equal(restored.archived, false);
  assert.equal(restored.deletedAt, undefined);
  assert.deepEqual(await fs.readFile(file), bytes, 'recovering metadata never rewrites the business file');
  assert.deepEqual((await fs.readdir(path.dirname(file))).sort(), files);
  await c.host.managedOpen({ id: a.id });
  const kept = await c.controller.legacyBootstrap();
  assert.equal(kept.records[0].values.sn, '00012');
  assert.equal(kept.pendingUI.entry.sn, '草稿0012');
});

test('recycle bin remains separate from archives and resolves names without changing another workspace', async (t) => {
  let reads = 0;
  const c = await setup(t, { readBI: async () => { reads++; return { state: 'empty' }; } });
  const a = await c.host.managedCreate({ name: '重复名称', dataSourceMode: 'bi' });
  const archived = await c.host.managedCreate({ name: '仅归档', dataSourceMode: 'records' });
  await c.host.managedUpdate({ id: archived.id, archived: true });
  await c.host.managedOpen({ id: archived.id });
  await c.host.managedDelete({ id: a.id });
  assert.equal(c.controller.status().managedId, archived.id, 'deleting another entry leaves the current workspace open');
  await c.host.managedDelete({ id: a.id });
  assert.equal((await c.host.managedList()).deletedItems.length, 1, 'repeated deletion is idempotent');
  assert.equal(reads, 0, 'recycle-bin entries do not read business or BI reports');
  const replacement = await c.host.managedCreate({ name: '重复名称', dataSourceMode: 'bi' });
  const recovered = await c.host.managedRecover({ id: a.id });
  assert.equal(recovered.name, '重复名称 恢复');
  assert.equal(replacement.name, '重复名称');
  const list = await c.host.managedList();
  assert.equal(list.items.find((item) => item.id === archived.id).archived, true);
  assert.equal(list.items.find((item) => item.id === replacement.id).name, '重复名称');
  assert.equal(list.deletedItems.length, 0);
  await assert.rejects(c.host.managedRecover({ id: '../invalid' }));
});

test('failed recycle-bin persistence keeps the original workspace available', async (t) => {
  let available = true;
  const c = await setup(t, {
    encryption: { ...encryption, isEncryptionAvailable: async () => available },
  });
  const a = await c.host.managedCreate({ name: '写入失败保留' });
  available = false;
  await assert.rejects(c.host.managedDelete({ id: a.id }), (error) => error.code === 'STATE_ENCRYPTION_UNAVAILABLE');
  available = true;
  const list = await c.host.managedList();
  assert.equal(list.items[0].id, a.id);
  assert.equal(list.deletedItems.length, 0);
  await c.host.managedOpen({ id: a.id });
  assert.equal(c.controller.status().managedId, a.id);
});

test('managed keys cannot be invalidated by inherited change-password command', async (t) => {
  const c = await setup(t),
    a = await c.host.managedCreate({ name: '无密码工作区' });
  await c.host.managedOpen({ id: a.id });
  assert.throws(
    () => c.controller.legacyChangePassword('', 'anything'),
    (e) => e.code === 'MANAGED_PASSWORD_NOT_REQUIRED',
  );
  assert.throws(
    () => c.controller.legacyBackup(),
    (e) => e.code === 'MANAGED_BACKUP_REQUIRED',
  );
  await c.restart();
  await c.host.managedOpen({ id: a.id });
  assert(c.controller.status().unlocked);
});
test('same-account protected backup restores into a new independent workspace', async (t) => {
  let backup;
  const c = await setup(t, { saveBackup: async () => backup, pickBackup: async () => backup });
  backup = path.join(c.directory, 'recover.bkw');
  const a = await c.host.managedCreate({ name: '需备份工作区' });
  await c.host.managedOpen({ id: a.id });
  await c.host.managedBackup({ id: a.id });
  const raw = await fs.readFile(backup);
  assert.equal(raw.includes(Buffer.from('secret')), false);
  const restored = await c.host.managedRestore();
  assert.notEqual(restored.id, a.id);
  assert.equal((await c.host.managedList()).items.length, 2);
  await c.host.managedOpen({ id: restored.id });
  assert.equal((await c.controller.legacyBootstrap()).records.length, 0);
});
test('validation rejects path injection, duplicate names and missing account protection', async (t) => {
  const c = await setup(t);
  await c.host.managedCreate({ name: '相同名称' });
  await assert.rejects(
    c.host.managedCreate({ name: '相同名称' }),
    (e) => e.code === 'WORKSPACE_NAME_EXISTS',
  );
  await assert.rejects(c.host.managedOpen({ id: '../escape' }));
  assert.throws(() => metadata({ name: 'a', file: 'unsafe' }));
  assert.throws(() => metadata({ name: '' }));
  assert.equal(emptyState('测试', '装管').records.length, 0);
  const d = await setup(t, {
    encryption: { ...encryption, isEncryptionAvailable: async () => false },
  });
  await assert.rejects(
    d.host.managedCreate({ name: '不会保存' }),
    (e) => e.code === 'STATE_ENCRYPTION_UNAVAILABLE',
  );
  assert.equal((await d.host.managedList()).items.length, 0);
});
