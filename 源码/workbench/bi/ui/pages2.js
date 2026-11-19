'use strict';
/* ============ 筛选方案 ============ */
const peopleGroups = () => uniq(S.cfg.people.flatMap(p => p.groups || []));
const defectGroups = () => uniq([...((S.scan && S.scan.groups) || []), ...Object.values(S.cfg.defects).flatMap(d => d.groups || []), '看板监控']).sort();
function schemeDesc(g) {
  const p = [];
  p.push(g.procs && g.procs.length ? (g.procs.length > 2 ? g.procs.length + ' 个工序' : g.procs.join('、')) : '全部工序');
  if (g.def_in && g.def_in.length) p.push('不良组:' + g.def_in.join('、'));
  if (g.emp_in && g.emp_in.length) p.push('人员组:' + g.emp_in.join('、'));
  if (g.shift && g.shift.length) p.push(g.shift.join('、'));
  if (g.prod && g.prod.length) p.push(g.prod.join('/'));
  return p.join(' · ');
}
let prevTimer = null;
function schemePreview(g) {
  const box = $('#prevbox'); if (!box) return;
  clearTimeout(prevTimer);
  box.innerHTML = ''; box.append(h('span', { class: 'spin' }));
  prevTimer = setTimeout(async () => {
    const j = await api('/api/preview', { config: S.cfg, scheme: g });
    const b = $('#prevbox'); if (!b) return; b.innerHTML = '';
    if (!j || j.ok === false) return;
    if (!j.pcs) { b.append(banner('warn', '当前条件下没有数据，请放宽条件（工序/不良组/人员组）')); return; }
    b.append(h('div', { class: 'g4' }, kpi('筛出不良', fmt(j.pcs) + ' pcs', `占全部 ${pct(j.pcs, j.base)}`), kpi('涉及人员', fmt(j.people) + ' 人'),
      kpi('人员 TOP', j.top_emp.length ? j.top_emp[0].v : '—', j.top_emp.map(x => `${x.v} ${fmt(x.n)}`).join(' · ')), kpi('不良项目 TOP', j.top_item.length ? j.top_item[0].v : '—', j.top_item.map(x => `${x.v} ${fmt(x.n)}`).join(' · '))),
      h('div', { class: 'mt' }, h('label', { class: 'f' }, '各生产日筛出量'), miniDays(j.days, 80)));
  }, 450);
}
PAGES.schemes = el => {
  const list = schemes(), sc = S.scan || {};
  if (S.sel.scheme >= list.length) S.sel.scheme = Math.max(0, list.length - 1);
  const g = list[S.sel.scheme];
  const left = h('div', { class: 'list' }, h('div', { style: { padding: '6px 6px 10px' } }, h('button', { class: 'btn pri', style: { width: '100%' }, onclick: () => { list.push({ enabled: true, name: '新方案' + (list.length + 1), procs: [], excl: [], prod: [], shift: [], emp_in: [], emp_out: [], def_in: [], def_out: [], conds: [], range: '', pie: false, note: '' }); S.sel.scheme = list.length - 1; touch(); render(); } }, '+ 新建方案')),
    list.map((s, i) => h('div', { class: 'item' + (i === S.sel.scheme ? ' on' : '') + (s.enabled === false ? ' off' : ''), onclick: () => { S.sel.scheme = i; render(); } },
      toggle(s.enabled !== false, v => { s.enabled = v; touch(); render(); }, true), h('div', {}, h('div', { class: 'nm' }, s.name || '（未命名）'), h('div', { class: 'ds' }, schemeDesc(s))))));
  const right = h('div', {});
  if (!g) right.append(empty('还没有方案，点左侧“新建方案”'));
  else {
    const chg = () => { touch(); schemePreview(g); drawNav(); };
    const procOpts = (sc.procs || []).map(x => ({ v: x.v, n: x.n })); g.procs.filter(p => !procOpts.some(o => o.v === p)).forEach(p => procOpts.push({ v: p }));
    const mk = (opts, arr, o) => chips(opts, arr, chg, o);
    right.append(card('基本信息', null, h('div', { class: 'gap' },
      h('button', { class: 'btn sm', onclick: () => { const c = clone(g); c.name += '（副本）'; list.splice(S.sel.scheme + 1, 0, c); S.sel.scheme++; touch(); render(); } }, '复制'),
      h('button', { class: 'btn sm danger', onclick: () => { if (confirm(`删除方案【${g.name}】？`)) { list.splice(S.sel.scheme, 1); touch(); render(); } } }, '删除')),
      h('div', { class: 'g3' }, field('方案名称（= 输出的 Sheet 名）', inp(g.name, v => { const old = g.name; g.name = v; S.cfg.charts.forEach(c => { if (c.scheme === old) c.scheme = v; }); ['看板方案', '月度风险方案'].forEach(k => { if (P_()[k] === old) P_()[k] = v; }); touch(); drawNav(); }, { maxlength: 31 })),
        field('日期范围', sel(S.meta.ranges, g.range || '', v => { g.range = v; chg(); }, { blank: '沿用“方案分析表范围”' })),
        field('工序占比饼图', h('div', { class: 'gap', style: { paddingTop: '6px' } }, toggle(!!g.pie, v => { g.pie = v; touch(); }), h('span', { class: 'hint' }, '多工序合并表建议开启')))),
      h('div', { class: 'mt' }, field('备注', inp(g.note || '', v => { g.note = v; touch(); })))));
    right.append(card('筛选条件', '不选 = 不限制；各条件之间是“并且”', null,
      field(`工序（${g.procs.length ? '已选 ' + g.procs.length : '全部'}）`, h('div', {}, mk(procOpts, g.procs), h('div', { class: 'gap mt' },
        h('button', { class: 'btn sm', onclick: () => { g.procs.length = 0; g.procs.push(...procOpts.map(o => o.v)); chg(); render(); } }, '全选'),
        h('button', { class: 'btn sm', onclick: () => { g.procs.length = 0; chg(); render(); } }, '清空（=全部）'),
        h('button', { class: 'btn sm', title: '03-剪线 ~ 07-装管', onclick: () => { g.procs.length = 0; g.procs.push(...procOpts.map(o => o.v).filter(v => /^0[3-7]-/.test(v))); chg(); render(); } }, '前端 03~07')))),
      h('div', { class: 'g2 mt' },
        field('产品类别', mk(['MPO', 'MMC', 'LCD', ...((sc.prods || []).map(x => x.v).filter(v => !['MPO', 'MMC', 'LCD'].includes(v)))], g.prod)),
        field('班别', mk((sc.shifts || []).map(x => x.v), g.shift))),
      h('hr', { class: 's' }),
      h('div', { class: 'g2' },
        field('人员组 · 只看', mk(peopleGroups(), g.emp_in, { empty: '（还没有人员组：到【人员名单】导入）' })), field('人员组 · 排除', mk(peopleGroups(), g.emp_out, { empty: '（还没有人员组）' })),
        field('不良组 · 只看', mk(defectGroups(), g.def_in)), field('不良组 · 排除', mk(defectGroups(), g.def_out))),
      h('div', { class: 'hint' }, '人员组在【人员名单】维护；不良组在【不良类型】维护（“看板监控”= 驾驶舱专项监控的不良）。'),
      h('hr', { class: 's' }),
      field('额外排除站点关键字', tags(g.excl, chg, '如：返修'), '责任站点包含这些字的剔除（仅对本方案）'),
      h('div', { class: 'mt' }, h('label', { class: 'f' }, '附加条件（任意原表列）'),
        g.conds.map((c, i) => h('div', { class: 'gap', style: { flexWrap: 'nowrap', marginBottom: '6px' } },
          h('div', { style: { width: '210px' } }, sel(((sc.columns || []).map(x => x.name)), c.col, v => { c.col = v; chg(); }, { blank: '选择列' })),
          h('div', { style: { width: '100px' } }, sel(['属于', '不属于', '包含'], c.op, v => { c.op = v; chg(); })),
          h('div', { style: { flex: 1 } }, tags(c.vals || (c.vals = []), chg, '值，回车添加')),
          h('button', { class: 'btn sm ghost danger', onclick: () => { g.conds.splice(i, 1); chg(); render(); } }, '×'))),
        h('button', { class: 'btn sm', onclick: () => { g.conds.push({ col: '', op: '属于', vals: [] }); render(); } }, '+ 添加条件'))));
    right.append(card('实时预览', '按当前条件从历史数据里筛一遍', null, h('div', { id: 'prevbox' })));
    setTimeout(() => schemePreview(g), 0);
  }
  el.append(h('div', { class: 'split' }, left, right));
};

