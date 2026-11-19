'use strict';
// Event wiring and state model only. Does not claim actual Windows UI validation.
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  vm = require('node:vm'),
  path = require('node:path');
test('actual designer adds a barcode, edits its independent height and width, duplicates and undoes', () => {
  const L = require('../domain/label-layout');
  let c = L.preset('fixture');
  const records = [{ code: 'FIX-0012', name: '测试标签', creator: '' }];
  const html = fs.readFileSync(path.join(__dirname, '../desktop/app/index.html'), 'utf8'),
    declared = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  class Node {
    constructor() {
      this.children = [];
      this.dataset = {};
      this.style = {};
      this.value = '';
      this.classList = { add() {}, remove() {}, toggle() {} };
      this.clientWidth = 800;
      this.clientHeight = 600;
      this.checked = false;
    }
    setAttribute(k, v) {
      this[k] = v;
    }
    append(...nodes) {
      this.children.push(...nodes);
    }
    replaceChildren(...nodes) {
      this.children = nodes;
    }
    querySelector() {
      return null;
    }
    querySelectorAll() {
      return [];
    }
    addEventListener() {}
    focus() {}
    remove() {}
    set innerHTML(v) {
      this.markup = v;
    }
  }
  const nodes = new Map(),
    $ = (id) => {
      assert.ok(declared.has(id), 'missing real control ' + id);
      if (!nodes.has(id)) nodes.set(id, new Node());
      return nodes.get(id);
    };
  const document = {
    getElementById: $,
    createElement: () => new Node(),
    createElementNS: () => new Node(),
    querySelectorAll: () => [],
    addEventListener() {},
    body: new Node(),
  };
  const window = {
    LabelLayout: L,
    LabelTemplate: require('../domain/label-template'),
    LabelGeometry: require('../domain/label-geometry'),
    LabelEditing: require('../domain/label-editing'),
    LabelRender: require('../desktop/label-render'),
  };
  const sandbox = {
    window,
    document,
    crypto: require('node:crypto'),
    structuredClone,
    setTimeout,
    clearTimeout,
    Option: class {
      constructor(text, value) {
        this.text = text;
        this.value = value;
      }
    },
    ResizeObserver: class {
      observe() {}
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '../desktop/app/label-designer.js'), 'utf8'),
    sandbox,
  );
  let designer;
  designer = window.createLabelDesigner({
    getConfig: () => c,
    setConfig: (value) => {
      c = value;
    },
    getSource: () => ({ plan: L.plan(c, records) }),
    onChange: () => designer.refresh(),
  });
  designer.refresh();
  $('designAddBarcode').onclick();
  assert.equal(c.template.version, 2);
  assert.equal(c.template.elements.filter((e) => e.type === 'barcode').length, 1);
  assert.equal($('designHeight').disabled, false);
  $('designHeight').value = '5';
  $('designHeight').onchange();
  $('designWidth').value = '40';
  $('designWidth').onchange();
  assert.equal(c.template.elements.find((e) => e.type === 'barcode').height, 5);
  assert.equal(c.template.elements.find((e) => e.type === 'barcode').width, 40);
  $('designDuplicate').onclick();
  assert.equal(c.template.elements.filter((e) => e.type === 'barcode').length, 2);
  $('designUndo').onclick();
  assert.equal(c.template.elements.filter((e) => e.type === 'barcode').length, 1);
  designer.clear();
});
