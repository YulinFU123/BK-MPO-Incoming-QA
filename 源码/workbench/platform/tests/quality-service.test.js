'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlatform } = require('../index');
const { createMemoryRepository } = require('../adapters/memory/quality-repository');
const { createWorkspaceController } = require('../desktop/workspace-controller');
const { biQualityReport } = require('../adapters/bi/quality-report');
const fixture = require('../fixtures/synthetic.json');
const scope = { start: '2026-10-25', end: '2026-10-27', datasetId: fixture.dataset.id };

async function platformWith(source = structuredClone(fixture)) {
  const repository = createMemoryRepository({ legacyStateEnabled: true });
  const platform = await createPlatform({ ...source, repository });
  const preview = await platform.imports.previewRows(source);
  await platform.imports.commitPreview(preview.previewId, { acknowledgeWarnings: true });
  return { platform, repository };
}

test('quality checks report uncollected dates and reuse configured original unique rules without changing data', async () => {
  const { platform, repository } = await platformWith(),
    before = JSON.stringify(await repository.snapshot());
  const report = await platform.quality.inspect(scope);
  assert.equal(report.checked.facts, 2);
  assert.equal(report.checked.legacy, 2);
  assert.equal(report.checks.find((row) => row.id === 'quantity-gaps').count, 1);
  assert.equal(report.checks.find((row) => row.id === 'quantity-gaps').severity, 'notice');
  const rules = report.checks.find((row) => row.id === 'legacy-rules');
  assert.equal(rules.count, 1);
  assert.equal(rules.samples[0].recordId, 'demo_2');
  assert.equal(rules.samples[0].rowNumber, 2);
  assert.equal(JSON.stringify(await repository.snapshot()), before);
});

test('unchecked unique fields permit repeats and text identifiers keep case and leading zeros', async () => {
  const source = structuredClone(fixture);
  source.legacyState.templates[0].columns.find((row) => row.id === 'sn').uniqueScope = 'off';
  const { platform } = await platformWith(source);
  assert.equal(
    (await platform.quality.inspect(scope)).checks.find((row) => row.id === 'legacy-rules').count,
    0,
  );
  const next = structuredClone(fixture);
  next.legacyState.records = [];
  for (const [index, value] of ['0012', '12', 'A', 'a'].entries())
    next.legacyState.records.push({
      ...structuredClone(fixture.legacyState.records[0]),
      id: 'distinct-' + index,
      values: { ...fixture.legacyState.records[0].values, sn: value },
    });
  const other = await platformWith(next);
  assert.equal(
    (await other.platform.quality.inspect(scope)).checks.find((row) => row.id === 'legacy-rules')
      .count,
    0,
  );
});

test('missing denominators include exact saved fact ID and source row for safe sample drillthrough', async () => {
  const source = structuredClone(fixture);
  source.rows[0]['检验数'] = null;
  const { platform } = await platformWith(source),
    report = await platform.quality.inspect(scope);
  const check = report.checks.find((row) => row.id === 'quantity-denominator');
  assert.equal(check.count, 1);
  assert.equal(check.samples[0].rowNumber, 2);
  const table = await platform.queries.listData({ ...scope, rowIds: [check.samples[0].factId] });
  assert.equal(table.total, 1);
  assert.equal(table.rows[0].businessDate, '2026-10-25');
  assert.equal(table.rows[0].inspectedUnits, null);
  await assert.rejects(
    platform.queries.listData({ ...scope, rowIds: Array(21).fill('id') }),
    (error) => error.code === 'INVALID_QUERY',
  );
});

test('invalid discovery dates are shown as workspace-wide exclusions without inventing a date', async () => {
  const source = structuredClone(fixture);
  source.legacyState.records[0].values.found_date = 'not-a-date';
  const { platform } = await platformWith(source);
  const report = await platform.quality.inspect(scope),
    check = report.checks.find((row) => row.id === 'legacy-projection');
  assert.equal(check.count, 1);
  assert.equal(check.samples[0].recordId, 'demo_1');
  assert.equal(check.samples[0].rowNumber, 1);
  assert.equal(report.checked.legacy, 1);
});

test('empty workspaces and unsupported filters are distinguished from a successful full audit', async () => {
  const platform = await createPlatform();
  const report = await platform.quality.inspect({ start: '2026-10-25', end: '2026-10-27' });
  assert.equal(report.checked.facts, 0);
  assert.equal(report.checked.legacy, 0);
  await assert.rejects(
    platform.quality.inspect({ ...scope, datasetId: 'missing' }),
    (error) => error.code === 'DATASET_REQUIRED',
  );
  const available = await platformWith();
  await assert.rejects(
    available.platform.quality.inspect({ ...scope, filters: { unknown: 'value' } }),
    (error) => error.code === 'UNSUPPORTED_FILTER',
  );
  const controller = createWorkspaceController({ dialogs: {} });
  await assert.rejects(
    controller.qualityReport(scope),
    (error) => error.code === 'WORKSPACE_LOCKED',
  );
});

test('BI quality report retains invalid-date scope and does not invent original worksheet row numbers', () => {
  const result = biQualityReport(
    {
      ok: true,
      empty: false,
      source: { rows: 6 },
      summary: { records: 4 },
      bad_dates: 2,
      periods: [
        { start: '2026-10-25', source_days: 0, calendar_days: 1, status: '来源日期有缺口' },
      ],
    },
    scope,
  );
  assert.equal(result.checks[0].count, 1);
  assert.equal(result.checks[1].count, 2);
  assert.deepEqual(result.checks[1].samples, []);
  assert.match(result.checks[1].explanation, /全历史/);
  assert.equal(biQualityReport({ ok: true, empty: true }, scope).empty, true);
  assert.throws(() => biQualityReport({ ok: false }, scope));
});

test('isolated UI issue scenario keeps 90 original records and routes through guarded quality service', async () => {
  const { qualityDemo } = require('../fixtures/quality-demo');
  const controller = createWorkspaceController({
    dialogs: {},
    legacyEnabled: true,
    demoFactory: qualityDemo,
    clock: () => Date.UTC(2026, 9, 28, 3),
  });
  await controller.openDemo();
  const report = await controller.qualityReport({
    start: '2026-09-29',
    end: '2026-10-28',
    datasetId: fixture.dataset.id,
  });
  for (const id of ['quantity-gaps', 'quantity-denominator', 'legacy-projection', 'legacy-rules'])
    assert.equal(report.checks.find((row) => row.id === id).count, 1, id);
  await controller.lock();
  await assert.rejects(
    controller.qualityReport(scope),
    (error) => error.code === 'WORKSPACE_LOCKED',
  );
});
