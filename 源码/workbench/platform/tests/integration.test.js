'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlatform } = require('../index');
const { createMemoryRepository } = require('../adapters/memory/quality-repository');
const { createImportService } = require('../application/import-service');
const rowAdapter = require('../adapters/bi/rows-adapter');
const fixture = require('../fixtures/synthetic.json');
const input = () => structuredClone(fixture);
const code = expected => error => error.code === expected;

test('end-to-end synthetic import keeps anomaly counts separate and compares equal periods', async () => {
  const source = input();
  const before = structuredClone(source);
  const platform = await createPlatform(source);
  const preview = await platform.imports.previewRows(source);
  assert.equal(preview.canCommit, true);
  assert.equal((await platform.imports.commitPreview(preview.previewId)).status, 'imported');
  const report = await platform.analysis.overview({ start: '2026-10-26', end: '2026-10-26', datasetId: source.dataset.id });
  assert.equal(report.observations.recordCount, 2);
  assert.equal(report.observations.uniqueSerialCount, 1);
  assert.equal(report.quality.rate.value, 0.02);
  assert.equal(report.comparison.defectRatePercentagePoints, -3);
  assert.deepEqual(report.comparison.previous, { start: '2026-10-25', end: '2026-10-25' });
  assert.equal(platform.capabilities.automaticBiExport, false);
  assert.equal(platform.capabilities.productionPersistence, false);
  assert.equal(platform.capabilities.excelFileImport, true);
  await assert.rejects(platform.bi.requestExport(), code('BI_NOT_CONFIGURED'));
  assert.deepEqual(source, before);
});

test('preview input and returned DTO mutations cannot alter the private commit snapshot', async () => {
  const repo = createMemoryRepository();
  const platform = await createPlatform({ repository: repo });
  const source = input();
  const preview = await platform.imports.previewRows(source);
  source.rows[0]['不良件数'] = 99;
  preview.dataset.id = 'hijacked';
  preview.stats.errorCount = 100;
  await platform.imports.commitPreview(preview.previewId);
  const state = await repo.snapshot();
  assert.equal(state.facts[0].measures.defectiveUnits, 5);
  assert.equal(state.datasets[0].id, fixture.dataset.id);
  state.facts[0].measures.defectiveUnits = 88;
  assert.equal((await repo.snapshot()).facts[0].measures.defectiveUnits, 5);
});

test('concurrent same-file commits write once; mapping change cannot bypass idempotency', async () => {
  const repo = createMemoryRepository();
  const platform = await createPlatform({ repository: repo });
  const a = await platform.imports.previewRows(input());
  const bInput = input();
  bInput.mapping.measures = { inspectedUnits: '检验数', defectiveUnits: '不良件数' };
  const b = await platform.imports.previewRows(bInput);
  const results = await Promise.all([platform.imports.commitPreview(a.previewId), platform.imports.commitPreview(b.previewId)]);
  assert.deepEqual(results.map(item => item.status).sort(), ['duplicate', 'imported']);
  const state = await repo.snapshot();
  assert.equal(state.batches.length, 1);
  assert.equal(state.facts.length, 2);
});

test('different file with overlapping date/grain is atomically rejected', async () => {
  const repo = createMemoryRepository();
  const platform = await createPlatform({ repository: repo });
  const first = await platform.imports.previewRows(input());
  await platform.imports.commitPreview(first.previewId);
  const next = input();
  next.rows = [
    { '业务日': '2026-10-27', '工序': '装管', '检验数': 10, '不良件数': 1 },
    ...next.rows
  ];
  const preview = await platform.imports.previewRows(next);
  await assert.rejects(platform.imports.commitPreview(preview.previewId), code('GRAIN_OVERLAP'));
  const state = await repo.snapshot();
  assert.equal(state.batches.length, 1);
  assert.equal(state.facts.length, 2);
  assert.equal(state.facts.some(fact => fact.businessDate === '2026-10-27'), false);
});

test('invalid row prevents every row from committing, including valid prefix', async () => {
  const repo = createMemoryRepository();
  const platform = await createPlatform({ repository: repo });
  const next = input(); next.rows[1]['检验数'] = -1;
  const preview = await platform.imports.previewRows(next);
  assert.equal(preview.canCommit, false);
  await assert.rejects(platform.imports.commitPreview(preview.previewId), code('INVALID_PREVIEW'));
  assert.equal((await repo.snapshot()).facts.length, 0);
});

