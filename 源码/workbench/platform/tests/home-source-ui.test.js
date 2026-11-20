'use strict';
// Pure DOM-model tests of the new presentation branches, not pixel/UI acceptance.
const test = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../desktop/app/home-studio.js'), 'utf8');
const element = (tag, cls, text) => ({
  tag,
  cls,
  text,
  children: [],
  append(...nodes) {
    this.children.push(...nodes);
  },
  replaceChildren(...nodes) {
    this.children = nodes;
  },
});
function render(available = true, dataSourceMode = 'auto', grouping = null) {
  const panels = ['trend', 'comparison', 'issues', 'process', 'owners', 'time', 'records'];
  const elements = Object.fromEntries(
    ['hsMetrics', ...panels.map((x) => 'hsPanel-' + x)].map((x) => [x, element('div')]),
  );
  const clicks = [],
    charts = [], ranks = [],
    tables = [];
  const bi = {
    grouping,
    quantity: 100,
    previousQuantity: null,
    rowCount: 2,
    total: 2,
    page: 1,
    pageSize: 10,
    range: { start: '2026-10-01', end: '2026-10-30' },
    issues: [{ value: '装管反', count: 100 }],
    processes: [{ value: '装管', count: 100 }],
    employees: Array.from({ length: 15 }, (_, x) => ({ value: 'QA-' + x, count: 20 - x })),
    shifts: [],
    rows: [],
    trend: [
      {
        key: '2026-10-29',
        start: '2026-10-29',
        end: '2026-10-29',
        quantity: 100,
        previous: null,
        covered: 1,
        days: 1,
      },
    ],
  };
  vm.runInNewContext(
    source.slice(source.indexOf('  function chartHeight('), source.indexOf('  function drillBI(')) +
      '\nrenderBIData(); if (available) { buildBIPanelChart(report, "trend", 1050, true); buildBIPanelChart(report, "owners", 1050, true); }',
    {
      available, report: { primary: { available }, biSource: bi, recordCount: 5, pending: 2, overdue: 1 },
      getContext: () => ({ dataSourceMode }),
      $: (id) => elements[id],
      node: element,
      button: (text, action, cls) => ({ ...element('button', cls, text), action }),
      model: { panels },
      G: {
        fmt: (n) => (n == null ? '—' : String(n)),
        donut: () => element('donut'),
        ranking: (items, options) => { ranks.push({ items, ...options }); return element('rank'); },
        empty: (text) => element('empty', '', text),
      },
      window: {
        BIFieldLabels: require('../desktop/app/bi-field-labels'),
        ChartSurface: {
          create: (opts) => {
            charts.push(opts);
            return element('chart');
          },
        },
      },
      renderRows: (...args) => tables.push(args),
      drill: (x) => clicks.push(['manual', x]),
      drillBI: (x) => clicks.push(['bi', x]),
      transient: () => ({}),
      refresh() {},
      shift: (date, offset) =>
        new Date(Date.parse(date) + offset * 86400000).toISOString().slice(0, 10),
    },
  );
  return { elements, charts, clicks, tables, ranks };
}
test('BI homepage keeps 100 pcs and 5 manual records on distinct labelled cards and actions', () => {
  const r = render(),
    cards = r.elements.hsMetrics.children;
  const text = (node) => [node.text ?? '', ...(node.children || []).map(text)].join(' ');
  assert.match(text(cards[0]), /BI不良数量.*100.*pcs/);
  assert.match(text(cards[2]), /人工异常记录.*5.*条/);
  assert.ok(!text(r.elements.hsMetrics).includes('105'));
  cards[0].action();
  cards[2].action();
  assert.deepEqual(
    r.clicks.map((x) => x[0]),
    ['bi', 'manual'],
  );
  assert.equal(r.charts[0].unit, 'pcs');
  assert.equal(r.charts[1].series[1].values[0], null);
  assert.ok(r.tables[0][4].columns.some((x) => x[0] === 'employee'));
  assert.equal(r.tables[0][4].columns.find((x) => x[0] === 'quantity')[1], '不良数量');
});
test('unavailable explicit BI renders missing values and does not draw misleading manual charts', () => {
  const r = render(false);
  assert.equal(r.charts.length, 0);
  assert.equal(r.tables.length, 0);
  assert.equal(r.elements.hsMetrics.children[0].children[0].children[1].children[0].text, '—');
  assert.equal(r.elements['hsPanel-trend'].children[0].tag, 'empty');
});
test('explicit BI workspace shows BI metrics only; legacy auto retains separate manual cards', () => {
  const r = render(true, 'bi');
  assert.equal(r.elements.hsMetrics.children.length, 2);
  assert.equal(render().elements.hsMetrics.children.length, 5);
});
test('homepage BI table follows the product type name used by its dropdown and CSV', () => {
  const r = render(true, 'bi', { kind: 'productType' });
  assert.equal(r.tables[0][4].columns.find((x) => x[0] === 'process')[1], '产品类型');
});

