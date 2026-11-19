"""Read-only projection of the native BI store into the existing homepage DTO."""
from datetime import date, timedelta
from pathlib import Path
import importlib.util
from . import analysis, store, tabular
from . import grouping_semantics

_spec = importlib.util.spec_from_file_location('_native_home_projection', Path(__file__).resolve().parents[1] / 'bi-home.py')
_projection = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_projection)


HOME_ROLES = {'process': 'process', 'issue': 'defect', 'employee': 'employee',
              'reporter': 'reporter', 'shift': 'shift'}


def home_fields(source, rows, saved, linked):
    columns = {col['id']: col for col in source['columns']}
    candidates = []
    for field, col in columns.items():
        examples = []
        for row in rows[:200]:
            text = tabular.display(row['values'].get(field))[:80]
            if text and text not in examples:
                examples.append(text)
            if len(examples) == 3:
                break
        candidates.append({'id': field, 'label': col['label'], 'examples': examples})
    automatic = {role: source['mapping'].get(key, '') for role, key in HOME_ROLES.items()}
    if linked and source.get('sheet', '').strip().casefold() == 'container':
        reason = next((col['id'] for col in columns.values() if col['label'] == '判定原因'), '')
        if reason:
            automatic['issue'] = reason
    applied, missing = {}, []
    for role, col in saved.items():
        if role in HOME_ROLES:
            if col in columns:
                applied[role] = col
            else:
                missing.append(role)
    fields = {**automatic, **applied}
    return fields, applied, {'sourceId': source['id'], 'sourceName': source['name'],
        'columns': candidates, 'automatic': automatic, 'saved': saved, 'effective': fields, 'missing': missing}


