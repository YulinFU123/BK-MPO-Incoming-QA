'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict');
const model = require('../domain/guides'),
  navigation = require('../desktop/app/navigation-model');
const state = require('../domain/module-state');
const pictures = require('../desktop/app/guide-pictures');
const crops = require('../desktop/app/guide-crops');
const createClient = require('../desktop/app/module-state-client');
const createUI = require('../desktop/app/guide-ui')(model, createClient);

test('all 33 pages, 9 existing actions and 10 specific tools have real read-only instructions', () => {
  const expected = [
    ...navigation.routes.map((x) => x.id),
    ...navigation.actions.map((x) => 'action:' + x.id),
  ];
  assert.equal(model.all.length, 52);
  assert.equal(new Set(model.all.map((x) => x.id)).size, 52);
  for (const id of expected) assert.ok(model.get(id), id);
  for (const guide of model.all) {
    assert.ok(guide.steps.length >= 3);
    for (const step of guide.steps) assert.ok(step.title.trim() && step.body.trim(), guide.id);
  }
  assert.ok(model.search('BI 日报').some((x) => x.id === 'bi-daily'));
  assert.equal(model.search('__nothing__').length, 0);
  assert.equal(model.get('__proto__'), null);
  assert.ok(Object.isFrozen(model.get('home').steps));
});
test('the workbench guide opens the illustrated reader in BI, without removing the separate live import walkthrough', () => {
  const fs = require('node:fs'), path = require('node:path');
  const read = file => fs.readFileSync(path.join(__dirname, '../desktop/app', file), 'utf8');
  assert.match(read('renderer.js'), /guideButton\.onclick = \(\) => guideUI\.open\(\)/);
  assert.match(read('analysis-source-ui.js'), /btn\('导入实操引导', onImportGuide\)/);
  const includes = [...read('index.html').matchAll(/<script src="([^"]+)" defer>/g)].map(m => m[1]);
  for (const file of ['guide-manual.js','guide-quality.js','guide-tools.js','guide-bi.js','guide-crops.js','guide-pictures.js'])
    assert(includes.indexOf(file) >= 0 && includes.indexOf(file) < includes.indexOf('guide-ui.js'), file);
});

test('progress is bounded to actual steps and rejects business payloads, future formats and unsafe IDs', () => {
  const a = { scope: 'global', module: 'guides' };
  assert.deepEqual(state.validate(a, {}), model.defaults());
  const original = model.defaults();
  const v = model.mark(original, 'bi-daily', 'paused', 2);
  assert.deepEqual(original, model.defaults());
  assert.deepEqual(v.progress['bi-daily'], { status: 'paused', step: 2 });
  for (const bad of [
    { ...v, version: 2 },
    { ...v, records: [] },
    { ...v, progress: [] },
    { ...v, progress: { unknown: { status: 'paused', step: 0 } } },
    { ...v, progress: { home: { status: 'paused', step: 999 } } },
    { ...v, progress: { home: { status: 'completed', step: -1 } } },
    { ...v, progress: { home: { status: 'new', step: 0 } } },
    { ...v, progress: { home: { status: 'paused', step: 0, sn: 'private' } } },
  ])
    assert.throws(() => state.validate(a, bad));
  assert.throws(() => model.mark(v, '__proto__', 'paused', 0));
  assert.throws(() => state.address({ scope: 'module', module: 'guides' }));
});

