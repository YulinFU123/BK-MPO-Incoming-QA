"""Append native rate reports without rewriting existing XLSX charts.

Inputs are already scoped and calculated by the analysis engine.  This module
checks that valid rates agree with their numerator/denominator; it never fills
an unavailable rate with zero or silently substitutes a production total.
"""

from copy import deepcopy
from datetime import date
from io import BytesIO
import math
from xml.etree import ElementTree as ET
from zipfile import ZIP_DEFLATED, ZipFile

from openpyxl.utils import get_column_letter

from . import original_report as native

X, R, P, C, D, A = native.X, native.R, native.P, native.C, native.D, native.A
T = 'http://schemas.openxmlformats.org/package/2006/content-types'
MAX_POINTS = 3660
POINTS_PER_PAGE = 14
PAGE_ROWS = 40
SHEET_NAME = '不良率趋势'
TEMPLATE_SHEET = '不良率'
DAILY_PERSONNEL_SHEET = '每日装管失效人员'
TEMPLATE_DAYS_PER_PAGE = 10
TEMPLATE_DATE_FORMAT = 'yyyy-mm-dd'
TEMPLATE_PRINT_WIDTH = 780
TEMPLATE_PRINT_HEIGHT = 530
TEMPLATE_CHART_HEIGHT = 145


def package_xml(node, namespace):
    # Use the canonical default namespace in OPC package metadata.
    prefix = '{' + namespace + '}'
    root = ET.Element(node.tag.removeprefix(prefix), {**node.attrib, 'xmlns': namespace})
    for child in node:
        ET.SubElement(root, child.tag.removeprefix(prefix), child.attrib)
    return native.xml(root)


def text(value, limit=2000):
    result = '' if value is None else str(value)
    if len(result) > limit:
        raise ValueError('不良率报表说明过长，请缩短标题或筛选说明。')
    return result


def number(value, field, nullable=True):
    if value is None and nullable:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
        raise ValueError(f'不良率报表的{field}必须为有效的非负数。')
    return value


def normalized(report):
    if not isinstance(report, dict):
        raise ValueError('不良率报表配置无效。')
    raw = report.get('trend', report.get('points'))
    if not isinstance(raw, list) or not raw or len(raw) > MAX_POINTS:
        raise ValueError(f'不良率趋势需要 1 至 {MAX_POINTS} 个有效时间点。')
    points = []
    for item in raw:
        if not isinstance(item, dict):
            raise ValueError('不良率趋势数据格式无效。')
        qty = number(item.get('quantity', item.get('numerator')), '不良数量')
        production = number(item.get('production', item.get('denominator')), '产量')
        rate = number(item.get('rate'), '不良率')
        reason = text(item.get('rateReason', item.get('reason', '')))
        # Missing coverage and the engine's rejection reason are authoritative.
        if rate is not None:
            if qty is None or not production or reason:
                raise ValueError('不良率与有效产量或统计状态不一致，请重新核对产量绑定。')
            if not math.isclose(rate, qty / production, rel_tol=1e-9, abs_tol=1e-12):
                raise ValueError('不良率与不良数量÷产量不一致，请重新分析后导出。')
        if rate is None and not reason:
            reason = ('缺少不良数据' if qty is None else
                      '没有匹配产量' if production is None else
                      '产量为零，不能计算不良率' if production == 0 else '当前口径不能计算不良率')
        label = text(item.get('label') or item.get('start') or item.get('date'), 120)
        if not label:
            raise ValueError('不良率趋势缺少时间标签。')
        start, end = text(item.get('start', label), 120), text(item.get('end', label), 120)
        points.append({'label': label, 'start': start, 'end': end, 'quantity': qty,
                       'production': production, 'rate': rate, 'reason': reason})
    good = [point for point in points if point['rate'] is not None]
    complete = len(good) == len(points)
    qty = sum(point['quantity'] or 0 for point in points)
    production = sum(point['production'] or 0 for point in points)
    overall = qty / production if complete and production > 0 else None
    return points, {'points': len(points), 'validPoints': len(good), 'overallRate': overall,
                    'quantity': qty, 'production': production, 'complete': complete}


def unique_part(parts, folder, stem, suffix='.xml'):
    index = 1
    while f'{folder}/{stem}{index}{suffix}' in parts:
        index += 1
    return f'{folder}/{stem}{index}{suffix}'


def styles(parts, *, template=False):
    """Append formats; every existing format and index stays unchanged."""
    root = ET.fromstring(parts['xl/styles.xml'])
    fonts = root.find(native.tag(X, 'fonts'))
    fills = root.find(native.tag(X, 'fills'))
    xfs = root.find(native.tag(X, 'cellXfs'))
    if fonts is None or fills is None or xfs is None or not len(xfs):
        raise ValueError('原表缺少可用于不良率页的样式。')
    font_ids = {}
    for role, size, bold in [('normal', 10, False), ('title', 17, True), ('heading', 10, True)]:
        font_ids[role] = len(fonts)
        node = native.add(fonts, X, 'font')
        native.add(node, X, 'sz', val=size)
        if bold:
            native.add(node, X, 'b')
        native.add(node, X, 'color', rgb='FF111111')
        native.add(node, X, 'name', val='Microsoft YaHei')
    fonts.set('count', str(len(fonts)))
    fill_id = len(fills)
    pattern = native.add(native.add(fills, X, 'fill'), X, 'patternFill', patternType='solid')
    native.add(pattern, X, 'fgColor', rgb='FFE9ECEF')
    native.add(pattern, X, 'bgColor', indexed='64')
    fills.set('count', str(len(fills)))
    style_definitions = [
        ('text', 'normal', 0, 0, 'left'), ('number', 'normal', 3, 0, 'right'),
        ('rate', 'normal', 10, 0, 'right'), ('title', 'title', 0, 0, 'left'),
        ('heading', 'heading', 0, fill_id, 'left'), ('note', 'normal', 0, 0, 'left'),
    ]
    if template:
        num_fmts = root.find(native.tag(X, 'numFmts'))
        if num_fmts is None:
            num_fmts = ET.Element(native.tag(X, 'numFmts'))
            root.insert(0, num_fmts)
        date_format_id = max((int(node.get('numFmtId')) for node in num_fmts), default=163) + 1
        native.add(num_fmts, X, 'numFmt', numFmtId=date_format_id, formatCode=TEMPLATE_DATE_FORMAT)
        num_fmts.set('count', str(len(num_fmts)))
        input_fill_id = len(fills)
        input_fill = native.add(native.add(fills, X, 'fill'), X, 'patternFill', patternType='solid')
        native.add(input_fill, X, 'fgColor', rgb='FFF0F5FD')
        native.add(input_fill, X, 'bgColor', indexed='64')
        fills.set('count', str(len(fills)))
        style_definitions.extend([
            ('date', 'heading', date_format_id, fill_id, 'center'),
            ('input', 'normal', 3, input_fill_id, 'right'),
            ('key_rate', 'heading', 10, fill_id, 'right'),
            ('keywords', 'normal', 0, 0, 'left'),
        ])
    result = {}
    for role, font, fmt, fill, align in style_definitions:
        result[role] = len(xfs)
        xf = native.add(xfs, X, 'xf', numFmtId=fmt, fontId=font_ids[font], fillId=fill,
                        borderId='0', xfId='0', applyFont='1', applyNumberFormat='1', applyAlignment='1')
        native.add(xf, X, 'alignment', horizontal=align, vertical='center',
                   wrapText='1' if role == 'keywords' else '0')
    xfs.set('count', str(len(xfs)))
    parts['xl/styles.xml'] = native.xml(root)
    return result


