'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict');
const C = require('../domain/analysis-calendar'),
  M = require('../domain/module-state');
const address = { scope: 'module', module: 'analysis-calendar' };
test('shift rule contract requires an explicit clock and rejects overlap, unknown fields and duplicate labels', () => {
  assert.equal(C.ruleDefaults().mode, 'column');
  const valid = { ...C.ruleDefaults(), mode: 'check-time', timeColumn: 'h_0000000000000001' };
  assert.equal(C.rule(valid).nightEnd, '06:40');
  for (const patch of [
    { timeColumn: '' },
    { dayEnd: '20:00' },
    { nightEnd: '08:00' },
    { dayStart: '25:00' },
    { dayLabel: '晚班' },
    { dateBasis: 'guess' },
    { unknown: true },
  ])
    assert.throws(() => C.rule({ ...valid, ...patch }));
  assert.equal(C.rule({ ...valid, dayEnd: '' }, true).dayEnd, '');
  assert.throws(() => C.rule({ ...valid, dayEnd: '' }));
});
test('new calendar configuration has its own module and source scope; the old source schema stays unchanged', () => {
  const v = C.defaults();
  v.sources.bi = { ...C.ruleDefaults(), mode: 'check-time', timeColumn: 'h_0000000000000001' };
  const copy = M.validate(address, v);
  copy.sources.bi.dayStart = '09:00';
  assert.equal(v.sources.bi.dayStart, '08:00');
  assert.deepEqual(M.defaultData(address), C.defaults());
  assert.deepEqual(
    M.validate(
      { scope: 'draft', module: 'analysis-calendar' },
      { sourceId: 'bi', rule: { ...v.sources.bi, dayEnd: '' } },
    ).rule.dayEnd,
    '',
  );
  assert.throws(() => C.validate({ version: 1, sources: [], extra: 1 }));
});
