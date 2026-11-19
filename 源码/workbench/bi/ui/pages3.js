'use strict';
/* ============ 图表中心 ============ */
const SV = (inner) => `<svg viewBox="0 0 54 36" fill="none">${inner}</svg>`;
const CH_ICONS = {
  '横向条形图': SV('<rect x="4" y="4" width="40" height="6" rx="1" fill="#d64545"/><rect x="4" y="14" width="30" height="6" rx="1" fill="#e8a317"/><rect x="4" y="24" width="20" height="6" rx="1" fill="#9db7d6"/>'),
  '柱形图': SV('<rect x="6" y="14" width="7" height="18" fill="#2e75b6"/><rect x="14" y="8" width="7" height="24" fill="#ed7d31"/><rect x="26" y="20" width="7" height="12" fill="#2e75b6"/><rect x="34" y="12" width="7" height="20" fill="#ed7d31"/>'),
  '堆积柱形图': SV('<rect x="6" y="18" width="10" height="14" fill="#2e75b6"/><rect x="6" y="8" width="10" height="10" fill="#ed7d31"/><rect x="22" y="14" width="10" height="18" fill="#2e75b6"/><rect x="22" y="6" width="10" height="8" fill="#ed7d31"/><rect x="38" y="22" width="10" height="10" fill="#2e75b6"/><rect x="38" y="16" width="10" height="6" fill="#ed7d31"/>'),
  '百分比堆积柱形图': SV('<rect x="6" y="20" width="10" height="12" fill="#2e75b6"/><rect x="6" y="4" width="10" height="16" fill="#ed7d31"/><rect x="22" y="14" width="10" height="18" fill="#2e75b6"/><rect x="22" y="4" width="10" height="10" fill="#ed7d31"/><rect x="38" y="24" width="10" height="8" fill="#2e75b6"/><rect x="38" y="4" width="10" height="20" fill="#ed7d31"/>'),
  '堆积条形图': SV('<rect x="4" y="4" width="22" height="7" fill="#2e75b6"/><rect x="26" y="4" width="14" height="7" fill="#ed7d31"/><rect x="4" y="15" width="16" height="7" fill="#2e75b6"/><rect x="20" y="15" width="22" height="7" fill="#ed7d31"/><rect x="4" y="26" width="30" height="7" fill="#2e75b6"/><rect x="34" y="26" width="8" height="7" fill="#ed7d31"/>'),
  '折线图': SV('<polyline points="4,28 14,18 24,22 34,10 48,14" stroke="#2e75b6" stroke-width="2.2"/><circle cx="14" cy="18" r="2.2" fill="#2e75b6"/><circle cx="34" cy="10" r="2.2" fill="#2e75b6"/><polyline points="4,32 14,26 24,28 34,22 48,24" stroke="#ed7d31" stroke-width="2"/>'),
  '柱线组合图': SV('<rect x="6" y="18" width="7" height="14" fill="#9dc3e6"/><rect x="17" y="12" width="7" height="20" fill="#9dc3e6"/><rect x="28" y="20" width="7" height="12" fill="#9dc3e6"/><rect x="39" y="8" width="7" height="24" fill="#9dc3e6"/><polyline points="9,12 20,8 31,14 42,5" stroke="#c00000" stroke-width="2"/>'),
  '帕累托图': SV('<rect x="5" y="6" width="8" height="26" fill="#2e75b6"/><rect x="15" y="14" width="8" height="18" fill="#2e75b6"/><rect x="25" y="22" width="8" height="10" fill="#2e75b6"/><rect x="35" y="27" width="8" height="5" fill="#2e75b6"/><polyline points="9,16 19,9 29,6 39,4" stroke="#c00000" stroke-width="2"/>'),
  '饼图': SV('<circle cx="27" cy="18" r="14" fill="#4472c4"/><path d="M27 18 L27 4 A14 14 0 0 1 40 22 Z" fill="#c00000"/><path d="M27 18 L40 22 A14 14 0 0 1 20 31 Z" fill="#ed7d31"/>'),
  '圆环图': SV('<circle cx="27" cy="18" r="11" stroke="#4472c4" stroke-width="7"/><circle cx="27" cy="18" r="11" stroke="#c00000" stroke-width="7" stroke-dasharray="26 70" transform="rotate(-90 27 18)"/><circle cx="27" cy="18" r="11" stroke="#ed7d31" stroke-width="7" stroke-dasharray="18 70" stroke-dashoffset="-26" transform="rotate(-90 27 18)"/>'),
  '直方图': SV('<rect x="6" y="22" width="8" height="10" fill="#2e75b6"/><rect x="14" y="8" width="8" height="24" fill="#2e75b6"/><rect x="22" y="14" width="8" height="18" fill="#2e75b6"/><rect x="30" y="24" width="8" height="8" fill="#2e75b6"/><rect x="38" y="28" width="8" height="4" fill="#2e75b6"/>'),
  '热力图': SV([0, 1, 2, 3].map(r => [0, 1, 2, 3, 4].map(c => `<rect x="${6 + c * 9}" y="${4 + r * 8}" width="8" height="7" fill="#d64545" opacity="${[.15, .35, .6, .9, .25, .5, .8, .2, .45, .7, .3, .55][(r * 5 + c) % 12]}"/>`).join('')).join(''))
};
const CH_HINT = { '横向条形图': '排名：谁/哪种最多（自动红橙预警）', '柱形图': '分类对比；加“系列”变聚集柱', '堆积柱形图': '看构成：每日按工序/产品堆积', '百分比堆积柱形图': '看结构占比的变化', '堆积条形图': '排名 + 构成',
  '折线图': '看趋势：分类选“业务日期”', '柱线组合图': '每日 pcs(柱)+不良率(线)', '帕累托图': '找主要问题：柱 pcs + 累计占比', '饼图': '占比（其余并入“其他”）', '圆环图': '占比（环形）', '直方图': '分布：多少人处于各件数区间', '热力图': '人员×不良：颜色越深越集中' };
