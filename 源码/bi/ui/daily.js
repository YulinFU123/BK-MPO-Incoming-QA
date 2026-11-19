'use strict';
/** Daily screen state. All exports use an immutable analysis result and revision. */
const DAILY_DEFAULT_QUERY = {
  scope: '', production_scope: '', start: '', end: '', status: 'Rework,Scrap', period: 'day',
  employees: [], exclude: [], process: [], floor: [], product: [], shift: [], top: 10,
  chart_order: [], omit_charts: [],
};
const D = {
  config: { templates: [] }, history: [], q: clone(DAILY_DEFAULT_QUERY), result: null,
  key: '', charts: [], hidden: new Set(), path: '', kind: 'quality', scope: '', mapping: {},
  replace: false, working: false, ready: false, loading: false, error: '', output: '',
};
let dailySaveQueue = Promise.resolve();

function dkey(query) {
  const value = { ...query };
  delete value.chart_order;
  delete value.omit_charts;
  return JSON.stringify(Object.keys(value).sort().map(key => [key, value[key]]));
}

function dbtn(label, action) {
  return h('button', { class: 'btn', type: 'button', onclick: async event => {
    const button = event.currentTarget;
    if (button.disabled) return;
    button.disabled = true;
    try { await action(); } catch (error) { toast(error.message || String(error), 'bad'); }
    finally { button.disabled = false; }
  } }, label);
}

async function dailyInit({ restoreQuery = !D.ready } = {}) {
  if (D.loading) return false;
  D.loading = true;
  const response = await api('/api/daily/state', {});
  D.loading = false;
  if (!response.ok) {
    D.error = response.error || '日报配置读取失败，请检查程序日志。';
    if (S.page === 'daily') render();
    return false;
  }
  D.history = response.history;
  if (restoreQuery) {
    D.config = response.config;
    D.q = { ...clone(DAILY_DEFAULT_QUERY), ...(D.config.query || {}) };
    D.mapping = D.config.production_mapping || {};
  }
  D.ready = true;
  D.error = '';
  if (S.page === 'daily') render();
  return true;
}

function dailySave() {
  D.config.query = clone(D.q);
  const config = clone(D.config);
  dailySaveQueue = dailySaveQueue.catch(() => false).then(async () => {
    const response = await api('/api/daily/save', { config });
    return response.ok === true;
  });
  return dailySaveQueue;
}

function ddirty() {
  const notice = $('#daily-stale');
  if (notice) notice.textContent = '筛选已更改，请更新分析后导出。';
}

async function dailyAnalyze(queryOverride = null) {
  if (D.working) { toast('正在处理，请稍候'); return null; }
  D.working = true;
  busy('读取日报快照…');
  try {
    const query = clone(queryOverride || D.q);
    const response = await api('/api/daily/analyze', { query });
    if (!response.ok) return null;
    D.q = { ...clone(DAILY_DEFAULT_QUERY), ...response.applied_query };
    D.result = response;
    D.key = dkey(D.q);
    await dailySave();
    if (S.page === 'daily') render();
    return response;
  } finally { D.working = false; busy(); }
}

async function dailyExport() {
  if (D.working) { toast('正在处理，请稍候'); return { ok: false }; }
  if (!D.result || D.key !== dkey(D.q)) {
    toast('请先更新分析，确保图表与筛选一致', 'bad');
    return { ok: false };
  }
  D.working = true;
  busy('生成邮件草稿、Excel和清晰图片…');
  const query = clone(D.q);
  const result = D.result;
  let output = '';
  try {
    const response = await api('/api/daily/export', { query, expected_revision: result.revision });
    if (!response.ok) return { ok: false };
    output = response.path;
    D.output = output; // Keep a usable link even when later image rendering fails.
    const images = [];
    for (const chart of dailyChartDefinitions(result, query)) {
      if ((query.omit_charts || []).includes(chart.title)) continue;
      for (const page of dailyChartPages(chart, result, query)) {
        images.push({ title: page.title, data: await dpng(page.svg) });
      }
    }
    const saved = await api('/api/daily/images', { path: output, token: response.token, images });
    if (!saved.ok) return { ok: false, path: output };
    toast(`已生成${images.length}张图片、Excel和邮件草稿；未发送邮件`);
    return { ok: true, path: output };
  } catch (error) {
    toast(`日报素材未全部完成：${error.message}${output ? '；Excel与正文已保留，可打开输出文件夹。' : ''}`, 'bad');
    return { ok: false, path: output };
  } finally {
    D.working = false;
    busy();
    if (S.page === 'daily') render();
  }
}

