'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createImportService } = require('../application/import-service');
const { createMemoryRepository } = require('../adapters/memory/quality-repository');
const rowAdapter = require('../adapters/bi/rows-adapter');
const fixture = require('../fixtures/synthetic.json');
const { assertJSONData } = require('../ports/dto');
const { canonicalJSON } = require('../domain/identity');
const { createAnalysisService } = require('../application/analysis-service');

test('cancelling a queued import prevents the pending confirmation from writing', async () => {
  const repository = createMemoryRepository();
  const service = createImportService({ repository, rowAdapter });
  const preview = await service.previewRows(structuredClone(fixture));
  let release;
  const blocker = repository.transaction(() => new Promise(resolve => { release = resolve; }));
  await Promise.resolve();
  const pending = service.commitPreview(preview.previewId);
  assert.equal(service.cancelPreview(preview.previewId), true);
  release();
  await blocker;
  await assert.rejects(pending, error => error.code === 'PREVIEW_EXPIRED');
  const state = await repository.snapshot();
  assert.equal(state.batches.length, 0);
  assert.equal(state.facts.length, 0);
});

test('cancelling while a host authorization check awaits also invalidates confirmation', async () => {
  const repository = createMemoryRepository();
  const service = createImportService({ repository, rowAdapter });
  const preview = await service.previewRows(structuredClone(fixture));
  let authorize;
  let signal;
  const started = new Promise(resolve => { signal = resolve; });
  const pending = service.commitPreview(preview.previewId, { authorize: () => {
    signal();
    return new Promise(resolve => { authorize = resolve; });
  } });
  await started;
  assert.equal(service.cancelPreview(preview.previewId), true);
  authorize(true);
  await assert.rejects(pending, error => error.code === 'PREVIEW_EXPIRED');
  assert.equal((await repository.snapshot()).facts.length, 0);
});

test('JSON payload budget includes oversized property names with non-string values', () => {
  const payload = { ['x'.repeat(8 * 1024 * 1024 + 1)]: 0 };
  assert.throws(() => assertJSONData(payload), error => error.code === 'PAYLOAD_TOO_LARGE');
});

test('JSON DTO validation rejects sparse arrays disguised by an out-of-range numeric property', () => {
  const value = new Array(1);
  value['4294967295'] = 'not-an-array-index';
  assert.throws(() => assertJSONData(value), error => error.code === 'INVALID_PAYLOAD');
});

test('canonical identity rejects sparse arrays instead of silently serializing missing cells as null', () => {
  const value = new Array(1);
  value['4294967295'] = 'not-an-array-index';
  assert.throws(() => canonicalJSON(value), error => error.code === 'INVALID_JSON');
});

test('a valid earliest business date still returns current statistics when its previous period is unrepresentable', async () => {
  const repository = createMemoryRepository();
  await repository.transaction(tx => tx.replaceObservations([{
    id: 'early-record', templateId: 'incoming', observedOn: '0001-01-01',
    serialNumber: '0001Ab', issue: '合成边界', relatedCode: '0012', dimensions: { process: '装管' }
  }]));
  const report = await createAnalysisService({ repository }).overview({
    start: '0001-01-01', end: '0001-01-01', datasetId: 'syntheticQuality'
  });
  assert.equal(report.observations.status, 'available');
  assert.equal(report.observations.recordCount, 1);
  assert.equal(report.observations.uniqueSerialCount, 1);
  assert.deepEqual(report.comparison, {
    status: 'unavailable', reasons: ['PREVIOUS_PERIOD_OUT_OF_RANGE'],
    previous: null, recordCount: null, uniqueSerialCount: null,
    defectRatePercentagePoints: null, previousQuality: null
  });
});

test('an explicit template filter excludes unrelated templates when checking observation dimension support', async () => {
  const repository = createMemoryRepository();
  await repository.transaction(tx => tx.replaceObservations([
    { id: 'incoming-current', templateId: 'incoming', observedOn: '2026-10-26', serialNumber: '0001Ab', issue: '合成来料', relatedCode: '0012', dimensions: { process: '装管' } },
    { id: 'incoming-prior', templateId: 'incoming', observedOn: '2026-10-25', serialNumber: '0002aB', issue: '合成来料', relatedCode: 'AB12', dimensions: { process: '装管' } },
    { id: 'equipment-current', templateId: 'equipment', observedOn: '2026-10-26', serialNumber: 'EQ1', issue: '合成设备', relatedCode: '', dimensions: {} }
  ]));
  const report = await createAnalysisService({ repository }).overview({
    start: '2026-10-26', end: '2026-10-26', datasetId: 'syntheticQuality',
    filters: { templateId: 'incoming', process: '装管' }
  });
  assert.equal(report.observations.status, 'available');
  assert.equal(report.observations.recordCount, 1);
  assert.equal(report.observations.uniqueSerialCount, 1);
  assert.equal(report.comparison.status, 'available');
  assert.deepEqual(report.comparison.recordCount, { absolute: 0, relative: 0 });
  assert.equal(report.warnings.includes('OBSERVATION_FILTER_UNSUPPORTED'), false);
});