const PRESETS = [
  { title: '各工序不良占比', type: '饼图', cat: '责任工序', ser: '', metric: 'pcs', top: 8, sort: '降序' }, { title: '人员不良TOP15', type: '横向条形图', cat: '责任员工', ser: '', metric: 'pcs', top: 15, sort: '降序' },
  { title: '不良项目帕累托', type: '帕累托图', cat: '标准不良项目', ser: '', metric: 'pcs', top: 12, sort: '降序' }, { title: '每日不良（按产品堆积）', type: '堆积柱形图', cat: '业务日期', ser: '产品类别', metric: 'pcs', top: 30, sort: '日期', range: '最近14天' },
  { title: '每日不良pcs与不良率', type: '柱线组合图', cat: '业务日期', ser: '', metric: 'pcs', top: 30, sort: '日期', range: '最近14天' }, { title: '班别不良占比', type: '圆环图', cat: '班别', ser: '', metric: 'pcs', top: 5, sort: '降序' }];
PAGES.charts = el => {
  const list = S.cfg.charts, names = schemeNames();
  if (S.sel.chart >= list.length) S.sel.chart = Math.max(0, list.length - 1);
  const c = list[S.sel.chart];
  const left = h('div', { class: 'list' }, h('div', { style: { padding: '6px 6px 10px' } }, h('button', { class: 'btn pri', style: { width: '100%' }, onclick: () => { list.push({ enabled: true, page: '自定义图表', title: '新图表', type: '横向条形图', scheme: names[0] || '', cat: '责任员工', ser: '', metric: 'pcs', top: 15, sort: '降序', range: '' }); S.sel.chart = list.length - 1; touch(); render(); } }, '+ 新建图表')),
    list.map((x, i) => h('div', { class: 'item' + (i === S.sel.chart ? ' on' : '') + (x.enabled === false ? ' off' : ''), onclick: () => { S.sel.chart = i; render(); } }, toggle(x.enabled !== false, v => { x.enabled = v; touch(); render(); }, true),
      h('div', {}, h('div', { class: 'nm' }, x.title || '（未命名）'), h('div', { class: 'ds' }, `${x.type} · ${x.scheme || '全部'}`)))));
  const right = h('div', {});
  if (!c) right.append(empty('还没有图表'));
  else {
    const dims = uniq([...S.meta.dims, ...(((S.scan || {}).columns || []).map(x => x.name))]);
    const warns = [];
    if (c.metric === '不良率' && c.cat !== '业务日期') warns.push('指标“不良率”只在分类=业务日期 且已填【每日检查量】时有效，否则自动改用 pcs');
    if (c.type === '热力图' && !c.ser) warns.push('热力图需要“系列字段”（如 标准不良项目），否则无法生成');
    if (c.type === '直方图' && c.metric !== '人数') warns.push('直方图统计“多少人处于各件数区间”，指标建议选“人数”');
    if (['折线图', '柱线组合图'].includes(c.type) && c.cat !== '业务日期') warns.push('折线/组合图用于看趋势，分类建议选“业务日期”');
    if (c.scheme && !names.includes(c.scheme)) warns.push(`数据方案【${c.scheme}】不存在或未启用，将改用全部数据`);
    right.append(card('图表类型', '点选一种', h('div', { class: 'gap' }, h('button', { class: 'btn sm', onclick: () => { const n = clone(c); n.title += '（副本）'; list.splice(S.sel.chart + 1, 0, n); S.sel.chart++; touch(); render(); } }, '复制'),
      h('button', { class: 'btn sm danger', onclick: () => { if (confirm(`删除图表【${c.title}】？`)) { list.splice(S.sel.chart, 1); touch(); render(); } } }, '删除')),
      h('div', { class: 'tiles' }, S.meta.chart_types.map(t => h('div', { class: 'tile' + (c.type === t ? ' on' : ''), onclick: () => { c.type = t; touch(); render(); } }, h('div', { html: CH_ICONS[t] }), h('div', {}, t), h('small', {}, CH_HINT[t]))))));
    right.append(card('数据与字段', null, null, warns.map(w => banner('warn', w)),
      h('div', { class: 'g2' }, field('图表标题', inp(c.title, v => { c.title = v; touch(); drawNav(); })), field('放在哪一页', seg(['自定义图表', '每日驾驶舱'], c.page || '自定义图表', v => { c.page = v; touch(); }), '“每日驾驶舱”= 追加到驾驶舱底部（热力图只能放自定义图表页）')),
      h('div', { class: 'g3 mt' }, field('数据方案', sel(names, c.scheme, v => { c.scheme = v; touch(); render(); }, { blank: '全部数据' })), field('分类字段（横轴 / 分组）', sel(dims, c.cat, v => { c.cat = v; touch(); render(); })),
        field('系列字段（可选，分色/分组）', sel(dims, c.ser || '', v => { c.ser = v; touch(); render(); }, { blank: '（无）' }))),
      h('div', { class: 'g4 mt' }, field('指标', sel(['pcs', '占比', '不良率', '人数'], c.metric || 'pcs', v => { c.metric = v; touch(); render(); })), field('显示前 N 项', h('input', { type: 'number', min: 1, max: 100, value: c.top, oninput: e => { c.top = e.target.value; touch(); } })),
        field('排序', sel(['降序', '升序', '日期'], c.sort || '降序', v => { c.sort = v; touch(); }, { blank: '默认' })), field('日期范围', sel(S.meta.ranges, c.range || '', v => { c.range = v; touch(); }, { blank: '沿用“分析窗口”' })))));
  }
  el.append(h('div', { class: 'split' }, left, right));
  el.append(card('快速添加常用图表', '一键加入，再到右侧微调', null, h('div', { class: 'chips' }, PRESETS.map(p => h('span', { class: 'chip', onclick: () => { list.push(Object.assign({ enabled: true, page: '自定义图表', scheme: names.includes('全部工序') ? '全部工序' : (names[0] || ''), range: '' }, clone(p))); S.sel.chart = list.length - 1; touch(); render(); toast('已添加：' + p.title, 'ok'); } }, '+ ' + p.title)))));
};