async function dailyImport() {
  if (!D.path) return toast('请先选择Excel或CSV文件');
  if (D.working) return toast('正在处理，请稍候');
  D.working = true;
  busy('校验并保存历史…');
  try {
    const response = await api('/api/daily/import', {
      kind: D.kind, scope: D.scope, path: D.path, replace: D.replace, mapping: D.mapping,
    });
    if (!response.ok) return;
    if (D.kind === 'quality') D.q.scope = D.scope.trim();
    else {
      D.q.production_scope = D.scope.trim();
      D.mapping = response.mapping;
      D.config.production_mapping = clone(response.mapping);
    }
    await dailySave();
    D.result = null;
    toast(response.results.map(row => `${row.date} ${row.state} ${row.rows}行`).join('；'));
    await dailyInit({ restoreQuery: false });
  } finally { D.working = false; busy(); }
}

function dailyImportPanel() {
  const panel = h('details', {}, h('summary', {}, '① 手动导入并保存历史 / 可选产量表'));
  panel.append(field('数据类型', sel([
    { v: 'quality', t: 'BI质量表' }, { v: 'production', t: '产量表（可选）' },
  ], D.kind, value => { D.kind = value; render(); })),
  field('来源范围名称', inp(D.scope, value => D.scope = value, { placeholder: '例如：BK5F_六类连接器_不良明细' })),
  dbtn('选择Excel / CSV', async () => {
    const response = await api('/api/pick', { kind: 'file' });
    if (response.path) { D.path = response.path; render(); }
  }), h('p', {}, D.path || '尚未选文件'),
  h('label', {}, h('input', { type: 'checkbox', checked: D.replace, onchange: event => D.replace = event.target.checked }),
    '替换同范围同业务日快照（必须是完整范围；旧版保留）'));
  if (D.kind === 'production') {
    panel.append(h('p', {}, '支持首个工作表及UTF-8 CSV。日期、工序、产量和单位必填；可覆盖自动识别的列名。'));
    const labels = { date: '日期', process: '工序', qty: '产量', unit: '单位', floor: '楼层（选填）',
      product: '产品（选填）', employee: '员工（选填）', shift: '生产班别（选填）' };
    for (const [key, label] of Object.entries(labels)) panel.append(field(label, inp(D.mapping[key] || '', value => D.mapping[key] = value)));
  }
  panel.append(dbtn('导入并保存历史', dailyImport), h('p', {}, '最近导入：'),
    h('pre', { style: { maxHeight: '160px', overflow: 'auto' } }, D.history.slice(0, 15).map(row =>
      `${row.date}｜${row.kind === 'quality' ? '质量' : '产量'}｜${row.scope}｜${row.active ? '生效' : '旧版'}｜${row.created}`).join('\n')));
  return panel;
}

function dailyFilters() {
  const scopes = uniq(D.history.filter(row => row.kind === 'quality' && row.active).map(row => row.scope));
  const production = uniq(D.history.filter(row => row.kind === 'production' && row.active).map(row => row.scope));
  const change = key => value => { D.q[key] = value; ddirty(); };
  const filters = h('div', { class: 'g3' });
  filters.append(field('质量来源范围', sel(scopes, D.q.scope, value => {
    D.q.scope = value; D.result = null; ddirty(); render();
  }, { blank: '选择已导入范围' })),
  field('产量来源（可选）', sel(production, D.q.production_scope, change('production_scope'), { blank: '未导入' })),
  field('处置口径', sel(Object.entries(DAILY_STATUS_LABELS).map(([v, t]) => ({ v, t })), D.q.status, change('status'))),
  field('起始业务日', inp(D.q.start, change('start'), { type: 'date', 'data-daily-date': 'start' })),
  field('结束业务日', inp(D.q.end, change('end'), { type: 'date', 'data-daily-date': 'end' })),
  field('趋势周期', sel([{ v: 'day', t: '日' }, { v: 'week', t: '自然周' }, { v: 'month', t: '自然月' }], D.q.period, change('period'))));
  const box = card('② 日报范围与模板', '每次分析一个来源范围；责任人筛选不改变产量范围。', null, filters);
  box.append(sel(D.config.templates.map(template => template.name), '', value => {
    const template = D.config.templates.find(item => item.name === value);
    if (template) { D.q = { ...clone(DAILY_DEFAULT_QUERY), ...clone(template.query) }; D.result = null; render(); }
  }, { blank: '加载工序/名单日报模板' }), dbtn('保存当前模板', async () => {
    const name = prompt('模板名称（会保存当前日期，次日使用请检查日期）');
    if (!name?.trim()) return;
    const template = { name: name.trim(), query: clone(D.q) };
    const index = D.config.templates.findIndex(item => item.name === template.name);
    if (index >= 0) {
      if (!confirm('已有同名模板，是否替换？')) return;
      D.config.templates[index] = template;
    } else D.config.templates.push(template);
    if (await dailySave()) { toast('模板已保存'); render(); }
  }));
  return box;
}

