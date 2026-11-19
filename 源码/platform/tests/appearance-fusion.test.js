'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm');
const { integrateLegacyAppearance } = require('../desktop/legacy-handoff');
test('theme bridge preserves original appearance body, enhanced preferences and cancel-preview state', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../appearance.js'), 'utf8');
  const integrated = integrateLegacyAppearance(source);
  assert.equal(integrated.source.replace(integrated.replacement, integrated.marker), source);
  const state = {
    theme: 'professional',
    density: 'compact',
    font: 'large',
    headers: false,
    stripes: true,
  };
  const context = vm.createContext({
    window: {},
    current: structuredClone(state),
    themes: ['professional', 'glass', 'graphite', 'contrast'].map((name) => [name]),
    dialog: { open: false },
    clean: (value) => value,
    apply: (value) => {
      context.applied = structuredClone(value);
    },
    open: () => {},
    KEY: 'test-key',
    localStorage: {
      setItem: (_key, value) => {
        context.saved = JSON.parse(value);
      },
    },
  });
  vm.runInContext(integrated.replacement, context);
  context.window.Appearance.syncTheme('graphite');
  assert.deepEqual(JSON.parse(JSON.stringify(context.current)), { ...state, theme: 'graphite' });
  assert.equal(context.saved.theme, 'graphite');
  context.dialog.open = true;
  context.window.Appearance.syncTheme('contrast');
  assert.equal(
    context.current.theme,
    'graphite',
    'parent refresh cannot commit an unconfirmed preview',
  );
  context.dialog.open = false;
  context.window.Appearance.syncTheme('invalid');
  assert.equal(context.current.theme, 'graphite');
});
