"""BI integration regressions. Synthetic/demo files only, isolated data folder."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import sys

sys.dont_write_bytecode = True
SOURCE = Path(__file__).resolve().parents[2] / 'bi'
ADAPTER = Path(__file__).resolve().parents[1] / 'desktop' / 'bi-worker.py'
spec = importlib.util.spec_from_file_location('fusion_worker', ADAPTER)
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class FusionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='bi-integration-')
        cls.base = Path(cls.temp.name)
        cls.panel, cls.policy = worker.prepare(SOURCE, cls.base)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def test_source_and_data_import_paths_are_separate(self):
        self.assertEqual(Path(self.panel.BASE), self.base)
        self.assertEqual(Path(self.panel.UI), SOURCE / 'ui')
        self.assertNotIn(str(self.base), sys.path)
        self.assertNotIn(str(self.base / 'libs'), sys.path)

    def test_no_native_execution_or_arbitrary_routes(self):
        for route in ('/api/exit', '/api/open', '/api/pick', '/etc/passwd', '/api/daily/delete'):
            with self.assertRaises(ValueError):
                worker.dispatch(self.panel, self.policy, route, {})

    def test_external_paths_require_explicit_read_grant(self):
        with self.assertRaises(ValueError):
            self.policy.checked(str(SOURCE / '演示数据'))
        self.policy.grant(str(SOURCE / '演示数据'))
        self.assertTrue(self.policy.checked(str(SOURCE / '演示数据' / '每日原表')).endswith('每日原表'))
        with self.assertRaises(ValueError):
            self.policy.checked(str(SOURCE / '演示数据'), write=True)
        with self.assertRaises(ValueError):
            self.policy.checked('../outside.xlsx')

    def test_external_output_and_archive_cannot_change_originals(self):
        config = self.panel.engine.default_config()
        config['paths']['output'] = str(SOURCE / '演示数据')
        with self.assertRaises(ValueError):
            self.policy.config({'config': config})
        config['paths']['output'] = '分析结果'
        config['paths']['input'] = str(SOURCE / '演示数据')
        config['P']['导入后归档原表'] = '是'
        with self.assertRaises(ValueError):
            self.policy.config({'config': config})

    def test_filename_pattern_cannot_escape_authorized_input_folder(self):
        raw = self.panel.engine.default_config()
        for pattern in ('../outside.xlsx', r'C:\private\*.xlsx', r'..\outside.xlsx'):
            raw['paths']['pattern'] = pattern
            with self.assertRaises(ValueError):
                self.policy.config({'config': raw})
        raw['paths']['pattern'] = 'data*.xlsx'
        self.policy.config({'config': raw})

    def test_handlers_config_daily_and_raw_text_preserve(self):
        raw = self.panel.engine.default_config()
        raw['people'] = [{'name': '=2+3', 'groups': ['特殊字符']}]
        self.assertTrue(worker.dispatch(self.panel, self.policy, '/api/save', {'config': raw})['ok'])
        loaded = worker.dispatch(self.panel, self.policy, '/api/state')
        self.assertEqual(loaded['config']['people'], raw['people'])
        result = worker.dispatch(self.panel, self.policy, '/api/daily/state', {})
        self.assertTrue(result['ok'])

    def test_formula_injection_rejected_without_removing_report_formulas(self):
        from openpyxl import Workbook, load_workbook
        workbook = Workbook()
        sheet = workbook.active
        self.panel.engine.cell(sheet, 1, 1, '=HYPERLINK("https://example.invalid","x")')
        self.assertEqual(sheet['A1'].data_type, 's')
        self.panel.engine.cell(sheet, 2, 1, self.panel.engine._fusion_formula('=SUM(B1:B2)'))
        self.assertEqual(sheet['A2'].data_type, 'f')
        output = self.base / 'formula-safety.xlsx'
        workbook.save(output)
        reopened = load_workbook(output, data_only=False)
        self.assertEqual(reopened.active['A1'].data_type, 's')
        self.assertEqual(reopened.active['A2'].data_type, 'f')
        reopened.close()

    def test_full_original_report_preserves_all_main_sheets_and_formulas(self):
        from openpyxl import load_workbook
        raw = self.panel.engine.default_config()
        raw['paths']['input'] = str(SOURCE / '演示数据' / '每日原表')
        self.policy.grant(raw['paths']['input'])
        self.policy.config({'config': raw})
        result = self.panel.engine.run_report(str(self.base), raw, log=lambda _message: None)
        self.assertEqual(result['warnings'], [])
        workbook = load_workbook(result['output'], data_only=False)
        for name in ('01_每日驾驶舱','02_趋势分析','03_月度分析','04_风险与集中度','05_方案总览','06_自定义图表','07_改善项目','08_导入日志'):
            self.assertIn(name, workbook.sheetnames)
        formulas = sum(cell.data_type == 'f' for sheet in workbook for row in sheet for cell in row)
        self.assertGreater(formulas, 10)
        self.assertTrue(any(sheet._charts for sheet in workbook))
        workbook.close()



    def test_desktop_worker_rejects_retired_web_export_routes(self):
        for action in ('start', 'poll', 'current', 'cancel', 'report'):
            with self.subTest(action=action), self.assertRaises(ValueError):
                worker.dispatch(self.panel, self.policy, '/api/bi/' + action, {})

if __name__ == '__main__':
    unittest.main(verbosity=2)
