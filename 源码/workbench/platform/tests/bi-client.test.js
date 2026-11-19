'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs/promises'),
  path = require('node:path'),
  os = require('node:os');
const { startBIWorker } = require('../desktop/bi-client');
const { prepareBI } = require('../scripts/prepare-bi');
const { copyTree } = require('../desktop/bi-host');
const python = process.env.PLATFORM_PYTHON;
const source = path.resolve(__dirname, '../../bi');
test('BI UI retains all 14 pages while retiring the built-in webpage export script', async () => {
  const target = await fs.mkdtemp(
    path.join(process.env.PLATFORM_TEST_ROOT || os.tmpdir(), 'bi-ui-'),
  );
  try {
    const manifest = prepareBI(source, target);
    assert.ok(manifest.length >= 10);
    const html = await fs.readFile(path.join(target, 'index.html'), 'utf8');
    assert.ok(html.includes('fusion.js'));
    assert.ok(!html.includes('<script>boot()'));
    const core = await fs.readFile(path.join(target, 'core.js'), 'utf8');
    assert.ok(!core.includes("fetch('/api/ping')"));
    for (const page of [
      'daily',
      'trends',
      'groups',
      'home',
      'data',
      'schemes',
      'people',
      'defects',
      'charts',
      'dash',
      'alerts',
      'chk',
      'improve',
      'tools',
    ])
      assert.ok(core.includes("'" + page + "'"));
    const bridge = await fs.readFile(path.join(target, 'bi_bridge.js'), 'utf8');
    assert.ok(bridge.includes('function biPanel'));
    assert.ok(html.includes('bi-inbox-ui.js'));
    for (const file of ['bi_export_original.js', 'bi_runner_template.js', 'bi-filter-script.js', 'bi-filter-ui.js'])
      await assert.rejects(fs.access(path.join(target, file)), { code: 'ENOENT' });
  } finally {
    await fs.rm(target, { recursive: true, force: true });
  }
});
test(
  'portable BI process uses private pipes, preserves daily import/dedup/export and closes cleanly',
  { skip: !python },
  async () => {
    const data = await fs.mkdtemp(
      path.join(process.env.PLATFORM_TEST_ROOT || os.tmpdir(), 'bi-pipes-'),
    );
    const worker = startBIWorker({
      python,
      script: path.resolve(__dirname, '../desktop/bi-worker.py'),
      source,
      data,
    });
    try {
      await worker.ready;
      const state = await worker.request({ route: '/api/state' });
      assert.ok(state.config.paths);
      assert.equal(state.base, data);
      const file = path.join(data, '扫码演示.csv');
      await fs.writeFile(
        file,
        'Work Date,Workflow Category in Charge,Employee in Charge,Resource Name Category,Connector Type,Shift,Sum of Qty,Disposition Type,Defect Code\n2026-10-26,P1,演示甲,BK_5F,MPO,白班,3,Rework,演示\n',
        'utf8',
      );
      // Use the actual old field names, not an invented source schema.
      const imported = await worker.request({
        route: '/api/daily/import',
        body: { path: file, scope: 'test', kind: 'quality' },
      });
      assert.equal(imported.ok, true, JSON.stringify(imported));
      const repeated = await worker.request({
        route: '/api/daily/import',
        body: { path: file, scope: 'test', kind: 'quality' },
      });
      assert.match(repeated.results[0].state, /重复/);
      const analyzed = await worker.request({
        route: '/api/daily/analyze',
        body: {
          query: { scope: 'test', start: '2026-10-26', end: '2026-10-26', status: 'Rework,Scrap' },
        },
      });
      assert.equal(analyzed.quantity, 3);
      const exported = await worker.request({
        route: '/api/daily/export',
        body: {
          query: { scope: 'test', start: '2026-10-26', end: '2026-10-26', status: 'Rework,Scrap' },
        },
      });
      assert.equal(exported.ok, true);
      await fs.access(path.join(exported.path, '日报明细.xlsx'));
      await assert.rejects(worker.request({ route: '/api/exit', body: {} }));
      await assert.rejects(
        worker.request({
          route: '/api/daily/import',
          body: { path: path.join(source, 'requirements.txt'), scope: 'x', kind: 'quality' },
        }),
      );
      await worker.close();
    } finally {
      worker.abort();
      await new Promise((resolve) => setTimeout(resolve, 80));
      await fs.rm(data, { recursive: true, force: true });
    }
  },
);
test('BI full-directory copy preserves source bytes and refuses overwriting existing files', async () => {
  const root = await fs.mkdtemp(
    path.join(process.env.PLATFORM_TEST_ROOT || os.tmpdir(), 'bi-copy-'),
  );
  try {
    const original = path.join(root, 'original'),
      target = path.join(root, 'backup');
    await fs.mkdir(original);
    await fs.mkdir(path.join(original, '日报历史'));
    const bytes = Buffer.from([0, 1, 2, 255, 128]);
    await fs.writeFile(path.join(original, '日报历史', 'snapshots.sqlite'), bytes);
    await fs.writeFile(path.join(original, 'config.json'), '配置中文');
    await copyTree(original, target);
    assert.deepEqual(await fs.readFile(path.join(target, '日报历史', 'snapshots.sqlite')), bytes);
    assert.equal(await fs.readFile(path.join(original, 'config.json'), 'utf8'), '配置中文');
    await assert.rejects(copyTree(original, target));
    assert.equal(await fs.readFile(path.join(target, 'config.json'), 'utf8'), '配置中文');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
