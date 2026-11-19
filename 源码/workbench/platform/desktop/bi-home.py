"""Read-only BI homepage projection. Daily and historical lanes never add together."""
from collections import defaultdict
from contextlib import closing
from pathlib import Path
import copy
import datetime as dt
import hashlib
import json
import math
import sqlite3

_DAILY_CACHE = {}


def signature(file):
    return tuple((p.stat().st_size, p.stat().st_mtime_ns) if p.exists() else None
                 for p in (file, Path(str(file) + '-wal')))


def bucket(day, grain):
    value = dt.date.fromisoformat(day)
    if grain == 'week':
        return (value - dt.timedelta(days=value.weekday())).isoformat()
    return day[:7] + '-01' if grain == 'month' else day


def projected(row, identity):
    raw = row.get('raw') or {}
    def exact(names):
        return next((str(raw[k]) for k in names if raw.get(k) not in (None, '')), '')
    qty = float(row['qty'])
    if not math.isfinite(qty) or qty < 0:
        raise ValueError('BI数量包含无效值，首页未将其当作零。')
    return {'id': identity, 'date': row['date'], 'process': row.get('process') or '',
            'issue': row.get('item') or '', 'employee': row.get('employee') or '',
            'shift': row.get('shift') or '', 'quantity': qty, 'status': row.get('status') or '',
            'sn': exact(['SN', 'Serial Number', '序列号']),
            'businessId': exact(['NC ID', 'NC Number', 'NC编号', '异常编号'])}


def read_daily(base, requested):
    file = Path(base) / '日报历史/snapshots.sqlite'
    if not file.is_file():
        return [], set(), [], False, ''
    stamp = signature(file)
    key = (str(file.resolve()), stamp, requested)
    if key in _DAILY_CACHE:
        return _DAILY_CACHE[key]
    with closing(sqlite3.connect(file.resolve().as_uri() + '?mode=ro', uri=True, timeout=20)) as db:
        sources = db.execute("SELECT id,scope,day FROM snapshots WHERE active=1 AND kind='quality' ORDER BY day,id").fetchall()
        scopes = sorted({str(row[1]) for row in sources})
        if requested and requested not in scopes:
            return [], set(), scopes, bool(sources), 'missing-scope'
        if not requested and len(scopes) > 1:
            return [], set(), scopes, True, 'needs-scope'
        chosen = requested or (scopes[0] if scopes else '')
        rows, covered = [], set()
        for sid, scope, day in sources:
            if scope != chosen:
                continue
            encoded = db.execute('SELECT rows FROM snapshots WHERE id=?', (sid,)).fetchone()[0]
            covered.add(day)
            for index, row in enumerate(json.loads(encoded)):
                if len(rows) >= 250000:
                    raise ValueError('BI首页最多分析25万行，请按来源范围拆分数据。')
                if row.get('status') in ('Rework', 'Scrap'):
                    rows.append(projected(row, f'daily:{sid}:{index}'))
    if signature(file) != stamp:
        raise ValueError('读取期间BI来源发生变化，请刷新后重试。')
    if len(_DAILY_CACHE) >= 2 or sum(len(value[0]) for value in _DAILY_CACHE.values()) + len(rows) > 250000:
        _DAILY_CACHE.clear()
    result = rows, covered, scopes, bool(sources), chosen
    _DAILY_CACHE[key] = result
    return result


def read_history(panel):
    engine = panel.engine
    config = engine.merge_config(copy.deepcopy(engine.load_config_file(panel.BASE)))
    hist, _ = engine.load_hist(panel.BASE, config)
    if hist.empty:
        return [], set()
    engine.ensure_fieldmap(config, hist.columns)
    engine.ensure_defects(config, hist, engine.build_cfg(config)['roles'])
    cfg = engine.build_cfg(config)
    if any(k not in cfg['roles'] for k in ('责任员工', '责任工序', '不良代码')):
        raise ValueError('BI历史必要字段未映射，请在BI数据与字段中核对。')
    frame, _ = engine.build_frame(hist, cfg)
    selected, _ = engine.apply_global(frame, cfg)
    covered = {str(day.date()) for day in frame['_date']}
    rows = []
    if len(selected) > 250000:
        raise ValueError('BI首页最多分析25万行，请缩小历史来源。')
    for index, row in selected.iterrows():
        normalized = {'date': str(row['_date'].date()), 'process': str(row['_proc']),
                      'employee': str(row['_emp']), 'item': str(row['_item']),
                      'qty': float(row['_qty']), 'shift': str(row['_shift']), 'raw': row.to_dict()}
        rows.append(projected(normalized, 'history:' + str(index)))
    return rows, covered


