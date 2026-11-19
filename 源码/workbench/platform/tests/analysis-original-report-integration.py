"""Validate native template output with a local reference and synthetic records."""

import hashlib
import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
from zipfile import ZipFile

import openpyxl

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'desktop'))
from lab_engine import original_report as report, service, store, tabular


@unittest.skipUnless(os.environ.get('BK_ORIGINAL_TEMPLATE'), 'Local NC template not supplied')
class OriginalReportTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory(dir=os.environ.get('PLATFORM_TEST_ROOT'))
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.template = Path(os.environ['BK_ORIGINAL_TEMPLATE'])
        self.template_hash = hashlib.sha256(self.template.read_bytes()).hexdigest()
        with ZipFile(self.template) as archive:
            self.categories = [category.reasons for category in report.rules(archive, self.template).categories]
        self.folder = self.root / 'input'
        self.folder.mkdir()
        book = openpyxl.Workbook()
        sheet = book.active
        sheet.title = 'container'
        sheet.append(report.HEADERS)
        self.reasons = [code for pair in self.categories for code in pair]
        for number, reason in enumerate([*self.reasons, '测试未归类', self.reasons[0]], 1):
            fields = {
                '容器号': f'{number:04}', '数量': 37, '报告人': '测试报告人',
                '报告时间': '2026-11-09 08:32:00', '判定时间': '2026-11-10 09:35:22', '报告异常代码': 'TEST',
                '责任人': '测试人员' if number % 2 else None, '判定原因': reason,
                '工序': '测试排除' if number == 12 else '测试工序',
                '报告说明': '=合成文本',
            }
            sheet.append([fields.get(header) for header in report.HEADERS])
            sheet[f'I{number + 1}'].data_type = 's'
        sample = self.folder / 'source.xlsx'
        book.save(sample)
        book.close()
        source = {
            'id': 'nc', 'name': 'test', 'folder': str(self.folder), 'kind': 'defects', 'unit': 'units',
            'cutoff': 0, 'auto': False, 'dateFromFilename': False, 'uniqueColumns': [],
            'updateMode': 'replace_dates', 'coverage': 'rows', 'dateFormat': 'auto',
        }
        info = tabular.inspect(sample, source)
        source.update(
            mapping=info['mapping'], columns=info['columns'], schema=info['schema'],
            headerRow=info['headerRow'], sheet=info['sheet'], confirmed=True,
        )
        self.db = store.connect(self.root / 'db')
        self.addCleanup(self.db.close)
        self.assertEqual(store.import_files(self.db, source)['importedRows'], 12)
        self.source = source
        self.output = self.root / 'result.xlsx'
        self.body = {
            'config': {'sources': [source]}, 'sourceId': 'nc',
            'action': 'exportOriginalReport', 'revision': store.revision(self.db),
            'template': str(self.template), 'output': str(self.output),
            'query': {'range': 'custom', 'start': '2026-11-10', 'end': '2026-11-10',
                      'filters': [{'field': 'process', 'op': 'equals', 'values': ['测试工序']}],
                      'sort': {'field': source['columns'][0]['id'], 'direction': 'asc'}},
        }

    def test_export_uses_filtered_rows_and_native_charts_and_pivots(self):
        info = tabular.inspect(self.template, {'kind': 'defects'})
        self.assertEqual(info['sheet'], 'container')
        labels = {column['id']: column['label'] for column in info['columns']}
        self.assertEqual(labels[info['mapping']['date']], '判定时间')
        self.assertEqual(labels[info['mapping']['process']], '工序')
        self.assertNotEqual(info['mapping']['employee'], info['mapping']['reporter'])
        result = service.handle(self.db, self.body)
        self.assertEqual(result['recordCount'], 11)
        self.assertEqual(result['uncategorized'], 1)
        self.assertEqual(list(result['groups'].values()), [2] * 5)
        with ZipFile(self.output) as archive:
            self.assertIsNone(archive.testzip())
            self.assertNotIn('xl/worksheets/sheet1.xml', archive.namelist())
            self.assertNotIn('xl/sharedStrings.xml', archive.namelist())
        book = openpyxl.load_workbook(self.output)
        self.addCleanup(book.close)
        self.assertEqual(tuple(book.sheetnames), report.SHEETS[1:])
        total = book['总表']
        self.assertEqual((total.max_row, len(total._charts)), (12, 5))
        self.assertEqual(total['Q2'].value, '2026-11-10 09:35:22')
        self.assertEqual(total.page_setup.paperSize, int(total.PAPERSIZE_A4))
        self.assertEqual(total.page_setup.orientation, 'landscape')
        self.assertEqual((total.page_setup.fitToWidth, total.page_setup.fitToHeight), (1, 1))
        self.assertTrue(total.page_setup.blackAndWhite)
        self.assertIn('$A$15:$J$51', total.print_area)
        top, bottom = total._charts[:2], total._charts[2:]
        gap = report.TOTAL_CHART_GAP * report.EMU_PER_POINT
        column_widths = []
        for dimension in total.column_dimensions.values():
            width = int(dimension.width * 8 + 0.5) * report.EMU_PER_PIXEL
            column_widths.extend([width] * (dimension.max - dimension.min + 1))
        def x(anchor):
            return sum(column_widths[:anchor.col]) + anchor.colOff
        def y(anchor):
            return anchor.row * 15 * report.EMU_PER_POINT + anchor.rowOff
        def width(chart):
            return x(chart.anchor.to) - x(chart.anchor._from)
        def height(chart):
            return y(chart.anchor.to) - y(chart.anchor._from)
        for row in (top, bottom):
            self.assertEqual(x(row[0].anchor._from), 0)
            self.assertEqual(x(row[-1].anchor.to),
                             report.TOTAL_CHART_WIDTH * report.EMU_PER_POINT)
            for a, b in zip(row, row[1:]):
                self.assertEqual(x(b.anchor._from) - x(a.anchor.to), gap)
                self.assertEqual(y(a.anchor._from), y(b.anchor._from))
                self.assertEqual(height(a), height(b))
                self.assertLessEqual(abs(width(a) - width(b)), 2)
        self.assertEqual(y(bottom[0].anchor._from) - y(top[0].anchor.to), gap)
        for chart in total._charts:
            self.assertEqual(chart.series[0].spPr.solidFill.srgbClr, '000000')
            pattern = chart.series[1].spPr.pattFill
            self.assertEqual((pattern.prst, pattern.fgClr.srgbClr, pattern.bgClr.srgbClr),
                             ('ltDnDiag', '000000', 'FFFFFF'))
        self.assertEqual([total[f'A{i}'].value for i in range(2, 13)], [f'{i:04}' for i in range(1, 12)])
        self.assertEqual((total['I2'].data_type, total['I2'].value), ('s', '=合成文本'))
        for index, sheet in enumerate(book.worksheets[1:]):
            self.assertEqual((len(sheet._pivots), len(sheet._charts)), (1, 1))
            pivot, chart = sheet._pivots[0], sheet._charts[0]
            self.assertEqual(pivot.dataFields[0].subtotal, 'count')
            self.assertEqual(pivot.cache.cacheSource.worksheetSource.ref, 'A1:Y3')
            self.assertEqual(pivot.cache.recordCount, 2)
            self.assertEqual(len(pivot.cache.records.r), 2)
            self.assertFalse(pivot.pivotFields[report.HEADERS.index('责任工序')].items)
            values = [pt.v for series in chart.series for pt in series.val.numRef.numCache.pt]
            self.assertEqual(values, [1, 1])
            self.assertEqual(sheet.row_dimensions[1].height, 60 if index == 3 else 30)
        self.assertEqual(hashlib.sha256(self.template.read_bytes()).hexdigest(), self.template_hash)
        with self.assertRaisesRegex(ValueError, '已存在'):
            service.handle(self.db, self.body)
        with self.assertRaisesRegex(ValueError, '不能与原始模板相同'):
            service.handle(self.db, {**self.body, 'output': str(self.template)})

    def test_single_category_and_stale_query(self):
        self.body['query']['filters'].append({
            'field': self.source['columns'][report.REASON]['id'], 'op': 'in',
            'values': [self.categories[2][0], '测试未归类'],
        })
        with self.assertRaisesRegex(ValueError, '重新查询'):
            service.handle(self.db, {**self.body, 'revision': self.body['revision'] + 1})
        self.assertFalse(self.output.exists())
        result = service.handle(self.db, self.body)
        self.assertEqual((result['recordCount'], result['uncategorized']), (2, 1))
        book = openpyxl.load_workbook(self.output)
        self.addCleanup(book.close)
        self.assertEqual([len(sheet._pivots) for sheet in book.worksheets], [0, 0, 0, 1, 0, 0])
        self.assertEqual(book['并反']['A7'].value, '当前筛选条件下无数据')
        self.assertEqual(book['并反']._charts[0].series[0].val.numRef.numCache.ptCount, 0)

    def test_chart_axes_and_tied_owner_order_follow_template(self):
        with ZipFile(self.template) as archive:
            category = report.rules(archive, self.template).categories[0]
            codes, ranking = category.reasons, category.owner_order
            original = report.read(archive, 'xl/charts/chart1.xml')
        template_owners = list(ranking)[:2]
        people = ['新增乙', template_owners[1], '新增甲', template_owners[0], '数量优先', '数量优先']
        columns = {'columns': [{'id': name, 'label': name} for name in report.HEADERS]}
        rows = [{'values': {'容器号': str(index), '责任人': person, '数量': 1,
                            '判定原因': codes[0]}} for index, person in enumerate(people, 1)]
        report.export(self.template, self.output, columns, rows)
        with ZipFile(self.output) as archive:
            exported = report.read(archive, 'xl/charts/chart1.xml')
            ns = {'c': report.C}
            axis = './/c:catAx/c:txPr'
            self.assertEqual(report.xml(original.find(axis, ns)), report.xml(exported.find(axis, ns)))
            owner_values = exported.findall('.//c:ser/c:cat/c:strRef/c:strCache/c:pt/c:v', ns)
            expected = ['数量优先', *template_owners, '新增乙', '新增甲']
            self.assertTrue([v.text for v in owner_values] == expected * 2)

    def test_readable_total_charts_keep_complete_owner_and_new_reason_ranges(self):
        owners = [f'合成责任人 {index:02d}' for index in range(31)]
        other_reasons = [f'额外判定原因 {index:02d}' for index in range(15)]
        category_name = report.SHEETS[2]
        source = {'columns': [{'id': name, 'label': name} for name in report.HEADERS]}
        rows = [
            {'values': {'容器号': f'o{index}', '责任人': owner, '数量': 1, '判定原因': self.reasons[0]}}
            for index, owner in enumerate(owners)
        ] + [
            {'values': {'容器号': f'n{index}', '责任人': owners[0], '数量': 1, '判定原因': reason}}
            for index, reason in enumerate(other_reasons)
        ]
        export = report.export(self.template, self.output, source, rows, chart_layout='readable')
        self.assertEqual((export['recordCount'], export['uncategorized']), (46, 15))
        self.assertEqual((export['chartLayout'], export['totalChartPages']), ('readable', 5))
        book = openpyxl.load_workbook(self.output)
        self.addCleanup(book.close)
        total = book['总表']
        self.assertEqual((len(total._charts), len(total.row_breaks.brk)), (5, 4))
        self.assertIsNone(total.page_setup.fitToHeight)
        self.assertGreaterEqual(total.page_setup.scale, 80)
        self.assertEqual(total.page_setup.orientation, 'landscape')
        starts = [chart.anchor._from.row + 1 for chart in total._charts]
        self.assertEqual(starts, list(range(50, 50 + 5 * 33, 33)))
        self.assertEqual([item.id for item in total.row_breaks.brk], [row - 1 for row in starts[1:]])
        last_print_row = starts[-1] + 32
        self.assertTrue(total.print_area.endswith(f'${last_print_row}'))
        for row in range(starts[0], last_print_row + 1):
            self.assertEqual(total.row_dimensions[row].height, 15, f'行 {row}')
        self.assertGreaterEqual(33 * 15 - 450, 42)
        self.assertEqual(len(book[category_name]._pivots), 1)
        expected_labels = [owners[:14], owners[14:28], owners[28:], other_reasons[:14], other_reasons[14:]]
        chart_parts = [f'xl/charts/reportOverview{i}.xml' for i in range(1, 6)]
        with ZipFile(self.output) as archive:
            self.assertIsNone(archive.testzip())
            parts = report.read(archive, '[Content_Types].xml')
            overrides = {node.get('PartName') for node in parts}
            self.assertTrue(all('/' + path in overrides for path in chart_parts))
            for index, part in enumerate(chart_parts):
                root = report.read(archive, part)
                ns = {'c': report.C}
                series, = root.findall('.//c:barChart/c:ser', ns)
                labels = series.findall('c:cat/c:strRef/c:strCache/c:pt/c:v', ns)
                self.assertEqual([entry.text for entry in labels], expected_labels[index])
                formula = series.findtext('c:cat/c:strRef/c:f', namespaces=ns)
                ref_sheet, (first_col, first, last_col, last) = openpyxl.utils.cell.range_to_tuple(formula)
                self.assertEqual(ref_sheet, category_name if index < 3 else '判定原因汇总')
                self.assertEqual((first_col, last_col), (1, 1))
                self.assertEqual(last-first+1, len(labels))
                self.assertEqual([book[ref_sheet].cell(row, 1).value for row in range(first,last+1)],
                                 expected_labels[index])
                self.assertEqual(root.find('.//c:catAx/c:tickLblSkip', ns).get('val'), '1')
                self.assertEqual(root.find('.//c:barChart/c:barDir', ns).get('val'), 'bar')
                self.assertEqual(total._charts[index].anchor.ext.cy, 450 * report.EMU_PER_POINT)
        summary = list(book['判定原因汇总'].values)
        self.assertEqual(sum(row[1] for row in summary[1:]), 46)
        self.assertEqual(set(row[0] for row in summary[1:]), {self.reasons[0], *other_reasons})

    def test_hide_total_charts_keeps_template_category_and_complete_summary(self):
        source = {'columns': [{'id': name, 'label': name} for name in report.HEADERS]}
        rows = [{'values': {'容器号': str(index), '责任人': '样例', '数量': 1, '判定原因': reason}}
                for index, reason in enumerate((self.reasons[0], '模板外样例'), 1)]
        result = report.export(self.template, self.output, source, rows, chart_layout='hidden')
        self.assertEqual((result['totalChartPages'], result['overviewChartCount']), (0, 0))
        book = openpyxl.load_workbook(self.output)
        self.addCleanup(book.close)
        self.assertEqual(len(book['总表']._charts), 0)
        self.assertEqual(book['总表'].max_row, 3)
        self.assertEqual(len(book[report.SHEETS[2]]._charts), 1)
        self.assertEqual(book['判定原因汇总']['A2'].value, '模板外样例')