test('preview expiration/cancel/capacity and dataset context changes are enforced', async () => {
  let now = 0;
  const repo = createMemoryRepository();
  const service = createImportService({ repository: repo, rowAdapter, clock: () => now, ttlMs: 10, maxPreviews: 1 });
  const a = await service.previewRows(input());
  await assert.rejects(service.previewRows(input()), code('PREVIEW_CAPACITY'));
  now = 11;
  await assert.rejects(service.commitPreview(a.previewId), code('PREVIEW_EXPIRED'));
  const b = await service.previewRows(input());
  await repo.transaction(tx => tx.putDataset({ ...fixture.dataset, label: fixture.dataset.label, version: '2' }));
  await assert.rejects(service.commitPreview(b.previewId), code('DATASET_CONFLICT'));
  assert.equal(service.cancelPreview(b.previewId), true);
  await assert.rejects(service.commitPreview(b.previewId), code('PREVIEW_EXPIRED'));
});

test('concurrent previews cannot exceed capacity', async () => {
  const service = createImportService({ repository: createMemoryRepository(), rowAdapter, maxPreviews: 1 });
  const results = await Promise.allSettled([service.previewRows(input()), service.previewRows(input())]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'PREVIEW_CAPACITY');
});

test('completed previews do not exhaust active slots; repeated commit remains idempotent', async () => {
  const service = createImportService({ repository: createMemoryRepository(), rowAdapter, maxPreviews: 1 });
  let first;
  for (let i = 0; i < 25; i++) {
    const preview = await service.previewRows(input());
    first ||= preview;
    assert.equal((await service.commitPreview(preview.previewId)).status, i === 0 ? 'imported' : 'duplicate');
  }
  assert.equal((await service.commitPreview(first.previewId)).status, 'duplicate');
});

test('unaligned observation dimension is unavailable rather than a false zero', async () => {
  const source = input(); delete source.legacyMappings;
  const platform = await createPlatform(source);
  const p = await platform.imports.previewRows(source);
  await platform.imports.commitPreview(p.previewId);
  const report = await platform.analysis.overview({ start: '2026-10-26', end: '2026-10-26', datasetId: fixture.dataset.id, filters: { process: '装管' } });
  assert.equal(report.observations.status, 'unavailable');
  assert.equal(report.observations.recordCount, null);
  assert.equal(report.comparison.recordCount, null);
  assert.ok(report.warnings.includes('OBSERVATION_FILTER_UNSUPPORTED'));
  assert.equal(report.quality.rate.value, 0.02);
});

test('repository rolls back every write when callback fails and closes escaped transaction', async () => {
  const repo = createMemoryRepository();
  let escaped;
  await assert.rejects(repo.transaction(tx => {
    escaped = tx;
    tx.putDataset(fixture.dataset);
    tx.addBatch({ identity: 'abc', id: 'batch1' });
    throw new Error('simulated storage failure');
  }));
  assert.deepEqual(await repo.snapshot(), { datasets: [], batches: [], facts: [], observations: [] });
  assert.throws(() => escaped.putDataset(fixture.dataset), code('TRANSACTION_CLOSED'));
  await repo.transaction(tx => tx.putDataset(fixture.dataset));
  assert.equal((await repo.snapshot()).datasets.length, 1);
});

test('host authorization is rechecked after queue delay before any batch is committed', async () => {
  const repo = createMemoryRepository();
  const service = createImportService({ repository: repo, rowAdapter });
  const preview = await service.previewRows(input());
  let release;
  const blocker = repo.transaction(() => new Promise(resolve => { release = resolve; }));
  await Promise.resolve();
  let unlocked = true;
  const commit = service.commitPreview(preview.previewId, { authorize: () => unlocked });
  unlocked = false;
  release(); await blocker;
  await assert.rejects(commit, code('WORKSPACE_LOCKED'));
  assert.equal((await repo.snapshot()).batches.length, 0);
});

test('injected workbook reader computes identity from actual bytes, not caller hash', async () => {
  const repo = createMemoryRepository();
  const reader = { async read() { return { rows: fixture.rows, sheetName: '检验', headerRow: 3 }; } };
  const platform = await createPlatform({ repository: repo, workbookReader: reader });
  const a = await platform.imports.previewWorkbook({ ...fixture, bytes: Buffer.from('synthetic workbook bytes'), source: { sha256: 'fake' } });
  assert.equal(a.provenance.identityBasis, 'file-sha256');
  assert.notEqual(a.provenance.contentHash, 'fake');
  assert.equal(a.provenance.headerRow, 3);
  await platform.imports.commitPreview(a.previewId);
  assert.equal((await repo.snapshot()).facts[0].source.rowNumber, 4);
  const noReader = await createPlatform({ workbookReader: null });
  await assert.rejects(noReader.imports.previewWorkbook({ bytes: Buffer.from('x') }), code('WORKBOOK_READER_UNAVAILABLE'));
});

