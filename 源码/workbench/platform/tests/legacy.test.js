'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { adaptLegacyState } = require('../adapters/legacy/state-adapter');

function snapshot() {
  return {
    version: 1,
    templates: [{
      id: 'incoming', name: '来料异常',
      columns: ['found_date', 'sn', 'silk', 'issue', 'process', 'area', 'alternate'].map(id => ({ id, label: id, type: 'text' })),
      analysis: { date: 'found_date', issue: 'issue', code: 'silk', group: 'process' }
    }],
    records: [{
      id: 'record-1', templateId: 'incoming',
      createdAt: '2026-10-25T20:00:00Z', createdLocalDate: '2026-10-26',
      values: { found_date: '2026/10/22', sn: '0012a', silk: '0012', issue: '底座断裂', process: '装管', area: 'BK5F', alternate: 'A2' },
      workflow: { owner: 'private-owner', status: '待处理' }
    }],
    deletedRecords: [{ id: 'deleted-do-not-import' }],
    pendingUI: { values: { sn: 'draft-do-not-import' } }
  };
}

test('read-only legacy conversion preserves text and discovery date provenance', () => {
  const state = snapshot();
  const before = structuredClone(state);
  const result = adaptLegacyState(state);
  assert.deepEqual(state, before);
  assert.equal(result.stats.accepted, 1);
  assert.equal(result.stats.rejected, 0);
  assert.equal(result.observations[0].observedOn, '2026-10-22');
  assert.equal(result.observations[0].serialNumber, '0012a');
  assert.equal(result.observations[0].relatedCode, '0012');
  assert.deepEqual(result.observations[0].dimensions, { group: '装管' });
  assert.equal(result.observations[0].source.dateBasis, 'mapped-discovery-date');
  assert.equal('businessDate' in result.observations[0], false);
  assert.equal('workflow' in result.observations[0], false);
});

test('explicit mappings support custom SN and business dimensions without label guessing', () => {
  const state = snapshot();
  const result = adaptLegacyState(state, { mappings: { incoming: {
    serialNumber: 'alternate', dimensions: { process: 'process', area: 'area', group: '' }
  } } });
  assert.equal(result.observations[0].serialNumber, 'A2');
  assert.deepEqual(result.observations[0].dimensions, { process: '装管', area: 'BK5F' });
});

test('no mapped date uses createdLocalDate; never silently infers timezone from UTC', () => {
  const state = snapshot();
  state.templates[0].analysis.date = '';
  let result = adaptLegacyState(state);
  assert.equal(result.observations[0].observedOn, '2026-10-26');
  assert.equal(result.observations[0].source.dateBasis, 'created-local-date');
  delete state.records[0].createdLocalDate;
  result = adaptLegacyState(state);
  assert.equal(result.stats.rejected, 1);
  assert.equal(result.errors[0].field, 'observedOn');
});

test('mapped invalid or empty dates are rejected rather than replaced by created date', () => {
  for (const date of ['2026-02-29', '10/22/2026', '', '2026/13/01', 46317]) {
    const state = snapshot();
    state.records[0].values.found_date = date;
    const result = adaptLegacyState(state);
    assert.equal(result.stats.rejected, 1, String(date));
    assert.equal(result.observations.length, 0);
  }
  const leap = snapshot();
  leap.records[0].values.found_date = '2024/2/29';
  assert.equal(adaptLegacyState(leap).observations[0].observedOn, '2024-02-29');
});

test('numeric identifiers are rejected, preserving leading zero integrity', () => {
  for (const field of ['sn', 'silk']) {
    const state = snapshot();
    state.records[0].values[field] = 12;
    const result = adaptLegacyState(state);
    assert.equal(result.stats.rejected, 1);
    assert.equal(result.errors[0].field, field === 'sn' ? 'serialNumber' : 'relatedCode');
    assert.equal(JSON.stringify(result.errors).includes('private-owner'), false);
  }
});

test('all records with a duplicate ID are rejected; unknown templates are explicit errors', () => {
  const state = snapshot();
  state.records.push(structuredClone(state.records[0]));
  let result = adaptLegacyState(state);
  assert.equal(result.stats.rejected, 2);
  assert.equal(result.observations.length, 0);
  state.records[1].id = 'different';
  state.records[1].templateId = 'missing';
  result = adaptLegacyState(state);
  assert.equal(result.stats.accepted, 1);
  assert.equal(result.errors[0].code, 'LEGACY_TEMPLATE_MISSING');
  state.records[1].id = ` ${state.records[0].id} `;
  assert.equal(adaptLegacyState(state).stats.rejected, 2);
});

test('custom fields are not guessed from labels; missing SN remains an observation', () => {
  const state = snapshot();
  state.templates[0].columns = state.templates[0].columns.filter(column => column.id !== 'sn');
  state.templates[0].columns.find(column => column.id === 'alternate').label = 'SN';
  const result = adaptLegacyState(state);
  assert.equal(result.stats.accepted, 1);
  assert.equal(result.observations[0].serialNumber, '');
});

test('duplicate templates and unsafe or missing mappings fail before records are converted', () => {
  const state = snapshot();
  state.templates.push(structuredClone(state.templates[0]));
  assert.throws(() => adaptLegacyState(state), { code: 'LEGACY_TEMPLATE_DUPLICATE' });
  assert.throws(() => adaptLegacyState(snapshot(), { mappings: { incoming: { code: 'missing' } } }), { code: 'LEGACY_MAPPING_INVALID' });
  assert.throws(() => adaptLegacyState(snapshot(), { mappings: { incoming: { dimensions: JSON.parse('{"__proto__":"area"}') } } }), { code: 'LEGACY_MAPPING_INVALID' });
  assert.equal({}.polluted, undefined);
});

test('bad record errors are bounded and omit raw values while counting every rejection', () => {
  const state = snapshot();
  state.records = Array.from({ length: 55 }, (_, index) => ({
    ...structuredClone(state.records[0]), id: `r${index}`,
    values: { ...state.records[0].values, sn: 999999123 }
  }));
  const result = adaptLegacyState(state);
  assert.equal(result.errors.length, 50);
  assert.equal(result.stats.errorCount, 55);
  assert.equal(result.stats.errorsTruncated, true);
  assert.equal(JSON.stringify(result.errors).includes('999999123'), false);
});
