"""Native column charts and separate detail sheets for the filtered reasons."""

from collections import Counter, defaultdict
from copy import deepcopy
from dataclasses import dataclass
from io import BytesIO
from math import ceil
import re
from xml.etree import ElementTree as ET
from zipfile import ZIP_DEFLATED, ZipFile

import openpyxl
from openpyxl.utils import column_index_from_string, get_column_letter

from .original_report import (
    A, C, D, R, X, CHART_PATTERNS, CONTENT_TYPES, EMU_PER_POINT, HEADERS, OWNER, QUANTITY, REASON, Category, Template,
    add, chart_reference, chart_source, clean, drawing_charts, monochrome_series, office_text, one_part,
    owner_key, part_links, read,
    rel_part, rel_target, relationships, tag, write_pivot, write_row, xml,
)
from .tabular import display

OVERVIEW_CHART_WIDTH = 333
REPORT_GAP = 15
REPORT_CELL_PT = 5.25
REPORT_WIDE_CELL_PT = 6
OVERVIEW_SECOND_COLUMN = 4
OVERVIEW_COLUMN_OFFSET = 57
PRINT_HEIGHT_PT = 535
PRINT_ROW_PT = 12.5
WORKSHEET_ROW_PT = 15
PAPER_GAP_PT = 5 * 72 / 25.4
DAILY_SHEET = '每日装管失效人员'
DAILY_TITLE_HEIGHT = 30
COLUMN_WIDTHS = (18, 8, 16, 14, 14, 14, 12, 18, 12, 18, 12, 18, 14,
                 18, 20, 14, 22, 21, 14, 21, 30, 22, 20, 15, 13)
PREFIX = re.compile(r'^(?:(?:CN|T)[_-]+)(?:(?:MMC24|MMC|MPO|LCD)(?:[_-]+|(?=[\u3400-\u9fff])))?', re.I)
INVALID_SHEET = re.compile(r"[\x00-\x1f\\/:?*\[\]]")
RESERVED_SHEETS = {'总表', '责任人图表', '不良率', '不良率趋势', DAILY_SHEET, 'history'}
EXTRA_PATTERNS = ('pct20', 'pct40', 'pct60', 'pct80', 'dkDnDiag', 'dkUpDiag',
                  'ltHorz', 'ltVert', 'diagCross')


@dataclass(frozen=True)
class ChartLayout:
    placements: list
    row_span: int
    breaks: list
    last_column: str
    print_scale: int
    column_offsets: tuple | None = None
    row_offsets: tuple = ()


def reference_template(archive, path, sheet_parts):
    total = sheet_parts.get('总表')
    if not total:
        raise ValueError('参考报表需要包含「总表」。')
    with path.open('rb') as file:
        book = openpyxl.load_workbook(file, read_only=True, data_only=True, keep_links=False)
        try:
            header = next(book['总表'].iter_rows(min_row=1, max_row=1, max_col=len(HEADERS), values_only=True))
        finally:
            book.close()
    if header != HEADERS:
        raise ValueError('参考报表的「总表」需要原异常品查询表头。')
    drawing = one_part(part_links(archive, total), 'drawing', '总表')
    charts = {}
    for rid, part in drawing_charts(archive, drawing, '总表').items():
        root = read(archive, part)
        bars = root.find(f'.//{tag(C, "barChart")}')
        if bars is None or bars.find(tag(C, 'barDir')).get('val') != 'col':
            continue
        series = bars.find(tag(C, 'ser'))
        if series is not None and all(series.find(f'{tag(C, field)}/{tag(C, ref)}') is not None
                                      for field, ref in (('tx','strRef'), ('cat','strRef'), ('val','numRef'))):
            charts[rid] = part
    if not charts:
        raise ValueError('参考报表的「总表」需要一张带姓名与数量数据的 Excel 竖向柱形图。')
    return Template(total, drawing, charts, ())


def reason_label(value):
    return PREFIX.sub('', str(value or '').strip()).strip()


def sheet_name(label, used):
    base = INVALID_SHEET.sub('-', label).strip(" '") or '未命名原因'
    def truncate(value, units):
        return value.encode('utf-16-le')[:units * 2].decode('utf-16-le', errors='ignore').rstrip(" '")
    result = truncate(base, 31)
    counter = 1
    while result.casefold() in used:
        counter += 1
        suffix = f'（{counter}）'
        result = truncate(base, 31 - len(suffix)) + suffix
    used.add(result.casefold())
    return result