test('clicking comparison series requests the matching previous date and a bounded chart', () => {
  const { charts, clicks } = render();
  charts[1].onPoint(1, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(clicks[0])), ['bi', {
    start: '2026-09-29', end: '2026-09-29', previous: true,
  }]);
  assert.ok(charts[1].height >= 200 && charts[1].height <= 360);
});

test('enlarged BI charts grow and keep row drill-down; ranking shows all returned categories', () => {
  const { charts, clicks, ranks } = render();
  assert.equal(charts[2].minimumWidth, 1050);
  assert.ok(charts[2].height > charts[0].height);
  assert.equal(charts[2].compact, false);
  charts[2].onPoint(0, 0);
  const original = ranks.find((x) => x.items.length === 15);
  const enlarged = ranks.at(-1);
  assert.equal(original.limit, 10);
  assert.equal(enlarged.limit, 15);
  enlarged.onSelect('QA-14');
  assert.deepEqual(JSON.parse(JSON.stringify(clicks)), [
    ['bi', { start: '2026-10-29', end: '2026-10-29', previous: false }],
    ['bi', { field: 'employee', value: 'QA-14' }],
  ]);
});

test('linked BI drill-down requests exact clicked bucket and does not mutate homepage filters', async () => {
  const dialogNode = { ...element('dialog'), open: true };
  const request = [];
  const contexts = [];
  const report = { scope: { start: '2026-09-01', end: '2026-09-30', filters: { process: 'MPO' } },
    biSource: { range: { start: '2026-10-01', end: '2026-10-31' }, sharedAnalysis: { filters: [{ label: '班次' }] } } };
  const original = structuredClone(report);
  vm.runInNewContext(source.slice(source.indexOf('  function drillBI('), source.indexOf('  async function exportBIRows(')) +
    "\ndrillBI({ field: 'issue', value: '装管反', start: '2026-10-05', end: '2026-10-11' });", {
    report, node: element, sourcePreference: { channel: 'studio' }, detailTicket: 0, structuredClone,
    dialog(title, side) { assert.equal(side, true); return dialogNode; },
    renderDrillContext: (...args) => contexts.push(args),
    api: async (...args) => {
      request.push(args);
      return { biSource: { state: 'empty', message: '没有明细' } };
    },
    G: { empty: (text) => element('p', '', text) },
    window: { BIFieldLabels: require('../desktop/app/bi-field-labels') },
  });
  await Promise.resolve();
  assert.deepEqual(report, original);
  assert.deepEqual(JSON.parse(JSON.stringify(request[0])), ['homeOverview', {
    query: { start: '2026-10-05', end: '2026-10-11', filters: { process: 'MPO' }, page: 1, pageSize: 10 },
    preference: { channel: 'studio', mode: 'bi' }, biFilter: { field: 'issue', value: '装管反' },
    biRange: { start: '2026-10-05', end: '2026-10-11' },
  }]);
  assert.equal(contexts[0][2].selection, '不良项：装管反');
  assert.deepEqual(contexts[0][2].applied, [{ label: '班次' }]);
});
