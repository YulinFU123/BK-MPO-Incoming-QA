"""Add exact defect selection to preserved BI daily analysis/export in memory.

No original V10.2 files, snapshots or schemas are edited. All quantities and
production boundaries still originate in the existing analysis function.
"""
import datetime as dt
from collections import defaultdict


def selected(value):
    if not isinstance(value, list) or len(value) > 2000 or any(
        not isinstance(item, str) or not item or len(item) > 512 or
        any(ord(char) < 32 or ord(char) == 127 for char in item) for item in value
    ):
        raise ValueError('不良项筛选必须是明确名称列表，每项最长512字。')
    return list(dict.fromkeys(value))


def install():
    import daily_analysis
    import daily_report
    import daily
    import daily_store

    if getattr(daily_analysis, '_fusion_defects_installed', False):
        return
    original_normalize = daily_analysis.normalize_query
    original_analyze = daily_analysis.analyze
    original_summary = daily_report.summary_text
    original_write = daily_report.write_workbook

    def normalize(query):
        normalized = original_normalize(query)
        normalized['items'] = selected(normalized.get('items', []))
        return normalized

    def analyze(base, query):
        query = normalize(query)
        result = original_analyze(base, query)
        all_rows, _ = daily_store.load(base, 'quality', query.get('scope', ''))
        result['options']['item'] = sorted({row.get('item') or '未填写' for row in all_rows})
        if not query['items']:
            return result
        wanted = set(query['items'])
        result['rows'] = [row for row in result['rows'] if (row.get('item') or '未填写') in wanted]
        rows = result['rows']
        if query.get('employees') or query.get('exclude'):
            all_people = original_analyze(base, dict(query, employees=[], exclude=[]))['rows']
            baseline = [row for row in all_people if (row.get('item') or '未填写') in wanted]
        else:
            baseline = rows

        def rank(key, process=None, denominator=None):
            sums = defaultdict(float)
            for row in rows:
                if process is None or row['process'] == process:
                    sums[row.get(key) or '未填写'] += row['qty']
            total = sum(sums.values()) if denominator is None else denominator
            return [{'name': name, 'qty': quantity, 'share': quantity / total if total else None}
                    for name, quantity in sorted(sums.items(), key=lambda item: (-item[1], item[0]))]

        result['charts'] = [
            {'title': '责任工序数量与占比', 'rows': rank('process')},
            {'title': '判定不良项目数量与占比', 'rows': rank('item')},
            {'title': '责任人员数量与占比（当前名单内）', 'rows': rank('employee')},
        ]
        for process in sorted({row['process'] for row in rows}):
            denominator = sum(row['qty'] for row in baseline if row['process'] == process)
            result['charts'].append({
                'title': (process or '工序未填写') + '｜责任人员（占工序全部人员）',
                'rows': rank('employee', process, denominator),
            })
        grouped = defaultdict(float)
        for row in rows:
            date = dt.date.fromisoformat(row['date'])
            period = query.get('period', 'day')
            key = ((date - dt.timedelta(days=date.weekday())).isoformat() if period == 'week'
                   else row['date'][:7] if period == 'month' else row['date'])
            grouped[key] += row['qty']
        result['trend'] = [{'name': key, 'qty': quantity} for key, quantity in sorted(grouped.items())]
        result['quantity'] = sum(row['qty'] for row in rows)
        result['count'] = len(rows)
        result['filtered_out'] = [name for name in query.get('employees', [])
                                  if name in result['options']['employee'] and
                                  name not in {row.get('employee') or '未填写' for row in rows}]
        result['warnings'].append('已按所选不良项过滤；工序内人员占比的分母也限于这些不良项，产量范围不随不良项改变。')
        missing = [name for name in query['items'] if name not in result['options']['item']]
        if missing:
            result['warnings'].append('当前来源未找到所选不良项：' + '、'.join(missing) + '；保留选择，不自动扩大范围。')
        return result

    def description(result):
        names = result['applied_query'].get('items', [])
        return '不良项筛选：' + ('、'.join(names) if names else '不限（全部不良项）')

    def summary(result):
        return description(result) + '\n' + original_summary(result)

    def workbook(path, result):
        original_write(path, result)
        import openpyxl
        book = openpyxl.load_workbook(path)
        try:
            sheet = book['日报汇总']
            sheet.append(['不良项筛选', '、'.join(result['applied_query'].get('items', [])) or '不限（全部不良项）'])
            for cell in sheet[sheet.max_row]:
                if cell.data_type == 'f':
                    cell.data_type = 's'
            book.save(path)
        finally:
            book.close()

    daily_analysis.normalize_query = normalize
    daily_analysis.analyze = daily.analyze = daily_report.analyze = analyze
    daily_report.summary_text = summary
    daily_report.write_workbook = workbook
    daily_analysis._fusion_defects_installed = True
