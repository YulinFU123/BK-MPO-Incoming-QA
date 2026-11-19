'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const layout = require('../domain/label-layout');
const geometry = require('../domain/label-geometry');
const template = require('../domain/label-template');
const render = require('../desktop/label-render');
const { exportWorkbook } = require('../desktop/label-workbook');
const { openZip } = require('../adapters/xlsx/zip');
const records = (n) =>
  Array.from({ length: n }, (_, i) => ({
    code: 'N-' + String(i + 1).padStart(3, '0'),
    name: '',
    creator: '',
  }));
const config = (extra = {}) => ({
  ...layout.preset('fixture'),
  paperSize: 'custom',
  paperWidth: 180,
  paperHeight: 140,
  width: 40,
  height: 30,
  gapX: 5,
  gapY: 5,
  margin: 10,
  showName: false,
  signatures: false,
  ...extra,
});
const design = () =>
  template.validate({
    version: 1,
    width: 80,
    height: 60,
    elements: [
      { id: 'qr', type: 'qr', x: 5, y: 5, width: 20, height: 20 },
      {
        id: 'title',
        type: 'text',
        x: 30,
        y: 6,
        width: 35,
        height: 10,
        binding: 'code',
        text: '',
        fontSize: 12,
        bold: true,
        align: 'center',
        color: '#111111',
      },
      {
        id: 'line-a',
        type: 'line',
        x: 5,
        y: 40,
        width: 10,
        height: 0,
        strokeWidth: 0.2,
        color: '#333333',
      },
      {
        id: 'line-b',
        type: 'line',
        x: 27,
        y: 40,
        width: 15,
        height: 0,
        strokeWidth: 0.2,
        color: '#333333',
      },
      {
        id: 'line-c',
        type: 'line',
        x: 55,
        y: 40,
        width: 20,
        height: 0,
        strokeWidth: 0.2,
        color: '#333333',
      },
    ],
  });
