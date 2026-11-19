'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm');
const L = require('../desktop/app/bi-field-labels');
test('BI grouping names agree across filters, rows and CSV without changing stable keys', () => {
  const specs = [
      ['process', '工序'],
      ['issue', '异常类型'],
    ],
    product = { grouping: { kind: 'productType' } };
  assert.equal(L.process(product), '产品类型');
  assert.equal(L.columns(specs, product)[0][1], '产品类型');
  assert.equal(
    L.filters(specs, { primary: { source: 'records' }, biSource: product })[0][1],
    '工序',
  );
  assert.equal(L.filters(specs, { primary: { source: 'bi' }, biSource: product })[0][0], 'process');
  assert.equal(specs[0][1], '工序');
  assert.equal(L.process({ grouping: { kind: 'process' } }), '工序');
});
test('actual homepage dropdown says product type and preserves selected MMC and all four original options', () => {
  const source = fs.readFileSync(path.join(__dirname, '../desktop/app/home-studio.js'), 'utf8');
  const start = source.indexOf('      const filterSpecs ='),
    end = source.indexOf('      const actions =', start);
  assert.ok(start >= 0 && end > start);
  const rendered = [],
    state = { filters: { process: 'MMC' } };
  vm.runInNewContext(source.slice(start, end), {
    window: { BIFieldLabels: L },
    body: { append: (n) => rendered.push(n) },
    report: {
      primary: { source: 'bi' },
      biSource: {
        grouping: { kind: 'productType' },
        options: { process: ['LCD', 'MMC', 'MMC24', 'MPO'] },
      },
    },
    active: () => state,
    transient: () => ({ page: 1 }),
    dirty() {},
    refresh() {},
    selectControl: (label, values, value, change) => ({ label, values, value, change }),
  });
  assert.equal(rendered[0].label, '产品类型');
  assert.equal(rendered[0].value, 'MMC');
  assert.equal(Array.from(rendered[0].values, (x) => x[1]).join(','), '全部,LCD,MMC,MMC24,MPO');
  rendered[0].change('MPO');
  assert.equal(state.filters.process, 'MPO');
});