/* ============ 人员名单 ============ */
PAGES.people = el => {
  const P = P_(), ppl = S.cfg.people, sc = S.scan || {};
  const st = S.pf || (S.pf = { grp: '', q: '', sel: new Set(), pending: '' });
  const modeHint = { '不筛选': '所有人都统计。', '只看名单': '全局只统计名单里的人（对所有报表生效）。', '排除名单': '全局排除名单里的人（对所有报表生效）。' };
  el.append(card('全局人员筛选', null, null, h('div', { class: 'gap' }, seg(['不筛选', '只看名单', '排除名单'], P['人员筛选模式'], v => { P['人员筛选模式'] = v; touch(); render(); }),
    h('span', { class: 'hint' }, modeHint[P['人员筛选模式']] + ' 若只想让某张表只看某组人，请在【筛选方案】里选“人员组”。'))));
  const ta = h('textarea', { placeholder: '每行一个姓名，或用逗号/顿号分隔；可直接从 Excel 粘贴整列', value: st.pending }); ta.oninput = () => st.pending = ta.value;
  const gi = h('input', { type: 'text', list: 'dl_groups', placeholder: '人员组名，如：前段A组', value: st.newg || '' }); gi.oninput = () => st.newg = gi.value;
  const have = new Set(ppl.map(p => p.name));
  const top = (sc.employees || []).slice(0, 60);
  el.append(card('添加人员', '姓名必须与原表“责任员工”完全一致', null,
    h('div', { class: 'split', style: { gridTemplateColumns: '1fr 300px' } }, h('div', {}, ta, h('datalist', { id: 'dl_groups' }, peopleGroups().map(g => h('option', { value: g })))),
      h('div', {}, field('加入的人员组', gi, '一个人可属于多个组（用、隔开）'),
        h('div', { class: 'gap mt' }, h('button', { class: 'btn pri', onclick: () => {
          const names = splitv(ta.value), groups = splitv(gi.value);
          if (!names.length) return toast('请先输入姓名', 'bad');
          let add = 0, upd = 0;
          names.forEach(n => { const e = ppl.find(p => p.name === n); if (e) { e.groups = uniq([...(e.groups || []), ...groups]); upd++; } else { ppl.push({ enabled: true, name: n, groups: groups.slice() }); add++; } });
          st.pending = ''; touch(); render(); toast(`新增 ${add} 人，更新 ${upd} 人`, 'ok');
        } }, '添加到名单'), h('button', { class: 'btn', onclick: async () => {
          const j = await api('/api/pick', { kind: 'file' }); if (!j.path) return toast('未选择文件（或当前系统不支持文件选择）');
          const r = await api('/api/names', { path: j.path }); if (!r.people) return;
          r.people.forEach(n => { const e = ppl.find(p => p.name === n.name); if (e) e.groups = uniq([...(e.groups || []), ...n.groups]); else ppl.push(n); }); touch(); render(); toast(`已从文件导入 ${r.people.length} 人`, 'ok');
        } }, '从 Excel/CSV 导入')))),
    top.length ? h('div', { class: 'mt' }, h('label', { class: 'f' }, '从数据里挑人（按不良 pcs 排序，点击加入输入框）'), h('div', { class: 'chips' }, top.map(x => h('span', { class: 'chip' + (have.has(x.v) ? ' on' : ''), onclick: () => { if (!ta.value.includes(x.v)) { ta.value = (ta.value.trim() ? ta.value.trim() + '\n' : '') + x.v; st.pending = ta.value; } } }, x.v, h('small', {}, fmt(x.n)))))) : null));

  const groups = peopleGroups();
  let rows = ppl.map((p, i) => ({ p, i })).filter(({ p }) => (!st.grp || (p.groups || []).includes(st.grp)) && (!st.q || p.name.includes(st.q)));
  const shown = rows.slice(0, 200);
  el.append(card(`名单（${ppl.length} 人）`, groups.length ? `${groups.length} 个人员组` : '', h('div', { class: 'gap' },
    h('input', { type: 'text', placeholder: '搜索姓名', style: { width: '160px' }, value: st.q, oninput: e => { st.q = e.target.value; render(); setTimeout(() => { const i = $('input[placeholder=搜索姓名]'); if (i) { i.focus(); i.setSelectionRange(99, 99); } }, 0); } }),
    h('button', { class: 'btn sm danger', onclick: () => { if (!st.sel.size) return toast('先勾选要删除的人员'); if (confirm(`删除选中的 ${st.sel.size} 人？`)) { S.cfg.people = ppl.filter((_, i) => !st.sel.has(i)); st.sel.clear(); touch(); render(); } } }, '删除选中')),
    h('div', { class: 'chips', style: { marginBottom: '10px' } }, h('span', { class: 'chip' + (!st.grp ? ' on' : ''), onclick: () => { st.grp = ''; render(); } }, '全部', h('small', {}, ppl.length)),
      groups.map(g => h('span', { class: 'chip' + (st.grp === g ? ' on' : ''), onclick: () => { st.grp = g; render(); } }, g, h('small', {}, ppl.filter(p => (p.groups || []).includes(g)).length)))),
    ppl.length ? h('div', { class: 'scroll' }, h('table', { class: 't' }, h('thead', {}, h('tr', {}, [h('th', { style: { width: '34px' } }, h('input', { type: 'checkbox', onchange: e => { shown.forEach(({ i }) => e.target.checked ? st.sel.add(i) : st.sel.delete(i)); render(); } })), '启用', '姓名', '人员组（回车添加）', '在数据中'].map(x => typeof x === 'string' ? h('th', {}, x) : x))),
      h('tbody', {}, shown.map(({ p, i }) => h('tr', {}, h('td', {}, h('input', { type: 'checkbox', checked: st.sel.has(i), onchange: e => e.target.checked ? st.sel.add(i) : st.sel.delete(i) })),
        h('td', {}, toggle(p.enabled !== false, v => { p.enabled = v; touch(); }, true)), h('td', {}, h('b', {}, p.name)),
        h('td', { style: { minWidth: '280px' } }, tags(p.groups || (p.groups = []), () => touch(), '+ 组', { id: 'groups', list: groups })),
        h('td', {}, (sc.employees || []).some(x => x.v === p.name) ? h('span', { class: 'pill ok' }, '✓') : h('span', { class: 'pill warn' }, '数据中没有'))))))) : empty('名单为空：在上方粘贴姓名并填写人员组'),
    rows.length > 200 ? h('div', { class: 'hint' }, `仅显示前 200 条，共 ${rows.length} 条（用搜索或分组缩小范围）`) : null));
};

