"""Synthetic offline XLSX -> original BI -> read-only homepage projection."""
from pathlib import Path
import hashlib
import importlib.util
import json
import os
import unittest
import uuid
import openpyxl

PLATFORM = Path(__file__).resolve().parents[1]
ROOT = Path(os.environ['PLATFORM_QA_ROOT']) / ('bi-home-' + uuid.uuid4().hex)
ROOT.mkdir(parents=True)
spec = importlib.util.spec_from_file_location('worker_home_tests', PLATFORM / 'desktop/bi-worker.py')
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)
panel, _ = worker.prepare(PLATFORM.parent / 'bi', ROOT / 'initial')
import daily


class HomeTests(unittest.TestCase):
    def setUp(self):
        self.base = ROOT / uuid.uuid4().hex
        self.base.mkdir()
        panel.BASE = self.base
        self.policy = worker.PathPolicy(self.base)
        self.q = {'start': '2026-10-01', 'end': '2026-10-30', 'grain': 'day', 'filters': {}, 'page': 1, 'pageSize': 10}
        self.pref = {'mode': 'auto', 'channel': 'auto', 'dailyScope': '', 'employee': ''}

    def file(self, quantities=(100,), date='2026-10-29', items=None, employee='合成员工', folder=None, preheader=True):
        folder = folder or self.base
        folder.mkdir(exist_ok=True)
        file = folder / ('data' + uuid.uuid4().hex + '.xlsx')
        book = openpyxl.Workbook(); sheet = book.active
        if preheader: sheet.append(['Synthetic source'])
        sheet.append(['Work Date', 'Workflow Category in Charge', 'Employee in Charge', 'Resource Name Category', 'Connector Type', 'Shift', 'Sum of Qty', 'Disposition Type', 'Defect Code', 'SN', 'NC Number'])
        for i, qty in enumerate(quantities):
            sheet.append([date, '装管', employee, 'BK_5F', 'MPO-MPO', '白班', qty, 'Scrap', items[i] if items else '装管反', '0012' if i < 2 else '12', 'NC-' + str(i)])
        book.save(file); book.close()
        return file

    def ingest(self, file, scope='Synthetic A', replace=False):
        return daily.ingest(self.base, {'path': str(file), 'kind': 'quality', 'scope': scope, 'replace': replace})

    def home(self, **overrides):
        return worker.dispatch(panel, self.policy, '/api/fusion/home', {'query': self.q, 'preference': self.pref, **overrides})

    def test_bi_only_is_available_and_files_are_unchanged(self):
        file = self.file(); self.ingest(file)
        db = self.base / '日报历史/snapshots.sqlite'
        before = [hashlib.sha256(p.read_bytes()).hexdigest() for p in (file, db)]
        r = self.home()
        self.assertEqual((r['state'], r['quantity'], r['rowCount']), ('available', 100, 1))
        self.assertIsNone(r['rate']); self.assertEqual(r['unit'], 'pcs')
        self.assertEqual(before, [hashlib.sha256(p.read_bytes()).hexdigest() for p in (file, db)])

    def test_multiple_scopes_require_selection_and_never_sum(self):
        self.ingest(self.file((100,)), 'Synthetic A'); self.ingest(self.file((200,)), 'Synthetic B')
        r = self.home(); self.assertEqual(r['state'], 'needs-scope'); self.assertNotIn('quantity', r)
        self.pref['dailyScope'] = 'Synthetic A'
        self.assertEqual(self.home()['quantity'], 100)

    def test_same_file_repeat_does_not_double_the_home_total(self):
        file = self.file(); self.ingest(file); self.ingest(file)
        self.assertEqual(self.home()['quantity'], 100)
        self.assertEqual(len(daily.state(self.base)['history']), 1)

    def test_snapshot_replacement_invalidates_cache_without_adding_old_rows(self):
        self.ingest(self.file()); self.assertEqual(self.home()['quantity'], 100)
        new = self.file((200,))
        with self.assertRaises(ValueError): self.ingest(new)
        self.assertEqual(self.home()['quantity'], 100)
        self.ingest(new, replace=True)
        self.assertEqual(self.home()['quantity'], 200)

    def test_employee_is_separate_from_manual_owner_and_reporter(self):
        self.ingest(self.file())
        self.q['filters'] = {'owner': '合成员工'}
        self.assertEqual(self.home()['state'], 'unsupported-filter')
        self.q['filters'] = {'reporter': '合成员工'}
        self.assertEqual(self.home()['state'], 'unsupported-filter')
        self.q['filters'] = {}; self.pref['employee'] = '另一个员工'
        self.assertEqual(self.home()['quantity'], 0)
        self.pref['employee'] = '合成员工'
        self.assertEqual(self.home()['quantity'], 100)

    def test_exact_items_and_identifiers_preserve_multiple_defects_for_same_sn(self):
        self.ingest(self.file((5, 7, 3), items=['装管反', '断裂', '装管反']))
        r = self.home(); self.assertEqual(r['quantity'], 15); self.assertEqual(r['rowCount'], 3)
        self.assertEqual({row['sn'] for row in r['rows']}, {'0012', '12'})
        self.q['filters'] = {'issue': '装管反'}
        r = self.home(); self.assertEqual(r['quantity'], 8); self.assertEqual(r['total'], 2)
        self.assertEqual(sum(x['count'] for x in r['issues']), 8)

    def test_missing_days_are_null_and_not_false_zero_or_comparable(self):
        self.ingest(self.file())
        r = self.home()
        self.assertIsNone(r['trend'][0]['quantity']); self.assertIsNone(r['previousQuantity'])
        self.assertEqual(next(x for x in r['trend'] if x['start'] == '2026-10-29')['quantity'], 100)

    def test_verified_zero_remains_valid_bi_data(self):
        self.ingest(self.file((0,)))
        r = self.home(); self.assertEqual(r['state'], 'available'); self.assertEqual(r['quantity'], 0)

    def test_export_and_pages_share_revision_and_sum(self):
        self.ingest(self.file(tuple(range(1, 16))))
        self.q.update(page=2, pageSize=5)
        r = self.home(); self.assertEqual(len(r['rows']), 5); self.assertEqual(r['total'], 15)
        self.pref['mode'] = 'bi'
        exported = self.home(exportRows=True)
        self.assertEqual(r['revision'], exported['revision'])
        self.assertEqual(len(exported['rows']), 15)
        self.assertEqual(sum(row['quantity'] for row in exported['rows']), exported['quantity'])

    def test_all_dates_includes_old_import_without_changing_default_range(self):
        self.ingest(self.file(date='2025-10-29'))
        self.assertEqual(self.home()['state'], 'empty')
        r = self.home(allDates=True)
        self.assertEqual(r['state'], 'available'); self.assertEqual(r['range']['start'], '2025-10-29')

    def test_daily_and_historical_copies_are_alternatives_not_additive(self):
        file = self.file(preheader=False, folder=self.base / '每日原表')
        self.ingest(file)
        auto = self.home(); self.assertEqual(auto['channel'], 'daily'); self.assertEqual(auto['quantity'], 100)
        self.pref['channel'] = 'history'
        history = self.home(); self.assertEqual(history['channel'], 'history'); self.assertEqual(history['quantity'], 100)

    def test_blank_drill_is_exact_instead_of_becoming_all(self):
        self.ingest(self.file((5, 7), items=['', '装管反']))
        r = self.home(biFilter={'field': 'issue', 'value': ''})
        self.assertEqual(r['quantity'], 5); self.assertEqual(r['rowCount'], 1)

    def test_cached_data_is_isolated_between_workspaces(self):
        self.ingest(self.file()); self.assertEqual(self.home()['quantity'], 100)
        first = self.base
        self.base = ROOT / uuid.uuid4().hex; self.base.mkdir()
        panel.BASE = self.base; self.policy = worker.PathPolicy(self.base)
        self.assertEqual(self.home()['state'], 'empty')
        self.ingest(self.file((200,))); self.assertEqual(self.home()['quantity'], 200)
        self.base = first; panel.BASE = first; self.policy = worker.PathPolicy(first)
        self.assertEqual(self.home()['quantity'], 100)


if __name__ == '__main__': unittest.main()
