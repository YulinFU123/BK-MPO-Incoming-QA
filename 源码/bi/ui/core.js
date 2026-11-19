'use strict';
/* ============ 基础工具 ============ */
const $ = (s, el = document) => el.querySelector(s);
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const k in (attrs || {})) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  (function add(list) { for (const c of list) { if (c == null || c === false) continue; if (Array.isArray(c)) add(c); else el.append(c.nodeType ? c : document.createTextNode(String(c))); } })(kids);
  return el;
}
const fmt = n => (n == null || n === '') ? '' : Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
const pct = (a, b) => b ? (a / b * 100).toFixed(1) + '%' : '—';
const clone = o => JSON.parse(JSON.stringify(o));
const uniq = a => [...new Set(a)];
const splitv = s => Array.isArray(s) ? s : String(s || '').split(/[、,，;；\n]/).map(x => x.trim()).filter(Boolean);

async function api(path, body) {
  try {
    const r = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = await r.json();
    if (j && j.ok === false && j.error) toast(j.error, 'bad');
    return j;
  } catch (e) { toast('与程序连接中断：' + e.message, 'bad'); return { ok: false }; }
}
function toast(msg, type) {
  const t = h('div', { class: 'tst ' + (type || '') }, msg);
  $('#toast').append(t); setTimeout(() => t.remove(), type === 'bad' ? 6000 : 2600);
}
function busy(msg) { const o = $('#ov'); if (msg) { $('#ovt').textContent = msg; o.style.display = 'flex'; } else o.style.display = 'none'; }

/* ============ 图标 ============ */
const IC = {
  home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10', db: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6',
  target: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 8a4 4 0 100 8 4 4 0 000-8zM12 11.5a.5.5 0 100 1', users: 'M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM2 20c0-3.3 3-6 7-6s7 2.7 7 6M17 4.5a3 3 0 010 6M19 14c2 .7 3 2.4 3 4.5',
  tag: 'M3 12V4h8l10 10-8 8L3 12zM7.5 8.5h.01', chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2', compass: 'M12 3a9 9 0 100 18 9 9 0 000-18zM15.5 8.5l-2 5-5 2 2-5 5-2z',
  bell: 'M6 16V11a6 6 0 1112 0v5l2 2H4l2-2zM10 21a2 2 0 004 0', calc: 'M5 3h14v18H5zM8 7h8M8 12h2M12 12h2M8 16h2M12 16h2M16 12v4', wrench: 'M14.5 6.5a4 4 0 005 5L21 13l-8 8-4-4 8-8 1.5-1.5zM4 20l4-4', gear: 'M12 9a3 3 0 100 6 3 3 0 000-6zM19 12l2-1.5-2-3.5-2.4.8-1.6-1-.4-2.5h-4l-.4 2.5-1.6 1-2.4-.8-2 3.5L5 12l-2 1.5 2 3.5 2.4-.8 1.6 1 .4 2.5h4l.4-2.5 1.6-1 2.4.8 2-3.5z'
};
const icon = (n, s = 18) => h('span', { html: `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${IC[n]}"/></svg>`, style: { display: 'inline-flex' } });

