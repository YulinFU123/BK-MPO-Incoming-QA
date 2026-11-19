'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs/promises'),
  path = require('node:path'),
  os = require('node:os'),
  crypto = require('node:crypto');
const layout = require('../domain/label-layout'),
  memory = require('../domain/label-memory'),
  render = require('../desktop/label-render');
const { createLabelMemory } = require('../desktop/label-memory');
const { exportWorkbook, labelsFromWorkbook } = require('../desktop/label-workbook');
const { openZip } = require('../adapters/xlsx/zip');
const composition = (more = {}) => ({
  config: layout.preset('fixture'),
  name: '',
  creator: '示例员',
  range: { prefix: 'S-', start: 1, end: 5, digits: 3 },
  codes: '0012\n12\n测试-A',
  creators: [
    ['0012', '示例甲'],
    ['12', ''],
  ],
  ...more,
});
async function setup(t) {
  const base = path.resolve(process.env.PLATFORM_TEST_ROOT || os.tmpdir());
  await fs.mkdir(base, { recursive: true });
  const directory = await fs.mkdtemp(path.join(base, 'labels-memory-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(directory)), base);
    assert.ok(path.basename(directory).startsWith('labels-memory-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const context = {
    unlocked: true,
    sessionId: 1,
    mode: 'file',
    file: path.join(directory, '业务.eap'),
  };
  const key = crypto.randomBytes(32);
  const encryption = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => {
      const iv = crypto.randomBytes(12),
        c = crypto.createCipheriv('aes-256-gcm', key, iv);
      return Buffer.concat([iv, c.update(value, 'utf8'), c.final(), c.getAuthTag()]);
    },
    decryptString: (bytes) => {
      const d = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      d.setAuthTag(bytes.subarray(-16));
      return Buffer.concat([d.update(bytes.subarray(12, -16)), d.final()]).toString('utf8');
    },
  };
  const params = {
    controller: { hostContext: () => ({ ...context }) },
    directory: path.join(directory, 'preferences'),
    encryption,
  };
  return { directory, context, params, store: createLabelMemory(params) };
}
test('optional name and hidden text release real QR space; empty name has no blank reserved line', () => {
  const c = layout.preset('fixture'),
    rows = [{ code: '0012', name: '名称', creator: '' }];
  const shown = layout.plan(c, rows),
    hidden = layout.plan({ ...c, showName: false }, rows),
    blank = layout.plan(c, [{ ...rows[0], name: '' }]);
  assert.ok(hidden.qrSize > shown.qrSize);
  assert.equal(hidden.qrSize, blank.qrSize);
  assert.ok(!hidden.positions[0].text.some((t) => t.value === '名称'));
  const qrOnly = layout.plan({ ...c, showName: false, showCode: false, signatures: false }, rows);
  assert.equal(qrOnly.qrSize, 46);
  assert.equal(qrOnly.positions[0].text.length, 0);
});
test('adaptive proportion fills square and wide labels, manual mode and percentage remain exact', () => {
  const rows = [{ code: 'P-001', name: '', creator: '' }],
    c = { ...layout.preset('fixture'), signatures: false, showName: false, showCode: false };
  const full = layout.plan(c, rows),
    half = layout.plan({ ...c, qrScale: 50 }, rows),
    manual = layout.plan({ ...c, qrMode: 'manual', qrSize: 18 }, rows);
  assert.equal(half.qrSize, full.qrSize / 2);
  assert.equal(manual.qrSize, 18);
  const wide = layout.plan({ ...c, width: 62, height: 20, showCode: true }, rows);
  assert.equal(wide.layout, 'horizontal');
  assert.equal(wide.qrSize, 16);
  for (const p of wide.positions) {
    assert.ok(p.qr.x >= p.x);
    assert.ok(p.qr.y + p.qr.size <= p.y + p.height);
    assert.ok(p.text.every((t) => t.x >= p.qr.x + p.qr.size));
  }
});
test('small QR is allowed with an actionable warning; unicode and exact duplicates are explicit options', () => {
  const c = {
    ...layout.preset('fixture'),
    width: 8,
    height: 8,
    padding: 0.5,
    showName: false,
    showCode: false,
    signatures: false,
  };
  const p = layout.plan(c, [{ code: '夹具-0012 / A?x=1&y=2', name: '', creator: '' }]);
  assert.doesNotThrow(() => render.pageSvg(p, 0));
  assert.ok(render.warnings(p).length);
  const rows = layout.parse('A-001\nA-001', '', {}, { allowDuplicates: true });
  assert.equal(rows.length, 2);
  assert.equal(layout.plan({ ...c, allowDuplicates: true }, rows).positions.length, 2);
  assert.throws(() => layout.plan(c, rows), /重复/);
});
test('optional blank names and unicode identifiers survive Excel, hidden borders match the preview', () => {
  const c = { ...layout.preset('stripper'), showName: false, border: false };
  const bytes = exportWorkbook(layout.plan(c, [{ code: '夹具-0012', name: '', creator: '' }]));
  const result = labelsFromWorkbook(bytes).sheets.find((s) => s.name === '编号清单');
  assert.deepEqual(
    result.records.map((r) => ({ code: r.code, name: r.name })),
    [{ code: '夹具-0012', name: '' }],
  );
  const archive = openZip(bytes);
  const drawing = archive.read('xl/drawings/drawing1.xml').toString('utf8');
  assert.ok(!drawing.includes('标签边界'));
});
test('encrypted memory reopens exact common settings without persisting opted-out codes', async (t) => {
  const { store, params } = await setup(t);
  const first = (await store.read()).state;
  const result = await store.save({ ...first, current: composition() });
  assert.equal(result.state.revision, 1);
  assert.ok(!Object.hasOwn(result.state.current, 'codes'));
  const reopened = await createLabelMemory(params).read();
  assert.equal(reopened.state.current.creator, '示例员');
  assert.equal(reopened.state.current.name, '');
  const names = await fs.readdir(params.directory);
  assert.match(names[0], /^[a-f0-9]{64}\.v4\.bin$/);
  const bytes = await fs.readFile(path.join(params.directory, names[0]));
  assert.ok(!bytes.includes(Buffer.from('示例员')));
  assert.ok(!bytes.includes(Buffer.from('测试-A')));
});
test('0.7 encrypted memory imports read-only into a separate namespace and leaves rollback bytes intact', async (t) => {
  const { store, params, context } = await setup(t);
  const oldConfig = composition().config;
  for (const key of Object.keys(require('../domain/label-sheet').defaults)) delete oldConfig[key];
  const legacy = {
    ...memory.empty(),
    schemaVersion: 1,
    revision: 7,
    current: composition({ config: { ...oldConfig, columns: 4 } }),
  };
  const scope = crypto
    .createHash('sha256')
    .update(path.resolve(context.file).toLowerCase())
    .digest('hex');
  const oldFile = path.join(params.directory, scope + '.bin'),
    cipher = await params.encryption.encryptString(JSON.stringify(legacy));
  await fs.mkdir(params.directory, { recursive: true });
  await fs.writeFile(oldFile, cipher);
  const imported = (await store.read()).state;
  assert.equal(imported.revision, 0);
  assert.equal(imported.current.config.columns, 4);
  assert.equal(imported.current.config.paperSize, 'a4');
  await store.save({
    ...imported,
    current: {
      ...imported.current,
      config: { ...imported.current.config, paperSize: 'custom', paperWidth: 120, paperHeight: 80 },
    },
  });
  assert.deepEqual(await fs.readFile(oldFile), cipher);
  assert.equal((await fs.readdir(params.directory)).length, 2);
  assert.equal((await createLabelMemory(params).read()).state.current.config.paperWidth, 120);
});
test('v2 label memory migrates read-only to v4 and new per-row data survives an independent reopen', async (t) => {
  const { store, params, context } = await setup(t);
  const scope = crypto
    .createHash('sha256')
    .update(path.resolve(context.file).toLowerCase())
    .digest('hex');
  const old = { ...memory.empty(), schemaVersion: 1, revision: 8, current: composition() };
  delete old.current.config.showSpec;
  const bytes = await params.encryption.encryptString(JSON.stringify(old));
  const oldFile = path.join(params.directory, scope + '.v2.bin');
  await fs.mkdir(params.directory, { recursive: true });
  await fs.writeFile(oldFile, bytes);
  const loaded = (await store.read()).state;
  assert.equal(loaded.schemaVersion, 3);
  assert.equal(loaded.revision, 0);
  const records = [
    { code: '0012', name: '', spec: 'A', creator: '' },
    { code: '12', name: '乙夹具', spec: 'B', creator: '乙' },
  ];
  await store.save({
    ...loaded,
    rememberCodes: true,
    current: { ...loaded.current, dataMode: 'table', records },
  });
  assert.deepEqual((await createLabelMemory(params).read()).state.current.records, records);
  assert.deepEqual(await fs.readFile(oldFile), bytes);
  assert.deepEqual(
    (await fs.readdir(params.directory)).sort(),
    [scope + '.v2.bin', scope + '.v4.bin'].sort(),
  );
});
test('v3 rollback memory remains byte-identical when a barcode template is saved in independent v4 memory', async (t) => {
  const { store, params, context } = await setup(t),
    scope = crypto
      .createHash('sha256')
      .update(path.resolve(context.file).toLowerCase())
      .digest('hex');
  await fs.mkdir(params.directory, { recursive: true });
  const old = { ...memory.empty(), schemaVersion: 2, current: composition(), revision: 4 };
  const bytes = await params.encryption.encryptString(JSON.stringify(old));
  const oldFile = path.join(params.directory, scope + '.v3.bin');
  await fs.writeFile(oldFile, bytes);
  const loaded = (await store.read()).state;
  assert.equal(loaded.revision, 0);
  const c = {
    ...loaded.current.config,
    width: 62,
    height: 40,
    composition: 'custom',
    template: {
      version: 2,
      width: 62,
      height: 40,
      elements: [
        { id: 'qr', type: 'qr', x: 2, y: 2, width: 20, height: 20 },
        { id: 'barcode', type: 'barcode', x: 2, y: 26, width: 58, height: 8 },
      ],
    },
  };
  await store.save({ ...loaded, current: { ...loaded.current, config: c } });
  assert.deepEqual(await fs.readFile(oldFile), bytes);
  const restored = (await createLabelMemory(params).read()).state;
  assert.equal(restored.current.config.template.elements[1].type, 'barcode');
  assert.equal(restored.schemaVersion, 3);
});
test('opting out strips row data from current memory and named profiles while retaining input and fit preferences', () => {
  const current = composition({
    dataMode: 'table',
    records: [{ code: 'S-1', name: '私有标签', spec: 'A', creator: '' }],
    fit: { width: 62, height: 20, mode: 'reflow' },
  });
  const result = memory.validate({
    ...memory.empty(),
    rememberCodes: false,
    current,
    profiles: [{ id: 'p', title: '模板', composition: current }],
  });
  for (const value of [result.current, result.profiles[0].composition]) {
    assert.equal(Object.hasOwn(value, 'records'), false);
    assert.equal(Object.hasOwn(value, 'codes'), false);
    assert.equal(value.dataMode, 'table');
    assert.equal(value.fit.height, 20);
  }
});
test('oversized remembered batches cannot write an unreadable file or replace the previous encrypted memory', async (t) => {
  const { store, params } = await setup(t);
  const saved = await store.save({ ...memory.empty(), current: composition() });
  const name = (await fs.readdir(params.directory))[0],
    before = await fs.readFile(path.join(params.directory, name));
  const records = Array.from({ length: 2000 }, () => ({
    code: '夹'.repeat(128),
    name: '具'.repeat(100),
    spec: '规'.repeat(100),
    creator: '人'.repeat(60),
  }));
  await assert.rejects(
    store.save({
      ...saved.state,
      rememberCodes: true,
      current: composition({ dataMode: 'table', records }),
    }),
    { code: 'LABEL_MEMORY_ARGUMENT' },
  );
  assert.deepEqual(await fs.readFile(path.join(params.directory, name)), before);
});
test('remembered batch preserves zeros case unicode and blank per-code creators after reopening', async (t) => {
  const { store, params } = await setup(t);
  await store.save({ ...memory.empty(), rememberCodes: true, current: composition() });
  const result = await createLabelMemory(params).read();
  assert.equal(result.state.current.codes, '0012\n12\n测试-A');
  assert.deepEqual(result.state.current.creators, [
    ['0012', '示例甲'],
    ['12', ''],
  ]);
  const next = await store.save({ ...result.state, rememberCodes: false });
  assert.ok(!Object.hasOwn(next.state.current, 'codes'));
  assert.ok(!Object.hasOwn(next.state.current, 'creators'));
});
test('named profiles retain optional display choices but never store the current batch', async (t) => {
  const { store } = await setup(t),
    c = composition({ config: { ...layout.preset('stripper'), showName: false } });
  const state = {
    ...memory.empty(),
    current: c,
    profiles: [{ id: 'p-1', title: '无名称', composition: c }],
  };
  const saved = await store.save(state);
  assert.equal(saved.state.profiles[0].composition.config.showName, false);
  assert.ok(!Object.hasOwn(saved.state.profiles[0].composition, 'codes'));
  const disabled = await store.save({ ...saved.state, autoRemember: false });
  assert.equal(disabled.state.current, null);
  assert.equal(disabled.state.profiles.length, 1);
});
test('memory is scoped by workspace and rejects stale concurrent updates', async (t) => {
  const { store, context } = await setup(t),
    initial = (await store.read()).state;
  await store.save({ ...initial, current: composition() });
  await assert.rejects(store.save(initial), { code: 'LABEL_MEMORY_CONFLICT' });
  context.sessionId++;
  context.file += 'other';
  assert.equal((await store.read()).state.current, null);
  context.unlocked = false;
  assert.throws(() => store.read(), { code: 'WORKSPACE_LOCKED' });
});
test('failed atomic preference replacement retains previous encrypted memory and removes only own temp', async (t) => {
  const { store, params } = await setup(t);
  const saved = await store.save({ ...memory.empty(), current: composition() });
  const before = await fs.readFile(
    path.join(params.directory, (await fs.readdir(params.directory))[0]),
  );
  const failing = createLabelMemory({
    ...params,
    replace: () => {
      throw Object.assign(Error('controlled'), { code: 'EPERM' });
    },
  });
  await assert.rejects(failing.save({ ...saved.state, current: composition({ name: '未保存' }) }), {
    code: 'LABEL_MEMORY_WRITE',
  });
  assert.equal((await store.read()).state.current.name, '');
  const names = await fs.readdir(params.directory);
  const recovery = names.filter(name => name.includes('.recovery-'));
  assert.equal(recovery.length, 1);
  const main = names.find(name => name.endsWith('.v4.bin'));
  assert.deepEqual(await fs.readFile(path.join(params.directory, main)), before);
  await fs.unlink(path.join(params.directory, recovery[0]));
});
test('corrupt or unavailable encryption is never overwritten or silently stored as plaintext', async (t) => {
  const { store, params } = await setup(t);
  await store.save({ ...memory.empty(), current: composition() });
  const file = path.join(params.directory, (await fs.readdir(params.directory))[0]);
  await fs.writeFile(file, 'controlled corruption');
  await assert.rejects(store.read(), { code: 'LABEL_MEMORY_READ' });
  await assert.rejects(store.save(memory.empty()), { code: 'LABEL_MEMORY_READ' });
  assert.equal(await fs.readFile(file, 'utf8'), 'controlled corruption');
  const plain = createLabelMemory({
    ...params,
    encryption: {
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => 'basic_text',
    },
  });
  await assert.rejects(plain.read(), { code: 'LABEL_MEMORY_UNAVAILABLE' });
});
test('session change during encryption cannot create a memory file for another workspace', async (t) => {
  const { context, params } = await setup(t);
  const original = params.encryption.encryptString;
  params.encryption.encryptString = (value) => {
    context.sessionId++;
    return original(value);
  };
  await assert.rejects(
    createLabelMemory(params).save({ ...memory.empty(), current: composition() }),
    { code: 'SESSION_CHANGED' },
  );
  assert.ok(!(await fs.readdir(params.directory).catch(() => [])).length);
});
test('memory validation rejects unknown keys, accessors, excessive profiles and invalid numeric state', async (t) => {
  const { store } = await setup(t);
  assert.throws(() => store.save({ ...memory.empty(), path: 'C:/forbidden' }), {
    code: 'LABEL_MEMORY_ARGUMENT',
  });
  assert.throws(
    () =>
      store.save({
        ...memory.empty(),
        get current() {
          throw Error('must not execute');
        },
      }),
    { code: 'LABEL_MEMORY_ARGUMENT' },
  );
  assert.throws(
    () =>
      store.save({
        ...memory.empty(),
        current: composition({ config: { ...layout.preset('fixture'), width: Infinity } }),
      }),
    { code: 'LABEL_MEMORY_ARGUMENT' },
  );
  assert.throws(() => store.save({ ...memory.empty(), profiles: Array(31).fill({}) }), {
    code: 'LABEL_MEMORY_ARGUMENT',
  });
});
test('demonstration memory remains ephemeral and clears on session cleanup', async (t) => {
  const { context, params } = await setup(t);
  context.mode = 'demo';
  const store = createLabelMemory({ ...params, encryption: null });
  const saved = await store.save({ ...memory.empty(), current: composition() });
  assert.equal(saved.persistence, 'session-only');
  assert.ok(!(await fs.readdir(params.directory).catch(() => [])).length);
  store.clearSession();
  assert.equal((await store.read()).state.current, null);
});