def project(db, config, body):
    sources = [s for s in config.get('sources', []) if s.get('kind') == 'defects']
    shared = config.get('sharedAnalysis')
    source = next((s for s in sources if shared and s['id'] == shared['sourceId']), None)
    if source is None:
        source = next((s for s in sources if s['id'] == config.get('activeSource')), None)
    if source is None and len(sources) == 1:
        source = sources[0]
    if source is None:
        return {'state': 'ambiguous' if sources else 'empty', 'channel': 'studio',
                'message': '请在BI自由分析选择要显示的数据源。' if sources else '此工作区尚未配置BI自由分析来源。'}
    catalog = store.catalog(db, source)
    if not catalog['files']:
        return {'state': 'empty', 'channel': 'studio', 'message': '当前BI来源还没有导入文件，请进入BI自由分析读取下载目录。'}
    rows = store.load_rows(db, source)
    available_count = len(rows)
    linked = bool(shared and shared['sourceId'] == source['id'])
    saved = body.get('homeColumns', {}).get(source['id'], {})
    fields, overrides, field_info = home_fields(source, rows, saved, linked)
    process = overrides.get('process')
    if process:
        grouping = grouping_semantics.describe(
            {**source, 'mapping': {**source['mapping'], 'process': process}},
            (analysis.value(row, process, source) for row in rows),
        )
    else:
        grouping = grouping_semantics.from_rows(source, rows)
    available = {'start': catalog['start'], 'end': catalog['end']} if catalog['start'] else None
    query = dict(body['query'])
    preference = body.get('preference', {})
    if linked:
        selection = shared['query']
        span = analysis.resolve_range(catalog, selection)
        if span:
            start, end = span
            if body.get('biRange'):
                if body.get('biPeriod') == 'previous':
                    lo, hi = date.fromisoformat(start), date.fromisoformat(end)
                    start = (lo - timedelta(days=(hi - lo).days + 1)).isoformat()
                    end = (lo - timedelta(days=1)).isoformat()
                start = max(start, body['biRange']['start'])
                end = min(end, body['biRange']['end'])
                if start > end:
                    return {'state': 'out-of-range', 'channel': 'studio', 'hasData': True,
                            'message': '明细日期不在当前工作台筛选范围内。'}
            query.update(start=start, end=end, grain=shared['period'], filters={}, search='')
        rows = analysis.select_rows(rows, source, selection)
        preference = {}
    elif body.get('allDates') and available:
        query.update(available)
    supported = {'process', 'issue', 'shift', 'reporter', 'serialNumber'}
    unsupported = [k for k, v in query.get('filters', {}).items() if v and k not in supported]
    if unsupported:
        return {'state': 'unsupported-filter', 'channel': 'studio', 'hasData': True,
                'availableRange': available, 'availableRowCount': available_count, 'grouping': grouping, 'homeFields': field_info, 'message': '当前人工筛选不适用于BI：' + '、'.join(unsupported) + '。请清除这些条件；不会忽略条件后生成另一份数量。'}
    projected = []
    for r in rows:
        dimensions = {}
        for role, canonical in HOME_ROLES.items():
            column = overrides.get(role)
            if role == 'issue' and not column and fields.get(role) != source['mapping'].get('defect', ''):
                column = fields[role]
            dimensions[role] = tabular.display(analysis.value(r, column, source) if column else r.get(canonical, ''))
        projected.append({'id': str(r['id']), 'businessId': 'BI-' + str(r['id']), 'date': r['date'],
                          'sn': r.get('serial', ''), **dimensions, 'quantity': r['quantity'],
                          'status': '未提供人工处理状态', 'file': r['file'], 'sourceRow': r['row']})
    reporter_options = sorted({row['reporter'] for row in projected if row['reporter']})
    filters = query.get('filters', {})
    if filters.get('reporter'):
        projected = [r for r in projected if r['reporter'] == filters['reporter']]
    if filters.get('serialNumber'):
        projected = [r for r in projected if r['sn'] == filters['serialNumber']]
    result = _projection.summarize(projected, set(catalog['dates']), query,
                                   preference, 'studio', [], source['name'],
                                   bool(body.get('exportRows')), body.get('biFilter'))
    result.update({'hasData': True, 'sourceId': source['id'], 'sourceName': source['name'], 'grouping': grouping,
                   'availableRange': available, 'availableRowCount': available_count, 'homeFields': field_info,
                   'unitLabel': '件' if source.get('unit') == 'units' else '次',
                   'note': '来自本工作区BI自由分析，与录入不良分开统计。' +
                           ('已确认为去重件数。' if source.get('unit') == 'units' else '当前不良数量未按产品件去重，不能当作唯一不良件数或据此计算真实不良率。')})
    result['options']['reporter'] = reporter_options
    if linked:
        filter_fields = {col['id']: col['label'] for col in source['columns']}
        from .service import LABELS
        result['sharedAnalysis'] = {
            'period': shared['period'],
            'conditions': len(selection.get('filters', [])),
            'filters': [{**rule, 'label': filter_fields.get(rule['field'], LABELS.get(rule['field'], rule['field']))}
                        for rule in selection.get('filters', [])],
            'ignorePendingDecisions': selection.get('ignorePendingDecisions', True),
        }
        target_query = {**selection, 'range': 'custom', 'start': query['start'], 'end': query['end']}
        can_link = True
        if body.get('biFilter'):
            rule = body['biFilter']
            role = rule['field']
            field = overrides.get(role)
            if role == 'issue' and not field:
                field = fields['issue'] or 'defect'
            filters = selection.get('filters', [])
            exact = {'field': field or HOME_ROLES[role], 'op': 'in',
                     'values': [rule['value']], 'caseSensitive': True}
            if exact not in filters:
                can_link = len(filters) < 20 and len(rule['value']) <= 512
                if can_link:
                    target_query['filters'] = [*filters, exact]
        if can_link:
            result['analysisLink'] = {'sourceId': source['id'], 'period': shared['period'], 'query': target_query}
    result['revision']=store.digest({'data':result['revision'],'grouping':grouping, 'selection': shared if linked else None, 'homeFields':fields})
    if result['state'] != 'available':
        result['state'] = 'out-of-range'
        result['message'] = ('此来源共' + str(len(rows)) + '条，业务日期为' + available['start'] + '至' + available['end'] + '；当前日期范围没有覆盖，请查看全部BI日期。') if available else 'BI文件已读入，但没有可确定的业务日期，请核对日期映射。'
    return result
