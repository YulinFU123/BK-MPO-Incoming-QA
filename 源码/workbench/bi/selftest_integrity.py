"""Regression suite: synthetic data only, no network, no production-history writes."""
import base64
import csv
import json
import pathlib
import sys
import tempfile
import time
import unittest

ROOT = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / 'libs'))
import daily
import bi_bridge
from app_paths import resolve_paths
from daily_common import parse_date


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = pathlib.Path(self.temp.name)
        self.download = self.base / 'downloads'
        self.download.mkdir()
        self.path = self.base / 'quality.csv'
        self.query = {'scope': '演示范围', 'start': '2026-10-16', 'end': '2026-10-16', 'status': 'Rework,Scrap'}
        bi_bridge.JOBS.clear()
        self.write_quality([('2026-10-16', '演示甲', 3, 'Rework'), ('2026-10-16', '演示乙', 2, 'Scrap')])

    def tearDown(self):
        self.temp.cleanup()

    def write_quality(self, rows, path=None):
        target = path or self.path
        with target.open('w', encoding='utf-8-sig', newline='') as handle:
            writer = csv.writer(handle)
            writer.writerow(list(daily.FIELDS.values()))
            for date, name, quantity, status in rows:
                writer.writerow([date, '07-装管', name, 'BK_5F', 'MPO-MPO', '白班', quantity, status, '演示项目'])
        return target

    def ingest(self, **extra):
        return daily.ingest(self.base, {'path': str(self.path), 'scope': '演示范围', 'kind': 'quality', **extra})

    def start(self, **extra):
        body = {'folder': str(self.download), 'query': self.query, **extra}
        return bi_bridge.start(self.base, body)

    def test_empty_dates_have_actionable_messages(self):
        for key, label in [('start', '起始业务日'), ('end', '结束业务日')]:
            query = {**self.query, key: ''}
            with self.assertRaisesRegex(ValueError, label):
                self.start(query=query)
        self.assertEqual(bi_bridge.JOBS, {})

    def test_date_formats_and_invalid_calendar(self):
        self.assertEqual(parse_date('2026/1/2'), '2026-01-02')
        with self.assertRaises(ValueError):
            parse_date('2026-02-30')
        with self.assertRaises(ValueError):
            self.start(query={**self.query, 'start': '2026-10-17'})

    def test_no_folder_does_not_scan_current_directory(self):
        with self.assertRaisesRegex(ValueError, '下载文件夹'):
            self.start(folder='')

    def test_filename_pattern_cannot_escape_directory(self):
        with self.assertRaises(ValueError):
            self.start(pattern='../*.xlsx')
        self.assertEqual(bi_bridge.JOBS, {})

    def test_immutable_task_query(self):
        response = self.start()
        self.query['start'] = '2025-01-01'
        self.assertEqual(bi_bridge.JOBS[response['job']]['query']['start'], '2026-10-16')

    def test_expired_task_does_not_block_new_task(self):
        old = self.start()['job']
        bi_bridge.JOBS[old]['started'] -= 901
        new = self.start()['job']
        self.assertNotEqual(old, new)
        self.assertEqual(bi_bridge.JOBS[old]['state'], 'failed')

    def test_active_task_is_recoverable(self):
        identity = self.start()['job']
        self.assertEqual(bi_bridge.dispatch(self.base, 'current', {})['active']['id'], identity)
        bi_bridge.dispatch(self.base, 'cancel', {'job': identity})
        self.assertIsNone(bi_bridge.dispatch(self.base, 'current', {})['active'])

    def test_bad_marker_cannot_import(self):
        identity = self.start()['job']
        (self.download / f'NCDetails_job_{identity}.json').write_text(json.dumps({'id': 'other'}))
        self.assertEqual(bi_bridge.poll(self.base, {'job': identity})['state'], 'failed')
        self.assertEqual(daily.state(self.base)['history'], [])

    def test_same_rows_different_file_bytes_skip(self):
        self.ingest()
        self.write_quality([('2026-10-16', '演示乙', 2, 'Scrap'), ('2026-10-16', '演示甲', 3, 'Rework')])
        self.assertEqual(self.ingest()['results'][0]['state'], '重复，跳过')
        self.assertEqual(len(daily.state(self.base)['history']), 1)

    def test_whole_batch_rolls_back_on_conflict(self):
        self.ingest()
        self.write_quality([('2026-10-15', '新增', 1, 'Rework'), ('2026-10-16', '已更改', 9, 'Rework')])
        with self.assertRaises(ValueError):
            self.ingest()
        self.assertEqual(len(daily.state(self.base)['history']), 1)
        self.assertEqual(daily.analyze(self.base, self.query)['quantity'], 5)

    def test_duplicate_headers_rejected(self):
        with self.path.open('w', encoding='utf-8-sig', newline='') as handle:
            csv.writer(handle).writerow([*daily.FIELDS.values(), 'Employee in Charge'])
        with self.assertRaisesRegex(ValueError, '重名列'):
            self.ingest()

    def test_nonfinite_quantity_rejected(self):
        for quantity in ('NaN', 'inf', '-1'):
            self.write_quality([('2026-10-16', '甲', quantity, 'Rework')])
            with self.assertRaises(ValueError):
                self.ingest()

    def test_config_utf8_and_corrupt_config_preserved(self):
        config = {'templates': [{'name': '装管日报', 'query': self.query}]}
        daily.dispatch(self.base, 'save', {'config': config})
        self.assertEqual(daily.state(self.base)['config'], config)
        path = self.base / 'daily_config.json'
        path.write_text('{broken', encoding='utf-8')
        with self.assertRaisesRegex(ValueError, '原文件已保留'):
            daily.state(self.base)
        self.assertEqual(path.read_text(), '{broken')

    def test_revision_guard_prevents_mismatched_exports(self):
        self.ingest()
        analysis = daily.analyze(self.base, self.query)
        self.write_quality([('2026-10-16', '演示甲', 8, 'Rework')])
        self.ingest(replace=True)
        with self.assertRaisesRegex(ValueError, '历史数据已更新'):
            daily.dispatch(self.base, 'export', {'query': self.query, 'expected_revision': analysis['revision']})
        self.assertFalse((self.base / '日报输出').exists())

    def test_export_partial_status_and_image_completion(self):
        self.ingest()
        report = daily.dispatch(self.base, 'export', {'query': self.query})
        folder = pathlib.Path(report['path'])
        manifest = lambda: json.loads((folder / '导出状态.json').read_text(encoding='utf-8'))
        self.assertEqual(manifest()['status'], '等待图片')
        with self.assertRaises(ValueError):
            daily.dispatch(self.base, 'images', {'path': report['path'], 'token': 'wrong', 'images': []})
        with self.assertRaises(ValueError):
            daily.dispatch(self.base, 'images', {'path': report['path'], 'token': report['token'], 'images': [{'data': 'data:,'}]})
        self.assertEqual(manifest()['status'], '等待图片')
        daily.dispatch(self.base, 'images', {'path': report['path'], 'token': report['token'], 'images': []})
        self.assertEqual(manifest()['status'], '完成')
        self.assertTrue((folder / '日报明细.xlsx').is_file())

    def test_quantity_share_and_no_personal_production_rate(self):
        self.ingest()
        result = daily.analyze(self.base, {**self.query, 'employees': ['演示甲']})
        self.assertEqual(result['quantity'], 3)
        self.assertEqual(result['charts'][2]['rows'][0]['share'], 1)
        self.assertEqual(result['charts'][3]['rows'][0]['share'], .6)
        self.assertNotIn('defect_rate', result)

    def test_portable_data_and_resources_are_separate(self):
        resources, data = resolve_paths(True, '/portable/app.exe', '/portable/_internal/app_paths.py')
        self.assertEqual(resources.name, '_internal')
        self.assertEqual(data.name, '用户数据')
        self.assertNotEqual(resources, data)


if __name__ == '__main__':
    unittest.main(argv=[__file__], verbosity=2)