test('unsupported SN filter cannot reuse unchanged BI denominator or invent a rate', async () => {
  const platform = await createPlatform(input());
  const preview = await platform.imports.previewRows(input());
  await platform.imports.commitPreview(preview.previewId);
  const report = await platform.analysis.overview({ start: '2026-10-26', end: '2026-10-26', datasetId: fixture.dataset.id, filters: { serialNumber: '0001Ab' } });
  assert.equal(report.observations.recordCount, 2);
  assert.equal(report.quality.rate.value, null);
  assert.ok(report.quality.rate.reasons.includes('UNSUPPORTED_FILTER'));
});

test('memory repository is empty on a new instance and broken legacy snapshots fail closed', async () => {
  const platform = await createPlatform(input());
  const p = await platform.imports.previewRows(input());
  await platform.imports.commitPreview(p.previewId);
  const fresh = await createPlatform();
  const report = await fresh.analysis.overview({ start: '2026-10-26', end: '2026-10-26', datasetId: fixture.dataset.id });
  assert.equal(report.quality.factCount, 0);
  assert.equal(report.quality.rate.value, null);
  const broken = input(); broken.legacyState.records[0].values.found_date = '2026-02-30';
  await assert.rejects(createPlatform(broken), code('LEGACY_SNAPSHOT_INVALID'));
});

test('payload accessors are rejected without execution before preview serialization', async () => {
  const platform = await createPlatform();
  let calls = 0;
  const next = input();
  Object.defineProperty(next.rows[0], 'secret', { enumerable: true, get() { calls++; return 'sensitive'; } });
  await assert.rejects(platform.imports.previewRows(next), code('INVALID_PAYLOAD'));
  assert.equal(calls, 0);
});

test('workbook physical row provenance survives gaps and warnings need explicit acknowledgement', async () => {
  const repo = createMemoryRepository();
  const platform = await createPlatform({ repository: repo, workbookReader: {
    async read() { return {
      rows: fixture.rows, rowNumbers: [3, 7], sheetName: '数据', headerRow: 2,
      warnings: [{ code: 'FORMULA_CACHED_VALUE', message: '公式使用缓存结果。', requiresAcknowledgement: true }]
    }; }
  } });
  const preview = await platform.imports.previewWorkbook({ bytes: Buffer.from('fixture'), dataset: fixture.dataset, mapping: fixture.mapping });
  assert.equal(preview.requiresAcknowledgement, true);
  assert.equal(preview.canCommit, false);
  await assert.rejects(platform.imports.commitPreview(preview.previewId), code('WARNINGS_NOT_ACKNOWLEDGED'));
  await platform.imports.commitPreview(preview.previewId, { acknowledgeWarnings: true });
  const state = await repo.snapshot();
  assert.deepEqual(state.facts.map(fact => fact.source.rowNumber), [3, 7]);
  assert.deepEqual(state.batches[0].warningCodes, ['FORMULA_CACHED_VALUE']);
  assert.equal(state.batches[0].warningsAcknowledged, true);
});

test('workbook warning totals remain visible when displayed warnings are capped', async () => {
  const repo = createMemoryRepository();
  const warnings = Array.from({ length: 100 }, () => ({ code: 'CACHED_FORMULA_RESULT', message: '公式缓存需核对。', requiresAcknowledgement: true }));
  const platform = await createPlatform({ repository: repo, workbookReader: { async read() {
    return { rows: fixture.rows, sheetName: '数据', headerRow: 1, warnings, warningCount: 250, warningsTruncated: true };
  } } });
  const preview = await platform.imports.previewWorkbook({ bytes: Buffer.from('fixture'), dataset: fixture.dataset, mapping: fixture.mapping });
  assert.equal(preview.warningCount, 250);
  assert.equal(preview.warnings.length, 100);
  assert.equal(preview.warningsTruncated, true);
  await platform.imports.commitPreview(preview.previewId, { acknowledgeWarnings: true });
  assert.equal((await repo.snapshot()).batches[0].warningCount, 250);
});
