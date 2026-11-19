'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs'),
  fsp = require('node:fs/promises'),
  path = require('node:path'),
  vm = require('node:vm');
const { randomUUID, randomBytes, createCipheriv, createDecipheriv } = require('node:crypto');
const model = require('../domain/defect-selection'),
  schema = require('../domain/module-state');
const { createSQLiteStateStore } = require('../adapters/state/sqlite-state-store');
const { createModuleStateService } = require('../application/module-state-service');
const A = { scope: 'module', module: 'daily-defects' };
test('defect names are exact, multiple values form a deduplicated selection and no selection means all', () => {
  assert.deepEqual(model.normalize(['装管反', '装管反面', '装管反', '0012', '12']), [
    '装管反',
    '装管反面',
    '0012',
    '12',
  ]);
  assert.deepEqual(model.state({}), { items: [] });
  for (const value of ['装管反', [null], [''], ['a\n'], ['x'.repeat(513)]])
    assert.throws(() => model.normalize(value));
  assert.throws(() => schema.validate(A, { items: ['装管反'], records: [{ sn: 'business' }] }));
});
test('daily and workspace memory survives reopening without overwriting another workspace or BI web filters', async (t) => {
  const directory = path.join(
    process.env.PLATFORM_TEST_ROOT || path.resolve(__dirname, '../../../../构建/当前作业/测试'),
    'defects-' + randomUUID(),
  );
  await fsp.mkdir(directory, { recursive: true });
  const file = path.join(directory, 'modules.sqlite'),
    key = randomBytes(32);
  const encryption = {
    isEncryptionAvailable: async () => true,
    encryptString: async (value) => {
      const iv = randomBytes(12),
        c = createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([c.update(value, 'utf8'), c.final()]);
      return Buffer.concat([iv, c.getAuthTag(), data]);
    },
    decryptString: async (value) => {
      const d = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12));
      d.setAuthTag(value.subarray(12, 28));
      return Buffer.concat([d.update(value.subarray(28)), d.final()]).toString('utf8');
    },
  };
  let context = { unlocked: true, epoch: 1, workspace: 'assembly' };
  let store = await createSQLiteStateStore(file);
  t.after(() => store.close());
  let service = createModuleStateService({ store, encryption, context: () => context });
  await service.save({ address: A, data: { items: ['装管反'] }, expectedRevision: 0 });
  const web = { scope: 'module', module: 'bi-export' };
  assert.deepEqual((await service.read(web)).data, { filters: {}, dictionary: {} });
  context = { unlocked: true, epoch: 2, workspace: 'cutting' };
  assert.deepEqual((await service.read(A)).data.items, []);
  await service.save({ address: A, data: { items: ['剪线不良'] }, expectedRevision: 0 });
  await store.close();
  assert.equal(fs.readFileSync(file).includes(Buffer.from('装管反')), false);
  store = await createSQLiteStateStore(file);
  service = createModuleStateService({ store, encryption, context: () => context });
  context = { unlocked: true, epoch: 3, workspace: 'assembly' };
  assert.deepEqual((await service.read(A)).data.items, ['装管反']);
  await service.reset({ address: A, expectedRevision: 1 });
  assert.deepEqual((await service.read(A)).data.items, []);
  context = { unlocked: true, epoch: 4, workspace: 'cutting' };
  assert.deepEqual((await service.read(A)).data.items, ['剪线不良']);
});
test('PNG annotation uses the captured chart query, not a later changed screen filter', () => {
  const context = vm.createContext({
    window: { DefectSelection: model, addEventListener() {} },
    DAILY_DEFAULT_QUERY: {},
    dailyFilters() {},
    dailyAnalyze() {},
    dailyExport() {},
    dailyChartSvg() {
      return {
        children: [],
        getAttribute: () => 260,
        append(...items) {
          this.children.push(...items);
        },
      };
    },
    PAGES: { trends() {} },
    svgEl: (tag, attrs, text) => ({ tag, attrs, text }),
    D: { q: { items: ['另外一个项目'] } },
    setTimeout,
    clearTimeout,
    queueMicrotask,
  });
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '../desktop/bi-defect-ui.js'), 'utf8'),
    context,
  );
  const svg = context.dailyChartSvg('柱形图', [], {}, { items: ['装管反'] }, 10, false);
  assert.equal(svg.children[0].text, '不良项：装管反');
  assert.equal(svg.children[1].text, '不良项：装管反');
  assert.ok(svg.children[0].attrs.y > 140);
  assert.ok(!svg.children.some((item) => String(item.text).includes('另外')));
});
test('a trusted address reuses state routing without letting the renderer choose a module', async () => {
  const { filterMemory } = require('../desktop/bi-filter-state');
  let captured;
  await filterMemory(
    {
      saveModuleState: async (input) => {
        captured = input;
        return true;
      },
    },
    { action: 'save', data: { items: ['装管反'] }, expectedRevision: 2 },
    A,
  );
  assert.deepEqual(captured.address, A);
  assert.equal(captured.expectedRevision, 2);
  await assert.rejects(
    filterMemory({}, { action: 'read', address: { scope: 'global', module: 'shell' } }, A),
    (e) => e.code === 'STATE_INVALID',
  );
});
