"""Validate the localized reason report using the local NC style template."""

from collections import Counter, defaultdict
from hashlib import sha256
import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
from zipfile import ZipFile

import openpyxl
from openpyxl.utils.cell import range_boundaries, range_to_tuple

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'desktop'))
from lab_engine import original_report as report, reason_column_report


NS = {'a': report.A, 'c': report.C, 'x': report.X, 'xdr': report.D}
REASONS = {
    '物料少穿-多穿': ('CN_物料少穿/多穿',),
    '并纤反': ('CN_MMC_并纤反', 'CN_MPO_并纤反'),
    '装管反': ('CN_LCD-装管反', 'CN_MPO_装管反'),
    'PIN孔堵': ('CN_MMC__PIN孔堵', 'CN_MPO__PIN孔堵'),
    '纤缩': ('CN_LCD_纤缩', 'CN_MMC_纤缩'),
    '无纤': ('CN_LCD_无纤', 'CN_MPO_无纤'),
}


def chart_parts(archive, sheet_part):
    drawing_part = report.one_part(report.part_links(archive, sheet_part), 'drawing', sheet_part)
    drawing = report.read(archive, drawing_part)
    links = report.part_links(archive, drawing_part)
    for anchor in drawing:
        reference = anchor.find('.//c:chart', NS)
        if reference is not None:
            yield anchor, report.read(archive, links[reference.get(report.tag(report.R, 'id'))][1])


def axis_details(chart):
    category = chart.find('.//c:catAx', NS)
    body = category.find('c:txPr/a:bodyPr', NS)
    return (chart.find('.//c:barChart/c:barDir', NS).get('val'),
            category.find('c:axPos', NS).get('val'),
            body.get('vert'), body.get('rot', '0'),
            category.find('c:tickLblSkip', NS).get('val'))


def chart_labels(chart):
    series = chart.find('.//c:barChart/c:ser', NS)
    if series is None:
        return ()
    return tuple(label.text for label in series.findall('c:cat/c:strRef/c:strCache/c:pt/c:v', NS))


def chart_rectangle(anchor, sheet):
    columns = sheet.find('x:cols', NS)
    rows = sheet.find('x:sheetData', NS)
    row_heights = {int(row.get('r')): float(row.get('ht')) for row in rows if row.get('ht')}
    width = float(sheet.find('x:sheetFormatPr', NS).get('defaultColWidth', '8.43'))
    height = float(sheet.find('x:sheetFormatPr', NS).get('defaultRowHeight', '15'))

    def marker_xy(marker):
        col = int(marker.findtext('xdr:col', namespaces=NS))
        row = int(marker.findtext('xdr:row', namespaces=NS))
        column_widths = [width] * col
        for spec in columns:
            for pos in range(int(spec.get('min')) - 1, min(col, int(spec.get('max')))):
                column_widths[pos] = float(spec.get('width'))
        x = sum(round(item * report.TEMPLATE_DIGIT_WIDTH) for item in column_widths) * report.EMU_PER_PIXEL
        y = sum(row_heights.get(pos, height) for pos in range(1, row + 1)) * report.EMU_PER_POINT
        return (x + int(marker.findtext('xdr:colOff', namespaces=NS)),
                y + int(marker.findtext('xdr:rowOff', namespaces=NS)))

    x, y = marker_xy(anchor.find('xdr:from', NS))
    extent = anchor.find('xdr:ext', NS)
    if extent is None:
        end_x, end_y = marker_xy(anchor.find('xdr:to', NS))
    else:
        end_x, end_y = x + int(extent.get('cx')), y + int(extent.get('cy'))
    return x, y, end_x, end_y


