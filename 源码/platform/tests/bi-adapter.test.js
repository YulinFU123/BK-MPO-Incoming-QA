'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeDataset, previewBiRows } = require('../adapters/bi/rows-adapter');

const dataset = { id: 'daily_quality', label: '每日工序质量', version: '1', grainFields: ['process', 'model'], unit: 'piece' };
const mapping = {
  dateColumn: '业务日', dateFormat: 'iso',
  dimensions: { process: '工序', model: '型号' },
  measures: { inspectedUnits: '检验数', defectiveUnits: '不良件数', defectEvents: '缺陷次数' }
};
const source = { batchId: 'test-batch-1' };
function preview(rows, changes = {}) {
  return previewBiRows({ rows, dataset, mapping, source, ...changes });
}
const valid = () => ({ '业务日': '2026-10-26', '工序': '组装', '型号': '0012', '检验数': '100', '不良件数': '0', '缺陷次数': '2' });

test('BI adapter preserves text identifiers and separates absent measures from zero', () => {
  const rows = [valid()];
  const before = structuredClone(rows);
  const result = preview(rows);
  assert.deepEqual(rows, before);
  assert.equal(result.stats.errorCount, 0);
  assert.equal(result.facts[0].dimensions.model, '0012');
  assert.equal(result.facts[0].measures.defectiveUnits, 0);
  assert.equal(result.facts[0].measures.productionUnits, null);
  assert.equal(result.facts[0].source.rowNumber, 2);
  assert.deepEqual(Object.keys(result.facts[0].source).sort(), ['batchId', 'rowNumber']);
});

test('BI adapter accepts daily totals without inventing a dimension', () => {
  const result = preview([{ '业务日': '2026-10-26', '检验数': '100' }], {
    dataset: { ...dataset, grainFields: [] }, mapping: { ...mapping, dimensions: {} }
  });
  assert.equal(result.stats.errorCount, 0);
  assert.deepEqual(result.facts[0].dimensions, {});
});

test('BI adapter rejects numeric identifiers instead of losing leading zero information', () => {
  const result = preview([{ ...valid(), '型号': 12 }]);
  assert.equal(result.stats.validRowCount, 0);
  assert.equal(result.errors[0].field, 'model');
});

test('BI adapter uses explicit date grammar and calendar validation', () => {
  const dates = ['10/26/2026', '2026-02-29', '2026-13-01', ''];
  const result = preview(dates.map(date => ({ ...valid(), '业务日': date })));
  assert.equal(result.stats.errorCount, dates.length);
  const leap = preview([{ ...valid(), '业务日': '2024/2/29' }], { mapping: { ...mapping, dateFormat: 'ymd-slash' } });
  assert.equal(leap.facts[0].businessDate, '2024-02-29');
  assert.throws(() => preview([valid()], { mapping: { ...mapping, dateFormat: undefined } }), error => error.code === 'DATE_FORMAT_REQUIRED');
});

test('BI adapter detects natural grain duplicates while allowing different days and models', () => {
  const result = preview([valid(), { ...valid() }, { ...valid(), '业务日': '2026-10-25' }, { ...valid(), '型号': '12' }]);
  assert.equal(result.facts.length, 3);
  assert.equal(result.errors[0].code, 'DUPLICATE_GRAIN');
  assert.equal(result.errors[0].rowNumber, 3);
});

test('BI adapter rejects unsafe objects and keys without polluting prototypes', () => {
  const row = JSON.parse('{"业务日":"2026-10-26","__proto__":{"polluted":true}}');
  assert.equal(preview([row]).errors[0].code, 'UNSAFE_KEY');
  assert.equal({}.polluted, undefined);
  assert.throws(() => preview([valid()], { mapping: { ...mapping, dimensions: JSON.parse('{"constructor":"型号"}') } }), error => error.code === 'UNSAFE_KEY');
  assert.throws(() => preview([valid()], { mapping: { ...mapping, dimensions: { 'invalid-field': '型号' } } }), error => error.code === 'INVALID_IDENTIFIER');
});

test('BI adapter rejects missing grain mapping, unsupported units and unknown measures', () => {
  assert.throws(() => preview([valid()], { mapping: { ...mapping, dimensions: { process: '工序' } } }), error => error.code === 'MISSING_GRAIN_MAPPING');
  assert.throws(() => normalizeDataset({ ...dataset, unit: 'batch' }), error => error.code === 'UNSUPPORTED_UNIT');
  assert.throws(() => preview([valid()], { mapping: { ...mapping, measures: { defectRate: '不良件数' } } }), error => error.code === 'UNKNOWN_MEASURE');
  assert.throws(() => preview([valid()], { mapping: { ...mapping, measures: { inspectedUnits: '检验数', productionUnits: '检验数' } } }), error => error.code === 'REUSED_COLUMN');
});

test('BI adapter rejects negative, fractional, unsafe integers and inconsistent numerator', () => {
  const result = preview(['-1', '1.5', '9007199254740992', '101'].map(value => ({ ...valid(), '不良件数': value })));
  assert.equal(result.stats.errorCount, 4);
  assert.equal(result.errors.at(-1).code, 'NUMERATOR_EXCEEDS_DENOMINATOR');
});

test('BI adapter bounds row processing and sanitized error reporting', () => {
  assert.throws(() => preview(Array.from({ length: 10001 }, valid)), error => error.code === 'ROW_LIMIT');
  assert.throws(() => preview([]), error => error.code === 'EMPTY_ROWS');
  const secret = 'private-serial-777';
  const result = preview(Array.from({ length: 60 }, () => ({ ...valid(), '检验数': secret })));
  assert.equal(result.stats.errorCount, 60);
  assert.equal(result.errors.length, 50);
  assert.equal(result.stats.truncatedErrors, true);
  assert.equal(JSON.stringify(result.errors).includes(secret), false);
  assert.deepEqual(Object.keys(result.errors[0]).sort(), ['code', 'field', 'message', 'rowNumber']);
});

test('BI adapter generates stable facts and mapping fingerprints independently from row mutation', () => {
  const first = preview([valid()]);
  assert.equal(first.mappingFingerprint, preview([valid()]).mappingFingerprint);
  assert.equal(first.facts[0].id, preview([valid()]).facts[0].id);
  const changed = preview([valid()], { source: { batchId: 'another-batch', rowOffset: 5, password: 'ignored' } });
  assert.notEqual(first.facts[0].id, changed.facts[0].id);
  assert.equal(changed.facts[0].source.rowNumber, 5);
  assert.equal(JSON.stringify(changed).includes('password'), false);
  assert.equal(first.mappingFingerprint, changed.mappingFingerprint);
  assert.notEqual(first.mappingFingerprint, preview([{ ...valid(), '日期': '2026-10-26' }], { mapping: { ...mapping, dateColumn: '日期' } }).mappingFingerprint);
});

test('BI adapter refuses accessor-backed rows to avoid executing arbitrary cell getters', () => {
  let called = false;
  const row = valid();
  Object.defineProperty(row, '型号', { enumerable: true, get() { called = true; return '0012'; } });
  const result = preview([row]);
  assert.equal(result.stats.errorCount, 1);
  assert.equal(called, false);
});
