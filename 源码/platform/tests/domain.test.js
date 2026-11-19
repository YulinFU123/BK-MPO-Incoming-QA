'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { strictISODate, shiftISODate, dateRange, exactText, nonNegativeInteger } = require('../domain/validation');
const { canonicalJSON, sha256, scopeKey } = require('../domain/identity');
const { summarizeObservations, summarizeQualityFacts } = require('../domain/metrics');

const query = { start: '2024-02-28', end: '2024-03-01', datasetId: 'quality' };
const fact = (overrides = {}) => ({ id: '1', datasetId: 'quality', businessDate: '2024-02-28', grainFields: ['process'], dimensions: { process: '装管' }, unit: 'piece', measures: { inspectedUnits: 100, defectiveUnits: 2, productionUnits: null, defectEvents: null }, ...overrides });

test('strict business dates reject rollover, ambiguity and empty strings; ranges cross leap day', () => {
  for (const value of ['', '02/28/2024', '2023-02-29', '2024-02-30', '0000-01-01', '2024-13-01']) assert.throws(() => strictISODate(value));
  assert.equal(strictISODate('2024-02-29'), '2024-02-29');
  assert.deepEqual(dateRange('2024-02-28', '2024-03-01').dates, ['2024-02-28', '2024-02-29', '2024-03-01']);
  assert.equal(shiftISODate('2024-03-01', -1), '2024-02-29');
  assert.throws(() => dateRange('2024-03-01', '2024-02-28'));
  assert.throws(() => dateRange('2024-02-28', '2024-03-01', { maxDays: 2 }));
  assert.throws(() => shiftISODate('0001-01-01', -1));
});

test('identifiers preserve case and leading zeros; quantities preserve absence and reject unsafe values', () => {
  assert.equal(exactText(' 0012 '), '0012');
  assert.equal(exactText('Ab12'), 'Ab12');
  assert.throws(() => exactText(12));
  assert.throws(() => exactText('', { required: true }));
  assert.equal(nonNegativeInteger('', { nullable: true }), null);
  assert.equal(nonNegativeInteger('00'), 0);
  for (const value of [-1, 1.2, '1e3', '2.0', Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, true]) assert.throws(() => nonNegativeInteger(value));
});

test('canonical identity ignores object-key order but retains exact dimension text', () => {
  assert.equal(canonicalJSON({ b: 1, a: 2 }), canonicalJSON({ a: 2, b: 1 }));
  assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.notEqual(scopeKey(fact()), scopeKey(fact({ dimensions: { process: '装管2' } })));
  assert.throws(() => canonicalJSON({ value: undefined }));
  assert.throws(() => canonicalJSON({ value: NaN }));
  const circular = {}; circular.self = circular;
  assert.throws(() => canonicalJSON(circular));
});

test('anomaly records do not become defective units; one serial can have multiple observations', () => {
  const observations = [
    { id: '1', templateId: 'incoming', observedOn: '2024-02-28', serialNumber: '0012', issue: '断裂', relatedCode: '01', dimensions: { process: '装管' } },
    { id: '2', templateId: 'incoming', observedOn: '2024-02-29', serialNumber: '0012', issue: '熔化', relatedCode: '1', dimensions: { process: '装管' } },
    { id: '3', templateId: 'incoming', observedOn: '2024-02-29', serialNumber: '', issue: '断裂', relatedCode: 'a', dimensions: { process: '研磨' } }
  ];
  const before = structuredClone(observations);
  const result = summarizeObservations(observations, query);
  assert.equal(result.recordCount, 3);
  assert.equal(result.uniqueSerialCount, 1);
  assert.equal(result.missingSerialCount, 1);
  assert.equal(result.trend[2].recordCount, 0);
  assert.equal(summarizeObservations(observations, { ...query, filters: { relatedCode: '01' } }).recordCount, 1);
  assert.deepEqual(observations, before);
});

