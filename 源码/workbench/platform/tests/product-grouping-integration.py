"""Legacy grouping semantics are corrected on reads, with original data/config intact."""
from pathlib import Path
import hashlib,importlib.util,io,json,os,subprocess,unittest
spec=importlib.util.spec_from_file_location('fixture',Path(__file__).with_name('analysis-studio-integration.py'))
fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture)
from lab_engine import tabular,store,service,analysis,exports,grouping_semantics
import openpyxl

class ProductTests(unittest.TestCase):
    setUp=fixture.StudioTests.setUp
    tearDown=fixture.StudioTests.tearDown
    workbook=fixture.StudioTests.workbook
    source=fixture.StudioTests.source

    def legacy(self):
        headers=['Work Date','Process Type in Charge','Workflow Step in Charge','不良项','数量','班次']
        rows=[['2026-10-16',name,'CN-MPO-装管','装管反',qty,'白班'] for name,qty in [('LCD',1),('MMC',2),('MMC24',3),('MPO',4)]]
        self.workbook(self.folder/'old.xlsx',[headers,*rows])
        s=self.source(self.folder);ids={c['label']:c['id'] for c in s['columns']}
        s['mapping']['process']=ids['Process Type in Charge']
        self.assertEqual(store.import_files(self.db,s)['errors'],0)
        return s,ids

    def home(self,s,filters=None):
        return service.handle(self.db,{'action':'home','config':{'sources':[s],'activeSource':s['id']},'query':{'start':'2026-10-16','end':'2026-10-16','filters':filters or {},'grain':'day'},'preference':{}})

    def test_already_imported_family_rows_have_product_label_without_reimport_and_preserve_filters(self):
        s,ids=self.legacy();original=json.dumps(s,sort_keys=True);revision=store.revision(self.db)
        self.db.execute('PRAGMA wal_checkpoint(FULL)');file=self.root/'db/analysis-v1.sqlite';before=hashlib.sha256(file.read_bytes()).hexdigest()
        result=self.home(s,{'process':'MMC'})
        self.assertEqual(result['grouping']['label'],'产品类型');self.assertEqual(result['grouping']['sourceColumn'],'Process Type in Charge')
        self.assertEqual(result['quantity'],2);self.assertEqual(result['rowCount'],1)
        self.assertEqual(result['options']['process'],['LCD','MMC','MMC24','MPO'])
        self.assertEqual(store.revision(self.db),revision);self.assertEqual(json.dumps(s,sort_keys=True),original)
        self.assertEqual(hashlib.sha256(file.read_bytes()).hexdigest(),before)

    def test_real_workflow_and_legacy_process_valued_headers_stay_processes(self):
        s,ids=self.legacy();changed={**s,'mapping':{**s['mapping'],'process':ids['Workflow Step in Charge']}}
        store.import_files(self.db,changed)
        self.assertEqual(self.home(changed)['grouping']['label'],'工序')
        self.assertEqual(grouping_semantics.describe(s,['装管'])['kind'],'process')

    def test_family_classification_does_not_depend_on_the_current_filter_or_date_range(self):
        s,_=self.legacy()
        self.assertEqual(self.home(s,{'process':'MPO'})['grouping']['kind'],'productType')
        body={'action':'home','config':{'sources':[s],'activeSource':s['id']},'query':{'start':'2026-11-01','end':'2026-11-02','filters':{},'grain':'day'},'preference':{}}
        result=service.handle(self.db,body)
        self.assertEqual(result['state'],'out-of-range');self.assertEqual(result['grouping']['label'],'产品类型')

    def test_product_family_is_not_used_as_a_real_operation_for_a_defect_rate(self):
        s,_=self.legacy();self.workbook(self.prod/'output.xlsx',[['日期','工序','班次','产量'],*[['2026-10-16',name,'白班',100] for name in ['LCD','MMC','MMC24','MPO']]])
        p=self.source(self.prod,'production');store.import_files(self.db,p)
        q={'range':'all','filters':[],'dimension':'process','chartType':'bar','metric':'quantity','sort':{'field':'date','direction':'desc'}}
        result=analysis.analyze(self.db,s,p,q)
        self.assertEqual(result['quantity'],10);self.assertIsNone(result['rate']['value']);self.assertIn('产品类型',result['rate']['reason'])

    def test_report_dimension_and_real_excel_header_match_product_types(self):
        s,_=self.legacy();q={'range':'all','filters':[],'dimension':'process','chartType':'bar','metric':'quantity','sort':{'field':'date','direction':'desc'},'pageSize':50,'topN':10}
        settings={'title':'{维度}不良统计','singlePage':True,'margin':8,'gap':4,'titleSize':24,'charts':[{'id':'chart','sourceId':s['id'],'productionId':'','period':'day','query':q,'title':'{维度}分布','type':'bar','dimension':'process','metric':'quantity','defect':''}]}
        config={'sources':[s],'activeSource':s['id'],'report':settings}
        snapshot=service.handle(self.db,{'action':'reportData','config':config})
        self.assertEqual(snapshot['charts'][0]['title'],'产品类型分布')
        node=os.environ.get('PLATFORM_NODE',r'C:\Users\yulinf\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe')
        script="const fs=require('node:fs'),a=require('./domain/a4-report'),d=JSON.parse(fs.readFileSync(0,'utf8'));process.stdout.write(JSON.stringify(a.compose(d.charts,d.settings,{title:d.title})));"
        run=subprocess.run([node,'-e',script],input=json.dumps({'charts':snapshot['charts'],'title':snapshot['title'],'settings':settings}),encoding='utf-8',capture_output=True,cwd=Path(__file__).parents[1],check=True)
        pages=json.loads(run.stdout)['pages'];target=self.root/'产品.xlsx'
        exports.export(self.db,{'config':config,'format':'xlsx','pages':pages,'snapshot':{'revision':snapshot['revision'],'signature':snapshot['signature']},'output':str(target)})
        wb=openpyxl.load_workbook(target,read_only=True,data_only=True)
        try:
            rows=list(wb['筛选明细'].values);self.assertEqual(rows[0][4],'产品类型');self.assertEqual({r[4] for r in rows[1:]},{'LCD','MMC','MMC24','MPO'})
        finally:wb.close()

if __name__=='__main__':unittest.main()
