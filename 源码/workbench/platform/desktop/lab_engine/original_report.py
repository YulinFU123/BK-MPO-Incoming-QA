"""Export the filtered BI records into the configured sheets of the NC template."""

from collections import Counter
from copy import deepcopy
from dataclasses import dataclass
from io import BytesIO
from math import ceil
from pathlib import Path
import posixpath
from re import sub
from xml.etree import ElementTree as ET
from zipfile import BadZipFile, ZIP_DEFLATED, ZipFile

import openpyxl
from openpyxl.utils import get_column_letter
from openpyxl.utils.cell import range_to_tuple

X = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
P = 'http://schemas.openxmlformats.org/package/2006/relationships'
C = 'http://schemas.openxmlformats.org/drawingml/2006/chart'
D = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing'
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
M = 'http://schemas.openxmlformats.org/markup-compatibility/2006'
CP = 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties'
DC = 'http://purl.org/dc/elements/1.1/'
for prefix, namespace in [('x', X), ('r', R), ('c', C), ('a', A), ('xdr', D), ('mc', M),
                          ('c14', 'http://schemas.microsoft.com/office/drawing/2007/8/2/chart'),
                          ('cp', CP), ('dc', DC)]:
    ET.register_namespace(prefix, namespace)

HEADERS = (
    '容器号', '数量', '状态', '工单', '报告人', '产品', '产品平台', '报告时间', '报告说明',
    '报告异常代码', '产线', '工序', '判定人', '判定异常代码', '报废原因', '判定类型', '判定时间',
    '判定说明', '责任人', '责任工序', '判定原因', '异常原因分类', '处理意见', '报废类型', '工位',
)
SHEETS = ('container', '总表', '物料穿错-穿反', '并反', '装管反', 'PIN堵', '内断')
QUANTITY = HEADERS.index('数量')
OWNER = HEADERS.index('责任人')
REASON = HEADERS.index('判定原因')
MAX_ROWS = 20000
MAX_TEMPLATE_PARTS = 512
MAX_TEMPLATE_BYTES = 32 * 1024 * 1024
EMU_PER_POINT = 12700
EMU_PER_PIXEL = 9525
TEMPLATE_DIGIT_WIDTH = 8  # Aptos Narrow 11, the normal font of the source workbook.
TOTAL_CHART_WIDTH = 754
TOTAL_CHART_HEIGHT = 250
TOTAL_CHART_GAP = 12
TOTAL_CHART_LAYOUTS = ('original', 'readable', 'hidden', 'reason-columns')
READABLE_LABELS_PER_CHART = 14
READABLE_CHART_HEIGHT = 450
LANDSCAPE_PRINT_WIDTH = 780
LANDSCAPE_PRINT_HEIGHT = 500
CONTENT_TYPES = 'http://schemas.openxmlformats.org/package/2006/content-types'


@dataclass(frozen=True)
class Category:
    name: str
    part: str
    drawing: str
    charts: dict
    overview: str
    pivot: str
    cache: str
    records: str
    header: int
    reasons: tuple
    owner_order: dict


@dataclass(frozen=True)
class Template:
    total: str
    drawing: str
    charts: dict
    categories: tuple

    @property
    def sheets(self):
        return ['总表', *(category.name for category in self.categories)]


def tag(ns, name):
    return f'{{{ns}}}{name}'


def add(parent, ns, element, **attrs):
    return ET.SubElement(parent, tag(ns, element), {key: str(value) for key, value in attrs.items()})


def xml(node):
    return ET.tostring(node, encoding='utf-8', xml_declaration=True)


def read(archive, name):
    raw = archive.read(name)
    if b'<!DOCTYPE' in raw.upper() or b'<!ENTITY' in raw.upper():
        raise ValueError('模板包含不支持的 XML 定义。')
    return ET.fromstring(raw)


def clean(node):
    """Drop revision and extension data from copied layout elements."""
    for parent in node.iter():
        for key in list(parent.attrib):
            if key.startswith(('{http://schemas.microsoft.com/office/spreadsheetml/', f'{{{M}}}')):
                del parent.attrib[key]
        for child in list(parent):
            if child.tag.endswith('}extLst'):
                parent.remove(child)
    return node


def relationships(items):
    root = ET.Element(tag(P, 'Relationships'))
    for rid, kind, target in items:
        add(root, P, 'Relationship', Id=rid if isinstance(rid, str) else f'rId{rid}', Type=kind if '://' in kind else f'{R}/{kind}', Target=target)
    return xml(root)


def rel_part(part):
    directory, file = posixpath.split(part)
    return posixpath.join(directory, '_rels', file + '.rels')


def rel_target(part, target):
    return posixpath.relpath(target, posixpath.dirname(part))


def part_links(archive, part):
    directory = posixpath.dirname(part)
    links = {}
    for node in read(archive, rel_part(part)):
        if node.get('TargetMode') == 'External':
            continue
        target = node.attrib['Target']
        path = posixpath.normpath(target.lstrip('/') if target.startswith('/') else
                                  posixpath.join(directory, target))
        if not path.startswith('xl/'):
            raise ValueError('模板包含不支持的组件路径。')
        links[node.attrib['Id']] = (node.attrib['Type'].rsplit('/', 1)[-1], path)
    return links


def one_part(links, kind, sheet):
    parts = [part for kind_id, part in links.values() if kind_id == kind]
    if len(parts) != 1:
        raise ValueError(f'模板「{sheet}」缺少唯一的 {kind} 组件。')
    return parts[0]


def office_text(value):
    text = sub(r'(?i)_(?=x[0-9a-f]{4}_)', '_x005F_', str(value))
    if len(text) > 32767:
        raise ValueError('有字段超过 Excel 单元格的长度限制，请缩小筛选范围。')
    return sub(r'[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]', lambda m: f'_x{ord(m[0]):04X}_', text)


def write_row(parent, number, values, styles=(), height=None):
    row = add(parent, X, 'row', r=number)
    if height:
        row.set('ht', height)
        row.set('customHeight', '1')
    for index, value in enumerate(values):
        style = styles[index] if index < len(styles) else None
        if value is None and style is None:
            continue
        cell = add(row, X, 'c', r=f'{get_column_letter(index + 1)}{number}')
        if style is not None:
            cell.set('s', style)
        if isinstance(value, bool):
            cell.set('t', 'b')
            add(cell, X, 'v').text = str(int(value))
        elif isinstance(value, (int, float)):
            add(cell, X, 'v').text = str(value)
        elif value is not None:
            cell.set('t', 'inlineStr')
            text = add(add(cell, X, 'is'), X, 't')
            text.set(tag('http://www.w3.org/XML/1998/namespace', 'space'), 'preserve')
            text.text = office_text(value)


