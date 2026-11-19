'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict');
const code = require('../domain/code128'),
  layout = require('../domain/label-layout'),
  template = require('../domain/label-template'),
  geometry = require('../domain/label-geometry'),
  editing = require('../domain/label-editing'),
  render = require('../desktop/label-render');
const { barcodePng } = require('../desktop/label-assets'),
  { exportWorkbook, labelsFromWorkbook } = require('../desktop/label-workbook'),
  { openZip } = require('../adapters/xlsx/zip');
const make = () => ({
  version: 2,
  width: 62,
  height: 40,
  elements: [
    { id: 'qr', type: 'qr', x: 2, y: 2, width: 20, height: 20 },
    { id: 'barcode', type: 'barcode', x: 2, y: 26, width: 58, height: 8 },
  ],
});
test('Code128 known checksum, numeric compression and exact leading zeros', () => {
  assert.deepEqual(code.encode('AB').symbols, [104, 33, 34, 102, 106]);
  assert.deepEqual(code.encode('123456').symbols, [105, 12, 34, 56, 44, 106]);
  const z = code.encode('0012');
  assert.deepEqual(z.symbols.slice(0, 3), [105, 0, 12]);
  assert.equal(z.quiet, 10);
  assert.ok(z.bits.startsWith('0000000000') && z.bits.endsWith('0000000000'));
  assert.ok(code.encode('A12345678Z').symbols.includes(99));
  for (const invalid of ['', '中文编号', 'A\nB', 'A'.repeat(129)])
    assert.throws(() => code.encode(invalid), /Code 128/);
});
test('barcode geometry repeats across a batch and survives single/full SVG with correct label coordinates', () => {
  const p = layout.plan(
    { ...layout.preset('fixture'), width: 62, height: 40, composition: 'custom', template: make() },
    [
      { code: '0012', name: '甲' },
      { code: 'AB12', name: '乙' },
    ],
  );
  for (const pos of p.positions) {
    assert.equal(pos.barcodes[0].x - pos.x, 2);
    assert.equal(pos.barcodes[0].y - pos.y, 26);
  }
  assert.equal((render.pageSvg(p, 0).match(/data-barcode="code128"/g) || []).length, 2);
  assert.ok(render.labelSvg(p, 1).includes('x="2" y="26" width="58" height="8"'));
  assert.ok(render.printHtml(p).includes('data-barcode="code128"'));
  const resized = template.resize(make(), 124, 80);
  assert.equal(resized.version, 2);
  assert.equal(resized.elements[1].width, 116);
  assert.equal(resized.elements[1].height, 16);
});
test('barcodes participate in move, independent resize, duplicate, group and clipboard paste into an older template', () => {
  const original = make(),
    moved = geometry.move(original, ['barcode'], 0, -2),
    resized = geometry.resize(moved, ['barcode'], 50, 5, false);
  assert.equal(resized.elements.find((e) => e.type === 'barcode').height, 5);
  assert.equal(original.elements[1].height, 8);
  const clip = editing.copy(original, ['barcode']),
    old = { ...original, version: 1, elements: original.elements.slice(0, 1) };
  const pasted = editing.paste(old, clip, { x: 3, y: 25, id: () => 'copy' });
  assert.equal(pasted.template.version, 2);
  assert.equal(pasted.template.elements[1].type, 'barcode');
  assert.throws(() => template.validate({ ...original, version: 1 }), /类型/);
  assert.throws(
    () =>
      layout.plan(
        {
          ...layout.preset('fixture'),
          width: 62,
          height: 40,
          composition: 'custom',
          template: make(),
        },
        [{ code: '中文', name: '' }],
      ),
    /Code 128/,
  );
});
test('Excel includes anchored barcode image and exact code strings without replacing the existing QR image', () => {
  const p = layout.plan(
    { ...layout.preset('fixture'), width: 62, height: 40, composition: 'custom', template: make() },
    [{ code: '0012', name: '甲' }],
  );
  const bytes = exportWorkbook(p),
    archive = openZip(bytes),
    drawing = archive.read('xl/drawings/drawing1.xml').toString();
  assert.ok(archive.read('xl/media/label1.png'));
  assert.ok(archive.read('xl/media/barcode1-0.png'));
  assert.ok(drawing.includes('Code128 0012'));
  assert.equal(labelsFromWorkbook(bytes).sheets.flatMap((s) => s.records)[0].code, '0012');
  const image = barcodePng('0012', 8);
  assert.ok(image.subarray(1, 4).toString() === 'PNG');
  assert.equal(image.readUInt32BE(16), code.encode('0012').modules * 3);
  assert.ok(image.readUInt32BE(20) >= 48);
});
test('thin bars and overlapping machine readable regions are reported without silently dropping elements', () => {
  const t = make();
  t.elements[1] = { ...t.elements[1], x: 2, y: 2, width: 20 };
  const p = layout.plan(
    { ...layout.preset('fixture'), width: 62, height: 40, composition: 'custom', template: t },
    [{ code: 'A'.repeat(40), name: '' }],
  );
  assert.equal(p.positions[0].barcodes.length, 1);
  assert.ok(p.warnings.some((x) => x.includes('最窄条宽')));
  assert.ok(p.warnings.some((x) => x.includes('二维码重叠')));
});
