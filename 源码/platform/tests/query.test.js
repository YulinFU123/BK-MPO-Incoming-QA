'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlatform } = require('../index');
const fixture = require('../fixtures/synthetic.json');

test('catalog and all-column sorting/pagination preserve textual identifiers and actual source rows', async () => {
  const platform = await createPlatform(structuredClone(fixture));
  const preview = await platform.imports.previewRows(fixture); await platform.imports.commitPreview(preview.previewId);
  const catalog = await platform.queries.catalog();
  assert.equal(catalog.datasets[0].id, fixture.dataset.id);
  assert.deepEqual(catalog.dimensionOptions[fixture.dataset.id].process, ['装管']);
  const input = { source: 'quality', datasetId: fixture.dataset.id, start: '2026-10-25', end: '2026-10-26', pageSize: 1 };
  const initial = await platform.queries.listData(input);
  assert.equal(initial.total, 2);
  for (const column of initial.columns) for (const direction of ['asc', 'desc']) {
    const page = await platform.queries.listData({ ...input, sort: { field: column.key, direction } });
    assert.equal(page.rows.length, 1);
    assert.equal(page.total, 2);
  }
  const amounts = await platform.queries.listData({ ...input, page: 2, sort: { field: 'defectiveUnits', direction: 'asc' } });
  assert.equal(amounts.rows[0].defectiveUnits, 5);
  const empty = await platform.queries.listData({ ...input, search: '不存在' });
  assert.equal(empty.total, 0);
  const observations = await platform.queries.listData({ ...input, source: 'observations', start: '2026-10-26', search: '0012', sort: { field: 'relatedCode', direction: 'asc' } });
  assert.equal(observations.total, 1);
  assert.equal(observations.rows[0].relatedCode, '0012');
  observations.rows[0].relatedCode = 'mutated';
  assert.equal((await platform.queries.listData({ ...input, source: 'observations', sort: { field: 'relatedCode', direction: 'asc' } })).rows[0].relatedCode, '0012');
  await assert.rejects(platform.queries.listData({ ...input, sort: { field: 'not-a-column' } }), error => error.code === 'INVALID_SORT');
  await assert.rejects(platform.queries.listData({ ...input, filters: { serialNumber: 'x' } }), error => error.code === 'UNSUPPORTED_FILTER');
});