def chart_text(parent, value, size=1100, bold=False):
    rich = native.add(parent, C, 'rich')
    native.add(rich, A, 'bodyPr')
    native.add(rich, A, 'lstStyle')
    paragraph = native.add(rich, A, 'p')
    run = native.add(paragraph, A, 'r')
    native.add(run, A, 'rPr', lang='zh-CN', sz=size, b='1' if bold else '0')
    native.add(run, A, 't').text = value


def axis_text(parent, size=900):
    body = native.add(parent, C, 'txPr')
    native.add(body, A, 'bodyPr')
    native.add(body, A, 'lstStyle')
    paragraph = native.add(body, A, 'p')
    native.add(native.add(paragraph, A, 'pPr'), A, 'defRPr', sz=size)
    native.add(paragraph, A, 'endParaRPr', lang='zh-CN')


def chart_xml(points, sheet, first_row, title, axis_max=None, *, horizontal=None, date1904=False):
    root = ET.Element(native.tag(C, 'chartSpace'))
    native.add(root, C, 'date1904', val='1' if date1904 else '0')
    native.add(root, C, 'lang', val='zh-CN')
    chart = native.add(root, C, 'chart')
    heading = native.add(chart, C, 'title')
    chart_text(native.add(heading, C, 'tx'), title, 1200, True)
    native.add(heading, C, 'overlay', val='0')
    native.add(chart, C, 'autoTitleDeleted', val='0')
    plot = native.add(chart, C, 'plotArea')
    native.add(plot, C, 'layout')
    line = native.add(plot, C, 'lineChart')
    native.add(line, C, 'grouping', val='standard')
    native.add(line, C, 'varyColors', val='0')
    series = native.add(line, C, 'ser')
    native.add(series, C, 'idx', val='0')
    native.add(series, C, 'order', val='0')
    native.add(native.add(series, C, 'tx'), C, 'v').text = '不良率'
    stroke = native.add(native.add(series, C, 'spPr'), A, 'ln', w='28575')
    native.add(native.add(stroke, A, 'solidFill'), A, 'srgbClr', val='111111')
    marker = native.add(series, C, 'marker')
    native.add(marker, C, 'symbol', val='circle')
    native.add(marker, C, 'size', val='5')
    native.add(native.add(native.add(marker, C, 'spPr'), A, 'solidFill'), A, 'srgbClr', val='111111')
    labels = native.add(series, C, 'dLbls')
    native.add(labels, C, 'numFmt', formatCode='0.00%', sourceLinked='0')
    axis_text(labels, 900)
    native.add(labels, C, 'dLblPos', val='t')
    for key, val in [('showLegendKey', 0), ('showVal', 1), ('showCatName', 0), ('showSerName', 0)]:
        native.add(labels, C, key, val=val)
    escaped = sheet.replace("'", "''")
    if horizontal:
        date_row, plot_row = horizontal
        end_column = get_column_letter(len(points) + 1)
        date_ref = f'$B${date_row}:${end_column}${date_row}'
        rate_ref = f'$B${plot_row}:${end_column}${plot_row}'
        cats = native.add(native.add(series, C, 'cat'), C, 'numRef')
        cache_kind, values = 'numCache', [excel_day(point['date'], date1904) for point in points]
    else:
        last_row = first_row + len(points) - 1
        date_ref = f'$A${first_row}:$A${last_row}'
        rate_ref = f'$D${first_row}:$D${last_row}'
        cats = native.add(native.add(series, C, 'cat'), C, 'strRef')
        cache_kind, values = 'strCache', [point['label'] for point in points]
    native.add(cats, C, 'f').text = f"'{escaped}'!{date_ref}"
    cache = native.add(cats, C, cache_kind)
    if horizontal:
        native.add(cache, C, 'formatCode').text = 'mm/dd'
    native.add(cache, C, 'ptCount', val=len(points))
    for index, value in enumerate(values):
        native.add(native.add(cache, C, 'pt', idx=index), C, 'v').text = str(value)
    vals = native.add(native.add(series, C, 'val'), C, 'numRef')
    native.add(vals, C, 'f').text = f"'{escaped}'!{rate_ref}"
    cache = native.add(vals, C, 'numCache')
    native.add(cache, C, 'formatCode').text = '0.00%'
    native.add(cache, C, 'ptCount', val=len(points))
    for index, point in enumerate(points):
        if point['rate'] is not None:
            native.add(native.add(cache, C, 'pt', idx=index), C, 'v').text = repr(point['rate'])
    native.add(series, C, 'smooth', val='0')
    native.add(line, C, 'axId', val='100')
    native.add(line, C, 'axId', val='200')
    cat_axis = native.add(plot, C, 'dateAx' if horizontal else 'catAx')
    native.add(cat_axis, C, 'axId', val='100')
    native.add(native.add(cat_axis, C, 'scaling'), C, 'orientation', val='minMax')
    native.add(cat_axis, C, 'delete', val='0')
    native.add(cat_axis, C, 'axPos', val='b')
    if horizontal:
        native.add(cat_axis, C, 'numFmt', formatCode='mm/dd', sourceLinked='0')
    native.add(cat_axis, C, 'tickLblPos', val='nextTo')
    axis_text(cat_axis)
    native.add(cat_axis, C, 'crossAx', val='200')
    native.add(cat_axis, C, 'crosses', val='autoZero')
    native.add(cat_axis, C, 'auto', val='0')
    if not horizontal:
        native.add(cat_axis, C, 'lblAlgn', val='ctr')
    native.add(cat_axis, C, 'lblOffset', val='100')
    if horizontal:
        native.add(cat_axis, C, 'baseTimeUnit', val='days')
        native.add(cat_axis, C, 'majorUnit', val='1')
        native.add(cat_axis, C, 'majorTimeUnit', val='days')
    val_axis = native.add(plot, C, 'valAx')
    native.add(val_axis, C, 'axId', val='200')
    scaling = native.add(val_axis, C, 'scaling')
    native.add(scaling, C, 'orientation', val='minMax')
    if axis_max is not None:
        native.add(scaling, C, 'max', val=axis_max)
    native.add(scaling, C, 'min', val='0')
    native.add(val_axis, C, 'delete', val='0')
    native.add(val_axis, C, 'axPos', val='l')
    gridline = native.add(native.add(native.add(val_axis, C, 'majorGridlines'), C, 'spPr'), A, 'ln', w='6350')
    native.add(native.add(gridline, A, 'solidFill'), A, 'srgbClr', val='CCCCCC')
    native.add(gridline, A, 'prstDash', val='sysDot')
    native.add(val_axis, C, 'numFmt', formatCode='0.00%', sourceLinked='0')
    native.add(val_axis, C, 'tickLblPos', val='nextTo')
    axis_text(val_axis)
    native.add(val_axis, C, 'crossAx', val='100')
    native.add(val_axis, C, 'crosses', val='autoZero')
    native.add(val_axis, C, 'crossBetween', val='between')
    if axis_max is not None:
        native.add(val_axis, C, 'majorUnit', val=axis_max / 4)
    native.add(chart, C, 'plotVisOnly', val='0' if horizontal else '1')
    native.add(chart, C, 'dispBlanksAs', val='gap')
    native.add(chart, C, 'showDLblsOverMax', val='0')
    native.add(native.add(root, C, 'spPr'), A, 'noFill')
    return native.xml(root)


