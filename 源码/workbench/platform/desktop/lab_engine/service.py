"""Small action dispatcher. Source definitions come from workspace-bound host config."""
from . import analysis, manual_production, store, tabular

LABELS={'employee':'人员','reporter':'报检人','process':'工序','shift':'班次','defect':'不良项','floor':'楼层','product':'产品','date':'日期','week':'周','month':'月'}
def short_range(span):
    a,b=span['start'],span['end']
    short=lambda text:f'{int(text[5:7])}月{int(text[8:10])}日'
    return short(a) if a==b else short(a)+'至'+short(b) if a[:4]==b[:4] else a+'至'+b

def check_daily_export_rows(source, export_rows, template_map):
    # The native template omits rows without a mapped container/SN. Reject a
    # mixed population before both preview and export rather than displaying a
    # rate whose numerator includes rows absent from the accompanying table.
    from . import original_report
    _, skipped = original_report.build_rows(source, export_rows, template_map)
    if skipped:
        raise ValueError(
            f'当前筛选有 {skipped} 条容器号/SN为空，目标模板会跳过这些记录；'
            '为保持总表与不良率数量一致，未生成不良率。'
            '请补齐模板对应的容器号/SN后重新导入；'
            '也可取消附加不良率，仅导出原数量表。'
        )


def daily_rate_report(db, source, sources, query, settings, template_map=None):
    """Use the exact exported population; never substitute another denominator."""
    if not settings.get('includeRate', False):
        return None
    mode = settings.get('productionMode', 'bound')
    typed_rows = None
    if mode == 'manual':
        production = manual_production.SOURCE
        typed_rows = manual_production.rows(settings.get('manualProduction', []))
    elif mode == 'bound':
        production = sources.get(settings.get('productionId'))
        if not production or production.get('kind') != 'production' or not production.get('confirmed'):
            raise ValueError('请在每日导表配置中绑定已确认的产量来源，或取消附加不良率表。')
    else:
        raise ValueError('日报产量方式无效。')
    period = settings.get('period', 'day')
    if period not in ('day', 'week', 'month'):
        raise ValueError('不良率趋势的统计周期无效。')
    _, _, _, export_rows = analysis.core(db, source, query)
    check_daily_export_rows(source, export_rows, template_map)
    rate_basis = settings.get('rateBasis', 'same-scope')
    result = analysis.analyze(db, source, production, query, period, rate_basis=rate_basis, manual_rows=typed_rows)
    if result.get('empty'):
        raise ValueError('当前范围没有已导入的不良数据，请先查询后导出。')
    rate = result['rate']
    scope = ('所选不良件数 ÷ 对应工序班次总产量；日期＋工序＋班次匹配'
             if rate_basis == 'selected-defects' else '当前导出筛选；产量按日期＋工序＋班次匹配')
    if typed_rows is not None:
        scope = f'仅使用本日报手填产量。{scope}'
    for point in result['trend']:
        if point.get('partial'):
            point['rate'] = None
            point['rateReason'] = '；'.join(filter(None, [point.get('rateReason'), '统计周期未覆盖全部日期']))
    return {
        'title': settings.get('rateTitle', '每日不良率趋势'),
        'period': period,
        'range': result['range'],
        'sourceName': source['name'],
        'productionName': production['name'],
        'scope': scope,
        'trend': result['trend'],
        'summary': {'quantity': result['quantity'], 'production': result['production'],
                    'rate': rate['value'], 'rateReason': rate['reason']},
        'warnings': result['warnings'],
    }
