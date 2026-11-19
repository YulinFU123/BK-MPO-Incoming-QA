'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict');
const m = require('../domain/bi-export-filters'),
  state = require('../domain/module-state');
const { filterMemory, ADDRESS } = require('../desktop/bi-filter-state');
test('BI export catalog preserves document identities without inventing failed options', () => {
  assert.equal(m.fields.length, 13);
  assert.equal(m.fields.find((f) => f.id === 'Channel Type').reference.length, 0);
  const v = m.fields.find((f) => f.id === 'FG_SPEC_PRODUCT_TYPE2').reference;
  assert.ok(v.includes('MMC_MPO') && v.includes('MMC-MPO'));
  assert.ok(m.fields.find((f) => f.kind === 'tree').reference.includes('GL\tGL'));
});
test('every filter has independent keep/all/include semantics and exact text', () => {
  const x = m.normalize({ SN: { mode: 'include', values: ['0012', '12', 'ab', 'AB', '0012'] } });
  assert.deepEqual(x.SN.values, ['0012', '12', 'ab', 'AB']);
  assert.equal(x.Shift.mode, 'keep');
  assert.equal(m.normalize({ SN: { mode: 'all', values: [] } }).SN.mode, 'all');
  assert.throws(() => m.normalize({ SN: { mode: 'include', values: [] } }));
  assert.throws(() => m.normalize({ SN: { mode: 'all', values: ['x'] } }));
});
test('invalid fields, fake tree paths and prototype payloads are rejected', () => {
  for (const x of [
    { unknown: { mode: 'all', values: [] } },
    JSON.parse('{"__proto__":{"polluted":true}}'),
    { 'Site、Resource Category': { mode: 'include', values: ['GL_5F'] } },
  ])
    assert.throws(() => m.normalize(x));
  assert.equal({}.polluted, undefined);
});
test('only proven complete dictionaries are accepted; partial or failed stays diagnostic', () => {
  const x = m.dictionary({
    format: 'BK-MPO-PBI-OPTIONS',
    version: 1,
    fields: {
      'Product Type': { status: 'success', complete: true, values: ['Patch', 'Trunk'] },
      'Channel Type': { status: 'partial', complete: false, values: ['144F'] },
      'Mfg Order': { status: 'failed', complete: false },
    },
  });
  assert.deepEqual(Object.keys(x.accepted), ['Product Type']);
  assert.equal(x.diagnostics['Channel Type'], 'partial');
  assert.throws(() => m.dictionary({ format: 'other', version: 1, fields: {} }));
});
test('filter state schema is additive and does not accept a business record', () => {
  assert.equal(
    state.validate(ADDRESS, { filters: { SN: { mode: 'include', values: ['0012'] } } }).filters.SN
      .values[0],
    '0012',
  );
  assert.throws(() => state.validate(ADDRESS, { records: [{ SN: 'x' }] }));
  assert.deepEqual(state.defaultData({ scope: 'module', module: 'analysis' }), {
    datasetId: '',
    start: '',
    end: '',
    filters: {},
    chart: 'rate',
  });
});
test('BI memory bridge binds the module address and cannot target global state', async () => {
  const calls = [];
  const host = {
    readModuleState: async (x) => (calls.push(x), { revision: 1 }),
    saveModuleState: async (x) => (calls.push(x), { revision: 2 }),
    resetModuleState: async (x) => (calls.push(x), { revision: 3 }),
  };
  await filterMemory(host, { action: 'read' });
  await filterMemory(host, { action: 'save', data: {}, expectedRevision: 1 });
  await filterMemory(host, { action: 'reset', expectedRevision: 2 });
  assert.deepEqual(
    calls.map((x) => x.address || x),
    [ADDRESS, ADDRESS, ADDRESS],
  );
  await assert.rejects(() => filterMemory(host, { action: 'save', address: { scope: 'global' } }));
  await assert.rejects(() => filterMemory(null, { action: 'read' }));
});
