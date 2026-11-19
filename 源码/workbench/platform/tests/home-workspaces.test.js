'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict');
const model = require('../domain/home-workspaces'),
  { buildHomeReport, bucket } = require('../domain/home-report');
const { homeDemo } = require('../fixtures/home-demo'),
  { adaptLegacyState } = require('../adapters/legacy/state-adapter'),
  { previewBiRows } = require('../adapters/bi/rows-adapter');
function snapshot() {
  const f = homeDemo('2026-10-29');
  return {
    legacyState: f.legacyState,
    observations: adaptLegacyState(f.legacyState, { mappings: f.legacyMappings }).observations,
    datasets: [f.dataset],
    facts: previewBiRows({
      rows: f.rows,
      dataset: f.dataset,
      mapping: f.mapping,
      source: { batchId: 'home-test' },
    }).facts,
  };
}
const query = () => ({
  start: '2026-09-30',
  end: '2026-10-29',
  datasetId: 'demoQuality',
  filters: {},
  grain: 'week',
});
const get = (s, q = {}) => buildHomeReport(s, { ...query(), ...q }, { today: '2026-10-29' });
test('home counts, quantities and rates use distinct source records and facts', () => {
  const s = snapshot(),
    r = get(s);
  assert.equal(r.recordCount, 45);
  assert.equal(r.selectedIdCount, 45);
  const facts = s.facts.filter((f) => f.businessDate >= query().start);
  assert.equal(
    r.quality.totals.defectiveUnits,
    facts.reduce((a, f) => a + f.measures.defectiveUnits, 0),
  );
  assert.equal(
    r.quality.rate.value,
    r.quality.totals.defectiveUnits / r.quality.totals.inspectedUnits,
  );
  assert.notEqual(r.recordCount, r.quality.totals.defectiveUnits);
});
test('follow-up counts apply status and deadline before pagination', () => {
  const s = snapshot(),
    all = get(s),
    r = get(s, { followup: 'overdue', pageSize: 5 });
  const ids = new Set(
    s.legacyState.records
      .filter(
        (x) =>
          x.workflow.status !== '已关闭' &&
          x.workflow.dueDate < '2026-10-29' &&
          x.values.found_date >= query().start,
      )
      .map((x) => x.id),
  );
  assert.equal(all.overdue, ids.size);
  assert.equal(r.total, ids.size);
  assert.ok(r.rows.every((x) => ids.has(x.id)));
  assert.equal(r.quality.totals.inspectedUnits, null);
});
test('owner and reporter remain separate; unsupported quality filter is not discarded', () => {
  const s = snapshot(),
    r = get(s, { filters: { owner: '示例甲' } });
  assert.ok(r.rows.every((x) => x.owner === '示例甲'));
  assert.equal(r.quality.totals.defectiveUnits, null);
  assert.ok(!r.filterOptions.reporter.includes('示例甲'));
  assert.ok(r.filterOptions.reporter.includes('示例报检员A'));
});
test('SN search and exact identifiers never turn into unrestricted quality totals', () => {
  const s = snapshot(),
    one = get(s).rows[0],
    r = get(s, { search: one.sn });
  assert.equal(r.total, 1);
  assert.equal(r.rows[0].sn, one.sn);
  assert.equal(r.quality.totals.inspectedUnits, null);
  assert.equal(get(s, { filters: { serialNumber: one.sn } }).total, 1);
});
test('weekly and monthly groups retain all count data and shifted-period totals', () => {
  const s = snapshot();
  for (const grain of ['day', 'week', 'month']) {
    const r = get(s, { grain });
    assert.equal(
      r.trend.reduce((a, x) => a + x.recordCount, 0),
      r.recordCount,
    );
    assert.equal(
      r.trend.reduce((a, x) => a + x.previousCount, 0),
      r.previousCount,
    );
  }
  assert.equal(bucket('2026-10-29', 'week'), '2026-10-26');
});
test('all detail headers sort in both directions and paginate without duplicates', () => {
  const s = snapshot();
  for (const field of [
    'sequence',
    'date',
    'sn',
    'process',
    'issue',
    'owner',
    'reporter',
    'shift',
    'status',
  ])
    for (const direction of ['asc', 'desc']) {
      const r = get(s, { sort: { field, direction }, pageSize: 50 });
      assert.equal(r.rows.length, 45);
      assert.equal(new Set(r.rows.map((x) => x.id)).size, 45);
      for (let i = 1; i < r.rows.length; i++) {
        const a = r.rows[i - 1][field],
          b = r.rows[i][field],
          cmp = typeof a === 'number' ? a - b : String(a).localeCompare(String(b), 'zh-CN');
        assert.ok(direction === 'asc' ? cmp <= 0 : cmp >= 0);
      }
    }
});
test('home report does not mutate source and revision changes with workflow updates', () => {
  const s = snapshot(),
    before = JSON.stringify(s),
    r = get(s);
  assert.equal(JSON.stringify(s), before);
  s.legacyState.records.at(-1).workflow.owner = '另一个示例';
  assert.notEqual(get(s).observationRevision, r.observationRevision);
});
test('analysis workspace state rejects broken active tab, invalid date and unsafe filters', () => {
  const d = model.defaults();
  assert.deepEqual(model.validate(d), d);
  for (const edit of [
    (v) => (v.activeId = 'gone'),
    (v) => (v.views[0].open = false),
    (v) => {
      v.views[0].range = 'custom';
      v.views[0].start = '2026-02-30';
      v.views[0].end = '2026-03-02';
    },
    (v) => (v.views[0].filters.unknown = 'x'),
  ]) {
    const x = structuredClone(d);
    edit(x);
    assert.throws(() => model.validate(x));
  }
});
