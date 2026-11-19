"""Exercise the native daily rate sheet with synthetic quantities."""

from datetime import datetime
from io import BytesIO
from pathlib import Path
import os
import sys
import unittest
from xml.etree import ElementTree as ET
from zipfile import ZIP_DEFLATED, ZipFile

from openpyxl import Workbook, load_workbook
from openpyxl.chart import LineChart, Reference

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'desktop'))
from lab_engine import rate_report


def workbook():
    data = Workbook()
    data.active.title = '总表'
    data.active['A1'] = '原资料'
    daily = data.create_sheet('每日装管失效人员')
    daily.print_area = 'A1:B10'
    detail = data.create_sheet('装管反')
    detail.print_area = 'A1:H20'
    data.active = detail
    stream = BytesIO()
    data.save(stream)
    return stream.getvalue()


class TemplateRateTests(unittest.TestCase):
    def test_daily_sheet_preserves_missing_values_and_uses_dynamic_formula_and_native_chart(self):
        payload, summary = rate_report.append_template_rate(workbook(), {
            'days': [
                {'date': '2026-11-18', 'production': None, 'quantity': 6, 'rates': {'项目甲': 6}},
                {'date': '2026-11-17', 'production': 1000, 'quantity': 2, 'rates': {'项目甲': 0, '项目乙': 2}},
                {'date': '2026-11-19', 'production': 500, 'quantity': 0, 'rates': {'项目甲': 0, '项目乙': 0}},
                {'date': '2026-11-20', 'production': 0, 'quantity': None},
                {'date': '2026-11-21', 'production': 8, 'quantity': 9},
            ],
            'rules': [
                {'label': '项目甲', 'keywords': ['甲', '甲']},
                {'label': '项目乙', 'keywords': ['乙']},
                {'label': '项目甲', 'keywords': ['甲补充']},
            ],
        })
        self.assertEqual(summary['sheetIndex'], 2)
        self.assertEqual(summary['validPoints'], 2)
        self.assertIsNone(summary['overallRate'])
        report = load_workbook(BytesIO(payload), data_only=False)
        self.assertEqual(report.sheetnames, ['总表', '每日装管失效人员', '不良率', '装管反'])
        self.assertEqual(report.active.title, '装管反')
        self.assertIn('$A$1:$B$10', report['每日装管失效人员'].print_area)
        self.assertIn('$A$1:$H$20', report['装管反'].print_area)
        self.assertEqual(report.calculation.calcMode, 'auto')
        sheet = report['不良率']
        self.assertEqual([sheet.cell(i, 1).value for i in range(1, 7)],
                         ['日期', '产量', '不良数', '不良率', '项目甲', '项目乙'])
        self.assertEqual(sheet['B1'].value, datetime(2026, 11, 17))
        self.assertEqual(sheet['B2'].value, 1000)
        self.assertEqual(sheet['B5'].value, 0)
        self.assertIsNone(sheet['C2'].value)
        self.assertIsNone(sheet['C6'].value)
        self.assertEqual(sheet['E2'].value, 0)
        self.assertTrue(sheet['C4'].value.startswith('=IF(AND(ISNUMBER(C3),ISNUMBER(C2),'))
        self.assertIn('C3/C2', sheet['C4'].value)
        self.assertIn('F3<=F2', sheet['F4'].value)
        self.assertTrue(sheet.row_dimensions[8].hidden)
        self.assertEqual(sheet['C8'].value, '=IF(ISNUMBER(C4),C4,NA())')
        self.assertEqual(len(sheet._charts), 1)
        self.assertEqual(sheet._charts[0].series[0].val.numRef.f, "'不良率'!$B$8:$F$8")
        self.assertTrue(sheet._charts[0].series[0].dLbls.showVal)
        self.assertTrue(any(cell.value == '甲 ／ 甲补充' for row in sheet.iter_rows() for cell in row))
        report.close()
        cached = load_workbook(BytesIO(payload), data_only=True)
        sheet = cached['不良率']
        self.assertEqual([sheet.cell(4, i).value for i in range(2, 7)], [.002, None, 0, None, None])
        self.assertEqual(sheet['C8'].value, '#N/A')
        cached.close()
        with ZipFile(BytesIO(payload)) as archive:
            self.assertIsNone(archive.testzip())
            root = ET.fromstring(archive.read('xl/charts/rateTrend1.xml'))
            namespace = {'c': rate_report.C}
            self.assertEqual(root.find('.//c:plotVisOnly', namespace).get('val'), '0')
            self.assertEqual(root.find('.//c:dispBlanksAs', namespace).get('val'), 'gap')
            self.assertEqual([pt.get('idx') for pt in root.findall('.//c:val/c:numRef/c:numCache/c:pt', namespace)],
                             ['0', '2'])

    def test_weighted_summary_and_continued_pages(self):
        days = [{'date': f'2026-11-{i:02}', 'production': i * 100, 'quantity': 1}
                for i in range(1, 12)]
        payload, summary = rate_report.append_template_rate(workbook(), {'days': days, 'rules': []})
        self.assertEqual(summary['pages'], 2)
        self.assertTrue(summary['complete'])
        self.assertAlmostEqual(summary['overallRate'], 11 / 6600)
        report = load_workbook(BytesIO(payload))
        sheet = report['不良率']
        self.assertEqual(len(sheet._charts), 2)
        self.assertEqual(len(sheet.row_breaks.brk), 1)
        self.assertLess(sheet._charts[0].anchor.to.row, sheet._charts[1].anchor._from.row)
        self.assertEqual([row[1].value for row in sheet.iter_rows() if row[0].value == '日期'],
                         [datetime(2026, 11, 1), datetime(2026, 11, 11)])
        report.close()

    @unittest.skipUnless(os.environ.get('BK_ANALYZED_TEMPLATE'), 'Native reference workbook required')
    def test_reference_rate_chart_keeps_visual_geometry_and_formula_editability(self):
        source = Path(os.environ['BK_ANALYZED_TEMPLATE'])
        with ZipFile(source) as archive:
            parts = rate_report.native.template_sheet_parts(archive)
            prototype = rate_report.template_prototype(archive, parts)
            visual = rate_report.template_visual(archive, parts)
        self.assertIsNotNone(visual)
        before = ET.tostring(prototype)
        rules = [{'label': f'项目{i}', 'keywords': [f'词{i}']} for i in range(14)]
        report = {'days': [{'date': '2026-11-16', 'production': 109319, 'quantity': 266,
                            'rates': {rule['label']: 1 for rule in rules}}], 'rules': rules}
        payload, summary = rate_report.append_template_rate(workbook(), report, prototype=prototype,
                                                            reference_visual=visual)
        self.assertEqual(ET.tostring(prototype), before)
        data = load_workbook(BytesIO(payload), data_only=False)
        self.addCleanup(data.close)
        sheet = data['不良率']
        self.assertEqual(sheet['B2'].value, 109319)
        self.assertIn('B3/B2', sheet['B4'].value)
        self.assertEqual(sheet.row_dimensions[1].height, visual['rowHeight'])
        self.assertEqual(data.sheetnames.index('不良率'), data.sheetnames.index('每日装管失效人员') + 1)
        chart, = sheet._charts
        widths = {col: dim.width * 6 for dim in sheet.column_dimensions.values()
                  for col in range(dim.min, dim.max + 1)}
        heights = {row: (0 if dim.hidden else dim.height or 15) for row, dim in sheet.row_dimensions.items()}
        def point(marker):
            return (sum(widths.get(col, 8.43 * 6) for col in range(1, marker.col + 1))
                    + marker.colOff / rate_report.native.EMU_PER_POINT,
                    sum(heights.get(row, 15) for row in range(1, marker.row + 1))
                    + marker.rowOff / rate_report.native.EMU_PER_POINT)
        left, top = point(chart.anchor._from)
        right, bottom = point(chart.anchor.to)
        self.assertAlmostEqual(left, visual['left'], places=3)
        self.assertAlmostEqual(top, 18 * visual['rowHeight'] + visual['gap'], places=3)
        self.assertAlmostEqual(right - left, visual['width'], places=3)
        self.assertAlmostEqual(bottom - top, visual['height'], places=3)
        notes = [cell for row in sheet for cell in row if cell.value == '填写说明']
        self.assertEqual(len(notes), 1)
        self.assertGreater(sum(heights.get(row, 15) for row in range(1, notes[0].row)), bottom)
        with ZipFile(BytesIO(payload)) as archive:
            root = ET.fromstring(archive.read('xl/charts/rateTrend1.xml'))
            ns = {'c': rate_report.C}
            title = root.find('c:chart/c:title', ns)
            original_title = prototype.find('c:chart/c:title', ns)
            self.assertEqual(ET.tostring(title) if title is not None else None,
                             ET.tostring(original_title) if original_title is not None else None)
        bare = load_workbook(BytesIO(workbook()))
        bare.remove(bare['每日装管失效人员'])
        staged = BytesIO()
        bare.save(staged)
        bare.close()
        without_daily, _ = rate_report.append_template_rate(staged.getvalue(), report, prototype=prototype,
                                                           reference_visual=visual)
        data = load_workbook(BytesIO(without_daily))
        self.addCleanup(data.close)
        self.assertEqual(data.sheetnames, ['总表', '不良率', '装管反'])
        days = [{'date': f'2026-11-{day:02}', 'quantity': 1, 'production': 100} for day in range(1, 12)]
        continued, _ = rate_report.append_template_rate(workbook(), {'days': days, 'rules': []},
                                                        prototype=prototype, reference_visual=visual)
        many = load_workbook(BytesIO(continued))
        self.addCleanup(many.close)
        sheet = many['不良率']
        widths = {col: dim.width * 6 for dim in sheet.column_dimensions.values()
                  for col in range(dim.min, dim.max + 1)}
        heights = {row: (0 if dim.hidden else dim.height or 15) for row, dim in sheet.row_dimensions.items()}
        self.assertEqual(len(sheet._charts), 2)
        for chart in sheet._charts:
            from openpyxl.utils.cell import range_to_tuple
            _, (_, date_row, _, _) = range_to_tuple(chart.series[0].cat.numRef.f)
            expected_top = sum(heights.get(row, 15) for row in range(1, date_row + 4)) + visual['gap']
            self.assertAlmostEqual(point(chart.anchor._from)[1], expected_top, places=3)
            self.assertAlmostEqual(point(chart.anchor.to)[1] - point(chart.anchor._from)[1], visual['height'], places=3)

    def test_duplicate_days_and_unconfigured_breakdown_cannot_corrupt_the_report(self):
        day = {'date': '2026-11-18', 'quantity': 2, 'production': 100}
        for report in (
            {'days': [day, day]},
            {'days': [{**day, 'date': '2026-11-31'}]},
            {'days': [{**day, 'rates': {'无对应规则': 2}}]},
        ):
            with self.subTest(report=report):
                with self.assertRaises(ValueError):
                    rate_report.append_template_rate(workbook(), report)

    @unittest.skipUnless(os.environ.get('BK_ANALYZED_TEMPLATE'), 'Native reference workbook required')
    def test_reference_line_style_and_total_slots_share_formula_backed_rate_table(self):
        source = Path(os.environ['BK_ANALYZED_TEMPLATE'])
        with ZipFile(source) as archive:
            prototype = rate_report.template_prototype(archive, rate_report.native.template_sheet_parts(archive))
        self.assertIsNotNone(prototype)
        original_prototype = ET.tostring(prototype)
        book = load_workbook(BytesIO(workbook()))
        total = book['总表']
        total['B1'] = '占位'
        total['B2'] = 1
        for index in range(2):
            placeholder = LineChart()
            placeholder.add_data(Reference(total, min_col=2, min_row=1, max_row=2), titles_from_data=True)
            total.add_chart(placeholder, f'A{5 + index * 20}')
        staged = BytesIO()
        book.save(staged)
        book.close()
        slots = ['xl/charts/chart1.xml', 'xl/charts/chart2.xml']
        # An empty native slot is a supported intermediate construction state.
        with ZipFile(BytesIO(staged.getvalue())) as archive:
            parts = {item.filename: archive.read(item.filename) for item in archive.infolist()}
        parts[slots[1]] = b''
        staged = BytesIO()
        with ZipFile(staged, 'w', ZIP_DEFLATED) as archive:
            for name, value in parts.items():
                archive.writestr(name, value)
        days = [{'date': f'2026-11-{day:02}', 'quantity': 1, 'production': None if day == 4 else 100}
                for day in range(1, 12)]
        report = {'days': days, 'rules': []}
        self.assertEqual(rate_report.template_rate_chart_count(report), 2)
        payload, summary = rate_report.append_template_rate(
            staged.getvalue(), report, prototype=prototype, overview_slots=slots)
        self.assertEqual(ET.tostring(prototype), original_prototype)
        self.assertEqual(summary['points'], 11)
        with ZipFile(BytesIO(payload)) as archive:
            self.assertIsNone(archive.testzip())
            for index, slot in enumerate(slots, 1):
                self.assertEqual(archive.read(slot), archive.read(f'xl/charts/rateTrend{index}.xml'))
                chart = ET.fromstring(archive.read(slot))
                ns = {'c': rate_report.C, 'a': rate_report.A}
                original = prototype.find('.//c:lineChart/c:ser/c:spPr', ns)
                self.assertEqual(ET.tostring(chart.find('.//c:lineChart/c:ser/c:spPr', ns)), ET.tostring(original))
                self.assertEqual(chart.find('.//c:marker/c:symbol', ns).get('val'), 'circle')
                self.assertEqual(chart.find('.//c:valAx/c:numFmt', ns).get('formatCode'), '0.00%')
                self.assertIsNone(chart.find('.//c:valAx/c:scaling/c:max', ns))
                self.assertIn("'不良率'!", chart.find('.//c:lineChart/c:ser/c:val/c:numRef/c:f', ns).text)
        book = load_workbook(BytesIO(payload))
        self.assertEqual(len(book['总表']._charts), 2)
        self.assertEqual(len(book['不良率']._charts), 2)
        self.assertEqual(book['总表']._charts[0].series[0].val.numRef.f,
                         book['不良率']._charts[0].series[0].val.numRef.f)
        book.close()

    def test_rate_slot_mismatch_is_rejected_before_writing_an_incomplete_workbook(self):
        report = {'days': [{'date': '2026-11-18', 'quantity': 1, 'production': 10}]}
        with self.assertRaisesRegex(ValueError, '槽数量'):
            rate_report.append_template_rate(workbook(), report, overview_slots=['xl/charts/a.xml', 'xl/charts/b.xml'])
        with self.assertRaisesRegex(ValueError, '尚未创建'):
            rate_report.append_template_rate(workbook(), report, overview_slots=['xl/charts/missing.xml'])


if __name__ == '__main__':
    unittest.main()
