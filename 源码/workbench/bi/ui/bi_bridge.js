'use strict';
/** BI handoff UI. A task owns its query; pending tasks are discoverable after refresh. */
const B = {
  job: null, timer: null, status: '未启动', script: '', loaded: false, loading: false,
  starting: false, completing: false, history: [],
};

async function makeBIScript(config) {
  const responses = await Promise.all([fetch('/bi_export_original.js'), fetch('/bi_runner_template.js')]);
  if (responses.some(response => !response.ok)) throw new Error('BI脚本文件加载失败，请检查程序包完整性。');
  const [source, template] = await Promise.all(responses.map(response => response.text()));
  const index = source.indexOf('(async()=>{');
  if (index < 0 || !template.includes('__DAILY_EXPORT_BODY__') || !template.includes('__DAILY_JOB_JSON__')) {
    throw new Error('BI脚本模板格式不匹配，请使用完整新版文件。');
  }
  return template.replace('__DAILY_JOB_JSON__', () => JSON.stringify(config))
    .replace('__DAILY_EXPORT_BODY__', () => 'await ' + source.slice(index));
}

function setBIStatus(message) {
  B.status = message;
  const label = $('#bi-status');
  if (label) label.textContent = message;
}

async function loadBICurrent() {
  if (B.loading || B.loaded) return;
  B.loading = true;
  try {
    const response = await api('/api/bi/current', {});
    if (!response.ok) { B.loaded = true; setBIStatus(response.error || '无法读取BI任务，请点击重新读取'); return; }
    B.history = response.history || [];
    B.loaded = true;
    if (response.active && !B.job) {
      B.job = response.active.id;
      setBIStatus(response.active.message + '（已恢复本地接收）');
      B.script = await makeBIScript(response.active.config);
      scheduleBIPoll();
    }
  } catch (error) { B.loaded = true; setBIStatus(error.message); }
  finally { B.loading = false; if (S.page === 'daily') render(); }
}

function scheduleBIPoll() {
  clearTimeout(B.timer);
  if (B.job) B.timer = setTimeout(biPoll, 2000);
}

async function completeBIReport(task) {
  if (B.completing) return;
  B.completing = true;
  B.script = '';
  setBIStatus('历史已保存，正在使用本次任务的筛选生成日报。');
  let exported = { ok: false };
  try {
    // Do not reload saved query: it may describe a different screen state.
    await dailyInit({ restoreQuery: false });
    const result = await dailyAnalyze(task.query);
    if (result) exported = await dailyExport();
    const response = await api('/api/bi/report', { job: task.id, success: exported.ok, path: exported.path });
    setBIStatus(response.ok ? response.message : '历史已保存，但日报完成状态未确认，请查看输出文件夹。');
  } catch (error) {
    await api('/api/bi/report', { job: task.id, success: false });
    setBIStatus('历史已保存，日报未完成：' + error.message);
  } finally {
    B.completing = false;
    B.loaded = false;
    await loadBICurrent();
    if (S.page === 'daily') render();
  }
}

async function biPoll() {
  if (!B.job) return;
  const id = B.job;
  try {
    const response = await api('/api/bi/poll', { job: id });
    if (id !== B.job) return;
    if (!response.ok) {
      setBIStatus(response.error || '连接暂时中断，将重试；如程序重启，请停止并重新开始。');
      scheduleBIPoll();
      return;
    }
    setBIStatus(response.message);
    if (response.state === 'done') {
      B.job = null;
      await completeBIReport(response);
      return;
    }
    if (['failed', 'cancelled'].includes(response.state)) {
      B.job = null; B.script = ''; B.loaded = false;
      await loadBICurrent();
      return;
    }
    scheduleBIPoll();
  } catch (error) { setBIStatus('任务检查异常：' + error.message); scheduleBIPoll(); }
}

function validateBIQuery(query) {
  if (!query.start) throw new Error('请先填写起始业务日，就在本区域的日期框中。');
  if (!query.end) throw new Error('请先填写结束业务日；导出一天时两个日期相同。');
  if (query.start > query.end) throw new Error('起始业务日不能晚于结束业务日。');
  if (!query.scope?.trim()) throw new Error('请填写来源范围名称。');
}

function setDailyDate(key, value) {
  D.q[key] = value;
  document.querySelectorAll(`[data-daily-date="${key}"]`).forEach(input => input.value = value);
  ddirty();
}