/* ============ 驾驶舱设置 ============ */
function num_(label, key, hint, step, w) { const P = P_(); return field(label, h('input', { type: 'number', step: step || 1, min: 0, value: parseFloat(P[key]) || 0, oninput: e => { P[key] = e.target.value; touch(); } }), hint); }
function pctIn(label, key, hint) { const P = P_(); const v = parseFloat(P[key]) || 0; return field(label, h('div', { class: 'gap', style: { flexWrap: 'nowrap' } }, h('input', { type: 'number', step: .01, min: 0, value: v, oninput: e => { P[key] = e.target.value + '%'; touch(); drawNav(); } }), h('b', {}, '%')), hint); }
PAGES.dash = el => {
  const P = P_(), names = schemeNames(), sc = S.scan || {};
  el.append(card('驾驶舱使用的筛选方案', '方案在【筛选方案】里定义', null, h('div', { class: 'g2' },
    field('看板方案（驾驶舱 / 趋势分析用）', sel(names, P['看板方案'], v => { P['看板方案'] = v; touch(); drawNav(); }), '默认口径：前端工序 + “看板监控”不良组；请按实际核对'),
    field('月度风险方案（月度 / 风险页用）', sel(names, P['月度风险方案'], v => { P['月度风险方案'] = v; touch(); drawNav(); }), '一般选“全部工序”'))));
  el.append(card('分析窗口', null, null, h('div', { class: 'g4' },
    field('分析窗口', sel(S.meta.ranges.filter(x => x !== '单日'), P['分析窗口'], v => { P['分析窗口'] = v; touch(); render(); })),
    field('基准日期', h('input', { type: 'date', value: P['基准日期'], onchange: e => { P['基准日期'] = e.target.value; touch(); } }), '留空 = 数据里最新的业务日'),
    field('方案分析表范围', sel(S.meta.ranges, P['方案分析表范围'], v => { P['方案分析表范围'] = v; touch(); }), '每个方案分析表的默认日期范围'),
    num_('趋势回看天数', '趋势回看天数', '判断新增/复发/连续上升往前看多少个生产日')),
    P['分析窗口'] === '自定义' ? h('div', { class: 'g2 mt' }, field('自定义开始日期', h('input', { type: 'date', value: P['自定义开始日期'], onchange: e => { P['自定义开始日期'] = e.target.value; touch(); } })), field('自定义结束日期', h('input', { type: 'date', value: P['自定义结束日期'], onchange: e => { P['自定义结束日期'] = e.target.value; touch(); } }))) : null));
  const monOpts = uniq([...S.meta.monitor, ...((sc.items || []).slice(0, 40).map(x => x.v)), ...splitv(P['专项不良项目'])]);
  const cur = splitv(P['专项不良项目']);
  el.append(card('专项不良项目', '驾驶舱下方为每个项目单独画“责任人分布图”', null,
    chips(monOpts, cur, s => { P['专项不良项目'] = s.join('、'); touch(); drawNav(); }, {}),
    h('div', { class: 'g3 mt' }, field('统计范围', seg(['当日', '分析窗口'], P['专项图统计范围'], v => { P['专项图统计范围'] = v; touch(); })), num_('每张图显示前 N 名责任人', '专项图人员TOP'), num_('趋势矩阵最多行数', '矩阵最多行数'))));
  const prods = splitv(P['产品类别']), cols = splitv(P['产品类别颜色']);
  const setCols = () => { P['产品类别颜色'] = cols.join('、'); touch(); };
  el.append(card('产品类别与目标线', null, null, h('div', { class: 'g2' },
    h('div', {}, field('产品类别（图例/矩阵顺序）', tags(prods, v => { P['产品类别'] = v.join('、'); touch(); render(); }, '如 MPO')),
      h('div', { class: 'gap mt' }, prods.map((p, i) => h('div', { class: 'gap', style: { gap: '6px' } }, h('input', { type: 'color', value: '#' + (cols[i] || 'BFBFBF'), oninput: e => { cols[i] = e.target.value.slice(1).toUpperCase(); setCols(); } }), h('b', {}, p))))),
    h('div', { class: 'g2' }, pctIn('目标不良率', '目标不良率', '图上绿色虚线'), pctIn('预警不良率', '预警不良率', '超过则驾驶舱亮红灯')))));
  const T = [['连续上升红灯天数', '连续上升达到此天数 = 红'], ['连续上升橙灯天数', '达到此天数 = 橙'], ['明显上升倍数', '当日 ≥ 前7日均值×此倍数 = 红', .1], ['预警最少pcs', '低于此值不触发趋势预警'],
    ['重复异常天数红', '窗口内出现天数 ≥ 此值 = 红'], ['重复异常天数橙', '≥ 此值 = 橙'], ['复发判定零天数', '连续这么多天为0后再出现 = 复发'], ['持续出现天数', '近7天出现天数 ≥ 此值 = 持续异常']];
  const PC = [['矩阵上升红色%', '较前一日上升超过此比例（且≥2pcs）标红'], ['矩阵上升橙色%', '上升超过此比例标橙'], ['矩阵下降绿色%', '下降超过此比例标绿'], ['集中度高阈值', 'TOP1人员占比 ≥ 此值 = 高度集中（优先查人员）'], ['集中度中阈值', '介于中/高之间 = 中度集中；低于 = 分散（查工艺/物料）']];
  el.append(card('趋势与预警参数', null, null, h('div', { class: 'g4' }, T.map(t => num_(t[0], t[0], t[1], t[2] || 1))), h('div', { class: 'g3 mt' }, PC.map(t => pctIn(t[0], t[0], t[1])))));
  const OUT = [['输出驾驶舱', '01 每日驾驶舱'], ['输出趋势分析', '02 趋势分析'], ['输出月度分析', '03 月度分析'], ['输出风险与集中度', '04 风险与集中度'], ['输出自定义图表', '06 自定义图表'], ['输出方案分析表', '各方案分析表'], ['输出改善项目', '07 改善项目']];
  el.append(card('输出内容与分析表', null, null, h('div', { class: 'g4' }, OUT.map(o => h('div', { class: 'gap' }, toggle(P[o[0]] === '是', v => { P[o[0]] = v ? '是' : '否'; touch(); }), h('span', {}, o[1])))),
    h('div', { class: 'g3 mt2' }, num_('方案表：人员图显示前 N 名', '图表人员TOP'), num_('方案表：不良图显示前 N 种', '图表不良TOP'), num_('交叉表最多列数', '交叉表最多列数'))));
};