/* ============ 组件 ============ */
function toggle(on, cb, sm) {
  const el = h('span', { class: 'sw' + (on ? ' on' : '') + (sm ? ' sm' : ''), role: 'switch' });
  el.onclick = e => { e.stopPropagation(); on = !on; el.classList.toggle('on', on); cb(on); };
  return el;
}
function chips(opts, sel, cb, o = {}) {
  const box = h('div', { class: 'chips' });
  const norm = opts.map(x => typeof x === 'string' ? { v: x } : x);
  const draw = () => {
    box.innerHTML = '';
    norm.forEach(x => {
      const on = sel.includes(x.v);
      box.append(h('span', { class: 'chip' + (on ? ' on' : ''), title: x.t || '', onclick: () => {
        if (o.single) { sel.length = 0; if (!on) sel.push(x.v); } else if (on) sel.splice(sel.indexOf(x.v), 1); else sel.push(x.v);
        draw(); cb && cb(sel);
      } }, x.v, x.n != null ? h('small', {}, fmt(x.n)) : null));
    });
    if (!norm.length) box.append(h('span', { class: 'hint' }, o.empty || '（暂无可选项：先在【开始】页扫描数据）'));
  };
  draw(); box.redraw = draw; return box;
}
function tags(vals, cb, ph, opts) {
  const box = h('div', { class: 'tagbox' });
  const inp = h('input', { type: 'text', placeholder: ph || '输入后回车', list: opts ? 'dl_' + opts.id : null });
  const draw = () => {
    box.querySelectorAll('.tag').forEach(t => t.remove());
    vals.forEach((v, i) => box.insertBefore(h('span', { class: 'tag' }, v, h('b', { onclick: () => { vals.splice(i, 1); draw(); cb(vals); } }, '×')), inp));
  };
  const add = () => { splitv(inp.value).forEach(x => { if (!vals.includes(x)) vals.push(x); }); inp.value = ''; draw(); cb(vals); };
  inp.onkeydown = e => { if (e.key === 'Enter' || e.key === ',' || e.key === '，') { e.preventDefault(); add(); } else if (e.key === 'Backspace' && !inp.value && vals.length) { vals.pop(); draw(); cb(vals); } };
  inp.onblur = () => { if (inp.value.trim()) add(); };
  box.append(inp); draw();
  if (opts) { const dl = h('datalist', { id: 'dl_' + opts.id }, opts.list.map(v => h('option', { value: v }))); box.append(dl); }
  return box;
}
function seg(opts, val, cb) {
  const el = h('div', { class: 'seg' });
  const draw = () => { el.innerHTML = ''; opts.forEach(o => { const v = typeof o === 'string' ? o : o.v; el.append(h('span', { class: v === val ? 'on' : '', onclick: () => { val = v; draw(); cb(v); } }, typeof o === 'string' ? o : o.t)); }); };
  draw(); return el;
}
function sel(opts, val, cb, o = {}) {
  const s = h('select', { onchange: e => cb(e.target.value) });
  (o.blank != null ? [{ v: '', t: o.blank }] : []).concat(opts.map(x => typeof x === 'string' ? { v: x, t: x } : x)).forEach(x => s.append(h('option', { value: x.v, selected: x.v === val }, x.t)));
  if (val && ![...s.options].some(op => op.value === val)) s.append(h('option', { value: val, selected: true }, val + '（未找到）'));
  s.value = val ?? ''; return s;
}
function inp(val, cb, a = {}) {
  const el = h('input', Object.assign({ type: 'text', value: val ?? '' }, a));
  el.oninput = () => cb(el.value); return el;
}
function field(label, ctrl, hint) { return h('div', {}, h('label', { class: 'f' }, label), ctrl, hint ? h('div', { class: 'hint' }, hint) : null); }
function card(title, sub, right, ...kids) {
  return h('div', { class: 'card' }, h('div', { class: 'hd' }, h('h3', {}, title), sub ? h('span', { class: 's' }, sub) : null, h('span', { class: 'sp' }), right || null), ...kids);
}
function banner(type, ...kids) { return h('div', { class: 'banner ' + type }, ...kids); }
function kpi(l, v, s, type) { return h('div', { class: 'kpi ' + (type || '') }, h('div', { class: 'l' }, l), h('div', { class: 'v' }, v), h('div', { class: 's' }, s || '')); }
function empty(msg) { return h('div', { class: 'empty' }, msg); }

