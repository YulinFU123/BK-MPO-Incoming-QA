"""Synthetic-only native BI/home connection and source-scope regression."""
from pathlib import Path
import importlib.util
import unittest

spec = importlib.util.spec_from_file_location('studio_fixture', Path(__file__).with_name('analysis-studio-integration.py'))
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
from lab_engine import service, store


class NativeHomeTests(unittest.TestCase):
    setUp = fixture.StudioTests.setUp
    tearDown = fixture.StudioTests.tearDown
    workbook = fixture.StudioTests.workbook
    source = fixture.StudioTests.source
    fixture = fixture.StudioTests.fixture

    def home(self, source, **patch):
        body = {'action': 'home', 'config': {'sources': [source], 'activeSource': source['id']},
                'query': {'start': '2026-09-19', 'end': '2026-09-20', 'grain': 'day', 'pageSize': 10, 'page': 1, 'filters': {}},
                'preference': {}}
        body.update(patch)
        return service.handle(self.db, body)

    def test_shared_store_shows_same_rows_and_quantity_with_missing_denominator(self):
        s, _, _ = self.fixture()
        r = self.home(s)
        self.assertEqual(r['state'], 'available')
        self.assertEqual(r['quantity'], 5)
        self.assertEqual(r['rowCount'], 2)
        self.assertEqual(r['channel'], 'studio')
        self.assertIsNone(r['rate'])
        self.assertEqual(r['unitLabel'], '件')
        self.assertEqual(sum(p['count'] for p in r['issues']), 5)

    def test_all_dates_and_out_of_range_are_distinct_from_zero(self):
        s, _, _ = self.fixture()
        q = {'start': '2026-11-01', 'end': '2026-11-02', 'grain': 'day', 'filters': {}}
        absent = self.home(s, query=q)
        self.assertEqual(absent['state'], 'out-of-range')
        self.assertTrue(absent['hasData'])
        self.assertEqual(absent['availableRange']['start'], '2026-09-19')
        full = self.home(s, query=q, allDates=True)
        self.assertEqual(full['quantity'], 5)
        self.assertEqual(full['range']['end'], '2026-09-20')

    def test_employee_and_reporter_do_not_get_confused_and_manual_status_is_not_ignored(self):
        s, _, _ = self.fixture()
        r = self.home(s, preference={'employee': '张三'})
        self.assertEqual(r['quantity'], 2)
        r = self.home(s, query={'start': '2026-09-19', 'end': '2026-09-20', 'grain': 'day', 'filters': {'reporter': '赵六'}})
        self.assertEqual(r['quantity'], 3)
        unsupported = self.home(s, query={'start': '2026-09-19', 'end': '2026-09-20', 'grain': 'day', 'filters': {'owner': '张三'}})
        self.assertEqual(unsupported['state'], 'unsupported-filter')

    def test_no_other_workspace_data_and_events_do_not_become_unique_pieces(self):
        s, _, _ = self.fixture()
        s['unit'] = 'events'
        r = self.home(s)
        self.assertEqual(r['unitLabel'], '次')
        other = dict(s, id='other-source')
        self.assertEqual(self.home(other)['state'], 'empty')


if __name__ == '__main__':
    unittest.main()