def reason_series(bars, name, header, start, items, codes):
    series_model, *other_series = bars.findall(tag(C, 'ser'))
    position = list(bars).index(series_model)
    for item in (series_model, *other_series):
        bars.remove(item)
    escaped = name.replace("'", "''")
    sheet = f"'{escaped}'!"
    end = start + len(items) - 1
    labels = [row[0] for row in items]
    for index, code in enumerate(codes):
        series = deepcopy(series_model)
        series.find(tag(C, 'idx')).set('val', str(index))
        series.find(tag(C, 'order')).set('val', str(index))
        if index <= len(CHART_PATTERNS):
            monochrome_series(series, index)
        else:
            monochrome_series(series, 1)
            series.find(f'{tag(C, "spPr")}/{tag(A, "pattFill")}').set(
                'prst', EXTRA_PATTERNS[(index - len(CHART_PATTERNS) - 1) % len(EXTRA_PATTERNS)])
        column = get_column_letter(index + 2)
        chart_reference(series, 'tx', False, f'{sheet}${column}${header}', [code])
        chart_reference(series, 'cat', False, f'{sheet}$A${start}:$A${end}', labels)
        chart_reference(series, 'val', True, f'{sheet}${column}${start}:${column}${end}',
                        [row[index + 1] or None for row in items])
        bars.insert(position + index, series)


def reason_chart(prototype, title, name, header, start, items, codes):
    chart = deepcopy(prototype)
    for element in ('externalData', 'pivotSource', 'userShapes'):
        old = chart.find(tag(C, element))
        if old is not None:
            chart.remove(old)
    content = chart.find(tag(C, 'chart'))
    plot = content.find(tag(C, 'plotArea'))
    layout = plot.find(tag(C, 'layout'))
    if layout is not None:
        layout.clear()
    bars = plot.find(tag(C, 'barChart'))
    bars.find(tag(C, 'barDir')).set('val', 'col')
    grouping = bars.find(tag(C, 'grouping'))
    if grouping is None:
        grouping = ET.Element(tag(C, 'grouping'), val='clustered')
        bars.insert(list(bars).index(bars.find(tag(C, 'barDir'))) + 1, grouping)
    else:
        grouping.set('val', 'clustered')
    overlap = bars.find(tag(C, 'overlap'))
    if overlap is None:
        overlap = ET.Element(tag(C, 'overlap'), val='0')
        first_axis = bars.find(tag(C, 'axId'))
        bars.insert(list(bars).index(first_axis) if first_axis is not None else len(bars), overlap)
    else:
        overlap.set('val', '0')
    reason_series(bars, name, header, start, items, codes)
    # Stack the characters upright, in reading order from top to bottom.
    axis = plot.find(tag(C, 'catAx'))
    axis.find(tag(C, 'axPos')).set('val', 'b')
    axis.find(tag(C, 'tickLblPos')).set('val', 'low')
    axis.find(f'{tag(C, "scaling")}/{tag(C, "orientation")}').set('val', 'minMax')
    for key in ('tickLblSkip', 'tickMarkSkip', 'txPr'):
        previous = axis.find(tag(C, key))
        if previous is not None:
            axis.remove(previous)
    crossed = axis.find(tag(C, 'crossAx'))
    axis_text = ET.Element(tag(C, 'txPr'))
    axis.insert(list(axis).index(crossed), axis_text)
    add(axis_text, A, 'bodyPr', rot='0', vert='eaVert', wrap='none', vertOverflow='overflow')
    add(axis_text, A, 'lstStyle')
    font = add(add(add(axis_text, A, 'p'), A, 'pPr'), A, 'defRPr', sz='900')
    add(add(font, A, 'solidFill'), A, 'srgbClr', val='262626')
    offset = axis.find(tag(C, 'lblOffset'))
    axis.insert(list(axis).index(offset) + 1, ET.Element(tag(C, 'tickLblSkip'), val='1'))

    axis = plot.find(tag(C, 'valAx'))
    axis.find(tag(C, 'axPos')).set('val', 'l')
    axis.find(tag(C, 'crosses')).set('val', 'autoZero')
    chart_title = content.find(tag(C, 'title'))
    chart_title.clear()
    rich = add(add(chart_title, C, 'tx'), C, 'rich')
    add(rich, A, 'bodyPr')
    add(rich, A, 'lstStyle')
    run = add(add(rich, A, 'p'), A, 'r')
    add(run, A, 'rPr', lang='zh-CN', sz='1050', b='1')
    add(run, A, 't').text = office_text(title)
    add(chart_title, C, 'overlay', val='0')
    # A single reason needs no legend; combined reasons retain independent series.
    legend = content.find(tag(C, 'legend'))
    if legend is not None:
        content.remove(legend)
    if len(codes) > 1:
        blanks = content.find(tag(C, 'dispBlanksAs'))
        if blanks is not None:
            blanks.set('val', 'gap')
        legend = ET.Element(tag(C, 'legend'))
        add(legend, C, 'legendPos', val='b')
        add(legend, C, 'overlay', val='0')
        content.insert(list(content).index(plot) + 1, legend)
    return xml(chart)