async function startBI() {
  if (B.starting || B.job || B.completing || D.working) return toast('已有任务正在处理，请稍候或停止旧接收。');
  const config = D.config.bi || {};
  const query = clone(D.q);
  query.scope = (config.scope || query.scope || '').trim();
  validateBIQuery(query);
  if (!config.folder?.trim()) throw new Error('请选择浏览器实际下载文件夹。');
  B.starting = true;
  busy('检查日期并准备本次BI脚本…');
  try {
    const response = await api('/api/bi/start', {
      folder: config.folder, query, floor: config.floor ?? 'BK_5F',
      pattern: config.pattern || 'data*.xlsx', products: query.product, replace: !!config.replace,
    });
    if (!response.ok) return;
    B.job = response.job;
    D.q = query;
    await dailySave();
    try {
      B.script = await makeBIScript(response.config);
      setBIStatus(response.message);
      scheduleBIPoll();
    } catch (error) {
      await api('/api/bi/cancel', { job: B.job });
      B.job = null; B.script = ''; throw error;
    }
  } finally { B.starting = false; busy(); if (S.page === 'daily') render(); }
}

async function stopBI() {
  if (!B.job) return;
  const response = await api('/api/bi/cancel', { job: B.job });
  if (!response.ok) return;
  B.job = null; B.script = ''; clearTimeout(B.timer);
  setBIStatus(response.message || '已停止接收');
  B.loaded = false;
  await loadBICurrent();
}

function biPanel() {
  D.config.bi ||= {};
  const config = D.config.bi;
  const active = B.job || B.completing;
  const box = h('details', { open: true }, h('summary', {}, 'BI导出与日报接续 · V10.2'));
  box.append(h('p', {}, '① 选日期和下载目录 → ② 生成并复制脚本 → ③ 到已登录BI执行 → 本地自动校验、入库和生成日报。'),
    h('div', { class: 'g3' },
      field('起始业务日（必填）', inp(D.q.start, value => setDailyDate('start', value), { type: 'date', 'data-daily-date': 'start' })),
      field('结束业务日（必填）', inp(D.q.end, value => setDailyDate('end', value), { type: 'date', 'data-daily-date': 'end' })),
      dbtn('填入昨天', () => {
        const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
        const value = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
        setDailyDate('start', value); setDailyDate('end', value);
      })),
    field('来源范围名称', inp(config.scope || D.q.scope, value => config.scope = value,
      { placeholder: '如 BK5F_六类连接器_不良明细；同范围不按日期改名' })),
    field('浏览器实际下载目录', inp(config.folder || '', value => config.folder = value)),
    dbtn('选择下载文件夹', async () => {
      const response = await api('/api/pick', { kind: 'folder' });
      if (response.path) { config.folder = response.path; await dailySave(); render(); }
    }));
  const advanced = h('details', {}, h('summary', {}, '范围检查与历史替换设置'));
  advanced.append(field('预期记录楼层（空=不检查）', inp(config.floor ?? 'BK_5F', value => config.floor = value)),
    field('Excel文件名规则', inp(config.pattern || 'data*.xlsx', value => config.pattern = value)),
    h('label', {}, h('input', { type: 'checkbox', checked: config.replace,
      onchange: event => config.replace = event.target.checked }), '允许替换同范围同业务日完整快照（保留旧版；不要用半天数据替换全天）'));
  box.append(advanced, h('p', { class: 'hint' },
    'BI脚本只设置日期；楼层、产品等BI筛选需提前确认。任务开始后使用当时的条件，后续页面修改不会改变该任务。'),
    dbtn('开始接收并生成BI脚本', startBI), dbtn('停止接收', stopBI),
    h('p', { id: 'bi-status', role: 'status', 'aria-live': 'polite' }, B.status));
  if (B.script && B.job) {
    const textarea = h('textarea', { readonly: true, style: { width: '100%', height: '100px' }, 'aria-label': '本次BI脚本' }, B.script);
    box.append(h('p', {}, '复制后到BI页面控制台执行；不是在本地工作台执行。每次任务使用新脚本。'),
      textarea, dbtn('复制本次BI脚本', async () => {
        try { await navigator.clipboard.writeText(B.script); toast('已复制，请到已登录的BI页面执行'); }
        catch (_) { textarea.select(); toast('请按Ctrl+C复制选中的代码'); }
      }));
  }
  if (B.history.length) {
    box.append(h('details', {}, h('summary', {}, '最近任务记录'), h('pre', { style: { maxHeight: '160px', overflow: 'auto' } },
      B.history.slice().reverse().map(task => `${task.updated}｜${task.start}～${task.end}｜${task.message}`).join('\n'))));
  }
  if (!B.loading && !B.job) box.append(dbtn('读取/恢复接收任务', () => { B.loaded = false; return loadBICurrent(); }));
  return box;
}

const originalDailyPage = PAGES.daily;
PAGES.daily = element => {
  originalDailyPage(element);
  if (D.ready) {
    element.prepend(biPanel());
    if (!B.loaded && !B.loading) loadBICurrent();
  }
};