/* ============ 预警规则 ============ */
const ALERT_DESC = { '人员': '各方案分析表的人员排名', '人员总览': '月度分析里人员TOP（占全部）', '不良': '不良代码 / 项目排名', '工序': '工序占比', '不良大类': '不良大类排名', '班别': '班别分布' };
PAGES.alerts = el => {
  const A = S.cfg.alerts;
  el.append(banner('info', '超过【红线】= 红色，超过【橙线】= 橙色，其余 = 正常色；件数少于“最少 pcs”不预警（避免 1 件就 100%）。依据选“占比”时线填百分比，选“pcs”时线填件数。'));
  el.append(card('预警规则', null, null, h('div', { class: 'scroll', style: { maxHeight: 'none' } }, h('table', { class: 't' },
    h('thead', {}, h('tr', {}, ['对象', '依据', '红线', '橙线', '最少 pcs', '红色', '橙色', '正常色', '效果预览'].map(x => h('th', {}, x)))),
    h('tbody', {}, S.meta.alert_keys.map(k => {
      const a = A[k] || (A[k] = { 依据: '占比', 红线: '20%', 橙线: '10%', 最少pcs: 3, 红色: 'E00000', 橙色: 'FF9900', 正常色: 'C9D6E8' });
      const pv = h('div', { class: 'alertbar' });
      const draw = () => { pv.innerHTML = ''; [['红色', `≥${a.红线}${a.依据 === 'pcs' ? 'pcs' : ''}`], ['橙色', `≥${a.橙线}${a.依据 === 'pcs' ? 'pcs' : ''}`], ['正常色', '其余']].forEach(([c, t]) => pv.append(h('span', { style: { flex: 1, background: '#' + a[c], color: '#fff', fontSize: '11px', textAlign: 'center', lineHeight: '16px', textShadow: '0 0 2px rgba(0,0,0,.5)' } }, t))); };
      draw();
      const upd = (f, v) => { a[f] = v; touch(); draw(); };
      return h('tr', {}, h('td', {}, h('b', {}, k), h('div', { class: 'hint' }, ALERT_DESC[k])), h('td', {}, seg(['占比', 'pcs'], a.依据, v => { upd('依据', v); })),
        h('td', { style: { width: '90px' } }, inp(a.红线, v => upd('红线', v))), h('td', { style: { width: '90px' } }, inp(a.橙线, v => upd('橙线', v))), h('td', { style: { width: '80px' } }, h('input', { type: 'number', min: 0, value: a.最少pcs, oninput: e => upd('最少pcs', e.target.value) })),
        ['红色', '橙色', '正常色'].map(f => h('td', {}, h('input', { type: 'color', value: '#' + a[f], oninput: e => upd(f, e.target.value.slice(1).toUpperCase()) }))), h('td', {}, pv));
    })))),
    h('div', { class: 'hint mt' }, '占比示例：8% 或 0.08 都可以；pcs 示例：5。')));
};