def handle(db,body):
    action=body.get('action'); config=body.get('config',{})
    policies=body.get('calendar',{}).get('sources',{})
    sources={s['id']:{**s,**({'calendar':policies[s['id']]} if s['id'] in policies else {})} for s in config.get('sources',[])}
    if action=='home':
        from .home import project
        return project(db,{**config,'sources':list(sources.values())},body)
    if action=='rollbackRestore':
        if store.revision(db)!=body['revision']: raise ValueError('分析库已变化，未回退恢复。')
        with db:
            db.execute('DELETE FROM records');db.execute('DELETE FROM files');db.execute('DELETE FROM sources');db.execute("UPDATE meta SET value=0 WHERE key='revision'")
        return {'rolledBack':True}
    if action=='status':
        return {'revision':store.revision(db),'sources':{key:store.catalog(db,s) for key,s in sources.items()}}
    if action=='reportData':
        charts=[]
        for index,definition in enumerate(config['report']['charts'], 1):
            source=sources[definition['sourceId']]; production=sources.get(definition.get('productionId'))
            query={**definition['query'],'dimension':definition['dimension'],'chartType':definition['type'],'metric':definition['metric']}
            if definition.get('defect'): query['filters']=[*query['filters'],{'field':'defect','op':'equals','values':[definition['defect']],'caseSensitive':True}]
            aggregation={'date':'day','week':'week','month':'month'}.get(definition['dimension'],definition['period'])
            result=analysis.analyze(db,source,production,query,aggregation)
            if result.get('empty'): raise ValueError(f'图表“{source["name"]}”没有已导入数据，请先导入。')
            series = result['trend'] if definition['dimension'] in ['date','week','month'] else result['points']
            points = [{'label':p['label'],'value':p[definition['metric']]} for p in series]
            if points and all(p['value'] is None for p in points):
                if definition['metric'] == 'rate':
                    reason = next((p.get('rateReason') for p in series if p.get('rateReason')), '当前条件没有可计算的比率')
                    raise ValueError(f'第{index}张图无法计算不良率：{reason}。可在本图“图表指标”选择不良数量或记录条数。')
                raise ValueError(f'第{index}张图的日期范围没有已导入数据，请核对图表范围。')
            processes=result['processes']
            grouping=result.get('grouping',{'kind':'process','label':'工序'})
            context={'日期':short_range(result['range']),'工序':processes[0] if len(processes)==1 else '多'+grouping['label'],'不良项':definition.get('defect') or (result['defects'][0]['label'] if len(result['defects'])==1 else '多不良项'),'维度':grouping['label'] if definition['dimension']=='process' else LABELS.get(definition['dimension'],next((c['label'] for c in source['columns'] if c['id']==definition['dimension']),'分类')),'周期':{'day':'每日','week':'每周','month':'每月'}[definition['period']]}
            def title(template):
                for key,value in context.items(): template=template.replace('{'+key+'}',value)
                return template
            charts.append({'id':definition['id'],'title':title(definition['title'] or '{日期}{不良项}{维度}'),'type':definition['type'],'metric':definition['metric'],'data':points,'context':context,'range':result['range'],'sourceName':source['name'],'grouping':grouping,'query':query,'warnings':result['warnings']})
        context=dict(charts[0]['context']) if charts else {}
        if charts:
            context['日期']=short_range({'start':min(c['range']['start'] for c in charts),'end':max(c['range']['end'] for c in charts)})
            group_labels={c.get('grouping',{}).get('label','工序') for c in charts}
            group_name=next(iter(group_labels)) if len(group_labels)==1 else '分类'
            for key,fallback in [('工序','多'+group_name),('不良项','多不良项'),('维度','多维度'),('周期','综合')]:
                if len({c['context'][key] for c in charts})>1: context[key]=fallback
        title=config['report']['title']
        for key,value in context.items(): title=title.replace('{'+key+'}',value)
        return {'revision':store.revision(db),'signature':store.report_signature(config,body.get('calendar')),'title':title,'charts':charts}
    if action in ['export','backup','restore','inspectBackup']:
        from . import exports
        return getattr(exports,action)(db,body)
    if action == 'inspectOriginalTemplate':
        from . import original_report
        return original_report.inspect_template(body['template'])
    if action == 'templateHeaders':
        from . import original_report
        return {'headers': original_report.template_headers()}
    source=sources.get(body.get('sourceId'))
    if source is None: raise ValueError('请选择有效数据源。')
    if action == 'importHistory':
        return store.import_history(db, source, body.get('offset', 0))
    if action == 'setImportBatch':
        return store.set_import_batch(db, source, body.get('batchId'), body.get('enabled'), body.get('revision'))
    if action=='scan': return store.scan(db,source)
    if action=='inspect':
        name=body.get('name')
        if not name:
            files=store.scan(db,source)['files']
            if not files: raise ValueError('目录没有可读XLSX/CSV文件。')
            name=max(files,key=lambda x:x['modified'])['name']
        try:
            return {**tabular.inspect(store.file_path(source,name),source),'name':name}
        except PermissionError as error:
            raise ValueError(store.file_access_message(name)) from error
    if action=='import':
        return store.import_files(db,source,body.get('names'))
    query=body.get('query',{})
    settings = config.get('dailyReports', {}).get(source['id'], {})
    template_map = body.get('templateMap')
    if settings.get('reasonColumn') and action in (
            'dailyProductionCohorts', 'previewDailyRate', 'exportOriginalReport', 'analyze'):
        from . import original_report
        if settings['reasonColumn'] not in {column['id'] for column in source['columns']}:
            raise ValueError('原判定原因列已改变，请在每日导表配置中重新绑定。')
        resolved = original_report.resolve_columns(source, template_map)
        resolved['判定原因'] = settings['reasonColumn']
        # A manual reason choice cannot make unrelated, missing template mappings valid.
        if isinstance(template_map, dict) or all(resolved.values()):
            template_map = resolved
    if action == 'dailyProductionCohorts':
        if source.get('kind') != 'defects':
            raise ValueError('请选择日报的不良明细来源。')
        if store.revision(db) != body['revision']:
            raise ValueError('分析数据已更新，请重新查询后填写实际产量。')
        settings = config.get('dailyReports', {}).get(source['id'], {})
        basis = settings.get('rateBasis', 'same-scope')
        _, _, base, records = analysis.core(db, source, query)
        check_daily_export_rows(source, records, template_map)
        scope = analysis.production_scope(base, source, query, basis)
        return manual_production.suggestions(scope, records)
    if action == 'previewDailyRate':
        if store.revision(db) != body['revision']:
            raise ValueError('分析数据已更新，请重新查询后核对不良率。')
        settings = config.get('dailyReports', {}).get(source['id'], {})
        if settings.get('chartLayout') == 'reason-columns':
            from . import daily_template_report
            _, span, base, _ = analysis.core(db, source, query)
            _, _, _, report = daily_template_report.prepare(
                db, source, sources, query, settings, span, base, template_map, ())
            if report is None:
                raise ValueError('当前范围没有可核对的判定日期，请先导入并查询。')
            trend = []
            for day in report['days']:
                quantity, production = day['quantity'], day['production']
                rate = quantity / production if production and quantity is not None and quantity <= production else None
                trend.append({'label': day['date'], 'quantity': quantity, 'production': production,
                              'rate': rate, 'rateReason': day.get('rateReason', '')})
            return {'title': '每日不良率', 'scope': '按判定时间 07:00 至次日 07:00 归日；不良数按数量列非空记录计数',
                    'trend': trend, 'rules': report['rules']}
        report = daily_rate_report(db, source, sources, query, settings, template_map)
        if report is None:
            raise ValueError('请先勾选附加不良率数据表和折线图。')
        return report
    if action == 'exportQuickReport':
        from . import quick_report
        return quick_report.export(db, source, body)
    if action == 'exportOriginalReport':
        from . import original_report
        if store.revision(db) != body['revision']:
            raise ValueError('分析数据已更新，请重新查询后再导出。')
        catalog, span, base, rows = analysis.core(db, source, query)
        analysis.sort_details(rows, source, query)
        settings = config.get('dailyReports', {}).get(source['id'], {})
        layout = settings.get('chartLayout', 'original')
        if layout == 'reason-columns' and span:
            from . import daily_template_report
            hints = original_report.template_daily_groups(body['template'])
            people, title, groups, rate = daily_template_report.prepare(
                db, source, sources, query, settings, span, base, template_map, hints)
            return original_report.export(
                body['template'], body['output'], source, rows, template_map, chart_layout=layout,
                rate_report=None, reason_groups=settings.get('reasonGroups', ()), daily_rows=people, daily_title=title,
                daily_reason_groups=groups, template_rate=rate, sheet_reasons=settings.get('sheetReasons'))
        rate_report = daily_rate_report(db, source, sources, query, settings, template_map)
        return original_report.export(body['template'], body['output'], source, rows,
                                      template_map, rate_report=rate_report, chart_layout=layout, reason_groups=())
    if action == 'facets':
        return analysis.facets(db, source, query, body['field'], body.get('search', ''),
                               body.get('offset', 0), body.get('matchOp'), body.get('caseSensitive', False))
    if action=='analyze':
        from . import original_report
        result = analysis.analyze(db, source, sources.get(body.get('productionId')), query,
                                  body.get('period','day'), body.get('page',1))
        return {**result, 'canExportOriginalReport': original_report.supports_template(source, template_map)}
    raise ValueError('不支持的分析操作。')
