'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const insights = require('../domain/insights');
const { createPlatform } = require('../index');
const fixture = require('../fixtures/synthetic.json');
const { build } = require('../../analytics-core');

async function quantity(rows = fixture.rows, range = { start: '2026-10-26', end: '2026-10-26' }) {
  const platform = await createPlatform();
  const preview = await platform.imports.previewRows({
    ...structuredClone(fixture),
    rows: structuredClone(rows),
  });
  await platform.imports.commitPreview(preview.previewId, { acknowledgeWarnings: true });
  return platform.analysis.overview({ ...range, datasetId: fixture.dataset.id });
}

test('quantity narrative agrees with totals, weighted rate and the exact grouped increase', async () => {
  const rows = [
    { 业务日: '2026-10-25', 工序: '0012', 检验数: 100, 不良件数: 2, 产量: 100 },
    { 业务日: '2026-10-25', 工序: '12', 检验数: 100, 不良件数: 5, 产量: 100 },
    { 业务日: '2026-10-26', 工序: '0012', 检验数: 100, 不良件数: 5, 产量: 100 },
    { 业务日: '2026-10-26', 工序: '12', 检验数: 100, 不良件数: 4, 产量: 100 },
  ];
  const report = await quantity(rows),
    n = report.insights;
  assert.equal(n.comparisonAvailable, true);
  assert.match(n.highlights[0].text, /7 变为 9 件/);
  assert.match(n.highlights[0].text, /上升 1 个百分点/);
  assert.match(n.highlights[2].text, /0012增加最多/);
  assert.equal(n.highlights[2].action.value, '0012');
  assert.equal(report.quality.totals.defectiveUnits, 9);
});

test('missing source dates suppress period comparisons while explicit zero stays a value', async () => {
  const report = await quantity(fixture.rows, { start: '2026-10-26', end: '2026-10-27' });
  assert.equal(report.insights.comparisonAvailable, false);
  assert.match(report.insights.highlights[0].text, /暂不比较/);
  const zero = await quantity(fixture.rows.map((row) => ({ ...row, 不良件数: 0 })));
  assert.equal(zero.insights.comparisonAvailable, true);
  assert.match(zero.insights.highlights[1].text, /均为0/);
  assert.equal(zero.insights.highlights[1].action, null);
});

test('a zero baseline gives absolute increase without an infinite or invented relative change', async () => {
  const rows = structuredClone(fixture.rows);
  rows[0]['不良件数'] = 0;
  const report = await quantity(rows);
  assert.match(report.insights.highlights[0].text, /增加 2 件/);
  assert.match(report.insights.highlights[0].text, /基期为0/);
  assert.doesNotMatch(report.insights.highlights[0].text, /Infinity|NaN|100\.0%/);
});

test('narrative generation is pure and keeps tied peak periods as evidence', async () => {
  const report = await quantity(
    fixture.rows.map((row) => ({ ...row, 不良件数: 2 })),
    { start: '2026-10-25', end: '2026-10-26' },
  );
  const frozen = JSON.stringify(report),
    result = insights.quantity(report);
  assert.equal(result.highlights[1].evidence.length, 2);
  assert.equal(result.highlights[1].action, null);
  assert.equal(JSON.stringify(report), frozen);
});

test('legacy comparison uses completed dates and original change rows, excluding unfinished today', () => {
  const data = build({
    records: fixture.legacyState.records,
    columns: { issue: 'issue', code: 'silk', group: 'process', serial: 'sn' },
    today: '2026-10-27',
    dateOf: (row) => row.values.found_date,
    options: { range: 'custom', start: '2026-10-26', end: '2026-10-27', grain: 'day' },
  });
  const before = JSON.stringify(data),
    n = insights.legacy(data);
  assert.match(n.highlights[0].text, /增加 2 条记录/);
  assert.ok(n.highlights[0].evidence.some((value) => value.includes('当日尚未结束')));
  assert.equal(JSON.stringify(data), before);
  const todayOnly = build({
    records: [],
    columns: {},
    today: '2026-10-27',
    dateOf: () => '',
    options: { range: 'today' },
  });
  assert.equal(insights.legacy(todayOnly).comparisonAvailable, false);
  assert.ok(
    !insights
      .legacy(todayOnly)
      .highlights[0].evidence.some((value) => value.includes('2026-10-27 至 2026-10-26')),
  );
});

function biReport() {
  return {
    ok: true,
    query: { start: '2026-10-25', end: '2026-10-26' },
    summary: { quantity: 10 },
    periods: [
      {
        start: '2026-10-25',
        end: '2026-10-25',
        quantity: 2,
        previous: 1,
        status: '完整记录日期',
        source_days: 1,
        calendar_days: 1,
        comparison: '可比较',
      },
      {
        start: '2026-10-26',
        end: '2026-10-26',
        quantity: 8,
        previous: 2,
        status: '完整记录日期',
        source_days: 1,
        calendar_days: 1,
        comparison: '可比较',
      },
    ],
    ranking: [{ name: 'AB12', key: 'AB12', quantity: 7, share: 0.7 }],
    bad_dates: 0,
  };
}

test('BI narrative labels latest-period change separately from full-range top source', () => {
  const result = biReport(),
    before = JSON.stringify(result),
    n = insights.bi(result);
  assert.match(n.highlights[0].text, /2026-10-26：由 2 变为 8 pcs/);
  assert.match(n.highlights[2].text, /70\.0%/);
  assert.equal(n.highlights[2].action.key, 'AB12');
  assert.equal(JSON.stringify(result), before);
});

test('BI gaps and invalid dates never borrow an older comparable period to claim the latest change', () => {
  const result = biReport();
  result.periods[1] = {
    ...result.periods[1],
    quantity: null,
    previous: null,
    status: '来源日期有缺口',
    source_days: 0,
  };
  const n = insights.bi(result);
  assert.equal(n.comparisonAvailable, false);
  assert.match(n.highlights[0].text, /暂不比较/);
  assert.doesNotMatch(n.highlights[0].text, /由 1 变为 2/);
  const invalid = biReport();
  invalid.bad_dates = 1;
  assert.equal(insights.bi(invalid).comparisonAvailable, false);
  assert.equal(insights.bi({ empty: true, message: '没有数据' }).highlights[0].text, '没有数据');
});