/* ============ 每日检查量 ============ */
PAGES.chk = el => {
  const C = S.cfg.chk, keys = Object.keys(C).sort();
  const ta = h('textarea', { placeholder: '每行：日期 检查量（空格/Tab/逗号分隔），可直接从 Excel 粘贴两列\n2026-10-13  82079\n2026-10-14  85018', style: { minHeight: '110px' } });
  el.append(card('填写检查量', '不良率 = 看板方案不良 pcs ÷ 当日检查量，口径需与看板方案一致', null,
    h('div', { class: 'split', style: { gridTemplateColumns: '1fr 280px' } }, ta, h('div', { class: 'gap', style: { alignContent: 'flex-start' } },
      h('button', { class: 'btn pri', onclick: () => {
        let n = 0; ta.value.split(/\n/).forEach(l => { const m = l.trim().match(/^(\d{4})[-\/.年](\d{1,2})[-\/.月](\d{1,2})日?[\s,，;\t]+([\d,\.]+)/); if (m) { C[`${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`] = parseFloat(m[4].replace(/,/g, '')); n++; } });
        if (!n) return toast('没有识别到有效行（格式：2026-10-13 82079）', 'bad'); ta.value = ''; touch(); render(); toast(`已导入 ${n} 天`, 'ok');
      } }, '导入粘贴内容'),
      h('button', { class: 'btn', onclick: () => { const d = ((S.scan || {}).days || []).map(x => x.d).filter(x => !(x in C)); if (!d.length) return toast('数据里的日期都已在表中'); d.forEach(x => C[x] = ''); touch(); render(); } }, '补全数据里已有的日期'),
      h('button', { class: 'btn', onclick: () => { const t = new Date().toISOString().slice(0, 10); if (!(t in C)) C[t] = ''; touch(); render(); } }, '+ 今天')))));
  const vals = keys.map(k => parseFloat(C[k])).filter(v => v > 0);
  el.append(card(`已填 ${vals.length} 天`, vals.length ? `日均 ${fmt(vals.reduce((a, b) => a + b, 0) / vals.length)} · 最高 ${fmt(Math.max(...vals))} · 最低 ${fmt(Math.min(...vals))}` : '', null,
    vals.length ? h('div', { style: { marginBottom: '12px' } }, miniDays(keys.filter(k => parseFloat(C[k]) > 0).map(k => ({ d: k, n: parseFloat(C[k]) })), 90)) : null,
    keys.length ? h('div', { class: 'scroll', style: { maxHeight: '400px' } }, h('table', { class: 't' }, h('thead', {}, h('tr', {}, ['日期', '检查量', '该日是否有数据', ''].map(x => h('th', {}, x)))),
      h('tbody', {}, keys.map(k => h('tr', {}, h('td', { style: { width: '170px' } }, h('b', {}, k)), h('td', { style: { width: '200px' } }, h('input', { type: 'number', min: 0, value: C[k], oninput: e => { C[k] = e.target.value; touch(); } })),
        h('td', {}, ((S.scan || {}).days || []).some(x => x.d === k) ? h('span', { class: 'pill ok' }, '有') : h('span', { class: 'pill' }, '无')), h('td', {}, h('button', { class: 'btn sm ghost danger', onclick: () => { delete C[k]; touch(); render(); } }, '删除'))))))) : empty('还没有数据。在上方粘贴，或点“补全数据里已有的日期”再逐日填写。')));
};

