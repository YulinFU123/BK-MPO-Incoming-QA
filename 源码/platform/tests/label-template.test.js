'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict');
const model = require('../domain/label-layout'),
  template = require('../domain/label-template'),
  render = require('../desktop/label-render');
const { exportWorkbook, labelsFromWorkbook } = require('../desktop/label-workbook'),
  { openZip } = require('../adapters/xlsx/zip');
const rows = [
  { code: 'X-001', name: '示例A', creator: '甲' },
  { code: 'X-002', name: '示例B', creator: '' },
];
const simple = () => ({
  version: 1,
  width: 50,
  height: 50,
  elements: [
    { id: 'qr', type: 'qr', x: 12.5, y: 3, width: 25, height: 25 },
    {
      id: 'code',
      type: 'text',
      binding: 'code',
      text: '编号：',
      x: 3,
      y: 30,
      width: 44,
      height: 6,
      fontSize: 9,
      bold: true,
      align: 'center',
      color: '#111111',
    },
    {
      id: 'name',
      type: 'text',
      binding: 'name',
      text: '',
      x: 3,
      y: 36,
      width: 44,
      height: 6,
      fontSize: 9,
      bold: false,
      align: 'left',
      color: '#444444',
    },
    {
      id: 'line',
      type: 'line',
      x: 3,
      y: 43,
      width: 44,
      height: 0,
      strokeWidth: 0.3,
      color: '#444444',
    },
    {
      id: 'footer',
      type: 'text',
      binding: 'fixed',
      text: '复核标签',
      x: 3,
      y: 44,
      width: 44,
      height: 4,
      fontSize: 8,
      bold: false,
      align: 'right',
      color: '#333333',
    },
  ],
});
const config = () => ({
  ...model.preset('fixture'),
  composition: 'custom',
  template: simple(),
  signatures: false,
});
test('automatic labels convert to editable bound objects without leaking a sample identifier', () => {
  const auto = model.plan(model.preset('fixture'), rows),
    draft = model.toTemplate(auto);
  assert.equal(draft.elements.filter((e) => e.type === 'qr').length, 1);
  assert.equal(draft.elements.find((e) => e.id === 'code').binding, 'code');
  assert.ok(!JSON.stringify(draft).includes('X-001'));
  const p = model.plan({ ...auto.config, composition: 'custom', template: draft }, rows);
  assert.ok(p.positions[0].text.some((t) => t.value.includes('X-001')));
  assert.ok(p.positions[1].text.some((t) => t.value.includes('X-002')));
  assert.ok(p.positions[1].text.every((t) => !t.value.includes('X-001')));
});
test('one custom layout repeats exact relative QR and text coordinates across all batch labels', () => {
  const p = model.plan(config(), rows);
  for (const box of p.positions) {
    assert.equal(box.qr.x - box.x, 12.5);
    assert.equal(box.qr.y - box.y, 3);
    assert.equal(box.qr.size, 25);
    assert.ok(box.text.some((t) => t.value === '编号：' + box.record.code));
    assert.ok(box.text.some((t) => t.value === '复核标签'));
  }
});
test('custom width and height resizing preserves square QR and bounds and leaves source untouched', () => {
  const source = simple(),
    before = JSON.stringify(source),
    s = template.resize(source, 60, 40);
  assert.equal(JSON.stringify(source), before);
  assert.equal(s.width, 60);
  assert.equal(s.height, 40);
  for (const e of s.elements) {
    assert.ok(e.x + e.width <= 60.001);
    assert.ok(e.y + e.height <= 40.001);
    if (e.type === 'qr') assert.equal(e.width, e.height);
  }
});
test('frame thickness inset roundness color and dash use the same physical geometry in SVG and Excel', () => {
  const c = {
      ...config(),
      borderWidth: 0.8,
      borderInset: 1.5,
      borderRadius: 3,
      borderStyle: 'dashed',
      borderColor: '#222222',
    },
    p = model.plan(c, rows);
  const b = render.borderBox(p.config, p.positions[0]);
  assert.equal(b.width, 46.2);
  assert.equal(b.radius, 3);
  const svg = render.pageSvg(p, 0);
  assert.match(svg, /stroke-width="0.8"/);
  assert.match(svg, /rx="3"/);
  assert.match(svg, /stroke-dasharray=/);
  const zip = openZip(exportWorkbook(p)),
    drawing = zip.read('xl/drawings/drawing1.xml').toString('utf8');
  assert.match(drawing, /roundRect/);
  assert.match(drawing, /w="28800"/);
  assert.match(drawing, /custDash/);
  assert.match(drawing, /222222/);
  assert.match(drawing, /标签边界/);
});
test('custom Excel has editable drawing text and lines plus exact original identifier list', () => {
  const p = model.plan(config(), rows),
    zip = openZip(exportWorkbook(p));
  const drawing = zip.read('xl/drawings/drawing1.xml').toString('utf8');
  assert.match(drawing, /xdr:txBody/);
  assert.match(drawing, /编号：X-001/);
  assert.match(drawing, /复核标签/);
  assert.match(drawing, /自定义横线/);
  const book = labelsFromWorkbook(exportWorkbook(p));
  assert.deepEqual(
    book.sheets.find((s) => s.name === '编号清单').records.map((r) => r.code),
    ['X-001', 'X-002'],
  );
  const sheet = zip.read('xl/worksheets/sheet1.xml').toString('utf8');
  assert.ok(!sheet.includes('<mergeCell ref='));
});
test('custom text stays escaped and QR overlap is disclosed without silently dropping content', () => {
  const c = config();
  c.template.elements.find((e) => e.id === 'footer').text = '<img onerror="x">';
  c.template.elements.find((e) => e.id === 'code').y = 10;
  const p = model.plan(c, rows),
    svg = render.pageSvg(p, 0);
  assert.ok(p.warnings.some((s) => s.includes('重叠')));
  assert.ok(svg.includes('&lt;img'));
  assert.ok(!svg.includes('<img'));
  assert.ok(!render.labelSvg(p, 1).includes('NaN'));
  assert.match(render.labelSvg(p, 1), /width="50mm"/);
});
test('template guards reject missing QR unknown fields invalid geometry and incomplete text fits', () => {
  for (const mutate of [
    (t) => t.elements.shift(),
    (t) => (t.elements[0].width = 0),
    (t) => (t.elements[0].height = 24),
    (t) => (t.elements[0].x = -1),
    (t) => (t.elements[0].x = NaN),
    (t) => (t.elements[0].path = 'C:/bad'),
    (t) => (t.elements[1].color = 'javascript:bad'),
  ]) {
    const t = simple();
    mutate(t);
    assert.throws(() => template.validate(t));
  }
  const c = config();
  c.template.elements[1].width = 2;
  c.template.elements[1].height = 0.5;
  assert.throws(() => model.plan(c, rows), /文字框/);
});
test('optional name and code visibility also applies to custom bound elements and template memory schema', () => {
  const c = { ...config(), showName: false, showCode: false },
    p = model.plan(c, rows);
  assert.ok(p.positions.every((p) => p.text.every((t) => !['code', 'name'].includes(t.binding))));
  assert.ok(p.positions.every((p) => p.text.some((t) => t.value === '复核标签')));
  const memory = require('../domain/label-memory'),
    current = {
      config: c,
      name: '',
      creator: '',
      range: { prefix: 'X-', start: 1, end: 2, digits: 3 },
    };
  const result = memory.validate({ ...memory.empty(), current });
  assert.equal(result.current.config.template.elements.at(-1).text, '复核标签');
});
test('single designer and full page use distinct clipping IDs when both views exist in one document', () => {
  const p = model.plan(config(), rows),
    page = render.pageSvg(p, 0),
    single = render.labelSvg(p, 0);
  const ids = (html) => [...html.matchAll(/<clipPath id="([^"]+)"/g)].map((m) => m[1]);
  const all = [...ids(page), ...ids(single)];
  assert.equal(new Set(all).size, all.length);
  assert.ok(!render.labelSvg(p, 0).includes('NaN'));
});
