/* Three task-focused analysis panes; all values are supplied by pure aggregation. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const el=(tag,attrs={},text='')=>{const node=document.createElement(tag);Object.entries(attrs).forEach(([key,value])=>node.setAttribute(key,value));node.textContent=text;return node;};
  const svg=(tag,attrs={})=>{const node=document.createElementNS('http://www.w3.org/2000/svg',tag);Object.entries(attrs).forEach(([key,value])=>node.setAttribute(key,value));return node;};
  const percent=value=>(100*value).toFixed(1)+'%';
  const days=value=>value==null?'—':Number.isInteger(value)?String(value):value.toFixed(1);
  let last=null,handlers=null,expandedRepeats=false,expandedClosed=false,expandedPareto=false,currentTemplate=null;
  const panes=[],tabs=[];
  function install(body){
    const firstGrid=body.querySelector('.analysis-grid'),secondGrid=firstGrid.nextElementSibling,combinations=secondGrid.nextElementSibling;
    const navigation=el('div',{class:'analysis-tabs',role:'tablist','aria-label':'分析视图'});
    ['趋势总览','分布与关联','处理效率'].forEach((name,index)=>{
      const tab=el('button',{type:'button',id:'insightTab'+index,role:'tab','aria-controls':'insightPane'+index},name);
      const panel=el('section',{id:'insightPane'+index,role:'tabpanel','aria-labelledby':tab.id,class:'insight-pane'});
      tab.onclick=()=>select(index);tabs.push(tab);panes.push(panel);navigation.append(tab);
    });
    navigation.addEventListener('keydown',event=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      event.preventDefault();const active=tabs.indexOf(document.activeElement);const next=event.key==='Home'?0:event.key==='End'?2:(Math.max(0,active)+(event.key==='ArrowRight'?1:2))%3;select(next);tabs[next].focus();
    });
    body.insertBefore(navigation,$('analysisKpis'));
    body.insertBefore(panes[0],$('analysisFoot'));body.insertBefore(panes[1],$('analysisFoot'));body.insertBefore(panes[2],$('analysisFoot'));
    panes[0].append($('analysisKpis'),body.querySelector('.trend-section'),$('analysisSummary'),firstGrid);
    const pareto=el('section',{class:'analysis-card'});
    pareto.innerHTML=`<div class="chart-heading"><div><h3>重点异常 · 帕累托</h3><p>按本期异常记录数降序；柱形为记录数，折线为累计占比。</p></div><label>参考占比<select id="paretoThreshold"><option value="0.7">70%</option><option value="0.8" selected>80%</option><option value="0.9">90%</option></select></label></div><div class="chart-legend"><span class="legend-current">记录数 · 左轴</span><span class="legend-previous">累计占比 · 右轴</span></div><p id="paretoSummary" class="insight-note"></p><div id="paretoPlot"></div><p id="paretoReadout" class="chart-readout" aria-live="polite">聚焦柱形可查看记录数和累计占比，点击查看明细。</p><details class="chart-data"><summary>查看全部类别与累计占比</summary><div class="matrix-wrap"><table class="matrix-table"><thead><tr><th>异常</th><th>记录数</th><th>占比</th><th>累计占比</th></tr></thead><tbody id="paretoRows"></tbody></table></div><button type="button" class="btn btn-subtle" id="paretoExpand">展开全部类别</button></details></section>`;
    const repeated=el('section',{class:'analysis-card'});
    repeated.innerHTML=`<div class="chart-heading"><div><h3>同 SN 多次记录</h3><p id="repeatSummary"></p></div></div><p class="description">仅本期、当前类型和已应用字段范围；多次记录可能是合法的多类异常，不自动判为误扫或复发。</p><div class="matrix-wrap"><table class="matrix-table"><thead><tr><th>SN</th><th>记录数</th><th>异常类别</th><th>首次日期</th><th>最近日期</th><th>查看</th></tr></thead><tbody id="repeatRows"></tbody></table></div><button type="button" class="btn btn-subtle" id="repeatExpand">展开全部</button></section>`;
    panes[1].append(pareto,secondGrid,combinations,repeated);
    panes[2].innerHTML=`<p id="processingScope" class="insight-note"></p><div class="analysis-kpis" id="processingKpis"></div><div class="insight-quick" id="processingQuick"></div><div class="analysis-grid"><section class="analysis-card"><h3>未关闭日龄分布</h3><p id="ageCaption" class="description"></p><div id="ageRows" class="age-list"></div></section><section class="analysis-card"><h3>负责人当前任务</h3><p class="description">按超期数、未关闭数排序；用于安排当前任务。</p><div class="matrix-wrap"><table class="matrix-table"><thead><tr><th>负责人</th><th>未关闭</th><th>超期</th><th>待处理</th><th>处理中</th><th>其他状态</th></tr></thead><tbody id="ownerRows"></tbody></table></div></section></div><section class="analysis-card"><h3>发现至关闭天数</h3><p id="closureCaption" class="description"></p><div class="insight-closure-summary" id="closureSummary"></div><div class="matrix-wrap"><table class="matrix-table"><thead><tr><th>SN</th><th>统计日期</th><th>关闭日期</th><th>日历天数</th><th>说明</th></tr></thead><tbody id="closedRows"></tbody></table></div><button type="button" class="btn btn-subtle" id="closedExpand">展开全部</button></section><details class="insight-quality"><summary>查看数据完整性与排除项</summary><div id="processingQuality"></div></details>`;
    $('paretoThreshold').onchange=()=>{if(last)renderPareto(last);};
    $('paretoExpand').onclick=()=>{expandedPareto=!expandedPareto;if(last)renderPareto(last);};
    $('repeatExpand').onclick=()=>{expandedRepeats=!expandedRepeats;if(last)renderRepeats(last);};
    $('closedExpand').onclick=()=>{expandedClosed=!expandedClosed;if(last)renderProcessing(last);};
    select(0);
  }
  function readableAxes(){
    document.querySelectorAll('.trend-svg,.pareto-svg').forEach(graphic=>{const width=graphic.getBoundingClientRect().width;if(!width)return;graphic.style.setProperty('--axis-scale',String(Math.max(1,960/width)));graphic.querySelectorAll('[data-full-label]').forEach(label=>{const full=label.dataset.fullLabel,max=width<760?4:9;label.textContent=full.length>max?full.slice(0,max-1)+'…':full;});});
  }
  window.addEventListener('resize',()=>requestAnimationFrame(readableAxes));
  function select(index){panes.forEach((panel,i)=>{panel.hidden=i!==index;tabs[i].setAttribute('aria-selected',String(i===index));tabs[i].tabIndex=i===index?0:-1;});requestAnimationFrame(readableAxes);}
  function drillButton(text,ids,label){const button=el('button',{type:'button',class:'bar-label'},text);button.disabled=!ids.length;button.onclick=()=>handlers.drill(ids,label);return button;}
  function emptyRow(target,columns,message){const row=el('tr');row.append(el('td',{colspan:String(columns),class:'analysis-empty'},message));$(target).append(row);}
  function renderPareto(data){
    const items=data.insights.pareto,total=items.reduce((sum,x)=>sum+x.count,0),threshold=Number($('paretoThreshold').value),box=$('paretoPlot');box.replaceChildren();$('paretoRows').replaceChildren();$('paretoExpand').hidden=true;$('paretoReadout').textContent=items.length?'聚焦柱形可查看记录数和累计占比，点击查看明细。':'';
    if(!items.length){$('paretoSummary').textContent=data.columns.issue?'本期暂无可分析记录。':'请先在表头设置中指定异常现象字段。';return;}
    const crossing=items.findIndex(x=>x.cumulative>=threshold),important=items.slice(0,crossing+1);
    $('paretoSummary').textContent=`前 ${important.length} 类合计 ${important.reduce((sum,x)=>sum+x.count,0)} 条，覆盖 ${percent(important[important.length-1].cumulative)}。${Math.round(threshold*100)}% 是参考线，不代表根因或固定的 80/20 关系。`+(items.length>10?'图中其余类别合并为“其他”，明细和导出保留全部类别。':'');
    let plotted=items.slice(0,10).map(x=>({...x,keys:[x.key]}));
    if(items.length>10){const rest=items.slice(10),count=rest.reduce((sum,x)=>sum+x.count,0);plotted.push({key:null,label:'其他 '+rest.length+' 类',count,share:count/total,cumulative:1,keys:rest.map(x=>x.key),ids:rest.flatMap(x=>x.ids)});}
    const width=960,height=300,left=54,right=55,top=24,bottom=66,plotWidth=width-left-right,plotHeight=height-top-bottom;
    const graphic=svg('svg',{viewBox:`0 0 ${width} ${height}`,role:'group','aria-label':'重点异常帕累托，全部数据见下方表格',class:'pareto-svg'}),x=i=>left+plotWidth*(i+.5)/plotted.length,y=ratio=>top+plotHeight*(1-ratio),barWidth=Math.min(70,plotWidth/plotted.length*.58);
    for(let n=0;n<=4;n++){const ratio=n/4;graphic.append(svg('line',{x1:left,y1:y(ratio),x2:width-right,y2:y(ratio),class:'chart-grid'}));const a=svg('text',{x:left-9,y:y(ratio)+4,'text-anchor':'end',class:'chart-axis'});a.textContent=String(Number((total*ratio).toFixed(1)));const b=svg('text',{x:width-right+9,y:y(ratio)+4,class:'chart-axis'});b.textContent=(ratio*100)+'%';graphic.append(a,b);}
    graphic.append(svg('line',{x1:left,y1:y(threshold),x2:width-right,y2:y(threshold),class:'pareto-reference'}));
    let path='';plotted.forEach((item,i)=>{
      const label=item.key===''?'未填写（空）':item.label,message=label+'：'+item.count+' 条，累计 '+percent(item.cumulative),ids=item.ids;
      const bar=svg('rect',{x:x(i)-barWidth/2,y:y(item.share),width:barWidth,height:plotHeight*item.share,rx:'3',tabindex:'0',role:'button','aria-label':message+'，回车查看明细',class:'pareto-bar'});
      const show=()=>$('paretoReadout').textContent=message+'。点击查看相应记录。';bar.onpointerenter=show;bar.onfocus=show;bar.onclick=()=>handlers.drill(ids,label);bar.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();bar.onclick();}};graphic.append(bar);
      const text=svg('text',{x:x(i),y:height-bottom+22,'text-anchor':'middle',class:'chart-axis','data-full-label':label});text.textContent=label.length>9?label.slice(0,8)+'…':label;graphic.append(text);path+=(i?' L':'M')+x(i)+','+y(item.cumulative);
      graphic.append(svg('circle',{cx:x(i),cy:y(item.cumulative),r:'3',class:'pareto-point'}));
    });graphic.append(svg('path',{d:path,fill:'none',class:'pareto-line'}));box.append(graphic);
    items.slice(0,expandedPareto?undefined:20).forEach(item=>{const row=el('tr'),cell=el('td');cell.append(drillButton(item.key===''?'未填写（空）':item.label,item.ids,item.label));row.append(cell,...[item.count,percent(item.share),percent(item.cumulative)].map(x=>el('td',{},String(x))));$('paretoRows').append(row);});
    $('paretoExpand').hidden=items.length<=20;$('paretoExpand').textContent=expandedPareto?'收起':`展开全部 ${items.length} 类`;
  }
  function renderRepeats(data){
    const {repeated,repeatRecords,serialConfigured}=data.insights;const target=$('repeatRows');target.replaceChildren();
    $('repeatSummary').textContent=serialConfigured?`${repeated.length} 个 SN 出现多次，涉及 ${repeatRecords} 条记录；本期缺少 SN ${data.missingSerial} 条已排除。`:'当前类型没有可识别的 SN 字段，无法按 SN 统计。';
    if(!repeated.length)emptyRow('repeatRows',6,serialConfigured?'本期没有同 SN 多次记录。':'请先配置 SN 字段。');
    repeated.slice(0,expandedRepeats?undefined:20).forEach(item=>{const row=el('tr');[item.sn,item.count,item.issues.map(x=>x||'未填写（空）').join(' / '),item.first,item.last].forEach(x=>row.append(el('td',{},String(x))));const cell=el('td');cell.append(drillButton('查看 '+item.count+' 条',item.ids,'SN='+item.sn));row.append(cell);target.append(row);});
    $('repeatExpand').hidden=repeated.length<=20;$('repeatExpand').textContent=expandedRepeats?'收起':`展开全部 ${repeated.length} 个 SN`;
  }
  function renderProcessing(data){
    const info=data.insights,kpis=$('processingKpis');kpis.replaceChildren();
    const add=(value,label,detail)=>{const card=el('div',{class:'analysis-kpi'});card.append(el('b',{},String(value)),el('span',{},label),el('small',{},detail));kpis.append(card);};
    $('processingScope').textContent=`当前快照截至 ${info.today}，跟随当前异常类型和已应用字段筛选；不受上方发现日期范围限制。关闭日期分析在下方单独标明。`;
    add(info.open.length,'当前未关闭','含待处理、处理中及其他未关闭状态');add(info.overdue.length,'当前超期','有效处理期限早于今天');add(info.unassigned.length,'当前未分配','未关闭且负责人为空');add(info.cohort.total?percent(info.cohort.closed/info.cohort.total):'—','本期发现队列当前关闭占比',`${info.cohort.closed} / ${info.cohort.total} 条 · 按发现期筛选的当前快照`);
    $('processingQuick').replaceChildren(drillButton('查看全部未关闭',info.open.map(x=>x.id),'当前未关闭'),drillButton('查看超期',info.overdue.map(x=>x.id),'当前超期'),drillButton('查看未分配',info.unassigned.map(x=>x.id),'当前未分配'));
    $('ageCaption').textContent=`按“${handlers.dateLabel}”至今天的日历日差，不代表工作时长。缺失/无效或未来日期单列。`;
    const ages=$('ageRows');ages.replaceChildren();info.bins.forEach(bin=>{const row=el('div',{class:'age-row'}),track=el('div',{class:'bar-track'}),fill=el('i');fill.style.width=(info.open.length?100*bin.count/info.open.length:0)+'%';track.append(fill);row.append(drillButton(bin.label,bin.ids,'未关闭日龄：'+bin.label),track,el('b',{},String(bin.count)));ages.append(row);});
    const owners=$('ownerRows');owners.replaceChildren();if(!info.owners.length)emptyRow('ownerRows',6,'当前没有未关闭任务。');info.owners.forEach(owner=>{const row=el('tr'),cell=el('td');cell.append(drillButton(owner.label,owner.ids,'负责人：'+owner.label+'（当前未关闭）'));row.append(cell,...[owner.count,owner.overdue,owner.todo,owner.progress,owner.other].map(x=>el('td',{},String(x))));owners.append(row);});
    $('closureCaption').textContent=(info.range==='all'?'所有已知关闭日期，截至今天。':`关闭日期范围：${info.start} 至 ${info.end}。`)+`仅当前为已关闭的记录；起点为“${handlers.dateLabel}”，按日历日计算，不用导入时间替代。不重建历史关闭流量。`;
    $('closureSummary').textContent=`本关闭期 ${info.closed.length} 条；有效日龄样本 ${info.durationCount} 条；发现至关闭天数中位数 ${days(info.medianDays)} 天。`;
    const closed=$('closedRows');closed.replaceChildren();if(!info.closed.length)emptyRow('closedRows',5,'本关闭期没有可靠关闭日期的当前已关闭记录。');info.closed.slice(0,expandedClosed?undefined:20).forEach(item=>{const row=el('tr'),cell=el('td');cell.append(drillButton(item.sn||'无 SN',[item.id],item.sn||item.id));row.append(cell,...[item.start||'—',item.end,days(item.days),item.reason||'已计入日龄'].map(x=>el('td',{},String(x))));closed.append(row);});
    $('closedExpand').hidden=info.closed.length<=20;$('closedExpand').textContent=expandedClosed?'收起':`展开全部 ${info.closed.length} 条关闭记录`;
    const quality=$('processingQuality');quality.replaceChildren();[
      ['当前字段范围：未知处理状态',info.quality.unknownStatus],['当前未关闭：处理期限缺失',info.quality.missingDue],['当前未关闭：处理期限无效',info.quality.invalidDue],['当前已关闭：关闭日期缺失/无效',info.quality.missingClose],['当前已关闭：关闭日期在未来',info.quality.futureClose],['本关闭期：统计日期无效，未计入日龄',info.quality.invalidStart],['本关闭期：关闭早于统计日期，未计入日龄',info.quality.reversed]
    ].forEach(([label,count])=>{const row=el('p');row.append(el('span',{},label),el('b',{},String(count)));quality.append(row);});
  }
  function render(data,callbacks){last=data;handlers=callbacks;if(currentTemplate!==data.templateId){currentTemplate=data.templateId;expandedRepeats=false;expandedClosed=false;expandedPareto=false;}renderPareto(data);renderRepeats(data);renderProcessing(data);requestAnimationFrame(readableAxes);}
  window.InsightsUI=Object.freeze({install,render});
})();



