"""Real synthetic XLSX, exact item filtering, denominators and export readback."""
from pathlib import Path
import hashlib
import importlib.util
import os
import unittest
import uuid

PLATFORM=Path(__file__).resolve().parents[1]
ROOT=Path(os.environ['PLATFORM_QA_ROOT'])/('defect-export-'+uuid.uuid4().hex)
ROOT.mkdir(parents=True)
spec=importlib.util.spec_from_file_location('defect_worker',PLATFORM/'desktop/bi-worker.py')
worker=importlib.util.module_from_spec(spec);spec.loader.exec_module(worker)
worker.prepare(PLATFORM.parent/'bi',ROOT/'initial')
import daily
import daily_analysis
import daily_report
import openpyxl

class DefectTests(unittest.TestCase):
    def setUp(self):
        self.base=ROOT/uuid.uuid4().hex;self.base.mkdir()
        self.file=self.base/'synthetic.xlsx'
        book=openpyxl.Workbook();sheet=book.active
        sheet.append(['Work Date','Workflow Category in Charge','Employee in Charge','Resource Name Category','Connector Type','Shift','Sum of Qty','Disposition Type','Defect Code'])
        for date,process,person,item,quantity in [('2026-10-29','装管','甲','装管反',4),('2026-10-29','装管','乙','装管反',6),('2026-10-29','装管','乙','装管不到位',12),('2026-10-30','装管','甲','装管反面',3),('2026-10-30','测试','甲','装管反',5),('2026-10-30','装管','丙','装管不到位',2)]:
            sheet.append([date,process,person,'BK_5F','MPO-MPO','白班',quantity,'Scrap',item])
        book.save(self.file);book.close()
        daily.ingest(self.base,{'path':str(self.file),'kind':'quality','scope':'Synthetic'})
        self.query={'scope':'Synthetic','start':'2026-10-29','end':'2026-10-30','status':'','items':['装管反']}
        self.before=hashlib.sha256(self.file.read_bytes()).hexdigest()
    def test_exact_item_updates_every_chart_trend_and_detail(self):
        result=daily.analyze(self.base,self.query)
        self.assertEqual(result['quantity'],15);self.assertEqual(result['count'],3)
        self.assertEqual([row['qty'] for row in result['trend']],[10,5])
        self.assertEqual([row['name'] for row in result['charts'][1]['rows']],['装管反'])
        self.assertEqual(sum(row['qty'] for row in result['charts'][0]['rows']),15)
        self.assertTrue(all(row['item']=='装管反' for row in result['rows']))
        self.assertEqual(hashlib.sha256(self.file.read_bytes()).hexdigest(),self.before)
    def test_multiple_and_missing_selection_never_silently_widen(self):
        self.assertEqual(daily.analyze(self.base,dict(self.query,items=['装管反','装管不到位']))['quantity'],29)
        self.assertEqual(daily.analyze(self.base,dict(self.query,items=[]))['quantity'],32)
        empty=daily.analyze(self.base,dict(self.query,items=['不存在的不良项']))
        self.assertEqual(empty['quantity'],0);self.assertEqual(empty['rows'],[])
        self.assertTrue(any('保留选择' in warning for warning in empty['warnings']))
    def test_employee_denominator_is_the_selected_defects_for_all_people_in_process(self):
        result=daily.analyze(self.base,dict(self.query,employees=['甲']))
        self.assertEqual(result['quantity'],9)
        chart=next(chart for chart in result['charts'] if chart['title'].startswith('装管｜'))
        self.assertEqual(chart['rows'][0]['qty'],4);self.assertAlmostEqual(chart['rows'][0]['share'],.4)
    def test_export_contains_only_selected_raw_rows_and_explicit_selection(self):
        result=daily.analyze(self.base,self.query)
        exported=daily.export_report(self.base,{'query':self.query,'expected_revision':result['revision']})
        book=openpyxl.load_workbook(Path(exported['path'])/'日报明细.xlsx',read_only=True,data_only=False)
        try:
            rows=list(book['原始记录'].values);self.assertEqual(len(rows),4)
            item_column=rows[0].index('Defect Code');self.assertEqual({row[item_column] for row in rows[1:]},{'装管反'})
            self.assertIn(('不良项筛选','装管反'),list(book['日报汇总'].values))
        finally:book.close()
        self.assertTrue(exported['summary'].startswith('不良项筛选：装管反'))
        self.assertEqual(exported['status'],'等待图片')
    def test_changed_selection_rejects_old_export_preview(self):
        preview=daily.analyze(self.base,self.query)
        with self.assertRaises(ValueError):daily.export_report(self.base,{'query':dict(self.query,items=['装管不到位']),'expected_revision':preview['revision']})
    def test_invalid_selection_is_rejected_without_interpreting_a_substring(self):
        for value in ('装管反',[None],[''],['x\n'],['x'*513]):
            with self.assertRaises(ValueError):daily.analyze(self.base,dict(self.query,items=value))
        query=dict(self.query,items=['装管反','装管反']);result=daily.analyze(self.base,query)
        self.assertEqual(result['applied_query']['items'],['装管反']);self.assertEqual(query['items'],['装管反','装管反'])
    def test_week_month_periods_and_original_empty_selection_stay_consistent(self):
        self.assertEqual(daily.analyze(self.base,dict(self.query,period='week'))['trend'],[{'name':'2026-10-26','qty':15}])
        self.assertEqual(daily.analyze(self.base,dict(self.query,period='month'))['trend'],[{'name':'2026-10','qty':15}])
        self.assertEqual(set(daily.analyze(self.base,self.query)['options']['item']),{'装管反','装管反面','装管不到位'})
    def test_defect_selection_does_not_shrink_production_or_invent_a_rate(self):
        source=self.base/'production.xlsx';book=openpyxl.Workbook();sheet=book.active
        sheet.append(['日期','工序','产量','单位']);sheet.append(['2026-10-29','装管',100,'pcs']);sheet.append(['2026-10-30','测试',200,'pcs']);book.save(source);book.close()
        daily.ingest(self.base,{'path':str(source),'kind':'production','scope':'Prod'})
        result=daily.analyze(self.base,dict(self.query,production_scope='Prod',employees=['甲']))
        self.assertEqual(result['quantity'],9);self.assertEqual(sum(row['qty'] for row in result['production']),300)
        self.assertNotIn('rate',result)
    def test_filter_name_that_looks_like_a_formula_remains_literal_in_workbook(self):
        query=dict(self.query,items=['=1+1']);result=daily.analyze(self.base,query)
        output=daily.export_report(self.base,{'query':query,'expected_revision':result['revision']})
        book=openpyxl.load_workbook(Path(output['path'])/'日报明细.xlsx')
        try:
            cell=book['日报汇总'].cell(book['日报汇总'].max_row,2)
            self.assertEqual(cell.value,'=1+1');self.assertEqual(cell.data_type,'s')
        finally:book.close()

if __name__=='__main__':unittest.main()
