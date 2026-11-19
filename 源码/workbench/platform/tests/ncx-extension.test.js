'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm');
const crypto = require('node:crypto').webcrypto;
const source = fs.readFileSync(
  path.join(__dirname, '../integrations/ncx-extension/platform-control.js'),
  'utf8',
);
function runtime() {
  const state = {
      platformBridge: { enabled: true, schedule: true, time: '00:00', lastAttemptDay: '' },
    },
    events = {},
    sent = [],
    downloads = [];
  const chrome = {
    storage: {
      local: {
        get: async (key) => (typeof key === 'string' ? { [key]: state[key] } : { ...state }),
        set: async (data) => Object.assign(state, data),
      },
    },
    alarms: {
      get: async () => null,
      create: async () => {},
      clear: async () => {},
      onAlarm: { addListener: (f) => (events.alarm = f) },
    },
    runtime: {
      getURL: (name) => 'chrome-extension://synthetic/' + name,
      onMessage: { addListener: (f) => (events.message = f) },
      onStartup: { addListener() {} },
      onInstalled: { addListener() {} },
    },
    tabs: {
      query: async () => [{ id: 1, url: 'https://app.powerbi.com/groups/me/reports/test/page' }],
      sendMessage: async (...args) => {
        sent.push(args);
        return { ok: true };
      },
    },
    downloads: {
      download: async (data) => {
        downloads.push(data);
        return 2;
      },
      search: async () => [{ state: 'complete' }],
    },
  };
  const context = vm.createContext({
    chrome,
    URL,
    crypto,
    Date,
    NCX: {
      loadSettings: async () => ({
        platformBridge: true,
        reportUrl: 'https://app.powerbi.com/groups/me/reports/test/page',
      }),
      ymd: (d) => d.toISOString().slice(0, 10),
      pad: (n) => String(n).padStart(2, '0'),
    },
    setTimeout: (f) => {
      queueMicrotask(f);
      return 1;
    },
    Promise,
    Error,
  });
  vm.runInContext(source, context);
  return { bridge: vm.runInContext('NCXBridge', context), state, events, sent, downloads, chrome };
}
test('export receipt only follows the exact completed filename and preserves explicit verification state', async () => {
  const r = runtime(),
    run = r.bridge.arm(
      {
        start: '2026-10-29',
        end: '2026-10-29',
        source: 'https://app.powerbi.com/groups/me/reports/test/page',
        filterVerified: true,
        filters: { floors: ['BK_5F'], connectors: ['MPO-MPO'] },
      },
      { tab: { id: 1, url: 'https://app.powerbi.com/groups/me/reports/test/page' } },
    );
  await assert.rejects(
    r.bridge.receipt(run, { id: 9, state: 'in_progress', filename: 'NCX_' + run.runId + '.xlsx' }),
    /完成/,
  );
  assert.equal(r.downloads.length, 0);
  const proof = await r.bridge.receipt(run, {
    id: 9,
    state: 'complete',
    filename: 'C:/synthetic/NCX_' + run.runId + '.xlsx',
  });
  assert.equal(proof.downloadComplete, true);
  assert.equal(proof.filterVerified, true);
  assert.equal(proof.period.start, '2026-10-29');
  assert.equal(r.downloads.length, 1);
  assert.match(r.downloads[0].filename, /_complete\.json$/);
  assert.ok(r.downloads[0].url.startsWith('data:application/json;'));
});
test('download recognition rejects other origins and arming rejects another report/date', () => {
  const { bridge } = runtime();
  assert.equal(
    bridge.isReportDownload({ url: 'https://app.powerbi.com.evil.test/data.xlsx' }),
    false,
  );
  assert.equal(bridge.isReportDownload({ url: 'blob:https://app.powerbi.com/synthetic' }), true);
  assert.throws(() =>
    bridge.arm(
      { start: '2026-10-29', end: '2026-10-28', source: 'https://app.powerbi.com/report' },
      { tab: { url: 'https://app.powerbi.com/report' } },
    ),
  );
  assert.throws(() =>
    bridge.arm(
      { start: '2026-10-29', end: '2026-10-29', source: 'https://app.powerbi.com/a' },
      { tab: { url: 'https://app.powerbi.com/b' } },
    ),
  );
});
test('scheduled attempts run at most once per local day and never open another tab', async () => {
  const r = runtime();
  await r.events.alarm({ name: 'bk-mpo-export-check' });
  await r.events.alarm({ name: 'bk-mpo-export-check' });
  assert.equal(r.sent.length, 1);
  assert.equal(r.sent[0][1].type, 'ncx-scheduled-run');
  assert.equal(r.state.platformBridgeResult.ok, true);
  r.state.platformBridge.enabled = false;
  await r.events.alarm({ name: 'bk-mpo-export-check' });
  assert.equal(r.sent.length, 1);
});
test('two report tabs cause a clear failure rather than a guessed export', async () => {
  const r = runtime();
  r.chrome.tabs.query = async () => [
    { id: 1, url: 'https://app.powerbi.com/groups/me/reports/test/page' },
    { id: 2, url: 'https://app.powerbi.com/groups/me/reports/test/page' },
  ];
  await r.events.alarm({ name: 'bk-mpo-export-check' });
  assert.equal(r.sent.length, 0);
  assert.equal(r.state.platformBridgeResult.ok, false);
  assert.match(r.state.platformBridgeResult.message, /一个/);
});

test('legacy background listener leaves the integration message channel to its own handler', () => {
  const listeners = [];
  const context = vm.createContext({
    importScripts() {},
    chrome: {
      downloads: { onDeterminingFilename: { addListener() {} }, onChanged: { addListener() {} } },
      runtime: { onMessage: { addListener: (fn) => listeners.push(fn) } },
      action: { onClicked: { addListener() {} } },
    },
  });
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '../integrations/ncx-extension/background.js'), 'utf8'),
    context,
  );
  let replies = 0;
  assert.equal(
    listeners[0]({ type: 'ncx-bridge-run' }, {}, () => replies++),
    undefined,
  );
  assert.equal(replies, 0);
});
