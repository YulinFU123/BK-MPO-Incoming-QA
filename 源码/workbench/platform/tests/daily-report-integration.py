"""Integration checks for explicit production binding and native daily-rate export."""
import csv
from io import BytesIO
import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
from xml.etree import ElementTree as ET
from zipfile import ZipFile

import openpyxl
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'desktop'))
from lab_engine import original_report, rate_report, service, store, tabular


class DailyReportTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory(dir=os.environ.get('PLATFORM_TEST_ROOT'))
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.db = store.connect(self.root / 'db')
        self.addCleanup(self.db.close)
        self.sources = []

    def source(self, kind, headers, rows, **extra):
        folder = self.root / kind
        folder.mkdir(exist_ok=True)
        path = folder / 'daily.csv'
        with path.open('w', encoding='utf-8-sig', newline='') as out:
            csv.writer(out).writerows([headers, *rows])
        src = dict(id=kind, name=kind, kind=kind, folder=str(folder), sheet='', headerRow=0,
                   cutoff=0, dateFormat='ymd', unit='units', coverage='daily_complete',
                   dateFromFilename=False, uniqueColumns=[], updateMode='replace_dates', **extra)
        info = tabular.inspect(path, src)
        src.update(sheet=info['sheet'], headerRow=info['headerRow'], schema=info['schema'],
                   columns=info['columns'], mapping=info['mapping'], confirmed=True)
        if kind == 'defects' and '判定原因' in headers:
            src['mapping']['defect'] = next(c['id'] for c in info['columns'] if c['label'] == '判定原因')
        result = store.import_files(self.db, src)
        self.assertEqual(result['errors'], 0, result)
        self.sources.append(src)
        return src, result

    def prepare(self):
        self.defects, _ = self.source('defects', ['日期','工序','班次','不良项','数量'], [
            ['2026-11-01','装管','夜班','装管反',2], ['2026-11-01','装管','夜班','断裂',3],
            ['2026-11-02','装管','夜班','装管反',10]])
        self.production, imported = self.source('production', ['日期','在制工序','班次','当日产能（有公式）'], [
            ['2026-11-01','装管台','晚班',100], ['日期','在制工序','班次','当日产能（有公式）'],
            ['2026-11-02','装管台','晚班',200]],
            productionBinding={'layout':'rows','fillDown':[], 'processAliases':{'装管台':'装管'}, 'shiftAliases':{'晚班':'夜班'}})
        self.assertIn('跳过 1 行重复表头', imported['files'][0]['warning'])
        self.settings = dict(includeRate=True, productionId='production', rateTitle='每日不良率趋势', period='day', rateBasis='selected-defects')
        self.body = dict(action='previewDailyRate', sourceId='defects', revision=store.revision(self.db),
                         config={'sources':self.sources,'dailyReports':{'defects':self.settings}},
                         query={'range':'custom','start':'2026-11-01','end':'2026-11-02','filters':[
                             {'field':'defect','op':'in','values':['装管反']}], 'dimension':'date','metric':'quantity'})

    def test_selected_defects_rate_is_explicit_and_weighted(self):
        self.prepare()
        result = service.handle(self.db, self.body)
        self.assertEqual([p['quantity'] for p in result['trend']], [2,10])
        self.assertEqual([p['production'] for p in result['trend']], [100,200])
        self.assertEqual([p['rate'] for p in result['trend']], [.02,.05])
        self.assertAlmostEqual(result['summary']['rate'], .04)
        self.settings['rateBasis'] = 'same-scope'
        strict = service.handle(self.db, self.body)
        self.assertTrue(all(p['rate'] is None for p in strict['trend']))
        self.assertIn('不良项', strict['summary']['rateReason'])

    def test_worker_uses_saved_reason_groups_only_in_reason_columns_layout(self):
        source, _ = self.source('defects', ['日期', '工序', '班次', '判定原因', '数量'], [
            ['2026-11-01', '装管', '白班', 'CN-MPO断裂', 2],
        ])
        persisted = [{'name': '保存组合', 'reasons': ['CN-MPO断裂', 'T-MPO断裂']}]
        settings = {'reasonGroups': persisted}
        request = {
            'action': 'exportOriginalReport', 'sourceId': source['id'], 'revision': store.revision(self.db),
            'config': {'sources': [source], 'dailyReports': {source['id']: settings}},
            'query': {'range': 'all', 'filters': []},
            'template': '模板.xlsx', 'output': '输出.xlsx',
            'reasonGroups': [{'name': '未保存参数', 'reasons': ['别的原始原因']}],
        }
        with patch.object(original_report, 'export') as native_export, patch.object(
                original_report, 'template_daily_groups', return_value=()) as template_groups:
            for layout in ('original', 'readable', 'hidden', 'reason-columns'):
                with self.subTest(layout=layout):
                    settings['chartLayout'] = layout
                    service.handle(self.db, request)
                    self.assertEqual(native_export.call_args.kwargs['chart_layout'], layout)
                    self.assertEqual(native_export.call_args.kwargs['reason_groups'],
                                     persisted if layout == 'reason-columns' else ())
                    self.assertEqual(len(native_export.call_args.args[3]), 1)
                    self.assertIsNone(native_export.call_args.kwargs['rate_report'])
            del settings['reasonGroups']
            service.handle(self.db, request)
            self.assertEqual(native_export.call_args.kwargs['reason_groups'], ())
            self.assertEqual(template_groups.call_count, 2)

    def test_one_off_reasons_replace_only_reason_filter_and_restrict_export_population(self):
        source, _ = self.source('defects', ['日期', '工序', '班次', '判定原因', '数量'], [
            ['2026-11-01', '装管', '白班', '断裂', 1],
            ['2026-11-01', '装管', '白班', '破皮', 2],
            ['2026-11-01', '装管', '白班', '装管反', 3],
            ['2026-11-01', '装管', '白班', '疑似装管反', 4],
            ['2026-11-01', '测试', '白班', '装管反', 5],
            ['2026-11-02', '装管', '白班', '装管反', 6],
        ])
        field = source['mapping']['defect']
        settings = {'sheetReasons': ['断裂']}
        request = dict(action='exportOriginalReport', sourceId=source['id'], revision=store.revision(self.db),
                       config={'sources': [source], 'dailyReports': {source['id']: settings}},
                       query={'range':'custom', 'start':'2026-11-01', 'end':'2026-11-01', 'filters': [
                           {'field': 'defect', 'op': 'in', 'values': ['断裂']},
                           {'field': 'process', 'op': 'in', 'values': ['装管']},
                       ]}, template='模板.xlsx', output='输出.xlsx')
        with patch.object(original_report, 'export') as native_export, patch.object(
                original_report, 'template_daily_groups', return_value=()):
            for layout in ('readable', 'reason-columns'):
                settings['chartLayout'] = layout
                service.handle(self.db, {**request, 'reportReasons': ['装管反', '破皮']})
                rows = native_export.call_args.args[3]
                self.assertCountEqual([row['values'][field] for row in rows], ['装管反', '破皮'])
                self.assertEqual(sum(row['quantity'] for row in rows), 5)
                if layout == 'reason-columns':
                    self.assertIsNone(native_export.call_args.kwargs['sheet_reasons'])
            service.handle(self.db, request)
            self.assertEqual([r['values'][field] for r in native_export.call_args.args[3]], ['断裂'])
            self.assertEqual(native_export.call_args.kwargs['sheet_reasons'], ['断裂'])
            native_export.reset_mock()
            with self.assertRaisesRegex(ValueError, '没有记录'):
                service.handle(self.db, {**request, 'reportReasons': ['不存在']})
            native_export.assert_not_called()

    @unittest.skipUnless(os.environ.get('BK_ANALYZED_TEMPLATE'), 'Local analyzed layout template required')
    def test_one_off_reasons_generate_matching_total_and_category_sheets(self):
        headers = [*original_report.HEADERS, '班次']
        field_values = {'数量': 1, '工序': '装管', '班次': '白班', '报告时间': '2026-11-01 09:00:00',
                        '判定时间': '2026-11-01 10:00:00', '责任人': '合成测试人员'}
        rows = [[{**field_values, '容器号': f'QA-{index}', '判定原因': reason}.get(header, '') for header in headers]
                for index, reason in enumerate(['断裂', '装管反', '疑似装管反'], 1)]
        source, _ = self.source('defects', headers, rows)
        output = self.root / '所选原因.xlsx'
        request = dict(action='exportOriginalReport', sourceId=source['id'], revision=store.revision(self.db),
                       config={'sources': [source], 'dailyReports': {source['id']: {
                           'chartLayout': 'reason-columns', 'sheetReasons': ['断裂'],
                       }}}, query={'range': 'all', 'filters': [{'field': 'defect', 'op': 'in', 'values': ['断裂']}]},
                       reportReasons=['装管反'], template=os.environ['BK_ANALYZED_TEMPLATE'], output=str(output))
        preview = service.handle(self.db, {**request, 'action': 'previewDailyRate'})
        self.assertEqual([point['quantity'] for point in preview['trend']], [1])
        result = service.handle(self.db, request)
        self.assertEqual(result['recordCount'], 1)
        self.assertEqual(result['groups'], {'装管反': 1})
        book = openpyxl.load_workbook(output, read_only=True, data_only=True)
        try:
            self.assertIn('装管反', book.sheetnames)
            self.assertNotIn('断裂', book.sheetnames)
            for sheet_name in ('总表', '装管反'):
                rows = list(book[sheet_name].iter_rows(values_only=True))
                exported = [row for row in rows if 'QA-2' in row]
                self.assertEqual(len(exported), 1)
                self.assertIn('装管反', exported[0])
                self.assertFalse(any('QA-1' in row or 'QA-3' in row for row in rows))
        finally:
            book.close()

    def test_binding_changes_invalidate_import_and_missing_sources_do_not_substitute(self):
        self.prepare()
        before = store.mapping_hash(self.production)
        self.production['productionBinding']['shiftAliases'] = {}
        self.assertNotEqual(before, store.mapping_hash(self.production))
        with self.assertRaisesRegex(ValueError, '映射已改变'):
            service.handle(self.db, self.body)
        self.settings['productionId'] = 'missing'
        with self.assertRaisesRegex(ValueError, '绑定已确认'):
            service.handle(self.db, self.body)

    def test_manual_amount_uses_typed_rows_without_falling_back_to_bound_source(self):
        self.prepare()
        suggestion = service.handle(self.db, {**self.body, 'action':'dailyProductionCohorts'})
        self.assertEqual([r['quantity'] for r in suggestion['cohorts']], [2,10])
        self.settings.update(productionMode='manual', manualProduction=[
            {'date':'2026-11-01','process':'装管','shift':'夜班','quantity':400}])
        result = service.handle(self.db, self.body)
        self.assertEqual([p['production'] for p in result['trend']], [400,None])
        self.assertEqual([p['rate'] for p in result['trend']], [.005,None])
        self.assertIsNone(result['summary']['rate'])
        self.assertIn('未手填产量', result['trend'][1]['rateReason'])
        self.settings['manualProduction'].append(
            {'date':'2026-11-02','process':'装管','shift':'夜班','quantity':0})
        self.assertIn('分母为零', service.handle(self.db, self.body)['trend'][1]['rateReason'])
        self.settings['manualProduction'][-1]['quantity'] = 600
        result = service.handle(self.db, self.body)
        self.assertAlmostEqual(result['summary']['rate'], .012)
        self.assertEqual(result['productionName'], '日报手填产量')
        self.settings['manualProduction'].append({**self.settings['manualProduction'][0]})
        with self.assertRaisesRegex(ValueError, '已存在'):
            service.handle(self.db, self.body)

    def test_manual_defect_type_scope_requires_other_observed_shifts_and_supports_raw_decision_reason(self):
        source, _ = self.source('defects', ['日期','工序','班次','不良项','判定原因','数量'], [
            ['2026-11-01','装管','白班','报告代码甲','断裂',2],
            ['2026-11-01','装管','晚班','报告代码乙','装管反',6],
        ])
        source['mapping']['defect'] = next(c['id'] for c in source['columns'] if c['label']=='不良项')
        store.import_files(self.db, source)
        id = next(c['id'] for c in source['columns'] if c['label']=='判定原因')
        settings = {'includeRate':True,'productionMode':'manual','rateBasis':'selected-defects',
                    'manualProduction':[{'date':'2026-11-01','process':'装管','shift':'白班','quantity':200}]}
        request = {'action':'dailyProductionCohorts','sourceId':'defects','revision':store.revision(self.db),
                   'config':{'sources':[source],'dailyReports':{'defects':settings}},
                   'query':{'range':'all','filters':[{'field':id,'op':'equals','values':['断裂']}]}}
        cohorts = service.handle(self.db, request)['cohorts']
        self.assertEqual({r['shift']:r['quantity'] for r in cohorts}, {'白班':2,'晚班':0})
        request['action'] = 'previewDailyRate'
        self.assertIsNone(service.handle(self.db, request)['summary']['rate'])
        settings['manualProduction'].append({'date':'2026-11-01','process':'装管','shift':'晚班','quantity':300})
        result = service.handle(self.db, request)
        self.assertEqual((result['summary']['quantity'],result['summary']['production'],result['summary']['rate']),
                         (2,500,.004))

    def test_units_and_stale_data_are_not_silently_accepted(self):
        self.prepare()
        self.defects['unit'] = 'events'
        result = service.handle(self.db, self.body)
        self.assertIsNone(result['summary']['rate'])
        self.assertIn('按件去重', result['summary']['rateReason'])
        self.body['revision'] = -1
        with self.assertRaisesRegex(ValueError, '已更新'):
            service.handle(self.db, self.body)

    def blank_sn_export(self):
        headers = [*original_report.HEADERS, '班次', '自定义SN']
        rows = []
        for sn, count in [('SN-1', 2), ('', 10)]:
            values = {'容器号':sn, '自定义SN':sn, '数量':count, '工序':'装管', '班次':'白班',
                      '报告时间':'2026-10-31', '判定时间':'2026-11-01', '判定原因':'装管反', '责任人':'合成验证人员'}
            rows.append([values.get(name, '') for name in headers])
        source, _ = self.source('defects', headers, rows)
        self.source('production', ['日期','工序','班次','产量'],
                    [['2026-11-01','装管','白班',100]])
        settings = {'includeRate':True,'productionId':'production','period':'day'}
        body = {
            'sourceId':'defects', 'revision':store.revision(self.db),
            'template':os.environ.get('BK_ORIGINAL_TEMPLATE', str(self.root / 'unneeded-template.xlsx')),
            'output':str(self.root / '空SN验证.xlsx'),
            'config':{'sources':self.sources,'dailyReports':{'defects':settings}},
            'query':{'range':'custom','start':'2026-11-01','end':'2026-11-01','filters':[]},
        }
        return source, settings, body

    def test_blank_sn_blocks_preview_and_rate_export_with_same_message_and_no_artifact(self):
        source, _, body = self.blank_sn_export()
        alternate = next(c['id'] for c in source['columns'] if c['label'] == '自定义SN')
        for mapping in (None, {'容器号':alternate}):
            with self.subTest(template_map=mapping):
                request = {**body, **({'templateMap':mapping} if mapping else {})}
                messages = []
                for action in ('previewDailyRate', 'exportOriginalReport'):
                    with self.assertRaisesRegex(ValueError, '1 条容器号/SN为空') as error:
                        service.handle(self.db, {**request, 'action':action})
                    messages.append(str(error.exception))
                    self.assertFalse(Path(body['output']).exists())
                self.assertEqual(messages[0], messages[1])
                self.assertIn('补齐', messages[0])
                self.assertIn('取消附加不良率', messages[0])
        # Applying the suggested filter restores a matching numerator of 2.
        body['query']['filters'] = [{'field':alternate,'op':'notEmpty','values':[]}]
        # A template-only SN filter cannot be applied to production; the result
        # still retains the established conservative rate-scope validation.
        preview = service.handle(self.db, {**body, 'action':'previewDailyRate'})
        self.assertEqual(preview['summary']['quantity'], 2)

    @unittest.skipUnless(os.environ.get('BK_ORIGINAL_TEMPLATE'), 'Local reference template required')
    def test_blank_sn_quantity_only_export_retains_previous_skip_behavior(self):
        _, settings, body = self.blank_sn_export()
        settings['includeRate'] = False
        result = service.handle(self.db, {**body, 'action':'exportOriginalReport'})
        self.assertEqual(result['recordCount'], 1)
        self.assertEqual(result['skippedBlankSn'], 1)
        self.assertNotIn('rateReport', result)
        self.assertNotIn('不良率趋势', result['sheets'])
        self.assertTrue(Path(body['output']).is_file())

    @unittest.skipUnless(os.environ.get('BK_ORIGINAL_TEMPLATE'), 'Local reference template required')
    def test_worker_export_keeps_categories_and_appends_rate_sheet_in_one_workbook(self):
        template = Path(os.environ['BK_ORIGINAL_TEMPLATE'])
        with ZipFile(template) as archive:
            reason = original_report.rules(archive, template).categories[0].reasons[0]
        headers = [*original_report.HEADERS, '班次']
        rows = []
        for day, count in [('2026-11-01',2), ('2026-11-02',10)]:
            values = {'容器号':day, '数量':count, '工序':'装管', '班次':'白班',
                      '报告时间':'2026-10-31', '判定时间':day, '判定原因':reason, '责任人':'合成验证人员'}
            rows.append([values.get(name, '') for name in headers])
        self.source('defects', headers, rows)
        self.source('production', ['日期','工序','班次','产量'],
                    [['2026-11-01','装管','白班',100], ['2026-11-02','装管','白班',200]])
        output = self.root / '含不良率的目标表.xlsx'
        request = {
            'action':'exportOriginalReport', 'sourceId':'defects', 'revision':store.revision(self.db),
            'template':str(template), 'output':str(output),
            'config':{'sources':self.sources,'dailyReports':{'defects':{
                'includeRate':True,'productionId':'production','period':'day'}}},
            'query':{'range':'custom','start':'2026-11-01','end':'2026-11-02','filters':[]},
        }
        result = service.handle(self.db, request)
        self.assertEqual(result['recordCount'],2)
        self.assertEqual(result['rateReport']['validPoints'],2)
        self.assertEqual(result['sheets'][-1],'不良率趋势')
        book = openpyxl.load_workbook(output)
        self.assertGreater(len(book['总表']._charts), 0)
        self.assertEqual(len(book['不良率趋势']._charts), 1)
        self.assertEqual(book['不良率趋势']._charts[0].series[0].dLbls.showVal, True)
        book.close()
        daily = request['config']['dailyReports']['defects']
        daily.update(productionMode='manual', chartLayout='readable', manualProduction=[
            {'date':'2026-11-01','process':'装管','shift':'白班','quantity':200},
            {'date':'2026-11-02','process':'装管','shift':'白班','quantity':400},
        ])
        manual_file = self.root / '手填产量分页目标表.xlsx'
        manual = service.handle(self.db, {**request, 'output':str(manual_file)})
        self.assertEqual(manual['chartLayout'], 'readable')
        self.assertEqual(manual['totalChartPages'], 1)
        self.assertAlmostEqual(manual['rateReport']['overallRate'], .02)
        with manual_file.open('rb') as file:
            book = openpyxl.load_workbook(file, data_only=True)
            try:
                self.assertIn('判定原因汇总', book.sheetnames)
                self.assertEqual(book['不良率趋势']['C24'].value, 200)
                self.assertAlmostEqual(book['不良率趋势']['D24'].value, .01)
            finally:
                book.close()

    def test_pending_production_is_not_a_real_zero_or_a_partial_denominator(self):
        defect, _ = self.source('defects', ['日期','工序','班次','不良项','数量'],
            [['2026-11-01','装管','白班','装管反',2]])
        self.source('production', ['日期','工序','班次','产量'],
            [['2026-11-01','装管','白班','   ']],
            productionBinding={'layout':'rows','fillDown':[], 'processAliases':{}, 'shiftAliases':{}, 'missingQuantity':'pending'})
        result = service.handle(self.db, {'action':'previewDailyRate','sourceId':'defects',
            'revision':store.revision(self.db),'query':{'range':'all','filters':[]},
            'config':{'sources':self.sources,'dailyReports':{'defects':{'includeRate':True,'productionId':'production'}}}})
        self.assertIsNone(result['trend'][0]['rate'])
        self.assertIsNone(result['trend'][0]['production'])
        self.assertIn('尚未填写',result['trend'][0]['rateReason'])

    @unittest.skipUnless(os.environ.get('BK_ORIGINAL_TEMPLATE'), 'Local reference template required')
    def test_native_rate_sheet_keeps_all_original_charts_and_caches_percent_labels(self):
        self.prepare()
        report = service.handle(self.db, self.body)
        report['title'] = '日报' * 70
        source = Path(os.environ['BK_ORIGINAL_TEMPLATE']).read_bytes()
        result, info = rate_report.append_trend(source, report)
        self.assertEqual(info['validPoints'], 2)
        self.assertAlmostEqual(info['overallRate'], .04)
        with ZipFile(BytesIO(source)) as old, ZipFile(BytesIO(result)) as new:
            self.assertIsNone(new.testzip())
            for part in old.namelist():
                if part.startswith(('xl/charts/', 'xl/pivotTables/', 'xl/pivotCache/', 'xl/drawings/')):
                    self.assertEqual(old.read(part), new.read(part), part)
            chart = ET.fromstring(new.read('xl/charts/rateTrend1.xml'))
            ns = {'c': original_report.C}
            self.assertEqual(chart.find('.//c:dLbls/c:showVal', ns).get('val'), '1')
            self.assertEqual(chart.find('.//c:dLbls/c:numFmt', ns).get('formatCode'), '0.00%')
            cache = chart.findall('.//c:val/c:numRef/c:numCache/c:pt/c:v', ns)
            self.assertEqual([float(p.text) for p in cache], [.02,.05])
        book = openpyxl.load_workbook(BytesIO(result), data_only=True, read_only=True)
        self.assertIn(info['sheet'], book.sheetnames)
        self.assertAlmostEqual(book[info['sheet']]['D24'].value, .02)
        book.close()

    @unittest.skipUnless(os.environ.get('BK_ORIGINAL_TEMPLATE'), 'Local reference template required')
    def test_month_of_labelled_points_paginates_and_keeps_missing_days_as_gaps(self):
        report = {'title':'完整月份不良率', 'period':'day', 'trend':[
            {'label':f'2026-10-{day:02}', 'quantity':day, 'production':1000,
             'rate':day / 1000 if day != 16 else None,
             'rateReason':'' if day != 16 else '该日期产量待核对'}
            for day in range(1,32)]}
        payload, info = rate_report.append_trend(Path(os.environ['BK_ORIGINAL_TEMPLATE']).read_bytes(), report)
        self.assertEqual(info['validPoints'],30)
        self.assertIsNone(info['overallRate'])
        book = openpyxl.load_workbook(BytesIO(payload))
        sheet = book[info['sheet']]
        self.assertEqual(len(sheet._charts),3)
        self.assertEqual(len(sheet.row_breaks.brk),2)
        self.assertEqual(sheet.page_setup.orientation, 'landscape')
        with ZipFile(BytesIO(payload)) as archive:
            for part in archive.namelist():
                if part.startswith('xl/charts/rateTrend') and part.endswith('.xml'):
                    chart = ET.fromstring(archive.read(part))
                    self.assertEqual(chart.find('.//{'+original_report.C+'}dispBlanksAs').get('val'), 'gap')
        self.assertTrue(all(chart.series[0].dLbls.showVal for chart in sheet._charts))
        book.close()

    @unittest.skipUnless(os.environ.get('BK_PRODUCTION_TEMPLATE'), 'Local production workbook required')
    def test_real_production_long_table_binds_populated_columns_and_actual_output(self):
        path = Path(os.environ['BK_PRODUCTION_TEMPLATE'])
        src = {'kind':'production','sheet':'11月生产跟踪表','headerRow':0}
        info = tabular.inspect(path, src)
        cols = {c['id']:c for c in info['columns']}
        self.assertEqual(cols[info['mapping']['date']]['index'], 1)
        self.assertEqual(cols[info['mapping']['process']]['index'], 3)
        self.assertEqual(cols[info['mapping']['quantity']]['index'], 6)
        src.update(schema=info['schema'], mapping=info['mapping'], columns=info['columns'], headerRow=info['headerRow'])
        src['productionBinding'] = {'layout':'rows','fillDown':[], 'processAliases':{}, 'shiftAliases':{}, 'missingQuantity':'pending'}
        rows, detail, _ = tabular.read_records(path, src)
        self.assertGreater(len(rows), 0)
        self.assertGreater(detail['productionImport']['skippedHeaderRows'], 0)
        self.assertGreater(detail['productionImport']['pendingQuantityRows'], 0)
        self.assertTrue(all(r['process'] and r['shift'] for r in rows))


if __name__ == '__main__':
    unittest.main()