/* ============ 不良类型 ============ */
PAGES.defects = el => {
  const D = S.cfg.defects, sc = S.scan || {};
  const cnt = {}; (sc.defects || []).forEach(x => cnt[x.code] = x.n);
  const st = S.df || (S.df = { q: '', f: 'all', sel: new Set(), page: 0, bulk: '', bitem: '' });
  const all = Object.keys(D).sort((a, b) => (cnt[b] || 0) - (cnt[a] || 0));
  const items = uniq(Object.values(D).map(d => d.item)).sort();
  let rows = all.filter(c => (!st.q || c.includes(st.q) || (D[c].item || '').includes(st.q)) && (st.f === 'all' || (st.f === 'mon' && (D[c].groups || []).includes('看板监控')) || (st.f === 'off' && D[c].stat === false) || (st.f === 'new' && D[c].new) || (st.f === 'none' && !(D[c].groups || []).length)));
  const PS = 60, pages = Math.max(1, Math.ceil(rows.length / PS)); if (st.page >= pages) st.page = 0;
  const shown = rows.slice(st.page * PS, st.page * PS + PS);
  const nOff = all.filter(c => D[c].stat === false).length;
  el.append(card('不良类型', `共 ${all.length} 个不良代码${nOff ? '，' + nOff + ' 个设为不统计' : ''}`, null,
    banner('info', h('span', {}, '把相近的不良代码归并成“标准不良项目”（如 CN_MPO_装管反 + CN_MMC_装管反 → 装管反），驾驶舱矩阵/专项图按项目统计；“不良组”用于筛选方案里按组筛选，组含“看板监控”的会进入【每日看板】。')),
    h('div', { class: 'gap' }, h('input', { type: 'text', placeholder: '搜索代码或项目', style: { width: '200px' }, value: st.q, oninput: e => { st.q = e.target.value; st.page = 0; render(); setTimeout(() => { const i = $('input[placeholder=搜索代码或项目]'); if (i) { i.focus(); i.setSelectionRange(99, 99); } }, 0); } }),
      seg([{ v: 'all', t: '全部' }, { v: 'mon', t: '看板监控' }, { v: 'none', t: '未归组' }, { v: 'off', t: '不统计' }, { v: 'new', t: '新增' }], st.f, v => { st.f = v; st.page = 0; render(); }),
      h('span', { class: 'sp' }), h('span', { class: 'hint' }, `已选 ${st.sel.size} 个`)),
    h('div', { class: 'gap mt', style: { background: '#f4f7fb', borderRadius: '8px', padding: '8px 10px' } }, h('b', {}, '批量操作'),
      h('input', { type: 'text', list: 'dl_dg', placeholder: '不良组名', style: { width: '150px' }, value: st.bulk, oninput: e => st.bulk = e.target.value }), h('datalist', { id: 'dl_dg' }, defectGroups().map(g => h('option', { value: g }))),
      h('button', { class: 'btn sm', onclick: () => { if (!st.bulk) return toast('先填写不良组名'); st.sel.forEach(c => { D[c].groups = uniq([...(D[c].groups || []), st.bulk]); }); touch(); render(); } }, '加入该组'),
      h('button', { class: 'btn sm', onclick: () => { st.sel.forEach(c => { D[c].groups = (D[c].groups || []).filter(g => g !== st.bulk); }); touch(); render(); } }, '移出该组'),
      h('input', { type: 'text', list: 'dl_it', placeholder: '标准不良项目', style: { width: '150px' }, value: st.bitem, oninput: e => st.bitem = e.target.value }), h('datalist', { id: 'dl_it' }, items.map(g => h('option', { value: g }))),
      h('button', { class: 'btn sm', onclick: () => { if (!st.bitem) return toast('先填写项目名'); st.sel.forEach(c => D[c].item = st.bitem); touch(); render(); } }, '设为该项目'),
      h('button', { class: 'btn sm', onclick: () => { st.sel.forEach(c => D[c].stat = false); touch(); render(); } }, '设为不统计'), h('button', { class: 'btn sm', onclick: () => { st.sel.forEach(c => D[c].stat = true); touch(); render(); } }, '设为统计'),
      h('button', { class: 'btn sm ghost', onclick: () => { shown.forEach(c => st.sel.add(c)); render(); } }, '选中本页'), h('button', { class: 'btn sm ghost', onclick: () => { st.sel.clear(); render(); } }, '清除选择')),
    h('div', { class: 'scroll mt', style: { maxHeight: '540px' } }, h('table', { class: 't' }, h('thead', {}, h('tr', {}, ['', '统计', '不良代码', '数量', '标准不良项目', '产品拆分', '不良组（回车添加）'].map(x => h('th', {}, x)))),
      h('tbody', {}, shown.map(c => { const d = D[c]; return h('tr', { style: d.stat === false ? { opacity: .5 } : null },
        h('td', {}, h('input', { type: 'checkbox', checked: st.sel.has(c), onchange: e => e.target.checked ? st.sel.add(c) : st.sel.delete(c) })), h('td', {}, toggle(d.stat !== false, v => { d.stat = v; touch(); render(); }, true)),
        h('td', {}, h('b', {}, c), d.new ? h('span', { class: 'pill blue', style: { marginLeft: '6px' } }, '新增') : null), h('td', { class: 'num' }, fmt(cnt[c] || 0)),
        h('td', { style: { width: '190px' } }, h('input', { type: 'text', list: 'dl_it', value: d.item || '', oninput: e => { d.item = e.target.value; touch(); } })),
        h('td', {}, toggle(d.split !== false, v => { d.split = v; touch(); }, true)), h('td', { style: { minWidth: '260px' } }, tags(d.groups || (d.groups = []), () => touch(), '+ 组', { id: 'dg' + c.length, list: defectGroups() }))); })))),
    pages > 1 ? h('div', { class: 'gap mt' }, h('button', { class: 'btn sm', disabled: st.page === 0, onclick: () => { st.page--; render(); } }, '‹ 上一页'), h('span', { class: 'hint' }, `第 ${st.page + 1} / ${pages} 页（共 ${rows.length} 条）`), h('button', { class: 'btn sm', disabled: st.page >= pages - 1, onclick: () => { st.page++; render(); } }, '下一页 ›')) : null));
};