/* ============ 改善项目 ============ */
PAGES.improve = el => {
  const list = S.cfg.improve, sc = S.scan || {};
  el.append(card('改善项目', '登记项目和开始日期，报表自动对比改善前后每日平均不良 pcs', h('button', { class: 'btn pri sm', onclick: () => { list.push({ enabled: true, name: '新改善项目', item: '', proc: '', owner: '', start: new Date().toISOString().slice(0, 10), plan: '', n: 7 }); touch(); render(); } }, '+ 新增项目'),
    banner('info', '判定：改善率 ≥20% = 改善有效；−10%~20% = 效果不明显；≤ −10% = 恶化；改善后不足 3 个生产日 = 数据不足。'),
    list.length ? list.map((m, i) => h('div', { style: { border: '1px solid var(--line)', borderRadius: '9px', padding: '12px 14px', marginBottom: '10px' } },
      h('div', { class: 'gap', style: { marginBottom: '8px' } }, toggle(m.enabled !== false, v => { m.enabled = v; touch(); }), h('b', {}, m.name || '（未命名）'), h('span', { class: 'sp' }), h('button', { class: 'btn sm ghost danger', onclick: () => { list.splice(i, 1); touch(); render(); } }, '删除')),
      h('div', { class: 'g4' }, field('项目名称', inp(m.name, v => { m.name = v; touch(); })), field('标准不良项目（空=全部）', sel((sc.items || []).map(x => x.v), m.item, v => { m.item = v; touch(); }, { blank: '全部' })),
        field('责任工序（空=全部）', sel((sc.procs || []).map(x => x.v), m.proc, v => { m.proc = v; touch(); }, { blank: '全部' })), field('负责人', inp(m.owner, v => { m.owner = v; touch(); }))),
      h('div', { class: 'g4 mt' }, field('开始日期', h('input', { type: 'date', value: m.start, onchange: e => { m.start = e.target.value; touch(); } })), field('计划完成', h('input', { type: 'date', value: m.plan, onchange: e => { m.plan = e.target.value; touch(); } })),
        field('对比天数', h('input', { type: 'number', min: 1, max: 60, value: m.n, oninput: e => { m.n = e.target.value; touch(); } }), '改善前/后各取几个生产日')))) : empty('还没有改善项目')));
};