/* ============ 全局状态 ============ */
const S = { cfg: null, meta: null, scan: null, last: null, base: '', page: 'daily', sel: { scheme: 0, chart: 0, improve: 0 }, saved: '', first: false, scanning: false, run: { running: false, n: 0, log: [], error: null, result: null } };
const PAGES = {};
const NAV = [
  ['grp', '分析工作台'], ['daily', 'chart', '邮件日报 · V10.2'], ['trends', 'chart', '日 / 周 / 月趋势'], ['groups', 'users', '员工与工序分组'], ['home', 'home', '完整报表导出'], ['grp', '数据'], ['data', 'db', '数据与字段'],
  ['grp', '分析规则'], ['schemes', 'target', '筛选方案'], ['people', 'users', '人员名单'], ['defects', 'tag', '不良类型'], ['charts', 'chart', '图表中心'],
  ['grp', '驾驶舱'], ['dash', 'compass', '驾驶舱设置'], ['alerts', 'bell', '预警规则'],
  ['grp', '补充'], ['chk', 'calc', '每日检查量'], ['improve', 'wrench', '改善项目'], ['tools', 'gear', '工具与备份']
];
const TITLES = { daily: ["多工序日报工作台", "责任人员 · 数量与占比 · 可选产量 · 本地导出"], trends: ['趋势工作台', '日、自然周、自然月 · 自由筛选与对比'], groups: ['员工与工序分组', '维护可复用的分组，筛选时自动合并去重'], home: ['开始 · 生成报表', '放入原表 → 扫描 → 一键生成'], data: ['数据与字段', '数据源、字段映射、全局筛选'], schemes: ['筛选方案', '一个方案 = 一张分析表：工序 / 人员组 / 不良组 / 产品 / 班别'],
  people: ['人员名单', '导入姓名并分组，供筛选方案“只看 / 排除”'], defects: ['不良类型', '归类不良代码、设置标准不良项目、决定是否统计'], charts: ['图表中心', '自由选择图表类型、数据方案、分类与系列'],
  dash: ['驾驶舱设置', '看板方案、分析窗口、专项不良、目标线、趋势参数'], alerts: ['预警规则', '条形图/表格标红标橙的规则与颜色'], chk: ['每日检查量', '填写后可计算真实不良率与趋势'],
  improve: ['改善项目', '登记项目，自动对比改善前后'], tools: ['工具与备份', '导入旧 Excel 控制台、备份与恢复'] };

let saveT = null, saveChain = Promise.resolve(), saveRevision = 0;
function touch() {
  const revision = ++saveRevision;
  S.saved = '保存中…'; drawTop();
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    const config = clone(S.cfg);
    saveChain = saveChain.catch(() => {}).then(async () => {
      const j = await api('/api/save', { config });
      if (revision === saveRevision) { S.saved = j.ok ? '已自动保存 ' + j.time : '保存失败'; drawTop(); drawNav(); }
    });
  }, 500);
}
const P_ = () => S.cfg.P;
const schemes = () => S.cfg.schemes;
const schemeNames = () => schemes().filter(s => s.enabled !== false).map(s => s.name);

