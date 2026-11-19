'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../desktop/app/dashboard-model');
const report = {
  quality: {
    factCount: 2,
    totals: { inspectedUnits: 1000, defectiveUnits: 30 },
    rate: { status: 'available', value: 0.03 },
  },
  observations: {
    status: 'available',
    recordCount: 4,
    issues: [
      { issue: '', count: 1 },
      { issue: '断裂', count: 3 },
    ],
    trend: [{ date: '2026-10-29', recordCount: 4 }],
  },
  comparison: { recordCount: { absolute: -2 } },
};
test('dashboard separates record counts, quantities and weighted aggregate rate', () => {
  const s = model.summarize(report);
  assert.deepEqual(
    s.cards.map((c) => c.value),
    [4, 1000, 30, 0.03],
  );
  assert.equal(s.cards[3].display, '3.00%');
  assert.equal(s.cards[0].source, 'observations');
  assert.ok(s.cards.slice(1).every((c) => c.source === 'quality'));
  assert.match(s.cards[0].note, /-2 条/);
});
test('unknown denominator and unavailable filtering never display a fabricated zero rate/count', () => {
  const broken = structuredClone(report);
  broken.quality.rate = { status: 'unavailable', value: null };
  broken.quality.totals.inspectedUnits = null;
  broken.observations = { status: 'unavailable', recordCount: null, issues: [] };
  const s = model.summarize(broken, 999);
  assert.equal(s.cards[0].display, '—');
  assert.equal(s.cards[1].display, '—');
  assert.equal(s.cards[3].display, '—');
  assert.equal(s.observationAvailable, false);
  assert.deepEqual(s.trend, []);
});
test('zero valid values stay zero while no dataset only enables known record count', () => {
  const r = structuredClone(report);
  r.quality.totals.defectiveUnits = 0;
  r.quality.rate.value = 0;
  assert.equal(model.summarize(r).cards[3].display, '0.00%');
  const empty = model.summarize(null, 0);
  assert.equal(empty.cards[0].display, '0');
  assert.equal(empty.cards[3].display, '—');
});

test('unavailable rate explains the actual validation reason rather than inventing a denominator', () => {
  const r = structuredClone(report);
  r.quality.rate = { status: 'unavailable', value: null, reasons: ['MISSING_DENOMINATOR'] };
  const result = model.summarize(r, null, { MISSING_DENOMINATOR: '部分数据缺少检验件数' });
  assert.equal(result.cards[3].display, '—');
  assert.equal(result.cards[3].note, '部分数据缺少检验件数');
});
test('classification share uses observation count and retains an empty category exactly', () => {
  const s = model.summarize(report);
  assert.equal(s.issues[0].issue, '');
  assert.equal(s.issues[0].share, 0.25);
  assert.equal(s.issues[1].share, 0.75);
});
test('drilldown retains filters, exact date/blank category/ID and never mutates parent query', () => {
  const scope = {
    datasetId: 'test',
    start: '2026-10-01',
    end: '2026-10-29',
    filters: { process: '装管' },
  };
  const copy = structuredClone(scope);
  const query = model.detailQuery(scope, 'observations', {
    date: '2026-10-02',
    issue: '',
    rowId: 'r01',
    page: 2,
  });
  assert.equal(query.start, query.end);
  assert.equal(query.start, '2026-10-02');
  assert.equal(query.filters.issue, '');
  assert.deepEqual(query.rowIds, ['r01']);
  assert.equal(query.pageSize, 25);
  assert.equal(query.sort.field, 'observedOn');
  query.filters.process = 'changed';
  assert.deepEqual(scope, copy);
});