@unittest.skipUnless(os.environ.get('BK_EXPANDED_TEMPLATE'), 'Expanded NC template not supplied')
class ExpandedTemplateTests(unittest.TestCase):
    def test_reopened_original_export_uses_added_sheet_chart_and_pivot(self):
        template = Path(os.environ['BK_EXPANDED_TEMPLATE'])
        original = hashlib.sha256(template.read_bytes()).hexdigest()
        with ZipFile(template) as archive:
            self.assertGreater(len(archive.infolist()), 100)
            spec = report.rules(archive, template)
        expected = list(report.SHEETS[1:]) + ['纤缩无纤']
        self.assertEqual(report.inspect_template(template)['sheets'], expected)
        category = spec.categories[-1]
        self.assertEqual(len(category.reasons), 6)
        columns = {'columns': [{'id': name, 'label': name} for name in report.HEADERS]}
        rows = [{'values': {'容器号': f'{index:03}', '责任人': '样例', '数量': 1, '判定原因': reason}}
                for index, reason in enumerate(category.reasons, 1)]
        with TemporaryDirectory(dir=os.environ.get('PLATFORM_TEST_ROOT')) as folder:
            output = Path(folder) / 'expanded.xlsx'
            result = report.export(template, output, columns, rows)
            self.assertEqual((result['recordCount'], result['uncategorized']), (6, 0))
            self.assertEqual(result['groups']['纤缩无纤'], 6)
            with ZipFile(output) as archive:
                self.assertIsNone(archive.testzip())
            book = openpyxl.load_workbook(output)
            try:
                self.assertEqual(book.sheetnames, expected)
                self.assertEqual(len(book['总表']._charts), 6)
                self.assertEqual(len(book['纤缩无纤']._charts[0].series), 6)
                pivot = book['纤缩无纤']._pivots[0]
                self.assertEqual(pivot.cache.recordCount, 6)
                self.assertEqual(pivot.cache.cacheSource.worksheetSource.sheet, '纤缩无纤')
                fills = [series.spPr.pattFill.prst for series in book['纤缩无纤']._charts[0].series[1:]]
                self.assertEqual(len(set(fills)), 5)
            finally:
                book.close()
        self.assertEqual(hashlib.sha256(template.read_bytes()).hexdigest(), original)

if __name__ == '__main__':
    unittest.main()
