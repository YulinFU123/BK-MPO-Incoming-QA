"""Synthetic only. Exercises real Excel/CSV, SQLite imports and production matching."""
from pathlib import Path
from datetime import datetime
import hashlib, json, os, sys, tempfile, unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'desktop'))
from lab_engine import tabular, store, analysis, service
import openpyxl

class StudioTests(unittest.TestCase):
    def setUp(self):
        root=Path(os.environ.get('PLATFORM_TEST_ROOT',Path(__file__).parents[4]/'构建/当前作业/文件夹自由分析/验证'));root.mkdir(parents=True,exist_ok=True)
        self.temp=tempfile.TemporaryDirectory(prefix='analysis-data-',dir=root); self.root=Path(self.temp.name)
        self.folder=self.root/'daily';self.folder.mkdir();self.prod=self.root/'production';self.prod.mkdir();self.db=store.connect(self.root/'db')
    def tearDown(self): self.db.close();self.temp.cleanup()
    def workbook(self,path,rows,header=2):
        book=openpyxl.Workbook();ws=book.active;ws.title='数据'
        if header==2:ws.append(['合成报告，不是真实公司数据'])
        for row in rows:ws.append(row)
        book.save(path);book.close()
    def source(self,folder,kind='defects',unit='units'):
        sample=next(folder.iterdir()); source={'id':kind,'name':kind,'folder':str(folder),'kind':kind,'sheet':'','headerRow':0,'mapping':{},'columns':[],'schema':'','confirmed':False,'unit':unit,'cutoff':0,'auto':False,'dateFromFilename':False,'uniqueColumns':[],'updateMode':'replace_dates','coverage':'rows','dateFormat':'auto'}
        info=tabular.inspect(sample,source);source.update(mapping=info['mapping'],columns=[{k:c[k] for k in ['id','label','type']} for c in info['columns']],schema=info['schema'],confirmed=True)
        return source
    def fixture(self):
        self.workbook(self.folder/'day19.xlsx', [['日期','工序','班次','不良项','数量','Employee in Charge','Reported By','SN'],['2026-09-19','装管','白班','装管反',2,'张三','李四','0012']])
        self.workbook(self.folder/'day20.xlsx', [['日期','工序','班次','不良项','数量','Employee in Charge','Reported By','SN'],['2026-09-20','装管','白班','断裂',3,'王五','赵六','12']])
        self.workbook(self.prod/'output.xlsx',[['生产日期','工序','班次','产量'],['2026-09-19','装管','白班',1000],['2026-09-20','装管','白班',3000]])
        source=self.source(self.folder);production=self.source(self.prod,'production');store.import_files(self.db,source);store.import_files(self.db,production)
        query={'range':'custom','start':'2026-09-19','end':'2026-09-20','filters':[],'dimension':'employee','chartType':'bar','metric':'quantity','sort':{'field':'date','direction':'desc'},'pageSize':50,'topN':10}
        return source,production,query
    def test_header_roles_and_weighted_rate(self):
        source,p,q=self.fixture();self.assertNotEqual(source['mapping']['employee'],source['mapping']['reporter'])
        result=analysis.analyze(self.db,source,p,q)
        self.assertEqual(result['quantity'],5);self.assertEqual(result['production'],4000);self.assertAlmostEqual(result['rate']['value'],5/4000)
        self.assertEqual([p['quantity'] for p in result['trend']],[2,3]);self.assertEqual(len(result['details']),2)
        self.assertEqual({r['values'][source['mapping']['serial']] for r in result['details']},{'0012','12'})
    def test_text_filter_preview_and_applied_counts_agree(self):
        self.workbook(self.folder/'all.xlsx', [['日期','工序','不良项','数量'],
            ['2026-09-19','装管','CN_装管反',7], ['2026-09-19','装管','装管反',2],
            ['2026-09-19','装管','装管反',3], ['2026-09-19','装管','断裂',4],
            ['2026-09-19','包装','装管反',9], ['2026-09-19','装管',None,1]])
        source = self.source(self.folder)
        store.import_files(self.db, source)
        filters = [{'field':'process','op':'in','values':['装管'],'caseSensitive':False}]
        q = {'range':'all','filters':filters}
        for op, word, total, row_count in [('contains','装管反',2,3), ('startsWith','cn_',1,1),
                                           ('endsWith','装管反',2,3), ('notContains','装管反',2,2)]:
            with self.subTest(op=op):
                response = service.handle(self.db, {'action':'facets','config':{'sources':[source]},
                    'sourceId':source['id'],'query':q,'field':'defect','matchOp':op,'search':word})
                applied = analysis.analyze(self.db, source, None, {**q,'filters':filters+[
                    {'field':'defect','op':op,'values':[word],'caseSensitive':False}]})
                self.assertEqual((response['total'],response['rowCount']), (total,row_count))
                self.assertEqual(applied['recordCount'], row_count)
                self.assertEqual(sum(value['count'] for value in response['values']), row_count)

    def test_process_breakdown_and_exact_drill_share_the_filtered_population(self):
        self.workbook(self.folder/'all.xlsx', [['日期','工序','不良项','数量'],
            ['2026-09-18','剪线','断裂',4], ['2026-09-19','剪线','断裂',2],
            ['2026-09-19','装管','装管反',3], ['2026-09-19','包装','其他',9]])
        source = self.source(self.folder)
        store.import_files(self.db, source)
        filters = [{'field':'process','op':'in','values':['剪线','装管'],'caseSensitive':False}]
        query = {'range':'custom','start':'2026-09-19','end':'2026-09-19','filters':filters}
        report = analysis.analyze(self.db, source, None, query)
        groups = {g['key']:g for g in report['breakdown']['groups']}
        self.assertEqual(set(groups), {'剪线','装管'})
        self.assertEqual(sum(g['quantity'] for g in groups.values()), report['quantity'])
        self.assertEqual(groups['剪线']['change'], -2)
        self.assertEqual(groups['装管']['previous'], 0)
        drill = analysis.analyze(self.db, source, None, {**query,'filters':filters+[
            {'field':'process','op':'in','values':['装管'],'caseSensitive':True},
            {'field':'defect','op':'in','values':['装管反'],'caseSensitive':True}]})
        self.assertEqual(drill['quantity'], groups['装管']['issues'][0]['quantity'])
        self.assertEqual([(r['file'],r['row']) for r in drill['details']], [('all.xlsx',5)])
        partial = analysis.analyze(self.db, source, None, {**query,'end':'2026-09-20'})
        self.assertFalse(partial['breakdown']['comparable'])
        self.assertIsNone(partial['comparison']['change'])
        self.assertIsNone(partial['trend'][-1]['quantity'])
    def test_home_drill_uses_published_source_and_previous_date(self):
        self.workbook(self.folder/'published.xlsx', [['日期','工序','不良项','数量','责任站点'],
            ['2026-11-01','装管','装管反',5,'站点A'], ['2026-11-01','测试','装管反',99,'站点B'],
            ['2026-11-02','装管','装管反',7,'站点A']])
        self.workbook(self.prod/'draft.xlsx', [['日期','工序','不良项','数量'],
            ['2026-11-02','测试','断裂',30]])
        published = self.source(self.folder)
        draft = {**self.source(self.prod), 'id': 'draft'}
        for source in (published, draft):
            store.import_files(self.db, source)
        site = next(c['id'] for c in published['columns'] if c['label'] == '责任站点')
        filter_rule = {'field':'process','op':'in','values':['装管'],'caseSensitive':False}
        selection = {'range':'custom','start':'2026-11-02','end':'2026-11-02','filters':[filter_rule]}
        config = {'sources':[published,draft], 'activeSource':draft['id'],
                  'sharedAnalysis':{'sourceId':published['id'],'period':'day','query':selection}}
        request = {'action':'home','config':config,
                   'query':{'start':'2026-11-02','end':'2026-11-02','grain':'day','filters':{}},
                   'homeColumns':{published['id']:{'process':site}}}
        current = service.handle(self.db, request)
        self.assertEqual((current['sourceId'],current['quantity'],current['trend'][0]['previous']),
                         (published['id'],7,5))
        drill = service.handle(self.db, {**request,'biPeriod':'previous',
            'biRange':{'start':'2026-11-01','end':'2026-11-01'},
            'biFilter':{'field':'process','value':'站点A'}})
        self.assertEqual((drill['state'],drill['quantity'],drill['total']), ('available',5,1))
        link = drill['analysisLink']
        self.assertEqual(link['query']['start'],'2026-11-01')
        self.assertEqual(link['query']['filters'], [filter_rule,
                         {'field':site,'op':'in','values':['站点A'],'caseSensitive':True}])
        self.assertEqual(analysis.analyze(self.db, published, None, link['query'])['quantity'],5)
        new_config = {**config, 'sharedAnalysis':{**config['sharedAnalysis'],
                     'sourceId':draft['id'], 'query':{**selection,'filters':[]}}}
        self.assertEqual(service.handle(self.db,{**request,'config':new_config})['quantity'],30)

    def test_actual_export_work_date_wins_over_creation_date_and_range_uses_that_column(self):
        self.workbook(self.folder/'actual-headers.xlsx',[['Serial Number','Part Number','Mfg Order','Work Date','NC Creation Date','Failure Code','Failure Code Category','Report Process Type','Process Type in Charge','Employee in Charge','Reported By','Shift','NC Quantity'],['0012','P-1','M1','2026-09-19T23:30:00','2026-11-01','装管反','装配','报检工序','装管','张三','李四','夜班',2]])
        s=self.source(self.folder);columns={c['id']:c['label'] for c in s['columns']};self.assertEqual(columns[s['mapping']['date']],'Work Date');self.assertEqual(columns[s['mapping']['defect']],'Failure Code');self.assertEqual(columns[s['mapping']['process']],'Process Type in Charge');self.assertNotEqual(s['mapping']['employee'],s['mapping']['reporter'])
        result=store.import_files(self.db,s);self.assertEqual(result['errors'],0)
        q={'range':'custom','start':'2026-09-19','end':'2026-09-19','filters':[],'dimension':'employee','chartType':'bar','metric':'quantity','sort':{'field':'date','direction':'desc'},'pageSize':50,'topN':10}
        self.assertEqual(analysis.analyze(self.db,s,None,q)['quantity'],2)
        q['start']=q['end']='2026-11-01';self.assertEqual(analysis.analyze(self.db,s,None,q)['quantity'],0)
    def test_incomplete_check_date_recommends_a_complete_work_date(self):
        from lab_engine import shift_calendar
        sample=self.folder/'bi.xlsx'
        headers=['Check Date','Work Date','Failure Code','Sum of Qty']
        self.workbook(sample,[headers,['2026-10-17 02:30:00','2026-10-16','A',2],
                              [None,'2026-10-16','B',3]])
        source=self.source(self.folder)
        info=tabular.inspect(sample,source)
        columns={c['label']:c['id'] for c in info['columns']}
        self.assertEqual(info['dateFallback'],{'missingCheckDates':1})
        self.assertEqual(source['mapping']['date'],columns['Work Date'])
        source['calendar']={**shift_calendar.DEFAULTS,'mode':'check-time',
                            'timeColumn':columns['Check Date'],'dateBasis':'mapped'}
        self.assertEqual(store.import_files(self.db,source)['importedRows'],2)
        rows=store.load_rows(self.db,source)
        self.assertEqual({row['date'] for row in rows},{'2026-10-16'})
        self.assertEqual({row['shift'] for row in rows},{'晚班','未归班'})
        self.workbook(sample,[headers,['2026-10-17 02:30:00','2026-10-16','A',2],
                              [None,None,'B',3]])
        self.assertNotIn('dateFallback',tabular.inspect(sample,source))

    def test_blank_defects_import_directly_and_remain_filterable(self):
        sample=self.folder/'blank.xlsx'
        headers=['日期','不良项','数量','报告异常代码']
        self.workbook(sample,[headers,['2026-09-19','装管反',1,'A'],
                              ['2026-09-19',None,2,'B'],['2026-09-19',' ',3,'C']])
        source=self.source(self.folder)
        preview=tabular.inspect(sample,source)
        counts={c['label']:c['blankRows'] for c in preview['columns']}
        self.assertEqual(counts['不良项'],2)
        self.assertEqual(counts['报告异常代码'],0)
        body={'action':'import','config':{'sources':[source]},'sourceId':source['id'],
              'names':[sample.name]}
        imported=service.handle(self.db,body)
        self.assertEqual(imported['importedRows'],3)
        self.assertEqual(imported['files'][0]['blankDefectRows'],2)
        self.assertIn('保留了 2 条不良项为空的记录',imported['files'][0]['warning'])
        self.assertEqual(len(store.load_rows(self.db,source)),3)
        q={'range':'all','dimension':'defect','filters':[{'field':'defect','op':'empty','values':[]}]}
        result=analysis.analyze(self.db,source,None,q)
        self.assertEqual(result['recordCount'],2)
        self.assertEqual(result['quantity'],5)
        self.assertEqual(result['points'][0]['label'],'(空白)')
        self.assertEqual(service.handle(self.db,body)['importedRows'],0)
        invalid=self.folder/'invalid.xlsx'
        self.workbook(invalid,[headers,[None,None,5,'D'],['2026-09-19',None,6,'E']])
        rejected=service.handle(self.db,{**body,'names':[invalid.name]})
        self.assertIn('日期为空',rejected['files'][0]['error'])
        self.assertNotIn('blankDefectRows',rejected['files'][0])
        self.assertEqual(len(store.load_rows(self.db,source)),3)

    def test_mlight_pending_and_release_blank_reasons_are_valid(self):
        sample=self.folder/'mlight.xlsx'
        headers=['容器号','状态','报告时间','数量','报告异常代码','判定异常代码','判定类型','判定原因']
        book=openpyxl.Workbook()
        sheet=book.active
        sheet.title='container'
        sheet.append(headers)
        sheet.append(['P001','待判定','2026-09-19',1,'A',None,None,None])
        sheet.append(['R001','已判','2026-09-19',2,'A',None,'Release',None])
        sheet.append(['D001','已判','2026-09-19',3,'A','A','Rework','装管反'])
        book.save(sample)
        book.close()
        source=self.source(self.folder)
        preview=tabular.inspect(sample,source)
        reason=preview['mlightReasonColumn']
        source['sheet']=preview['sheet']
        source['mapping']['defect']=reason
        kept=set(source['mapping'].values())
        source['columns']=[c for c in source['columns'] if c['id'] in kept]
        imported=store.import_files(self.db,source)
        self.assertEqual(imported['importedRows'],3)
        self.assertEqual(imported['files'][0]['blankDefectRows'],2)
        self.assertIn('未判定的空白判定原因 1 条',imported['files'][0]['warning'])
        self.assertIn('已判放行的空白判定原因 1 条',imported['files'][0]['warning'])
        rows=store.load_rows(self.db,source)
        self.assertEqual(sum(row['values'][reason] is None for row in rows),2)
        self.assertTrue(all(set(row['values'])==kept for row in rows))
        defaults=analysis.analyze(self.db,source,None,{'range':'all'})
        include=analysis.analyze(self.db,source,None,{'range':'all','ignorePendingDecisions':False})
        self.assertEqual((defaults['recordCount'],defaults['quantity'],defaults['ignoredPending']),(2,5,1))
        self.assertEqual((include['recordCount'],include['quantity']),(3,6))
        query={'range':'all','filters':[{'field':reason,'op':'in','values':['装管反']}]}
        config={'sources':[source],'activeSource':source['id'],
                'sharedAnalysis':{'sourceId':source['id'],'period':'day','query':query}}
        home=service.handle(self.db,{'action':'home','config':config,
            'query':{'start':'2026-09-20','end':'2026-09-20','filters':{'issue':'另一个条件'}},
            'preference':{'employee':'不会用于统一筛选'}})
        self.assertEqual((home['rowCount'],home['quantity'],home['sharedAnalysis']['conditions']),(1,3,1))
        target=self.root/'目标表.xlsx'
        layout={'groupBy':reason,'columns':[{'field':reason,'title':'自定义原因'},
                                            {'field':'quantity','title':'异常数量'}]}
        request={'action':'exportQuickReport','config':config,'sourceId':source['id'],'query':query,
                 'layout':layout,'revision':store.revision(self.db),'output':str(target)}
        with self.assertRaisesRegex(ValueError,'数据已更新'):
            service.handle(self.db,{**request,'revision':request['revision']+1})
        self.assertFalse(target.exists())
        self.assertEqual(service.handle(self.db,request)['recordCount'],home['rowCount'])
        with target.open('rb') as stream:
            output=openpyxl.load_workbook(stream,read_only=True)
            self.assertEqual(output.sheetnames,['筛选明细','不良汇总','日期汇总','筛选口径'])
            self.assertEqual(list(output['筛选明细'].values),[('自定义原因','异常数量'),('装管反',3)])
            self.assertEqual(list(output['不良汇总'].values)[1],('装管反',1,3))
            output.close()
        q={'range':'all','filters':[{'field':'defect','op':'equals','values':['装管反']}]}
        result=analysis.analyze(self.db,source,None,q)
        self.assertEqual((result['recordCount'],result['quantity']),(1,3))
        changed=openpyxl.load_workbook(sample)
        changed.active.append(['X001','已判','2026-09-19',4,'A','A','Scrap',None])
        changed.save(sample)
        changed.close()
        imported2=store.import_files(self.db,source)
        self.assertEqual(imported2['importedRows'],4)
        self.assertEqual(imported2['files'][0]['blankDefectRows'],3)
        self.assertEqual(len(store.load_rows(self.db,source)),4)

    @unittest.skipUnless(os.name=='nt','Windows file sharing semantics')
    def test_locked_workbook_can_be_retried_without_reimporting_other_files(self):
        import ctypes
        from ctypes import wintypes
        source,_,_=self.fixture()
        target=self.folder/'locked.xlsx'
        self.workbook(target,[['日期','工序','班次','不良项','数量','Employee in Charge','Reported By','SN'],
                              ['2026-09-21','装管','白班','装管反',3,'测试甲','测试乙','0031']])
        win32=ctypes.WinDLL('kernel32',use_last_error=True)
        create=win32.CreateFileW
        create.argtypes=(wintypes.LPCWSTR,wintypes.DWORD,wintypes.DWORD,wintypes.LPVOID,
                         wintypes.DWORD,wintypes.DWORD,wintypes.HANDLE)
        create.restype=wintypes.HANDLE
        win32.CloseHandle.argtypes=(wintypes.HANDLE,)
        handle=create(str(target),0x80000000,0,None,3,0x80,None)
        self.assertNotEqual(handle,ctypes.c_void_p(-1).value)
        revision=store.revision(self.db)
        try:
            with self.assertRaisesRegex(ValueError,r'无法读取「locked.xlsx」。.*OneDrive'):
                service.handle(self.db,{'action':'inspect','name':target.name,'sourceId':source['id'],
                                        'config':{'sources':[source]}})
            failed=store.import_files(self.db,source,[target.name])
            self.assertEqual(failed['importedRows'],0)
            self.assertEqual(failed['errors'],1)
            self.assertIn('关闭后重试',failed['files'][0]['error'])
            self.assertNotIn(str(self.root),failed['files'][0]['error'])
            self.assertEqual(store.revision(self.db),revision)
        finally:
            win32.CloseHandle(handle)
        self.assertEqual(store.import_files(self.db,source,[target.name])['importedRows'],1)
        self.assertEqual(len(store.load_rows(self.db,source)),3)
        self.assertEqual(store.import_files(self.db,source,[target.name])['importedRows'],0)

    def test_cache_invalidates_after_an_external_database_commit(self):
        import sqlite3
        source,p,q=self.fixture();self.assertEqual(analysis.analyze(self.db,source,p,q)['quantity'],5)
        file=self.db.execute('PRAGMA database_list').fetchone()[2];other=sqlite3.connect(file)
        other.execute("UPDATE records SET quantity=9,canonical_json=json_set(canonical_json,'$.quantity',9) WHERE source_id='defects' AND business_date='2026-09-19'");other.commit();other.close()
        self.assertEqual(analysis.analyze(self.db,source,p,q)['quantity'],12)
    def test_moving_a_download_folder_does_not_invalidate_imported_history(self):
        source,p,q=self.fixture();source['folder']=str(self.far_folder if hasattr(self,'far_folder') else self.root/'moved-downloads')
        self.assertEqual(analysis.analyze(self.db,source,p,q)['quantity'],5)
    def test_missing_cohort_and_employee_filter_never_invent_denominators(self):
        source,p,q=self.fixture();q['filters']=[{'field':'employee','op':'equals','values':['张三'],'caseSensitive':True}]
        result=analysis.analyze(self.db,source,p,q);self.assertIsNone(result['rate']['value']);self.assertIn('没有对应字段',result['rate']['reason'])
        q['filters']=[];self.db.execute("UPDATE records SET active=0 WHERE source_id='production' AND business_date='2026-09-20'");self.db.commit()
        self.assertIn('缺少产量',analysis.analyze(self.db,source,p,q)['rate']['reason'])
    def test_events_do_not_become_a_true_rate_and_no_file_is_not_zero(self):
        source,p,q=self.fixture();source['unit']='events';q['start']='2026-09-18'
        result=analysis.analyze(self.db,source,p,q);self.assertIsNone(result['rate']['value']);self.assertIsNone(result['trend'][0]['quantity']);self.assertIn('确认为',result['rate']['reason'])
    def test_iso_week_year_month_and_calendar_boundaries(self):
        self.assertEqual(analysis.bucket('2027-01-01','week'),'2026-12-28');self.assertEqual(analysis.bucket_label('2027-01-01','week'),'2026-W53')
        source,p,q=self.fixture()
        weekly=analysis.analyze(self.db,source,p,q,'week');self.assertEqual(len(weekly['trend']),1);self.assertEqual(weekly['trend'][0]['quantity'],5);self.assertAlmostEqual(weekly['trend'][0]['rate'],5/4000)
        monthly=analysis.analyze(self.db,source,p,q,'month');self.assertEqual(monthly['trend'][0]['label'],'2026-09')
    def test_repeated_files_and_cross_export_overlap_do_not_double_count(self):
        source,p,q=self.fixture();again=store.import_files(self.db,source);self.assertEqual(again['importedRows'],0)
        self.workbook(self.folder/'duplicate.xlsx',[['日期','工序','班次','不良项','数量','Employee in Charge','Reported By','SN'],['2026-09-19','装管','白班','装管反',2,'张三','李四','0012']])
        store.import_files(self.db,source);self.assertEqual(analysis.analyze(self.db,source,p,q)['quantity'],5)
    def test_same_filename_new_days_retained_but_same_day_revision_replaced(self):
        path=self.folder/'report.xlsx';headers=['日期','工序','班次','不良项','数量']
        self.workbook(path,[headers,['2026-09-19','装管','白班','装管反',2]]);s=self.source(self.folder);store.import_files(self.db,s)
        self.workbook(path,[headers,['2026-09-20','装管','白班','装管反',3]]);store.import_files(self.db,s)
        self.workbook(path,[headers,['2026-09-19','装管','白班','装管反',4]]);store.import_files(self.db,s)
        self.assertEqual(sum(r['quantity'] for r in store.load_rows(self.db,s)),7)
    def test_ambiguous_slash_dates_and_midnight_cutoff_are_explicit(self):
        with self.assertRaises(ValueError):tabular.parse_date('10/11/2026')
        self.assertEqual(tabular.parse_date('10/11/2026',fmt='mdy'),'2026-10-11')
        self.assertEqual(tabular.parse_date('10/11/2026',fmt='dmy'),'2026-11-10')
        self.assertEqual(tabular.parse_date('2026-11-01 02:30:00',cutoff=8),'2026-10-31')
        self.assertEqual(tabular.parse_date('2026-11-01',cutoff=8),'2026-11-01')
    def test_column_selection_reimports_same_files_without_merging_distinct_rows(self):
        headers=['日期','不良项','数量','责任人','附加编号']
        self.workbook(self.folder/'day-a.xlsx',[headers,['2026-09-19','装管反',2,'甲','A001']])
        self.workbook(self.folder/'day-b.xlsx',[headers,['2026-09-19','装管反',2,'甲','B002']])
        full=self.source(self.folder)
        cols={column['label']:column['id'] for column in full['columns']}
        self.assertEqual(store.import_files(self.db,full)['importedRows'],2)
        kept={cols[label] for label in ('日期','不良项','数量')}
        subset={**full,'columns':[column for column in full['columns'] if column['id'] in kept],
                'mapping':{role:fid for role,fid in full['mapping'].items() if fid in kept}}
        self.assertNotEqual(store.mapping_hash(full),store.mapping_hash(subset))
        with self.assertRaisesRegex(ValueError,'重新导入'):
            store.load_rows(self.db,subset)
        self.assertEqual(store.import_files(self.db,subset)['importedRows'],2)
        rows=store.load_rows(self.db,subset)
        self.assertEqual(len(rows),2)
        self.assertEqual(sum(row['quantity'] for row in rows),4)
        self.assertTrue(all(set(row['values'])==kept for row in rows))
        q={'range':'all','filters':[]}
        with self.assertRaisesRegex(ValueError,'不在当前数据源'):
            analysis.facets(self.db,subset,q,cols['附加编号'])
        self.assertEqual(store.import_files(self.db,subset)['importedRows'],0)
        self.assertEqual(store.import_files(self.db,full)['importedRows'],2)
        self.assertEqual({row['values'][cols['附加编号']] for row in store.load_rows(self.db,full)},
                         {'A001','B002'})

    def test_schema_change_and_invalid_rows_are_not_partially_imported(self):
        source,p,q=self.fixture();before=analysis.analyze(self.db,source,p,q)['quantity']
        self.workbook(self.folder/'invalid.xlsx',[['日期','工序','班次','不良项','数量','Employee in Charge','Reported By','SN'],['2026-09-20','装管','白班','装管反',-5,'甲','乙','X']])
        result=store.import_files(self.db,source);self.assertEqual(result['errors'],1);self.assertEqual(analysis.analyze(self.db,source,p,q)['quantity'],before)
        self.workbook(self.folder/'changed.xlsx',[['Date','工序','不良项','Qty'],['2026-09-20','装管','装管反',5]])
        self.assertTrue(any('表头' in f.get('error','') for f in store.import_files(self.db,source)['files']))
    def test_excel_style_filters_cascade_and_provenance_is_retained(self):
        source,p,q=self.fixture();q['filters']=[{'field':'defect','op':'contains','values':['装管'],'caseSensitive':False}]
        result=analysis.analyze(self.db,source,p,q);self.assertEqual(result['quantity'],2);self.assertEqual(result['details'][0]['file'],'day19.xlsx');self.assertEqual(result['details'][0]['row'],3)
        options=analysis.facets(self.db,source,q,'employee');self.assertEqual([x['value'] for x in options['values']],['张三'])
    def test_production_same_cohort_duplicates_need_explicit_granularity(self):
        source,p,q=self.fixture();self.workbook(self.prod/'bad.xlsx',[['生产日期','工序','班次','产量'],['2026-09-20','装管','白班',100],['2026-09-20','装管','白班',200]])
        result=store.import_files(self.db,p);self.assertTrue(any('唯一字段' in f.get('error','') for f in result['files']));self.assertEqual(analysis.analyze(self.db,source,p,q)['production'],4000)

if __name__=='__main__':unittest.main()