/* ============ 配置检查 ============ */
function roleCols() { const r = {}; for (const c in S.cfg.fieldmap) { const ro = S.cfg.fieldmap[c].role; if (ro && ro !== '不使用' && !r[ro]) r[ro] = c; } return r; }
function checks() {
  const out = [], sc = S.scan, P = P_();
  const add = (level, text, page, hint) => out.push({ level, text, page, hint });
  if (!sc || !sc.rows) add('bad', '还没有数据：请把原表(xlsx)放进“每日原表”文件夹，再点【扫描数据】', 'home');
  const r = roleCols();
  const need = [['责任员工', '责任员工'], ['责任工序', '责任工序'], ['不良代码', '不良代码']].filter(([k]) => !r[k]).map(x => x[1]);
  if (sc && sc.rows && (need.length || !(r['业务日期'] || r['记录时间']))) add('bad', '字段映射缺少必要用途：' + (need.concat(r['业务日期'] || r['记录时间'] ? [] : ['业务日期/记录时间'])).join('、'), 'data');
  const names = schemeNames();
  if (!names.length) add('bad', '没有启用的筛选方案', 'schemes');
  if (names.length && !names.includes(P['看板方案'])) add('bad', `看板方案【${P['看板方案']}】不存在或未启用`, 'dash');
  if (names.length && !names.includes(P['月度风险方案'])) add('bad', `月度风险方案【${P['月度风险方案']}】不存在或未启用`, 'dash');
  S.cfg.charts.filter(c => c.enabled !== false && c.scheme && !names.includes(c.scheme)).forEach(c => add('warn', `图表【${c.title}】引用的方案【${c.scheme}】不存在，将改用全部数据`, 'charts'));
  if (P['人员筛选模式'] !== '不筛选' && !S.cfg.people.length) add('bad', `人员筛选模式=${P['人员筛选模式']}，但人员名单是空的`, 'people');
  const unk = new Set(); schemes().filter(s => s.enabled !== false).forEach(s => { [...(s.emp_in || []), ...(s.emp_out || [])].forEach(g => { if (!S.cfg.people.some(p => (p.groups || []).includes(g))) unk.add(g); }); });
  if (unk.size) add('warn', '筛选方案引用了名单里不存在的人员组：' + [...unk].join('、'), 'schemes');
  if (!Object.keys(S.cfg.chk).length) add('warn', '没有填写每日检查量：只能看 pcs 与占比，无法计算不良率', 'chk');
  const tg = parseFloat(P['目标不良率']), wn = parseFloat(P['预警不良率']);
  if (tg && wn && tg >= wn) add('warn', '目标不良率应低于预警不良率', 'dash');
  if (sc && sc.items) { const have = sc.items.map(x => x.v); const miss = splitv(P['专项不良项目']).filter(x => !have.includes(x)); if (miss.length) add('warn', '专项不良项目在数据里没有出现：' + miss.join('、'), 'dash'); }
  const nw = Object.values(S.cfg.defects).filter(d => d.new).length;
  if (nw) add('info', `发现 ${nw} 个新增不良代码，建议到【不良类型】确认归类`, 'defects');
  if (!out.some(x => x.level === 'bad' || x.level === 'warn')) out.unshift({ level: 'ok', text: '配置检查通过', page: null });
  return out;
}

/* ============ 外框 ============ */
function drawNav() {
  const nav = $('#nav'); nav.innerHTML = '';
  const ck = checks(), bad = {}, warn = {};
  ck.forEach(c => { if (!c.page) return; if (c.level === 'bad') bad[c.page] = (bad[c.page] || 0) + 1; else if (c.level === 'warn') warn[c.page] = (warn[c.page] || 0) + 1; });
  NAV.forEach(n => {
    if (n[0] === 'grp') nav.append(h('div', { class: 'grp' }, n[1]));
    else nav.append(h('a', { class: S.page === n[0] ? 'on' : '', onclick: () => go(n[0]) }, h('i', {}, icon(n[1])), n[2], bad[n[0]] ? h('span', { class: 'bd bad' }, bad[n[0]]) : warn[n[0]] ? h('span', { class: 'bd warn' }, warn[n[0]]) : null));
  });
  $('#sfoot').textContent = S.base ? '数据目录：' + S.base.split(/[\\/]/).slice(-2).join('/') : '';
}
function drawTop() {
  const t = $('#top'), ti = TITLES[S.page] || ['', ''], ck = checks();
  const nb = ck.filter(x => x.level === 'bad').length, nw = ck.filter(x => x.level === 'warn').length;
  t.innerHTML = '';
  t.append(h('div', {}, h('h1', {}, ti[0]), h('div', { class: 'sub' }, ti[1])), h('span', { class: 'sp' }),
    h('span', { class: 'pill ' + (nb ? 'bad' : nw ? 'warn' : 'ok'), style: { cursor: 'pointer' }, onclick: () => go('home') }, h('span', { class: 'dot' }), nb ? `${nb} 项必须处理` : nw ? `${nw} 项提醒` : '配置完整'),
    h('span', { class: 'pill' }, S.saved || '自动保存已开启'),
    ...(S.page !== 'home' ? [h('button', { class: 'btn pri', onclick: () => { go('home'); startRun(); } }, '▶ 生成报表')] : []));
}
function go(p) { S.page = p; render(); $('#content').scrollTop = 0; }
function render() { drawNav(); drawTop(); const el = $('#page'); el.innerHTML = ''; try { PAGES[S.page](el); } catch (e) { console.error(e); el.append(banner('bad', '页面出错：' + e.message)); } }

