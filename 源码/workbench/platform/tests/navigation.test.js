'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path');
const navigation = require('../desktop/app/navigation-model');

test('BI workbench opens analysis directly while old links and source restrictions still apply', () => {
  assert.deepEqual(navigation.resolveView('bi-center', 'bi'), {
    view: 'analysis-studio',
    analysisTab: 'analysis',
  });
  assert.deepEqual(navigation.resolveView('analysis-studio', 'bi', 'sources'), {
    view: 'analysis-studio',
    analysisTab: 'sources',
  });
  assert.deepEqual(navigation.resolveView('bi-daily', 'bi'), {
    view: 'bi-daily',
    analysisTab: null,
  });
  assert.deepEqual(navigation.resolveView('bi-center', 'records'), {
    view: 'home',
    analysisTab: null,
  });
});
test('back retraces actual pages and BI periods without looping on duplicate destinations', () => {
  const trail = navigation.createBackTrail();
  trail.visit('home');
  assert.equal(trail.peek(), null);
  trail.visit('analysis-studio');
  trail.syncTab('day');
  for (const tab of ['day', 'week', 'month', 'month']) trail.visit('analysis-studio', tab);
  trail.visit('settings-hub');
  assert.deepEqual(trail.back(), { view: 'analysis-studio', analysisTab: 'month' });
  assert.equal(trail.back().analysisTab, 'week');
  assert.equal(trail.back().analysisTab, 'day');
  assert.equal(trail.back().view, 'home');
  assert.equal(trail.back(), null);
});
test('restored subpage can return home; history is bounded and cannot cross a workspace reset', () => {
  const trail = navigation.createBackTrail();
  trail.visit('overview');
  assert.equal(trail.peek().view, 'home');
  for (let n = 0; n < 70; n++) trail.visit(n % 2 ? 'data' : 'home');
  let count = 0;
  while (trail.back()) count++;
  assert.equal(count, 50);
  trail.visit('analysis-studio', 'week');
  trail.clear();
  assert.equal(trail.back(), null);
  trail.visit('home');
  assert.equal(trail.peek(), null);
});
const common = require('../desktop/legacy-common-actions');
const { BI_PAGES } = require('../desktop/bi-host');
const original = [
  'legacy-entry',
  'legacy-records',
  'legacy-followup',
  'legacy-analysis',
  'legacy-settings',
  'legacy-security',
  'legacy-appearance',
  ...BI_PAGES.map((page) => 'bi-' + page),
  'overview',
  'data',
  'import',
  'security',
];

test('workflow directory preserves every one of the original 25 destinations and all 14 BI pages', () => {
  assert.equal(new Set(original).size, 25);
  assert.equal(BI_PAGES.length, 14);
  for (const id of original) assert.ok(navigation.getRoute(id), id);
  assert.equal(navigation.routes.length, 33);
  assert.equal(new Set(navigation.routes.map((route) => route.id)).size, 33);
  assert.equal(navigation.primaryFor('label-studio'), 'data-center');
  assert.equal(navigation.primaryFor('quality-check'), 'data-center');
  assert.deepEqual(Object.values(navigation.biSections).sort(), [...BI_PAGES].sort());
  assert.equal(Object.keys(navigation.legacySections).length, 7);
});
test('seven primary entries follow the daily workflow and every child has a reachable parent', () => {
  assert.deepEqual(navigation.primary, [
    'home',
    'legacy-entry',
    'legacy-records',
    'legacy-followup',
    'analysis-hub',
    'data-center',
    'settings-hub',
  ]);
  for (const route of navigation.routes)
    assert.ok(navigation.primary.includes(navigation.primaryFor(route.id)), route.id);
  assert.equal(navigation.primaryFor('bi-trends'), 'analysis-hub');
  assert.equal(navigation.primaryFor('legacy-settings'), 'data-center');
  assert.equal(navigation.primaryFor('security'), 'settings-hub');
  assert.deepEqual(navigation.peers('home'), []);
});
test('global function lookup keeps route and action identities, Chinese search, and safe unknown results', () => {
  const all = navigation.search('');
  assert.equal(all.length, 42);
  for (const id of original)
    assert.ok(
      all.some((item) => item.kind === 'route' && item.id === id),
      id,
    );
  assert.ok(navigation.search('兼容 备份').some((item) => item.id === 'backup-records'));
  assert.ok(navigation.search('XLSX').some((item) => item.id === 'import-record-xlsx'));
  assert.deepEqual(navigation.search('__not_a_function__'), []);
  for (const id of ['__proto__', 'constructor', 'unknown']) {
    assert.equal(navigation.getRoute(id), null);
    assert.equal(navigation.getAction(id), null);
  }
  assert.ok(Object.isFrozen(navigation.routes) && Object.isFrozen(navigation.routes[0]));
});
test('the shell toolbar has no business-command slots; page-local import and drill entries remain', () => {
  const html = fs.readFileSync(path.join(__dirname, '../desktop/app/index.html'), 'utf8');
  const toolbar = html.match(/<header class="toolbar">([\s\S]*?)<\/header>/)[1];
  assert.doesNotMatch(toolbar, /toolbarImport|toolbarSecondary|data-start-import|data-destination/);
  assert.match(toolbar, /id="lockButton"/);
  for (const id of ['overviewView', 'dataView', 'importView']) {
    const section = html.split('id="' + id + '"')[1].split('</section>')[0];
    assert.match(section, /data-start-import/, id);
  }
  for (const key of ['batch-scan', 'import-record-xlsx', 'export-records', 'export-followup', 'export-analysis'])
    assert(navigation.getAction(key), key + ' remains in function search');
});
test('common actions reuse real original controls and preserve the hidden compatibility backup', () => {
  const root = path.resolve(__dirname, '../..');
  const originalPage = path.join(root, 'index.html');
  const html = fs.readFileSync(
    fs.existsSync(originalPage) ? originalPage : path.join(root, 'legacy/index.html'),
    'utf8',
  );
  for (const [action, id] of Object.entries(common.elements)) {
    assert.ok(html.includes(`id="${id}"`), action + ':' + id);
    let clicks = 0;
    const document = {
      getElementById: (key) => {
        assert.equal(key, id);
        return {
          click() {
            clicks++;
          },
        };
      },
    };
    assert.equal(common.activate(document, action).requested, true);
    assert.equal(clicks, 1);
  }
  assert.equal(common.elements['record-backup'], 'sideBackup');
  for (const action of navigation.actions)
    if (action.action !== 'quantity-import')
      assert.equal(navigation.legacySections[action.route], common.sections[action.action]);
});
test('common action adapter rejects destructive names, unavailable controls and unfinished modals', () => {
  let clicks = 0;
  const element = {
    click() {
      clicks++;
    },
  };
  for (const action of ['delete', 'save', 'restore', '__proto__', 'constructor', 'xlsxFile'])
    assert.throws(() => common.activate({ getElementById: () => element }, action));
  assert.throws(() => common.activate({ getElementById: () => null }, 'import-xlsx'));
  assert.throws(() =>
    common.activate({ getElementById: () => ({ ...element, disabled: true }) }, 'import-xlsx'),
  );
  assert.throws(() =>
    common.activate(
      { getElementById: () => element, querySelector: () => ({ open: true }) },
      'record-backup',
    ),
  );
  assert.equal(clicks, 0);
});