def template_prototype(archive, sheet_parts):
    """Read the selected workbook's own native line-chart style, if present."""
    sheet = sheet_parts.get(TEMPLATE_SHEET) or sheet_parts.get(SHEET_NAME)
    if sheet is None:
        return None
    if native.rel_part(sheet) not in archive.namelist():
        return None
    drawing = next((part for kind, part in native.part_links(archive, sheet).values() if kind == 'drawing'), None)
    if drawing is None:
        return None
    for kind, part in native.part_links(archive, drawing).values():
        if kind != 'chart':
            continue
        root = native.read(archive, part)
        plot = root.find(f"{native.tag(C, 'chart')}/{native.tag(C, 'plotArea')}")
        if (plot is not None and plot.find(f"{native.tag(C, 'lineChart')}/{native.tag(C, 'ser')}") is not None
                and plot.find(native.tag(C, 'valAx')) is not None
                and any(plot.find(native.tag(C, axis)) is not None for axis in ('dateAx', 'catAx'))):
            return native.clean(root)
    return None



def template_visual(archive, sheet_parts):
    """Read the reference line's geometry without copying its business values."""
    part = sheet_parts.get(TEMPLATE_SHEET) or sheet_parts.get(SHEET_NAME)
    if part is None:
        return None
    sheet = native.read(archive, part)
    drawing = next((path for kind, path in native.part_links(archive, part).values() if kind == 'drawing'), None)
    if drawing is None:
        return None
    links = native.part_links(archive, drawing)
    rows = {int(row.get('r')): float(row.get('ht')) for row in sheet.findall(
        f"{native.tag(X, 'sheetData')}/{native.tag(X, 'row')}") if row.get('ht')}
    columns = {index: float(col.get('width')) for col in sheet.findall(
        f"{native.tag(X, 'cols')}/{native.tag(X, 'col')}")
        for index in range(int(col.get('min')), int(col.get('max')) + 1)}
    row_format = sheet.find(native.tag(X, 'sheetFormatPr'))
    default_height = float(row_format.get('defaultRowHeight', '15')) if row_format is not None else 15
    default_width = float(row_format.get('defaultColWidth', '8.43')) if row_format is not None else 8.43
    def point(marker):
        col = int(marker.findtext(native.tag(D, 'col')))
        row = int(marker.findtext(native.tag(D, 'row')))
        return (sum(columns.get(index, default_width) for index in range(1, col + 1)) * 6
                + int(marker.findtext(native.tag(D, 'colOff'))) / native.EMU_PER_POINT,
                sum(rows.get(index, default_height) for index in range(1, row + 1))
                + int(marker.findtext(native.tag(D, 'rowOff'))) / native.EMU_PER_POINT)
    for anchor in native.read(archive, drawing):
        link = anchor.find(f".//{native.tag(C, 'chart')}")
        if link is None:
            continue
        chart = native.read(archive, links[link.get(native.tag(R, 'id'))][1])
        if chart.find(f".//{native.tag(C, 'lineChart')}") is None:
            continue
        start = anchor.find(native.tag(D, 'from'))
        end = anchor.find(native.tag(D, 'to'))
        if start is None:
            continue
        left, top = point(start)
        if end is not None:
            right, bottom = point(end)
        else:
            extent = anchor.find(native.tag(D, 'ext'))
            right = left + int(extent.get('cx')) / native.EMU_PER_POINT
            bottom = top + int(extent.get('cy')) / native.EMU_PER_POINT
        data_rows = [int(row.get('r')) for row in sheet.findall(
            f"{native.tag(X, 'sheetData')}/{native.tag(X, 'row')}")
            if any(cell.find(native.tag(X, field)) is not None for cell in row for field in ('v', 'f', 'is'))]
        data_bottom = max(data_rows, default=0)
        table_height = sum(rows.get(index, default_height) for index in range(1, data_bottom + 1))
        if right > left and bottom > top:
            return {'left': left, 'width': right - left, 'height': bottom - top,
                    'gap': max(0, top - table_height), 'rowHeight': rows.get(1, default_height)}
    return None