function harness(options = {}) {
  const nodes = [],
    calls = [],
    lifecycle = [],
    errors = [];
  let releaseRead;
  let stored = structuredClone(options.initial || model.defaults()),
    revision = options.initial ? 1 : 0;
  const control = { failSave: false, corrupt: !!options.corrupt };
  class Node {
    constructor(tag) {
      this.tagName = tag;
      this.children = [];
      this.listeners = {};
      this.style = {};
      this.value = '';
      nodes.push(this);
    }
    append(...children) {
      this.children.push(...children);
    }
    replaceChildren(...children) {
      this.children = children;
    }
    setAttribute(key, value) {
      this[key] = value;
    }
    addEventListener(name, fn) {
      this.listeners[name] = fn;
    }
    showModal() {
      this.open = true;
    }
    close() {
      this.open = false;
      this.listeners.close?.();
    }
    focus() {
      doc.focused = this;
    }
    click() {
      if (!this.disabled) return this.onclick?.();
    }
  }
  const doc = {
    createElement: (tag) => new Node(tag),
    querySelector: () => nodes.find((n) => n.tagName === 'dialog' && n.open),
  };
  doc.body = new Node('body');
  const api = async (method, value) => {
    calls.push({ method, value: structuredClone(value) });
    if (method === 'readModuleState') {
      if (value.module === 'guides')
        return { data: options.legacy || model.defaults(), revision: 1, corrupt: false };
      if (options.deferRead)
        await new Promise((resolve) => {
          releaseRead = resolve;
        });
      return {
        data: structuredClone(stored),
        revision,
        corrupt: control.corrupt,
        warning: control.corrupt ? 'synthetic corrupt progress' : '',
      };
    }
    assert.equal(value.address.scope, 'global');
    assert.equal(value.address.module, 'guides-v3');
    assert.equal(value.expectedRevision, revision);
    if (method === 'saveModuleState') {
      if (control.failSave) throw Error('synthetic save failure');
      stored = model.validate(value.data);
    } else if (method === 'resetModuleState') {
      stored = model.defaults();
      control.corrupt = false;
    } else assert.fail('guide attempted an unrelated operation: ' + method);
    revision++;
    return { data: structuredClone(stored), revision, corrupt: false };
  };
  const ui = createUI({
    api,
    beforeOpen: async () => lifecycle.push('hidden'),
    afterClose: () => lifecycle.push('restored'),
    context: () => 'legacy-entry',
    onError: (error) => errors.push(error.message),
    document: doc,
  });
  const all = () => {
    const walk = (n) => [n, ...n.children.flatMap(walk)];
    return walk(doc.body);
  };
  const button = (text) => all().find((n) => n.tagName === 'button' && n.textContent === text);
  return {
    ui,
    doc,
    nodes,
    calls,
    lifecycle,
    errors,
    control,
    all,
    button,
    state: () => structuredClone(stored),
    releaseRead: () => releaseRead(),
    externalChange: (value) => {
      stored = structuredClone(value);
      revision++;
    },
  };
}
test('import demonstration advances, pauses, restarts, and only writes guide progress', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness();
  await h.ui.open('analysis-studio', { autoplay: true });
  const preview = h.all().find((node) => node.className === 'guide-demo-action');
  assert.equal(h.all().find(n => n.tagName === 'img').alt.includes(pictures.get('analysis-studio', 0).label), true);
  assert.equal(preview.textContent, '确认文件可打开');
  t.mock.timers.tick(8500);
  assert.equal(preview.textContent, '识别最新文件表头');
  h.button('暂停演示').click();
  t.mock.timers.tick(17000);
  assert.equal(preview.textContent, '识别最新文件表头');
  h.button('自动演示').click();
  t.mock.timers.tick(8500);
  assert.equal(preview.textContent, '确认映射并保存来源');
  h.button('退出引导').click();
  t.mock.timers.tick(17000);
  await h.ui.flush();
  assert.deepEqual(h.state().progress['analysis-studio'], { status: 'paused', step: 2 });
  await h.ui.open('analysis-studio', { autoplay: true });
  assert.equal(preview.textContent, '确认文件可打开');
  h.button('退出引导').click();
  await h.ui.flush();
  assert(h.calls.every(({ method }) => ['readModuleState', 'saveModuleState'].includes(method)));
});

