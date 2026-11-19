'use strict';
// Errors in the BI panel must offer a jump to the page that fixes them.
const test = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm');
const uiDir = path.resolve(__dirname, '../../bi-ui');

function fakeNode(tag = 'div') {
  const node = {
    tagName: tag.toUpperCase(),
    nodeType: 1,
    children: [],
    attrs: {},
    style: {},
    className: '',
    value: '',
    textContent: '',
    innerHTML: '',
    scrollTop: 0,
    scrollHeight: 0,
    _listeners: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener(name, fn) { (this._listeners[name] ||= []).push(fn); },
    click() { for (const fn of this._listeners.click || []) fn(); },
    append(...kids) {
      for (const kid of kids) {
        if (kid == null || kid === false) continue;
        if (Array.isArray(kid)) this.append(...kid);
        else this.children.push(kid.nodeType ? kid : { nodeType: 3, textContent: String(kid) });
      }
    },
    querySelector() { return null; },
  };
  return node;
}

function loadCore(withPages = false) {
  const document = {
    createElement: (tag) => fakeNode(tag),
    createTextNode: (text) => ({ nodeType: 3, textContent: String(text) }),
    querySelector: () => fakeNode(),
    body: fakeNode('body'),
    addEventListener() {},
  };
  const context = {
    document,
    window: { addEventListener() {}, bi: {} },
    fetch: async () => ({ json: async () => ({}) }),
    navigator: {},
    setInterval: () => 0,
    clearInterval() {},
    setTimeout: () => 0,
    clearTimeout() {},
    setImmediate,
    console,
    structuredClone,
    Number,
    String,
    Object,
    Array,
    JSON,
    Math,
    Date,
  };
  const file = path.join(uiDir, 'core.js');
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  if (withPages) {
    const pages = path.join(uiDir, 'pages1.js');
    vm.runInContext(fs.readFileSync(pages, 'utf8'), context, { filename: pages });
  }
  return context;
}

function allNodes(node, out = []) {
  out.push(node);
  for (const kid of node.children || []) if (kid.nodeType === 1) allNodes(kid, out);
  return out;
}

function config(overrides = {}) {
  return {
    paths: { input: '每日原表', history: '历史数据库', output: '分析结果', pattern: '*.xlsx' },
    P: {
      '看板方案': '每日看板', '月度风险方案': '全部工序', '人员筛选模式': '不筛选',
      '专项不良项目': '', '目标不良率': '0.15%', '预警不良率': '0.20%',
      ...(overrides.P || {}),
    },
    schemes: [{ name: '每日看板', enabled: true }, { name: '全部工序', enabled: true }],
    people: [],
    defects: {},
    charts: [],
    chk: {},
    fieldmap: overrides.fieldmap || {
      责任员工: { role: '责任员工' }, 责任工序: { role: '责任工序' },
      不良代码: { role: '不良代码' }, 业务日期: { role: '业务日期' },
    },
  };
}

test('engine errors map to the page that fixes them', () => {
  const c = loadCore();
  const run = (text) => vm.runInContext(`pageForError(${JSON.stringify(text)})`, c);
  const fieldmapError = '【字段映射】缺少必要用途：责任员工、责任工序、不良代码，请在面板【数据与字段】里选择';
  assert.equal(run(fieldmapError).page, 'data');
  assert.equal(run(fieldmapError).label, '数据与字段');
  assert.equal(run('没有数据：请把原表放进文件夹【每日原表】').page, 'home');
  assert.equal(run('全局筛选后没有数据，请检查面板里的全局筛选规则/不良类型/人员名单').page, 'schemes');
  assert.equal(run('数量字段【QTY】有 3 行为空、非数字或负数；请修正原表').page, 'data');
  assert.equal(run('看板方案【X】不存在或未启用').page, 'dash');
  assert.equal(run('人员筛选模式=只看，但人员名单是空的').page, 'people');
  assert.equal(run('没有填写每日检查量：只能看 pcs 与占比，无法计算不良率').page, 'chk');
  assert.equal(run('发现 2 个新增不良代码，建议到【不良类型】确认归类').page, 'defects');
  assert.equal(run('报表核心页面【01_每日驾驶舱】生成失败').page, 'charts');
  assert.equal(run('某种未知错误').page, 'home');
});

