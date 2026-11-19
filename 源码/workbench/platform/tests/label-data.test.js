'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm');
const data = require('../domain/label-data'),
  layout = require('../domain/label-layout'),
  fit = require('../domain/label-fit');
const render = require('../desktop/label-render'),
  templates = require('../domain/label-template');
const { exportWorkbook, labelsFromWorkbook } = require('../desktop/label-workbook');
const createUI = require('../desktop/app/label-data-ui')(data);
const rows = () => [
  { code: '0012', name: '纵切夹具', spec: 'φ0.5', creator: '甲' },
  { code: '12', name: '', spec: 'B-2', creator: '' },
];

test('Excel paste maps named columns, preserves zeros, empty cells, quotes and literal formulas', () => {
  const value = data.paste(
    [],
    '制作人\t编号\t规格\t名称\r\n甲\t0012\tφ0.5\t"夹具""A"\r\n\t12\t\t=1+1\r\n',
    { replace: true, recognizeHeader: true },
  );
  assert.deepEqual(value, [
    { code: '0012', name: '夹具"A', spec: 'φ0.5', creator: '甲' },
    { code: '12', name: '=1+1', spec: '', creator: '' },
  ]);
  assert.equal(data.paste([], 'A-001\t\t\t', { replace: true })[0].name, '');
});
test('paste at a cell is atomic, bounds checked and does not mutate its original batch', () => {
  const original = rows(),
    before = structuredClone(original);
  const next = data.paste(original, '新名称\t新规格\n第二名称\t第二规格', { column: 1 });
  assert.equal(next[0].code, '0012');
  assert.equal(next[1].spec, '第二规格');
  assert.deepEqual(original, before);
  for (const [text, options] of [
    ['A\tB', { column: 3 }],
    ['"未结束', {}],
    ['A\tB\tC\tD\tE', {}],
    ['A\t"换\n行"', {}],
  ])
    assert.throws(() => data.paste(original, text, options));
  assert.deepEqual(original, before);
  assert.throws(() => data.paste([], Array(2001).fill('A').join('\n')));
  assert.equal(data.paste([], Array(2000).fill('A').join('\n')).length, 2000);
});
test('selected-row replace and fill are literal, bounded and leave unrelated rows unchanged', () => {
  const original = rows();
  const next = data.edit(original, {
    field: 'name',
    find: '夹具',
    replacement: '$&',
    selected: [0],
  });
  assert.equal(next.rows[0].name, '纵切$&');
  assert.equal(next.rows[1].name, '');
  assert.equal(next.changed, 1);
  assert.equal(
    data.edit(original, { field: 'spec', replacement: '', selected: [0], fill: true }).rows[0].spec,
    '',
  );
  assert.throws(() =>
    data.edit(original, { field: 'code', replacement: 'x'.repeat(129), fill: true }),
  );
  assert.throws(() => data.edit(original, { field: 'name', find: '', replacement: 'x' }));
  assert.equal(original[0].name, '纵切夹具');
});
test('mixed names/specs stay attached to each code through natural sorting, SVG and XLSX roundtrip', () => {
  const c = { ...layout.preset('fixture'), signatures: false };
  const input = [...rows(), { code: 'A-002', name: '=literal', spec: 'X&Y', creator: '乙' }];
  const plan = layout.plan(c, input),
    before = structuredClone(input);
  for (const p of plan.positions) {
    const original = input.find((r) => r.code === p.record.code);
    assert.equal(p.record.name, original.name);
    assert.equal(p.record.spec, original.spec);
    assert.ok(p.text.some((t) => t.value === original.spec));
    if (!original.name) assert.ok(!p.text.some((t) => t.binding === 'name'));
  }
  assert.ok(render.pageSvg(plan, 0).includes('X&amp;Y'));
  const imported = labelsFromWorkbook(exportWorkbook(plan)).sheets.find(
    (s) => s.name === '编号清单',
  );
  assert.deepEqual(
    imported.records.map(({ code, name, spec, creator }) => ({ code, name, spec, creator })),
    plan.positions.map((p) => p.record),
  );
  assert.deepEqual(input, before);
});
test('spec visibility is independent of names and custom templates keep a dynamic spec binding', () => {
  const c = { ...layout.preset('fixture'), signatures: false };
  const auto = layout.plan(c, rows()),
    template = layout.toTemplate(auto);
  assert.ok(template.elements.some((e) => e.binding === 'spec'));
  const custom = layout.plan({ ...c, composition: 'custom', template }, rows());
  assert.ok(custom.positions[1].text.some((t) => t.value === 'B-2'));
  const hidden = layout.plan({ ...c, showName: false, showSpec: false }, rows());
  assert.ok(hidden.qrSize > auto.qrSize);
  assert.ok(!hidden.positions[0].text.some((t) => t.binding === 'spec' || t.binding === 'name'));
});
test('duplicate and incomplete drafts stay editable but do not become valid export plans', () => {
  const draft = data.rows([{ code: '', name: '未完成', spec: '' }]);
  assert.equal(draft[0].code, '');
  assert.throws(() => layout.plan(layout.preset('fixture'), draft), /不能为空/);
  const duplicates = [rows()[0], { ...rows()[0], name: '第二名称' }];
  assert.throws(() => layout.plan(layout.preset('fixture'), duplicates), /重复/);
  const p = layout.plan({ ...layout.preset('fixture'), allowDuplicates: true }, duplicates);
  assert.deepEqual(
    p.positions.map((x) => x.record.name),
    ['纵切夹具', '第二名称'],
  );
});
test('content reflow adapts to short labels without silently deleting names, specs or audit selections', () => {
  const input = rows(),
    c = layout.preset('fixture');
  const fitted = fit.fit(c, input, { width: 62, height: 20, mode: 'reflow' });
  assert.equal(fitted.config.signatures, true);
  assert.equal(fitted.config.showName, true);
  assert.equal(fitted.config.showSpec, true);
  assert.equal(fitted.plan.layout, 'horizontal');
  assert.ok(fitted.plan.qrSize >= 2);
  for (const p of fitted.plan.positions) {
    assert.ok(p.qr.y >= p.y && p.qr.y + p.qr.size <= p.y + p.height + 0.001);
    assert.equal(p.record.spec, input.find((r) => r.code === p.record.code).spec);
    assert.ok(p.text.every((t) => t.y + t.height <= p.y + p.height + 0.001));
  }
  assert.equal(c.height, 50);
});
test('custom scaling preserves objects; reflow requires confirmation and does not mutate the old template', () => {
  const base = { ...layout.preset('fixture'), signatures: false },
    template = layout.toTemplate(layout.plan(base, rows()));
  const original = { ...base, composition: 'custom', template },
    before = structuredClone(original);
  const scaled = fit.fit(original, rows(), { width: 60, height: 45, mode: 'scale' });
  assert.deepEqual(
    scaled.config.template.elements.map((e) => e.id),
    template.elements.map((e) => e.id),
  );
  assert.throws(() => fit.fit(original, rows(), { width: 62, height: 20, mode: 'reflow' }), /确认/);
  assert.equal(
    fit.fit(original, rows(), { width: 62, height: 20, mode: 'reflow', replaceCustom: true })
      .replacedCustom,
    true,
  );
  assert.deepEqual(original, before);
  assert.throws(() => fit.fit(original, rows(), { width: NaN, height: 20, mode: 'scale' }));
});