def summarize(rows, covered, query, preference, channel, scopes, scope_name, export_rows=False, exact_filter=None):
    start, end = query['start'], query['end']
    lo, hi = dt.date.fromisoformat(start), dt.date.fromisoformat(end)
    days = (hi - lo).days + 1
    if days < 1 or days > 3660:
        raise ValueError('首页分析日期范围无效或超过十年。')
    filters, search = query.get('filters') or {}, str(query.get('search') or '').strip().casefold()
    employee = preference.get('employee', '')
    def match(row):
        return (all(not filters.get(key) or row[key] == filters[key] for key in ('process', 'issue', 'shift'))
                and (not exact_filter or row[exact_filter['field']] == exact_filter['value'])
                and (not employee or row['employee'] == employee)
                and (not search or any(search in str(v).casefold() for v in row.values())))
    selected_all = [r for r in rows if match(r)]
    current = [r for r in selected_all if start <= r['date'] <= end]
    previous_start, previous_end = lo - dt.timedelta(days=days), lo - dt.timedelta(days=1)
    previous = [r for r in selected_all if previous_start.isoformat() <= r['date'] <= previous_end.isoformat()]
    def rank(key):
        sums = defaultdict(float)
        for r in current:
            sums[r[key]] += r['quantity']
        return [{'value': k, 'count': v} for k, v in sorted(sums.items(), key=lambda x: (-x[1], x[0]))]
    sums, prev_sums = defaultdict(float), defaultdict(float)
    for r in current:
        sums[r['date']] += r['quantity']
    for r in previous:
        prev_sums[r['date']] += r['quantity']
    bins = {}
    for offset in range(days):
        day = lo + dt.timedelta(days=offset)
        key = bucket(day.isoformat(), query.get('grain', 'week'))
        b = bins.setdefault(key, {'key': key, 'start': day.isoformat(), 'end': day.isoformat(), 'quantity': 0, 'previous': 0, 'covered': 0, 'previousCovered': 0, 'days': 0})
        b['end'] = day.isoformat(); b['days'] += 1
        prior = (day - dt.timedelta(days=days)).isoformat()
        if day.isoformat() in covered:
            b['quantity'] += sums[day.isoformat()]; b['covered'] += 1
        if prior in covered:
            b['previous'] += prev_sums[prior]; b['previousCovered'] += 1
    for b in bins.values():
        if not b['covered']: b['quantity'] = None
        if b['covered'] != b['days'] or b['previousCovered'] != b['days']: b['previous'] = None
    page_size, page = query.get('pageSize', 10), query.get('page', 1)
    if page_size not in (5, 10, 20, 50) or not isinstance(page, int) or page < 1:
        raise ValueError('BI首页分页无效。')
    current.sort(key=lambda r: (r['date'], r['id']), reverse=True)
    page = min(page, max(1, math.ceil(len(current) / page_size)))
    coverage = sum((lo + dt.timedelta(days=i)).isoformat() in covered for i in range(days))
    prior_coverage = sum((previous_start + dt.timedelta(days=i)).isoformat() in covered for i in range(days))
    if export_rows and len(current) > 25000:
        raise ValueError('首页明细导出最多25000行，请缩小范围或使用原BI完整报表导出。')
    semantic_query = {key: query.get(key) for key in ('start', 'end', 'filters', 'grain', 'search')}
    revision = hashlib.sha256(json.dumps([current, semantic_query, employee, channel, scope_name, exact_filter], sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    return {'state': 'available' if coverage else 'empty', 'channel': channel, 'dailyScope': scope_name,
            'scopes': scopes, 'range': {'start': start, 'end': end}, 'coverageDays': coverage,
            'message': '' if coverage else '当前日期范围没有BI来源，缺失不等于零；可选择全部日期。',
            'quantity': sum(r['quantity'] for r in current), 'rowCount': len(current),
            'previousQuantity': sum(r['quantity'] for r in previous) if coverage == days and prior_coverage == days else None,
            'trend': list(bins.values()), 'issues': rank('issue'), 'processes': rank('process'),
            'employees': rank('employee'), 'shifts': rank('shift'), 'revision': revision,
            'options': {k: sorted({r[k] for r in rows if r[k]}) for k in ('process', 'issue', 'shift', 'employee')},
            'rows': current if export_rows else current[(page-1)*page_size:page*page_size], 'page': page, 'pageSize': page_size,
            'total': len(current), 'unit': 'pcs', 'rate': None,
            'note': '数量为BI缺陷记录数量字段之和，可能含同一产品多次不良，不等于去重的不良产品件数。不与人工记录相加。'
                    + (' 日报口径：Rework和Scrap。' if channel == 'daily' else ' 沿用BI历史全局规则。')}


def report(panel, body):
    if not isinstance(body, dict) or set(body) - {'query', 'preference', 'allDates', 'exportRows', 'biFilter'}:
        raise ValueError('BI首页请求无效。')
    query, preference = dict(body['query']), body['preference']
    if any(key in body and not isinstance(body[key], bool) for key in ('allDates', 'exportRows')):
        raise ValueError('BI首页日期和导出选项无效。')
    if preference.get('mode') not in ('auto', 'bi', 'records') or preference.get('channel') not in ('auto', 'daily', 'history'):
        raise ValueError('BI首页来源选择无效。')
    if query.get('grain', 'week') not in ('day', 'week', 'month'):
        raise ValueError('BI首页趋势周期无效。')
    if any(not isinstance(preference.get(key, ''), str) or len(preference.get(key, '')) > 512 for key in ('employee', 'dailyScope')):
        raise ValueError('BI首页来源或员工筛选无效。')
    exact_filter = body.get('biFilter')
    if exact_filter and (not isinstance(exact_filter, dict) or set(exact_filter) != {'field', 'value'} or exact_filter['field'] not in ('process', 'issue', 'shift', 'employee') or not isinstance(exact_filter['value'], str)):
        raise ValueError('BI明细筛选无效。')
    filters = query.get('filters') or {}
    unsupported = [key for key, value in filters.items() if value and key not in ('process', 'issue', 'shift')]
    if unsupported or query.get('followup'):
        return {'state': 'unsupported-filter', 'message': '当前人工专属筛选不适用于BI，未显示未筛选的BI总数。请清除跟进负责人、报检人、状态或模板等筛选。'}
    channel = preference.get('channel', 'auto')
    rows, covered, scopes, present, chosen = read_daily(panel.BASE, preference.get('dailyScope', '')) if channel != 'history' else ([], set(), [], False, '')
    if channel != 'history' and chosen in ('needs-scope', 'missing-scope'):
        return {'state': chosen, 'scopes': scopes, 'message': '请选择一个明确的BI日报来源范围，不同范围可能重叠，未自动累加。'}
    if channel == 'daily' or (channel == 'auto' and present):
        channel = 'daily'
    else:
        channel = 'history'
        rows, covered = read_history(panel)
    if not covered:
        return {'state': 'empty', 'channel': channel, 'scopes': scopes, 'message': '尚无可用BI来源，显示人工异常记录。'}
    if body.get('allDates'):
        query.update(start=min(query['start'], min(covered)), end=max(query['end'], max(covered)))
    return summarize(rows, covered, query, preference, channel, scopes, chosen if channel == 'daily' else '', body.get('exportRows') is True, exact_filter)
