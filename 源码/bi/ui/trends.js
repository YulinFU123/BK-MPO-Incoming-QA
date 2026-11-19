'use strict';
// Local-only analytics: filters, saved views, SVG charts and explicit period semantics.
const TR = { result: null, pending: false, sequence: 0, error: '', dirty: true, resultKey: '' };
const PERIODS = [{v:'day',t:'日趋势'},{v:'week',t:'周趋势'},{v:'month',t:'月趋势'}];
const DIM_OPTIONS = [{v:'process',t:'按工序'},{v:'employee',t:'按员工'},{v:'item',t:'按不良项目'}];
const PALETTE = ['#167d8d','#da8a36','#7372ba','#d16c72','#499461','#627b91','#b15b91','#7c8a37'];
function trendQuery() {
  S.cfg.analytics ||= {query:{},presets:[]}; S.cfg.analytics.presets ||= [];
  const q = S.cfg.analytics.query ||= {};
  for (const [key,value] of Object.entries({period:'day',dimension:'process',top:8,start:'',end:'',employees:[],exclude_employees:[],processes:[],exclude_processes:[],employee_groups:[],process_groups:[],items:[],products:[],shifts:[]})) if(q[key] == null) q[key]=value;
  return q;
}
function dirtyTrend() { TR.dirty=true;TR.sequence++;TR.pending=false;touch();const s=$('#trend-stale');if(s)s.textContent='筛选已更改，请点击“更新分析”'; }
function trendKey() { return JSON.stringify([trendQuery(),S.cfg.P,S.cfg.rules,S.cfg.people,S.cfg.process_groups,S.cfg.defects,S.cfg.fieldmap,S.cfg.paths]); }
async function loadTrend() {
  const sequence=++TR.sequence, key=trendKey(), q=clone(trendQuery());
  TR.pending=true;TR.error=''; render();
  const result=await api('/api/analytics',{config:clone(S.cfg),query:q});
  if(sequence!==TR.sequence || key!==trendKey()) return;
  TR.pending=false;
  if(!result || result.ok===false) TR.error=result?.error || '分析未完成，请检查数据和程序日志。';
  else { TR.result=result; TR.resultKey=key;TR.dirty=false; }
  if(S.page==='trends') render();
}
function searchChoices(options, selected, cb, placeholder='搜索或输入名称') {
  const root=h('div',{class:'multi-select'}), list=h('div',{class:'multi-options'}), summary=h('span',{class:'hint'});
  const names=uniq([...options.map(v=>typeof v==='string'?v:v.v),...selected]).sort((a,b)=>a.localeCompare(b,'zh-CN'));
  let query='';const taglist=h('div',{class:'chips'});const custom=h('input',{type:'text',placeholder:'完整名称，回车添加'});custom.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();splitv(custom.value).forEach(n=>{if(!selected.includes(n))selected.push(n);if(!names.includes(n))names.push(n);});custom.value='';cb();draw();}};
  const draw=()=>{
    list.replaceChildren();taglist.replaceChildren(...selected.map(n=>h('span',{class:'tag'},n,h('b',{onclick:()=>{selected.splice(selected.indexOf(n),1);cb();draw();}},'×'))));const matching=names.filter(n=>n.toLowerCase().includes(query.toLowerCase()));
    summary.textContent=selected.length?`已选 ${selected.length} 项`:'不限';
    matching.slice(0,160).forEach(name=>list.append(h('label',{class:'multi-option'},h('input',{type:'checkbox',checked:selected.includes(name),onchange:e=>{ if(e.target.checked)selected.push(name);else selected.splice(selected.indexOf(name),1);cb();draw(); }}),h('span',{},name||'（空白）'))));
    if(!matching.length)list.append(h('div',{class:'hint'},'无匹配项，可在下方输入完整名称'));
    if(matching.length>160)list.append(h('div',{class:'hint'},`共 ${matching.length} 项，搜索后可查看其余项`));
  };
  root.append(h('div',{class:'multi-tools'},h('input',{type:'search',placeholder,oninput:e=>{query=e.target.value;draw();}}),summary),list,
    h('div',{class:'gap'},h('button',{class:'btn sm ghost',onclick:()=>{for(const n of names.filter(n=>n.toLowerCase().includes(query.toLowerCase())))if(!selected.includes(n))selected.push(n);cb();draw();}},'选中搜索结果'),h('button',{class:'btn sm ghost',onclick:()=>{selected.length=0;cb();draw();}},'清空（不限）')),
    h('div',{class:'tagbox'},taglist,custom));
  draw();return root;
}
function quickRange(mode) {
  const q=trendQuery(),ds=S.scan?.days || [], last=ds.length?ds[ds.length-1].d:new Date().toLocaleDateString('sv-SE');
  const end=new Date(last+'T12:00:00'),start=new Date(end);
  if(mode==='all'){q.start=ds[0]?.d||'';q.end=last;}
  else {if(mode==='30')start.setDate(start.getDate()-29);if(mode==='12w'){start.setDate(start.getDate()-77);start.setDate(start.getDate()-((start.getDay()+6)%7));q.period='week';}if(mode==='12m'){start.setDate(1);start.setMonth(start.getMonth()-11);q.period='month';}
    q.start=start.toLocaleDateString('sv-SE');q.end=last;}
  dirtyTrend();loadTrend();
}
function saveTrendPreset() {
  const name=prompt('给这组筛选起一个名字，例如：夜班前段周趋势');if(!name?.trim())return;
  const presets=S.cfg.analytics.presets, existing=presets.find(p=>p.name===name.trim());
  if(existing&&!confirm('已有同名视图，覆盖它吗？'))return;
  const item={name:name.trim(),query:clone(trendQuery())};if(existing)Object.assign(existing,item);else presets.push(item);
  touch();render();toast('筛选视图已保存');
}
function svgEl(name, attrs={},text) {const el=document.createElementNS('http://www.w3.org/2000/svg',name);for(const [k,v]of Object.entries(attrs))el.setAttribute(k,v);if(text!=null)el.textContent=text;return el;}
function trendChart(rows, lines, height=270) {
  const wrap=h('div',{class:'trend-chart'}),svg=svgEl('svg',{viewBox:`0 0 1000 ${height}`,role:'img','aria-label':'不良记录数量趋势图，详细数值见下方周期明细'});
  const values=lines.flatMap(l=>l.values).filter(v=>v!=null),max=Math.max(1,...values)*1.15;
  const left=58,right=965,top=20,bottom=height-44;
  const x=i=>rows.length<2?(left+right)/2:left+(right-left)*i/(rows.length-1),y=v=>bottom-(bottom-top)*v/max;
  for(let i=0;i<=4;i++){const v=max*i/4;svg.append(svgEl('line',{x1:left,x2:right,y1:y(v),y2:y(v),stroke:'#e6edef','stroke-dasharray':i?'3 5':''}),svgEl('text',{x:left-10,y:y(v)+4,'text-anchor':'end',fill:'#75858b','font-size':11},fmt(v)));}
  const stride=Math.max(1,Math.ceil(rows.length/8));rows.forEach((r,i)=>{if(i%stride===0||i===rows.length-1)svg.append(svgEl('text',{x:x(i),y:height-16,'text-anchor':'middle',fill:'#75858b','font-size':11},r.label));});
  lines.forEach((line,index)=>{
    let path='',open=false;line.values.forEach((v,i)=>{if(v==null){open=false;return;}path+=`${open?'L':'M'}${x(i)},${y(v)} `;open=true;});
    const color=PALETTE[index%PALETTE.length];svg.append(svgEl('path',{d:path,fill:'none',stroke:color,'stroke-width':lines.length===1?3:2,'stroke-linejoin':'round'}));
    line.values.forEach((v,i)=>{if(v==null)return;const dot=svgEl('circle',{cx:x(i),cy:y(v),r:rows.length>100?1.5:3.5,fill:color});dot.append(svgEl('title',{},`${rows[i].label} · ${line.name}：${fmt(v)} pcs\n${rows[i].start} ～ ${rows[i].end}`));svg.append(dot);});
  });
  wrap.append(svg,h('div',{class:'chart-legend'},lines.map((line,i)=>h('span',{},h('i',{style:{background:PALETTE[i%PALETTE.length]}}),line.name))));return wrap;
}
function trendDrill(row) {
  const q=trendQuery();if(!row.key)return toast('空白对象请在数据中补全后分析');
  const key={employee:'employees',process:'processes',item:'items'}[q.dimension];q[key]=[row.key];dirtyTrend();loadTrend();
}
function resultPanel(el) {
  const r=TR.result;
  if(TR.error)el.append(banner('bad',TR.error));
  if(!r){el.append(h('div',{class:'trend-empty'},icon('chart',38),h('h3',{},TR.pending?'正在读取数据…':'开始你的第一份趋势分析'),h('p',{},'先扫描原表，再选择时间范围、员工和工序。'),h('button',{class:'btn pri',onclick:()=>go('data')},'设置数据源')));return;}
  if(r.empty){el.append(banner('info',r.message),h('button',{class:'btn',onclick:()=>go('data')},'设置数据源'));return;}
  const stale=TR.dirty||TR.resultKey!==trendKey();
  if(stale)el.append(banner('warn','下方仍是上次结果，请更新分析以应用当前筛选。'));
  const sum=r.summary, source=r.source;
  el.append(h('div',{class:'g4 metric-row'},kpi('筛选内不良记录',fmt(sum.quantity),'pcs · 按数量字段汇总'),kpi('涉及员工',fmt(sum.employees),'人数，不代表员工不良率'),kpi('涉及工序',fmt(sum.processes),'个责任工序'),kpi('有来源记录的日期',fmt(sum.source_days),'天 · 无记录不等于零不良')));
  const last=r.periods[r.periods.length-1];
  el.append(card('不良数量趋势',`${r.query.start} — ${r.query.end}`,h('span',{class:'pill blue'},PERIODS.find(p=>p.v===r.query.period).t),
    trendChart(r.periods,[{name:'筛选内不良记录 pcs',values:r.periods.map(p=>p.quantity)}]),
    h('div',{class:'trend-foot'},h('span',{},'原始数据覆盖：'+source.start+' ～ '+source.end),h('span',{},'最近周期：'+last.status+' · '+(last.change==null?last.comparison:'环比 '+(last.change>0?'+':'')+(last.change*100).toFixed(1)+'%')))));
  const ranking=h('div',{class:'rank-list'});r.ranking.slice(0,r.query.top).forEach((row,i)=>ranking.append(h('button',{class:'rank-row',onclick:()=>{if(stale)return toast('请先更新分析');trendDrill(row);},title:'点击仅看此对象'},
    h('span',{class:'rank-no'},String(i+1).padStart(2,'0')),h('span',{class:'rank-info'},h('span',{class:'rank-name'},row.name),h('span',{class:'rank-track'},h('i',{style:{width:(row.share*100)+'%'}}))),h('b',{},fmt(row.quantity)),h('small',{},(row.share*100).toFixed(1)+'%'))));
  if(!r.ranking.length)ranking.append(empty('当前筛选无匹配记录，请检查选择或排除条件。'));
  el.append(h('div',{class:'analysis-columns'},card('对象趋势对比','排行前 '+r.query.top+' 项',null,r.series.length?trendChart(r.periods,r.series,290):empty('无匹配记录')),
    card('不良记录排行','数量与筛选内占比 · 点击下钻',null,ranking)));
  const table=h('table',{class:'t period-table'},h('thead',{},h('tr',{},['周期 / 实际日期','不良记录 pcs','前周期 pcs','环比','记录日期 / 日历天数','状态'].map(t=>h('th',{},t)))),h('tbody',{},r.periods.map(row=>h('tr',{},
    h('td',{},h('b',{},row.label),h('div',{class:'hint'},row.start+' ～ '+row.end)),h('td',{class:'num'},row.quantity==null?'无来源记录':fmt(row.quantity)),h('td',{class:'num'},row.previous==null?'—':fmt(row.previous)),
    h('td',{class:'num',title:row.comparison,style:{color:row.change>0?'#b65d4c':row.change<0?'#26846c':'inherit'}},row.change==null?'—':(row.change>0?'+':'')+(row.change*100).toFixed(1)+'%'),h('td',{class:'num'},row.source_days+' / '+row.calendar_days),h('td',{},h('span',{class:'pill '+(row.status==='完整记录日期'?'ok':'warn')},row.status))))));
  el.append(card('周期明细','不完整周期或数据有缺口时，不展示可能误导的环比',null,h('div',{class:'scroll',style:{maxHeight:'440px'}},table)));
  el.append(h('details',{class:'method-note'},h('summary',{},'统计口径与数据质量'),r.notes.map(n=>h('p',{},n)),r.bad_dates?h('p',{class:'bad'},`已剔除 ${r.bad_dates} 行无法识别的日期，请修正原始数据。`):null,(r.global_log||[]).map(n=>h('p',{},n))));
}
PAGES.trends=el=>{
  const q=trendQuery(),sc=S.scan||{};
  el.append(h('section',{class:'trend-hero'},h('div',{},h('div',{class:'eyebrow'},'QUALITY / ANALYTICS'),h('h2',{},'看清变化，定位不良来源'),h('p',{},'从时间趋势到员工与工序，让每一次筛选都有明确的统计范围。')),h('div',{class:'hero-actions'},h('span',{class:'offline-dot'},'本机分析 · 无需联网'),h('button',{class:'btn',onclick:()=>scan(true)},'重新扫描数据'))));
  const presets=S.cfg.analytics.presets;
  el.append(card('分析范围','条件之间取交集；不选表示不限',null,
    h('div',{class:'trend-toolbar'},seg(PERIODS,q.period,v=>{q.period=v;dirtyTrend();loadTrend();}),h('div',{class:'sp'}),
      ...[['30','最近30天'],['12w','最近12周'],['12m','最近12月'],['all','全部数据']].map(([v,t])=>h('button',{class:'btn sm',onclick:()=>quickRange(v)},t))),
    h('div',{class:'g4 mt'},field('开始日期',inp(q.start,v=>{q.start=v;dirtyTrend();},{type:'date'}),'留空：按周期自动回看'),field('结束日期',inp(q.end,v=>{q.end=v;dirtyTrend();},{type:'date'}),'留空：以最新数据日为准'),field('对比维度',sel(DIM_OPTIONS,q.dimension,v=>{q.dimension=v;dirtyTrend();loadTrend();})),field('排行与对比数量',sel([5,8,10,15,20].map(n=>({v:String(n),t:'TOP '+n})),String(q.top),v=>{q.top=Number(v);dirtyTrend();loadTrend();}))),
    h('details',{class:'more-filters mt',open:q.processes.length||q.employees.length?true:null},h('summary',{},`指定员工与工序 · ${q.processes.length||'全部'} 工序 / ${q.employees.length||'全部'} 员工（点击展开）`),h('div',{class:'g2 mt'},field('指定工序',searchChoices(sc.procs||[],q.processes,dirtyTrend,'搜索工序')),field('指定员工',searchChoices(sc.employees||[],q.employees,dirtyTrend,'搜索员工姓名')))),
    h('details',{class:'more-filters mt'},h('summary',{},'更多筛选：分组 / 排除 / 产品 / 班别 / 不良项目'),
      h('div',{class:'g2 mt'},field('人员组（名单中维护）',searchChoices(peopleGroups(),q.employee_groups,dirtyTrend)),field('工序组（分组页维护）',searchChoices((S.cfg.process_groups||[]).map(g=>g.name),q.process_groups,dirtyTrend)),field('排除员工',tags(q.exclude_employees,dirtyTrend,'完整姓名，回车添加')),field('排除工序',tags(q.exclude_processes,dirtyTrend,'完整工序名，回车添加')),field('不良项目',searchChoices(sc.items||[],q.items,dirtyTrend)),h('div',{},field('产品类别',chips(sc.prods||[],q.products,dirtyTrend)),h('div',{class:'mt'},field('班别',chips(sc.shifts||[],q.shifts,dirtyTrend)))))),
    h('div',{class:'query-actions mt'},h('button',{class:'btn pri',disabled:TR.pending,onclick:loadTrend},TR.pending?'分析中…':'更新分析'),h('button',{class:'btn',onclick:saveTrendPreset},'保存为常用视图'),h('button',{class:'btn ghost',onclick:()=>{S.cfg.analytics.query={};TR.dirty=true;touch();loadTrend();}},'清空筛选'),
      h('span',{class:'hint',id:'trend-stale'},TR.dirty?'筛选已更改，请更新分析':'结果已更新'),h('span',{class:'sp'}),h('button',{class:'btn',disabled:TR.pending||!TR.result||TR.result.empty||TR.dirty||TR.resultKey!==trendKey(),onclick:async e=>{e.target.disabled=true;const r=await api('/api/analytics/export',{config:clone(S.cfg),query:clone(trendQuery())});e.target.disabled=false;if(r.ok){toast('已导出当前趋势分析');api('/api/open',{what:'file',path:r.path});}}},'导出当前趋势 Excel')),
    presets.length?h('div',{class:'saved-views mt'},h('span',{class:'hint'},'常用视图'),presets.map((p,i)=>h('span',{class:'saved-view'},h('button',{class:'btn sm',onclick:()=>{S.cfg.analytics.query=clone(p.query);dirtyTrend();loadTrend();}},p.name),h('button',{class:'btn sm ghost',title:'删除视图',onclick:()=>{if(confirm('删除常用视图“'+p.name+'”？')){presets.splice(i,1);touch();render();}}},'×')))):null));
  resultPanel(el);
  if(!TR.result&&!TR.pending&&!TR.error&&S.scan?.rows) setTimeout(()=>{if(S.page==='trends'&&!TR.pending)loadTrend();},0);
};
PAGES.groups=el=>{
  S.cfg.process_groups ||= [];const groups=S.cfg.process_groups,sc=S.scan||{};
  el.append(banner('info','一个员工或工序可属于多个组。选择多个组时取并集，不重复累计；同时选择姓名/工序时再取交集。'));
  el.append(card('员工分组','支持多个组、名单导入和批量添加',h('button',{class:'btn pri',onclick:()=>go('people')},'管理员工名单'),h('div',{class:'chips'},peopleGroups().map(g=>h('span',{class:'chip'},g,h('small',{},S.cfg.people.filter(p=>p.enabled!==false&&(p.groups||[]).includes(g)).length+' 人'))))));
  el.append(card('工序分组','例如：前段 / 后段 / 重点关注',h('button',{class:'btn pri',onclick:()=>{const n=prompt('请输入新的工序组名称');if(!n?.trim())return;if(groups.some(g=>g.name===n.trim()))return toast('分组名称已存在','bad');groups.push({name:n.trim(),members:[]});touch();render();}},'+ 新建工序组'),groups.length?null:empty('还没有工序组。新建后从数据中选择工序，也可输入完整名称。')));
  groups.forEach((g,i)=>el.append(card(g.name,g.members.length+' 个工序',h('div',{class:'gap'},h('button',{class:'btn sm',onclick:()=>{const name=prompt('新名称',g.name)?.trim();if(!name||name===g.name)return;if(groups.some(x=>x.name===name))return toast('分组名称已存在','bad');const old=g.name;g.name=name;for(const q of [trendQuery(),...S.cfg.analytics.presets.map(p=>p.query)])q.process_groups=(q.process_groups||[]).map(x=>x===old?name:x);dirtyTrend();render();}},'重命名'),h('button',{class:'btn sm danger',onclick:()=>{if(confirm('删除此分组？引用它的视图会保留旧名称并匹配为空，防止意外扩大范围。')){groups.splice(i,1);dirtyTrend();render();}}},'删除')),searchChoices(sc.procs||[],g.members,()=>{dirtyTrend();},'搜索并选择工序'))));
};
