"""Fixed 07:00 judgment-day supplements, using isolated synthetic SQLite data."""

import csv
from datetime import datetime
import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'desktop'))
from lab_engine import analysis, daily_template_report as daily, store, tabular


class DailyTemplateTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory(dir=os.environ.get('PLATFORM_TEST_ROOT'))
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.db = store.connect(self.root / 'db')
        self.addCleanup(self.db.close)

    def source(self, rows, *, kind='defects', date_column='判定时间', cutoff=0, qty=True):
        folder = self.root / kind
        folder.mkdir()
        path = folder / 'synthetic.csv'
        headers = ['容器号', '数量', '判定时间', '报告时间', '判定原因', '工序', '班次', '责任人']
        with path.open('w', encoding='utf-8-sig', newline='') as handle:
            csv.writer(handle).writerows([headers, *rows])
        source = dict(id=kind, name=kind, kind=kind, folder=str(folder), sheet='', headerRow=0,
                      cutoff=cutoff, dateFormat='ymd', unit='units', coverage='rows',
                      dateFromFilename=False, uniqueColumns=[], updateMode='replace_dates')
        info = tabular.inspect(path, source)
        by_label = {column['label']: column['id'] for column in info['columns']}
        mapping = {'date': by_label[date_column], 'process': by_label['工序'], 'shift': by_label['班次'],
                   'employee': by_label['责任人'], 'defect': by_label['判定原因'], 'serial': by_label['容器号']}
        if qty:
            mapping['quantity'] = by_label['数量']
        source.update(sheet=info['sheet'], headerRow=info['headerRow'], schema=info['schema'],
                      columns=info['columns'], mapping=mapping, confirmed=True)
        imported = store.import_files(self.db, source)
        self.assertEqual(imported['errors'], 0, imported)
        return source, by_label

    def run_prepare(self, source, settings=None, start='2026-11-17', end='2026-11-17', filters=(), hints=()):
        query = {'range': 'custom', 'start': start, 'end': end, 'filters': list(filters)}
        _, span, base, _ = analysis.core(self.db, source, query)
        before = repr(base)
        result = daily.prepare(self.db, source, {source['id']: source}, query, settings or {},
                               span, base, None, hints)
        self.assertEqual(repr(base), before)
        return result

    def test_timestamp_boundary_uses_judgment_and_retrieves_next_calendar_day_once(self):
        source, _ = self.source([
            ['before', 1, '2026-11-17 06:59:59', '2026-11-17', 'MPO装管反', '装管', '晚班', '甲'],
            ['first', 1, '2026-11-17 07:00:00', '2026-11-17', 'MPO装管反', '装管', '白班', '甲'],
            ['next-morning', 1, '2026-11-18 06:59:59', '2026-11-17', 'MPO装管反', '装管', '晚班', '乙'],
            ['after', 1, '2026-11-18 07:00:00', '2026-11-17', 'MPO装管反', '装管', '白班', '丙'],
        ])
        rows, title, _, rate = self.run_prepare(source)
        self.assertEqual([row['values'][source['mapping']['serial']] for row in rows], ['first', 'next-morning'])
        self.assertEqual(title, '11月17日装管失效人员')
        self.assertEqual(rate['days'][0]['quantity'], 2)
        self.assertIsNone(rate['days'][0]['production'])
        self.assertEqual({row['date'] for row in rows}, {'2026-11-17'})
        # The main query still has its original index-date population.
        self.assertEqual(len(analysis.core(self.db, source, {'range': 'custom', 'start': '2026-11-17',
                                                             'end': '2026-11-17', 'filters': []})[3]), 2)

    def test_other_index_date_and_eight_hour_cutoff_do_not_drop_judgment_rows(self):
        source, _ = self.source([
            ['distant-report', 1, '2026-11-17 10:00:00', '2026-11-01', 'MPO装管反', '装管', '白班', '甲'],
        ], date_column='报告时间')
        self.assertEqual(self.run_prepare(source)[3]['days'][0]['quantity'], 1)
        # Same judgment date indexed with an 08:00 cutoff is on the preceding
        # canonical day, and must still enter the fixed 07:00 supplement.
        next_root = self.root / 'second'
        next_root.mkdir()
        self.root = next_root
        source, _ = self.source([
            ['07-hour', 1, '2026-11-17 07:15:00', '2026-11-17', 'MPO装管反', '装管', '白班', '乙'],
        ], cutoff=8)
        self.assertEqual(self.run_prepare(source)[3]['days'][0]['quantity'], 1)

    def test_keywords_count_nonempty_quantity_once_per_label_and_missing_column_stays_missing(self):
        rows = [{'values': {'reason': 'MPO物料穿错装管反', 'qty': qty}}
                for qty in (9, 0, None, '', '有值')]
        rules = [{'label': '合并项', 'keywords': ['MPO', '装管反']},
                 {'label': '合并项', 'keywords': ['穿错']},
                 {'label': '其他', 'keywords': ['不存在']}]
        quantity, rates = daily.keyword_totals(rows, 'reason', 'qty', rules)
        self.assertEqual((quantity, rates), (3, {'合并项': 3, '其他': 0}))
        self.assertEqual(daily.keyword_totals(rows, 'reason', None, rules),
                         (None, {'合并项': None, '其他': None}))
        self.assertIsNone(daily.decision_day({'values': {'time': '2026-11-17'}}, 'time', 'ymd'))
        self.assertEqual(daily.decision_day({'values': {'time': datetime(2026, 11, 18, 6, 59)}}, 'time', 'ymd'),
                         '2026-11-17')

    def test_range_preserves_missing_days_and_template_hints_limit_people_only(self):
        source, columns = self.source([
            ['a', 1, '2026-11-17 08:00:00', '2026-11-17', 'PIN堵', '装管', '白班', '甲'],
            ['b', 1, '2026-11-17 09:00:00', '2026-11-17', '物料穿错', '装管', '白班', '乙'],
        ])
        groups = [{'name': '用户分组', 'reasons': ['PIN堵', '物料穿错']}]
        hints = [{'name': '模板类', 'reasons': ['PIN堵']}]
        rows, _, selected, rate = self.run_prepare(
            source, {'reasonGroups': groups}, end='2026-11-18', hints=hints)
        self.assertEqual([row['values'][columns['容器号']] for row in rows], ['a'])
        self.assertEqual(selected, groups)
        self.assertEqual(rate['days'][0]['quantity'], 2)
        self.assertIsNone(rate['days'][1]['quantity'])
        self.assertIsNone(rate['days'][1]['production'])
        only_new = [{'values': {columns['判定原因']: '新原因'}}]
        self.assertEqual(daily.groups_for_daily(only_new, columns['判定原因'], {'reasonGroups': groups}, hints),
                         (only_new, groups))

    def test_empty_selected_reason_is_a_real_zero_and_blank_judged_reason_still_counts_total(self):
        source, columns = self.source([
            ['a', 1, '2026-11-17 08:00:00', '2026-11-17', '', '装管', '白班', '甲'],
            ['b', 1, '2026-11-17 09:00:00', '2026-11-17', 'PIN堵', '装管', '白班', '乙'],
        ])
        rate = self.run_prepare(source)[3]
        self.assertEqual(rate['days'][0]['quantity'], 2)
        filter = {'field': columns['判定原因'], 'op': 'equals', 'values': ['不存在'], 'caseSensitive': True}
        rate = self.run_prepare(source, filters=[filter])[3]
        self.assertEqual(rate['days'][0]['quantity'], 0)
        self.assertTrue(all(value == 0 for value in rate['days'][0]['rates'].values()))

    def test_manual_denominator_matches_fixed_day_and_rejects_count_unit_mismatch(self):
        source, _ = self.source([
            ['a', 1, '2026-11-18 06:00:00', '2026-11-17', 'MPO装管反', '装管', '晚班', '甲'],
        ])
        settings = {'includeRate': True, 'productionMode': 'manual', 'manualProduction': [
            {'date': '2026-11-17', 'process': '装管', 'shift': '晚班', 'quantity': 100}],
        }
        point = self.run_prepare(source, settings)[3]['days'][0]
        self.assertEqual((point['quantity'], point['production']), (1, 100))
        settings['manualProduction'][0]['date'] = '2026-11-18'
        self.assertIsNone(self.run_prepare(source, settings)[3]['days'][0]['production'])
        # Retain literal zero production as an unavailable denominator.
        settings['manualProduction'][0].update(date='2026-11-17', quantity=0)
        self.assertIsNone(self.run_prepare(source, settings)[3]['days'][0]['production'])

    def test_bound_production_requires_every_matching_shift_and_count_quantity_agreement(self):
        defects, _ = self.source([
            ['a', 2, '2026-11-17 08:00:00', '2026-11-17', 'MPO装管反', '装管', '白班', '甲'],
            ['b', 1, '2026-11-18 06:00:00', '2026-11-18', 'MPO装管反', '装管', '晚班', '乙'],
        ])
        production, _ = self.source([
            ['p', 100, '2026-11-17 08:00:00', '2026-11-17', '', '装管', '白班', ''],
            ['q', 200, '2026-11-17 20:00:00', '2026-11-17', '', '装管', '晚班', ''],
        ], kind='production')
        query = {'range': 'custom', 'start': '2026-11-17', 'end': '2026-11-17', 'filters': []}
        _, span, base, _ = analysis.core(self.db, defects, query)
        rows, _, _, rate = daily.prepare(self.db, defects, {production['id']: production}, query,
            {'includeRate': True, 'productionId': production['id']}, span, base, None, ())
        self.assertEqual(rate['days'][0]['quantity'], 2)
        self.assertIsNone(rate['days'][0]['production'])
        self.assertIn('口径', rate['days'][0]['rateReason'])
        # Both selected rows must be counted as one unit before auto-binding.
        for row in rows:
            row['quantity'] = 1
        matched = {'2026-11-17': rows}
        settings = {'includeRate': True, 'productionId': production['id']}
        bound = daily.usable_denominators(self.db, defects, {production['id']: production}, settings,
                                          query, rows, matched, span)
        self.assertEqual(bound['2026-11-17'][0], 300)
        matched['2026-11-17'] = [{**row, 'shift': '新班次'} for row in rows]
        missing = daily.usable_denominators(self.db, defects, {production['id']: production}, settings,
                                            query, rows, matched, span)
        self.assertIsNone(missing['2026-11-17'][0])


if __name__ == '__main__':
    unittest.main()
