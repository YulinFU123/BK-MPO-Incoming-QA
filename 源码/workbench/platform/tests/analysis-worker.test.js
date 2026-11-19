'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs/promises'),
  path = require('node:path'),
  { randomUUID } = require('node:crypto');
const M = require('../domain/analysis-studio'),
  A = require('../domain/a4-report'),
  { createAnalysisStudioHost } = require('../desktop/analysis-studio-host');
test('native worker imports Chinese-path CSV, matches production, exports a real PDF and recovers persisted data after cancellation', async (t) => {
  assert.ok(process.env.PLATFORM_PYTHON, 'Run with the verified local Python runtime');
  const root = path.resolve(
    process.env.PLATFORM_TEST_ROOT ||
      path.join(__dirname, '../../../../构建/当前作业/文件夹自由分析/验证'),
    `分析进程-${randomUUID()}`,
  );
  const folder = path.join(root, '不良'),
    prod = path.join(root, '产量');
  await fs.mkdir(folder, { recursive: true });
  await fs.mkdir(prod);
  await fs.writeFile(
    path.join(folder, '09-19.csv'),
    '日期,工序,班次,不良项,数量,Employee in Charge,Reported By,SN\n2026-09-19,装管,白班,装管反,2,张三,李四,0012\n',
  );
  await fs.writeFile(
    path.join(prod, 'output.csv'),
    '生产日期,工序,班次,产量\n2026-09-19,装管,白班,1000\n',
  );
  let data = M.defaults(),
    columns = { sources: {} },
    revision = 0,
    host;
  const options = {
    controller: {
      hostContext: () => ({
        unlocked: true,
        mode: 'file',
        file: path.join(root, '合成.eap'),
        sessionId: 'synthetic',
      }),
    },
    memory: {
      readModuleState: async (a) => ({
        data:
          a.module === 'analysis-calendar'
            ? require('../domain/analysis-calendar').defaults()
            : a.module === 'home-bi-columns' ? columns : data,
        revision,
        corrupt: false,
      }),
      saveModuleState: async (input) => {
        data = M.validate(input.data);
        revision++;
      },
    },
    profile: root,
    python: process.env.PLATFORM_PYTHON,
    script: path.resolve(__dirname, '../desktop/lab_worker.py'),
    pickFolder: async () => null,
    pickBackup: async () => null,
    saveFile: async (extension) => path.join(root, '分析报告.' + extension),
  };
  host = createAnalysisStudioHost(options);
  t.after(async () => {
    await host.close();
  });
  for (const [kind, id, dir] of [
    ['defects', 'bi', folder],
    ['production', 'output', prod],
  ]) {
    const s = M.freshSource(kind, id);
    s.folder = dir;
    s.unit = 'units';
    const inspected = await host.request({ action: 'inspect', sourceId: id, draft: s });
    Object.assign(s, {
      sheet: inspected.sheet,
      headerRow: inspected.headerRow,
      columns: inspected.columns.map(({ id, label, type }) => ({ id, label, type })),
      schema: inspected.schema,
      mapping: inspected.mapping,
      confirmed: true,
    });
    data.sources.push(s);
    if (kind === 'defects') data.activeSource = id;
    else data.productionSource = id;
    const r = await host.request({ action: 'import', sourceId: id });
    assert.equal(r.errors, 0);
    assert.equal(r.importedRows, 1);
  }
  const query = { ...M.viewDefaults('day'), range: 'latest' };
  const result = await host.request({
    action: 'analyze',
    sourceId: 'bi',
    productionId: 'output',
    period: 'day',
    query,
  });
  assert.equal(result.quantity, 2);
  assert.equal(result.rate.value, 0.002);
  assert.equal(result.production, 1000);
  const home = await host.home({
    query: {
      start: '2026-09-19',
      end: '2026-09-19',
      grain: 'day',
      pageSize: 10,
      page: 1,
      filters: {},
    },
    preference: {},
  });
  assert.equal(home.channel, 'studio');
  assert.equal(home.quantity, result.quantity);
  assert.equal(home.unitLabel, '件');
  assert.equal(home.rows[0].employee, '张三');
  assert.equal(home.rows[0].reporter, '李四');
  assert.equal(home.rate, null, 'homepage does not infer a rate without matched production');
  const reporterColumn = data.sources[0].mapping.reporter;
  columns = { sources: { bi: { process: reporterColumn } } };
  const reassigned = await host.home({
    query: { start: '2026-09-19', end: '2026-09-19', grain: 'day', filters: {} },
    preference: {},
    biFilter: { field: 'process', value: '李四' },
  });
  assert.equal(reassigned.homeFields.effective.process, reporterColumn);
  assert.equal(reassigned.rows[0].process, '李四');
  assert.equal(reassigned.quantity, home.quantity);
  assert.equal(reassigned.rows[0].reporter, '李四');
  const outside = await host.home({
    query: { start: '2026-11-01', end: '2026-11-02', grain: 'day', filters: {} },
    preference: {},
  });
  assert.equal(outside.state, 'out-of-range');
  assert.equal(outside.availableRowCount, 1);
  data.report.charts = [
    {
      id: 'chart',
      sourceId: 'bi',
      productionId: 'output',
      period: 'day',
      query,
      title: '{日期}{工序}失效人员',
      type: 'bar',
      dimension: 'employee',
      metric: 'quantity',
      defect: '装管反',
    },
  ];
  const snapshot = await host.request({ action: 'reportData' }),
    plan = A.compose(snapshot.charts, data.report, { title: snapshot.title });
  const exported = await host.request({
    action: 'export',
    format: 'pdf',
    snapshot: { revision: snapshot.revision, signature: snapshot.signature },
    pages: plan.pages,
  });
  assert.ok(exported.bytes > 5000);
  assert.equal(
    (await fs.readFile(path.join(root, '分析报告.pdf'))).subarray(0, 5).toString(),
    '%PDF-',
  );
  await host.request({ action: 'cancel' });
  const recovered = await host.request({
    action: 'analyze',
    sourceId: 'bi',
    productionId: 'output',
    period: 'day',
    query,
  });
  assert.equal(recovered.quantity, 2);
  assert.equal(recovered.rate.value, 0.002);
  const duplicate = await host.request({ action: 'import', sourceId: 'bi' });
  assert.equal(duplicate.importedRows, 0);
  await host.close();
  host = createAnalysisStudioHost(options);
  assert.equal(
    (
      await host.request({
        action: 'analyze',
        sourceId: 'bi',
        productionId: 'output',
        period: 'day',
        query,
      })
    ).quantity,
    2,
  );
});
