'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs/promises'),
  path = require('node:path'),
  { randomUUID } = require('node:crypto');
const Q = require('../domain/workspace-query'),
  C = require('../domain/chart-data'),
  H = require('../domain/home-workspaces');
const { createManagedWorkspaceHost } = require('../desktop/managed-workspace-host'),
  { createWorkspaceController } = require('../desktop/workspace-controller'),
  { createUnifiedRepository } = require('../adapters/encrypted/repository');
const { createSQLiteStateStore } = require('../adapters/state/sqlite-state-store'),
  { encryption } = require('./helpers/state-crash.cjs');
async function setup(t) {
  const directory = path.join(
    process.env.PLATFORM_TEST_ROOT || path.resolve(__dirname, '../../../../构建/当前作业/测试'),
    'release-' + randomUUID(),
  );
  await fs.mkdir(directory, { recursive: true });
  const clock = () => Date.parse('2026-10-30T08:00:00Z'),
    controller = createWorkspaceController({
      dialogs: {},
      repositoryFactory: createUnifiedRepository,
      legacyEnabled: true,
      clock,
    });
  const options = {
    directory,
    controller,
    encryption,
    clock,
    beforeSwitch: () => controller.lock(),
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
test('chart data rejects the former options-object total and never calculates NaN shares', () => {
  assert.throws(() => C.donut([{ value: 'a', count: 2 }], { onSelect() {} }));
  assert.throws(() => C.donut([{ value: 'a', count: 2 }], 3));
  assert.throws(() => C.donut([{ value: 'a', count: -1 }], 0));
  assert.deepEqual(C.donut([], 0), { items: [], total: 0 });
  const r = C.donut(
    [
      { value: 'a', count: 2 },
      { value: 'b', count: 1 },
    ],
    3,
  );
  assert.equal(
    r.items.reduce((n, x) => n + x.share, 0),
    1,
  );
  assert(r.items.every((x) => Number.isFinite(x.share)));
});
test('count axes use integer steps for small and large record totals', () => {
  for (const max of [0, 1, 2, 3, 4, 5, 9, 12, 67, 1031]) {
    const a = C.countAxis(max);
    assert(a.top >= max);
    assert(a.ticks.every(Number.isInteger));
    assert(a.ticks.length >= 2 && a.ticks.length <= 6);
    assert.equal(a.ticks.at(-1), a.top);
  }
});
test('date presets cover leap months and previous-year boundaries with stable sort', () => {
  assert.equal(Q.resolve({ range: 'month' }, '2024-02-29').start, '2024-02-01');
  const prior = Q.resolve(
    { range: 'last-month', sort: { field: 'sn', direction: 'asc' } },
    '2026-01-10',
  );
  assert.equal(prior.start, '2025-12-01');
  assert.equal(prior.end, '2025-12-31');
  assert.equal(prior.sort.direction, 'asc');
  assert.equal(Q.resolve({ range: '1' }, '2026-10-30').start, '2026-10-30');
  assert.throws(() => Q.normalize({ range: 'custom', start: '2026-02-30', end: '2026-03-02' }));
});
test('inheriting manager scope preserves named schemes and transfers the exact applied scope', () => {
  const old = H.defaults();
  old.views[0].filters = { issue: '保留的条件' };
  const before = structuredClone(old),
    prefs = {
      range: '7',
      grain: 'day',
      datasetId: 'datasetB',
      sort: { field: 'sn', direction: 'asc' },
    };
  const next = H.inheritWorkspace(old, prefs, '剪线异常');
  assert.deepEqual(old, before);
  assert.deepEqual(
    next.views.find((x) => x.id === 'overview'),
    before.views[0],
  );
  const applied = next.views.find((x) => x.id === next.activeId);
  assert.equal(applied.range, '7');
  assert.equal(applied.datasetId, 'datasetB');
  assert.deepEqual(applied.filters, {});
  assert.deepEqual(
    Q.resolve(
      {
        range: applied.range,
        start: applied.start,
        end: applied.end,
        grain: applied.grain,
        datasetId: applied.datasetId,
        sort: applied.sort,
      },
      '2026-10-30',
    ),
    Q.resolve(prefs, '2026-10-30'),
  );
});
test('legacy home settings retain the old format while v2 can hold new periods and sorting', () => {
  const old = H.legacyDefaults();
  assert.equal(old.views[0].sort, undefined);
  assert.deepEqual(H.legacy(old), old);
  const restored = H.validate(old);
  assert.equal(restored.views[0].sort.field, 'date');
  assert.throws(() => H.legacy(H.defaults()));
  assert.equal(old.views[0].sort, undefined);
});
test('active managed names update immediately and sorted reports retain settings after reopen', async (t) => {
  const c = await setup(t),
    made = await c.host.managedCreate({ name: '原名称' });
  await c.host.managedOpen({ id: made.id });
  const s = await c.controller.legacyBootstrap();
  s.records = ['A001', 'B002'].map((sn, i) => ({
    id: 'r' + i,
    templateId: 'general',
    createdAt: '2026-10-30T01:00:00Z',
    values: { sn, found_date: '2026-10-30', issue: '测试' },
  }));
  c.controller.legacySave(s);
  await c.host.managedUpdate({
    id: made.id,
    name: '已更名',
    analysis: { range: '7', grain: 'day', datasetId: '', sort: { field: 'sn', direction: 'asc' } },
  });
  assert.equal(c.controller.status().workspaceName, '已更名');
  assert.deepEqual(
    (await c.host.managedReport({ id: made.id })).rows.map((x) => x.sn),
    ['A001', 'B002'],
  );
  await c.restart();
  const opened = await c.host.managedOpen({ id: made.id });
  assert.equal(opened.analysisPreferences.range, '7');
  assert.equal(opened.analysisPreferences.sort.direction, 'asc');
  assert.equal((await c.host.managedReport({ id: made.id })).rows[0].sn, 'A001');
});
test('catalog serialization remains readable by v0.11 and honors edits from the older writer', async (t) => {
  const c = await setup(t),
    made = await c.host.managedCreate({
      name: '兼容配置',
      analysis: {
        range: 'month',
        grain: 'day',
        datasetId: '',
        sort: { field: 'sn', direction: 'asc' },
      },
    });
  const store = await createSQLiteStateStore(path.join(c.directory, 'catalog.sqlite'));
  try {
    const row = await store.read('managed-workspaces/v1'),
      payload = JSON.parse(await encryption.decryptString(Buffer.from(row.payload))),
      entry = payload.items[0];
    assert.deepEqual(Object.keys(entry.meta.analysis).sort(), [
      'datasetId',
      'end',
      'grain',
      'range',
      'start',
    ]);
    assert.equal(entry.meta.analysis.range, 'custom');
    assert.equal(entry.analysisV2.range, 'month');
    entry.meta.analysis = { range: '7', start: '', end: '', grain: 'week', datasetId: '' };
    await store.write({
      key: 'managed-workspaces/v1',
      expected: row.revision,
      payload: await encryption.encryptString(JSON.stringify(payload)),
      updated: Date.now(),
    });
  } finally {
    await store.close();
  }
  const latest = (await c.host.managedList()).items[0];
  assert.equal(latest.analysis.range, '7');
  assert.equal(latest.analysis.sort.field, 'date');
});
test('failed pre-switch saving keeps the existing workspace open', async (t) => {
  const c = await setup(t),
    a = await c.host.managedCreate({ name: 'A' });
  await c.host.managedOpen({ id: a.id });
  const second = await createManagedWorkspaceHost({
    directory: c.directory,
    controller: c.controller,
    encryption,
    beforeSwitch: async () => {
      throw Error('合成保存失败');
    },
  });
  try {
    await assert.rejects(second.managedOpen({ id: a.id }));
    assert.equal(c.controller.status().managedId, a.id);
    assert.equal(c.controller.status().unlocked, true);
  } finally {
    await second.close();
  }
});
test('summary periods and counts come from the same report instead of stale card data', () => {
  const r = {
    recordCount: 2,
    pending: 1,
    overdue: 0,
    workflowAvailable: true,
    scope: { start: '2026-10-24', end: '2026-10-30' },
    trend: [{ start: '2026-10-24', recordCount: 2 }],
  };
  const s = Q.summary(r);
  assert.equal(s.records, 2);
  assert.equal(s.closedRate, 0.5);
  assert.equal(s.period.start, r.scope.start);
  assert.equal(s.trend[0].count, 2);
});
test('new workspaces publish the complete initial legacy state without replacing an empty file', async (t) => {
  const root = path.join(
    process.env.PLATFORM_TEST_ROOT || path.resolve(__dirname, '../../../../构建/当前作业/测试'),
    'initial-' + randomUUID(),
  );
  await fs.mkdir(root, { recursive: true });
  const file = path.join(root, 'first.eap'),
    legacy = require('../domain/managed-workspaces').emptyState('一次初始化', '剪线');
  const sync = require('node:fs'),
    rename = sync.renameSync;
  let replacements = 0;
  sync.renameSync = (a, b) => {
    if (b === file) {
      replacements++;
      throw Error('Initial creation must not replace');
    }
    return rename(a, b);
  };
  let repo;
  try {
    repo = await createUnifiedRepository({
      file,
      password: 'Synthetic-initial-only-2026!',
      create: true,
      initialLegacyState: legacy,
    });
    assert.deepEqual((await repo.snapshot()).legacyState, legacy);
    assert.equal(replacements, 0);
    await repo.close();
    repo = null;
  } finally {
    sync.renameSync = rename;
    await repo?.close();
  }
  const opened = await createUnifiedRepository({ file, password: 'Synthetic-initial-only-2026!' });
  try {
    assert.deepEqual((await opened.snapshot()).legacyState, legacy);
  } finally {
    await opened.close();
  }
});
test('manager overview does not overwrite or reduce the 32 existing named plans', () => {
  const d = H.defaults();
  d.views = Array.from({ length: 32 }, (_, i) => ({
    ...H.base(),
    id: 'plan' + i,
    name: '方案' + i,
  }));
  d.activeId = 'plan0';
  const migrated = H.inheritWorkspace(d, { range: '7' }, '剪线');
  assert.equal(migrated.views.length, 33);
  assert(migrated.views.some((v) => v.id === 'plan31'));
  assert.equal(d.views.length, 32);
});
