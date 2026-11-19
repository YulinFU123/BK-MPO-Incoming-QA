"""Synthetic regression for actual BI header semantics and explicit shift rules."""
from pathlib import Path
from datetime import datetime
import importlib.util
import json
import unittest

spec = importlib.util.spec_from_file_location('studio_fixture', Path(__file__).with_name('analysis-studio-integration.py'))
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
from lab_engine import tabular, store, service, analysis, shift_calendar, exports


class ShiftTests(unittest.TestCase):
    setUp = fixture.StudioTests.setUp
    tearDown = fixture.StudioTests.tearDown
    workbook = fixture.StudioTests.workbook
    source = fixture.StudioTests.source

    def rule(self, **patch):
        return {**shift_calendar.DEFAULTS, 'mode': 'check-time', 'timeColumn': 'h_0000000000000001', **patch}

    def apply(self, value, **patch):
        rule = self.rule(**patch)
        return shift_calendar.apply({rule['timeColumn']: value}, '2026-10-16', rule)

    def make(self, rows=None):
        headers = ['Work Date','Report Process Type','Process Type in Charge','Workflow Step Name','Workflow Step in Charge','Check Date','Shift','Failure Code','Sum of Qty','Employee in Charge','Report Full Name']
        rows = rows or [['2026-10-16','MPO','MPO','CN-MPO-测试','CN-MPO-装管','2026-10-17 02:30:12.590000','白班','装管反',2,'合成员工','合成报检人']]
        self.workbook(self.folder / '20261016.xlsx', [headers, *rows])
        source = self.source(self.folder)
        rule = self.rule(timeColumn=source['mapping']['date'])
        source['calendar'] = rule
        return source

    def test_actual_bi_headers_select_check_date_workflow_and_sum_quantity(self):
        s = self.make()
        labels = {c['id']: c['label'] for c in s['columns']}
        self.assertEqual(labels[s['mapping']['date']], 'Check Date')
        self.assertEqual(labels[s['mapping']['process']], 'Workflow Step in Charge')
        self.assertEqual(labels[s['mapping']['quantity']], 'Sum of Qty')
        self.assertEqual(labels[s['mapping']['reporter']], 'Report Full Name')
        self.assertNotEqual(s['mapping']['reporter'], s['mapping']['employee'])
        result = store.import_files(self.db, s)
        self.assertEqual(result['errors'], 0)
        row = store.load_rows(self.db, s)[0]
        self.assertEqual((row['date'], row['shift'], row['process'], row['quantity']), ('2026-10-16','晚班','CN-MPO-装管',2))

    def test_family_only_process_type_is_not_accepted_but_legacy_real_process_names_are(self):
        def selected(value):
            return tabular.header_info([['日期','不良项','Process Type in Charge'],['2026-10-16','装管反',value]])['mapping']
        self.assertNotIn('process', selected('MPO'))
        self.assertIn('process', selected('装管'))

    def test_inclusive_end_minutes_and_both_gaps(self):
        cases = [('07:59:59','未归班'),('08:00:00','白班'),('18:40:59.999','白班'),('18:41:00','未归班'),('19:59:59','未归班'),('20:00:00','晚班'),('06:40:59.999','晚班'),('06:41:00','未归班')]
        for time, label in cases:
            with self.subTest(time=time): self.assertEqual(self.apply('2026-10-17 '+time)[1], label)

    def test_start_calendar_and_explicit_business_date_are_separate(self):
        moment = '2027-01-01 02:30:00'
        self.assertEqual(self.apply(moment)[0], '2026-12-31')
        self.assertEqual(self.apply(moment,dateBasis='calendar')[0], '2027-01-01')
        self.assertEqual(self.apply(moment,dateBasis='mapped')[0], '2026-10-16')
        self.assertEqual(self.apply('2027-01-01 07:00:00')[0], '2027-01-01')

    def test_empty_date_only_and_invalid_clock_never_invent_a_shift(self):
        for value in [None,'','2026-10-16']:
            self.assertEqual(self.apply(value)[1], '未归班')
        with self.assertRaises(ValueError): self.apply('2026-10-16 25:40:00')
        with self.assertRaises(ValueError): self.apply('10/11/2026 08:00:00')

    def test_excel_native_timestamp_ampm_and_explicit_timezone(self):
        self.assertEqual(shift_calendar.clock(datetime(2026,10,16,8)), datetime(2026,10,16,8))
        self.assertEqual(shift_calendar.clock('10/16/2026 8:00 PM','mdy').hour, 20)
        self.assertEqual(shift_calendar.clock('2026-10-16T00:00:00Z').hour, 8)
        self.assertEqual(self.apply('2026-10-16T00:00:00Z')[1], '白班')

    def test_overlapping_shift_configuration_fails(self):
        for patch in [{'dayEnd':'20:00'},{'nightEnd':'08:00'},{'nightStart':'06:00'},{'dayLabel':'晚班'}]:
            with self.subTest(patch=patch), self.assertRaises(ValueError): shift_calendar.validate(self.rule(**patch))

    def test_rule_changes_require_reimport_and_old_default_hash_stays_compatible(self):
        s = self.make()
        legacy = {k:v for k,v in s.items() if k!='calendar'}
        self.assertEqual(store.mapping_hash(legacy),store.mapping_hash({**legacy,'calendar':dict(shift_calendar.DEFAULTS)}))
        store.import_files(self.db,s)
        old_total = sum(r['quantity'] for r in store.load_rows(self.db,s))
        changed = {**s,'calendar':{**s['calendar'],'dateBasis':'calendar'}}
        with self.assertRaisesRegex(ValueError,'重新导入'): store.load_rows(self.db,changed)
        result = store.import_files(self.db,changed)
        self.assertEqual(result['errors'],0)
        self.assertEqual(sum(r['quantity'] for r in store.load_rows(self.db,changed)),old_total)
        self.assertEqual(store.load_rows(self.db,changed)[0]['date'],'2026-10-17')

    def test_home_and_production_use_the_same_derived_shift_and_process(self):
        s = self.make(); store.import_files(self.db,s)
        self.workbook(self.prod/'产量.xlsx',[['日期','工序','班次','产量'],['2026-10-16','CN-MPO-装管','晚班',100]])
        p = self.source(self.prod,'production'); store.import_files(self.db,p)
        query = {'range':'all','start':'','end':'','filters':[],'dimension':'process','chartType':'bar','metric':'rate','sort':{'field':'date','direction':'desc'},'pageSize':50,'topN':10}
        report = analysis.analyze(self.db,s,p,query)
        self.assertAlmostEqual(report['rate']['value'],0.02)
        policy = {'version':1,'sources':{s['id']:s['calendar']}}
        config = {'sources':[{k:v for k,v in s.items() if k!='calendar'}],'activeSource':s['id']}
        home = service.handle(self.db,{'action':'home','config':config,'calendar':policy,'query':{'start':'2026-10-16','end':'2026-10-16','filters':{},'grain':'day'},'preference':{}})
        self.assertEqual(home['quantity'],2)
        self.assertEqual(home['processes'][0]['value'],'CN-MPO-装管')

    def test_backup_carries_rules_and_restore_requires_validated_rule_approval(self):
        s = self.make(); store.import_files(self.db,s)
        policy = {'version':1,'sources':{s['id']:s['calendar']}}
        config = {'sources':[{k:v for k,v in s.items() if k!='calendar'}]}
        file = self.root/'rules.labpack'
        exports.backup(self.db,{'config':config,'calendar':policy,'output':str(file)})
        other = store.connect(self.root/'restore')
        try:
            peek=exports.inspectBackup(other,{'input':str(file)})
            self.assertEqual(peek['calendar'],policy)
            approved={'input':str(file),'approvedConfig':json.dumps(peek['config'])}
            with self.assertRaisesRegex(ValueError,'班次规则未经确认'): exports.restore(other,approved)
            restored=exports.restore(other,{**approved,'approvedCalendar':json.dumps(policy)})
            self.assertEqual(restored['calendar'],policy)
            self.assertEqual(store.load_rows(other,s)[0]['shift'],'晚班')
        finally: other.close()

    def test_outside_shift_rows_remain_in_analysis_with_a_visible_warning(self):
        s=self.make([['2026-10-16','MPO','MPO','CN-MPO-测试','CN-MPO-装管','2026-10-16 19:00:00','白班','装管反',2,'合成','合成']])
        imported=store.import_files(self.db,s)
        self.assertEqual(imported['files'][0]['unassignedRows'],1)
        result=analysis.analyze(self.db,s,None,{'range':'all','filters':[],'dimension':'shift','sort':{'field':'date','direction':'desc'}})
        self.assertEqual(result['quantity'],2)
        self.assertEqual(result['points'][0]['label'],'未归班')
        self.assertTrue(any('未归班' in note for note in result['warnings']))

    def test_distinct_check_times_are_not_collapsed_into_one_daily_event(self):
        s=self.make(); store.import_files(self.db,s)
        self.workbook(self.folder/'later.xlsx',[
            ['Work Date','Report Process Type','Process Type in Charge','Workflow Step Name','Workflow Step in Charge','Check Date','Shift','Failure Code','Sum of Qty','Employee in Charge','Report Full Name'],
            ['2026-10-16','MPO','MPO','CN-MPO-测试','CN-MPO-装管','2026-10-17 03:30:12.590000','白班','装管反',2,'合成员工','合成报检人']])
        store.import_files(self.db,s)
        self.assertEqual(sum(r['quantity'] for r in store.load_rows(self.db,s)),4)
        self.assertEqual(store.import_files(self.db,s)['importedRows'],0)


if __name__ == '__main__': unittest.main()