def write_drawing(parts, frame, index, charts, first_chart_row, placements, column_offsets=None, row_offsets=()):
    drawing = ET.Element(tag(D, 'wsDr'))
    path = f'xl/drawings/reasonSheet{index}.xml'
    links = []
    def column_marker(point):
        left = 0
        for column in range(16384):
            width = (COLUMN_WIDTHS[column] if column < len(COLUMN_WIDTHS) else 8) * REPORT_CELL_PT
            if point < left + width:
                return column, int((point - left) * EMU_PER_POINT)
            left += width
        raise ValueError('总表图表超出 Excel 列数限制。')

    def marker(parent, element, column, column_offset, row, row_offset=0):
        target = add(parent, D, element)
        for key, value in (('col', column), ('colOff', column_offset), ('row', row), ('rowOff', row_offset)):
            add(target, D, key).text = str(value)

    for position, (chart, placement) in enumerate(zip(charts, placements, strict=True)):
        row, column, width, height = placement
        col, offset = (OVERVIEW_SECOND_COLUMN, OVERVIEW_COLUMN_OFFSET * EMU_PER_POINT) if column else (0, 0)
        start_row = first_chart_row - 1 + row
        if column_offsets is None:
            anchor = add(drawing, D, 'oneCellAnchor')
            marker(anchor, 'from', col, offset, start_row)
            add(anchor, D, 'ext', cx=width * EMU_PER_POINT, cy=height * EMU_PER_POINT)
        else:
            # Both adjacent and spanning charts end at the same cell markers.
            # This preserves aligned edges when Excel recalculates print metrics.
            anchor = add(drawing, D, 'twoCellAnchor', editAs='twoCell')
            left = column_offsets[column]
            row_offset = row_offsets[position] if row_offsets else 0
            col, offset = column_marker(left)
            marker(anchor, 'from', col, offset, start_row, row_offset * EMU_PER_POINT)
            col, offset = column_marker(left + width)
            whole_rows, remainder = divmod(row_offset + height, WORKSHEET_ROW_PT)
            marker(anchor, 'to', col, offset, start_row + whole_rows, remainder * EMU_PER_POINT)
        graphic = deepcopy(frame)
        graphic.find(f'.//{tag(D, "cNvPr")}').attrib.update(id=str(position + 2), name=f'不良柱形图 {position + 1}')
        rid = f'rId{position + 1}'
        graphic.find(f'.//{tag(C, "chart")}').set(tag(R, 'id'), rid)
        anchor.append(graphic)
        add(anchor, D, 'clientData')
        links.append((rid, 'chart', rel_target(path, chart)))
    parts[path] = xml(drawing)
    parts[rel_part(path)] = relationships(links)
    return path


