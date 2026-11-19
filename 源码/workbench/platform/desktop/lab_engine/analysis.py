"""Offline facets, calendar aggregation and explicit production-cohort rate matching."""
from datetime import date, timedelta
from collections import defaultdict, Counter
import json, math
from . import manual_production, store, tabular

ROLES=set(tabular.ALIASES)|{'quantity','week','month'}
def bucket(day,period):
    d=date.fromisoformat(day)
    if period=='week': return (d-timedelta(days=d.weekday())).isoformat()
    if period=='month': return day[:7]+'-01'
    return day
def bucket_label(day,period):
    if period=='week':
        d=date.fromisoformat(day); y,w,_=d.isocalendar(); return f'{y}-W{w:02d}'
    return day[:7] if period=='month' else day
def resolve_range(source_catalog,query):
    if not source_catalog['end']: return None
    end=date.fromisoformat(source_catalog['end']); mode=query.get('range','recent14')
    if mode=='custom':
        start=date.fromisoformat(query['start']); stop=date.fromisoformat(query['end'])
        if start>stop or (stop-start).days>3660: raise ValueError('日期范围需有序且不超过10年。')
        return start.isoformat(),stop.isoformat()
    if mode=='all': start=date.fromisoformat(source_catalog['start'])
    elif mode=='latest': start=end
    elif mode in ['week','recent8w']: start=end-timedelta(days=end.weekday()+(49 if mode=='recent8w' else 0))
    elif mode in ['month','recent6m']:
        m=end.year*12+end.month-1-(5 if mode=='recent6m' else 0); start=date(m//12,m%12+1,1)
    else: start=end-timedelta(days={'recent7':6,'recent30':29}.get(mode,13))
    return start.isoformat(),end.isoformat()
def value(row,field,source):
    if field=='week': return bucket_label(row['date'],'week')
    if field=='month': return row['date'][:7]
    if field in ROLES: return row.get(field,'')
    if field==source['mapping'].get('date'): return row['date']
    if field==source['mapping'].get('quantity'): return row['quantity']
    return row['values'].get(field,'')
def role(field,source):
    return field if field in ROLES else next((key for key,fid in source['mapping'].items() if fid==field),None)
def matches(actual,rule):
    op=rule['op']; raw=tabular.display(actual); wanted=rule.get('values',[])
    if op=='empty': return not raw
    if op=='notEmpty': return bool(raw)
    if not wanted: return True
    a=raw if rule.get('caseSensitive') else raw.casefold()
    vals=wanted if rule.get('caseSensitive') else [x.casefold() for x in wanted]
    if op in ['in','equals']: return a in vals
    if op in ['notIn','notEquals']: return a not in vals
    if op=='contains': return vals[0] in a
    if op=='notContains': return vals[0] not in a
    if op=='startsWith': return a.startswith(vals[0])
    if op=='endsWith': return a.endswith(vals[0])
    if op in ['gte','lte','between']:
        try:
            if isinstance(actual,(int,float)): x=float(actual); bounds=[float(v.replace(',','')) for v in wanted]
            else:
                try: x=float(raw.replace(',','')); bounds=[float(v.replace(',','')) for v in wanted]
                except ValueError: x=tabular.parse_date(raw); bounds=[tabular.parse_date(v) for v in wanted]
            if op=='gte': return x>=bounds[0]
            if op=='lte': return x<=bounds[0]
            return len(bounds)==2 and bounds[0]<=x<=bounds[1]
        except (ValueError,TypeError): return False
    raise ValueError('不支持的筛选规则')
def filtered(rows,source,filters): return [r for r in rows if all(matches(value(r,f['field'],source),f) for f in filters)]

def decision_scope(rows, source, query):
    if source.get('kind') != 'defects' or not query.get('ignorePendingDecisions', True):
        return rows
    if source.get('sheet', '').strip().casefold() != 'container':
        return rows
    columns = {col['label']: col['id'] for col in source['columns']}
    status, reason = columns.get('状态'), columns.get('判定原因')
    def pending(row):
        if row.get('pendingDecision'):
            return True
        if not (status and reason):
            return False
        raw = row['values']
        return (reason in raw and not tabular.display(raw[reason]) and
                tabular.display(raw.get(status)) in tabular.PENDING_DECISION_STATES)
    return [row for row in rows if not pending(row)]

def select_rows(rows, source, query):
    return filtered(decision_scope(rows, source, query), source, query.get('filters', []))
def sort_details(rows, source, query):
    sort = query.get('sort', {'field': 'date', 'direction': 'desc'})
    def key(row):
        actual = value(row, sort['field'], source)
        if actual is None: return (2, '')
        if isinstance(actual, (int, float)): return (0, float(actual))
        return (1, str(actual).casefold())
    rows.sort(key=key, reverse=sort.get('direction') == 'desc')

def core(db,source,query):
    allowed=ROLES|{c['id'] for c in source.get('columns',[])}
    requested=[f['field'] for f in query.get('filters',[])]+[query.get('dimension','employee'),query.get('sort',{}).get('field','date')]
    if any(field not in allowed for field in requested): raise ValueError('已保存的筛选、维度或排序字段不在当前来源中，请重置本面板后重新选择。')
    catalog=store.catalog(db,source); span=resolve_range(catalog,query)
    if not span: return catalog,None,[],[]
    base=store.load_rows(db,source,*span)
    return catalog,span,base,select_rows(base,source,query)
TEXT_FACET_OPERATORS = {'contains', 'notContains', 'startsWith', 'endsWith'}


def facets(db, source, query, field, search='', offset=0, match_op=None, case_sensitive=False):
    if field not in ROLES and field not in {c['id'] for c in source.get('columns', [])}:
        raise ValueError('筛选字段不在当前数据源。')
    if match_op is not None and match_op not in TEXT_FACET_OPERATORS:
        raise ValueError('不支持此文字预览规则。')
    if not match_op:
        query = {**query, 'filters': [f for f in query.get('filters', []) if f['field'] != field]}
    _, _, _, rows = core(db, source, query)
    counts = Counter(tabular.display(value(row, field, source)) for row in rows)
    rule = {'op': match_op or 'contains', 'values': [search], 'caseSensitive': case_sensitive}
    values = sorted((key for key in counts if not search or matches(key, rule)),
                    key=lambda key: (key.casefold(), key))
    offset = max(0, int(offset))
    selected = values[offset:offset + 200]
    return {
        'values': [{'value': key, 'label': key or '(空白)', 'count': counts[key]} for key in selected],
        'total': len(values), 'rowCount': sum(counts[key] for key in values),
        'offset': offset, 'more': offset + 200 < len(values),
    }


def production_scope(rows, source, query, rate_basis):
    """Selected-defect comparisons use the full production scope of other filters."""
    if rate_basis == 'selected-defects':
        filters = [rule for rule in query.get('filters', []) if not is_defect_filter(rule['field'], source)]
        query = {**query, 'filters': filters}
    return select_rows(rows, source, query)


def is_defect_filter(field, source):
    return role(field, source) == 'defect' or (
        source.get('kind') == 'defects' and
        any(c['id'] == field and c['label'].strip() == '判定原因' for c in source['columns'])
    )


def rate_context(db,source,production,query,base,span,rate_basis='same-scope',*,manual_rows=None):
    if rate_basis not in ('same-scope', 'selected-defects'):
        raise ValueError('不良率统计口径无效。')
    if not production: return {'production':[], 'reason':'未选择产量数据源','covered':set(),'complete':set()}
    if manual_rows is None:
        prows = store.load_rows(db,production,*span)
    else:
        prows = [row for row in manual_rows if span[0] <= row['date'] <= span[1]]
    translated=[]; invalid=[]; unmatched=[]
    for f in query.get('filters',[]):
        key=role(f['field'],source)
        if rate_basis == 'selected-defects' and is_defect_filter(f['field'], source):
            # An explicit daily-report policy: selected defective units divided
            # by all matched process/shift production. The numerator remains
            # filtered; only this declared role need not exist in production.
            continue
        if key in ['defect','quantity']:
            # These filters cannot be applied to the production side. Dividing
            # filtered defects by full production silently understates the rate.
            unmatched.append(key)
            continue
        if key in ['date','week','month']: translated.append({**f,'field':key}); continue
        if key and production['mapping'].get(key): translated.append({**f,'field':key})
        else: invalid.append(key or next((c['label'] for c in source['columns'] if c['id']==f['field']),'额外字段'))
    prows=filtered(prows,production,translated)
    observed={(r['date'],r.get('process',''),r.get('shift','')) for r in base}
    dates=set(store.catalog(db,source)['dates'])
    complete={ (r['date'],r.get('process',''),r.get('shift','')) for r in prows if (r['date'],r.get('process',''),r.get('shift','')) in observed or (source.get('coverage')=='daily_complete' and r['date'] in dates) }
    reason=''
    if source.get('unit')!='units': reason='数量尚未确认为已按件去重的不良件数，当前统计不良数量'
    elif invalid: reason='产量没有对应字段，不能计算该筛选范围的不良率：'+ '、'.join(invalid)
    elif unmatched: reason='当前筛选含不良项或数量条件，产量无对应字段，不能计算该范围的不良率；请改用不良数量或记录条数指标。'
    elif source.get('_grouping',{}).get('kind')=='productType': reason='当前分类字段为产品类型，未指定真实工序，不能冒充日期＋工序＋班次的产量匹配。'
    elif not source['mapping'].get('process') or not (source['mapping'].get('shift') or source.get('calendar',{}).get('mode')=='check-time'): reason='不良数据缺少工序或班次，无法匹配日期＋工序＋班次产量'
    context = {'production':prows,'reason':reason,'covered':observed,'complete':complete,'source':production}
    if manual_rows is not None:
        context['manualRequired'] = {manual_production.key(row) for row in production_scope(base, source, query, rate_basis)}
    return context


def compute_rate(rows,context,*,required=None):
    p=context['production']; total=sum(r['quantity'] for r in p)
    reasons=[context['reason']] if context['reason'] else []
    pending = any(r.get('productionMissing') for r in p)
    if pending: reasons.append('匹配范围含尚未填写的实际产量，请补充后重新导入')
    cohorts={(r['date'],r.get('process',''),r.get('shift','')) for r in p}
    bad_cohorts={(r['date'],r.get('process',''),r.get('shift','')) for r in rows}
    if not p: reasons.append('没有匹配产量')
    elif cohorts-context['complete']: reasons.append('部分产量日期/工序/班次缺少已确认完整的不良明细')
    manual = 'manualRequired' in context
    required = (context['manualRequired'] if required is None else required) if manual else bad_cohorts
    missing = not (required | bad_cohorts) <= cohorts
    if missing:
        reasons.append('部分业务日期、工序或班次未手填产量' if manual else '部分不良日期/工序/班次缺少产量')
    if p and total<=0: reasons.append('产量分母为零')
    qty=sum(r['quantity'] for r in rows)
    over = qty > total + .000001
    if manual and p:
        defect_totals = Counter()
        for row in rows:
            defect_totals[manual_production.key(row)] += row['quantity']
        over = over or any(defect_totals[manual_production.key(row)] > row['quantity'] + .000001 for row in p)
    if total>0 and over and not context['reason']: reasons.append('不良件数超过产量，请核对重复或统计口径')
    return {'value':qty/total if total>0 and not reasons else None,'denominator':total if p and not pending and not (manual and missing) else None,'reason':'；'.join(dict.fromkeys(reasons)),'cohorts':len(cohorts),'matchedCohorts':len(cohorts.intersection(context['complete']))}


def required_for_dimension(context, dimension, keys):
    required = context.get('manualRequired')
    if required is None:
        return None
    if dimension in ('process', 'shift'):
        index = manual_production.FIELDS.index(dimension)
        return {cohort for cohort in required if cohort[index] in keys}
    if dimension in ('date', 'week', 'month'):
        period = {'date':'day','week':'week','month':'month'}[dimension]
        return {cohort for cohort in required if bucket_label(bucket(cohort[0], period), period) in keys}
    return required
def groups(rows,source,dimension):
    result=defaultdict(list)
    for r in rows: result[tabular.display(value(r,dimension,source))].append(r)
    return result
def process_breakdown(rows, previous, comparable, limit=30):
    def aggregate(records):
        totals = defaultdict(Counter)
        counts = defaultdict(Counter)
        for row in records:
            process = tabular.display(row.get('process'))
            issue = tabular.display(row.get('defect'))
            totals[process][issue] += row['quantity']
            counts[process][issue] += 1
        return totals, counts

    current, counts = aggregate(rows)
    prior, _ = aggregate(previous if comparable else [])

    def comparison(quantity, baseline):
        return {'quantity': quantity, 'previous': baseline if comparable else None,
                'change': quantity - baseline if comparable else None}

    processes = sorted(current.keys() | prior.keys(), key=lambda p: (-sum(current[p].values()), p))
    groups = []
    for process in processes[:limit]:
        quantity = sum(current[process].values())
        issues = sorted(current[process].keys() | prior[process].keys(),
                        key=lambda i: (-current[process][i], i))
        groups.append({'key': process, 'rows': sum(counts[process].values()),
                       **comparison(quantity, sum(prior[process].values())),
                       'issueCount': len(issues), 'issues': [
                           {'key': issue, 'rows': counts[process][issue],
                            **comparison(current[process][issue], prior[process][issue]),
                            'share': current[process][issue] / quantity if quantity else None}
                           for issue in issues[:limit]]})
    return {'groups': groups, 'totalGroups': len(processes), 'comparable': comparable, 'limit': limit}


def analyze(db,source,production,query,period='day',page=1,*,rate_basis='same-scope',manual_rows=None):
    catalog,span,base,rows=core(db,source,query)
    if not span: return {'empty':True,'revision':store.revision(db),'columns':source['columns'],'message':'该来源尚未导入有效数据。'}
    from . import grouping_semantics
    grouping=grouping_semantics.from_db(db,source)
    source={**source,'_grouping':grouping}
    ctx=rate_context(db,source,production,query,base,span,rate_basis,manual_rows=manual_rows); overall=compute_rate(rows,ctx)
    dates=set(catalog['dates']); start,end=map(date.fromisoformat,span)
    times=defaultdict(list); present=defaultdict(list)
    day=start
    while day<=end:
        key=bucket(day.isoformat(),period); present[key].append(day.isoformat()); day+=timedelta(days=1)
    for r in rows: times[bucket(r['date'],period)].append(r)
    trend=[]
    for key,days in sorted(present.items()):
        subset=times[key]; p=[r for r in ctx['production'] if r['date'] in days]
        day_set = set(days)
        required = {cohort for cohort in ctx['manualRequired'] if cohort[0] in day_set} if 'manualRequired' in ctx else None
        r=compute_rate(subset,{**ctx,'production':p}, required=required)
        known=[d for d in days if d in dates]
        trend.append({'label':bucket_label(key,period),'start':days[0],'end':days[-1],'quantity':sum(x['quantity'] for x in subset) if known else None,'rows':len(subset) if known else None,'rate':r['value'],'production':r['denominator'],'rateReason':r['reason'],'partial':len(known)!=len(days),'coverage':len(known),'days':len(days)})
    dimension=query.get('dimension','employee'); grouped=groups(rows,source,dimension); points=[]
    for key,items in grouped.items():
        supported=dimension=='defect' or dimension in ['date','week','month'] or (dimension in ROLES and production and production['mapping'].get(dimension))
        if dimension=='defect': p=ctx['production']
        elif supported: p=[r for r in ctx['production'] if tabular.display(value(r,dimension,production))==key]
        else: p=[]
        r=compute_rate(items,{**ctx,'production':p}, required=required_for_dimension(ctx, dimension, {key})) if supported else {'value':None,'reason':'没有该维度的产量，不能计算分组不良率'}
        points.append({'label':key or '(空白)','key':key,'quantity':sum(x['quantity'] for x in items),'rate':r['value'],'rateReason':r['reason'],'rows':len(items)})
    points.sort(key=lambda x:(-x['quantity'],x['label']))
    if dimension in ['date','week','month']: points.sort(key=lambda x:x['key'])
    category_count=len(points); top=query.get('topN',10)
    if dimension not in ['date','week','month'] and top and len(points)>top:
        rest=points[top:]; keys={p['key'] for p in rest}; other_rows=[r for r in rows if tabular.display(value(r,dimension,source)) in keys]
        supported=dimension=='defect' or (dimension in ROLES and production and production['mapping'].get(dimension))
        p=ctx['production'] if dimension=='defect' else [r for r in ctx['production'] if tabular.display(value(r,dimension,production)) in keys] if supported else []
        rate=compute_rate(other_rows,{**ctx,'production':p}, required=required_for_dimension(ctx, dimension, keys)) if supported else {'value':None,'reason':'没有对应产量'}
        points=points[:top]+[{'label':f'其他（{len(rest)}类）','key':None,'quantity':sum(p['quantity'] for p in rest),'rate':rate['value'],'rateReason':rate['reason'],'rows':sum(p['rows'] for p in rest),'other':True}]
    elif len(points)>10000: raise ValueError('分类超过1万项，请使用Top N或缩小范围。')
    defect_groups=groups(rows,source,'defect'); defects=[{'label':k,'quantity':sum(r['quantity'] for r in items)} for k,items in defect_groups.items()]
    defects.sort(key=lambda x:(-x['quantity'],x['label']))
    sort_details(rows, source, query)
    size=query.get('pageSize',50); page=max(1,min(int(page),max(1,math.ceil(len(rows)/size))))
    details=[{'id':r['id'],'date':r['date'],'quantity':r['quantity'],'file':r['file'],'row':r['row'],'values':{c['id']:tabular.display(value(r,c['id'],source)) for c in source['columns']}} for r in rows[(page-1)*size:page*size]]
    length=(end-start).days+1; previous_span=((start-timedelta(days=length)).isoformat(),(start-timedelta(days=1)).isoformat())
    previous=select_rows(store.load_rows(db,source,*previous_span),source,query)
    previous_qty=sum(r['quantity'] for r in previous); qty=sum(r['quantity'] for r in rows)
    warnings=[]
    ignored_pending = len(base) - len(decision_scope(base, source, query))
    if ignored_pending: warnings.append(f'当前日期内已忽略 {ignored_pending} 条未判定且判定原因为空的记录。')
    unassigned=sum(bool(r.get('shiftNote')) for r in rows)
    if unassigned: warnings.append(f'{unassigned}条记录未归班：时间缺失或不在已配置班次时段，未强行匹配产量。')
    if overall['reason']: warnings.append(overall['reason'])
    missing=[(start+timedelta(days=i)).isoformat() for i in range(length) if (start+timedelta(days=i)).isoformat() not in dates]
    prior_start = date.fromisoformat(previous_span[0])
    comparable = not missing and all((prior_start+timedelta(days=i)).isoformat() in dates for i in range(length))
    if missing: warnings.append(f'区间有{len(missing)}天没有已导入文件；缺失与零不良不同')
    return {'empty':False,'revision':store.revision(db),'sourceId':source['id'],'grouping':grouping,'range':{'start':span[0],'end':span[1]},'period':period,'columns':source['columns'],
            'metricLabel':'不良件数' if source.get('unit')=='units' else '不良数量','quantity':qty,'recordCount':len(rows),'ignoredPending':ignored_pending,'rate':overall,'trend':trend,'points':points,'defects':defects,
            'production':overall['denominator'],'coverage':{'days':len(set(d for d in dates if span[0]<=d<=span[1])),'expectedDays':length,'missing':missing},'warnings':warnings,
            'comparison':{'start':previous_span[0],'end':previous_span[1],'quantity':previous_qty if comparable else None,'change':qty-previous_qty if comparable else None},
            'breakdown':process_breakdown(rows,previous,comparable),
            'processes':sorted({r.get('process','') for r in rows}),'categoryCount':category_count,
            'details':details,'page':page,'pageSize':size,'pages':max(1,math.ceil(len(rows)/size)),'query':query}
