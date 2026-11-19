"""Synthetic XLSX -> guarded original BI -> SQLite -> analysis; no browser."""
from pathlib import Path
import datetime as dt
import hashlib
import importlib.util
import json
import os
import sys
import unittest
import uuid

PLATFORM = Path(__file__).resolve().parents[1]
ROOT = Path(os.environ['PLATFORM_QA_ROOT']) / ('inbox-integration-' + uuid.uuid4().hex)
ROOT.mkdir(parents=True)
spec = importlib.util.spec_from_file_location('worker_test', PLATFORM / 'desktop/bi-worker.py')
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)
panel, policy = worker.prepare(PLATFORM.parent / 'bi', ROOT / 'initial')
import daily
import bi_bridge
import openpyxl
spec = importlib.util.spec_from_file_location('inbox_test', PLATFORM / 'desktop/bi-inbox.py')
inbox = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inbox)

class InboxTests(unittest.TestCase):
    def setUp(self):
        self.base = ROOT / uuid.uuid4().hex
        self.folder = self.base / 'downloads'
        self.folder.mkdir(parents=True)
        self.clock = 100
        inbox.time.monotonic = lambda: self.clock
        self.config = {'folder':str(self.folder),'scope':'Synthetic A','floor':'BK_5F','replace':False}

    def file(self, quantity=3, date='2026-10-29', missing=False, verified=True):
        identity=uuid.uuid4().hex
        file=self.folder / ('NCX_'+identity+'.xlsx')
        book=openpyxl.Workbook();sheet=book.active
        sheet.append(['WORK_DATE 2026/10/29 当天或之后 2026/10/30 之前'])
        headers=['Work Date','Workflow Category in Charge','Employee in Charge','Resource Name Category','Connector Type','Shift','Sum of Qty','Disposition Type','Defect Code']
        sheet.append(headers[:-1] if missing else headers)
        sheet.append([date,'装管','合成人员','BK_5F','MPO-MPO','白班',quantity,'Scrap','Synthetic defect'])
        book.save(file);book.close()
        marker=self.folder / ('NCX_'+identity+'_complete.json')
        marker.write_text(json.dumps({'format':'BK-MPO-NCX-EXPORT','version':1,'runId':identity,'file':file.name,'source':'https://app.powerbi.com/groups/me/reports/synthetic','period':{'start':'2026-10-29','end':'2026-10-29'},'filterVerified':verified,'downloadComplete':True,'filters':{'floors':['BK_5F'],'connectors':['MPO-MPO']}}),encoding='utf-8')
        return file,marker

    def poll(self):return inbox.poll(self.base,self.config,daily,bi_bridge)
    def settle(self):self.poll();self.clock+=5;return self.poll()
    def test_actual_xlsx_dedup_analysis_and_original_bytes(self):
        file,marker=self.file();before=hashlib.sha256(file.read_bytes()).hexdigest()
        result=self.settle();row=result['results'][0]
        self.assertEqual(row['state'],'done');self.assertEqual(row['analysis']['quantity'],3)
        self.assertEqual(row['analysis']['count'],1);self.assertNotIn('rate',row['analysis'])
        self.assertEqual(self.poll()['results'],[])
        self.assertEqual(hashlib.sha256(file.read_bytes()).hexdigest(),before)
        self.assertEqual(len(daily.state(self.base)['history']),1)
    def test_failed_schema_or_date_is_not_imported(self):
        self.file(missing=True);result=self.settle();self.assertEqual(result['results'][0]['state'],'failed')
        self.assertEqual(daily.state(self.base)['history'],[])
    def test_wrong_business_date_cannot_enter_expected_period(self):
        self.file(date='2026-10-28');result=self.settle();self.assertEqual(result['results'][0]['state'],'failed')
        self.assertEqual(daily.state(self.base)['history'],[])
    def test_no_proof_or_path_traversal_is_rejected(self):
        file,marker=self.file(verified=False);self.assertEqual(self.poll()['results'][0]['state'],'failed')
        value=json.loads(marker.read_text());value['filterVerified']=True;value['file']='../private.xlsx';marker.write_text(json.dumps(value))
        self.assertEqual(self.poll()['results'][0]['state'],'failed');self.assertTrue(file.exists())
    def test_download_in_progress_does_not_become_zero_or_a_record(self):
        file,_=self.file();partial=file.with_suffix('.xlsx.crdownload');partial.write_bytes(b'partial')
        self.assertEqual(self.settle()['results'][0]['state'],'waiting');self.assertEqual(daily.state(self.base)['history'],[])
    def test_changed_same_day_requires_explicit_replacement_and_retains_old_snapshot(self):
        self.file();self.settle();self.file(quantity=7)
        result=self.settle();self.assertEqual(result['results'][0]['state'],'failed')
        self.assertEqual(len(daily.state(self.base)['history']),1)
        self.config['replace']=True;result=self.poll();self.assertEqual(result['results'][0]['state'],'done')
        history=daily.state(self.base)['history'];self.assertEqual(len(history),2);self.assertEqual(sum(row['active'] for row in history),1)
    def test_receipt_filename_must_match_exact_file_identity(self):
        file,marker=self.file();value=json.loads(marker.read_text());value['runId']=uuid.uuid4().hex;marker.write_text(json.dumps(value))
        self.assertEqual(self.poll()['results'][0]['state'],'failed');self.assertEqual(daily.state(self.base)['history'],[])
    def test_downloaded_floor_must_match_receipt_even_without_a_manual_floor_limit(self):
        _,marker=self.file();value=json.loads(marker.read_text());value['filters']['floors']=['BK_6F'];marker.write_text(json.dumps(value))
        self.config['floor']=''
        self.assertEqual(self.settle()['results'][0]['state'],'failed')
        self.assertEqual(daily.state(self.base)['history'],[])
    def test_repeated_identical_rows_do_not_create_another_active_snapshot(self):
        self.file();self.settle();self.file();result=self.settle()
        self.assertEqual(result['results'][0]['state'],'done')
        self.assertEqual(len(daily.state(self.base)['history']),1)

if __name__=='__main__':unittest.main()