test('a late progress read cannot replace a screenshot that is already enlarged', async () => {
  const initial = model.mark(model.defaults(), 'workspace-manager', 'paused', 1);
  const h = harness({ initial, deferRead: true });
  const opened = h.ui.open('workspace-manager');
  await Promise.resolve();
  h.button('放大截图').click(); h.releaseRead(); await opened;
  const [thumb, full] = h.all().filter(n => n.tagName === 'img');
  assert.equal(full.src, pictures.get('workspace-manager', 0).file);
  assert.equal(thumb.src, (crops['workspace-manager:0'] || pictures.get('workspace-manager', 0)).file);
  h.button('返回引导').click();
  h.ui.close(); await h.ui.flush();
});

test('all guide steps render their own verified local asset, target and evidence type', async () => {
  const fs = require('node:fs'), path = require('node:path'), h = harness();
  assert.deepEqual([...pictures.ids].sort(), model.all.map(g => g.id).sort());
  let total = 0;
  const checked = new Set();
  function verifyAsset(file) {
    assert.match(file, /^assets\/guide-[a-z0-9-]+\/(?:[\w-]+\/)*[\w-]+\.(png|svg)$/);
    if (checked.has(file)) return;
    const buf = fs.readFileSync(path.join(__dirname, '../desktop/app', file));
    if (file.endsWith('.png')) {
      assert.equal(buf.subarray(1,4).toString(), 'PNG', file);
      assert(buf.readUInt32BE(16) >= 120 && buf.readUInt32BE(20) >= 40, file);
    } else {
      const svg = buf.toString(); assert.match(svg, /<svg\b/);
      assert.doesNotMatch(svg, /<script\b|<foreignObject\b|(?:href|src)=["']https?:/i, file);
    }
    checked.add(file);
  }
  const rectOK = r => r.length === 4 && r.every(Number.isFinite) && r[0]>=0 && r[1]>=0 && r[2]>0 && r[3]>0 && r[0]+r[2]<=100.1 && r[1]+r[3]<=100.1;
  for (const guide of model.all) {
    const id = guide.id;
    await h.ui.open(id);
    assert.equal(pictures.count(id), guide.steps.length, id);
    const unique = new Set();
    for (let i = 0; i < guide.steps.length; i++) {
      if (i) h.button('下一步').click();
      const p = pictures.get(id, i), crop = crops[id+':'+i] || p, desc = id+':'+i;
      assert(p && p.label.trim() && rectOK(p.rect) && rectOK(crop.rect), desc);
      assert(['capture','diagram'].includes(p.kind), desc);
      assert.equal(h.all().find(n => n.tagName === 'figure').hidden, false, desc);
      const images = h.all().filter(n => n.tagName === 'img');
      assert.deepEqual(images.map(n => n.src), [crop.file,p.file], desc);
      assert(images.every(n => n.alt.includes(p.label) && n.alt.includes(p.kind === 'capture' ? '实拍' : '示意')), desc);
      const marks = h.all().filter(n => n.className === 'guide-mark');
      assert.deepEqual(marks.map(n => ['left','top','width','height'].map(prop => parseFloat(n.style[prop]))), [crop.rect,p.rect], desc);
      verifyAsset(crop.file); verifyAsset(p.file);
      unique.add(p.file + JSON.stringify(p.rect)); total++;
    }
    assert(unique.size > 1, id + ' must not repeat one overview for every step');
    h.ui.close(); await h.ui.flush();
  }
  assert.equal(total, 180);
});

test('workspace steps point at bundled examples; zoom Escape returns to the same step without writing progress', async () => {
  const h = harness();
  await h.ui.open('workspace-manager');
  const [reader, zoom] = h.all().filter(n => n.tagName === 'dialog');
  const caption = h.all().find(n => n.className === 'guide-picture-label');
  const images = h.all().filter(n => n.tagName === 'img');
  for (let i = 0; i < model.get('workspace-manager').steps.length; i++) {
    if (i) h.button('下一步').click();
    const pic = pictures.get('workspace-manager', i);
    assert.equal(images[0].src, (crops['workspace-manager:' + i] || pic).file);
    assert.equal(images[1].src, pic.file);
    assert.match(caption.textContent, /图中标记/);
    const calls = h.calls.length;
    h.button('放大截图').click();
    assert(zoom.open && reader.open);
    zoom.listeners.keydown({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
    assert(!zoom.open && reader.open);
    assert.equal(h.doc.focused, h.button('放大截图'));
    assert.equal(h.calls.length, calls);
    assert(h.all().some(n => n.textContent === `第 ${i + 1} 步，共 5 步`));
  }
  h.button('完成引导').click();
  assert(reader.open);
  h.button('退出引导').click();
  await h.ui.flush();
  await h.ui.open('label-design');
  assert.equal(images[1].src, pictures.get('label-design', 0).file, 'switching topics must replace the last screenshot');
  h.ui.close();
  await h.ui.flush();
});

test('exit and Escape are available at every step and persist an independent resumable cursor', async () => {
  const h = harness();
  await h.ui.open('legacy-entry');
  const dialog = h.nodes.find((n) => n.tagName === 'dialog');
  for (let i = 0; i < model.get('legacy-entry').steps.length; i++) {
    assert.ok(h.button('退出引导'));
    if (i) h.button('下一步').click();
  }
  let prevented = false;
  dialog.listeners.cancel({
    preventDefault: () => {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(h.ui.isOpen(), false);
  await h.ui.flush();
  assert.deepEqual(h.state().progress['legacy-entry'], { status: 'paused', step: 4 });
  assert.deepEqual(h.lifecycle, ['hidden', 'restored']);
  await h.ui.open('legacy-entry');
  assert.ok(h.button('完成引导'));
  h.button('完成引导').click();
  assert.equal(h.ui.isOpen(), true);
  assert.equal(h.button('引导已完成').disabled, true);
  assert.deepEqual(h.lifecycle, ['hidden', 'restored', 'hidden']);
  await h.ui.flush();
  assert.equal(h.state().progress['legacy-entry'].status, 'completed');
  h.button('上一步').click();
  h.button('下一步').click();
  assert.equal(h.button('引导已完成').disabled, true);
  h.button('退出引导').click();
  assert.equal(h.ui.isOpen(), false);
  await h.ui.flush();
  assert.deepEqual(h.state().progress['legacy-entry'], { status: 'completed', step: 4 });
  await h.ui.open('bi-daily');
  h.button('跳过本功能').click();
  await h.ui.flush();
  assert.equal(h.state().progress['bi-daily'].status, 'skipped');
  assert.equal(h.state().progress['legacy-entry'].status, 'completed');
  assert.ok(h.calls.every((x) => ['readModuleState', 'saveModuleState'].includes(x.method)));
});
test('a new UI session restores progress and can replay completed guides without executing their actions', async () => {
  const saved = model.mark(model.defaults(), 'action:export-records', 'completed', 2);
  const h = harness({ initial: saved });
  await h.ui.open('action:export-records');
  assert.ok(h.button('下一步'));
  h.button('下一步').click();
  h.ui.close();
  await h.ui.flush();
  const other = harness({ initial: h.state() });
  await other.ui.open('action:export-records');
  assert.equal(other.button('上一步').disabled, false);
  other.button('重新开始').click();
  assert.equal(other.button('上一步').disabled, true);
  other.ui.close();
  await other.ui.flush();
  assert.ok(other.calls.every((x) => !/export|delete|import|saveRecord/i.test(x.method)));
});
test('a late progress read cannot overwrite steps changed by the reader or hold the original page hidden', async () => {
  const initial = model.mark(model.defaults(), 'bi-trends', 'completed', 3);
  const h = harness({ initial, deferRead: true });
  const opened = h.ui.open('legacy-entry');
  await Promise.resolve();
  h.button('下一步').click();
  h.ui.close();
  assert.equal(h.ui.isOpen(), false, 'exit works while read is pending');
  assert.deepEqual(h.lifecycle, ['hidden', 'restored']);
  h.releaseRead();
  await opened;
  await h.ui.flush();
  assert.deepEqual(h.state().progress['legacy-entry'], { status: 'paused', step: 1 });
  assert.equal(h.state().progress['bi-trends'].status, 'completed');
});
test('failed progress writes allow immediate exit, report failure and can be retried', async () => {
  const h = harness();
  await h.ui.open('home');
  h.control.failSave = true;
  h.button('下一步').click();
  h.ui.close();
  assert.equal(h.ui.isOpen(), false);
  assert.equal(await h.ui.flush(), false);
  assert.ok(h.errors.some((x) => x.includes('save failure')));
  h.control.failSave = false;
  assert.equal(await h.ui.flush(), true);
  assert.equal(h.state().progress.home.step, 1);
});
test('explicit retry preserves another window progress and reapplies only locally touched guides', async () => {
  const h = harness();
  await h.ui.open('legacy-entry');
  h.externalChange(model.mark(model.defaults(), 'bi-daily', 'completed', 3));
  h.button('下一步').click();
  assert.equal(await h.ui.flush(), false, 'stale revisions cannot silently overwrite');
  await h.button('重试保存进度').click();
  assert.equal(await h.ui.flush(), true);
  assert.deepEqual(h.state().progress['bi-daily'], { status: 'completed', step: 3 });
  assert.deepEqual(h.state().progress['legacy-entry'], { status: 'paused', step: 1 });
  h.ui.close();
  await h.ui.flush();
});
test('corrupt progress never silently saves and reset requires a separate confirmation', async () => {
  const h = harness({ corrupt: true });
  await h.ui.open('home');
  h.button('下一步').click();
  assert.equal(await h.ui.flush(), false);
  await h.button('重置引导进度').click();
  assert.equal(h.calls.filter((x) => x.method === 'resetModuleState').length, 0);
  h.all().find((n) => n.type === 'checkbox').checked = true;
  await h.button('重置引导进度').click();
  assert.equal(h.calls.filter((x) => x.method === 'resetModuleState').length, 1);
  assert.deepEqual(h.state(), model.defaults());
  h.ui.close();
  await h.ui.flush();
});
test('library search does not navigate or interrupt current guide and cannot open over another modal', async () => {
  const h = harness();
  await h.ui.open('home');
  const input = h.all().find((n) => n.type === 'search');
  input.value = '__missing__';
  input.oninput();
  assert.ok(h.all().some((n) => n.textContent?.includes('没有匹配的引导')));
  input.value = '二维码';
  input.oninput();
  const chosen = h
    .all()
    .find((n) => n.tagName === 'button' && n.textContent === '夹具标签制作与排版 · 未阅读');
  chosen.click();
  assert.ok(h.all().some((n) => n.tagName === 'h3' && n.textContent === '夹具标签制作与排版'));
  h.ui.close();
  await h.ui.flush();
  const other = h.doc.createElement('dialog');
  other.open = true;
  h.doc.body.append(other);
  await h.ui.open('home');
  assert.equal(h.ui.isOpen(), false);
  assert.ok(h.errors.some((x) => x.includes('当前弹窗')));
});
test('an expanded guide catalog imports old learning progress read-only into a separate namespace', async () => {
  const old = model.mark(model.defaults(), 'legacy-entry', 'paused', 2);
  const h = harness({ legacy: old });
  await h.ui.open('legacy-entry');
  assert.ok(h.all().some((n) => n.textContent === '第 3 步，共 5 步'));
  await h.ui.flush();
  assert.deepEqual(h.state().progress['legacy-entry'], old.progress['legacy-entry']);
  const writes = h.calls.filter((x) => x.method === 'saveModuleState');
  assert.ok(writes.length);
  assert.ok(writes.every((x) => x.value.address.module === 'guides-v3'));
  h.ui.close();
  await h.ui.flush();
});