def owner_key(row):
    return None if row[OWNER] in (None, '') else str(row[OWNER])


def write_pivot(parts, archive, index, category, rows, owners, start, *, prototype=None):
    table_part, cache_part = category.pivot, category.cache
    sheet, reasons = category.name, category.reasons
    table = clean(read(archive, prototype or table_part))
    table.set('cacheId', str(index))
    if prototype:
        table.set('name', f'判定原因透视表{index}')
    fields = table.find(tag(X, 'pivotFields'))
    shown_reasons = tuple(reason for reason in reasons if any(row[REASON] == reason for row in rows))
    axis = {OWNER: owners, REASON: shown_reasons}
    cache = ET.Element(tag(X, 'pivotCacheDefinition'), {
        tag(R, 'id'): 'rId1', 'recordCount': str(len(rows)), 'createdVersion': '8',
        'refreshedVersion': '8', 'minRefreshableVersion': '3', 'saveData': '1',
    })
    source = add(cache, X, 'cacheSource', type='worksheet')
    add(source, X, 'worksheetSource', ref=f'A1:Y{len(rows) + 1}', sheet=sheet)
    cache_fields = add(cache, X, 'cacheFields', count=len(HEADERS))
    for col, name in enumerate(HEADERS):
        field = add(cache_fields, X, 'cacheField', name=name, numFmtId='0')
        if col not in axis:
            # A former pivot axis can retain item indexes even when hidden.
            # No such indexes are valid in the new, record-only cache field.
            for item in list(fields[col]):
                fields[col].remove(item)
            add(field, X, 'sharedItems')
            continue
        values = axis[col]
        shared = add(field, X, 'sharedItems', count=len(values))
        for value in values:
            if value is None:
                shared.set('containsBlank', '1')
                add(shared, X, 'm')
            else:
                add(shared, X, 's', v=office_text(value))
        items = fields[col].find(tag(X, 'items'))
        items.clear()
        items.set('count', str(len(values) + 1))
        for position in range(len(values)):
            add(items, X, 'item', x=position)
        add(items, X, 'item', t='default')
    for name, values in [('rowItems', owners), ('colItems', shown_reasons)]:
        items = table.find(tag(X, name))
        items.clear()
        items.set('count', str(len(values) + 1))
        for position in range(len(values)):
            add(add(items, X, 'i'), X, 'x', v=position)
        add(add(items, X, 'i', t='grand'), X, 'x')
    total_col = get_column_letter(len(shown_reasons) + 2)
    table.find(tag(X, 'location')).set('ref', f'A{start}:{total_col}{start + len(owners) + 2}')
    records = ET.Element(tag(X, 'pivotCacheRecords'), {'count': str(len(rows))})
    indexes = {key: {value: pos for pos, value in enumerate(values)} for key, values in axis.items()}
    for row in rows:
        record = add(records, X, 'r')
        for col, value in enumerate(row):
            if col in indexes:
                key = owner_key(row) if col == OWNER else value
                add(record, X, 'x', v=indexes[col][key])
            elif value is None or value == '':
                add(record, X, 'm')
            elif isinstance(value, bool):
                add(record, X, 'b', v=int(value))
            elif isinstance(value, (int, float)):
                add(record, X, 'n', v=value)
            else:
                add(record, X, 's', v=office_text(value))
    parts[table_part] = xml(table)
    parts[cache_part] = xml(cache)
    parts[category.records] = xml(records)
    parts[rel_part(table_part)] = relationships([
        (1, 'pivotCacheDefinition', rel_target(table_part, cache_part)),
    ])
    parts[rel_part(cache_part)] = relationships([
        (1, 'pivotCacheRecords', rel_target(cache_part, category.records)),
    ])
    return shown_reasons


def chart_reference(series, section, numeric, formula, values):
    reference = series.find(f'{tag(C, section)}/{tag(C, "numRef" if numeric else "strRef")}')
    reference.clear()
    add(reference, C, 'f').text = formula
    cache = add(reference, C, 'numCache' if numeric else 'strCache')
    if numeric:
        add(cache, C, 'formatCode').text = 'General'
    add(cache, C, 'ptCount', val=len(values))
    for index, value in enumerate(values):
        if value is not None:
            add(add(cache, C, 'pt', idx=index), C, 'v').text = office_text(value)


CHART_PATTERNS = ('ltDnDiag', 'ltUpDiag', 'smGrid', 'dotGrid', 'horz', 'vert')


