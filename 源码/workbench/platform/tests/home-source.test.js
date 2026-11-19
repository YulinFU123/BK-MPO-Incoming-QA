'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict');
const source = require('../domain/home-source'),
  state = require('../domain/module-state');
const { createHomeOverview } = require('../application/home-overview-service');
test('workspace primary choice overrides a stale homepage preference without combining datasets', async () => {
  let reads = 0;
  const manual = createHomeOverview({
    readRecords: async () => record(),
    readBI: async () => {
      reads++;
      return bi();
    },
    session: () => 1,
    workspaceMode: () => 'records',
  });
  const a = await manual({ query: query(), preference: { mode: 'bi' } });
  assert.equal(a.primary.source, 'records');
  assert.equal(reads, 0);
  const imported = createHomeOverview({
    readRecords: async () => record(),
    readBI: async () => bi(),
    session: () => 1,
    workspaceMode: () => 'bi',
  });
  const b = await imported({ query: query(), preference: { mode: 'records' } });
  assert.equal(b.primary.source, 'bi');
  assert.equal(b.recordCount, 5);
  assert.equal(b.biSource.quantity, 100);
});
test('native data outside the selected date range stays BI with an explanation, never becomes manual zero', () => {
  const s = source.choose(
    record(0),
    { state: 'out-of-range', hasData: true, message: 'October data outside November' },
    {},
  );
  assert.equal(s.source, 'bi');
  assert.equal(s.available, false);
  assert.match(s.notice, /October/);
  assert.equal(source.preferences({ channel: 'studio' }).channel, 'studio');
});
const record = (count = 5) => ({
  recordCount: count,
  scope: { start: '2026-10-01', end: '2026-10-30' },
  pending: 2,
  rows: [{ id: 'manual-id', sn: '0012' }],
});
const bi = () => ({
  state: 'available',
  quantity: 100,
  rowCount: 8,
  rows: [{ sn: '0012', quantity: 100 }],
});
const query = () => ({
  start: '2026-10-01',
  end: '2026-10-30',
  filters: {},
  page: 1,
  pageSize: 10,
});
test('auto chooses BI without requiring manual records, including a verified zero quantity', () => {
  assert.equal(source.choose(record(0), bi(), {}).source, 'bi');
  assert.equal(source.choose(record(0), { ...bi(), quantity: 0, rowCount: 0 }, {}).source, 'bi');
  assert.equal(source.choose(record(), { state: 'empty' }, {}).source, 'records');
});
test('manual 5 records and BI 100 pcs never become 105 or mutate the inputs', async () => {
  const r = record(),
    b = bi(),
    original = structuredClone([r, b]);
  const service = createHomeOverview({
    readRecords: async () => r,
    readBI: async () => b,
    session: () => 1,
  });
  const result = await service({ query: query() });
  assert.equal(result.recordCount, 5);
  assert.equal(result.biSource.quantity, 100);
  assert.equal(result.primary.manualCount, 5);
  assert.equal(result.primary.source, 'bi');
  assert.deepEqual([r, b], original);
  assert.equal(result.pending, 2);
  assert.equal(
    result.biSource.rows[0].sn,
    result.rows[0].sn,
    'a shared SN does not delete either source record',
  );
});
test('explicit BI choice does not silently fall back or turn a read error into zero', async () => {
  const service = createHomeOverview({
    readRecords: async () => record(),
    readBI: async () => {
      throw Error('synthetic failure');
    },
    session: () => 1,
  });
  const result = await service({ query: query(), preference: { mode: 'bi' } });
  assert.equal(result.primary.source, 'bi');
  assert.equal(result.primary.available, false);
  assert.equal(result.biSource.state, 'error');
  assert.equal(result.biSource.quantity, undefined);
});
test('manual mode avoids BI IO and configuration defaults accept older empty preferences', async () => {
  const service = createHomeOverview({
    readRecords: async () => record(),
    readBI: async () => {
      assert.fail('BI not requested');
    },
    session: () => 1,
  });
  assert.equal(
    (await service({ query: query(), preference: { mode: 'records' } })).primary.source,
    'records',
  );
  assert.deepEqual(source.preferences({}), source.defaults());
  const a = { scope: 'module', module: 'home-data-source' };
  assert.deepEqual(state.validate(a, { mode: 'bi' }), { ...source.defaults(), mode: 'bi' });
  assert.throws(() => state.validate(a, { records: [] }));
});
test('all-date BI range extends manual follow-up query to the same period', async () => {
  const calls = [];
  const service = createHomeOverview({
    readRecords: async (q) => {
      calls.push(q);
      return record();
    },
    readBI: async () => ({ ...bi(), range: { start: '2026-01-01', end: '2026-10-30' } }),
    session: () => 1,
  });
  await service({ query: query(), allDates: true });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].start, '2026-01-01');
});
test('workspace change during BI processing cannot leak results to another workspace', async () => {
  let session = 1;
  const service = createHomeOverview({
    readRecords: async () => record(),
    readBI: async () => {
      session++;
      return bi();
    },
    session: () => session,
  });
  await assert.rejects(service({ query: query() }), (error) => error.code === 'SESSION_CHANGED');
});
test('unresolved sources fall back with a message, never silently add multiple BI scopes', () => {
  const r = source.choose(record(), { state: 'needs-scope', message: 'select one scope' }, {});
  assert.equal(r.source, 'records');
  assert.equal(r.notice, 'select one scope');
  for (const value of [
    { mode: 'sum' },
    { channel: 'all' },
    { dailyScope: [] },
    { employee: 'x\ny' },
    { unknown: true },
  ])
    assert.throws(() => source.preferences(value));
});
test('exact BI drill filters and export requests pass through without changing manual filters', async () => {
  let input;
  const service = createHomeOverview({
    readRecords: async () => record(),
    readBI: async (r) => {
      input = r;
      return bi();
    },
    session: () => 1,
  });
  await service({ query: query(), biFilter: { field: 'issue', value: '' }, exportRows: true });
  assert.deepEqual(input.biFilter, { field: 'issue', value: '' });
  assert.equal(input.exportRows, true);
  assert.deepEqual(input.query.filters, {});
  await assert.rejects(service({ query: query(), biFilter: { field: 'owner', value: 'x' } }));
  await assert.rejects(service({ query: query(), unknown: true }));
});
test('quantity donuts accept fractional pcs while record donuts retain integer and sum checks', () => {
  const chart = require('../domain/chart-data');
  assert.throws(() => chart.donut([{ value: 'A', count: 0.1 }], 0.1));
  assert.equal(
    chart.donut(
      [
        { value: 'A', count: 0.1 },
        { value: 'B', count: 0.2 },
      ],
      0.3,
      { quantity: true },
    ).items.length,
    2,
  );
  assert.throws(() => chart.donut([{ value: 'A', count: 3 }], 4, { quantity: true }));
});
test('import notifications update home but homepage reads and autosaves cannot form a refresh loop', () => {
  assert.equal(
    source.changesData('/api/daily/import', { ok: true, results: [{ state: '新增' }] }),
    true,
  );
  assert.equal(
    source.changesData('/api/daily/import', { ok: true, results: [{ state: '重复，跳过' }] }),
    false,
  );
  assert.equal(source.changesData('/api/fusion/inbox', { results: [{ state: 'done' }] }), true);
  assert.equal(source.changesData('/api/fusion/inbox', { results: [{ state: 'failed' }] }), false);
  for (const route of ['/api/fusion/home', '/api/save', '/api/daily/save'])
    assert.equal(source.changesData(route, { ok: true }), false);
});

test('homepage column overrides save per source in a separate module and reject unknown roles', () => {
  const address = { scope: 'module', module: 'home-bi-columns' };
  const config = { sources: {
    bi: { process: 'h_0000000000000001' },
    mlight: { process: 'h_0000000000000002', issue: 'h_0000000000000003' },
  } };
  const saved = state.validate(address, config);
  assert.deepEqual(saved, config);
  assert.notEqual(saved.sources.bi.process, saved.sources.mlight.process);
  assert.throws(() => state.validate(address, { sources: { bi: { date: 'h_0000000000000001' } } }));
  assert.throws(() => state.validate(address, { sources: { bi: { process: 'Workflow Step Name' } } }));
});