def reference_drawing(sheet, charts, positions):
    """Use legal cell markers while keeping the reference chart's point geometry."""
    root = ET.fromstring(drawing_xml([(ident, bounds) for ident, _, bounds in charts]))
    rows = {int(row.get('r')): (0 if row.get('hidden') == '1' else float(row.get('ht', '15')))
            for row in sheet.findall(f"{native.tag(X, 'sheetData')}/{native.tag(X, 'row')}")}
    columns = {index: float(col.get('width')) * 6 for col in sheet.findall(
        f"{native.tag(X, 'cols')}/{native.tag(X, 'col')}")
        for index in range(int(col.get('min')), int(col.get('max')) + 1)}
    def marker(node, x, y):
        column, row = 0, 0
        while x >= columns.get(column + 1, 8.43 * 6):
            x -= columns.get(column + 1, 8.43 * 6)
            column += 1
        while y >= rows.get(row + 1, 15):
            y -= rows.get(row + 1, 15)
            row += 1
        for key, value in (('col', column), ('colOff', round(x * native.EMU_PER_POINT)),
                           ('row', row), ('rowOff', round(y * native.EMU_PER_POINT))):
            node.find(native.tag(D, key)).text = str(value)
    for anchor, (left, top, width, height) in zip(root, positions, strict=True):
        marker(anchor.find(native.tag(D, 'from')), left, top)
        marker(anchor.find(native.tag(D, 'to')), left + width, top + height)
    return native.xml(root)

def template_rate_chart_count(report):
    """Number of native chart slots needed to cover every requested date."""
    points, _ = template_data(report)
    return math.ceil(len(points) / TEMPLATE_DAYS_PER_PAGE)


def template_chart_xml(points, sheet, date_row, plot_row, title, *, prototype=None, date1904=False):
    """Bind a native template's line style to the generated formula-backed table."""
    if prototype is None:
        return chart_xml(points, sheet, date_row, title, horizontal=(date_row, plot_row), date1904=date1904)
    root = native.clean(deepcopy(prototype))
    for name in ('externalData', 'userShapes', 'pivotSource'):
        for node in root.findall(native.tag(C, name)):
            root.remove(node)
    date_system = root.find(native.tag(C, 'date1904'))
    if date_system is not None:
        date_system.set('val', '1' if date1904 else '0')
    chart = root.find(native.tag(C, 'chart'))
    plot = chart.find(native.tag(C, 'plotArea'))
    line = plot.find(native.tag(C, 'lineChart'))
    for old in list(plot):
        if old.tag.endswith('Chart') and old is not line:
            plot.remove(old)
    series, *extra = line.findall(native.tag(C, 'ser'))
    for other in extra:
        line.remove(other)
    end_column = get_column_letter(len(points) + 1)
    prefix = "'" + sheet.replace("'", "''") + "'!"
    references = (
        ('tx', False, f'{prefix}$A${date_row + 3}', ['不良率'], None),
        ('cat', True, f'{prefix}$B${date_row}:${end_column}${date_row}',
         [excel_day(point['date'], date1904) for point in points], 'm"月"d"日"'),
        ('val', True, f'{prefix}$B${plot_row}:${end_column}${plot_row}',
         [point['rate'] for point in points], '0.00%'),
    )
    for section, numeric, formula, values, format_code in references:
        old = series.find(native.tag(C, section))
        if old is None:
            raise ValueError('原模板不良率折线缺少日期、数值或系列名称。')
        old.clear()
        reference = native.add(old, C, 'numRef' if numeric else 'strRef')
        native.add(reference, C, 'f').text = formula
        cache = native.add(reference, C, 'numCache' if numeric else 'strCache')
        if format_code:
            native.add(cache, C, 'formatCode').text = format_code
        native.add(cache, C, 'ptCount', val=len(values))
        for index, value in enumerate(values):
            if value is not None:
                native.add(native.add(cache, C, 'pt', idx=index), C, 'v').text = str(value)
    labels = series.find(native.tag(C, 'dLbls'))
    if labels is not None:
        number_format = labels.find(native.tag(C, 'numFmt'))
        if number_format is None:
            number_format = ET.Element(native.tag(C, 'numFmt'))
            labels.insert(0, number_format)
        number_format.set('formatCode', '0.00%')
        number_format.set('sourceLinked', '0')
        visible = labels.find(native.tag(C, 'showVal'))
        if visible is not None:
            visible.set('val', '1')
    # Saved fixed axes would clip a newly entered denominator's result.
    for scaling in plot.findall(f"{native.tag(C, 'valAx')}/{native.tag(C, 'scaling')}"):
        for old in list(scaling):
            if old.tag in {native.tag(C, 'min'), native.tag(C, 'max')}:
                scaling.remove(old)
    for axis in plot.findall(native.tag(C, 'valAx')):
        for name in ('majorUnit', 'minorUnit'):
            old = axis.find(native.tag(C, name))
            if old is not None:
                axis.remove(old)
    for body in plot.findall(f'.//{native.tag(A, "bodyPr")}'):
        # Some reference files carry out-of-range legacy rotations.
        if abs(int(body.get('rot', '0'))) > 5400000:
            body.set('rot', '0')
    for name, value in (('plotVisOnly', '0'), ('dispBlanksAs', 'gap')):
        node = chart.find(native.tag(C, name))
        if node is None:
            node = native.add(chart, C, name)
        node.set('val', value)
    return native.xml(root)


