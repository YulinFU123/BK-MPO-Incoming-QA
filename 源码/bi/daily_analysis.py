"""Pure aggregation over immutable snapshots; employee and production scopes stay separate."""
import copy
import datetime as dt
from collections import defaultdict
from daily_common import date_range, stable_hash
from daily_store import load


def normalize_query(value):
    if not isinstance(value, dict):
        raise ValueError('筛选条件必须是对象。')
    query = copy.deepcopy(value)
    for key in ('employees', 'exclude', 'process', 'floor', 'product', 'shift', 'chart_order', 'omit_charts'):
        items = query.get(key, [])
        if not isinstance(items, list) or not all(isinstance(item, str) for item in items):
            raise ValueError(key + '筛选必须是名称列表。')
        query[key] = list(dict.fromkeys(items))
    if query.get('period', 'day') not in ('day', 'week', 'month'):
        raise ValueError('趋势周期只能选择日、周或月。')
    query.setdefault('status', 'Rework,Scrap')
    if query['status'] not in ('', 'Rework,Scrap', 'Rework', 'Scrap', 'Release', 'Awaiting Disposition'):
        raise ValueError('无效的处置口径。')
    query['top'] = int(query.get('top', 10))
    if query['top'] not in (0, 5, 10, 20):
        raise ValueError('排行只支持TOP5、10、20或全部。')
    return query


def analyze(base, q):
    q = normalize_query(q)
    allrows, sources = load(base, 'quality', q.get('scope', ''))
    opts = {k: sorted({r.get(k) or '未填写' for r in allrows}) for k in ['process', 'employee', 'floor', 'product', 'shift']}
    days = sorted({r['date'] for r in allrows})
    start = q.get('start') or (days[-1] if days else '')
    end = q.get('end') or start
    if start or end:
        start, end = date_range({'start': start, 'end': end})
    q['start'], q['end'] = start, end
    if start > end:
        raise ValueError('开始日期不能晚于结束日期')
    status = q.get('status', 'Rework,Scrap').split(',') if q.get('status', 'Rework,Scrap') else []

    def match(r, employee=True):
        if not start <= r['date'] <= end:
            return False
        for k in ['process', 'floor', 'product', 'shift']:
            if q.get(k) and (r.get(k) or '未填写') not in q[k]:
                return False
        if status and r.get('status') not in status:
            return False
        if employee:
            n = r.get('employee') or '未填写'
            if q.get('employees') and n not in q['employees']:
                return False
            if n in q.get('exclude', []):
                return False
        return True
    base_rows = [r for r in allrows if match(r, False)]
    rows = [r for r in base_rows if match(r)]
    total = sum((r['qty'] for r in rows))

    def rank(key, group=None):
        sums = defaultdict(float)
        for r in rows:
            if group is None or r['process'] == group:
                sums[r.get(key) or '未填写'] += r['qty']
        den = sum(sums.values())
        return [{'name': k, 'qty': v, 'share': v / den if den else None} for k, v in sorted(sums.items(), key=lambda kv: (-kv[1], kv[0]))]
    charts = [{'title': '责任工序数量与占比', 'rows': rank('process')}, {'title': '判定不良项目数量与占比', 'rows': rank('item')}, {'title': '责任人员数量与占比（当前名单内）', 'rows': rank('employee')}]
    for proc in sorted({r['process'] for r in rows}):
        den = sum((r['qty'] for r in base_rows if r['process'] == proc))
        rr = rank('employee', proc)
        for r in rr:
            r['share'] = r['qty'] / den if den else None
        charts.append({'title': (proc or '工序未填写') + '｜责任人员（占工序全部人员）', 'rows': rr})
    period = q.get('period', 'day')
    grouped = defaultdict(float)
    for r in rows:
        d = dt.date.fromisoformat(r['date'])
        key = (d - dt.timedelta(days=d.weekday())).isoformat() if period == 'week' else r['date'][:7] if period == 'month' else r['date']
        grouped[key] += r['qty']
    production, psources = load(base, 'production', q.get('production_scope', ''))
    pp = [r for r in production if start <= r['date'] <= end and all((not q.get(k) or r.get(k) in q[k] for k in ['process', 'floor', 'product']))]
    pg = defaultdict(float)
    for r in pp:
        pg[r['process'], r['unit']] += r['qty']
    revision = stable_hash({'quality': sources, 'production': psources, 'query': {k: v for k, v in q.items() if k not in ('chart_order', 'omit_charts')}})
    return {
        'revision': revision,
        'ok': True,
        'applied_query': q,
        'options': opts,
        'start': start,
        'end': end,
        'quantity': total,
        'count': len(rows),
        'charts': charts,
        'trend': [{'name': k, 'qty': v} for k, v in sorted(grouped.items())],
        'rows': rows,
        'production': [{'process': k[0], 'unit': k[1], 'qty': v} for k, v in pg.items()],
        'sources': [s for s in sources if start <= s['date'] <= end],
        'production_sources': psources,
        'filtered_out': [n for n in q.get('employees', []) if n in opts['employee'] and n not in {r.get('employee') or '未填写' for r in rows}],
        'unmatched': [n for n in q.get('employees', []) if n not in opts['employee']],
        'warnings': ['Shift为报检班别，不是责任班别。', '数量为记录数量字段求和；占比不等于不良率。', '趋势仅显示有记录的周期，缺失日期不补零；周/月可能不完整。', '产量按工序和单位分列；不应用责任人员或报检班别筛选，不自动计算不良率。'],
    }
