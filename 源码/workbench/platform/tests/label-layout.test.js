'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs/promises'),
  os = require('node:os'),
  path = require('node:path');
const model = require('../domain/label-layout'),
  render = require('../desktop/label-render');
const { zip, png } = require('../desktop/label-assets'),
  { openZip } = require('../adapters/xlsx/zip');
const { exportWorkbook, labelsFromWorkbook } = require('../desktop/label-workbook'),
  { createLabelFiles } = require('../desktop/label-files');
const items = (n = 19) =>
  Array.from({ length: n }, (_, i) => ({
    code: `FIX-${String(i + 1).padStart(3, '0')}`,
    name: '示例夹具',
    creator: i ? '' : '李',
  }));
const plan = (c = {}, n = 19) => model.plan({ ...model.preset('fixture'), ...c }, items(n));
test('label dimensions are real geometry, default19 labels form two pages', () => {
  const p = plan();
  assert.equal(p.pages, 2);
  assert.equal(p.capacity, 15);
  for (const b of p.positions) {
    assert.equal(b.width, 50);
    assert.equal(b.height, 50);
    assert.ok(b.x >= 10 && b.y >= 10);
    assert.ok(b.x + b.width <= 287 && b.y + b.height <= 200);
  }
  assert.equal(plan({ width: 60, height: 55 }).positions[0].width, 60);
});
test('horizontal and vertical spacing independently control actual positions', () => {
  const p = plan({ gapX: 9, gapY: 12, height: 45, fontSize: 8, qrSize: 19 });
  assert.equal(p.positions[1].x - p.positions[0].x, 59);
  assert.equal(p.positions[4].y - p.positions[0].y, 57);
});
test('QR size padding and fonts affect SVG geometry rather than only controls', () => {
  const a = plan(),
    b = plan({ qrMode: 'manual', qrSize: 25, height: 56, fontSize: 10, padding: 3 });
  assert.equal(b.qrSize, 25);
  assert.notEqual(a.positions[0].qr.x, b.positions[0].qr.x);
  assert.ok(render.pageSvg(b, 0).includes('25'));
  assert.notEqual(a.positions[0].text[0].font, b.positions[0].text[0].font);
});
test('tight labels adapt QR size and report it; impossible content fails', () => {
  const p = plan({ qrMode: 'manual', height: 44 });
  assert.ok(p.qrSize < 22);
  assert.ok(p.warnings.length);
  assert.throws(() => plan({ height: 10, layout: 'vertical' }), /放不下/);
});
test('compact stripper labels keep 20mm height and independent QR size', () => {
  const p = model.plan(model.preset('stripper'), items(11));
  assert.equal(p.pages, 1);
  assert.equal(p.qrSize, 17);
  assert.equal(p.positions[0].height, 20);
  assert.equal(p.positions[0].text.length, 2);
});
test('orientation margin and columns adapt without clipping', () => {
  const p = plan({ orientation: 'portrait', margin: 14, width: 60, columns: 4 });
  assert.equal(p.paper.width, 210);
  assert.equal(p.columns, 2);
  assert.equal(p.positions[0].y, 14);
  assert.ok(p.warnings.some((s) => s.includes('2列')));
});
test('zero spacing and automatic columns remain valid, no overlapping labels', () => {
  const p = plan({ gapX: 0, gapY: 0, columns: 0 });
  assert.equal(p.columns, 5);
  assert.equal(p.positions[1].x, p.positions[0].x + 50);
  assert.equal(p.positions[5].y, p.positions[0].y + 50);
});
test('codes preserve zero padding case and exact duplicate rules', () => {
  const rows = model.parse('A-001\nA-1\na-001', '测试');
  assert.equal(rows.length, 3);
  assert.throws(() => model.parse('A-001\nA-001', '测试'), /重复/);
  assert.equal(model.continuous('X-', 8, 10, 3).join(','), 'X-008,X-009,X-010');
});
test('invalid settings injection unsafe values and oversized batches are rejected', () => {
  for (const c of [{ width: NaN }, { gapX: -1 }, { columns: 1.5 }, { extra: 2 }, { fontSize: 97 }])
    assert.throws(() => plan(c));
  assert.throws(() => model.records(items(2001)));
  assert.throws(() => model.parse('X\u0000Y', '测试'));
  assert.throws(() => model.continuous('X-', 10, 1, 3));
});
test('long codes wrap consistently without mutating source data', () => {
  const rows = items(2);
  rows[1].code = 'ABCDEFGHIJKLMNOPQRST-000001';
  const before = JSON.stringify(rows);
  const p = model.plan({ ...model.preset('stripper'), width: 60, fontSize: 10 }, rows);
  assert.equal(JSON.stringify(rows), before);
  assert.ok(p.positions[0].text[0].y === p.positions[1].text[0].y);
});
test('SVG text is escaped, print has exact A4 size and only internal vectors', () => {
  const rows = [{ code: 'X-001', name: '<img onerror="x">', creator: '' }];
  const p = model.plan(model.preset('fixture'), rows),
    svg = render.pageSvg(p, 0);
  assert.ok(svg.includes('&lt;img'));
  assert.ok(!svg.includes('<img'));
  assert.ok(!svg.includes('href='));
  assert.match(render.printHtml(p), /size:297mm 210mm/);
  assert.match(render.printHtml(p), /margin:0/);
});
test('PNG writer produces bounded square RGB QR with standard headers', () => {
  const matrix = render.matrix('X-001'),
    bytes = png(matrix);
  assert.equal(bytes.readUInt32BE(0), 0x89504e47);
  assert.equal(bytes.readUInt32BE(16), (matrix.length + 8) * 12);
  assert.equal(bytes.readUInt32BE(16), bytes.readUInt32BE(20));
});
test('ZIP CRC unicode entries and DOS dates are compatible with existing bounded reader', () => {
  const bytes = zip([
      ['标签.svg', '<svg/>'],
      ['a.txt', 'abc'],
    ]),
    opened = openZip(bytes);
  assert.equal(opened.read('标签.svg').toString(), '<svg/>');
  assert.equal(opened.read('a.txt').toString(), 'abc');
  assert.ok((bytes.readUInt16LE(12) & 31) > 0);
});
test('Excel exports per-page physical anchors and exact editable code strings', () => {
  const p = plan(),
    bytes = exportWorkbook(p),
    opened = openZip(bytes);
  assert.ok(opened.read('xl/drawings/drawing1.xml').toString().includes('xdr:absoluteAnchor'));
  assert.equal(opened.names.filter((n) => n.startsWith('xl/media/')).length, 19);
  assert.match(opened.read('xl/worksheets/sheet1.xml').toString(), /scale="100"/);
  assert.equal(
    labelsFromWorkbook(bytes).sheets.find((s) => s.name === '编号清单').records.length,
    19,
  );
});
test('Excel roundtrip preserves blank creators and every original identifier', () => {
  const p = plan(),
    back = labelsFromWorkbook(exportWorkbook(p)).sheets.find((s) => s.name === '编号清单');
  assert.deepEqual(
    back.records.map(({ code, name, creator }) => ({ code, name, creator })),
    p.positions.map((p) => p.record),
  );
});
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(process.env.PLATFORM_TEST_ROOT || os.tmpdir(), 'label-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let session = 1,
    unlocked = true;
  const controller = { hostContext: () => ({ sessionId: session, unlocked }) };
  return {
    root,
    controller,
    lock: () => {
      session++;
      unlocked = false;
    },
    unlock: () => {
      session++;
      unlocked = true;
    },
  };
}
test('label exports require unlocked session and cannot accept arbitrary paths', async (t) => {
  const f = await fixture(t),
    host = createLabelFiles({
      controller: f.controller,
      pick: async () => null,
      save: async () => null,
    });
  f.lock();
  await assert.rejects(host.export({ format: 'xlsx', config: {}, records: items() }), {
    code: 'WORKSPACE_LOCKED',
  });
  f.unlock();
  await assert.rejects(host.export({ format: 'xlsx', path: 'bad', config: {}, records: items() }), {
    code: 'LABEL_ARGUMENT',
  });
});
test('cancelled dialogs do not create exports or change data', async (t) => {
  const f = await fixture(t),
    host = createLabelFiles({
      controller: f.controller,
      pick: async () => null,
      save: async () => null,
    });
  assert.equal((await host.pick()).cancelled, true);
  assert.equal(
    (await host.export({ format: 'xlsx', config: {}, records: items() })).cancelled,
    true,
  );
  assert.deepEqual(await fs.readdir(f.root), []);
});
test('real export protects imported source and refuses existing output', async (t) => {
  const f = await fixture(t),
    source = path.join(f.root, 'source.xlsx');
  await fs.writeFile(source, exportWorkbook(plan()));
  let output = source;
  const host = createLabelFiles({
    controller: f.controller,
    pick: async () => source,
    save: async () => output,
  });
  assert.equal((await host.pick()).sheets.length, 3);
  await assert.rejects(host.export({ format: 'xlsx', config: {}, records: items() }), {
    code: 'LABEL_SOURCE_PROTECTED',
  });
  output = path.join(f.root, 'new.xlsx');
  await host.export({ format: 'xlsx', config: {}, records: items() });
  await assert.rejects(host.export({ format: 'xlsx', config: {}, records: items() }), {
    code: 'LABEL_EXISTS',
  });
});
test('session changes during file choice prevent reads or output writes', async (t) => {
  const f = await fixture(t),
    host = createLabelFiles({
      controller: f.controller,
      pick: async () => {
        f.lock();
        return path.join(f.root, 'absent.xlsx');
      },
      save: async () => null,
    });
  await assert.rejects(host.pick(), { code: 'WORKSPACE_LOCKED' });
  assert.deepEqual(await fs.readdir(f.root), []);
});