def write_sheet(parts, frame, index, name, records, charts, *, chart_tables=(), pivot=None,
                layout=None, title='', title_style=None):
    path = f'xl/worksheets/reasonSheet{index}.xml'
    first_chart = 2 if title else (len(records) + 4 if records else 1)
    chart_end = first_chart + layout.row_span - 1 if layout else 0
    last_detail = 1 + len(records)
    last_base = max(last_detail, chart_end)
    last_row = last_base + sum(len(owners) + 2 for owners, _ in chart_tables) + 1 if chart_tables else last_base
    pivot_rows = 0
    if pivot:
        _, start, owners, codes = pivot
        pivot_rows = start + len(owners) + 2
        last_row = max(last_row, pivot_rows)
    chart_col = column_index_from_string(layout.last_column) if layout else 0
    last_col = get_column_letter(max(len(HEADERS), chart_col, len(pivot[3]) + 2 if pivot else 0))
    sheet = ET.Element(tag(X, 'worksheet'))
    add(sheet, X, 'dimension', ref=f'A1:{last_col}{last_row}')
    view = add(add(sheet, X, 'sheetViews'), X, 'sheetView', workbookViewId='0', showGridLines='0')
    add(view, X, 'selection', activeCell='A1', sqref='A1')
    add(sheet, X, 'sheetFormatPr', defaultRowHeight='15', defaultColWidth='8')
    columns = add(sheet, X, 'cols')
    for col, width in enumerate(COLUMN_WIDTHS, 1):
        add(columns, X, 'col', min=col, max=col, width=width, customWidth='1')
    data = add(sheet, X, 'sheetData')
    if title:
        write_row(data, 1, (title,), (title_style,), str(DAILY_TITLE_HEIGHT))
    if records:
        write_row(data, 1, HEADERS, ('2',) * len(HEADERS), '24')
    for row, record in enumerate(records, 2):
        write_row(data, row, record)
    if layout:
        for row in range(first_chart, chart_end + 1):
            add(data, X, 'row', r=row, ht=15, customHeight='1')
    elif title:
        write_row(data, 2, ('所选业务日没有装管判定记录',), ('2',), '22')
        sheet.find(tag(X, 'dimension')).set('ref', 'A1:Y2')
    data_row = last_base + 3
    for owners, codes in chart_tables:
        write_row(data, data_row, ('责任人', *codes), ('2',) * (1 + len(codes)), '22')
        data_row += 1
        for label, *counts in owners:
            if len(codes) > 1:
                counts = [count or None for count in counts]
            write_row(data, data_row, (label, *counts))
            data_row += 1
        data_row += 1
    if pivot:
        _, start, owners, codes = pivot
        values = Counter((owner_key(record), record[REASON]) for record in records
                         if record[QUANTITY] not in (None, ''))
        write_row(data, start, ('计数项:数量', '列标签'), ('2', '2'))
        write_row(data, start + 1, ('行标签', *codes, '总计'), ('2',))
        for position, owner in enumerate(owners, start + 2):
            counts = [values[owner, code] for code in codes]
            write_row(data, position, (owner or '(空白)', *(count or None for count in counts), sum(counts)))
        totals = [sum(values[owner, code] for owner in owners) for code in codes]
        write_row(data, pivot_rows, ('总计', *totals, sum(totals)), ('2',))
    if records:
        add(sheet, X, 'autoFilter', ref=f'A1:Y{last_detail}')
    if title:
        merges = add(sheet, X, 'mergeCells', count='1')
        title_last_col = layout.last_column if layout else 'I'
        add(merges, X, 'mergeCell', ref=f'A1:{title_last_col}1')
    print_area = None
    if layout:
        add(sheet, X, 'printOptions', horizontalCentered='1')
        add(sheet, X, 'pageMargins', left='0.30', right='0.30', top='0.35', bottom='0.35',
            header='0.15', footer='0.15')
        add(sheet, X, 'pageSetup', paperSize='9', orientation='landscape', scale=layout.print_scale, blackAndWhite='1')
        if layout.breaks:
            breaks = add(sheet, X, 'rowBreaks', count=len(layout.breaks), manualBreakCount=len(layout.breaks))
            for row in layout.breaks:
                add(breaks, X, 'brk', id=first_chart - 1 + row, min='0', max='16383', man='1')
        drawing = write_drawing(parts, frame, index, charts, first_chart, layout.placements,
                                layout.column_offsets, layout.row_offsets)
        add(sheet, X, 'drawing').set(tag(R, 'id'), 'rId1')
        links = [(1, 'drawing', rel_target(path, drawing))]
        if pivot:
            links.append((2, 'pivotTable', rel_target(path, pivot[0])))
        parts[rel_part(path)] = relationships(links)
        print_start = 1 if title else first_chart
        print_area = "'" + name.replace("'", "''") + f"'!$A${print_start}:${layout.last_column}${chart_end}"
    parts[path] = xml(sheet)
    return name, path, print_area


