'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm');
const { sideEffectScript } = require('../desktop/embedded-scripts');

test('the actual summary bootstrap has an uncloneable result and the side-effect form fixes it', () => {
  const source = fs.readFileSync(path.join(__dirname, '../desktop/insight-summary.js'), 'utf8');
  const context = vm.createContext({ window: {} });
  const raw = vm.runInContext(source, context);
  assert.equal(typeof raw.create, 'function');
  assert.throws(() => structuredClone(raw), { name: 'DataCloneError' });
  const completed = vm.runInContext(sideEffectScript(source), context);
  assert.equal(completed, undefined);
  assert.equal(structuredClone(completed), undefined);
  assert.equal(typeof context.window.InsightSummary.create, 'function');
});
test('side-effect loading preserves page globals and trailing comments but keeps genuine errors', () => {
  const context = vm.createContext({ window: {} });
  const code =
    'const originalGlobal=7; window.helper={read:()=>originalGlobal}; // trailing comment';
  assert.equal(vm.runInContext(sideEffectScript(code), context), undefined);
  assert.equal(vm.runInContext('originalGlobal+window.helper.read()', context), 14);
  assert.throws(
    () => vm.runInContext(sideEffectScript('throw Error("synthetic boot failure")'), context),
    /synthetic boot failure/,
  );
  assert.throws(() => sideEffectScript(null), TypeError);
});