def drawing_xml(charts):
    root = ET.Element(native.tag(D, 'wsDr'))
    for index, (rid, (left, top, right, bottom)) in enumerate(charts, 1):
        anchor = native.add(root, D, 'twoCellAnchor', editAs='oneCell')
        for name, col, row in [('from', left, top), ('to', right, bottom)]:
            marker = native.add(anchor, D, name)
            for key, val in [('col', col), ('colOff', 0), ('row', row), ('rowOff', 0)]:
                native.add(marker, D, key).text = str(val)
        frame = native.add(anchor, D, 'graphicFrame', macro='')
        nv = native.add(frame, D, 'nvGraphicFramePr')
        native.add(nv, D, 'cNvPr', id=index + 1, name=f'不良率趋势 {index}')
        native.add(nv, D, 'cNvGraphicFramePr')
        transform = native.add(frame, D, 'xfrm')
        native.add(transform, A, 'off', x='0', y='0')
        native.add(transform, A, 'ext', cx='0', cy='0')
        graphic = native.add(native.add(frame, A, 'graphic'), A, 'graphicData', uri=C)
        native.add(graphic, C, 'chart', **{native.tag(R, 'id'): rid})
        native.add(anchor, D, 'clientData')
    return native.xml(root)


class RateWorkbook:
    def __init__(self, payload, base_name, *, after=None):
        with ZipFile(BytesIO(payload)) as archive:
            self.parts = {info.filename: archive.read(info.filename) for info in archive.infolist()}
        self.workbook = ET.fromstring(self.parts['xl/workbook.xml'])
        self.book_rels = ET.fromstring(self.parts['xl/_rels/workbook.xml.rels'])
        self.content_types = ET.fromstring(self.parts['[Content_Types].xml'])
        self.sheets = self.workbook.find(native.tag(X, 'sheets'))
        names = [node.get('name') for node in self.sheets]
        used = {name.casefold() for name in names}
        self.name, suffix = base_name, 2
        while self.name.casefold() in used:
            self.name = f'{base_name} ({suffix})'
            suffix += 1
        if after in names:
            self.index = names.index(after) + 1
        elif after == DAILY_PERSONNEL_SHEET:
            self.index = names.index('总表') + 1 if '总表' in names else 0
        else:
            self.index = len(names)
        self.sheet_part = unique_part(self.parts, 'xl/worksheets', 'rateTrend')
        self.drawing_part = unique_part(self.parts, 'xl/drawings', 'rateTrend')

    def serialize(self, sheet, charts, print_area, *, recalculate=False, drawing_override=None):
        """Insert only the new sheet and its relationships, preserving chart and pivot parts."""
        part, drawing = self.sheet_part, self.drawing_part
        sheet_id = max((int(node.get('sheetId', 0)) for node in self.sheets), default=0) + 1
        rids = {node.get('Id') for node in self.book_rels}
        rid_index = 1
        while f'rIdRate{rid_index}' in rids:
            rid_index += 1
        rid = f'rIdRate{rid_index}'
        self.sheets.insert(self.index, ET.Element(native.tag(X, 'sheet'), {
            'name': self.name, 'sheetId': str(sheet_id), native.tag(R, 'id'): rid,
        }))
        native.add(self.book_rels, P, 'Relationship', Id=rid, Type=f'{R}/worksheet',
                   Target=native.rel_target('xl/workbook.xml', part))
        native.add(sheet, X, 'drawing', **{native.tag(R, 'id'): 'rId1'})
        self.parts[part] = native.xml(sheet)
        self.parts[native.rel_part(part)] = native.relationships([(1, 'drawing', native.rel_target(part, drawing))])
        self.parts[drawing] = (drawing_override if drawing_override is not None else
                               drawing_xml([(chart_id, bounds) for chart_id, _, bounds in charts]))
        self.parts[native.rel_part(drawing)] = native.relationships([
            (chart_id, 'chart', native.rel_target(drawing, chart_part)) for chart_id, chart_part, _ in charts
        ])
        defined = self.workbook.find(native.tag(X, 'definedNames'))
        if defined is None:
            defined = ET.Element(native.tag(X, 'definedNames'))
            self.workbook.insert(list(self.workbook).index(self.sheets) + 1, defined)
        for node in defined:
            local_index = node.get('localSheetId')
            if local_index is not None and int(local_index) >= self.index:
                node.set('localSheetId', str(int(local_index) + 1))
        for view in self.workbook.findall(f"{native.tag(X, 'bookViews')}/{native.tag(X, 'workbookView')}"):
            for attribute in ('activeTab', 'firstSheet'):
                old = view.get(attribute)
                if old is not None and int(old) >= self.index:
                    view.set(attribute, str(int(old) + 1))
        escaped = self.name.replace("'", "''")
        native.add(defined, X, 'definedName', name='_xlnm.Print_Area', localSheetId=self.index).text = (
            f"'{escaped}'!{print_area}")
        if recalculate:
            calc = self.workbook.find(native.tag(X, 'calcPr'))
            if calc is None:
                calc = ET.Element(native.tag(X, 'calcPr'), {'calcId': '0'})
                self.workbook.insert(list(self.workbook).index(defined) + 1, calc)
            calc.set('calcMode', 'auto')
            calc.set('fullCalcOnLoad', '1')
        for name, kind in [(part, 'spreadsheetml.worksheet'), (drawing, 'drawing'),
                           *[(name, 'drawingml.chart') for _, name, _ in charts]]:
            native.add(self.content_types, T, 'Override', PartName='/' + name,
                       ContentType=f'application/vnd.openxmlformats-officedocument.{kind}+xml')
        self.parts['xl/workbook.xml'] = native.xml(self.workbook)
        self.parts['xl/_rels/workbook.xml.rels'] = package_xml(self.book_rels, P)
        self.parts['[Content_Types].xml'] = package_xml(self.content_types, T)
        result = BytesIO()
        with ZipFile(result, 'w', ZIP_DEFLATED, compresslevel=4) as archive:
            for name, contents in self.parts.items():
                archive.writestr(name, contents)
        return result.getvalue()