def selected_categories(rows, reason_groups, reason_order, sheet_reasons=None):
    """Select exact source values; only explicit groups can share a sheet."""
    allowed = None if sheet_reasons is None else set(sheet_reasons)
    by_reason = defaultdict(list)
    for row in rows:
        code = display(row[REASON])
        if code and (allowed is None or code in allowed):
            by_reason[code].append(row)
    groups = []
    claimed = set()
    for group in reason_groups:
        wanted = tuple(display(raw) for raw in group['reasons'])
        if len(wanted) != len(set(wanted)) or claimed.intersection(wanted):
            raise ValueError('同一个判定原因只能放进一个分组。')
        codes = tuple(code for code in wanted if code in by_reason)
        claimed.update(wanted)
        if not codes:
            continue
        short_names = dict.fromkeys((reason_label(code) or '判定原因') for code in
                                    (wanted if allowed is None else codes))
        name = group.get('name', '').strip() or '、'.join(short_names)
        groups.append((name, codes, [row for code in codes for row in by_reason[code]]))
    order = {value: index for index, value in enumerate(reason_order)}
    for code in sorted(by_reason.keys() - claimed, key=lambda value: (
            order.get(value, order.get(reason_label(value), len(order))),
            -len(by_reason[value]), reason_label(value).casefold(), value)):
        groups.append((reason_label(code) or '判定原因', (code,), by_reason[code]))
    return groups


def rank_members(records, codes, template_order=None):
    template_order = template_order or {}
    names, members = Counter(), Counter()
    for row in records:
        owner = owner_key(row) or '（空白）'
        quantity = int(row[QUANTITY] not in (None, ''))
        names[owner] += quantity
        members[owner, display(row[REASON])] += quantity
    return [(name, *(members[name, code] for code in codes))
            for name in sorted(names, key=lambda name: (-names[name], template_order.get(name, len(template_order)), name.casefold(), name))]


def chart_metrics(owners, codes, *, overview=False):
    pitch = max(11, 6 + len(codes)) if overview else max(13, 7 + 2 * len(codes))
    label_height = max([4, *(len(row[0]) for row in owners)]) * 11
    legend_height = ceil(len(codes) / (3 if overview else 4)) * 17 if len(codes) > 1 else 0
    width = 74 + pitch * len(owners)
    height = (121 if overview else 225) + label_height + legend_height
    return (width, max(216, height)) if overview else (max(425, width), max(300, height))


def print_width(right):
    # Use a conservative 7-pixel digit width to cover the chart, and a wider
    # 8-pixel digit width to bound the physical print width.
    width = 0
    for col in range(1, 16385):
        width += (COLUMN_WIDTHS[col - 1] if col <= len(COLUMN_WIDTHS) else 8) * REPORT_CELL_PT
        if width >= right + 6:
            return get_column_letter(col), max(10, min(94, int(780 / (width * 8 / 7 + 6) * 100)))
    raise ValueError('图表宽度超出 Excel 工作表范围，请缩小筛选范围。')


def category_placement(width, height):
    col, scale = print_width(width)
    row_span = ceil((PRINT_ROW_PT + height + REPORT_GAP) / PRINT_ROW_PT)
    scale = max(10, min(scale, int(PRINT_HEIGHT_PT / (row_span * WORKSHEET_ROW_PT) * 100)))
    return ChartLayout([(1, 0, width, height)], row_span, [], col, scale)


def total_overview_placement(sizes, *, header_height=0, full_width_count=0):
    """Arrange complete charts on landscape A4 with gutters sized at print scale."""
    canvas = max(OVERVIEW_CHART_WIDTH * 2 + 24, *(width for width, _ in sizes))
    height = max(height for _, height in sizes)
    last_column, width_scale = print_width(canvas)
    first_rate = len(sizes) - full_width_count

    def small(index):
        return index < first_rate and sizes[index][0] <= min(OVERVIEW_CHART_WIDTH, half)

    # Leave room for the gutter and round the print area to full rows at each break.
    scale = min(width_scale, int(100 * (PRINT_HEIGHT_PT - PAPER_GAP_PT * 1.2)
                                / (height * min(2, len(sizes)) + header_height + 2 * WORKSHEET_ROW_PT)))
    if scale < 10:
        raise ValueError('完整图表超出 Excel 支持的打印比例，请缩小筛选范围。')
    # Excel normally uses wider columns and shorter rows in the printed range.
    # The horizontal and vertical offsets compensate for those two measurements.
    horizontal_gap = max(1, round(PAPER_GAP_PT * 100 / scale / 1.04))
    vertical_gap = max(1, round(PAPER_GAP_PT * 100 / scale / (13.08 / WORKSHEET_ROW_PT)))
    half = (canvas - horizontal_gap) // 2
    pending = list(range(len(sizes)))
    rows = []
    while pending:
        first = pending.pop(0)
        row = [first]
        if small(first):
            partner = next((index for index in pending if small(index)), None)
            if partner is not None:
                pending.remove(partner)
                row.append(partner)
        rows.append(row)
    target_rows = min(2, len(rows))
    ordered, placements, breaks = [], [], []
    row_offsets = []
    stride = height + vertical_gap
    # Keep one blank row before the break so Excel does not print the previous
    # chart's bottom border along the top clip edge of the following page.
    page_rows = 2 + ceil((target_rows * height + (target_rows - 1) * vertical_gap) / WORKSHEET_ROW_PT)
    for row_index, row in enumerate(rows):
        page, page_row = divmod(row_index, target_rows)
        page_start = page * page_rows
        if page and not page_row:
            breaks.append(page_start)
        row_start, row_offset = divmod(page_row * stride, WORKSHEET_ROW_PT)
        for slot, index in enumerate(row):
            width = half if len(row) == 2 else canvas
            placements.append((page_start + 1 + row_start, slot, width, height))
            row_offsets.append(row_offset)
            ordered.append(index)
    row_span = page_start + 1 + ceil((page_row * stride + height) / WORKSHEET_ROW_PT)
    return ordered, ChartLayout(placements, row_span, breaks, last_column, scale,
                                (0, canvas - half), tuple(row_offsets))


