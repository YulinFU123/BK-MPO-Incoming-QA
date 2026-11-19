'use strict';
/* ============ 开始 · 生成报表 ============ */
function miniDays(days, h_ = 90) {
  const mx = Math.max(1, ...days.map(d => d.n));
  return h('div', { class: 'mini', style: { height: h_ + 'px' } }, days.map(d => h('div', { title: d.d + '：' + fmt(d.n) + ' pcs' }, h('b', {}, fmt(d.n)), h('i', { style: { height: Math.max(3, d.n / mx * (h_ - 34)) + 'px' } }), d.d.slice(5))));
}

PAGES.home = el => {
  const sc = S.scan, P = P_(), run = S.run;
  const rs = run.result || S.last, dash = rs && rs.dash;
  const lamp = dash ? ['#12a150', '#e8a317', '#d64545'][dash.lvl] : '#c5cedb';
  const ck = checks(), nb = ck.filter(c => c.level === 'bad').length;
  // ① 生成（放最上面：主操作 + 进度 + 结果）
  el.append(card('生成报表', '导入新文件 → 去重 → 按规则筛选 → 输出 Excel（驾驶舱 / 趋势 / 月度 / 风险 / 各方案分析表）', null,
    h('div', { class: 'gap' },
      h('button', { class: 'btn go', disabled: run.running, id: 'gobtn', onclick: startRun }, run.running ? '生成中…' : '▶ 开始生成报表'),
      rs && rs.output ? h('button', { class: 'btn', onclick: () => api('/api/open', { what: 'latest', config: S.cfg }) }, '打开最新报告') : null,
      rs && rs.output ? h('button', { class: 'btn', onclick: () => api('/api/open', { what: 'output', config: S.cfg }) }, '打开结果文件夹') : null,
      run.running ? h('span', { class: 'hint' }, h('span', { class: 'spin', style: { width: '14px', height: '14px', borderWidth: '2px', verticalAlign: 'middle', marginRight: '6px' } }), '正在生成，请稍候…') : null,
      !run.running && nb ? h('span', { class: 'pill bad' }, `还有 ${nb} 项必须先处理（见下方配置检查）`) : null),
    run.running ? h('div', { class: 'prog' }, h('i')) : null,
    (run.running || run.log.length) ? h('div', { class: 'log mt', id: 'runlog' }) : null,
    run.error ? h('div', { class: 'mt' }, banner('bad', '生成失败：' + run.error)) : null,
    rs && rs.output && !run.running ? h('div', { class: 'mt' },
      h('div', { class: 'row', style: { alignItems: 'center' } },
        h('div', { class: 'col' }, h('div', { class: 'gap' }, h('span', { class: 'lamp', style: { background: lamp } }), h('b', {}, '品质状态：' + (dash ? ['正常', '注意', '异常'][dash.lvl] : '—')), h('span', { class: 'hint' }, `业务日 ${rs.cur_day || ''}`)),
          dash && dash.reasons && dash.reasons.length ? h('div', { class: 'hint' }, dash.reasons.join('；')) : null),
        h('div', { class: 'col' }, h('div', { class: 'hint' }, '输出文件'), h('div', { class: 'kbd', style: { wordBreak: 'break-all' } }, rs.output)),
        S.last && S.last.time ? h('div', { class: 'col' }, h('div', { class: 'hint' }, '生成时间'), h('div', {}, S.last.time)) : null),
      (rs.warnings || []).map(w => banner('warn', w))) : null));
  if (run.running || run.log.length) setTimeout(() => { const lg = $('#runlog'); if (lg) { lg.innerHTML = ''; run.log.forEach(l => lg.append(h('div', { class: /✘|失败/.test(l) ? 'e' : /警告/.test(l) ? 'w' : /完成/.test(l) ? 'k' : '' }, l))); lg.scrollTop = lg.scrollHeight; } }, 0);

  // ② 配置检查
  el.append(card('配置检查', '生成前自动检查，红色项必须处理', null, ...ck.map(c => h('div', { class: 'check' },
    h('span', { class: 'ic ' + (c.level === 'bad' ? 'bad' : c.level === 'warn' ? 'warn' : 'ok'), style: c.level === 'info' ? { background: '#2e75b6' } : null }, c.level === 'ok' ? '✓' : c.level === 'bad' ? '✕' : c.level === 'warn' ? '!' : 'i'),
    h('span', {}, c.text), c.page ? h('a', { onclick: () => go(c.page) }, '去处理 ›') : null))));

  // ③ 放入原表
  const files = (sc && sc.files) || [];
  el.append(card('放入原表', '把每天从 Power BI / DSP 导出的 xlsx 放进文件夹（可一次放多个）',
    h('div', { class: 'gap' }, h('button', { class: 'btn', onclick: () => api('/api/open', { what: 'input', config: S.cfg }) }, '打开原表文件夹'), h('button', { class: 'btn pri', onclick: () => scan(true) }, '⟳ 扫描数据')),
    h('div', { class: 'hint', style: { marginBottom: '8px' } }, '原表文件夹：', h('span', { class: 'kbd' }, S.cfg.paths.input), '　文件名规则：', h('span', { class: 'kbd' }, S.cfg.paths.pattern), '　（可在【数据与字段】修改）'),
    files.length ? h('div', { class: 'scroll', style: { maxHeight: '190px' } }, h('table', { class: 't' }, h('thead', {}, h('tr', {}, ['文件', '大小', '修改时间', '状态'].map(x => h('th', {}, x)))),
      h('tbody', {}, files.map(f => h('tr', {}, h('td', {}, f.name), h('td', { class: 'num' }, (f.size / 1024).toFixed(0) + ' KB'), h('td', {}, f.mtime),
        h('td', {}, h('span', { class: 'pill ' + (f.imported ? 'ok' : 'blue') }, f.imported ? '已导入历史库' : '待导入（生成时导入）'))))))) :
      (sc && sc.rows ? h('div', { class: 'hint' }, `原表文件夹里没有新文件；当前使用历史数据库（${fmt(sc.rows)} 行）。`) : empty('文件夹里还没有原表文件。把 data*.xlsx 放进去，再点【扫描数据】。'))));

  // ④ 数据概览
  if (sc && sc.rows) {
    el.append(card('数据概览', `${sc.days[0].d} ~ ${sc.days[sc.days.length - 1].d}`, null,
      h('div', { class: 'g4' }, kpi('历史数据行数', fmt(sc.rows), '已去重'), kpi('生产日', sc.days.length + ' 天', '业务日'), kpi('责任工序', sc.procs.length + ' 个', '数据里出现'), kpi('涉及人员', fmt(sc.employees.length) + ' 人', '责任员工')),
      h('div', { class: 'mt' }, h('label', { class: 'f' }, '每日不良 pcs（未筛选）'), miniDays(sc.days)),
      sc.bad_dates ? banner('warn', `有 ${sc.bad_dates} 行日期无法识别，已忽略`) : null));
  }
};