def append_trend(payload, report):
    """Return (new XLSX bytes, summary) while preserving existing workbook parts."""
    points, summary = normalized(report)
    bundle = RateWorkbook(payload, SHEET_NAME)
    parts, name = bundle.parts, bundle.name
    formats = styles(parts)
    sheet = ET.Element(native.tag(X, 'worksheet'))
    native.add(native.add(sheet, X, 'sheetPr'), X, 'pageSetUpPr', fitToPage='1')
    native.add(native.add(sheet, X, 'sheetViews'), X, 'sheetView', workbookViewId='0', showGridLines='0')
    native.add(sheet, X, 'sheetFormatPr', defaultRowHeight='12.5')
    columns = native.add(sheet, X, 'cols')
    for index, width in enumerate([20, 16, 18, 16, 14, 14, 14, 14], 1):
        native.add(columns, X, 'col', min=index, max=index, width=width, customWidth='1')
    data = native.add(sheet, X, 'sheetData')
    merges = []
    chart_parts = []
    chunks = [points[start:start + POINTS_PER_PAGE] for start in range(0, len(points), POINTS_PER_PAGE)]
    max_rate = max((point['rate'] for point in points if point['rate'] is not None), default=0)
    magnitude = 10 ** math.floor(math.log10(max_rate)) if max_rate else 0.01
    axis_max = max(0.01, math.ceil(max_rate * 1.2 / magnitude) * magnitude)
    title = text(report.get('title') or '不良率趋势', 160)
    source_name = text(report.get('sourceName') or '当前不良来源', 200)
    production_name = text(report.get('productionName') or '已绑定产量来源', 200)
    scope = text(report.get('scope') or '使用本次已应用的筛选条件', 400)
    warnings = report.get('warnings', [])
    if not isinstance(warnings, list):
        warnings = [warnings]
    # Full warnings remain in cell text; note rows are deliberately short.
    warning = '；'.join(text(item, 500) for item in warnings[:8])
    for page, chunk in enumerate(chunks):
        offset = page * PAGE_ROWS
        def merged_row(relative, value, style, height=None):
            row = offset + relative
            native.write_row(data, row, [value], [str(style)], str(height) if height else None)
            merges.append(f'A{row}:H{row}')
        merged_row(1, title + (f' · {page + 1}/{len(chunks)}' if len(chunks) > 1 else ''), formats['title'], 23)
        merged_row(2, f"本页：{chunk[0]['start']} 至 {chunk[-1]['end']}　不良来源：{source_name}", formats['text'], 16)
        merged_row(3, f'产量绑定：{production_name}　匹配口径：日期＋工序＋班次', formats['text'], 15)
        overall = (f"完整区间不良率：{summary['overallRate']:.2%}（总不良数量 ÷ 总匹配产量）"
                   if summary['overallRate'] is not None else '完整区间不良率：不可计算；存在缺失或不适用的时间点')
        merged_row(4, overall, formats['heading'], 18)
        merged_row(5, scope, formats['note'], 14)
        header = offset + 23
        native.write_row(data, header, ['日期 / 周期', '不良数量', '匹配产量', '不良率', '统计状态'],
                         [str(formats['heading'])] * 8, '18')
        merges.append(f'E{header}:H{header}')
        for row_number, point in enumerate(chunk, header + 1):
            native.write_row(data, row_number, [point['label'], point['quantity'], point['production'], None,
                                               point['reason'] or '有效'],
                             [str(formats[key]) for key in ('text', 'number', 'number', 'rate', 'text')], '14')
            merges.append(f'E{row_number}:H{row_number}')
            if point['rate'] is not None:
                cell = data[-1].find(f"{native.tag(X, 'c')}[@r='D{row_number}']")
                native.add(cell, X, 'f').text = f'B{row_number}/C{row_number}'
                native.add(cell, X, 'v').text = repr(point['rate'])
        merged_row(39, '空白率值不按零处理；折线断开表示无法计算。每页最多 14 个时间点，便于黑白打印。', formats['note'], 15)
        if warning:
            merged_row(40, warning, formats['note'], 15)
        chart_part = unique_part(parts, 'xl/charts', 'rateTrend')
        parts[chart_part] = chart_xml(chunk, name, header + 1, title, axis_max)
        chart_parts.append((f'rId{page + 1}', chart_part, (0, offset + 5, 8, offset + 21)))
    merge_node = native.add(sheet, X, 'mergeCells', count=len(merges))
    for ref in merges:
        native.add(merge_node, X, 'mergeCell', ref=ref)
    native.add(sheet, X, 'printOptions', horizontalCentered='1')
    native.add(sheet, X, 'pageMargins', left='0.25', right='0.25', top='0.25', bottom='0.25', header='0.1', footer='0.1')
    native.add(sheet, X, 'pageSetup', paperSize='9', orientation='landscape', fitToWidth='1', fitToHeight='0', blackAndWhite='1')
    footer = native.add(sheet, X, 'headerFooter')
    native.add(footer, X, 'oddFooter').text = '&C第 &P 页 / 共 &N 页'
    if len(chunks) > 1:
        breaks = native.add(sheet, X, 'rowBreaks', count=len(chunks) - 1, manualBreakCount=len(chunks) - 1)
        for page in range(1, len(chunks)):
            native.add(breaks, X, 'brk', id=page * PAGE_ROWS, min='0', max='16383', man='1')
    result = bundle.serialize(sheet, chart_parts, f'$A$1:$H${len(chunks) * PAGE_ROWS}')
    return result, {**summary, 'sheet': name, 'pages': len(chunks)}


def excel_day(day, date1904):
    if date1904:
        return (day - date(1904, 1, 1)).days
    # Excel's 1900 date system includes a fictitious 1900-02-29.
    return (day - date(1899, 12, 31)).days + int(day >= date(1900, 3, 1))


