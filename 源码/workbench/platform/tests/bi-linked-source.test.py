"""Daily report source folder is linked to the main window import folder."""
import importlib.util
import json
import os
import re
import tempfile
import unittest
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[2] / 'bi'
spec = importlib.util.spec_from_file_location('bi_engine_linked', SOURCE / 'engine.py')
engine = importlib.util.module_from_spec(spec)
spec.loader.exec_module(engine)


class LinkedSourceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='bi-linked-')
        self.base = Path(self.temp.name) / 'workcopy'
        self.base.mkdir()

    def tearDown(self):
        self.temp.cleanup()

    def read_config(self):
        return json.loads((self.base / 'config.json').read_text(encoding='utf-8'))

    def test_absolute_linked_input_is_not_persisted(self):
        outside = Path(self.temp.name) / 'downloads'
        outside.mkdir()
        raw = {'version': 9, 'paths': {'input': str(outside), 'history': '历史数据库',
                                      'output': '分析结果', 'pattern': '*.xlsx'}, 'P': {}}
        engine.save_config_file(str(self.base), raw)
        stored = self.read_config()
        self.assertEqual(stored['paths']['input'], '每日原表')
        self.assertEqual(stored['paths']['pattern'], '*.xlsx')
        # The in-memory config used by the running report still points outside.
        self.assertEqual(raw['paths']['input'], str(outside))

    def test_relative_input_is_untouched(self):
        raw = {'paths': {'input': '每日原表', 'history': '历史数据库', 'output': '分析结果'}, 'P': {}}
        engine.save_config_file(str(self.base), raw)
        self.assertEqual(self.read_config()['paths']['input'], '每日原表')

    def test_absolute_path_inside_workcopy_is_kept(self):
        inside = self.base / '每日原表'
        inside.mkdir()
        raw = {'paths': {'input': str(inside), 'history': '历史数据库', 'output': '分析结果'}, 'P': {}}
        engine.save_config_file(str(self.base), raw)
        self.assertEqual(self.read_config()['paths']['input'], str(inside))

    def test_config_without_paths_is_safe(self):
        engine.save_config_file(str(self.base), {'version': 9, 'P': {}})
        self.assertEqual(self.read_config()['version'], 9)

    def test_bak_is_created_on_second_save(self):
        raw = {'paths': {'input': '每日原表'}, 'P': {}}
        engine.save_config_file(str(self.base), raw)
        engine.save_config_file(str(self.base), raw)
        self.assertTrue((self.base / 'config.json.bak').exists())

    def test_js_column_role_matches_engine_role_default(self):
        # bi-host.js mirrors engine.ROLE_DEFAULT as COLUMN_ROLE so the import
        # header can be inherited. They must not drift apart.
        host = (Path(__file__).resolve().parents[1] / 'desktop' / 'bi-host.js').read_text(encoding='utf-8')
        block = re.search(r'const COLUMN_ROLE = Object\.freeze\(\{(.*?)\}\);', host, re.S)
        self.assertIsNotNone(block, 'COLUMN_ROLE not found in bi-host.js')
        js_pairs = dict(re.findall(r"'([^']+)':\s*'([^']+)'", block.group(1)))
        self.assertEqual(js_pairs, engine.ROLE_DEFAULT)


if __name__ == '__main__':
    unittest.main()