def daily_sheet(parts, frame, prototype, index, rows, title, title_style, reason_groups, reason_order):
    categories = selected_categories(rows, reason_groups, reason_order)
    tables = [(label, codes, rank_members(records, codes)) for label, codes, records in categories]
    sizes = [chart_metrics(owners, codes, overview=True) for _, codes, owners in tables]
    order, layout = total_overview_placement(sizes, header_height=DAILY_TITLE_HEIGHT) if sizes else ([], None)
    if layout and len(layout.breaks) >= 1027:
        raise ValueError('每日装管失效人员超过 Excel 的分页上限，请缩小筛选范围。')
    charts = []
    if layout:
        first_count = layout.row_span + 5
        for number, (label, codes, owners) in enumerate(tables, 1):
            part = f'xl/charts/reasonDaily{number}.xml'
            parts[part] = reason_chart(prototype, label, DAILY_SHEET, first_count - 1, first_count, owners, codes)
            charts.append(part)
            first_count += len(owners) + 2
    return write_sheet(parts, frame, index, DAILY_SHEET, (), [charts[index] for index in order],
                       layout=layout, title=title, title_style=title_style,
                       chart_tables=[(owners, codes) for _, codes, owners in tables])


def reference_pivot(archive):
    # Match the template's actual axes and Count(数量) aggregate, not just its file name.
    for path in archive.namelist():
        if not re.fullmatch(r'xl/pivotTables/[^/]+\.xml', path):
            continue
        table = read(archive, path)
        axes = [[item.get('x') for item in table.findall(f'{tag(X, axis)}/{tag(X, "field")}')]
                for axis in ('rowFields', 'colFields')]
        fields = table.findall(f'{tag(X, "dataFields")}/{tag(X, "dataField")}')
        if axes == [[str(OWNER)], [str(REASON)]] and len(fields) == 1 and (
                fields[0].get('fld'), fields[0].get('subtotal')) == (str(QUANTITY), 'count'):
            return path
    return None


def reference_chart_profiles(archive, template):
    profiles = {}
    for path in template.charts.values():
        try:
            name, _, series = chart_source(archive, path)
        except (TypeError, ValueError):
            continue
        label_path = '/'.join(tag(C, key) for key in ('tx', 'strRef', 'strCache', 'pt', 'v'))
        names_path = '/'.join(tag(C, key) for key in ('cat', 'strRef', 'strCache', 'pt', 'v'))
        codes = frozenset(display(item.findtext(label_path)) for item in series)
        if '' in codes or len(codes) != len(series):
            continue
        order = {item.text: i for i, item in enumerate(series[0].findall(names_path))}
        chart = clean(read(archive, path))
        title = ''.join(item.text or '' for item in chart.findall(f'{tag(C, "chart")}/{tag(C, "title")}//{tag(A, "t")}'))
        profiles[codes] = (name, title, order)
    return profiles