def template_data(report):
    if not isinstance(report, dict):
        raise ValueError('不良率表配置无效。')
    raw_days, raw_rules = report.get('days'), report.get('rules', [])
    if not isinstance(raw_rules, (list, tuple)) or len(raw_rules) > 200:
        raise ValueError('不良率表最多支持 200 个不良项目。')
    rules = {}
    for rule in raw_rules:
        if not isinstance(rule, dict):
            raise ValueError('不良率表项目格式无效。')
        label, keywords = rule.get('label'), rule.get('keywords', [])
        if (not isinstance(label, str) or not label.strip() or len(label) > 160
                or not isinstance(keywords, (list, tuple)) or len(keywords) > 64
                or any(not isinstance(k, str) or not k.strip() or len(k) > 512 for k in keywords)):
            raise ValueError('不良率表项目与关键字格式无效。')
        if label not in rules:
            rules[label] = []
        if keywords:
            group = tuple(dict.fromkeys(keywords))
            if group not in rules[label]:
                rules[label].append(group)
    if not isinstance(raw_days, list) or not 1 <= len(raw_days) <= MAX_POINTS:
        raise ValueError(f'不良率表需要 1 至 {MAX_POINTS} 个业务日期。')
    points = []
    seen = set()
    for item in raw_days:
        if not isinstance(item, dict):
            raise ValueError('不良率表的单日数据格式无效。')
        value = item.get('date')
        try:
            day = date.fromisoformat(value)
        except (TypeError, ValueError) as exc:
            raise ValueError('不良率表需要 YYYY-MM-DD 格式的有效日期。') from exc
        if value != day.isoformat() or day < date(1900, 1, 1) or day in seen:
            raise ValueError('不良率表包含无效或重复的业务日期。')
        seen.add(day)
        quantity = number(item.get('quantity'), '不良数')
        production = number(item.get('production'), '产量')
        counts = item.get('rates', {})
        if not isinstance(counts, dict) or any(key not in rules for key in counts):
            raise ValueError('不良率表的不良项目与项目配置不一致。')
        counts = {label: number(count, '项目不良数量') for label, count in counts.items()}
        rate = quantity / production if production and quantity is not None and quantity <= production else None
        points.append({'date': day, 'quantity': quantity, 'production': production, 'rate': rate,
                       'counts': counts})
    points.sort(key=lambda point: point['date'])
    return points, rules


def formula_cell(row, column, formula, cached, *, error=False):
    cell = row.find(f"{native.tag(X, 'c')}[@r='{column}{row.get('r')}']")
    native.add(cell, X, 'f').text = formula
    if cached is not None:
        native.add(cell, X, 'v').text = str(cached)
    elif error:
        cell.set('t', 'e')
        native.add(cell, X, 'v').text = '#N/A'
    else:
        cell.set('t', 'str')
        native.add(cell, X, 'v')


def template_formula(rate_ref, quantity_ref, production_ref):
    guard = (f'AND(ISNUMBER({quantity_ref}),ISNUMBER({production_ref}),'
             f'{quantity_ref}>=0,{production_ref}>0,{quantity_ref}<={production_ref})')
    return f'IF({guard},{quantity_ref}/{production_ref},"")', f'IF(ISNUMBER({rate_ref}),{rate_ref},NA())'


