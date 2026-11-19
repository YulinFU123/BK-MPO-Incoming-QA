"""Column-mapping export: BI/foreign headers can fill the 25-column NC template."""
from pathlib import Path
import os
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'desktop'))
from lab_engine import original_report as report, service, store


def source_with(columns):
    return {'columns': [{'id': cid, 'label': label, 'type': 'text'} for cid, label in columns]}


class TemplateMapTests(unittest.TestCase):
    def setUp(self):
        # A BI-style source: English headers, only a handful of columns.
        self.bi = source_with([
            ('h_sn', 'Serial Number'), ('h_qty', 'Sum of Qty'),
            ('h_emp', 'Employee in Charge'), ('h_date', 'Work Date'),
            ('h_code', 'Defect Code'), ('h_step', 'Workflow Step in Charge'),
        ])
        self.records = [
            {'values': {'h_sn': 'SN001', 'h_qty': 3, 'h_emp': '张三', 'h_date': '2026-11-10',
                        'h_code': 'CN_M1', 'h_step': '装管'}},
            {'values': {'h_sn': '', 'h_qty': 1, 'h_emp': '李四', 'h_date': '2026-11-10',
                        'h_code': 'CN_M2', 'h_step': '装管'}},  # blank SN → skipped
            {'values': {'h_sn': 'SN003', 'h_qty': 2, 'h_emp': None, 'h_date': '2026-11-10',
                        'h_code': 'CN_M1', 'h_step': '装管'}},  # blank owner → kept
        ]

    def test_template_headers_are_the_fixed_25(self):
        headers = report.template_headers()
        self.assertEqual(len(headers), 25)
        self.assertEqual(headers[0], '容器号')
        self.assertIn('判定原因', headers)

    def test_without_map_foreign_source_is_not_supported(self):
        self.assertFalse(report.supports_template(self.bi))

    def test_map_enables_export_with_partial_columns(self):
        mapping = {
            '容器号': 'h_sn', '数量': 'h_qty', '责任人': 'h_emp',
            '报告时间': 'h_date', '报告异常代码': 'h_code', '责任工序': 'h_step',
            '判定原因': 'h_code',
        }
        self.assertTrue(report.supports_template(self.bi, mapping))
        resolved = report.resolve_columns(self.bi, mapping)
        self.assertEqual(resolved['容器号'], 'h_sn')
        self.assertEqual(resolved['判定人'], '', 'unmapped column stays blank')

    def test_map_cannot_enable_without_serial(self):
        mapping = {'数量': 'h_qty', '责任人': 'h_emp', '判定原因': 'h_code'}
        self.assertFalse(report.supports_template(self.bi, mapping),
                         '容器号/SN must be mapped')

    def test_only_serial_is_required_other_columns_may_be_blank(self):
        # User rule: "筛选有些值是为空的，当然除了 sn". A map with just 容器号
        # is enough; quantity / reason / owner may be left unmapped.
        mapping = {'容器号': 'h_sn'}
        self.assertTrue(report.supports_template(self.bi, mapping))
        rows, skipped = report.build_rows(self.bi, [self.records[0], self.records[2]], mapping)
        self.assertEqual(len(rows), 2)
        self.assertEqual(skipped, 0)
        sn = report.HEADERS.index('容器号')
        qty = report.HEADERS.index('数量')
        reason = report.HEADERS.index('判定原因')
        self.assertEqual(rows[0][sn], 'SN001')
        self.assertIsNone(rows[0][qty], 'unmapped quantity is blank')
        self.assertIsNone(rows[0][reason], 'unmapped reason is blank')

    def test_build_rows_fills_mapped_and_leaves_rest_blank(self):
        mapping = {
            '容器号': 'h_sn', '数量': 'h_qty', '责任人': 'h_emp',
            '报告时间': 'h_date', '报告异常代码': 'h_code', '判定原因': 'h_code',
        }
        rows, skipped = report.build_rows(self.bi, self.records, mapping)
        self.assertEqual(skipped, 1, 'blank SN row skipped')
        self.assertEqual(len(rows), 2)
        sn = report.HEADERS.index('容器号')
        qty = report.HEADERS.index('数量')
        owner = report.HEADERS.index('责任人')
        reason = report.HEADERS.index('判定原因')
        person = report.HEADERS.index('判定人')
        self.assertEqual(rows[0][sn], 'SN001')
        self.assertEqual(rows[0][qty], 3)
        self.assertEqual(rows[0][owner], '张三')
        self.assertEqual(rows[0][reason], 'CN_M1')
        self.assertIsNone(rows[0][person], 'unmapped column is blank')
        self.assertEqual(rows[1][owner], None, 'blank mapped value stays blank (not an error)')

    def test_build_rows_keeps_blank_sn_when_not_required(self):
        mapping = {'容器号': 'h_sn', '数量': 'h_qty'}
        rows, skipped = report.build_rows(self.bi, self.records, mapping, sn_required=False)
        self.assertEqual(len(rows), 3)
        self.assertEqual(skipped, 0)

    def test_standard_native_source_still_works_without_map(self):
        # Original behaviour: a real NC source has all 25 Chinese headers.
        native = source_with([(f'h{i}', h) for i, h in enumerate(report.HEADERS)])
        self.assertTrue(report.supports_template(native))
        resolved = report.resolve_columns(native)
        self.assertEqual(resolved['容器号'], 'h0')

    def test_unknown_map_keys_and_ids_are_ignored(self):
        mapping = {'容器号': 'h_sn', '数量': 'h_qty', '判定原因': 'h_code',
                   '不存在的列': 'h_emp', '状态': 'h_deadbeef'}
        resolved = report.resolve_columns(self.bi, mapping)
        self.assertEqual(resolved['容器号'], 'h_sn')
        self.assertEqual(resolved['状态'], '', 'unknown column id is ignored')


class ServiceMappingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='tpl-map-svc-')
        self.addCleanup(self.temp.cleanup)
        self.db = store.connect(Path(self.temp.name) / 'db')
        self.addCleanup(self.db.close)

    def test_template_headers_action_returns_fixed_25(self):
        out = service.handle(self.db, {'action': 'templateHeaders', 'config': {}})
        self.assertEqual(len(out['headers']), 25)
        self.assertEqual(out['headers'][0], '容器号')

    def test_analyze_reports_native_exportable_from_template_map(self):
        # A foreign (BI-style) source is not natively exportable, but supplying
        # a templateMap on the analyze request makes the export button available.
        columns = [
            {'id': 'h_0000000000000001', 'label': 'Serial Number', 'type': 'text'},
            {'id': 'h_0000000000000002', 'label': 'Work Date', 'type': 'date'},
            {'id': 'h_0000000000000003', 'label': 'Defect Code', 'type': 'text'},
            {'id': 'h_0000000000000004', 'label': 'Sum of Qty', 'type': 'number'},
        ]
        source = {
            'id': 'bi', 'name': 'BI', 'kind': 'defects', 'folder': self.temp.name,
            'sheet': '', 'headerRow': 0, 'mapping': {}, 'columns': columns, 'schema': '',
            'confirmed': True, 'unit': 'events', 'cutoff': 0, 'auto': False,
            'dateFromFilename': False, 'uniqueColumns': [], 'updateMode': 'replace_dates',
            'coverage': 'rows', 'dateFormat': 'auto',
        }
        mapping = {
            '容器号': 'h_0000000000000001', '报告时间': 'h_0000000000000002',
            '判定原因': 'h_0000000000000003', '数量': 'h_0000000000000004',
        }
        base = {'action': 'analyze', 'config': {'sources': [source]}, 'sourceId': 'bi',
                'query': {'range': 'all', 'dimension': 'defect'}}
        without = service.handle(self.db, base)
        self.assertFalse(without['canExportOriginalReport'])
        with_map = service.handle(self.db, {**base, 'templateMap': mapping})
        self.assertTrue(with_map['canExportOriginalReport'])


if __name__ == '__main__':
    unittest.main()