def monochrome_series(series, index):
    shape = series.find(tag(C, 'spPr'))
    shape.clear()
    if index:
        fill = add(shape, A, 'pattFill', prst=CHART_PATTERNS[index - 1])
        add(add(fill, A, 'fgClr'), A, 'srgbClr', val='000000')
        add(add(fill, A, 'bgClr'), A, 'srgbClr', val='FFFFFF')
    else:
        add(add(shape, A, 'solidFill'), A, 'srgbClr', val='000000')
    outline = add(shape, A, 'ln', w=EMU_PER_POINT // 2)
    add(add(outline, A, 'solidFill'), A, 'srgbClr', val='000000')


def chart_series(chart):
    return chart.findall(f'.//{tag(C, "barChart")}/{tag(C, "ser")}')


def write_chart(parts, archive, part, category, owners, counts, header, overview=False):
    sheet = category.name.replace("'", "''")
    prefix = f"'{sheet}'!"
    labels = [owner if owner is not None else '(空白)' for owner in owners]
    first, last = header + 1, header + max(1, len(labels))
    chart = clean(read(archive, part))
    for index, (item, reason) in enumerate(zip(chart_series(chart), category.reasons, strict=True)):
        monochrome_series(item, index)
        column = get_column_letter(index + 2)
        chart_reference(item, 'tx', False, f'{prefix}${column}${header}', [reason])
        chart_reference(item, 'cat', False, f'{prefix}$A${first}:$A${last}', labels)
        chart_reference(item, 'val', True, f'{prefix}${column}${first}:${column}${last}',
                        [counts[(owner, reason)] or None for owner in owners])
    if overview and 0 < len(labels) <= (32 if category.name in SHEETS[2:4] else 20):
        axis = chart.find(f'.//{tag(C, "catAx")}')
        skip = axis.find(tag(C, 'tickLblSkip'))
        if skip is None:
            skip = ET.Element(tag(C, 'tickLblSkip'))
            axis.insert(list(axis).index(axis.find(tag(C, 'lblOffset'))) + 1, skip)
        skip.set('val', '1')
    parts[part] = xml(chart)
    style_base = 'http://schemas.microsoft.com/office/2011/relationships/'
    links = []
    if rel_part(part) in archive.namelist():
        for rid, (kind, path) in part_links(archive, part).items():
            if kind in ('chartStyle', 'chartColorStyle'):
                links.append((rid, style_base + kind, rel_target(part, path)))
                parts[path] = archive.read(path)
    if links:
        parts[rel_part(part)] = relationships(links)


def readable_chart(archive, original, name, sheet, first, labels, series):
    """Build a chart from the template with one slot for every visible label."""
    chart = clean(read(archive, original))
    plot = chart.find(f'.//{tag(C, "plotArea")}')
    layout = plot.find(tag(C, 'layout'))
    if layout is not None:
        layout.clear()
    bars = plot.find(tag(C, 'barChart'))
    bars.find(tag(C, 'barDir')).set('val', 'bar')
    last = first + len(labels) - 1
    prefix = "'" + sheet.replace("'", "''") + "'!"
    series_spec = dict(series)
    for index, item in enumerate(chart_series(chart)):
        column = get_column_letter(index + 2)
        specification = series_spec.get(index)
        if specification is None:
            bars.remove(item)
            continue
        reason, values, header, value_column = specification
        column = value_column or column
        monochrome_series(item, index)
        chart_reference(item, 'tx', False, f'{prefix}${column}${header}', [reason])
        chart_reference(item, 'cat', False, f'{prefix}$A${first}:$A${last}', labels)
        chart_reference(item, 'val', True, f'{prefix}${column}${first}:${column}${last}', values)
    axis = plot.find(tag(C, 'catAx'))
    axis.find(tag(C, 'axPos')).set('val', 'l')
    axis.find(tag(C, 'tickLblPos')).set('val', 'low')
    axis.find(f'{tag(C, "scaling")}/{tag(C, "orientation")}').set('val', 'maxMin')
    for key in ('tickLblSkip', 'tickMarkSkip'):
        previous = axis.find(tag(C, key))
        if previous is not None:
            axis.remove(previous)
    offset = axis.find(tag(C, 'lblOffset'))
    axis.insert(list(axis).index(offset) + 1, ET.Element(tag(C, 'tickLblSkip'), val='1'))
    tx = axis.find(tag(C, 'txPr'))
    if tx is not None:
        body = tx.find(tag(A, 'bodyPr'))
        body.attrib.update(rot='0', vertOverflow='overflow', wrap='none')
        for font in tx.iter(tag(A, 'defRPr')):
            font.set('sz', '1000')
    value_axis = plot.find(tag(C, 'valAx'))
    value_axis.find(tag(C, 'axPos')).set('val', 'b')
    value_axis.find(tag(C, 'crosses')).set('val', 'max')
    chart_content = chart.find(tag(C, 'chart'))
    title = chart_content.find(tag(C, 'title'))
    if title is None:
        title = ET.Element(tag(C, 'title'))
        chart_content.insert(0, title)
    title.clear()
    rich = add(add(title, C, 'tx'), C, 'rich')
    add(rich, A, 'bodyPr')
    add(rich, A, 'lstStyle')
    add(add(add(rich, A, 'p'), A, 'r'), A, 't').text = office_text(name)
    add(title, C, 'overlay', val='0')
    if len(series_spec) == 1:
        legend = chart_content.find(tag(C, 'legend'))
        if legend is not None:
            chart_content.remove(legend)
    return xml(chart)


def chart_corner(anchor, name, first_row, row_height, column_widths, x, y):
    column = 0
    for cell_width in column_widths:
        if x < cell_width:
            break
        x -= cell_width
        column += 1
    row, row_offset = divmod(y, row_height)
    marker = add(anchor, D, name)
    add(marker, D, 'col').text = str(column)
    add(marker, D, 'colOff').text = str(x)
    add(marker, D, 'row').text = str(first_row - 1 + row)
    add(marker, D, 'rowOff').text = str(row_offset)


def total_chart_grid(drawing, first_row, row_height, column_widths):
    """Lay out chart rows with aligned edges and uniform spacing."""
    anchors = list(drawing)
    row_count = ceil(len(anchors) / 3)
    per_row, extra = divmod(len(anchors), row_count)
    row_sizes = [per_row] * (row_count - extra) + [per_row + 1] * extra
    next_anchor = iter(anchors)
    row_height = round(row_height * EMU_PER_POINT)
    for row_index, columns in enumerate(row_sizes):
        width = ((TOTAL_CHART_WIDTH - (columns - 1) * TOTAL_CHART_GAP) * EMU_PER_POINT) // columns
        gap = TOTAL_CHART_GAP * EMU_PER_POINT
        right = TOTAL_CHART_WIDTH * EMU_PER_POINT
        y = row_index * (TOTAL_CHART_HEIGHT + TOTAL_CHART_GAP) * EMU_PER_POINT
        for column in range(columns):
            old = next(next_anchor)
            x = column * (width + gap)
            anchor = add(drawing, D, 'twoCellAnchor', editAs='oneCell')
            chart_corner(anchor, 'from', first_row, row_height, column_widths, x, y)
            chart_corner(anchor, 'to', first_row, row_height, column_widths,
                         right if column == columns - 1 else x + width,
                         y + TOTAL_CHART_HEIGHT * EMU_PER_POINT)
            anchor.append(old.find(tag(D, 'graphicFrame')))
            anchor.append(old.find(tag(D, 'clientData')))
            drawing.remove(old)


def total_print_settings(sheet, data_rows, chart_count):
    first_row = data_rows + 4
    row_format = sheet.find(tag(X, 'sheetFormatPr'))
    row_height = float(row_format.get('defaultRowHeight'))
    row_format.set('customHeight', '1')
    chart_rows = ceil(chart_count / 3)
    group_height = chart_rows * TOTAL_CHART_HEIGHT + (chart_rows - 1) * TOTAL_CHART_GAP
    print_rows = ceil(group_height / row_height) + 2
    column_widths = []
    for column in sheet.find(tag(X, 'cols')):
        pixels = int(float(column.get('width')) * TEMPLATE_DIGIT_WIDTH + 0.5)
        column_widths.extend([pixels * EMU_PER_PIXEL] * (int(column.get('max')) - int(column.get('min')) + 1))
    properties = ET.Element(tag(X, 'sheetPr'))
    add(properties, X, 'pageSetUpPr', fitToPage='1')
    sheet.insert(0, properties)
    margins = sheet.find(tag(X, 'pageMargins'))
    margins.attrib.update(left='0.30', right='0.30', top='0.35', bottom='0.35')
    margin_index = list(sheet).index(margins)
    sheet.insert(margin_index, ET.Element(tag(X, 'printOptions'), {'horizontalCentered': '1'}))
    sheet.insert(margin_index + 2, ET.Element(tag(X, 'pageSetup'), {
        'paperSize': '9', 'orientation': 'landscape', 'fitToWidth': '1', 'fitToHeight': '1',
        'blackAndWhite': '1',
    }))
    # Columns A:J cover the 754-point grid in the supported template.
    print_area = f"'总表'!$A${first_row}:$J${first_row + print_rows - 1}"
    return first_row, row_height, print_area, column_widths


def readable_total_layout(sheet, drawing, data_rows, charts):
    """Keep chart dimensions fixed on screen and print one chart per page."""
    first_row = data_rows + 4
    row_height = 15
    # Choose enough visible columns to cover the chart without constraining width
    # to the original A:J range. Their print width also determines page scale.
    printed_width = 0
    last_column = 0
    columns = sheet.find(tag(X, 'cols'))
    for index in range(1, len(HEADERS) + 1):
        column = next((item for item in columns
                       if int(item.get('min')) <= index <= int(item.get('max'))), None)
        if column is None:
            printed_width += 48
        elif column.get('hidden') not in ('1', 'true'):
            printed_width += float(column.get('width')) * TEMPLATE_DIGIT_WIDTH * 0.75
        last_column = index
        if printed_width >= TOTAL_CHART_WIDTH + 5:
            break
    if printed_width < TOTAL_CHART_WIDTH + 5:
        raise ValueError('模板总表可用列太窄，请取消隐藏总表的列后重新导出。')
    scale = min(100, int(100 * LANDSCAPE_PRINT_WIDTH / (printed_width + last_column * 3.75)))
    if scale < 80:
        raise ValueError('模板总表列宽过大，无法以清晰比例打印，请调整列宽后重试。')
    chart_rows = ceil((READABLE_CHART_HEIGHT + 42) / row_height)
    if chart_rows * row_height > LANDSCAPE_PRINT_HEIGHT * 100 / scale:
        raise ValueError('模板总表行高过大，无法分页打印，请调整行高后重试。')
    if len(charts) > 1027:
        raise ValueError('总表图表超过 1027 页，请缩小日期范围后导出。')
    # Excel can use a smaller effective print height for implicit blank rows.
    # Set the chart area's row heights explicitly and leave space at each break.
    chart_end = first_row + chart_rows * len(charts) - 1
    data = sheet.find(tag(X, 'sheetData'))
    for row in range(first_row, chart_end + 1):
        add(data, X, 'row', r=row, ht=row_height, customHeight='1')
    sheet.find(tag(X, 'dimension')).set('ref', f'A1:Y{chart_end}')
    prototype = drawing[0].find(tag(D, 'graphicFrame'))
    drawing.clear()
    for index, rid in enumerate(charts):
        anchor = add(drawing, D, 'oneCellAnchor')
        chart_corner(anchor, 'from', first_row + index * chart_rows,
                     round(row_height * EMU_PER_POINT), (), 0, 0)
        add(anchor, D, 'ext', cx=TOTAL_CHART_WIDTH * EMU_PER_POINT, cy=READABLE_CHART_HEIGHT * EMU_PER_POINT)
        frame = deepcopy(prototype)
        frame.find(f'.//{tag(C, "chart")}').set(tag(R, 'id'), rid)
        identity = frame.find(f'.//{tag(D, "cNvPr")}')
        identity.attrib.update(id=str(index + 2), name=f'总表图表 {index + 1}')
        anchor.append(frame)
        add(anchor, D, 'clientData')
    margins = sheet.find(tag(X, 'pageMargins'))
    margins.attrib.update(left='0.30', right='0.30', top='0.35', bottom='0.35')
    margin_index = list(sheet).index(margins)
    sheet.insert(margin_index, ET.Element(tag(X, 'printOptions'), horizontalCentered='1'))
    sheet.insert(margin_index + 2, ET.Element(tag(X, 'pageSetup'),
                 paperSize='9', orientation='landscape', scale=str(scale), blackAndWhite='1'))
    if len(charts) > 1:
        breaks = ET.Element(tag(X, 'rowBreaks'), count=str(len(charts) - 1),
                            manualBreakCount=str(len(charts) - 1))
        sheet.insert(margin_index + 3, breaks)
        for index in range(1, len(charts)):
            add(breaks, X, 'brk', id=first_row - 1 + chart_rows * index, min='0', max='16383', man='1')
    last_row = first_row + chart_rows * len(charts) - 1
    return f"'总表'!$A${first_row}:${get_column_letter(last_column)}${last_row}"


def write_sheet(parts, archive, part, drawing_part, charts, rows, summary=(), drawing_shift=0,
                pivot=None, *, chart_layout='original'):
    sheet = clean(read(archive, part))
    data = sheet.find(tag(X, 'sheetData'))
    styles = [cell.get('s') for cell in data[0]]
    height = data[0].get('ht')
    data.clear()
    write_row(data, 1, HEADERS, styles, height)
    for position, row in enumerate(rows, 2):
        write_row(data, position, row)
    for position, values, style in summary:
        write_row(data, position, values, style)
    end = max(len(rows) + 1, summary[-1][0] if summary else 1)
    sheet.find(tag(X, 'dimension')).set('ref', f'A1:Y{end}')
    for name in ('sheetPr', 'sheetViews', 'printOptions', 'pageSetup', 'rowBreaks', 'colBreaks'):
        element = sheet.find(tag(X, name))
        if element is not None:
            sheet.remove(element)
    auto_filter = sheet.find(tag(X, 'autoFilter'))
    if auto_filter is not None:
        auto_filter.clear()
        auto_filter.set('ref', f'A1:Y{len(rows) + 1}')
    print_area = None
    if not summary and not charts:
        sheet.remove(sheet.find(tag(X, 'drawing')))
        parts[part] = xml(sheet)
        return None
    drawing = clean(read(archive, drawing_part))
    if not summary:
        if chart_layout == 'readable':
            print_area = readable_total_layout(sheet, drawing, len(rows), charts)
        else:
            first_row, row_height, print_area, column_widths = total_print_settings(sheet, len(rows), len(charts))
            total_chart_grid(drawing, first_row, row_height, column_widths)
    else:
        for row in drawing.iter(tag(D, 'row')):
            row.text = str(max(0, int(row.text) + drawing_shift))
    parts[part] = xml(sheet)
    drawing_id = sheet.find(tag(X, 'drawing')).attrib[tag(R, 'id')]
    rels = [(drawing_id, 'drawing', rel_target(part, drawing_part))]
    if pivot:
        pivot_id = next(rid for rid, (kind, _) in part_links(archive, part).items() if kind == 'pivotTable')
        rels.append((pivot_id, 'pivotTable', rel_target(part, pivot)))
    parts[rel_part(part)] = relationships(rels)
    parts[drawing_part] = xml(drawing)
    parts[rel_part(drawing_part)] = relationships([
        (rid, 'chart', rel_target(drawing_part, chart)) for rid, chart in charts.items()
    ])
    return print_area


def drawing_charts(archive, drawing, sheet):
    links = part_links(archive, drawing)
    charts = {}
    for anchor in read(archive, drawing):
        ref = anchor.find(f'.//{tag(C, "chart")}')
        if ref is None:
            raise ValueError(f'模板「{sheet}」的绘图区需要使用分类柱形图。')
        rid = ref.attrib[tag(R, 'id')]
        kind, part = links[rid]
        if kind != 'chart' or rid in charts:
            raise ValueError(f'模板「{sheet}」的图表关系无效。')
        charts[rid] = part
    return charts


def chart_source(archive, part):
    series = chart_series(read(archive, part))
    refs = [range_to_tuple(item.findtext(f'{tag(C, "tx")}/{tag(C, "strRef")}/{tag(C, "f")}'))
            for item in series]
    if not 1 <= len(refs) <= len(CHART_PATTERNS) + 1:
        raise ValueError('每个分类图须包含 1 至 7 个判定原因系列。')
    sheet, (_, row, _, _) = refs[0]
    sheet = sheet.replace("''", "'")
    for column, (name, bounds) in enumerate(refs, 2):
        if name.replace("''", "'") != sheet or bounds != (column, row, column, row):
            raise ValueError('模板分类图的系列应从对应工作表的 B 列起连续引用判定原因。')
    return sheet, row, series


def read_category(archive, sheet, part, overview, used_codes):
    name = sheet.title
    overview_part, header_row, series = overview
    links = part_links(archive, part)
    drawing = one_part(links, 'drawing', name)
    charts = drawing_charts(archive, drawing, name)
    if len(charts) != 1:
        raise ValueError(f'「{name}」需要一张分类图。')
    drawing_sheet, drawing_row, drawing_series = chart_source(archive, next(iter(charts.values())))
    if (drawing_sheet, drawing_row, len(drawing_series)) != (name, header_row, len(series)):
        raise ValueError(f'「{name}」的分类图与总表中的图表引用不一致。')
    pivot = one_part(links, 'pivotTable', name)
    cache = one_part(part_links(archive, pivot), 'pivotCacheDefinition', name)
    records = one_part(part_links(archive, cache), 'pivotCacheRecords', name)
    definition = read(archive, cache)
    source = definition.find(f'{tag(X, "cacheSource")}/{tag(X, "worksheetSource")}')
    if source.get('sheet') != name:
        raise ValueError(f'「{name}」的透视表来源和工作表不一致。')
    codes = {v.get('v') for v in definition.find(tag(X, 'cacheFields'))[REASON].find(tag(X, 'sharedItems'))}
    labels = next(sheet.iter_rows(min_row=header_row, max_row=header_row, min_col=2,
                                 max_col=1 + len(series), values_only=True))
    if None in codes or len(codes) != len(series) or set(labels) != codes or codes & used_codes:
        raise ValueError(f'「{name}」的判定原因缺失、重叠或与图表不一致。')
    used_codes.update(codes)
    category_path = '/'.join(tag(C, key) for key in ('cat', 'strRef', 'strCache', 'pt', 'v'))
    owner_order = {node.text: rank for rank, node in enumerate(series[0].findall(category_path))}
    return Category(name, part, drawing, charts, overview_part, pivot, cache, records,
                    header_row, labels, owner_order)


def template_sheet_parts(archive):
    entries = archive.infolist()
    if len(entries) > MAX_TEMPLATE_PARTS:
        raise ValueError(f'模板有 {len(entries)} 个内部组件，最多支持 {MAX_TEMPLATE_PARTS} 个。')
    size = sum(part.file_size for part in entries)
    if size > MAX_TEMPLATE_BYTES:
        raise ValueError(f'模板解压后为 {size / 1024**2:.1f} MB，最多支持 {MAX_TEMPLATE_BYTES // 1024**2} MB。')
    if any(any(x in part.filename.lower() for x in ('vbaproject', 'externallinks/', 'embeddings/'))
           for part in entries):
        raise ValueError('模板含宏、外部链接或嵌入对象，请选择原始异常品查询工作簿。')
    workbook_part = 'xl/workbook.xml'
    links = part_links(archive, workbook_part)
    return {node.attrib['name']: links[node.attrib[tag(R, 'id')]][1]
            for node in read(archive, workbook_part).find(tag(X, 'sheets'))}


def rules(archive, path, sheet_parts=None):
    if sheet_parts is None:
        sheet_parts = template_sheet_parts(archive)
    if not {'container', '总表'} <= set(sheet_parts):
        raise ValueError('模板需要「container」和「总表」两个工作表。')
    total_part = sheet_parts['总表']
    total_drawing = one_part(part_links(archive, total_part), 'drawing', '总表')
    total_charts = drawing_charts(archive, total_drawing, '总表')
    total_by_sheet = {}
    for chart in total_charts.values():
        name, row, series = chart_source(archive, chart)
        if name in total_by_sheet:
            raise ValueError(f'总表中有多张图表引用「{name}」。')
        total_by_sheet[name] = chart, row, series
    book = openpyxl.load_workbook(path, read_only=True, data_only=True, keep_links=False)
    try:
        categories = []
        used_codes = set()
        for sheet in book.worksheets:
            name = sheet.title
            if name not in ('container', '总表') and name not in total_by_sheet:
                sheet_xml = read(archive, sheet_parts[name])
                data = sheet_xml.find(tag(X, 'sheetData'))
                if not any(child.tag in (tag(X, 'v'), tag(X, 'is'), tag(X, 'f'))
                           for cell in data.iter(tag(X, 'c')) for child in cell):
                    continue
                raise ValueError(f'总表缺少「{name}」的分类图，无法按该页格式导出。')
            header = next(sheet.iter_rows(min_row=1, max_row=1, max_col=len(HEADERS), values_only=True), ())
            if header != HEADERS:
                raise ValueError(f'模板「{name}」的表头与原始异常品查询工作簿不符。')
            if name in total_by_sheet and name not in ('container', '总表'):
                categories.append(read_category(archive, sheet, sheet_parts[name],
                                                total_by_sheet[name], used_codes))
        if not categories or set(total_by_sheet) != {category.name for category in categories}:
            raise ValueError('总表的分类图与模板工作表不一致。')
        return Template(total_part, total_drawing, total_charts, tuple(categories))
    finally:
        book.close()


def add_reason_summary(parts, template, rows, buckets):
    """Export every reason in the current result, including template additions."""
    names = {name.casefold() for name in template.sheets}
    name = '判定原因汇总'
    while name.casefold() in names:
        name += '·明细'
    part = 'xl/worksheets/reportReasonSummary.xml'
    all_counts = Counter(row[REASON] or None for row in rows)
    report_counts = Counter((row[REASON] or None) for row in rows if row[QUANTITY] not in (None, ''))
    ordered = sorted(all_counts, key=lambda reason: (
        reason in buckets, -report_counts[reason], -all_counts[reason], str(reason or '')))
    sheet = ET.Element(tag(X, 'worksheet'))
    add(sheet, X, 'dimension', ref=f'A1:D{len(ordered) + 1}')
    view = add(add(sheet, X, 'sheetViews'), X, 'sheetView', workbookViewId=0)
    add(view, X, 'pane', ySplit=1, topLeftCell='A2', activePane='bottomLeft', state='frozen')
    add(sheet, X, 'sheetFormatPr', defaultRowHeight=15)
    cols = add(sheet, X, 'cols')
    for index, width in enumerate((48, 16, 19, 24), 1):
        add(cols, X, 'col', min=index, max=index, width=width, customWidth='1')
    data = add(sheet, X, 'sheetData')
    write_row(data, 1, ('判定原因', '记录条数', '图表计数', '模板分类'), ('2',) * 4, '22')
    extra = []
    for index, reason in enumerate(ordered, 2):
        label = str(reason) if reason is not None else '（判定原因为空）'
        write_row(data, index, (label, all_counts[reason], report_counts[reason], buckets.get(reason, '模板外')))
        if reason not in buckets:
            extra.append((label, report_counts[reason]))
    add(sheet, X, 'autoFilter', ref=f'A1:D{len(ordered) + 1}')
    parts[part] = xml(sheet)
    return name, part, extra


def add_chart_pages(parts, archive, charts, template_chart, title, sheet_name, first, labels, series):
    step = READABLE_LABELS_PER_CHART
    pages = ceil(len(labels) / step)
    for page in range(pages):
        start = page * step
        chunk = labels[start:start + step]
        suffix = f'（{page + 1}/{pages}）' if pages > 1 else ''
        chart_number = len(charts) + 1
        part = f'xl/charts/reportOverview{chart_number}.xml'
        parts[part] = readable_chart(archive, template_chart, title + suffix, sheet_name, first + start, chunk,
            [(index, (reason, values[start:start + step], header, column))
             for index, (reason, values, header, column) in series])
        charts[f'rId{chart_number}'] = part


def build(archive, template, rows, chart_layout='original'):
    parts = {}
    categories = template.categories
    buckets = {reason: category.name for category in categories for reason in category.reasons}
    grouped = {category.name: [] for category in categories}
    for row in rows:
        if row[REASON] in buckets:
            grouped[buckets[row[REASON]]].append(row)
    caches, overview = {}, {}
    for index, category in enumerate(categories, 1):
        members = grouped[category.name]
        reasons = category.reasons
        counts = Counter((owner_key(row), row[REASON]) for row in members if row[QUANTITY] not in (None, ''))
        owners = sorted(dict.fromkeys(owner_key(row) for row in members),
                        key=lambda owner: (-sum(counts[(owner, reason)] for reason in reasons),
                                           category.owner_order.get(owner, len(category.owner_order))))
        start = len(members) + 7
        summary = []
        if members:
            shown = write_pivot(parts, archive, index, category, members, owners, start)
            caches[index] = category.cache
            summary.extend([
                (start, ('计数项:数量', '列标签'), ('2', '2')),
                (start + 1, ('行标签', *shown, '总计'), ('2',)),
            ])
            for position, owner in enumerate(owners, start + 2):
                values = tuple(counts[(owner, reason)] for reason in shown)
                summary.append((position, (owner or '(空白)', *(value or None for value in values), sum(values)), ('4',)))
            totals = tuple(sum(counts[(owner, reason)] for owner in owners) for reason in shown)
            summary.append((start + len(owners) + 2, ('总计', *totals, sum(totals)), ('4',)))
        else:
            summary.append((start, ('当前筛选条件下无数据',), ('2',)))
        header = summary[-1][0] + 2
        summary.append((header, ('行标签', *reasons), ('3',) * (len(reasons) + 1)))
        for position, owner in enumerate(owners, header + 1):
            summary.append((position, (owner or '(空白)', *(counts[(owner, reason)] or None for reason in reasons)), ('4',)))
        if chart_layout == 'original':
            write_chart(parts, archive, category.overview, category, owners, counts, header, overview=True)
        elif chart_layout == 'readable' and owners:
            observed = {row[REASON] for row in members}
            add_chart_pages(parts, archive, overview, category.overview, category.name, category.name, header + 1,
                [owner if owner is not None else '(空白)' for owner in owners],
                [(column, (reason, [counts[(owner, reason)] or None for owner in owners], header, None))
                 for column, reason in enumerate(reasons) if reason in observed])
        for chart in category.charts.values():
            write_chart(parts, archive, chart, category, owners, counts, header)
        write_sheet(parts, archive, category.part, category.drawing, category.charts, members,
                    summary, header - category.header, category.pivot if members else None)
    output_sheets = [('总表', template.total), *((category.name, category.part) for category in categories)]
    if chart_layout != 'original':
        summary_name, summary_part, extra = add_reason_summary(parts, template, rows, buckets)
        output_sheets.append((summary_name, summary_part))
        if chart_layout == 'readable' and extra:
            add_chart_pages(parts, archive, overview, categories[0].overview, '模板外判定原因',
                            summary_name, 2, [label for label, count in extra],
                            [(0, ('图表计数', [count for label, count in extra], 1, 'C'))])
    if chart_layout == 'original':
        overview = template.charts
    print_area = write_sheet(parts, archive, template.total, template.drawing, overview, rows, chart_layout=chart_layout)
    workbook = ET.Element(tag(X, 'workbook'))
    book_view = add(workbook, X, 'bookViews')
    add(book_view, X, 'workbookView', activeTab=0)
    sheets = add(workbook, X, 'sheets')
    rels = [(1, 'theme', 'theme/theme1.xml'), (2, 'styles', 'styles.xml')]
    for index, (name, part) in enumerate(output_sheets, 1):
        node = add(sheets, X, 'sheet', name=name, sheetId=index)
        rid = f'rId{index + 2}'
        node.set(tag(R, 'id'), rid)
        rels.append((rid, 'worksheet', rel_target('xl/workbook.xml', part)))
    if print_area:
        defined = add(workbook, X, 'definedNames')
        add(defined, X, 'definedName', name='_xlnm.Print_Area', localSheetId='0').text = print_area
    if caches:
        pivot_caches = add(workbook, X, 'pivotCaches')
        for index, part in caches.items():
            cache = add(pivot_caches, X, 'pivotCache', cacheId=index)
            rid = f'rId{len(rels) + 1}'
            cache.set(tag(R, 'id'), rid)
            rels.append((rid, 'pivotCacheDefinition', rel_target('xl/workbook.xml', part)))
    parts['xl/workbook.xml'] = xml(workbook)
    parts['xl/_rels/workbook.xml.rels'] = relationships(rels)
    for part in ('xl/theme/theme1.xml', 'xl/styles.xml'):
        parts[part] = archive.read(part)
    properties = ET.Element(tag(CP, 'coreProperties'))
    add(properties, DC, 'creator').text = 'BK_MPO_ANALYSIS_REPORT'
    parts['docProps/core.xml'] = xml(properties)
    parts['_rels/.rels'] = relationships([
        (1, 'officeDocument', 'xl/workbook.xml'),
        (2, f'{P}/metadata/core-properties', 'docProps/core.xml'),
    ])
    types = read(archive, '[Content_Types].xml')
    for node in list(types):
        if node.tag.endswith('}Override') and node.get('PartName').lstrip('/') not in parts:
            types.remove(node)
    if chart_layout != 'original':
        add(types, CONTENT_TYPES, 'Override', PartName='/' + summary_part,
            ContentType='application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml')
        for part in overview.values():
            add(types, CONTENT_TYPES, 'Override', PartName='/' + part,
                ContentType='application/vnd.openxmlformats-officedocument.drawingml.chart+xml')
    parts['[Content_Types].xml'] = xml(types)
    output = BytesIO()
    with ZipFile(output, 'w', ZIP_DEFLATED, compresslevel=4) as report:
        for part, content in parts.items():
            report.writestr(part, content)
    return output.getvalue(), {name: len(group) for name, group in grouped.items()}, [name for name, _ in output_sheets], len(overview)


def template_columns(source):
    return {column['label'].strip(): column['id'] for column in source['columns']}


def template_headers():
    """The fixed 25 columns of the 异常品 report template, in order."""
    return list(HEADERS)


def resolve_columns(source, template_map=None):
    """Map each template column to a source column id.

    Without a map, columns must match by name (the original behaviour). With a
    map, the user explicitly points source columns at template columns; anything
    not mapped stays unresolved and is exported as blank. Empty values are kept
    (except 容器号/SN, checked in export) — a blank cell is not an error.
    """
    by_name = template_columns(source)
    by_id = {column['id']: column['id'] for column in source['columns']}
    resolved = {header: by_name.get(header, '') for header in HEADERS}
    if isinstance(template_map, dict):
        for header in HEADERS:
            target = template_map.get(header, '')
            if isinstance(target, str) and target in by_id:
                resolved[header] = target
            elif target == '':
                resolved[header] = ''
    return resolved


def supports_template(source, template_map=None):
    columns = resolve_columns(source, template_map)
    if not all(columns.get(header) for header in HEADERS):
        # A map is still usable when the critical grouping column and 容器号 are
        # present; every other missing template column is simply left blank.
        if not isinstance(template_map, dict):
            return False
    # Only 容器号/SN is mandatory: blank quantity/reason/owner rows are handled
    # by the chart/pivot builders (they fall into "(空白)" or are not counted).
    return bool(columns.get('容器号'))


def build_rows(source, filtered, template_map=None, sn_required=True):
    """Fill the 25 template columns from records using the column map.

    Unmapped template columns are written as blank. Only 容器号/SN must carry a
    value; records with a blank SN are skipped (reported as skippedBlankSn).
    Returns (rows, skipped).
    """
    columns = resolve_columns(source, template_map)
    sn_col = columns.get('容器号')
    sn_index = HEADERS.index('容器号')
    rows, skipped = [], 0
    for record in filtered:
        values = record.get('values', {})
        row = [values.get(columns[header]) if columns.get(header) else None for header in HEADERS]
        if sn_required and sn_col:
            sn = row[sn_index]
            if sn is None or not str(sn).strip():
                skipped += 1
                continue
        rows.append(row)
    return rows, skipped


def inspect_template(path):
    template = Path(path)
    if template.suffix.lower() != '.xlsx':
        raise ValueError('请选择原始异常品查询 XLSX 工作簿。')
    try:
        with ZipFile(template) as archive:
            sheets = template_sheet_parts(archive)
            if 'container' not in sheets:
                from . import reason_column_report
                reason_column_report.reference_template(archive, template, sheets)
                return {'fileName': template.name, 'sheets': list(sheets), 'layoutOnly': True}
            spec = rules(archive, template, sheets)
    except (BadZipFile, KeyError, ET.ParseError, AttributeError, TypeError, IndexError, StopIteration) as exc:
        raise ValueError('无法读取模板的图表或透视表，请选择异常品查询或已导出的异常品分析表。') from exc
    return {'fileName': template.name, 'sheets': spec.sheets}


def template_daily_groups(path):
    """Read optional suggested daily groups from the reference's native chart series."""
    with ZipFile(path) as archive:
        sheets = template_sheet_parts(archive)
        daily = sheets.get('每日装管失效人员')
        if not daily:
            return ()
        drawing = next((part for kind, part in part_links(archive, daily).values() if kind == 'drawing'), None)
        if not drawing:
            return ()
        groups = {}
        assigned = set()
        for kind, part in part_links(archive, drawing).values():
            if kind != 'chart':
                continue
            for series in chart_series(read(archive, part)):
                title = series.find(tag(C, 'tx'))
                reference = title.find(tag(C, 'strRef')) if title is not None else None
                if reference is None:
                    continue
                formula = reference.findtext(tag(C, 'f'))
                code = reference.findtext(f'{tag(C, "strCache")}/{tag(C, "pt")}/{tag(C, "v")}')
                try:
                    sheet, _ = range_to_tuple(formula)
                except (AttributeError, ValueError, TypeError):
                    continue
                if code and code not in assigned and sheet in sheets and sheet not in {'总表', '每日装管失效人员'}:
                    groups.setdefault(sheet, []).append(code.strip())
                    assigned.add(code)
        return [{'name': label, 'reasons': codes} for label, codes in groups.items()]


def export(template, output, source, filtered, template_map=None, sn_required=True, rate_report=None,
           *, chart_layout='original', reason_order=(), reason_groups=(), daily_rows=None,
           daily_title='', daily_reason_groups=None, template_rate=None, sheet_reasons=None):
    template, output = Path(template), Path(output)
    if template.suffix.lower() != '.xlsx' or output.suffix.lower() != '.xlsx':
        raise ValueError('请选择 XLSX 模板，并保存为 XLSX。')
    if template.resolve() == output.resolve():
        raise ValueError('输出路径不能与原始模板相同。')
    if chart_layout not in TOTAL_CHART_LAYOUTS:
        raise ValueError('总表图表排版设置无效。')
    if not filtered:
        raise ValueError('当前筛选没有记录可导出。')
    if len(filtered) > MAX_ROWS:
        raise ValueError(f'模板导出最多 {MAX_ROWS:,} 条，请缩小筛选范围后导出。')
    columns = resolve_columns(source, template_map)
    if not isinstance(template_map, dict):
        missing = [name for name in HEADERS if not columns.get(name)]
        if missing:
            raise ValueError('当前数据源缺少原表字段：' + '、'.join(missing))
    rows, skipped = build_rows(source, filtered, template_map, sn_required)
    if not rows:
        raise ValueError('导出记录里「容器号/SN」全部为空，请先在来源里映射该列或补齐数据。')
    rate_prototype = rate_visual = None
    rate_slots = ()
    try:
        with ZipFile(template) as archive:
            sheet_parts = template_sheet_parts(archive)
            layout_only = 'container' not in sheet_parts
            if layout_only and chart_layout != 'reason-columns':
                raise ValueError('已导出的异常品分析表仅支持「按判定原因分表 · 竖排柱形」排版。')
            if chart_layout == 'reason-columns':
                from . import reason_column_report
                if template_rate is not None:
                    from .rate_report import template_prototype, template_rate_chart_count, template_visual
                    rate_prototype = template_prototype(archive, sheet_parts)
                    rate_visual = template_visual(archive, sheet_parts)
                    rate_slots = tuple(f'xl/charts/totalRateSlot{i}.xml'
                                       for i in range(1, template_rate_chart_count(template_rate) + 1))
                spec = (reason_column_report.reference_template(archive, template, sheet_parts)
                        if layout_only else rules(archive, template, sheet_parts))
                daily_detail = (build_rows(source, daily_rows, template_map, sn_required)[0]
                                if daily_rows is not None else None)
                payload, groups, sheets, overview_count, reason_pages = reason_column_report.build(
                    archive, spec, rows, reason_order, reason_groups=reason_groups,
                    daily_rows=daily_detail, daily_title=daily_title, daily_reason_groups=daily_reason_groups,
                    rate_slots=rate_slots, sheet_reasons=sheet_reasons)
            else:
                spec = rules(archive, template, sheet_parts)
                payload, groups, sheets, overview_count = build(archive, spec, rows, chart_layout)
    except (BadZipFile, KeyError, ET.ParseError, AttributeError, TypeError, IndexError, StopIteration) as exc:
        raise ValueError('无法读取原表模板的透视表、图表或排版，请选择原始异常品查询工作簿。') from exc
    rate_summary = None
    if template_rate is not None:
        from .rate_report import append_template_rate
        payload, rate_summary = append_template_rate(payload, template_rate, prototype=rate_prototype,
                                                    overview_slots=rate_slots, reference_visual=rate_visual)
        if rate_summary is not None:
            sheets.insert(rate_summary['sheetIndex'], rate_summary['sheet'])
    elif rate_report is not None:
        from .rate_report import append_trend
        payload, rate_summary = append_trend(payload, rate_report)
        sheets.append(rate_summary['sheet'])
    try:
        with output.open('xb') as destination:
            try:
                destination.write(payload)
            except OSError:
                destination.close()
                output.unlink(missing_ok=True)
                raise
    except FileExistsError as exc:
        raise ValueError('输出文件已存在，请使用新的文件名。') from exc
    result = {'recordCount': len(rows), 'groups': groups, 'uncategorized': len(rows) - sum(groups.values()),
              'skippedBlankSn': skipped, 'fileName': output.name,
              'sheets': sheets,
              'chartLayout': chart_layout, 'overviewChartCount': overview_count,
              'totalChartPages': overview_count if chart_layout == 'readable' else int(bool(overview_count))}
    if chart_layout == 'reason-columns':
        result['totalChartPages'] = reason_pages
        if sheet_reasons is not None:
            uncategorized = sum(not str(row[REASON] or '').strip() for row in rows)
            result['notSelectedForSheet'] = result['uncategorized'] - uncategorized
            result['uncategorized'] = uncategorized
    if rate_summary is not None:
        result['rateReport'] = rate_summary
    return result