test('defect rate uses weighted totals and empty dates have absent denominator', () => {
  const facts = [fact(), fact({ id: '2', businessDate: '2024-02-29', measures: { inspectedUnits: 10, defectiveUnits: 5 } })];
  const before = structuredClone(facts);
  const result = summarizeQualityFacts(facts, query);
  assert.equal(result.rate.status, 'available');
  assert.equal(result.rate.value, 7 / 110);
  assert.equal(result.totals.inspectedUnits, 110);
  assert.equal(result.totals.productionUnits, null);
  assert.equal(result.trend[2].totals.inspectedUnits, null);
  assert.equal(result.trend[2].rate.status, 'unavailable');
  assert.deepEqual(facts, before);
});

test('genuine zero defects is zero; absent numerator or denominator remains unavailable', () => {
  assert.equal(summarizeQualityFacts([fact({ measures: { inspectedUnits: 100, defectiveUnits: 0 } })], query).rate.value, 0);
  const cases = [
    [{ inspectedUnits: 100, defectiveUnits: null }, 'MISSING_NUMERATOR'],
    [{ inspectedUnits: null, defectiveUnits: 2, productionUnits: 100 }, 'MISSING_DENOMINATOR'],
    [{ inspectedUnits: 0, defectiveUnits: 0 }, 'ZERO_DENOMINATOR'],
    [{ inspectedUnits: 1, defectiveUnits: 2 }, 'NUMERATOR_EXCEEDS_DENOMINATOR']
  ];
  for (const [measures, reason] of cases) {
    const rate = summarizeQualityFacts([fact({ measures })], query).rate;
    assert.equal(rate.status, 'unavailable');
    assert.ok(rate.reasons.includes(reason));
    assert.equal(rate.value, null);
  }
});

test('mixed detail/total grain, duplicate scope, unit mismatch, unsupported filters cannot yield rates', () => {
  const cases = [
    [[fact(), fact({ id: '2' })], 'DUPLICATE_GRAIN'],
    [[fact(), fact({ grainFields: [], dimensions: {} })], 'MIXED_GRAINS'],
    [[fact(), fact({ unit: 'batch' })], 'MIXED_UNITS']
  ];
  for (const [facts, reason] of cases) {
    const result = summarizeQualityFacts(facts, query);
    assert.ok(result.rate.reasons.includes(reason));
    assert.equal(result.rate.value, null);
    assert.equal(result.totals.inspectedUnits, null);
  }
  const result = summarizeQualityFacts([fact()], { ...query, filters: { serialNumber: '0012' } });
  assert.ok(result.rate.reasons.includes('UNSUPPORTED_FILTER'));
  assert.equal(result.rate.value, null);
  assert.equal(summarizeQualityFacts([fact()], { ...query, filters: { process: '装管' } }).rate.status, 'available');
});

test('aggregation overflow and invalid quantities never produce a plausible rate', () => {
  const result = summarizeQualityFacts([fact({ measures: { inspectedUnits: Number.MAX_SAFE_INTEGER, defectiveUnits: 1 } }), fact({ businessDate: '2024-02-29', measures: { inspectedUnits: Number.MAX_SAFE_INTEGER, defectiveUnits: 1 } })], query);
  assert.ok(result.rate.reasons.includes('TOTAL_OVERFLOW'));
  assert.equal(result.rate.value, null);
  assert.equal(result.totals.inspectedUnits, null);
  assert.equal(summarizeQualityFacts([fact({ measures: { inspectedUnits: 100, defectiveUnits: -1 } })], query).rate.status, 'unavailable');
});

test('ten thousand observations keep correct counts across the maximum supported trend window', () => {
  const start = '2015-01-01';
  const end = shiftISODate(start, 3659);
  const dates = dateRange(start, shiftISODate(start, 9)).dates;
  const observations = Array.from({ length: 10000 }, (_, index) => ({
    id: `record-${index}`, templateId: 'incoming', observedOn: dates[index % dates.length],
    serialNumber: `SN${Math.floor(index / 2)}`, issue: '断裂', relatedCode: '0012', dimensions: {}
  }));
  const result = summarizeObservations(observations, { start, end });
  assert.equal(result.recordCount, 10000);
  assert.equal(result.uniqueSerialCount, 5000);
  assert.equal(result.trend.length, 3660);
  assert.equal(result.trend.reduce((sum, day) => sum + day.recordCount, 0), 10000);
  assert.equal(result.trend[0].recordCount, 1000);
  assert.equal(result.trend[10].recordCount, 0);
  assert.equal(result.trend[3659].date, end);
});
