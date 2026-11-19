"""Export exactly the current analysis query as an editable Excel workbook."""
from collections import defaultdict
from io import BytesIO
from pathlib import Path

from . import analysis, store, tabular


ROLE_LABELS = {'date': '业务日期', 'quantity': '不良数量', 'process': '工序',
               'defect': '不良项', 'employee': '责任员工', 'shift': '班次',
               'product': '产品', 'floor': '楼层', 'reporter': '报检人', 'serial': '序号'}
OPERATORS = {'in': '属于', 'notIn': '排除', 'equals': '等于', 'notEquals': '不等于',
             'contains': '包含', 'notContains': '不包含', 'startsWith': '开头是',
             'endsWith': '结尾是', 'gte': '大于等于', 'lte': '小于等于',
             'between': '介于', 'empty': '为空', 'notEmpty': '不为空'}


def export(db, source, body):
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    if body['revision'] != store.revision(db):
        raise ValueError('数据已更新，请重新查询后导出。')
    query, layout = body['query'], body['layout']
    labels = {**ROLE_LABELS, **{col['id']: col['label'] for col in source['columns']}}
    fields = {'date', 'quantity', *(col['id'] for col in source['columns'])}
    columns = layout['columns']
    if (not columns or len(columns) > 256 or layout['groupBy'] not in fields or
            any(c['field'] not in fields or not c['title'].strip() or len(c['title']) > 120 for c in columns) or
            len({c['title'].strip().casefold() for c in columns}) != len(columns)):
        raise ValueError('导出列或汇总字段无效，请重新设置表头。')
    _, span, base, rows = analysis.core(db, source, query)
    if not rows:
        raise ValueError('当前筛选没有命中记录。请重新查询后再导出。')
    if len(rows) > 25000:
        raise ValueError('快捷导出最多 25,000 行，请缩小查询范围。')
    analysis.sort_details(rows, source, query)
    ignored = len(base) - len(analysis.decision_scope(base, source, query))
    book = Workbook()
    detail = book.active
    detail.title = '筛选明细'
    detail.append([c['title'] for c in columns])
    groups, days = defaultdict(lambda: [0, 0.0]), defaultdict(lambda: [0, 0.0])
    for row in rows:
        detail.append([analysis.value(row, c['field'], source) for c in columns])
        group = tabular.display(analysis.value(row, layout['groupBy'], source))
        for counter, key in ((groups, group), (days, row['date'])):
            counter[key][0] += 1
            counter[key][1] += row['quantity']
    by_field = book.create_sheet('不良汇总')
    by_field.append([labels[layout['groupBy']], '记录条数', '不良数量'])
    for group, (count, quantity) in sorted(groups.items(), key=lambda item: (-item[1][1], item[0])):
        by_field.append([group or '（空白）', count, quantity])
    by_date = book.create_sheet('日期汇总')
    by_date.append(['业务日期', '记录条数', '不良数量'])
    for day, (count, quantity) in sorted(days.items()):
        by_date.append([day, count, quantity])
    notes = book.create_sheet('筛选口径')
    notes.append(['条件', '取值'])
    for item in [
        ('来源', source['name']), ('起始日期', span[0]), ('结束日期', span[1]),
        ('命中条数', len(rows)), ('不良数量', sum(row['quantity'] for row in rows)),
        ('忽略空白未判定', '是' if query.get('ignorePendingDecisions', True) else '否'),
        ('日期范围内忽略条数', ignored),
    ]:
        notes.append(item)
    for rule in query.get('filters', []):
        notes.append([labels.get(rule['field'], rule['field']),
                      OPERATORS.get(rule['op'], rule['op']) + ' ' + '、'.join(v or '（空白）' for v in rule['values'])])
    for sheet in book.worksheets:
        sheet.freeze_panes = 'A2'
        sheet.auto_filter.ref = sheet.dimensions
        sheet.sheet_view.showGridLines = False
        sheet.row_dimensions[1].height = 25
        for col in range(1, sheet.max_column + 1):
            head = sheet.cell(1, col)
            head.font = Font(bold=True, color='FFFFFF')
            head.fill = PatternFill('solid', fgColor='163859')
            head.alignment = Alignment(vertical='center')
            width = max(len(str(sheet.cell(r, col).value or '')) for r in range(1, min(80, sheet.max_row) + 1))
            sheet.column_dimensions[get_column_letter(col)].width = min(54, max(14, width * 1.7 + 2))
        for cells in sheet.iter_rows():
            for cell in cells:
                if isinstance(cell.value, str):
                    cell.data_type = 's'
    with BytesIO() as stream:
        book.save(stream)
        with Path(body['output']).open('xb') as file:
            file.write(stream.getbuffer())
    book.close()
    return {'recordCount': len(rows), 'quantity': sum(row['quantity'] for row in rows),
            'ignoredPending': ignored, 'fileName': Path(body['output']).name}