class RectanglePageCapacityTests(unittest.TestCase):
    def test_native_print_row_compression_keeps_two_rows_separate(self):
        width = reason_column_report.OVERVIEW_CHART_WIDTH
        for number, header in ((12, 0), (8, 30), (5, 0)):
            with self.subTest(charts=number, title_height=header):
                order, layout = reason_column_report.total_overview_placement([(width, 276)] * number,
                                                                             header_height=header)
                self.assertEqual(sorted(order), list(range(number)))
                self.assertEqual(len(layout.placements), number)
                self.check_layout_print_bounds(layout)
                if number % 2:
                    self.assertEqual(sum(1 for row in layout.placements if row[1] == 1), number // 2)

    def check_layout_print_bounds(self, layout):
        boundaries = [0, *layout.breaks, layout.row_span]
        rows = defaultdict(list)
        offsets = layout.row_offsets or (0,) * len(layout.placements)
        for (row, column, width, height), offset in zip(layout.placements, offsets, strict=True):
            top = row * 15 + offset
            rows[top].append((layout.column_offsets[column], width, height))
        self.assertTrue(rows)
        horizontal = []
        for panels in rows.values():
            panels.sort()
            if len(panels) == 2:
                left, right = panels
                horizontal.append((right[0] - left[0] - left[1]) * layout.print_scale / 100)
        if horizontal:
            self.assertGreaterEqual(min(horizontal), 3 * 72 / 25.4)
            self.assertLessEqual(max(horizontal), 7 * 72 / 25.4)
        for native_height in (12.5, 13.08, 15):
            for first, last in zip(boundaries, boundaries[1:]):
                panels = []
                for (row, column, width, height), offset in zip(layout.placements, offsets, strict=True):
                    if not first <= row < last:
                        continue
                    top = (row - first) * 15 + offset
                    bottom = top + height
                    self.assertLessEqual(bottom, (last - first) * 15)
                    self.assertLessEqual(bottom * layout.print_scale / 100, reason_column_report.PRINT_HEIGHT_PT)
                    top, bottom = top * native_height / 15, bottom * native_height / 15
                    for previous_column, previous_top, previous_bottom in panels:
                        if previous_column == column:
                            self.assertLess(previous_bottom, top)
                            if native_height == 13.08:
                                gap = (top - previous_bottom) * layout.print_scale / 100
                                self.assertGreaterEqual(gap, 3 * 72 / 25.4)
                                self.assertLessEqual(gap, 7 * 72 / 25.4)
                    panels.append((column, top, bottom))

    def test_whole_row_wide_charts_keep_outer_edges_aligned(self):
        width = reason_column_report.OVERVIEW_CHART_WIDTH
        sizes = [(width, 250), (width * 3, 300), (width, 220),
                 (width * 4, 400), (width, 280)]
        order, layout = reason_column_report.total_overview_placement(sizes)
        self.assertEqual(order, [0, 2, 1, 3, 4])
        self.assertEqual(sorted(order), list(range(len(sizes))))
        self.assertEqual(len(layout.placements), len(sizes))
        rows = defaultdict(list)
        for index, (row, column, span, height) in zip(order, layout.placements, strict=True):
            left = layout.column_offsets[column]
            rows[row].append((index, left, left + span))
            self.assertEqual(height, max(height for _, height in sizes))
        self.assertEqual(sorted(len(entries) for entries in rows.values()), [1, 1, 1, 2])
        edges = []
        for entries in rows.values():
            entries.sort(key=lambda item: item[1])
            edges.append((entries[0][1], entries[-1][2]))
            if len(entries) == 2:
                self.assertEqual(entries[0][2] - entries[0][1], entries[1][2] - entries[1][1])
                self.assertGreaterEqual(entries[1][1] - entries[0][2], reason_column_report.REPORT_GAP)
        self.assertEqual(len(set(edges)), 1)
        for wide in (1, 3):
            self.assertTrue(any(len(entries) == 1 and entries[0][0] == wide for entries in rows.values()))
        self.assertTrue(any(len(entries) == 1 and entries[0][0] == 4 for entries in rows.values()))
        self.check_layout_print_bounds(layout)

@unittest.skipUnless(os.environ.get('BK_ORIGINAL_TEMPLATE'), 'Local NC template not supplied')
class ReasonColumnReportTests(unittest.TestCase):
    def test_original_template_accepts_explicit_reason_groups_without_changing_original_layout(self):
        template = Path(os.environ['BK_ORIGINAL_TEMPLATE'])
        source = {'columns': [{'id': title, 'label': title} for title in report.HEADERS]}
        codes = REASONS['并纤反']
        rows = [{'values': {'容器号': f'测试-{idx}', '数量': 1, '责任人': f'员工{idx}', '判定原因': code}}
                for idx, code in enumerate(codes)]
        with TemporaryDirectory(dir=os.environ.get('PLATFORM_TEST_ROOT')) as root:
            base = Path(root)
            separate = report.export(template, base / '独立.xlsx', source, rows, chart_layout='reason-columns')
            self.assertEqual(len(separate['groups']), 2)
            grouped = report.export(template, base / '合并.xlsx', source, rows,
                                    chart_layout='reason-columns', reason_groups=[{'name': '并反', 'reasons': codes}])
            self.assertEqual(grouped['groups'], {'并反': 2})
            book = openpyxl.load_workbook(base / '合并.xlsx')
            try:
                chart, = book['并反']._charts
                self.assertEqual([series.tx.strRef.strCache.pt[0].v for series in chart.series], list(codes))
            finally:
                book.close()


@unittest.skipUnless(os.environ.get('BK_ANALYZED_TEMPLATE'), 'Local analysis workbook not supplied')
class ReferenceReasonColumnReportTests(unittest.TestCase):
    def test_swapping_selected_reasons_rebuilds_charts_and_preserves_print_bounds(self):
        template = Path(os.environ['BK_ANALYZED_TEMPLATE'])
        original_hash = sha256(template.read_bytes()).hexdigest()
        self.assertTrue(report.inspect_template(template)['layoutOnly'])
        self.addCleanup(lambda: self.assertEqual(sha256(template.read_bytes()).hexdigest(), original_hash))
        selections = (
            (
                ('并反', ('CN_MMC_并纤反', 'CN_MPO_并纤反'), 50),
                ('PIN堵', ('CN_MMC__PIN孔堵', 'CN_MPO__PIN孔堵'), 6),
                ('物料少穿-多穿', ('CN_物料少穿/多穿',), 8),
            ),
            (
                ('新增测试原因甲', ('CN_MPO_新增测试原因甲',), 78),
                ('甲乙组合', ('CN_LCD_新增测试原因乙', 'CN_MMC_新增测试原因乙',
                              'CN_MPO_其他判定', *[f'CN_测试原因{x}' for x in range(6)]), 11),
            ),
        )
        source = {'columns': [{'id': title, 'label': title} for title in report.HEADERS]}
        for index, selection in enumerate(selections):
            with self.subTest(selection=index), TemporaryDirectory(dir=os.environ.get('PLATFORM_TEST_ROOT')) as root:
                output = Path(root) / '按样表.xlsx'
                records, detail, expected = self.make_records(selection, index)
                groups = [{'name': name, 'reasons': codes} for name, codes, _ in selection if len(codes) > 1]
                groups.append({'name': '无命中的组合', 'reasons': ['CN_未选择']})
                result = report.export(template, output, source, records, chart_layout='reason-columns',
                                       reason_groups=groups)
                self.assertEqual(result['groups'], {name: len(rows) for name, rows in detail.items()})
                self.assertEqual(result['recordCount'], len(records))
                self.assertEqual(result['uncategorized'], 0)
                self.check_reference_book(output, detail, expected, result)

    def test_total_includes_each_rate_date_block_without_counting_lines_as_reason_groups(self):
        from datetime import date, timedelta
        from lab_engine import rate_report
        template = Path(os.environ['BK_ANALYZED_TEMPLATE'])
        source = {'columns': [{'id': title, 'label': title} for title in report.HEADERS]}
        codes = ('CN_MMC_装管反', 'CN_MPO_装管反')
        records = [{'values': {'容器号': f'样例-{index}', '数量': 1,
                              '责任人': f'合成姓名{index}', '判定原因': codes[index % 2]}}
                   for index in range(35)]
        groups = [{'name': '装管组', 'reasons': list(codes)}]
        days = [{'date': (date(2026, 11, 1) + timedelta(days=index)).isoformat(),
                 'quantity': index + 1, 'production': 1000, 'rates': {'合成项目': index + 1}}
                for index in range(rate_report.TEMPLATE_DAYS_PER_PAGE + 1)]
        rates = {'days': days, 'rules': [{'label': '合成项目', 'keywords': ['装管反']}]}
        with TemporaryDirectory(dir=os.environ.get('PLATFORM_TEST_ROOT')) as root:
            output = Path(root) / '总表与不良率.xlsx'
            result = report.export(template, output, source, records, chart_layout='reason-columns',
                                   reason_groups=groups, template_rate=rates)
            self.assertEqual(result['overviewChartCount'], len(groups))
            with ZipFile(output) as archive:
                parts = report.template_sheet_parts(archive)
                overview = list(chart_parts(archive, parts['总表']))
                bars = [(anchor, chart) for anchor, chart in overview
                        if chart.find('.//c:barChart', NS) is not None]
                lines = [(anchor, chart) for anchor, chart in overview
                         if chart.find('.//c:lineChart', NS) is not None]
                self.assertEqual(len(bars), len(groups))
                self.assertEqual(len(lines), 2)
                source_lines = [chart for _, chart in chart_parts(archive, parts['不良率'])
                                if chart.find('.//c:lineChart', NS) is not None]
                self.assertEqual(Counter(report.xml(chart) for _, chart in lines),
                                 Counter(report.xml(chart) for chart in source_lines))
                point_counts = []
                for _, chart in lines:
                    point_counts.append(int(chart.find('.//c:lineChart/c:ser/c:val/c:numRef/c:numCache/c:ptCount', NS).get('val')))
                    self.assertTrue(any(value.get('val') == '1' for value in chart.findall('.//c:showVal', NS)))
                    self.assertEqual(chart.find('.//c:lineChart/c:ser/c:marker/c:symbol', NS).get('val'), 'circle')
                self.assertEqual(sorted(point_counts), [1, rate_report.TEMPLATE_DAYS_PER_PAGE])
                expected = {'装管组': Counter((row['values']['责任人'], row['values']['判定原因']) for row in records)}
                self.check_one_complete_chart_per_group(archive, parts['总表'], expected)
                raw = report.read(archive, parts['总表'])
                workbook_xml = report.read(archive, 'xl/workbook.xml')
                all_sheets = list(parts)
                area = next(node.text for node in workbook_xml.findall('x:definedNames/x:definedName', NS)
                            if node.get('name') == '_xlnm.Print_Area'
                            and int(node.get('localSheetId')) == all_sheets.index('总表'))
                _, (_, first, last_col, last) = range_to_tuple(area)
                rows = [first - 1, *[int(node.get('id')) for node in raw.findall('x:rowBreaks/x:brk', NS)], last]
                self.assertEqual(result['totalChartPages'], len(rows) - 1)
                widths = {col: float(node.get('width')) for node in raw.findall('x:cols/x:col', NS)
                          for col in range(int(node.get('min')), int(node.get('max')) + 1)}
                setup = raw.find('x:pageSetup', NS)
                self.assertEqual((setup.get('paperSize'), setup.get('orientation')), ('9', 'landscape'))
                self.check_compressed_print_geometry(raw, overview, rows, widths, last_col, setup)

    def test_similar_labels_stay_separate_until_explicitly_grouped(self):
        template = Path(os.environ['BK_ANALYZED_TEMPLATE'])
        source = {'columns': [{'id': title, 'label': title} for title in report.HEADERS]}
        codes = ('CN_LCD_装管反', 'CN_MPO_装管反', 'CN_纤缩')
        rows = [{'values': {'容器号': f'班次-{i}', '数量': 1, '责任人': f'员工{i}', '判定原因': code}}
                for i, code in enumerate(codes)]
        rows[2]['values']['判定原因'] = ' ' + codes[2] + ' '
        with TemporaryDirectory(dir=os.environ.get('PLATFORM_TEST_ROOT')) as root:
            base = Path(root)
            separate = report.export(template, base / '独立.xlsx', source, rows, chart_layout='reason-columns')
            combined = report.export(template, base / '合并.xlsx', source, [rows[0], rows[2]],
                                     chart_layout='reason-columns',
                                     reason_groups=[{'name': '自选组合', 'reasons': list(codes)}])
            self.assertEqual(len(separate['groups']), 3)
            self.assertIn('装管反（2）', separate['groups'])
            self.assertEqual(combined['groups'], {'自选组合': 2})
            book = openpyxl.load_workbook(base / '合并.xlsx')
            self.addCleanup(book.close)
            series = book['自选组合']._charts[0].series
            self.assertEqual([item.tx.strRef.strCache.pt[0].v for item in series], [codes[0], codes[2]])
            self.assertEqual(book['自选组合'].cell(3, report.REASON + 1).value, rows[2]['values']['判定原因'])

    def test_selected_reasons_create_only_requested_tabs_and_native_pivots(self):
        template = Path(os.environ['BK_ANALYZED_TEMPLATE'])
        source = {'columns': [{'id': title, 'label': title} for title in report.HEADERS]}
        selection = (('自定义装管', ('CN_MPO_未见异常甲', 'CN_MMC_未见异常乙'), 53),
                     ('另一类', ('CN_另一类',), 4), ('保留在总表', ('CN_保留在总表',), 6))
        records, detail, _ = self.make_records(selection, 0)
        selected = [*selection[0][1], *selection[1][1]]
        with TemporaryDirectory(dir=os.environ.get('PLATFORM_TEST_ROOT')) as root:
            output = Path(root) / '勾选判定原因.xlsx'
            response = report.export(template, output, source, records, chart_layout='reason-columns',
                                     reason_groups=[{'name': '自定义装管', 'reasons': selection[0][1]}],
                                     sheet_reasons=selected)
            self.assertEqual(response['groups'], {name: len(detail[name]) for name, *_ in selection[:2]})
            self.assertEqual(response['recordCount'], len(records))
            book = openpyxl.load_workbook(output)
            try:
                for name, codes, owners in selection[:2]:
                    sheet = book[name]
                    self.assertEqual(len(sheet._charts), 1)
                    chart = sheet._charts[0]
                    self.assertEqual(len(chart.series), len(codes))
                    self.assertEqual(chart.series[0].cat.strRef.strCache.ptCount, owners)
                    self.assertEqual(len(sheet._pivots), 1)
                    pivot = sheet._pivots[0]
                    self.assertEqual(pivot.cache.cacheSource.worksheetSource.sheet, name)
                    self.assertEqual(pivot.cache.recordCount, len(detail[name]))
                self.assertNotIn('保留在总表', book.sheetnames)
                self.assertNotIn('责任人图表', book.sheetnames)
                self.assertEqual(len(book['总表']._charts), 2)
            finally:
                book.close()

    def make_records(self, selection, variant):
        detail = {}
        expected = {}
        records = []
        for group_index, (group, codes, owner_count) in enumerate(selection):
            group_detail = detail[group] = set()
            groups = expected[group] = Counter()
            for index in range(owner_count):
                # Every code is represented in an early chart and shared names
                # exercise counts across multiple series.
                owner = f'合成姓名{variant}组{group_index}-{index:02d}'
                for code_index, code in enumerate(codes):
                    for repeat in range(code_index + (index % 4) + 1):
                        container = f'合成{variant}-{group_index}-{index}-{code_index}-{repeat}'
                        values = {'容器号': container, '数量': 1, '责任人': owner, '判定原因': code}
                        records.append({'values': values})
                        group_detail.add((container, owner, code))
                        groups[owner, code] += 1
        return records, detail, expected

    def check_reference_book(self, output, detail, expected, result):
        with ZipFile(output) as archive:
            self.assertIsNone(archive.testzip())
            workbook = report.read(archive, 'xl/workbook.xml')
            links = report.part_links(archive, 'xl/workbook.xml')
            sheets = {sheet.get('name'): links[sheet.get(report.tag(report.R, 'id'))][1]
                      for sheet in workbook.findall('x:sheets/x:sheet', NS)}
            self.assertEqual(set(sheets) - {'责任人图表'}, {'总表', *detail})
            print_areas = {int(area.get('localSheetId')): range_to_tuple(area.text)
                           for area in workbook.findall('x:definedNames/x:definedName', NS)
                           if area.get('name') == '_xlnm.Print_Area'}
            self.check_one_complete_chart_per_group(archive, sheets['总表'], expected)
            if '责任人图表' in sheets:
                self.check_one_complete_chart_per_group(archive, sheets['责任人图表'], expected)
            self.assertEqual(result['overviewChartCount'], len(detail))
            categories = {}
            for sheet_id, name in enumerate(sheets):
                if name == '责任人图表':
                    continue
                self.assertEqual(print_areas[sheet_id][0], name)
                chart_data, rectangles = self.check_reference_geometry(
                    archive, sheets[name], print_areas[sheet_id][1], overview=name == '总表')
                if name == '总表':
                    overview = chart_data
                    overview_count = len(rectangles)
                    total_sheet = report.read(archive, sheets[name])
                    page_count = 1 + len(total_sheet.findall('x:rowBreaks/x:brk', NS))
                    continue
                self.check_one_complete_chart_per_group(archive, sheets[name], {name: expected[name]})
                categories.update(chart_data)
                self.assertEqual(set(chart_data), {name})
                self.assertEqual(len(rectangles), 1)
            self.assertEqual(overview_count, result['overviewChartCount'])
            self.assertEqual(result['totalChartPages'], page_count)
            self.assertEqual(overview, expected)
            self.assertEqual(categories, expected)
        with output.open('rb') as stream:
            book = openpyxl.load_workbook(stream, data_only=True)
            try:
                self.check_reference_details(book['总表'], set().union(*detail.values()))
                for sheet in book:
                    for chart in sheet._charts:
                        for item in chart.series:
                            target, (col, start, _, end) = range_to_tuple(item.cat.strRef.f)
                            self.assertEqual([point.v for point in item.cat.strRef.strCache.pt],
                                             [book[target].cell(row, col).value for row in range(start, end + 1)])
                            target, (col, start, _, end) = range_to_tuple(item.val.numRef.f)
                            cached = {point.idx: point.v for point in item.val.numRef.numCache.pt}
                            self.assertEqual([cached.get(index, 0) or 0 for index in range(end - start + 1)],
                                             [book[target].cell(row, col).value or 0 for row in range(start, end + 1)])
                for name, rows in detail.items():
                    self.check_reference_details(book[name], rows)
            finally:
                book.close()

    def check_one_complete_chart_per_group(self, archive, part, expected, *, source_sheet=None):
        charts = [(anchor, chart) for anchor, chart in chart_parts(archive, part)
                  if chart.find('.//c:barChart', NS) is not None]
        self.assertEqual(len(charts), len(expected))
        names = []
        for _, chart in charts:
            title = ''.join(node.text or '' for node in chart.findall('.//c:title/c:tx/c:rich/a:p/a:r/a:t', NS))
            group = {'并带反': '并反'}.get(title, title)
            self.assertIn(group, expected)
            names.append(group)
            grouping = chart.find('.//c:barChart/c:grouping', NS)
            self.assertIsNotNone(grouping)
            self.assertEqual(grouping.get('val'), 'clustered')
            self.assertEqual(chart.find('.//c:barChart/c:overlap', NS).get('val'), '0')
            records = expected[group]
            owners = {owner for owner, _ in records}
            reasons = {reason for _, reason in records}
            series = chart.findall('.//c:barChart/c:ser', NS)
            self.assertEqual(len(series), len(reasons))
            self.assertEqual(set(chart_labels(chart)), owners)
            self.assertEqual(len(chart_labels(chart)), len(owners))
            codes = []
            for item in series:
                code = item.findtext('c:tx/c:strRef/c:strCache/c:pt/c:v', namespaces=NS)
                codes.append(code)
                cached = tuple(point.text for point in item.findall('c:cat/c:strRef/c:strCache/c:pt/c:v', NS))
                self.assertEqual(cached, chart_labels(chart))
                reference_sheet, bounds = range_to_tuple(item.findtext('c:cat/c:strRef/c:f', namespaces=NS))
                self.assertEqual(reference_sheet, source_sheet or group)
                self.assertEqual(bounds[3] - bounds[1] + 1, len(owners))
                values = {int(point.get('idx')): int(float(point.findtext('c:v', namespaces=NS)))
                          for point in item.findall('c:val/c:numRef/c:numCache/c:pt', NS)}
                self.assertEqual([values.get(index, 0) for index in range(len(cached))],
                                 [records[owner, code] for owner in cached])
            self.assertEqual(set(codes), reasons)
            self.assertEqual(len(set(codes)), len(codes))
            totals = [sum(records[owner, reason] for reason in reasons) for owner in chart_labels(chart)]
            self.assertEqual(totals, sorted(totals, reverse=True))
        self.assertEqual(set(names), set(expected))
        self.assertEqual(len(names), len(set(names)))

    def test_daily_report_has_one_complete_chart_per_group_and_only_supplied_records(self):
        template = Path(os.environ['BK_ANALYZED_TEMPLATE'])
        labels = [
            ('总表组', ('CN_MMC_装管反', 'CN_MPO_装管反')),
            ('另一组', ('CN_MPO_插芯内部断纤',)),
        ]
        groups = [{'name': name, 'reasons': codes} for name, codes in labels]
        daily_groups = [{'name': '日报指定组', 'reasons': codes} for _, codes in labels[:1]]
        codes = (*labels[0][1], *labels[1][1])
        def make_rows(prefix, count):
            rows = []
            for index in range(count):
                values = {'容器号': f'{prefix}-{index}', '责任人': f'{prefix}测试员工{index:03d}',
                          '数量': 1, '判定原因': codes[index % len(codes)]}
                rows.append([values.get(header) for header in report.HEADERS])
            return rows
        daily = make_rows('日报', 83)
        all_records = [*daily, *make_rows('隔日', 24)]
        with ZipFile(template) as archive:
            spec = reason_column_report.reference_template(archive, template, report.template_sheet_parts(archive))
            title = '测试日期装管失效人员'
            payload, _, _, _, _ = reason_column_report.build(
                archive, spec, all_records, reason_groups=groups, daily_rows=daily,
                daily_title=title, daily_reason_groups=daily_groups)
            empty_payload, *_ = reason_column_report.build(
                archive, spec, all_records, reason_groups=groups, daily_rows=[], daily_title=title)
        from io import BytesIO
        workbook = openpyxl.load_workbook(BytesIO(payload), data_only=True)
        self.addCleanup(workbook.close)
        sheet = workbook[reason_column_report.DAILY_SHEET]
        expected = ['总表', reason_column_report.DAILY_SHEET] if workbook.worksheets[-1]._pivots else [
            '总表', '责任人图表', reason_column_report.DAILY_SHEET]
        self.assertEqual(workbook.sheetnames[:len(expected)], expected)
        self.assertEqual(sheet['A1'].value, title)
        self.assertEqual(sheet['A1'].alignment.horizontal, 'center')
        self.assertEqual(sheet['A1'].font.sz, 20)
        self.assertTrue(sheet['A1'].font.b)
        self.assertIn('$A$1:', sheet.print_area)
        chart_names = defaultdict(set)
        generated = Counter()
        expected = Counter()
        for row in daily:
            name = '日报指定组' if row[report.REASON] in labels[0][1] else '插芯内部断纤'
            expected[(name, row[report.OWNER], row[report.REASON])] += 1
        with ZipFile(BytesIO(payload)) as exported:
            raw = report.template_sheet_parts(exported)[sheet.title]
            root = report.read(exported, raw)
            rectangles = []
            expected_groups = defaultdict(Counter)
            for (group, owner, reason), count in expected.items():
                expected_groups[group][owner, reason] = count
            self.check_one_complete_chart_per_group(exported, raw, expected_groups, source_sheet=sheet.title)
            for anchor, chart in chart_parts(exported, raw):
                rectangles.append(chart_rectangle(anchor, root))
                name = ''.join(node.text for node in chart.findall('.//c:title/c:tx/c:rich/a:p/a:r/a:t', NS))
                group = name.split('（')[0]
                self.assertTrue(chart_labels(chart))
                chart_names[group].update(chart_labels(chart))
                for item in chart.findall('.//c:barChart/c:ser', NS):
                    name = item.findtext('c:tx/c:strRef/c:strCache/c:pt/c:v', namespaces=NS)
                    for element in item.findall('c:val/c:numRef/c:numCache/c:pt', NS):
                        idx = int(element.get('idx'))
                        value = int(float(element.findtext('c:v', namespaces=NS)))
                        generated[(group, chart_labels(chart)[idx], name)] += value
            self.assertEqual(len(rectangles), len(expected_groups))
            setup = root.find('x:pageSetup', NS)
            self.assertEqual((setup.get('paperSize'), setup.get('orientation')), ('9', 'landscape'))
            workbook_xml = report.read(exported, 'xl/workbook.xml')
            sheet_index = workbook.sheetnames.index(sheet.title)
            area = next(node.text for node in workbook_xml.findall('x:definedNames/x:definedName', NS)
                        if node.get('name') == '_xlnm.Print_Area' and int(node.get('localSheetId')) == sheet_index)
            _, (_, first, last_col, last) = range_to_tuple(area)
            rows = [first - 1, *[int(node.get('id')) for node in root.findall('x:rowBreaks/x:brk', NS)], last]
            widths = {col: float(node.get('width')) for node in root.findall('x:cols/x:col', NS)
                      for col in range(int(node.get('min')), int(node.get('max')) + 1)}
            self.check_compressed_print_geometry(root, list(chart_parts(exported, raw)), rows, widths, last_col, setup)
            for index, (left, top, right, bottom) in enumerate(rectangles):
                for ll, tt, rr, bb in rectangles[index + 1:]:
                    self.assertTrue(right < ll or rr < left or bottom < tt or bb < top)
        self.assertEqual(generated, expected)
        self.assertEqual(sum(len(names) for names in chart_names.values()), len(daily))
        empty = openpyxl.load_workbook(BytesIO(empty_payload), data_only=True)
        self.addCleanup(empty.close)
        blank_day = empty[reason_column_report.DAILY_SHEET]
        self.assertEqual(blank_day['A1'].value, title)
        self.assertEqual(blank_day['A2'].value, '所选业务日没有装管判定记录')
        self.assertEqual(blank_day._charts, [])

    def check_reference_details(self, sheet, expected):
        first, heading, last, bottom = range_boundaries(sheet.auto_filter.ref)
        self.assertEqual((first, heading, last), (1, 1, len(report.HEADERS)))
        data = iter(sheet.iter_rows(min_row=heading, max_row=bottom, max_col=last, values_only=True))
        self.assertEqual(next(data), report.HEADERS)
        rows = [(row[0], row[report.OWNER], row[report.REASON]) for row in data]
        self.assertEqual(len(rows), len(expected))
        self.assertEqual(set(rows), expected)

    def check_reference_geometry(self, archive, part, bounds, *, overview):
        sheet = report.read(archive, part)
        setup = sheet.find('x:pageSetup', NS)
        self.assertEqual((setup.get('orientation'), setup.get('paperSize')), ('landscape', '9'))
        _, _, _, last_detail = range_boundaries(sheet.find('x:autoFilter', NS).get('ref'))
        left_col, first_row, right_col, last_row = bounds
        self.assertEqual(left_col, 1)
        self.assertGreaterEqual(first_row, last_detail + 3)
        row_heights = {int(row.get('r')): float(row.get('ht')) for row in sheet.findall('x:sheetData/x:row', NS)
                       if row.get('ht')}
        default_height = float(sheet.find('x:sheetFormatPr', NS).get('defaultRowHeight', '15'))
        cols = sheet.findall('x:cols/x:col', NS)
        default_width = float(sheet.find('x:sheetFormatPr', NS).get('defaultColWidth', '8.43'))
        widths = {col: float(spec.get('width')) for spec in cols
                  for col in range(int(spec.get('min')), int(spec.get('max')) + 1)}
        right_edge = sum(round(widths.get(col, default_width) * report.TEMPLATE_DIGIT_WIDTH)
                         * report.EMU_PER_PIXEL for col in range(1, right_col + 1))
        page_breaks = [int(item.get('id')) for item in sheet.findall('x:rowBreaks/x:brk', NS)
                       if item.get('man') == '1']
        printed_rows = [first_row - 1, *page_breaks, last_row]
        self.assertEqual(printed_rows, sorted(set(printed_rows)))
        page_edges = [sum(row_heights.get(row, default_height) for row in range(1, page_row + 1))
                      * report.EMU_PER_POINT for page_row in printed_rows]
        chart_data = defaultdict(Counter)
        rectangles = []
        for anchor, chart in chart_parts(archive, part):
            self.assertEqual(axis_details(chart), ('col', 'b', 'eaVert', '0', '1'))
            rect = chart_rectangle(anchor, sheet)
            x1, y1, x2, y2 = rect
            self.assertGreater(x2, x1)
            self.assertGreater(y2, y1)
            self.assertLessEqual(x2, right_edge + report.EMU_PER_POINT)
            self.assertTrue(any(top <= y1 < y2 <= bot for top, bot in zip(page_edges, page_edges[1:])))
            for left, top, right, bottom in rectangles:
                self.assertTrue(x1 >= right or x2 <= left or y1 >= bottom or y2 <= top, (part, rect, rectangles))
            rectangles.append(rect)
            series = chart.findall('.//c:barChart/c:ser', NS)
            self.assertTrue(series)
            labels = chart_labels(chart)
            self.assertTrue(labels)
            if not overview:
                self.assertGreaterEqual((x2 - x1) / report.EMU_PER_POINT, len(labels) * 13 + 74)
            for index, row in enumerate(series):
                formula = row.findtext('c:cat/c:strRef/c:f', namespaces=NS)
                reference_sheet, _ = range_to_tuple(formula)
                title = row.findtext('c:tx/c:strRef/c:strCache/c:pt/c:v', namespaces=NS)
                if title is None:
                    title = row.findtext('c:tx/c:v', namespaces=NS)
                if index:
                    self.assertIsNotNone(row.find('c:spPr/a:pattFill', NS))
                for number in row.findall('c:val/c:numRef/c:numCache/c:pt', NS):
                    value = number.findtext('c:v', namespaces=NS)
                    if value and float(value):
                        chart_data[reference_sheet][labels[int(number.get('idx'))], title] += int(float(value))
        self.assertTrue(rectangles)
        sizes = {(right - left, bottom - top) for left, top, right, bottom in rectangles}
        if not overview:
            self.assertEqual(len(sizes), 1)
        self.check_compressed_print_geometry(sheet, list(chart_parts(archive, part)),
                                             printed_rows, widths, right_col, setup)
        panes_per_page = 4 if overview else 1
        for page_top, page_bottom in zip(page_edges, page_edges[1:]):
            panels = [r for r in rectangles if page_top <= r[1] < page_bottom]
            self.assertGreater(len(panels), 0)
            self.assertLessEqual(len(panels), panes_per_page)
            by_row = defaultdict(list)
            for pane in panels:
                by_row[pane[1]].append(pane)
            self.assertLessEqual(len(by_row), 2 if overview else 1)
            for on_row in by_row.values():
                self.assertLessEqual(len(on_row), 2 if overview else 1)
                if len(on_row) == 2:
                    left_pane, right_pane = sorted(on_row)
                    self.assertGreaterEqual(right_pane[0] - left_pane[2], 6 * report.EMU_PER_POINT)
            if len(by_row) == 2:
                upper, lower = [items[0] for _, items in sorted(by_row.items())]
                self.assertGreaterEqual(lower[1] - upper[3], 6 * report.EMU_PER_POINT)
        if not overview:
            self.assertEqual(len({(left, right) for left, _, right, _ in rectangles}), 1)
        return dict(chart_data), rectangles

    def check_compressed_print_geometry(self, sheet, charts, printed_rows, widths, right_col, setup):
        scale = int(setup.get('scale')) / 100
        default_width = float(sheet.find('x:sheetFormatPr', NS).get('defaultColWidth', '8'))
        default_height = float(sheet.find('x:sheetFormatPr', NS).get('defaultRowHeight', '15'))
        heights = {int(row.get('r')): float(row.get('ht'))
                   for row in sheet.findall('x:sheetData/x:row', NS) if row.get('ht')}

        def marker_values(marker):
            row = int(marker.findtext('xdr:row', namespaces=NS))
            column = int(marker.findtext('xdr:col', namespaces=NS))
            x_offset = int(marker.findtext('xdr:colOff', namespaces=NS)) / report.EMU_PER_POINT
            y_offset = int(marker.findtext('xdr:rowOff', namespaces=NS)) / report.EMU_PER_POINT
            self.assertGreaterEqual(column, 0)
            self.assertGreaterEqual(row, 0)
            self.assertGreaterEqual(x_offset, 0)
            self.assertGreaterEqual(y_offset, 0)
            self.assertLess(x_offset, widths.get(column + 1, default_width) * report.TEMPLATE_DIGIT_WIDTH * .75)
            self.assertLess(y_offset, heights.get(row + 1, default_height))
            return row, column, x_offset, y_offset

        by_page = defaultdict(list)
        for anchor, _ in charts:
            first = marker_values(anchor.find('xdr:from', NS))
            page = next(index for index, (start, end) in enumerate(zip(printed_rows, printed_rows[1:]))
                        if start <= first[0] < end)
            extent = anchor.find('xdr:ext', NS)
            if extent is not None:
                end = None
                size = (int(extent.get('cx')) / report.EMU_PER_POINT,
                        int(extent.get('cy')) / report.EMU_PER_POINT)
            else:
                self.assertIsNotNone(anchor.find('xdr:to', NS))
                end, size = marker_values(anchor.find('xdr:to', NS)), None
            by_page[page].append((first, end, size))
        for native_row_height in (12.5, 13.08, 15):
            for page, anchors in by_page.items():
                first_row, last_row = printed_rows[page:page + 2]
                for digit_width in (7, 8):
                    right_edge = sum(widths.get(col, default_width) for col in range(1, right_col + 1)) * digit_width * .75
                    def position(marker):
                        row, col, x_offset, y_offset = marker
                        left = sum(widths.get(i, default_width) for i in range(1, col + 1)) * digit_width * .75 + x_offset
                        top = sum(heights.get(index, default_height) for index in range(first_row + 1, row + 1))
                        return left, (top + y_offset) * native_row_height / default_height
                    rectangles = []
                    for start, end, size in anchors:
                        left, top = position(start)
                        if end is None:
                            right, bottom = left + size[0], top + size[1]
                        else:
                            right, bottom = position(end)
                        self.assertGreater(right, left)
                        self.assertGreater(bottom, top)
                        self.assertLessEqual(right, right_edge)
                        page_height = sum(heights.get(index, default_height) for index in range(first_row + 1, last_row + 1))
                        self.assertLessEqual(bottom, page_height * native_row_height / default_height)
                        if native_row_height == 15:
                            self.assertLessEqual(bottom * scale, 535)
                        for ll, tt, rr, bb in rectangles:
                            self.assertTrue(right < ll or rr < left or bottom < tt or bb < top,
                                            (native_row_height, digit_width, page))
                        rectangles.append((left, top, right, bottom))



if __name__ == '__main__':
    unittest.main()

