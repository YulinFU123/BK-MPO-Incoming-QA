/* Read-only quality insights. Calendar days, exact identifiers, explicit exclusions. */
(function(root){
  'use strict';
  const core=typeof module!=='undefined'&&module.exports?require('./analytics-core.js'):root.AnalyticsCore;
  const value=(record,id)=>id?String(record.values?.[id]??'').trim():'';
  const age=(start,end)=>core.span(start,end)-1;
  const median=values=>{if(!values.length)return null;const sorted=values.slice().sort((a,b)=>a-b),mid=Math.floor(sorted.length/2);return sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2;};
  function closeDate(raw){
    if(typeof raw!=='string')return '';
    if(core.valid(raw))return raw;
    if(!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(raw)||!core.valid(raw.slice(0,10)))return '';
    const d=new Date(raw);if(!Number.isFinite(d.getTime()))return '';
    return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
  }
  function pareto(items){
    const ordered=items.slice().sort((a,b)=>b.count-a.count||String(a.key).localeCompare(String(b.key)));
    const total=ordered.reduce((sum,item)=>sum+item.count,0);let cumulative=0;
    return ordered.map(item=>{cumulative+=item.count;return {...item,share:total?item.count/total:0,cumulative:total?cumulative/total:0};});
  }
  function build({data,today,dateOf}){
    const scope=data.scopeRecords||data.selected.map(x=>x.record),columns=data.columns;
    const serials=new Map(),issueIds=new Map();
    data.selected.forEach(({record})=>{const key=value(record,columns.issue),ids=issueIds.get(key)||[];ids.push(record.id);issueIds.set(key,ids);});
    if(columns.serial)data.selected.forEach(({record,date})=>{
      const sn=value(record,columns.serial);if(!sn)return;
      let entry=serials.get(sn);if(!entry){entry={sn,count:0,first:date,last:date,ids:[],issues:new Set(),codes:new Set()};serials.set(sn,entry);}
      entry.count++;entry.ids.push(record.id);entry.first=entry.first<date?entry.first:date;entry.last=entry.last>date?entry.last:date;
      entry.issues.add(value(record,columns.issue));const code=value(record,columns.code);if(code)entry.codes.add(code);
    });
    const repeated=[...serials.values()].filter(x=>x.count>1).map(x=>({...x,issues:[...x.issues],codes:[...x.codes]})).sort((a,b)=>b.count-a.count||b.last.localeCompare(a.last)||a.sn.localeCompare(b.sn));
    const bins=[['0–2 天',0,2],['3–7 天',3,7],['8–14 天',8,14],['15 天及以上',15,Infinity],['日期缺失/无效',null,null],['日期在未来',null,null]].map(([label,min,max])=>({label,min,max,count:0,ids:[]}));
    const open=[],overdue=[],unassigned=[],owners=new Map(),closed=[];
    const quality={invalidDue:0,missingDue:0,unknownStatus:0,missingClose:0,futureClose:0,invalidStart:0,reversed:0,missingSerial:data.missingSerial};
    const knownStatus=new Set(['待处理','处理中','已关闭']);
    scope.forEach(record=>{
      const workflow=record.workflow||{},status=workflow.status||'待处理',owner=String(workflow.owner||'').trim(),start=dateOf(record);
      if(!knownStatus.has(status))quality.unknownStatus++;
      if(status!=='已关闭'){
        const due=typeof workflow.dueDate==='string'?workflow.dueDate:'',validDue=core.valid(due),late=validDue&&due<today;
        if(!due)quality.missingDue++;else if(!validDue)quality.invalidDue++;
        const item={id:record.id,sn:value(record,columns.serial),issue:value(record,columns.issue),status,owner,due:validDue?due:'',start:core.valid(start)?start:'',age:core.valid(start)&&start<=today?age(start,today):null,overdue:late};
        open.push(item);if(late)overdue.push(item);if(!owner)unassigned.push(item);
        let bin=!core.valid(start)?bins[4]:start>today?bins[5]:bins.find(b=>b.min!==null&&item.age>=b.min&&item.age<=b.max);bin.count++;bin.ids.push(record.id);
        let ownerRow=owners.get(owner);if(!ownerRow){ownerRow={owner,label:owner||'未分配（空）',count:0,overdue:0,todo:0,progress:0,other:0,ids:[]};owners.set(owner,ownerRow);}
        ownerRow.count++;ownerRow.overdue+=late?1:0;ownerRow.ids.push(record.id);if(status==='待处理')ownerRow.todo++;else if(status==='处理中')ownerRow.progress++;else ownerRow.other++;
      }else{
        const end=closeDate(workflow.closedAt);
        if(!end){quality.missingClose++;return;}
        if(end>today){quality.futureClose++;return;}
        if(data.range!=='all'&&(end<data.start||end>data.end))return;
        let days=null,reason='';
        if(!core.valid(start)){quality.invalidStart++;reason='统计日期缺失/无效';}
        else if(start>end){quality.reversed++;reason='关闭早于统计日期';}
        else days=age(start,end);
        closed.push({id:record.id,sn:value(record,columns.serial),issue:value(record,columns.issue),owner,start:core.valid(start)?start:'',end,days,reason});
      }
    });
    const durations=closed.filter(x=>x.days!==null).map(x=>x.days);
    const cohort={total:data.selected.length,closed:data.selected.filter(x=>x.record.workflow?.status==='已关闭').length};
    return {pareto:pareto(data.issues).map(item=>({...item,ids:issueIds.get(item.key)||[]})),repeated,repeatRecords:repeated.reduce((sum,x)=>sum+x.count,0),serialConfigured:!!columns.serial,
      open,overdue,unassigned,bins,owners:[...owners.values()].sort((a,b)=>b.overdue-a.overdue||b.count-a.count||a.owner.localeCompare(b.owner)),
      closed:closed.sort((a,b)=>b.end.localeCompare(a.end)||a.id.localeCompare(b.id)),durationCount:durations.length,medianDays:median(durations),
      cohort,quality,today,range:data.range,start:data.start,end:data.end};
  }
  function exportSheets(insights){
    const col=(label,width=150,type='text')=>({label,width,type});
    const percent=n=>(100*n).toFixed(2)+'%';
    return [
      {name:'重点异常',columns:[col('异常现象',280),col('记录数',110,'number'),col('占比'),col('累计占比')],rows:insights.pareto.map(x=>[x.label,x.count,percent(x.share),percent(x.cumulative)])},
      {name:'同SN多次记录',columns:[col('SN',240),col('本期记录数',120,'number'),col('异常类别数',120,'number'),col('首次日期'),col('最近日期'),col('异常类别（含未填）',350),col('关联编号',260)],rows:insights.repeated.map(x=>[x.sn,x.count,x.issues.length,x.first,x.last,x.issues.map(v=>v||'未填写').join(' / '),x.codes.join(' / ')])},
      {name:'当前未关闭日龄',columns:[col('永久记录编号',240),col('SN',220),col('异常现象',280),col('状态'),col('负责人'),col('统计日期'),col('日历天数',120,'number'),col('处理期限'),col('当前超期')],rows:insights.open.map(x=>[x.id,x.sn,x.issue,x.status,x.owner,x.start,x.age??'',x.due,x.overdue?'是':'否'])},
      {name:'负责人当前任务',columns:[col('负责人',200),col('未关闭',120,'number'),col('超期',120,'number'),col('待处理',120,'number'),col('处理中',120,'number'),col('其他状态',120,'number')],rows:insights.owners.map(x=>[x.label,x.count,x.overdue,x.todo,x.progress,x.other])},
      {name:'发现至关闭天数',columns:[col('永久记录编号',240),col('SN',220),col('异常现象',280),col('负责人'),col('统计日期'),col('关闭日期'),col('日历天数',120,'number'),col('排除原因',240)],rows:insights.closed.map(x=>[x.id,x.sn,x.issue,x.owner,x.start,x.end,x.days??'',x.reason])},
      {name:'处理分析口径',columns:[col('项目',250),col('说明',650)],rows:[['当前快照',`截至 ${insights.today}；跟随模板/字段筛选，不受发现期限制`],['关闭期',insights.range==='all'?'所有已知关闭日期，截至今天':insights.start+' 至 '+insights.end],['关闭记录',insights.closed.length],['有效日龄样本',insights.durationCount],['发现至关闭天数中位数',insights.medianDays??'无有效样本'],['本期发现队列总数',insights.cohort.total],['该队列当前关闭数',insights.cohort.closed],['未知状态（当前字段范围）',insights.quality.unknownStatus],['未关闭：缺处理期限',insights.quality.missingDue],['未关闭：无效处理期限',insights.quality.invalidDue],['已关闭：缺失/无效关闭日期（当前字段范围）',insights.quality.missingClose],['已关闭：未来关闭日期（当前字段范围）',insights.quality.futureClose],['本关闭期：统计日期无效',insights.quality.invalidStart],['本关闭期：关闭早于统计日期',insights.quality.reversed],['注意','日龄是日历日差，不是工作小时或SLA；仅分析当前关闭记录，不能重建历史关闭流量/积压。SN多次记录不自动判定误扫或复发。']]}
    ];
  }
  const api=Object.freeze({build,pareto,closeDate,median,exportSheets});
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.InsightsCore=api;
})(typeof window==='undefined'?globalThis:window);
