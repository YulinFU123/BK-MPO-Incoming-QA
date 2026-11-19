"""Synthetic-only report and recovery integration. Does not open the application UI."""
from pathlib import Path
import importlib.util,io,json,os,subprocess,sys,unittest,zipfile
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'desktop'))
from lab_engine import exports,service,store,tabular
import openpyxl
from pypdf import PdfReader

spec=importlib.util.spec_from_file_location('studio_fixture',Path(__file__).with_name('analysis-studio-integration.py'))
fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture)

class ReportTests(unittest.TestCase):
    def setUp(self):
        self.f=fixture.StudioTests();self.f.setUp();self.db=self.f.db
        self.source,self.production,self.query=self.f.fixture()
        self.config={'version':1,'sources':[self.source,self.production],'activeSource':'defects','productionSource':'production','tab':'day','views':{},'report':{'title':'{日期}{工序}失效人员','singlePage':True,'margin':8,'gap':4,'titleSize':24,'charts':[{'id':'chart1','sourceId':'defects','productionId':'production','period':'day','query':self.query,'title':'{日期}{不良项}{维度}','type':'bar','dimension':'employee','metric':'quantity','defect':''}]}}
        self.snapshot=service.handle(self.db,{'action':'reportData','config':self.config})
        node=os.environ.get('PLATFORM_NODE',r'C:\Users\yulinf\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe')
        script="const fs=require('node:fs'),a=require('./domain/a4-report');const x=JSON.parse(fs.readFileSync(0,'utf8'));process.stdout.write(JSON.stringify(a.compose(x.charts,x.settings,{title:x.title,subtitle:'合成数据验证'})));"
        run=subprocess.run([node,'-e',script],input=json.dumps({'charts':self.snapshot['charts'],'settings':self.config['report'],'title':self.snapshot['title']},ensure_ascii=False),encoding='utf-8',capture_output=True,cwd=Path(__file__).parents[1],check=True)
        self.plan=json.loads(run.stdout)
    def tearDown(self):self.f.tearDown()
    def body(self,fmt,name):return {'config':self.config,'format':fmt,'pages':self.plan['pages'],'snapshot':{'revision':self.snapshot['revision'],'signature':self.snapshot['signature']},'output':str(self.f.root/name)}
    def test_a4_quantity_and_record_counts_do_not_require_production(self):
        charts = self.config['report']['charts']
        charts[0]['productionId'] = ''
        charts.append({**charts[0], 'id':'rowCount', 'metric':'rows', 'dimension':'date'})
        result = service.handle(self.db, {'action':'reportData', 'config':self.config})
        self.assertEqual(sum(p['value'] for p in result['charts'][0]['data']), 5)
        self.assertEqual([p['value'] for p in result['charts'][1]['data']], [1, 1])
        charts[1]['metric'] = 'rate'
        with self.assertRaisesRegex(ValueError, '第2张图.*未选择产量数据源'):
            service.handle(self.db, {'action':'reportData', 'config':self.config})
    def test_pdf_real_chinese_text_landscape_dimensions_and_png(self):
        target=self.f.root/'报告.pdf';r=exports.export(self.db,self.body('pdf',target.name));self.assertEqual(r['pages'],1)
        reader=PdfReader(target);self.assertEqual(len(reader.pages),1);page=reader.pages[0]
        self.assertAlmostEqual(float(page.mediabox.width),297*72/25.4,places=3);self.assertAlmostEqual(float(page.mediabox.height),210*72/25.4,places=3)
        text=page.extract_text();self.assertIn('装管',text);self.assertIn('张三',text);self.assertIn('王五',text)
        exports.export(self.db,self.body('png','报告.png'))
        from PIL import Image
        with Image.open(self.f.root/'报告.png') as image:self.assertEqual(image.size,(round(297/25.4*240),round(210/25.4*240)))
    def test_excel_print_and_editable_chart_and_source_details(self):
        target=self.f.root/'报告.xlsx';exports.export(self.db,self.body('xlsx',target.name));wb=openpyxl.load_workbook(target)
        self.assertEqual(len(wb['横向A4报告']._images),1);self.assertEqual(wb['横向A4报告'].page_setup.orientation,'landscape');self.assertEqual(wb['横向A4报告'].page_setup.fitToWidth,1)
        self.assertEqual(len(wb['可编辑图表']._charts),1);self.assertEqual(wb['筛选明细'].max_row,3);self.assertEqual(wb['口径与筛选'].max_row,2)
        raw=''.join(str(c.value or '') for row in wb['筛选明细'] for c in row);self.assertIn('0012',raw)
        wb.close()
        with self.assertRaisesRegex(ValueError,'平台导出的报告'):tabular.tables(target)
    def test_changed_snapshot_and_existing_output_refuse_overwrite(self):
        body=self.body('pdf','protected.pdf');target=Path(body['output']);target.write_bytes(b'original')
        with self.assertRaises(FileExistsError):exports.export(self.db,body)
        self.assertEqual(target.read_bytes(),b'original')
        body['snapshot']['revision']+=1
        with self.assertRaisesRegex(ValueError,'重新预览'):exports.export(self.db,body)
    def test_report_defect_scope_and_calendar_dimension(self):
        c=self.config['report']['charts'][0];c['defect']='装管反';c['dimension']='date';c['type']='column'
        data=service.handle(self.db,{'action':'reportData','config':self.config})
        self.assertEqual(sum(p['value'] or 0 for p in data['charts'][0]['data']),2);self.assertIn('装管反',data['charts'][0]['title'])
    def test_report_export_passes_calendar_rules_and_rejects_stale_rule_signature(self):
        from lab_engine import shift_calendar
        rule={**shift_calendar.DEFAULTS,'mode':'check-time','timeColumn':self.source['mapping']['date']}
        store.import_files(self.db,{**self.source,'calendar':rule})
        calendar={'version':1,'sources':{self.source['id']:rule}}
        snapshot=service.handle(self.db,{'action':'reportData','config':self.config,'calendar':calendar})
        body={**self.body('xlsx','shift.xlsx'),'calendar':calendar,'snapshot':{'revision':snapshot['revision'],'signature':snapshot['signature']}}
        exports.export(self.db,body)
        book=openpyxl.load_workbook(self.f.root/'shift.xlsx',read_only=True,data_only=True)
        try:
            rows=list(book['筛选明细'].values)
            self.assertEqual({row[5] for row in rows[1:]},{'未归班'})
        finally:book.close()
        changed={**body,'output':str(self.f.root/'changed.xlsx'),'calendar':{'version':1,'sources':{self.source['id']:{**rule,'nightEnd':'06:30'}}}}
        with self.assertRaisesRegex(ValueError,'重新预览'):exports.export(self.db,changed)
    def test_backup_restore_to_empty_and_tamper_detection(self):
        backup=self.f.root/'safe.labpack';body={'config':self.config,'output':str(backup)};exports.backup(self.db,body)
        empty=store.connect(self.f.root/'restored')
        try:
            peek=exports.inspectBackup(empty,{'input':str(backup)});approved=json.dumps(peek['config']);exports.restore(empty,{'input':str(backup),'approvedConfig':approved})
            self.assertEqual(len(store.load_rows(empty,self.source)),2)
            with self.assertRaisesRegex(ValueError,'空分析库'):exports.restore(empty,{'input':str(backup),'approvedConfig':approved})
        finally:empty.close()
        with zipfile.ZipFile(backup) as z:entries={name:z.read(name) for name in z.namelist()}
        entries['sources.json']=b'{}';damaged=self.f.root/'damaged.labpack'
        with zipfile.ZipFile(damaged,'w') as z:
            for name,data in entries.items():z.writestr(name,data)
        with self.assertRaisesRegex(ValueError,'校验失败'):exports.inspectBackup(self.db,{'input':str(damaged)})
    def test_recovery_compensation_revision_guard(self):
        r=store.revision(self.db)
        with self.assertRaisesRegex(ValueError,'已变化'):service.handle(self.db,{'action':'rollbackRestore','revision':r+1})
        self.assertEqual(len(store.load_rows(self.db,self.source)),2)
        service.handle(self.db,{'action':'rollbackRestore','revision':r});self.assertEqual(store.revision(self.db),0);self.assertEqual(self.db.execute('SELECT count(*) FROM files').fetchone()[0],0)
    def test_invalid_geometry_prevents_file_creation(self):
        body=self.body('pdf','outside.pdf');body['pages'][0]['commands'].append({'kind':'text','text':'超出','x':400,'y':20,'size':12,'anchor':'start','color':'#000000'})
        with self.assertRaisesRegex(ValueError,'边界'):exports.export(self.db,body)
        self.assertFalse(Path(body['output']).exists())

if __name__=='__main__':unittest.main()
