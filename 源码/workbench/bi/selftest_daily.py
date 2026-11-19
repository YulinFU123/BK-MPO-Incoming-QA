"""Offline smoke test using synthetic data only; no production history touched."""
import sys, pathlib, tempfile, csv
APP=pathlib.Path(__file__).resolve().parent
sys.path.insert(0,str(APP/'libs'))
import daily
with tempfile.TemporaryDirectory() as tmp:
 p=pathlib.Path(tmp)/'quality.csv';headers=list(daily.FIELDS.values())
 records=[]
 for name,qty,status in [('演示甲',3,'Rework'),('演示乙',2,'Scrap'),('演示甲',1,'Release')]:
  records.append(['2026-10-16','07-装管',name,'演示楼层','MPO-MPO','白班',qty,status,'演示项目'])
 with p.open('w',encoding='utf-8-sig',newline='') as f:w=csv.writer(f);w.writerow(headers);w.writerows(records)
 daily.ingest(tmp,{'path':str(p),'scope':'演示','kind':'quality'})
 assert daily.ingest(tmp,{'path':str(p),'scope':'演示','kind':'quality'})['results'][0]['state'].startswith('重复')
 q={'scope':'演示','status':'Rework,Scrap'};a=daily.analyze(tmp,q);assert a['quantity']==5
 q['employees']=['演示甲'];a=daily.analyze(tmp,q);assert a['quantity']==3 and a['charts'][3]['rows'][0]['share']==.6
 q['exclude']=['演示甲'];assert daily.analyze(tmp,q)['quantity']==0
 q.pop('exclude');q.pop('employees')
 pp=pathlib.Path(tmp)/'production.csv';pp.write_text('日期,工序,产量,单位\n2026-10-16,07-装管,100,pcs\n',encoding='utf-8-sig')
 daily.ingest(tmp,{'path':str(pp),'scope':'演示产量','kind':'production'});q['production_scope']='演示产量';assert daily.analyze(tmp,q)['production'][0]['qty']==100
 pp.write_text('日期,工序,产量,单位\n2026-10-16,07-装管,120,pcs\n',encoding='utf-8-sig')
 try:daily.ingest(tmp,{'path':str(pp),'scope':'演示产量','kind':'production'})
 except ValueError:pass
 else:raise AssertionError('更新冲突未拦截')
 daily.ingest(tmp,{'path':str(pp),'scope':'演示产量','kind':'production','replace':True});assert daily.analyze(tmp,q)['production'][0]['qty']==120
 out=daily.dispatch(tmp,'export',{'query':q});assert (pathlib.Path(out['path'])/'日报明细.xlsx').is_file()
print('PASS：独立入库、重复跳过、数量占比、人员包含排除、产量导入、快照更新、Excel与正文导出。')
print('测试仅使用临时演示数据；未改动正式历史。PNG图片导出请在界面上试用。')