function harness() {
  class Node {
    constructor(tag = 'div') {
      this.tagName = tag;
      this.children = [];
      this.value = '';
      this.listeners = {};
      this.classList = { toggle() {} };
    }
    append(...nodes) {
      this.children.push(...nodes);
    }
    replaceChildren(...nodes) {
      this.children = nodes;
    }
    setAttribute(key, value) {
      this[key] = value;
    }
    addEventListener(name, fn) {
      this.listeners[name] = fn;
    }
  }
  const nodes = new Map(),
    $ = (id) => {
      if (!nodes.has(id)) nodes.set(id, new Node());
      return nodes.get(id);
    };
  $('labelInputMode').value = 'codes';
  $('labelDataScope').value = 'selected';
  $('labelDataField').value = 'name';
  let changed = 0,
    legacy = rows();
  const ui = createUI({
    document: { getElementById: $, createElement: (tag) => new Node(tag) },
    getLegacyRows: () => legacy,
    toLegacy: (value) => {
      legacy = value;
    },
    defaults: () => ({ name: '默认', spec: '', creator: '' }),
    onChange: () => changed++,
  });
  return { ui, $, nodes, changed: () => changed };
}
test('grid import keeps independent blank names; cell edits preserve focus nodes and undo restores rows', () => {
  const h = harness();
  h.ui.importRows(rows());
  assert.equal(h.$('labelInputMode').value, 'table');
  assert.equal(h.ui.records()[1].name, '');
  const input = h.$('labelDataBody').children[0].children[3].children[0];
  input.value = '新名称';
  input.oninput();
  assert.equal(h.ui.records()[0].name, '新名称');
  assert.equal(h.$('labelDataBody').children[0].children[3].children[0], input);
  h.$('labelDataUndo').onclick();
  assert.equal(h.ui.records()[0].name, '纵切夹具');
});
test('grid cell paste, selection-only fill and delete are undoable, and clearing removes temporary search content', () => {
  const h = harness();
  h.ui.importRows(rows());
  const input = h.$('labelDataBody').children[0].children[3].children[0];
  let prevented = false;
  input.onpaste({
    clipboardData: { getData: () => '新名称\t新规格' },
    preventDefault: () => {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(h.ui.records()[0].spec, '新规格');
  const check = h.$('labelDataBody').children[0].children[0].children[0];
  check.checked = true;
  check.onchange();
  h.$('labelDataReplacement').value = '统一名称';
  h.$('labelDataFill').onclick();
  assert.equal(h.ui.records()[0].name, '统一名称');
  assert.equal(h.ui.records()[1].name, '');
  h.$('labelDataDelete').onclick();
  assert.equal(h.ui.records().length, 1);
  h.$('labelDataUndo').onclick();
  assert.equal(h.ui.records().length, 2);
  h.$('labelDataFind').value = '临时内容';
  h.ui.clear();
  assert.equal(h.$('labelDataFind').value, '');
  assert.equal(h.ui.snapshot().records.length, 0);
});
test('large batches render only 50 editable rows and preserve off-page data through mode changes and restore', () => {
  const h = harness(),
    input = Array.from({ length: 2000 }, (_, i) => ({
      code: 'S-' + i,
      name: '',
      spec: 'X',
      creator: '',
    }));
  h.ui.importRows(input);
  assert.equal(h.$('labelDataBody').children.length, 50);
  h.$('labelDataNext').onclick();
  assert.equal(h.$('labelDataBody').children[0].children[1].textContent, '51');
  const saved = h.ui.snapshot(),
    other = harness();
  other.ui.restore(saved);
  assert.equal(other.ui.records().length, 2000);
  other.$('labelInputMode').value = 'codes';
  other.$('labelInputMode').onchange();
  other.$('labelInputMode').value = 'table';
  other.$('labelInputMode').onchange();
  assert.equal(other.ui.records()[1999].spec, 'X');
});
test('fit UI requires a fresh preview and guards confirmed custom reflow without changing records', () => {
  const nodes = new Map(),
    $ = (id) => {
      if (!nodes.has(id))
        nodes.set(id, { value: '', checked: false, addEventListener() {}, replaceChildren() {} });
      return nodes.get(id);
    };
  const input = rows(),
    c = { ...layout.preset('fixture'), signatures: false };
  const custom = {
    ...c,
    composition: 'custom',
    template: layout.toTemplate(layout.plan(c, input)),
  };
  const saved = structuredClone(input),
    applied = [];
  const context = {
    window: { LabelFit: fit, LabelRender: render },
    document: { getElementById: $ },
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../desktop/app/label-fit-ui.js'), 'utf8'),
    context,
  );
  const ui = context.window.createLabelFitUI({
    getConfig: () => custom,
    getRecords: () => input,
    apply: (c) => {
      applied.push(c);
      return true;
    },
  });
  ui.restore({ width: 62, height: 20, mode: 'reflow' }, custom);
  $('labelFitTest').onclick();
  assert.equal($('labelFitApply').disabled, true);
  $('labelFitConfirm').checked = true;
  $('labelFitTest').onclick();
  assert.equal($('labelFitApply').disabled, false);
  input[0].name = 'changed';
  $('labelFitApply').onclick();
  assert.equal(applied.length, 0);
  input[0].name = saved[0].name;
  $('labelFitTest').onclick();
  $('labelFitApply').onclick();
  assert.equal(applied.length, 1);
  assert.deepEqual(input, saved);
  assert.equal(ui.snapshot().height, 20);
});