def adaptive_groups(parts, frame, prototype, rows, reason_groups, reason_order, rate_slots=(),
                    sheet_reasons=None, *, archive=None, pivot_prototype=None, profiles=None):
    categories = selected_categories(rows, reason_groups, reason_order, sheet_reasons)
    if sheet_reasons is not None and not categories:
        raise ValueError('当前筛选没有命中所选的分表原因，请修改日报配置或筛选条件。')
    used = set(RESERVED_SHEETS)
    sheets, counts_by_sheet, overview, sizes = [], {}, [], []
    for index, (label, codes, records) in enumerate(categories, 2):
        name = sheet_name(label, used)
        template_name, template_title, template_order = (profiles or {}).get(frozenset(codes), ('', '', {}))
        owners = rank_members(records, codes, template_order)
        title = template_title if name == template_name and template_title else name
        width, height = chart_metrics(owners, codes)
        layout = category_placement(width, height)
        first_count = len(records) + layout.row_span + 7
        part = f'xl/charts/reasonSheet{index}Chart1.xml'
        parts[part] = reason_chart(prototype, title, name, first_count - 1, first_count, owners, codes)
        counts_by_sheet[name] = len(records)
        pivot = None
        if pivot_prototype:
            owner_counts = Counter()
            reason_variants = defaultdict(dict)
            for record in records:
                owner_counts[owner_key(record)] += int(record[QUANTITY] not in (None, ''))
                reason_variants[display(record[REASON])][record[REASON]] = None
            owner_order = sorted(owner_counts, key=lambda owner: (-owner_counts[owner], (owner or '').casefold()))
            raw_codes = tuple(value for code in codes for value in reason_variants[code])
            category = Category(name, '', '', {}, '',
                f'xl/pivotTables/reasonPivot{index}.xml', f'xl/pivotCache/reasonCache{index}.xml',
                f'xl/pivotCache/reasonRecords{index}.xml', 0, raw_codes, {})
            start = first_count + len(owners) + 2
            shown = write_pivot(parts, archive, index, category, records, owner_order, start,
                                prototype=pivot_prototype)
            pivot = category.pivot, start, owner_order, shown
        sheets.append(write_sheet(parts, frame, index, name, records, [part],
                                  chart_tables=[(owners, codes)], layout=layout, pivot=pivot))
        overview_part = f'xl/charts/reasonOverview{len(overview) + 1}.xml'
        parts[overview_part] = parts[part]
        overview.append(overview_part)
        sizes.append(chart_metrics(owners, codes, overview=True))
    for slot in rate_slots:
        parts[slot] = b''
    total_charts = [*overview, *rate_slots]
    total_sizes = [*sizes, *((600, 215) for _ in rate_slots)]
    overview_layout = None
    if total_charts:
        ordered, overview_layout = total_overview_placement(total_sizes, full_width_count=len(rate_slots))
        total_charts = [total_charts[index] for index in ordered]
    if overview_layout and len(overview_layout.breaks) >= 1027:
        raise ValueError('总表超过 Excel 的分页上限，请缩小筛选范围。')
    sheets.insert(0, write_sheet(parts, frame, 1, '总表', rows, total_charts, layout=overview_layout))
    if overview and not pivot_prototype:
        order, dashboard_layout = total_overview_placement(sizes)
        dashboard = []
        for index, position in enumerate(order, 1):
            copy = f'xl/charts/reasonDashboard{index}.xml'
            parts[copy] = parts[overview[position]]
            dashboard.append(copy)
        sheets.insert(1, write_sheet(parts, frame, len(categories) + 2, '责任人图表', (), dashboard,
                                     layout=dashboard_layout))
    return sheets, counts_by_sheet, overview, 1 + len(overview_layout.breaks) if overview_layout else 0


def build(archive, template, rows, reason_order=(), *, reason_groups=(), daily_rows=None,
          daily_title='', daily_reason_groups=None, rate_slots=(), sheet_reasons=None):
    prototype = clean(read(archive, next(iter(template.charts.values()))))
    drawing = clean(read(archive, template.drawing))
    rid = next(iter(template.charts))
    for anchor in drawing:
        link = anchor.find(f'.//{tag(C, "chart")}')
        if link is not None and link.get(tag(R, 'id')) == rid:
            frame = anchor.find(tag(D, 'graphicFrame'))
            break
    else:
        raise ValueError('总表找不到柱形图形状。')
    parts = {}
    pivot_prototype = reference_pivot(archive)
    sheets, counts_by_sheet, overview, page_count = adaptive_groups(
        parts, frame, prototype, rows, reason_groups, reason_order, rate_slots, sheet_reasons,
        archive=archive, pivot_prototype=pivot_prototype, profiles=reference_chart_profiles(archive, template))
    if daily_rows is not None:
        index = len(sheets) + 1
        styles, title_style = daily_heading_style(archive)
        parts['xl/styles.xml'] = styles
        groups = reason_groups if daily_reason_groups is None else daily_reason_groups
        daily = daily_sheet(parts, frame, prototype, index, daily_rows, daily_title or DAILY_SHEET,
                            title_style, groups, reason_order)
        sheets.insert(1 if pivot_prototype else min(2, len(sheets)), daily)
    return (*finish_workbook(archive, parts, sheets, counts_by_sheet, overview), page_count)