/* ============ 数据与字段 ============ */
function pathRow(label, key) {
  const i = inp(S.cfg.paths[key], v => { S.cfg.paths[key] = v; touch(); });
  return field(label, h('div', { class: 'gap', style: { flexWrap: 'nowrap' } }, i, h('button', { class: 'btn sm', onclick: async () => { const j = await api('/api/pick', { kind: 'folder', initial: S.cfg.paths[key] }); if (j.path) { S.cfg.paths[key] = j.path; i.value = j.path; touch(); scan(true); } else toast('未选择（或当前系统不支持文件夹选择，请直接输入路径）'); } }, '浏览…')));
}
PAGES.data = el => {
  const P = P_(), cols = (S.scan && S.scan.columns) || [];
  el.append(card('数据源', '相对路径以本程序所在文件夹为基准', null,
    h('div', { class: 'g2' }, pathRow('原表文件夹（放每日导出的 xlsx）', 'input'), field('文件名匹配规则', inp(S.cfg.paths.pattern, v => { S.cfg.paths.pattern = v; touch(); }), '例：data*.xlsx'),
      pathRow('历史数据库文件夹（程序自动维护，勿手改）', 'history'), pathRow('结果输出文件夹', 'output')),
    h('hr', { class: 's' }),
    h('div', { class: 'g3' },
      field('业务日期来源', seg([{ v: '业务日期', t: '用“业务日期”列' }, { v: '记录时间', t: '按记录时间推算' }], P['业务日期来源'], v => { P['业务日期来源'] = v; touch(); }), '记录时间模式下，早于切换时刻算前一生产日（夜班跨零点）'),
      field('业务日切换时间', h('input', { type: 'time', value: P['业务日切换时间'], onchange: e => { P['业务日切换时间'] = e.target.value; touch(); } }), '仅在“按记录时间推算”时生效'),
      field('重新导入全部文件', h('div', { class: 'gap' }, toggle(P['重新导入全部文件'] === '是', v => { P['重新导入全部文件'] = v ? '是' : '否'; touch(); }), h('span', { class: 'hint' }, '开启=下次生成忽略已导入记录，全部重读'))),
      field('导入后归档原表', h('div', { class: 'gap' }, toggle(P['导入后归档原表'] === '是', v => { P['导入后归档原表'] = v ? '是' : '否'; touch(); }), h('span', { class: 'hint' }, '开启=成功导入的文件移到“已导入”子文件夹')))),
    h('div', { class: 'mt' }, field('去重字段（这些字段都相同的记录只保留一条，新文件覆盖旧记录）',
      chips(cols.length ? cols.map(c => c.name) : splitv(P['去重字段']), splitv(P['去重字段']), s => { P['去重字段'] = s.join('、'); touch(); })))));

  // 字段映射
  const r = roleCols();
  const missing = ['责任员工', '责任工序', '不良代码'].filter(k => !r[k]).concat((r['业务日期'] || r['记录时间']) ? [] : ['业务日期/记录时间']);
  el.append(card('字段映射', '程序自动识别表头；你只需告诉它每一列的用途', h('button', { class: 'btn sm', onclick: () => scan(true) }, '重新扫描表头'),
    missing.length ? banner('bad', '还缺少必要用途：' + missing.join('、') + '。请在下表“用途”列选择。') : banner('ok', '必要字段已映射：责任员工、责任工序、不良代码、业务日期'),
    cols.length ? h('div', { class: 'scroll', style: { maxHeight: '460px' } }, h('table', { class: 't' },
      h('thead', {}, h('tr', {}, ['原表字段', '样例值', '唯一值', '空值率', '用途', '明细显示'].map(x => h('th', {}, x)))),
      h('tbody', {}, cols.map(c => {
        const m = S.cfg.fieldmap[c.name] || (S.cfg.fieldmap[c.name] = { role: '不使用', show: false });
        const rp = h('span', { class: 'rolepill' + (m.role !== '不使用' ? ' use' : '') }, '');
        return h('tr', {}, h('td', {}, h('b', {}, c.name)), h('td', { style: { color: '#6b7a90', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, c.sample), h('td', { class: 'num' }, fmt(c.unique)),
          h('td', {}, h('div', { class: 'gap' }, h('div', { class: 'bar', style: { width: '60px' } }, h('i', { style: { width: Math.min(100, c.empty * 100) + '%', background: c.empty > .5 ? '#d9822b' : '#2e75b6' } })), h('small', {}, (c.empty * 100).toFixed(0) + '%'))),
          h('td', { style: { width: '170px' } }, sel(S.meta.roles, m.role, v => { m.role = v; touch(); render(); })),
          h('td', {}, toggle(m.show, v => { m.show = v; touch(); }, true)));
      })))) : empty('扫描到数据后，这里会列出原表所有列')));

  // 全局筛选规则
  const rules = S.cfg.rules;
  const colNames = cols.map(c => c.name);
  el.append(card('全局筛选规则', '对所有报表生效，从上到下依次执行', h('button', { class: 'btn sm pri', onclick: () => { rules.push({ enabled: true, col: colNames[0] || '', op: '等于', vals: [] }); touch(); render(); } }, '+ 添加规则'),
    h('div', { class: 'g3' },
      field('全局排除站点关键字', tags(splitv(P['全局排除站点关键字']), v => { P['全局排除站点关键字'] = v.join('、'); touch(); }, '如：返修'), '责任站点包含这些字的不统计'),
      field('剔除责任员工为空', h('div', { class: 'gap' }, toggle(P['剔除责任员工为空'] === '是', v => { P['剔除责任员工为空'] = v ? '是' : '否'; touch(); }))),
      field('自动生成单工序表', h('div', { class: 'gap' }, toggle(P['自动生成单工序表'] === '是', v => { P['自动生成单工序表'] = v ? '是' : '否'; touch(); }), h('span', { class: 'hint' }, '每个工序再各出一张分析表')))),
    h('hr', { class: 's' }),
    rules.length ? h('table', { class: 't' }, h('thead', {}, h('tr', {}, ['启用', '字段', '运算', '值（回车添加）', ''].map(x => h('th', {}, x)))),
      h('tbody', {}, rules.map((ru, i) => h('tr', {}, h('td', {}, toggle(ru.enabled !== false, v => { ru.enabled = v; touch(); }, true)),
        h('td', { style: { width: '220px' } }, sel(colNames.length ? colNames : [ru.col], ru.col, v => { ru.col = v; touch(); })),
        h('td', { style: { width: '120px' } }, sel(S.meta.ops, ru.op, v => { ru.op = v; touch(); })),
        h('td', {}, tags(ru.vals || (ru.vals = []), () => touch(), '值')),
        h('td', {}, h('button', { class: 'btn sm ghost danger', onclick: () => { rules.splice(i, 1); touch(); render(); } }, '删除')))))) :
      h('div', { class: 'hint' }, '暂无规则。例：Category Name 等于 人（只看人为不良）；Disposition Type 不属于 Release（排除放行）。')));
};
