'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto'),
  vm = require('node:vm');
const { integrateLegacyAppearance } = require('../desktop/legacy-handoff');
test('theme bridge preserves original appearance body, enhanced preferences and cancel-preview state', () => {
  const originalPath = path.resolve(__dirname, '../../appearance.js');
  let source;
  if (fs.existsSync(originalPath)) source = fs.readFileSync(originalPath, 'utf8');
  else {
    const folder = path.resolve(__dirname, '../../legacy');
    const packaged = fs.readFileSync(path.join(folder, 'appearance.js'), 'utf8');
    const bridge = integrateLegacyAppearance('window.Appearance=Object.freeze({open});');
    assert.equal(packaged.split(bridge.replacement).length, 2);
    source = packaged.replace(bridge.replacement, bridge.marker);
    const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'fusion-manifest.json'), 'utf8'));
    const entry = manifest.files.find((row) => row.name === 'appearance.js');
    const hash = (text) => crypto.createHash('sha256').update(text).digest('hex');
    assert.equal(
      hash(source),
      entry.sourceSha256,
      'packaged body must reconstruct the exact original',
    );
    assert.equal(hash(packaged), entry.packagedSha256);
  }
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