test('large label and adaptive QR values remain valid when round-tripped through visible controls', () => {
  const p = layout.plan(
    config({
      paperWidth: 1600,
      paperHeight: 1200,
      width: 1000,
      height: 900,
      padding: 0,
      showCode: false,
    }),
    records(1),
  );
  assert.equal(p.qrSize, 900);
  assert.doesNotThrow(() => layout.config({ ...p.config, qrSize: p.qrSize }));
});
test('automatic columns use printable width rather than a fixed four-column cap', () => {
  const p = layout.plan(config({ paperWidth: 310, paperHeight: 100 }), records(12));
  assert.equal(p.columns, 6);
  assert.equal(p.positions[6].x, p.positions[0].x);
  assert.equal(p.positions[6].y - p.positions[0].y, 35);
});
test('custom paper is exact regardless of legacy orientation and the usable rectangle honors four margins', () => {
  const p = layout.plan(
    config({
      paperWidth: 180,
      paperHeight: 140,
      orientation: 'landscape',
      separateMargins: true,
      marginLeft: 7,
      marginRight: 13,
      marginTop: 11,
      marginBottom: 19,
    }),
    records(3),
  );
  assert.deepEqual(p.paper, { width: 180, height: 140 });
  assert.deepEqual(p.printable, { x: 7, y: 11, width: 160, height: 110 });
  assert.equal(p.positions[0].x, 22);
  for (const r of p.positions) {
    assert.ok(r.x >= 7 && r.y >= 11 && r.x + r.width <= 167 && r.y + r.height <= 121);
  }
});
test('whole page and incomplete final row center their actually occupied area', () => {
  const p = layout.plan(
    config({ pageAlignX: 'center', pageAlignY: 'center', lastRowAlign: 'center' }),
    records(4),
  );
  assert.equal(p.columns, 3);
  assert.equal(p.positions[0].y, 37.5);
  assert.equal(p.positions[3].x, 70);
  const only = layout.plan(config({ pageAlignY: 'center' }), records(1));
  assert.equal(only.positions[0].x, 70);
  assert.equal(only.positions[0].y, 55);
});
test('zero margins and gaps work, while consumed printable space and non-finite custom sizes are rejected', () => {
  assert.doesNotThrow(() => layout.plan(config({ margin: 0, gapX: 0, gapY: 0 }), records(20)));
  assert.throws(
    () =>
      layout.plan(config({ separateMargins: true, marginLeft: 100, marginRight: 100 }), records(1)),
    /页边距/,
  );
  assert.throws(() => layout.config(config({ paperWidth: Infinity })), /纸张/);
  assert.throws(() => layout.plan(config({ paperWidth: 30 }), records(1)), /可打印/);
});
test('every page honors alignment independently and exact input order can be retained', () => {
  const rows = [{ code: '010' }, { code: '002' }, { code: '001' }];
  const p = layout.plan(
    config({ paperWidth: 70, paperHeight: 65, sort: false, pageAlignY: 'center' }),
    rows,
  );
  assert.equal(p.pages, 3);
  assert.deepEqual(
    p.positions.map((p) => p.record.code),
    ['010', '002', '001'],
  );
  assert.ok(p.positions.every((p) => p.x === 15 && p.y === 17.5));
});
test('group centering and translation preserve internal relative positions and stop at label edges', () => {
  const t = design();
  t.elements[0].group = t.elements[1].group = 'pair';
  const ids = geometry.expand(t, 'title');
  assert.deepEqual(ids, ['qr', 'title']);
  const centered = geometry.align(t, ids, 'center');
  assert.equal(geometry.bounds(geometry.chosen(centered, ids)).x, 10);
  assert.equal(centered.elements[1].x - centered.elements[0].x, 25);
  const moved = geometry.move(centered, ids, 100, -100);
  assert.equal(moved.elements[0].y, 0);
  assert.equal(moved.elements[1].x + moved.elements[1].width, 80);
  assert.equal(t.elements[0].x, 5);
});
test('uniform group resizing keeps QR square and scales text font with the chosen option', () => {
  const t = design(),
    ids = ['qr', 'title'],
    b = geometry.bounds(geometry.chosen(t, ids));
  const scaled = geometry.resize(t, ids, b.width * 0.5, b.height * 0.5, true);
  assert.equal(scaled.elements[0].width, 10);
  assert.equal(scaled.elements[0].height, 10);
  assert.equal(scaled.elements[1].fontSize, 6);
  assert.equal(
    geometry.resize(t, ids, b.width * 0.5, b.height * 0.5, false).elements[1].fontSize,
    12,
  );
});
test('single text resizing changes frame dimensions and can scale the type without distorting a QR', () => {
  const t = design(),
    scaled = geometry.resize(t, ['title'], 17.5, 5, true);
  assert.equal(scaled.elements[1].fontSize, 6);
  assert.equal(scaled.elements[1].height, 5);
  assert.equal(scaled.elements[0].width, 20);
});
test('distributing unequal elements yields equal edge-to-edge gaps, not equal centers', () => {
  const out = geometry.distribute(design(), ['line-a', 'line-b', 'line-c'], 'x'),
    [a, b, c] = out.elements.slice(2);
  assert.equal(b.x - a.x - a.width, c.x - b.x - b.width);
  assert.equal(a.x, 5);
  assert.equal(c.x + c.width, 75);
  assert.throws(() => geometry.distribute(out, ['qr', 'title'], 'x'), /至少三个/);
});
test('smart guides snap the selected group as a unit and fitting recenters without clipping', () => {
  const t = design(),
    snap = geometry.snap(t, ['qr'], 24.7, 0, 0.6);
  assert.equal(snap.dx, 25);
  assert.ok(snap.guides.some((g) => g.axis === 'x'));
  const out = geometry.fit(t, ['qr', 'title'], 3),
    b = geometry.bounds(geometry.chosen(out, ['qr', 'title']));
  assert.ok(b.x >= 3 && b.y >= 3 && b.x + b.width <= 77 && b.y + b.height <= 57);
  assert.ok(Math.abs(b.x - (80 - b.width) / 2) < 0.002);
});
test('text vertical alignment and font choice survive composition and SVG without changing code values', () => {
  const t = design();
  t.elements[1].height = 20;
  t.elements[1].valign = 'top';
  t.elements[1].fontFamily = 'mono';
  const a = layout.plan(
    config({ width: 80, height: 60, composition: 'custom', template: t }),
    records(1),
  );
  t.elements[1].valign = 'bottom';
  const b = layout.plan({ ...a.config, template: t }, records(1));
  assert.ok(b.positions[0].text[0].y > a.positions[0].text[0].y + 10);
  assert.match(render.pageSvg(b, 0), /Consolas/);
  assert.equal(b.positions[0].record.code, 'N-001');
});
test('custom physical paper, asymmetric print margins and editable fonts are carried into Excel and PDF HTML', () => {
  const t = design();
  t.elements[1].fontFamily = 'serif';
  const p = layout.plan(
    config({
      width: 80,
      height: 60,
      composition: 'custom',
      template: t,
      separateMargins: true,
      marginLeft: 7,
      marginRight: 13,
      marginTop: 9,
      marginBottom: 11,
    }),
    records(1),
  );
  const z = openZip(exportWorkbook(p)),
    sheet = z.read('xl/worksheets/sheet1.xml').toString('utf8'),
    drawing = z.read('xl/drawings/drawing1.xml').toString('utf8');
  assert.match(sheet, /paperWidth="180mm" paperHeight="140mm"/);
  assert.match(sheet, new RegExp('left="' + String(7 / 25.4) + '"'));
  assert.match(drawing, /Times New Roman/);
  assert.match(render.printHtml(p), /size:180mm 140mm/);
});
