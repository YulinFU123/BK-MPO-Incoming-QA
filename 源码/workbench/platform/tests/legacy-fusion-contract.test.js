'use strict';

// Static/call-shape contract only. No Electron process, real vault, password
// lookup or original-source mutation takes place in this test.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const fixture = require('../fixtures/synthetic.json');

const platform = path.resolve(__dirname, '..');
// Offline layout: resources/app/legacy/. The env override still supports a
// flat development checkout where preload.js sits next to the platform folder.
const legacyRoot = process.env.LEGACY_SOURCE_ROOT ? path.resolve(process.env.LEGACY_SOURCE_ROOT) : path.resolve(platform, '../legacy');
const legacyPreload = path.join(legacyRoot, 'preload.js');
const fusionPreload = path.join(platform, 'desktop/legacy-preload.js');
const fusionHost = path.join(platform, 'desktop/legacy-host.js');
const SYNC_METHODS = ['save', 'backup', 'lock'];
const EVENT_METHODS = ['onLockRequested', 'onCloseRequested', 'onWindowChanged'];
const EXPECTED_METHODS = [
  'status', 'setup', 'unlock', 'save', 'backup', 'changePassword', 'restore',
  'readBackup', 'lock', 'activity', 'onLockRequested', 'onCloseRequested',
  'closeReady', 'windowState', 'windowMode', 'windowControl', 'onWindowChanged', 'setTimeout'
];

function requiredSource(file) {
  assert.ok(fs.existsSync(file), `完整融合桥接文件缺失：${path.relative(platform, file)}`);
  return fs.readFileSync(file, 'utf8');
}

function capturePreload(file) {
  const surfaces = new Map();
  const calls = [];
  const listeners = new Map();
  const reply = Object.freeze({ ok: true, value: 'synthetic-sync-reply' });
  const ipcRenderer = {
    invoke(channel, ...args) { calls.push({ kind: 'invoke', channel, args }); return Promise.resolve(reply); },
    sendSync(channel, ...args) { calls.push({ kind: 'sendSync', channel, args }); return reply; },
    send(channel, ...args) { calls.push({ kind: 'send', channel, args }); },
    on(channel, handler) { calls.push({ kind: 'on', channel, args: [] }); listeners.set(channel, handler); return ipcRenderer; },
    removeListener(channel, handler) { if (listeners.get(channel) === handler) listeners.delete(channel); }
  };
  const electron = { contextBridge: { exposeInMainWorld(name, value) { surfaces.set(name, value); } }, ipcRenderer };
  vm.runInNewContext(requiredSource(file), {
    require(name) {
      assert.ok(['electron', 'electron/renderer'].includes(name), 'preload 契约应只加载受限 Electron 桥接');
      return electron;
    },
    process: { argv: [], versions: { electron: '45.0.0' } },
    console, setTimeout, clearTimeout
  }, { filename: file, timeout: 1000 });
  const desktop = surfaces.get('desktop');
  assert.ok(desktop && typeof desktop === 'object', 'preload 必须提供原页面使用的 desktop 对象');
  return { desktop, calls, listeners, reply };
}

function argumentsFor(method, callback = () => {}) {
  const state = structuredClone(fixture.legacyState);
  const argumentsByMethod = {
    setup: ['Synthetic-contract-password!', state], unlock: ['Synthetic-contract-password!'],
    save: [state], backup: [state], changePassword: ['old-synthetic-password', 'new-synthetic-password'],
    restore: ['synthetic-encrypted-envelope', 'synthetic-password'],
    readBackup: ['synthetic-encrypted-envelope', 'synthetic-password'],
    windowMode: ['workspace'], windowControl: ['maximize'], setTimeout: [10],
    onLockRequested: [callback], onCloseRequested: [callback], onWindowChanged: [callback]
  };
  return argumentsByMethod[method] || [];
}

test('fusion preload implements every desktop method used by the original business modules', () => {
  const old = capturePreload(legacyPreload);
  assert.deepEqual(Object.keys(old.desktop).sort(), EXPECTED_METHODS.slice().sort(), '原桌面契约发生变化时应重新审计继承清单');
  const used = new Set();
  for (const name of fs.readdirSync(legacyRoot).filter(name => name.endsWith('.js'))) {
    const source = fs.readFileSync(path.join(legacyRoot, name), 'utf8');
    for (const match of source.matchAll(/window\.desktop\.(\w+)/g)) used.add(match[1]);
  }
  const modern = capturePreload(fusionPreload);
  for (const method of new Set([...EXPECTED_METHODS, ...used])) {
    assert.equal(typeof modern.desktop[method], 'function', `遗漏原功能 API：desktop.${method}`);
  }
});

test('fusion preload preserves synchronous save, backup and lock responses required by original renderer', () => {
  const modern = capturePreload(fusionPreload);
  for (const method of SYNC_METHODS) {
    const before = modern.calls.length;
    const response = modern.desktop[method](...argumentsFor(method));
    assert.ok(response && typeof response.then !== 'function', `${method} 必须同步返回结果，不能返回未等待的 Promise`);
    assert.equal(response.ok, modern.reply.ok);
    assert.equal(response.value, modern.reply.value);
    assert.ok(modern.calls.slice(before).some(call => call.kind === 'sendSync'), `${method} 缺少同步宿主通道`);
  }
});

test('every channel emitted by the fusion preload is declared by its host', async () => {
  const modern = capturePreload(fusionPreload);
  const hostSource = requiredSource(fusionHost);
  for (const method of EXPECTED_METHODS) {
    const before = modern.calls.length;
    await modern.desktop[method](...argumentsFor(method));
    assert.ok(modern.calls.length > before, `${method} 不能只是无宿主实现的占位函数`);
  }
  const channels = new Set(modern.calls.map(call => call.channel));
  for (const channel of channels) {
    assert.equal(typeof channel, 'string');
    assert.ok(channel.length && hostSource.includes(channel), `宿主没有声明原功能通道：${channel}`);
  }
});

test('fusion preload event subscriptions do not expose privileged Electron event objects', () => {
  const modern = capturePreload(fusionPreload);
  const privilegedEvent = { sender: 'synthetic-privileged-sender', reply() {} };
  const windowState = { maximized: true, mode: 'workspace' };
  for (const method of EVENT_METHODS) {
    const received = [];
    const before = modern.calls.length;
    modern.desktop[method]((...args) => received.push(args));
    const subscription = modern.calls.slice(before).find(call => call.kind === 'on');
    assert.ok(subscription, `${method} 需要实际订阅宿主通知`);
    const handler = modern.listeners.get(subscription.channel);
    assert.equal(typeof handler, 'function');
    handler(privilegedEvent, windowState);
    assert.equal(received.length, 1);
    assert.equal(received[0].includes(privilegedEvent), false);
    if (method === 'onWindowChanged') assert.deepEqual(JSON.parse(JSON.stringify(received[0][0])), windowState);
    else assert.equal(received[0].length, 0);
  }
});