test('a failed run appears as a jumpable bad check item', () => {
  const c = loadCore();
  vm.runInContext(`S.cfg = ${JSON.stringify(config())}; S.run = { running: false, n: 0, log: [], error: '【字段映射】缺少必要用途：责任员工、责任工序、不良代码，请在面板【数据与字段】里选择', result: null }; S.scan = { rows: 935 };`, c);
  const items = vm.runInContext('checks()', c);
  const failed = items.find((x) => x.fix === true);
  assert.ok(failed, '生成失败应列为检查项');
  assert.equal(failed.level, 'bad');
  assert.equal(failed.page, 'data');
  assert.match(failed.text, /上次生成失败/);
  // It is informational: must not be treated as a blocking config item.
  const blocking = items.filter((x) => x.level === 'bad' && x.page !== 'home' && !x.fix);
  assert.equal(blocking.length, 0, '失败记录本身不应阻止重试');
});

test('field mapping is checked even when the scan has no rows', () => {
  const c = loadCore();
  vm.runInContext(`S.cfg = ${JSON.stringify(config({ fieldmap: {} }))}; S.run = { running: false, n: 0, log: [], error: null, result: null }; S.scan = null;`, c);
  const items = vm.runInContext('checks()', c);
  const mapping = items.find((x) => x.page === 'data' && /字段映射缺少必要用途/.test(x.text));
  assert.ok(mapping, '扫描无数据时也必须报字段映射缺失');
  assert.equal(mapping.level, 'bad');
});

test('error log rows carry a jump link to the right page', () => {
  const c = loadCore();
  const box = fakeNode();
  c.__box = box;
  vm.runInContext(`S.run = { running: false, n: 0, log: ['06:42:45 ✗ 【字段映射】缺少必要用途：责任员工、责任工序、不良代码，请在面板【数据与字段】里选择'], error: null, result: null }; drawRunLog(__box);`, c);
  const row = box.children[0];
  assert.equal(row.className, 'e');
  const link = row.children.find((k) => k.tagName === 'A');
  assert.ok(link, '错误行应带跳转链接');
  assert.equal(link.className, 'log-fix');
  assert.match(link.children.map((k) => k.textContent).join(''), /数据与字段/);
});

test('the failed-run banner renders a clickable jump to 数据与字段', () => {
  const c = loadCore(true);
  const error = '【字段映射】缺少必要用途：责任员工、责任工序、不良代码，请在面板【数据与字段】里选择';
  vm.runInContext(`S.cfg = ${JSON.stringify(config())}; S.scan = null; S.last = null; S.page = 'home'; S.run = { running: false, n: 0, log: [], error: ${JSON.stringify(error)}, result: null };`, c);
  const root = fakeNode();
  c.__root = root;
  c.__jumps = [];
  c.go = (p) => { c.__jumps.push(p); };
  vm.runInContext('PAGES.home(__root)', c);
  const nodes = allNodes(root);
  const banner = nodes.find((n) => typeof n.className === 'string' && n.className.includes('banner bad'));
  assert.ok(banner, '应渲染生成失败横幅');
  const links = allNodes(banner).filter((n) => n.tagName === 'A');
  assert.equal(links.length, 1);
  assert.match(links[0].children.map((k) => k.textContent).join(''), /数据与字段/);
  links[0].click();
  assert.deepEqual(c.__jumps, ['data']);
});

test('the top warning pill jumps to the first blocking page', () => {
  const c = loadCore(true);
  vm.runInContext(`S.cfg = ${JSON.stringify(config({ fieldmap: {} }))}; S.scan = null; S.last = null; S.page = 'home'; S.run = { running: false, n: 0, log: [], error: null, result: null };`, c);
  const root = fakeNode();
  c.__root = root;
  c.__jumps = [];
  c.go = (p) => { c.__jumps.push(p); };
  vm.runInContext('PAGES.home(__root)', c);
  const pill = allNodes(root).find((n) => n.tagName === 'A' && typeof n.className === 'string' && n.className.includes('fix-jump') && n.className.includes('pill'));
  assert.ok(pill, '应渲染可点击的红色提示');
  pill.click();
  assert.equal(c.__jumps.length, 1);
  assert.equal(c.__jumps[0], 'data');
});

test('startRun jumps to the blocking config page instead of retrying blindly', async () => {
  const c = loadCore();
  vm.runInContext(`S.cfg = ${JSON.stringify(config({ fieldmap: {} }))}; S.run = { running: false, n: 0, log: [], error: null, result: null }; S.scan = null; S.page = 'home';`, c);
  c.__jumps = [];
  c.__toasts = [];
  c.go = (p) => { c.__jumps.push(p); };
  c.toast = (msg, kind) => { c.__toasts.push({ msg, kind }); };
  c.api = async () => { throw Error('不应发起生成请求'); };
  c.render = () => {};
  await vm.runInContext('startRun()', c);
  assert.deepEqual(c.__jumps, ['data']);
  assert.equal(c.__toasts.length, 1);
  assert.match(c.__toasts[0].msg, /字段映射/);
});