def daily_heading_style(archive):
    styles = clean(read(archive, 'xl/styles.xml'))
    fonts = styles.find(tag(X, 'fonts'))
    font = add(fonts, X, 'font')
    add(font, X, 'b')
    add(font, X, 'sz', val='20')
    add(font, X, 'name', val='等线')
    fonts.set('count', str(len(fonts)))
    formats = styles.find(tag(X, 'cellXfs'))
    heading = add(formats, X, 'xf', numFmtId='0', fontId=len(fonts) - 1, fillId='0', borderId='0',
                  xfId='0', applyFont='1', applyAlignment='1')
    add(heading, X, 'alignment', horizontal='center', vertical='center')
    formats.set('count', str(len(formats)))
    return xml(styles), str(len(formats) - 1)


def finish_workbook(archive, parts, sheets, counts_by_sheet, overview):
    workbook = ET.Element(tag(X, 'workbook'))
    add(add(workbook, X, 'bookViews'), X, 'workbookView', activeTab='0')
    workbook_sheets = add(workbook, X, 'sheets')
    rels = [(1, 'theme', 'theme/theme1.xml'), (2, 'styles', 'styles.xml')]
    for index, (name, part, _) in enumerate(sheets, 1):
        rid = f'rId{index + 2}'
        add(workbook_sheets, X, 'sheet', name=name, sheetId=index).set(tag(R, 'id'), rid)
        rels.append((rid, 'worksheet', rel_target('xl/workbook.xml', part)))
    print_areas = [(index, area) for index, (_, _, area) in enumerate(sheets) if area]
    if print_areas:
        defined = add(workbook, X, 'definedNames')
        for index, area in print_areas:
            add(defined, X, 'definedName', name='_xlnm.Print_Area', localSheetId=index).text = area
    caches = [path for path in parts if re.fullmatch(r'xl/pivotCache/reasonCache[0-9]+\.xml', path)]
    if caches:
        pivot_caches = add(workbook, X, 'pivotCaches')
        for path in caches:
            cache_id = path.removeprefix('xl/pivotCache/reasonCache').removesuffix('.xml')
            rid = f'rId{len(rels) + 1}'
            add(pivot_caches, X, 'pivotCache', cacheId=cache_id).set(tag(R, 'id'), rid)
            rels.append((rid, 'pivotCacheDefinition', rel_target('xl/workbook.xml', path)))
    parts['xl/workbook.xml'] = xml(workbook)
    parts['xl/_rels/workbook.xml.rels'] = relationships(rels)
    for part in ('xl/theme/theme1.xml', 'xl/styles.xml'):
        if part not in parts:
            parts[part] = archive.read(part)
    parts['_rels/.rels'] = relationships([(1, 'officeDocument', 'xl/workbook.xml')])
    types = read(archive, '[Content_Types].xml')
    for node in list(types):
        if node.tag.endswith('}Override') and node.get('PartName').lstrip('/') not in parts:
            types.remove(node)
    for paths, kind in (([item[1] for item in sheets], 'spreadsheetml.worksheet'),
                        ([path for path in parts if path.startswith('xl/charts/')], 'drawingml.chart'),
                        ([path for path in parts if path.startswith('xl/drawings/reasonSheet')], 'drawing'),
                        ([path for path in parts if path.startswith('xl/pivotTables/reasonPivot')], 'spreadsheetml.pivotTable'),
                        (caches, 'spreadsheetml.pivotCacheDefinition'),
                        ([path for path in parts if path.startswith('xl/pivotCache/reasonRecords')], 'spreadsheetml.pivotCacheRecords')):
        for path in paths:
            add(types, CONTENT_TYPES, 'Override', PartName='/' + path,
                ContentType=f'application/vnd.openxmlformats-officedocument.{kind}+xml')
    parts['[Content_Types].xml'] = xml(types)
    output = BytesIO()
    with ZipFile(output, 'w', ZIP_DEFLATED, compresslevel=4) as report:
        for part, content in parts.items():
            report.writestr(part, content)
    return output.getvalue(), counts_by_sheet, [item[0] for item in sheets], len(overview)