/* ============ 扫描 / 生成 ============ */
async function scan(force, silent) {
  if (S.scanning) return; S.scanning = true;
  if (!silent) busy('正在读取并分析原表…（首次约 5~20 秒）');
  const j = await api('/api/scan', { config: S.cfg, force: !!force });
  S.scanning = false; busy();
  if (j && j.ok !== false) {
    S.scan = j;
    if (typeof TR !== 'undefined') { TR.dirty = true; TR.sequence++; TR.pending = false; }
    if (j.raw_patch) { mergeDiscovered(j.raw_patch); touch(); }
    if (!silent) toast(j.rows ? `扫描完成：${fmt(j.rows)} 行，${j.days.length} 个生产日` : '没有找到数据，请把原表放进“每日原表”文件夹', j.rows ? 'ok' : 'bad');
  }
  render();
  if (S.page === 'trends' && typeof loadTrend === 'function' && S.scan?.rows) loadTrend();
}
async function startRun() {
  if (S.run.running) return;
  const bad = checks().filter(c => c.level === 'bad' && c.page !== 'home');
  if (bad.length) { toast('请先处理：' + bad[0].text, 'bad'); go(bad[0].page); return; }
  S.run = { running: true, n: 0, log: [], error: null, result: null, t0: Date.now() };
  const j = await api('/api/run', { config: S.cfg });
  if (!j.ok) { S.run.running = false; return; }
  if (S.page === 'home') render();
  pollRun();
}
async function pollRun() {
  const j = await api('/api/status?since=' + S.run.n);
  if (j && j.log) { S.run.log.push(...j.log); S.run.n = j.n; }
  const lg = $('#runlog'); if (lg) { lg.innerHTML = ''; S.run.log.forEach(l => lg.append(h('div', { class: /✘|失败|错误/.test(l) ? 'e' : /警告/.test(l) ? 'w' : /完成/.test(l) ? 'k' : '' }, l))); lg.scrollTop = lg.scrollHeight; }
  if (j && j.done) {
    S.run.running = false; S.run.error = j.error; S.run.result = j.result;
    if (j.result) { S.last = Object.assign({ time: new Date().toLocaleString('zh-CN') }, j.result); delete S.last.raw; if (j.result.raw) { mergeDiscovered(j.result.raw); } scan(true, true); }
    toast(j.error ? '生成失败：' + j.error : '报表已生成', j.error ? 'bad' : 'ok');
    render(); return;
  }
  setTimeout(pollRun, 700);
}

/* ============ 启动 ============ */
async function boot() {
  const st = await api('/api/state');
  if (!st.config) { document.body.innerHTML = '<p style="padding:40px">无法连接到程序，请重新双击启动。</p>'; return; }
  S.cfg = st.config; S.meta = st.meta; S.last = st.last; S.base = st.base; S.first = st.first_run;
  fetch('/api/ping').catch(() => { }); setInterval(() => fetch('/api/ping').catch(() => { }), 4000);
  window.addEventListener('pagehide', () => navigator.sendBeacon && navigator.sendBeacon('/api/bye', '{}'));
  render();
  await scan(false, false);
  if (S.first) { S.first = false; touch(); }
}

function mergeDiscovered(patch) { for (const key of ['fieldmap', 'defects']) for (const [name, value] of Object.entries(patch[key] || {})) if (!(name in S.cfg[key])) S.cfg[key][name] = value; }