/* ============ 工具与备份 ============ */
PAGES.tools = el => {
  el.append(card('导入旧版 Excel 控制台', '把之前在 不良分析_控制台.xlsx 里配置的内容搬进面板', null,
    h('div', { class: 'hint' }, '读取本程序文件夹里的 不良分析_控制台.xlsx（字段映射、筛选方案、图表配置、人员名单、不良类型、预警规则、全局筛选规则、每日检查量、改善项目、管理面板参数）。导入会覆盖面板里对应的设置。'),
    h('div', { class: 'gap mt' }, h('button', { class: 'btn pri', onclick: async () => {
      if (!confirm('导入后会覆盖面板里的筛选方案、图表、人员名单、不良类型、预警规则、检查量等设置，确定吗？')) return;
      busy('正在读取旧控制台…'); const j = await api('/api/legacy', {}); busy();
      if (j.ok) { const keep = S.cfg.paths; S.cfg = Object.assign(j.config, { paths: keep }); touch(); toast('已导入旧控制台配置', 'ok'); await scan(true); go('home'); }
    } }, '导入 不良分析_控制台.xlsx'), h('button', { class: 'btn', onclick: async () => { const p = await api('/api/pick', { kind: 'file' }); if (!p.path) return; busy('读取中…'); const j = await api('/api/legacy', { path: p.path }); busy(); if (j.ok) { const keep = S.cfg.paths; S.cfg = Object.assign(j.config, { paths: keep }); touch(); toast('已导入', 'ok'); await scan(true); go('home'); } } }, '选择其他文件…'))));
  el.append(card('备份与恢复', '配置保存在 config.json（每次保存自动生成 config.json.bak）', null, h('div', { class: 'gap' },
    h('button', { class: 'btn', onclick: () => { const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(S.cfg, null, 1)], { type: 'application/json' })), download: 'config_备份_' + new Date().toISOString().slice(0, 10) + '.json' }); document.body.append(a); a.click(); a.remove(); } }, '⬇ 导出配置'),
    h('label', { class: 'btn' }, '⬆ 导入配置', h('input', { type: 'file', accept: '.json', style: { display: 'none' }, onchange: e => { const f = e.target.files[0]; if (!f) return; f.text().then(t => { try { S.cfg = JSON.parse(t); touch(); toast('配置已导入', 'ok'); scan(true); } catch (x) { toast('不是有效的配置文件', 'bad'); } }); } })),
    h('button', { class: 'btn danger', onclick: async () => { if (!confirm('恢复默认设置？当前所有配置将被清空（建议先导出备份）。')) return; const st = await api('/api/state?default=1'); await api('/api/save', { config: st.config }); location.reload(); } }, '恢复默认设置'))));
  el.append(card('文件夹', null, null, h('div', { class: 'gap' }, h('button', { class: 'btn', onclick: () => api('/api/open', { what: 'base' }) }, '程序文件夹'), h('button', { class: 'btn', onclick: () => api('/api/open', { what: 'input', config: S.cfg }) }, '原表文件夹'),
    h('button', { class: 'btn', onclick: () => api('/api/open', { what: 'history', config: S.cfg }) }, '历史数据库'), h('button', { class: 'btn', onclick: () => api('/api/open', { what: 'output', config: S.cfg }) }, '结果文件夹'))));
  el.append(card('退出', '关闭窗口也会自动退出程序', null, h('button', { class: 'btn danger', onclick: async () => { await api('/api/exit', {}); document.body.innerHTML = '<div style="padding:60px;text-align:center;color:#6b7a90">面板已退出，可以关闭此窗口。</div>'; } }, '退出面板')));
};