def append_template_rate(payload, report, *, prototype=None, overview_slots=(), reference_visual=None):
    """Insert the horizontal daily worksheet used by the reference workbook."""
    points, rules = template_data(report)
    if overview_slots and len(overview_slots) != math.ceil(len(points) / TEMPLATE_DAYS_PER_PAGE):
        raise ValueError('总表不良率图槽数量与业务日期范围不一致。')
    if len(set(overview_slots)) != len(overview_slots):
        raise ValueError('总表不良率图槽不能重复。')
    bundle = RateWorkbook(payload, TEMPLATE_SHEET, after=DAILY_PERSONNEL_SHEET)
    if any(not isinstance(slot, str) or not slot.startswith('xl/charts/') or
           not slot.endswith('.xml') or slot not in bundle.parts for slot in overview_slots):
        raise ValueError('总表不良率图槽尚未创建。')
    date_system = bundle.workbook.find(native.tag(X, 'workbookPr'))
    date1904 = date_system is not None and date_system.get('date1904') in ('1', 'true')
    if date1904 and points[0]['date'] < date(1904, 1, 1):
        raise ValueError('不良率日期早于模板所使用的 1904 日期系统。')
    formats = {key: str(value) for key, value in styles(bundle.parts, template=True).items()}
    sheet = ET.Element(native.tag(X, 'worksheet'))
    native.add(native.add(sheet, X, 'sheetPr'), X, 'pageSetUpPr', fitToPage='1')
    view = native.add(native.add(sheet, X, 'sheetViews'), X, 'sheetView', workbookViewId='0', showGridLines='0')
    native.add(view, X, 'pane', xSplit='1', topLeftCell='B1', activePane='topRight', state='frozen')
    native.add(sheet, X, 'sheetFormatPr', defaultRowHeight='15')
    cols = native.add(sheet, X, 'cols')
    label_width, day_width = 30, 13
    native.add(cols, X, 'col', min=1, max=1, width=label_width, customWidth='1')
    native.add(cols, X, 'col', min=2, max=TEMPLATE_DAYS_PER_PAGE + 1, width=day_width, customWidth='1')
    data = native.add(sheet, X, 'sheetData')
    merges, charts, page_breaks, positions = [], [], [], []
    chunks = [points[start:start + TEMPLATE_DAYS_PER_PAGE]
              for start in range(0, len(points), TEMPLATE_DAYS_PER_PAGE)]
    row = 1
    table_row_height = float(reference_visual['rowHeight']) if reference_visual else 17
    chart_height = float(reference_visual['height']) if reference_visual else TEMPLATE_CHART_HEIGHT
    # Readable chart and note widths even when only one date is selected.
    last_column = max(6, min(len(points), TEMPLATE_DAYS_PER_PAGE) + 1)
    width = ((label_width * 8 + 5) + (last_column - 1) * (day_width * 8 + 5)) * .75
    reference_plot_width = max(reference_visual['width'], width) if reference_visual else width
    if reference_visual:
        plot_right = reference_visual['left'] + (reference_visual['width'] if len(points) == 1 else reference_plot_width)
        while width < plot_right:
            last_column += 1
            width += (day_width * 8 + 5) * .75
    end_column = get_column_letter(last_column)
    print_scale = min(1, TEMPLATE_PRINT_WIDTH / width)
    rows_per_page = math.floor(TEMPLATE_PRINT_HEIGHT / print_scale)

    def values_row(number, title, values, label_style, value_style, height='17'):
        if reference_visual:
            height = str(table_row_height)
        native.write_row(data, number, [title, *values],
                         [formats[label_style], *[formats[value_style]] * len(values)], height)

    def note_row(number, label, detail, style='note', height='17'):
        values_row(number, label, [detail], 'heading' if style == 'heading' else 'text', style, height)
        merges.append(f'B{number}:{end_column}{number}')

    def print_break():
        if row > 1 and (not page_breaks or page_breaks[-1] != row - 1):
            page_breaks.append(row - 1)

    for page, chunk in enumerate(chunks, 1):
        if page > 1:
            print_break()
        date_row = row
        dates = [excel_day(point['date'], date1904) for point in chunk]
        values_row(row, '日期', dates, 'heading', 'date', '20')
        values_row(row + 1, '产量', [point['production'] for point in chunk], 'text', 'input')
        values_row(row + 2, '不良数', [point['quantity'] for point in chunk], 'text', 'input')
        values_row(row + 3, '不良率', [None] * len(chunk), 'heading', 'key_rate', '20')
        rate_row = data[-1]
        block_height = 4 * table_row_height if reference_visual else 74
        section = row + 4
        for label in rules:
            if block_height + table_row_height + 17 + chart_height > rows_per_page:
                row = section
                print_break()
                values_row(section, '日期', dates, 'heading', 'date', '20')
                section += 1
                block_height = 20
            values_row(section, label, [point['counts'].get(label) for point in chunk], 'text', 'number')
            section += 1
            block_height += table_row_height
        if not reference_visual:
            note_row(section, '填写说明', '浅蓝色单元格可填写或更正。产量大于零且不良数有效时计算不良率。')
        helper_row = section if reference_visual else section + 1
        values_row(helper_row, '趋势辅助值', [None] * len(chunk), 'text', 'rate')
        helper = data[-1]
        helper.set('hidden', '1')
        for index, point in enumerate(chunk, 2):
            col = get_column_letter(index)
            normal, plot = template_formula(f'{col}{date_row + 3}', f'{col}{date_row + 2}', f'{col}{date_row + 1}')
            formula_cell(rate_row, col, normal, point['rate'])
            formula_cell(helper, col, plot, point['rate'], error=True)
        title = '每日不良率' + (f'（{page}/{len(chunks)}）' if len(chunks) > 1 else '')
        chart_part = unique_part(bundle.parts, 'xl/charts', 'rateTrend')
        bundle.parts[chart_part] = template_chart_xml(
            chunk, bundle.name, date_row, helper_row, title, prototype=prototype, date1904=date1904)
        if overview_slots:
            # The total drawing owns these reserved independent chart parts.
            # Identical table bindings keep both native views editable together.
            bundle.parts[overview_slots[page - 1]] = bundle.parts[chart_part]
        bottom = helper_row + math.ceil(chart_height / 15)
        if reference_visual:
            visible = {int(node.get('r')): (0 if node.get('hidden') == '1' else float(node.get('ht', '15')))
                       for node in data}
            top = sum(visible.get(index, 15) for index in range(1, helper_row))
            top += reference_visual['gap']
            plot_width = reference_visual['width'] if len(chunk) == 1 else reference_plot_width
            positions.append((reference_visual['left'], top, plot_width, chart_height))
            reserved_rows = math.ceil((reference_visual['gap'] + chart_height + 15) / 15)
            bottom = helper_row + reserved_rows
            for blank in range(helper_row + 1, bottom + 1):
                native.add(data, X, 'row', r=blank, ht='15', customHeight='1')
        charts.append((f'rId{page}', chart_part, (0, helper_row, last_column, bottom)))
        row = bottom + 1
        if reference_visual:
            note_row(row, '填写说明', '浅蓝色单元格可填写或更正。产量大于零且不良数有效时计算不良率。')
            row += 1

    if rules:
        rule_note = '同组关键词需同时命中，不同组满足任一即可。修改规则后，请从工作台重新导出。'
        note_width = max(20, int((last_column - 1) * day_width * .52))
        if block_height + 17 + chart_height + 40 > rows_per_page:
            print_break()
            block_height = 0
        else:
            block_height += 17 + chart_height
        note_row(row, '项目关键字', rule_note, 'heading', '31')
        block_height += 31
        row += 1
        for label, groups in rules.items():
            detail = ' ／ '.join(' ＋ '.join(group) for group in groups) if groups else '—'
            height = min(405, 17 * max(1, math.ceil(len(detail) / note_width)))
            if block_height + height > rows_per_page:
                print_break()
                note_row(row, '项目关键字', rule_note, 'heading', '31')
                block_height = 31
                row += 1
            note_row(row, label, detail, 'keywords', str(height))
            block_height += height
            row += 1
        row -= 1

    merge_node = native.add(sheet, X, 'mergeCells', count=len(merges))
    for ref in merges:
        native.add(merge_node, X, 'mergeCell', ref=ref)
    native.add(sheet, X, 'printOptions', horizontalCentered='1')
    native.add(sheet, X, 'pageMargins', left='0.25', right='0.25', top='0.3', bottom='0.3',
               header='0.1', footer='0.1')
    native.add(sheet, X, 'pageSetup', paperSize='9', orientation='landscape', fitToWidth='1',
               fitToHeight='0', blackAndWhite='1')
    if page_breaks:
        if len(page_breaks) > 1026:
            raise ValueError('不良率表超过 Excel 打印分页上限，请缩小日期范围。')
        breaks = native.add(sheet, X, 'rowBreaks', count=len(page_breaks), manualBreakCount=len(page_breaks))
        for ident in page_breaks:
            native.add(breaks, X, 'brk', id=ident, min='0', max='16383', man='1')
    drawing_override = reference_drawing(sheet, charts, positions) if reference_visual else None
    payload = bundle.serialize(sheet, charts, f'$A$1:${end_column}${row}', recalculate=True,
                               drawing_override=drawing_override)
    good = sum(point['rate'] is not None for point in points)
    complete = good == len(points)
    quantity = sum(point['quantity'] or 0 for point in points)
    production = sum(point['production'] or 0 for point in points)
    return payload, {
        'sheet': bundle.name, 'sheetIndex': bundle.index, 'pages': len(page_breaks) + 1,
        'points': len(points), 'validPoints': good, 'complete': complete,
        'overallRate': quantity / production if complete else None,
        'quantity': quantity if any(point['quantity'] is not None for point in points) else None,
        'production': production if any(point['production'] is not None for point in points) else None,
    }
