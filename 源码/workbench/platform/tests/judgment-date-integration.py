"""Judge-date import, rebuilding and shared analysis use real local engines."""
from copy import deepcopy
import hashlib
import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest

import openpyxl
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'desktop'))
from lab_engine import analysis, original_report, service, store, tabular


class JudgmentDateTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory(dir=os.environ.get('PLATFORM_TEST_ROOT'))
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.folder = self.root / 'defects'
        self.folder.mkdir()
        self.path = self.folder / '2026-11-01.xlsx'
        self.db = store.connect(self.root / 'analysis')
        self.addCleanup(self.db.close)

    def write(self, records, path=None, sheet='container'):
        book = openpyxl.Workbook()
        ws = book.active
        ws.title = sheet
        headers = [*original_report.HEADERS, '班次']
        ws.append(headers)
        for index, values in enumerate(records, 1):
            defaults = {'容器号':f'TEST-{index}', '数量':1, '状态':'已判',
                        '报告时间':'2026-11-01 09:00:00', '判定时间':'2026-11-02 10:30:45',
                        '报告异常代码':'合成不良', '判定原因':'合成不良', '工序':'装管', '班次':'白班'}
            defaults.update(values)
            ws.append([defaults.get(header) for header in headers])
        book.save(path or self.path)
        book.close()

    def source(self):
        source = {'id':'defects', 'name':'合成异常品', 'folder':str(self.folder), 'kind':'defects',
                  'sheet':'container', 'headerRow':0, 'unit':'units', 'cutoff':0, 'auto':False,
                  'dateFromFilename':False, 'uniqueColumns':[], 'updateMode':'replace_dates',
                  'coverage':'daily_complete','dateFormat':'ymd'}
        info = tabular.inspect(self.path, source)
        source.update({key:info[key] for key in ('sheet','headerRow','mapping','columns','schema')})
        source['confirmed'] = True
        return source, info

    def column(self, source, label):
        return next(c['id'] for c in source['columns'] if c['label'] == label)

    def test_mlight_recommends_judgment_but_explicit_report_binding_still_works(self):
        self.write([{}])
        source, info = self.source()
        judgment = self.column(source,'判定时间')
        self.assertEqual(info['mapping']['date'], judgment)
        self.assertEqual(info['decisionDateColumn'], judgment)
        self.assertEqual(info['confidence']['date'],'review')
        rows, _, dates = tabular.read_records(self.path, source)
        self.assertEqual(dates,['2026-11-02'])
        self.assertEqual(rows[0]['values'][judgment],'2026-11-02 10:30:45')
        source['mapping']['date'] = self.column(source,'报告时间')
        self.assertEqual(tabular.read_records(self.path, source)[2],['2026-11-01'])

    def test_blank_judgment_times_are_reported_and_never_substituted(self):
        self.write([{}, {'判定时间':None, '状态':'未判'}, {'判定时间':'   ', '状态':'待判'}])
        original_hash = hashlib.sha256(self.path.read_bytes()).hexdigest()
        source, _ = self.source()
        source['dateFromFilename'] = True
        result = store.import_files(self.db,source)
        self.assertEqual((result['importedRows'],result['errors']),(1,0))
        self.assertEqual(result['files'][0]['skippedUndatedDecisions'],2)
        self.assertIn('未使用报告时间或文件名代替',result['files'][0]['warning'])
        self.assertEqual(store.catalog(self.db,source)['dates'],['2026-11-02'])
        self.assertEqual(hashlib.sha256(self.path.read_bytes()).hexdigest(),original_hash)
        self.assertEqual(store.load_rows(self.db,source)[0]['values'][self.column(source,'判定时间')],
                         '2026-11-02 10:30:45')

    def test_all_blank_judgments_do_not_create_a_filename_coverage_day(self):
        self.write([{'判定时间':None}, {'判定时间':''}])
        source, _ = self.source()
        source['dateFromFilename'] = True
        result = store.import_files(self.db,source)
        self.assertEqual(result['errors'],0)
        self.assertEqual(result['files'][0]['skippedUndatedDecisions'],2)
        self.assertEqual(store.load_rows(self.db,source),[])
        self.assertEqual(store.catalog(self.db,source)['dates'],[])

    def test_invalid_nonblank_judgment_rejects_batch_without_partial_commit(self):
        self.write([{}, {'判定时间':'2026-02-30 10:00:00'}])
        source, _ = self.source()
        result = store.import_files(self.db,source)
        self.assertEqual((result['errors'],result['importedRows']),(1,0))
        self.assertIn('第3行',result['files'][0]['error'])
        self.assertEqual(store.revision(self.db),0)
        self.assertEqual(store.catalog(self.db,source)['files'],0)

    def test_remapping_requires_reimport_and_keeps_prior_batches_inactive(self):
        self.write([{}, {'判定时间':'2026-11-03 09:30:00'}])
        source, _ = self.source()
        old = deepcopy(source)
        old['mapping']['date'] = self.column(source,'报告时间')
        self.assertEqual(store.import_files(self.db,old)['importedRows'],2)
        self.assertEqual(store.catalog(self.db,old)['dates'],['2026-11-01'])
        self.assertEqual(store.scan(self.db,source)['files'][0]['status'],'待核对')
        with self.assertRaisesRegex(ValueError,'映射已改变'):
            store.load_rows(self.db,source)
        result = store.import_files(self.db,source)
        self.assertTrue(result['rebuilding'])
        self.assertEqual([r['date'] for r in store.load_rows(self.db,source)],['2026-11-02','2026-11-03'])
        self.assertEqual(store.catalog(self.db,source)['dates'],['2026-11-02','2026-11-03'])
        self.assertEqual(self.db.execute('SELECT count(*) FROM files WHERE active=0').fetchone()[0],1)
        self.assertEqual(store.import_files(self.db,source)['files'][0]['status'],'跳过重复文件')

    def test_explicit_judgment_shift_rule_keeps_night_after_midnight_on_previous_day(self):
        self.write([{'判定时间':'2026-11-03 02:15:00'}, {'判定时间':'2026-11-03 08:30:00'}])
        source, _ = self.source()
        source['calendar'] = {'mode':'check-time','timeColumn':self.column(source,'判定时间'),'dateBasis':'start'}
        rows, _, _ = tabular.read_records(self.path,source)
        self.assertEqual([(r['date'],r['shift']) for r in rows],[('2026-11-02','晚班'),('2026-11-03','白班')])
        source['calendar']['timeColumn'] = self.column(source,'报告时间')
        with self.assertRaisesRegex(ValueError,'仍按其他时间列归日'):
            tabular.read_records(self.path,source)
        source['calendar']['dateBasis'] = 'mapped'
        self.assertTrue(all(r['date']=='2026-11-03' for r in tabular.read_records(self.path,source)[0]))

    def test_home_daily_preview_and_rates_share_judgment_dates(self):
        self.write([{'数量':2}])
        source, _ = self.source()
        store.import_files(self.db,source)
        folder = self.root/'production'
        folder.mkdir()
        path = folder/'production.csv'
        path.write_text('日期,工序,班次,产量\n2026-11-01,装管,白班,999\n2026-11-02,装管,白班,100\n',encoding='utf-8-sig')
        production = {**source,'id':'production','name':'合成产量','kind':'production','folder':str(folder),'sheet':'','headerRow':0}
        info = tabular.inspect(path,production)
        production.update({key:info[key] for key in ('sheet','headerRow','mapping','columns','schema')})
        self.assertEqual(store.import_files(self.db,production)['errors'],0)
        query = {'range':'custom','start':'2026-11-02','end':'2026-11-02','filters':[]}
        config = {'sources':[source,production],'activeSource':'defects',
                  'sharedAnalysis':{'sourceId':'defects','period':'day','query':query},
                  'dailyReports':{'defects':{'includeRate':True,'productionId':'production'}}}
        result = analysis.analyze(self.db,source,production,query)
        self.assertEqual((result['quantity'],result['production'],result['rate']['value']),(2,100,.02))
        preview = service.handle(self.db,{'action':'previewDailyRate','config':config,'sourceId':'defects',
                    'query':query,'revision':store.revision(self.db)})
        self.assertEqual(preview['trend'][0]['rate'],.02)
        home = service.handle(self.db,{'action':'home','config':config,
                    'query':{'start':'2026-11-02','end':'2026-11-02','grain':'day','filters':{}}})
        self.assertEqual(home['quantity'],2)
        self.assertEqual(home['availableRange'],{'start':'2026-11-02','end':'2026-11-02'})

    def test_original_bi_fallback_and_production_preference_are_unchanged(self):
        path=self.root/'bi.csv'
        path.write_text('Check Date,Work Date,Failure Code,Quantity\n,2026-11-02,合成不良,1\n',encoding='utf-8-sig')
        info=tabular.inspect(path,{'kind':'defects','sheet':'','headerRow':0,'dateFormat':'ymd'})
        self.assertEqual(next(c['label'] for c in info['columns'] if c['id']==info['mapping']['date']),'Work Date')
        self.assertEqual(info['dateFallback']['missingCheckDates'],1)
        path.write_text('日期,判定时间,工序,班次,产量\n2026-11-02,2026-11-03,装管,白班,100\n',encoding='utf-8-sig')
        info=tabular.inspect(path,{'kind':'production','sheet':'','headerRow':0})
        self.assertEqual(next(c['label'] for c in info['columns'] if c['id']==info['mapping']['date']),'日期')

    @unittest.skipUnless(os.environ.get('BK_ORIGINAL_TEMPLATE'), 'Local target workbook not supplied')
    def test_real_workbook_judgment_dates_read_only(self):
        path=Path(os.environ['BK_ORIGINAL_TEMPLATE'])
        before=hashlib.sha256(path.read_bytes()).hexdigest()
        source={'kind':'defects','sheet':'container','headerRow':0,'dateFormat':'ymd','cutoff':0}
        info=tabular.inspect(path,source)
        source.update({key:info[key] for key in ('mapping','columns','schema','headerRow')})
        self.assertEqual(source['mapping']['date'],info['decisionDateColumn'])
        rows, report, dates=tabular.read_records(path,source)
        self.assertTrue(rows)
        judgment=self.column(source,'判定时间')
        self.assertTrue(all(row['date']==tabular.parse_date(row['values'][judgment],fmt='ymd') for row in rows))
        self.assertNotIn('',dates)
        self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(),before)


if __name__=='__main__':
    unittest.main()