function dailyPeoplePanel() {
  const panel = h('details', {}, h('summary', {}, '责任人员名单、工序、楼层、产品与报检班别筛选'));
  const options = D.result?.options || {};
  for (const [key, title] of Object.entries({ process: '责任工序', floor: '记录楼层', product: '连接器类型',
    shift: '报检班别', employees: '责任人员：只看', exclude: '责任人员：排除' })) {
    panel.append(field(title, searchChoices(options[['employees', 'exclude'].includes(key) ? 'employee' : key] || [], D.q[key], ddirty)));
  }
  const paste = h('textarea', { placeholder: '从Excel粘贴责任人员姓名，每行一人', style: { width: '100%', minHeight: '90px' } });
  panel.append(paste, dbtn('将粘贴名单加入“只看”', () => {
    for (const name of splitv(paste.value.replace(/\t/g, '\n'))) if (!D.q.employees.includes(name)) D.q.employees.push(name);
    ddirty(); render();
  }), dbtn('清除所有人员限制', () => { D.q.employees = []; D.q.exclude = []; ddirty(); render(); }),
  field('排行显示', sel([{ v: '5', t: 'TOP5' }, { v: '10', t: 'TOP10' }, { v: '20', t: 'TOP20' },
    { v: '0', t: '全部（长图自动分页）' }], String(D.q.top), value => { D.q.top = Number(value); ddirty(); })));
  return panel;
}

function dailyResults(element) {
  const result = D.result;
  if (!result) return;
  element.append(h('div', { class: 'g3' }, kpi('当前数量', fmt(result.quantity), '按Sum of Qty汇总'),
    kpi('明细记录', result.count, '含多次报检，非产品去重数'),
    kpi('产量', result.production.length ? '已匹配' : '未导入或无匹配', '按工序与单位分列')),
    banner('warn', result.warnings.join(' ')));
  if (result.filtered_out.length) element.append(banner('warn', '当前条件下无记录的名单人员：' + result.filtered_out.join('、')));
  if (result.unmatched.length) element.append(banner('warn', '该来源中未找到的姓名：' + result.unmatched.join('、')));
  if (result.production.length) element.append(card('产量汇总', '未按责任人员或报检班别筛选，不计算个人不良率', null,
    h('pre', {}, result.production.map(row => `${row.process}：${fmt(row.qty)} ${row.unit}`).join('\n'))));
  element.append(h('p', {}, '③ 勾选邮件图表并调整顺序；全部排行保留在Excel中。'));
  const charts = dailyChartDefinitions(result, D.q);
  D.charts = []; D.hidden.clear();
  const move = async (index, offset) => {
    if (!charts[index + offset]) return;
    const names = charts.map(chart => chart.title);
    [names[index], names[index + offset]] = [names[index + offset], names[index]];
    D.q.chart_order = names; await dailySave(); render();
  };
  charts.forEach((chart, index) => {
    const pages = dailyChartPages(chart, result, result.applied_query);
    const omitted = D.q.omit_charts.includes(chart.title);
    if (omitted) D.hidden.add(index);
    D.charts.push(pages[0].svg);
    const block = h('div', { class: 'card', style: { marginBottom: '18px', padding: '16px' } },
      h('label', {}, h('input', { type: 'checkbox', checked: !omitted, onchange: async event => {
        D.q.omit_charts = D.q.omit_charts.filter(title => title !== chart.title);
        if (!event.target.checked) D.q.omit_charts.push(chart.title);
        await dailySave();
      } }), '加入邮件图片包'), dbtn('上移', () => move(index, -1)), dbtn('下移', () => move(index, 1)));
    for (const page of pages) block.append(page.svg, dbtn('下载本页PNG', async () => {
      if (D.key !== dkey(D.q)) return toast('请先更新分析', 'bad');
      const link = document.createElement('a');
      link.href = await dpng(page.svg); link.download = `${index + 1}_${page.title.replace(/[\\/:*?"<>|]/g, '_')}.png`; link.click();
    }));
    element.append(block);
  });
}

PAGES.daily = element => {
  if (!D.ready) {
    if (D.error) element.append(banner('bad', D.error), dbtn('重新读取日报配置', () => dailyInit()));
    else { element.append(h('p', {}, '读取日报配置…')); if (!D.loading) dailyInit(); }
    return;
  }
  element.append(banner('info', '责任人员来自Employee in Charge；Shift仅为报检班别。新版日报与旧V9报表的历史和配置相互独立。'),
    dailyImportPanel(), dailyFilters(), dailyPeoplePanel(),
    h('div', { class: 'gap' }, dbtn('更新分析 / 预览日报', () => dailyAnalyze()), dbtn('一键导出邮件素材', dailyExport)),
    h('p', { id: 'daily-stale', class: 'hint' }, D.result && D.key !== dkey(D.q) ? '筛选已更改，请更新分析。' : ''));
  if (D.output) element.append(dbtn('打开最近日报文件夹', () => api('/api/open', { what: 'file', path: D.output })));
  dailyResults(element);
};
