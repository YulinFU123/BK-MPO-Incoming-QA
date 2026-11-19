'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm');
const layout = require('../domain/label-layout'),
  data = require('../domain/label-data');
const memory = require('../domain/label-memory'),
  render = require('../desktop/label-render');
const createDataUI = require('../desktop/app/label-data-ui')(data);

test('the actual studio imports independent rows, exports those same rows and restores/clears the batch safely', async () => {
  const html = fs.readFileSync(path.join(__dirname, '../desktop/app/index.html'), 'utf8');
  const declared = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  class Node {
    constructor(tag = 'div') {
      this.tagName = tag.toUpperCase();
      this.children = [];
      this.value = '';
      this.checked = false;
      this.dataset = {};
      this.classList = { toggle() {}, add() {} };
    }
    append(...nodes) {
      this.children.push(...nodes);
    }
    replaceChildren(...nodes) {
      this.children = nodes;
    }
    addEventListener(name, fn) {
      (this.listeners ||= {})[name] = fn;
    }
    setAttribute(key, value) {
      this[key] = value;
    }
    closest() {
      return this;
    }
    set innerHTML(text) {
      this.markup = text;
      this.firstElementChild = new Node('svg');
    }
  }
  const nodes = new Map(),
    $ = (id) => {
      assert.ok(declared.has(id), 'page is missing the actual control: ' + id);
      if (!nodes.has(id)) nodes.set(id, new Node());
      return nodes.get(id);
    };
  const controls = {
    width: 'labelWidth',
    height: 'labelHeight',
    qrSize: 'labelQrSize',
    fontSize: 'labelFontSize',
    gapX: 'labelGapX',
    gapY: 'labelGapY',
    padding: 'labelPadding',
    margin: 'labelMargin',
    columns: 'labelColumns',
    qrScale: 'labelQrScale',
    paperWidth: 'labelPaperWidth',
    paperHeight: 'labelPaperHeight',
    marginLeft: 'labelMarginLeft',
    marginRight: 'labelMarginRight',
    marginTop: 'labelMarginTop',
    marginBottom: 'labelMarginBottom',
    orientation: 'labelOrientation',
    qrMode: 'labelQrMode',
    layout: 'labelLayout',
    paperSize: 'labelPaperSize',
    pageAlignX: 'labelPageAlignX',
    pageAlignY: 'labelPageAlignY',
    lastRowAlign: 'labelLastRowAlign',
  };
  for (const [key, id] of Object.entries(controls))
    $(id).value = String(layout.preset('fixture')[key]);
  $('labelPrefix').value = 'FIX-';
  $('labelStart').value = '1';
  $('labelEnd').value = '19';
  $('labelDigits').value = '3';
  $('labelInputMode').value = 'codes';
  $('labelDataScope').value = 'selected';
  $('labelDataField').value = 'name';
  $('labelName').value = '统一名称不应覆盖导入行';
  const exported = new Node('button');
  exported.dataset.labelExport = 'xlsx';
  const doc = {
    getElementById: $,
    createElement: (tag) => new Node(tag),
    createElementNS: (_, tag) => new Node(tag),
    querySelectorAll: (selector) => (selector === '[data-label-export]' ? [exported] : []),
  };
  let memoryOptions, designerOptions;
  const input = [
      { code: '0012', name: '独立名称甲', spec: 'A', creator: '甲' },
      { code: '12', name: '', spec: 'B-2', creator: '' },
    ],
    calls = [];
  const api = async (method, value) => {
    calls.push({ method, value: structuredClone(value) });
    if (method === 'pickLabelWorkbook')
      return { sheets: [{ name: '编号清单', records: input, duplicates: [], errorCells: 0 }] };
    if (method === 'exportLabels') return { cancelled: false, fileName: 'synthetic.xlsx' };
    assert.fail('unexpected business operation: ' + method);
  };
  const context = {
    structuredClone,
    window: {
      LabelLayout: layout,
      LabelData: data,
      LabelFit: require('../domain/label-fit'),
      LabelRender: render,
      LabelSheet: require('../domain/label-sheet'),
      createLabelDataUI: (options) => createDataUI({ ...options, document: doc }),
      createLabelMemoryUI: (options) => {
        memoryOptions = options;
        return { changed() {}, activate() {}, clear() {}, flush: async () => true };
      },
      createLabelDesigner: (options) => {
        designerOptions = options;
        return {
          refresh() {},
          cancelPending() {},
          flushPending() {},
          clear() {},
          view() {},
          beforeExternalEdit() {},
          applyLayout: (config) => {
            options.setConfig(config);
            options.onChange();
            return true;
          },
        };
      },
    },
    document: doc,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    setTimeout: () => 1,
    clearTimeout() {},
    Option: function (text, value) {
      const n = new Node('option');
      n.textContent = text;
      n.value = value;
      return n;
    },
  };
  for (const file of ['label-fit-ui.js', 'label-studio.js'])
    vm.runInNewContext(
      fs.readFileSync(path.join(__dirname, '../desktop/app', file), 'utf8'),
      context,
    );
  const studio = context.window.createLabelStudio({ api, unlocked: () => true });
  await $('labelPickWorkbook').onclick();
  $('labelImportUse').onclick();
  assert.equal(exported.disabled, false);
  await exported.onclick();
  assert.deepEqual(
    calls
      .find((x) => x.method === 'exportLabels')
      .value.records.map((r) => [r.code, r.name, r.spec, r.creator]),
    input.map((r) => [r.code, r.name, r.spec, r.creator]),
  );
  const captured = memory.validate({
    ...memory.empty(),
    rememberCodes: true,
    current: memoryOptions.capture(),
  }).current;
  assert.equal(captured.dataMode, 'table');
  assert.equal(captured.records[1].name, '');
  $('labelFitTest').onclick();
  assert.equal($('labelFitApply').disabled, false);
  studio.clear();
  assert.equal($('labelFitApply').disabled, true);
  assert.equal($('labelDataBody').children.length, 1);
  memoryOptions.apply(captured);
  $('labelUpdate').onclick();
  assert.equal(designerOptions.getSource().plan.positions[1].record.spec, 'B-2');
  assert.equal(designerOptions.getSource().plan.positions[1].record.name, '');
});
