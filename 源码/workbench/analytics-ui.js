/* Trend presentation; all counts come from AnalyticsCore. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const el=(tag,attrs={},text='')=>{const node=document.createElement(tag);Object.entries(attrs).forEach(([k,v])=>node.setAttribute(k,v));node.textContent=text;return node;};
  const svg=(tag,attrs)=>{const node=document.createElementNS('http://www.w3.org/2000/svg',tag);Object.entries(attrs).forEach(([k,v])=>node.setAttribute(k,v));return node;};
  const pct=value=>(value>=0?'+':'')+(value*100).toFixed(1)+'%';
  const delta=value=>(value>0?'+':'')+value;
  const rangeText=(start,end)=>start+' 至 '+end;
  let appliedOptions=null,datesDirty=false;
  const dispatch=()=>{appliedOptions=readOptions();datesDirty=false;document.dispatchEvent(new Event('analysischange'));};
  $('analysisRange').replaceChildren(...[['7','近 7 天'],['30','近 30 天'],['90','近 90 天'],['today','今天'],['custom','自定义'],['all','全部日期']].map(([value,label])=>el('option',{value},label)));
  $('analysisRange').value='30';
  const body=$('analysis').querySelector('.analysis-body');
  body.innerHTML=`<div class="analysis-toolbar"><label>开始日期<input type="date" id="analysisStart"></label><label>结束日期<input type="date" id="analysisEnd"></label><label>统计粒度<select id="analysisGrain"><option value="auto">自动</option><option value="day">按日</option><option value="week">按周</option><option value="month">按月</option></select></label><label>分组筛选<select id="analysisDimension"></select></label><label>字段值<select id="analysisValue"><option value="">全部</option></select></label><button type="button" class="btn" id="analysisApply">应用</button><label class="check-label analysis-today"><input type="checkbox" id="analysisToday">包含今天（尚未结束）</label></div><p id="analysisError" role="alert"></p><div class="analysis-kpis" id="analysisKpis"></div><section class="trend-section"><div class="chart-heading"><div><h3 id="trendTitle">记录数量趋势</h3><p id="trendDescription"></p></div><label>参考线<select id="analysisReference"><option value="previous">前期对照</option><option value="average">7 日移动平均（按日）</option><option value="none">仅本期</option></select></label></div><div class="chart-legend"><span class="legend-current">本期记录</span><span id="referenceLegend" class="legend-previous">前期记录</span></div><div class="trend-scroll"><div id="trendPlot"></div></div><p id="trendReadout" class="chart-readout" aria-live="polite">将焦点移到数据点可查看数量，点击查看记录。</p><details class="chart-data"><summary>查看图表数据表</summary><div class="matrix-wrap"><table class="matrix-table"><thead><tr><th>本期日期</th><th>记录数</th><th>对照日期</th><th>前期记录数</th><th>7 日均值</th></tr></thead><tbody id="trendDataRows"></tbody></table></div></details></section><p id="analysisSummary" class="analysis-summary"></p><div class="analysis-grid"><section class="analysis-card"><div class="chart-heading"><h3>异常增减</h3><label>排序<select id="analysisChangeSort"><option value="increase">增加最多</option><option value="decrease">减少最多</option><option value="count">本期最多</option></select></label></div><p id="changePeriod" class="description"></p><div class="matrix-wrap"><table class="matrix-table"><thead><tr><th>异常</th><th>本期</th><th>前期</th><th>增减</th><th>变化</th></tr></thead><tbody id="changeRows"></tbody></table></div></section><section class="analysis-card"><div class="chart-heading"><h3 id="groupTitle">分组分布</h3><label>分析字段<select id="analysisGroup"></select></label></div><p class="description">按本期记录数；点击查看对应明细。</p><div class="bar-list" id="groupBars"></div></section></div><div class="analysis-grid"><section class="analysis-card"><h3>异常现象分布</h3><p class="description">数量与记录占比；可展开全部类别。</p><div class="bar-list" id="issueBars"></div></section><section class="analysis-card"><h3>关联编号</h3><p class="description">区分大小写与前导零；编号重复不等于重复扫码。</p><div class="bar-list" id="codeBars"></div></section></div><section class="analysis-card"><h3>编号 × 异常组合</h3><div class="matrix-wrap"><table class="matrix-table"><thead><tr><th>关联编号</th><th>异常现象</th><th>次数</th></tr></thead><tbody id="matrixRows"></tbody></table></div><button type="button" class="btn btn-subtle" id="analysisExpandCombos">展开全部组合</button></section><div id="analysisFoot" class="analysis-foot"></div>`;
  InsightsUI.install(body);
  let last=null,callbacks=null,allCombos=false,currentTemplateId=null;
  const today=()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');};
  $('analysisStart').value=AnalyticsCore.shift(today(),-30);$('analysisEnd').value=AnalyticsCore.shift(today(),-1);
  ['analysisStart','analysisEnd'].forEach(id=>$(id).addEventListener('change',()=>{$('analysisRange').value='custom';datesDirty=true;$('analysisError').textContent='日期已修改，点击应用更新统计。下方保留上次结果。';}));
  $('analysisRange').addEventListener('change',()=>{appliedOptions=readOptions();datesDirty=false;});
  ['analysisGrain','analysisToday','analysisValue'].forEach(id=>$(id).addEventListener('change',dispatch));
  $('analysisDimension').addEventListener('change',()=>{$('analysisValue').value='';dispatch();});
  $('analysisApply').addEventListener('click',dispatch);
  $('analysisGroup').addEventListener('change',dispatch);
  ['analysisReference','analysisChangeSort'].forEach(id=>$(id).addEventListener('change',()=>{if(last)render(last,callbacks);}));
  $('analysisExpandCombos').onclick=()=>{allCombos=!allCombos;if(last)render(last,callbacks);};
  function syncSelect(node,columns,empty,defaultId=''){
    const old=node.value, signature=JSON.stringify(columns.map(c=>[c.id,c.label]));
    if(node.dataset.signature===signature)return;
    node.dataset.signature=signature;
    node.replaceChildren(...(empty?[el('option',{value:''},empty)]:[]),...columns.map(c=>el('option',{value:c.id},c.label)));
    node.value=columns.some(c=>c.id===old)?old:columns.some(c=>c.id===defaultId)?defaultId:'';
  }
  function prepare(template,records,map){
    const changed=currentTemplateId!==template.id;
    if(changed){currentTemplateId=template.id;appliedOptions={...(appliedOptions||readOptions()),dimension:'',value:''};$('analysisDimension').value='';$('analysisGroup').value='';$('analysisGroup').dataset.signature='';allCombos=false;}
    const columns=template.columns.filter(c=>c.auto!=='sequence'&&c.type!=='multiline');
    syncSelect($('analysisDimension'),columns,'不过滤');syncSelect($('analysisGroup'),columns,'不分组',map.group);
    const id=$('analysisDimension').value, value=$('analysisValue').value;
    const values=id?[...new Set(records.map(r=>String(r.values[id]??'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-CN')):[];
    $('analysisValue').replaceChildren(el('option',{value:''},'全部'),...values.map(v=>el('option',{value:v},v)));
    $('analysisValue').value=values.includes(value)?value:'';$('analysisValue').disabled=!id;
  }
  function readOptions(){return {range:$('analysisRange').value,start:$('analysisStart').value,end:$('analysisEnd').value,includeToday:$('analysisToday').checked,grain:$('analysisGrain').value,dimension:$('analysisDimension').value,value:$('analysisValue').value};}
  function options(){return {...(appliedOptions||readOptions())};}
  function rank(target,items,total,id,data){
    const box=$(target);box.replaceChildren();if(!id||!items.length){box.append(el('p',{class:'analysis-empty'},id?'此范围暂无记录。':'请配置对应分析字段。'));return;}
    const draw=(list)=>list.forEach(item=>{const row=el('div',{class:'bar-row'}),button=el('button',{type:'button',class:'bar-label',title:item.label},item.label),track=el('div',{class:'bar-track'}),fill=el('i');fill.style.width=(100*item.count/items[0].count)+'%';track.append(fill);button.onclick=()=>callbacks.drill(data.selected.filter(x=>String(x.record.values[id]??'').trim()===item.key).map(x=>x.record.id),item.label);row.append(button,track,el('b',{},String(item.count)),el('small',{},total?(100*item.count/total).toFixed(1)+'%':'0%'));box.append(row);});
    draw(items.slice(0,8));if(items.length>8){const remaining=items.slice(8).reduce((s,x)=>s+x.count,0),more=el('button',{type:'button',class:'btn btn-subtle'},`展开其余 ${items.length-8} 类（${remaining} 条）`);more.onclick=()=>{more.remove();draw(items.slice(8));};box.append(more);}
  }
  function chart(data){
    const box=$('trendPlot');box.replaceChildren();const width=960,height=260,left=54,right=24,top=20,bottom=46,plotW=width-left-right,plotH=height-top-bottom;
    const reference=$('analysisReference').value, usePrevious=reference==='previous'&&data.comparable,useAverage=reference==='average'&&data.bucketType==='day';
    $('referenceLegend').hidden=!usePrevious&&!useAverage;$('referenceLegend').textContent=useAverage?'7 日移动平均':'前期记录（等长日期对齐）';
    const max=Math.max(1,...data.buckets.map(x=>Math.max(x.count,usePrevious?x.previousCount||0:0,useAverage?x.average||0:0))),step=Math.max(1,Math.ceil(max/4)),limit=step*4;
    const x=i=>left+(data.buckets.length===1?plotW/2:i*plotW/(data.buckets.length-1)),y=n=>top+plotH-n/limit*plotH;
    const graphic=svg('svg',{viewBox:`0 0 ${width} ${height}`,role:'group','aria-label':'异常记录数量趋势，数值明细见下方数据表',class:'trend-svg'});
    for(let n=0;n<=4;n++){graphic.append(svg('line',{x1:left,y1:y(n*step),x2:width-right,y2:y(n*step),class:'chart-grid'}));const t=svg('text',{x:left-10,y:y(n*step)+4,'text-anchor':'end',class:'chart-axis'});t.textContent=n*step;graphic.append(t);}
    const path=(values,cls)=>{let d='',active=false;values.forEach((v,i)=>{if(v==null){active=false;return;}d+=(active?' L':' M')+x(i)+','+y(v);active=true;});graphic.append(svg('path',{d,fill:'none',class:cls}));};
    if(usePrevious)path(data.buckets.map(b=>b.previousCount),'chart-previous');if(useAverage)path(data.buckets.map(b=>b.average),'chart-previous');path(data.buckets.map(b=>b.count),'chart-current');
    data.buckets.forEach((bucket,i)=>{
      if(i===0||i===data.buckets.length-1||i%Math.max(1,Math.ceil(data.buckets.length/7))===0){const label=svg('text',{x:x(i),y:height-17,'text-anchor':i===0?'start':i===data.buckets.length-1?'end':'middle',class:'chart-axis'});label.textContent=bucket.label;graphic.append(label);}
      const message=rangeText(bucket.start,bucket.end)+'：'+bucket.count+' 条'+(bucket.partial?'（部分周期）':'')+(bucket.previousCount!=null?'；对照 '+rangeText(bucket.previousStart,bucket.previousEnd)+'：'+bucket.previousCount+' 条':'');
      const point=svg('circle',{cx:x(i),cy:y(bucket.count),r:data.buckets.length>90?3:4,tabindex:'0',role:'button','aria-label':message+'，按回车查看记录',class:'chart-point'});
      const show=()=>$('trendReadout').textContent=message;point.addEventListener('focus',show);point.addEventListener('pointerenter',show);
      const drill=()=>callbacks.drill(data.selected.filter(r=>r.date>=bucket.start&&r.date<=bucket.end).map(r=>r.record.id),rangeText(bucket.start,bucket.end));point.addEventListener('click',drill);point.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();drill();}});graphic.append(point);
    });box.append(graphic);
    $('trendDataRows').replaceChildren(...data.buckets.map(b=>{const row=el('tr');[rangeText(b.start,b.end)+(b.partial?'（部分周期）':''),b.count,b.previousCount!=null?rangeText(b.previousStart,b.previousEnd):'—',b.previousCount??'—',b.average==null?'—':b.average.toFixed(2)].forEach(v=>row.append(el('td',{},String(v))));return row;}));
  }
  function render(data,handlers){
    last=data;callbacks=handlers;if(!datesDirty)$('analysisError').textContent='';
    if(data.range!=='custom'&&!datesDirty){$('analysisStart').value=data.start;$('analysisEnd').value=data.end;}
    const period=rangeText(data.start,data.end), comparison=data.comparable?`${rangeText(data.start,data.completeEnd)} 对比 ${rangeText(data.previousStart,data.previousEnd)}`:'未启用期间对比';
    const kpis=$('analysisKpis');kpis.replaceChildren();
    const add=(value,label,detail)=>{const card=el('div',{class:'analysis-kpi'});card.append(el('b',{},String(value)),el('span',{},label),el('small',{},detail));kpis.append(card);};
    add(data.selected.length,'本期异常记录',period+(data.containsToday?' · 含未结束的今天':''));
    add(data.comparable?delta(data.delta):'—','较前期变化',data.comparable?`${data.completed.length} 对 ${data.previous.length} 条 · ${data.percent==null?(data.completed.length?'前期为零，新增记录':'两期均无记录'):pct(data.percent)}${data.containsToday?'；两期比较均不含今天':''}`:'选择已完成的日期范围进行比较');
    add(data.codeKeys.length,'关联编号种类',`涉及 ${data.serialCount} 个有效 SN · 缺 SN ${data.missingSerial} 条`);
    add(data.backlog,'当前未关闭',`截至今天 · 超期 ${data.overdue} 条 · 不受发现日期范围限制`);
    $('trendTitle').textContent=(data.bucketType==='day'?'每日':data.bucketType==='week'?'每周':'每月')+'异常记录趋势';
    $('trendDescription').textContent=period+' · 单位：条记录；无记录不代表实际无异常。'+(data.containsToday?'今天尚未结束，已从比较中排除。':'');
    chart(data);$('changePeriod').textContent=comparison;
    const changes=data.changes.slice();const sort=$('analysisChangeSort').value;if(sort==='decrease')changes.sort((a,b)=>a.delta-b.delta);if(sort==='count')changes.sort((a,b)=>b.count-a.count);
    const changeRows=$('changeRows');changeRows.replaceChildren();
    if(!data.comparable||!changes.length){const row=el('tr');row.append(el('td',{colspan:'5',class:'analysis-empty'},data.comparable?'两个期间均无记录。':'请选取包含完整日期的范围。'));changeRows.append(row);}
    else changes.forEach(item=>{const row=el('tr'),cell=el('td'),button=el('button',{type:'button',class:'bar-label'},item.label);button.onclick=()=>handlers.drill(data.completed.filter(x=>String(x.record.values[data.columns.issue]??'').trim()===item.key).map(x=>x.record.id),item.label+'（本期完整日）');cell.append(button);row.append(cell,...[item.count,item.before,delta(item.delta),item.percent==null?(item.count?'新增':'—'):pct(item.percent)].map(x=>el('td',{},String(x))));changeRows.append(row);});
    rank('issueBars',data.issues,data.selected.length,data.columns.issue,data);rank('codeBars',data.codes,data.selected.length,data.columns.code,data);rank('groupBars',data.groups,data.selected.length,data.columns.group,data);
    $('groupTitle').textContent=($('analysisGroup').selectedOptions[0]?.textContent||'分组')+'分布';
    const matrix=$('matrixRows');matrix.replaceChildren();data.combos.slice(0,allCombos?undefined:12).forEach(item=>{const row=el('tr'),cell=el('td'),button=el('button',{type:'button',class:'bar-label'},item.code||'未填写');button.onclick=()=>handlers.drill(data.selected.filter(x=>String(x.record.values[data.columns.code]??'').trim()===item.code&&String(x.record.values[data.columns.issue]??'').trim()===item.issue).map(x=>x.record.id),(item.code||'未填写')+' / '+(item.issue||'未填写'));cell.append(button);row.append(cell,el('td',{},item.issue||'未填写'),el('td',{},String(item.count)));matrix.append(row);});
    if(!data.combos.length){const row=el('tr');row.append(el('td',{colspan:'3'},'此范围暂无组合数据。'));matrix.append(row);}
    $('analysisExpandCombos').hidden=data.combos.length<=12;$('analysisExpandCombos').textContent=allCombos?'收起组合':`展开全部 ${data.combos.length} 个组合`;
    const top=data.changes.find(x=>x.delta>0);$('analysisSummary').textContent=data.comparable?`完整日期内 ${data.completed.length} 条，前期 ${data.previous.length} 条，${data.delta>=0?'增加':'减少'} ${Math.abs(data.delta)} 条。${top?'增量最多：'+top.label+'（+'+top.delta+' 条）。':''}${Math.max(data.completed.length,data.previous.length)<10?'记录较少，变化幅度参考有限。':''}`:'当前仅显示数量分布；请选择完整日期范围查看期间变化。';
    $('analysisFoot').textContent=`统计日期：${handlers.dateLabel}；编号区分大小写与前导零。当前条件下日期缺失/无效 ${data.invalid} 条、未来日期 ${data.future} 条，均未计入趋势。记录数不等于不良件数；未配置检验总数，不计算不良率。`;
    InsightsUI.render(data,handlers);
  }
  window.AnalyticsUI=Object.freeze({prepare,options,render,group:()=>$('analysisGroup').value,error:message=>{$('analysisError').textContent='条件未应用：'+message+' 下方保留上次结果。';}});
})();
