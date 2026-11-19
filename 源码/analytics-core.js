/* Pure aggregation. No DOM, persistence, or mutation of business records. */
(function (root) {
  'use strict';
  const DAY = 86400000;
  const stamp = iso => Date.parse(iso + 'T12:00:00Z');
  const iso = value => new Date(value).toISOString().slice(0, 10);
  const shift = (date, days) => iso(stamp(date) + days * DAY);
  const valid = date => /^\d{4}-\d{2}-\d{2}$/.test(date || '') && Number.isFinite(stamp(date)) && iso(stamp(date)) === date;
  const span = (start, end) => Math.round((stamp(end) - stamp(start)) / DAY) + 1;
  const monday = date => shift(date, -((new Date(stamp(date)).getUTCDay() + 6) % 7));
  const text = (record, id) => String(record.values?.[id] ?? '').trim();
  const rank = (items, id) => {
    if (!id) return [];
    const counts = new Map();
    items.forEach(({record}) => { const key = text(record, id); counts.set(key, (counts.get(key) || 0) + 1); });
    return [...counts].map(([key, count]) => ({key, label: key || '未填写', count}))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key, 'zh-CN'));
  };
  function rangeFor(options, dated, today) {
    const end = options.includeToday || options.range === 'today' ? today : shift(today, -1);
    if (options.range === 'custom') {
      if (!valid(options.start) || !valid(options.end) || options.start > options.end) throw Error('请选择有效的起止日期，开始不能晚于结束。');
      if (options.end > today) throw Error('统计结束日期不能晚于今天。');
      return {start: options.start, end: options.end};
    }
    if (options.range === 'today') return {start: today, end: today};
    if (options.range === 'all') {
      const dates = dated.filter(x => x.date <= today).map(x => x.date).sort();
      return {start: dates[0] || end, end: dates[dates.length - 1] || end};
    }
    if (!['7', '30', '90'].includes(String(options.range))) throw Error('统计范围无效。');
    return {start: shift(end, 1 - Number(options.range)), end};
  }
  function build({records, columns, today, dateOf, options = {range:'30'}}) {
    if (!valid(today)) throw Error('当前日期无效。');
    const scoped = records.filter(record => !options.dimension || options.value === '' || options.value == null || text(record, options.dimension) === options.value);
    let invalid = 0;
    const dated = [];
    scoped.forEach(record => { const date = dateOf(record); if (valid(date)) dated.push({record, date}); else invalid++; });
    const period = rangeFor(options, dated, today);
    const days = span(period.start, period.end);
    if (days > 36600) throw Error('单次分析最多支持 100 年，请缩小日期范围。');
    const containsToday = period.end === today;
    const completeEnd = containsToday ? shift(today, -1) : period.end;
    const compareDays = Math.max(0, span(period.start, completeEnd));
    const comparable = options.range !== 'all' && compareDays > 0;
    const previousStart = comparable ? shift(period.start, -compareDays) : '';
    const previousEnd = comparable ? shift(period.start, -1) : '';
    const selected = dated.filter(x => x.date >= period.start && x.date <= period.end);
    const completed = selected.filter(x => x.date <= completeEnd);
    const previous = comparable ? dated.filter(x => x.date >= previousStart && x.date <= previousEnd) : [];
    let bucketType = options.grain || 'auto';
    if (bucketType === 'auto') bucketType = days <= 45 ? 'day' : days <= 180 ? 'week' : 'month';
    if (!['day', 'week', 'month'].includes(bucketType)) throw Error('统计粒度无效。');
    if (bucketType === 'day' && days > 366) throw Error('按日查看最多 366 天，请选择按周、按月或自动。');
    if (bucketType === 'week' && days > 3660) throw Error('超过 10 年的范围请选择按月或自动。');
    const keyFor = date => bucketType === 'week' ? monday(date) : bucketType === 'month' ? date.slice(0,7) : date;
    const daily = new Map();
    dated.forEach(x => daily.set(x.date, (daily.get(x.date) || 0) + 1));
    const buckets = [];
    const firstDate = dated.reduce((first, item) => item.date < first ? item.date : first, today);
    let current = period.start;
    while (current <= period.end) {
      const key = keyFor(current), start = current;
      let count = 0, previousCount = 0, complete = true;
      while (current <= period.end && keyFor(current) === key) {
        count += daily.get(current) || 0;
        if (current <= completeEnd && comparable) previousCount += daily.get(shift(current, -compareDays)) || 0;
        else if (current === today) complete = false;
        current = shift(current, 1);
      }
      const end = shift(current, -1);
      let average = null;
      if (bucketType === 'day' && start >= shift(firstDate, 6) && end < today) {
        average = Array.from({length:7}, (_, i) => daily.get(shift(end, -i)) || 0).reduce((a,b) => a+b,0) / 7;
      }
      const naturalEnd = bucketType === 'week' ? shift(monday(start),6) : bucketType === 'month' ? iso(Date.UTC(Number(start.slice(0,4)), Number(start.slice(5,7)), 0, 12)) : end;
      buckets.push({key, start, end, count, previousCount: comparable && start <= completeEnd ? previousCount : null,
        previousStart: comparable ? shift(start, -compareDays) : '', previousEnd: comparable ? shift(end > completeEnd ? completeEnd : end, -compareDays) : '',
        partial: !complete || (bucketType === 'week' && (start !== monday(start) || end !== naturalEnd)) || (bucketType === 'month' && (start.slice(8) !== '01' || end !== naturalEnd)),
        average, label: bucketType === 'month' ? key : start.slice(5)});
    }
    const issues = rank(selected, columns.issue), codes = rank(selected, columns.code), groups = rank(selected, columns.group);
    const previousIssues = rank(previous, columns.issue), completeIssues = rank(completed, columns.issue);
    const keys = new Set([...completeIssues.map(x => x.key), ...previousIssues.map(x => x.key)]);
    const nowMap = new Map(completeIssues.map(x => [x.key,x.count])), beforeMap = new Map(previousIssues.map(x => [x.key,x.count]));
    const changes = [...keys].map(key => { const count = nowMap.get(key)||0, before = beforeMap.get(key)||0; return {key,label:key||'未填写',count,before,delta:count-before,percent:before?(count-before)/before:null}; }).sort((a,b)=>b.delta-a.delta||b.count-a.count||a.key.localeCompare(b.key));
    const combosMap = new Map();
    if (columns.code && columns.issue) selected.forEach(({record}) => {const code=text(record,columns.code),issue=text(record,columns.issue),key=JSON.stringify([code,issue]);const item=combosMap.get(key)||{code,issue,count:0};item.count++;combosMap.set(key,item);});
    const codeTypes = {number:0,letters:0,mixed:0,other:0};
    selected.forEach(({record})=>{const code=text(record,columns.code);if(!code)return;const kind=/^\d+$/.test(code)?'number':/^[A-Za-z]+$/.test(code)?'letters':/[A-Za-z]/.test(code)&&/\d/.test(code)?'mixed':'other';codeTypes[kind]++;});
    const serials = new Set(selected.map(x=>text(x.record,columns.serial)).filter(Boolean));
    const backlog = scoped.filter(r=>(r.workflow?.status||'待处理')!=='已关闭');
    const delta = completed.length-previous.length;
    return {...period, range:String(options.range),columns,selected,previous,completed,invalid,scopeRecords:scoped,
      future:dated.filter(x=>x.date>today).length, containsToday, comparable,completeEnd,previousStart,previousEnd,compareDays,delta,percent:previous.length?delta/previous.length:null,
      issues,codes,groups,changes,combos:[...combosMap.values()].sort((a,b)=>b.count-a.count||a.code.localeCompare(b.code)),
      codeKeys:codes.filter(x=>x.key),codeTypes,serialCount:serials.size,missingSerial:selected.filter(x=>!text(x.record,columns.serial)).length,
      backlog:backlog.length,overdue:backlog.filter(r=>r.workflow?.dueDate&&r.workflow.dueDate<today).length,
      todayCount:dated.filter(x=>x.date===today).length,last7:dated.filter(x=>x.date>=shift(today,-6)&&x.date<=today).length,
      previous7:dated.filter(x=>x.date>=shift(today,-13)&&x.date<=shift(today,-7)).length,buckets,bucketType,cutoff:period.start};
  }
  const api = Object.freeze({build,shift,valid,span,rank});
  if (typeof module !== 'undefined' && module.exports) module.exports=api;
  else root.AnalyticsCore=api;
})(typeof window === 'undefined' ? globalThis : window);
