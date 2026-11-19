import sys, pathlib, tempfile, json, copy
APP_DIR=pathlib.Path(__file__).resolve().parent
sys.path.insert(0,str(APP_DIR/"libs"))
import pandas as pd
b=pathlib.Path(__file__).resolve().parent;sys.path.insert(0,str(b))
import analytics as a,engine

def frame(dates,emps=None,procs=None,qty=None):
 n=len(dates)
 return pd.DataFrame({'_date':pd.to_datetime(dates),'_emp':emps or ['A']*n,'_proc':procs or ['P1']*n,'_qty':qty or [1]*n,'_item':['X']*n,'_prod':['MPO']*n,'_shift':['夜班']*n})
raw=engine.default_config();raw['people']=[{'name':'A','groups':['G1','G2']},{'name':'B','groups':['G2']}];raw['process_groups']=[{'name':'前段','members':['P1','P2']},{'name':'重点','members':['P1']}]
f=frame(['2025-12-29','2025-12-30','2026-01-04','2026-01-05'],['A','B','A','B'],['P1','P2','P1','P2'],[2,3,5,7])
r=a.compute(f,f,raw,{'period':'week','start':'2025-12-29','end':'2026-01-11'})
assert [p['label'] for p in r['periods']]==['2026-W01','2026-W02'];assert [p['quantity'] for p in r['periods']]==[10,7];assert all(p['change'] is None for p in r['periods'])
r=a.compute(f,f,raw,{'employee_groups':['G1','G2'],'process_groups':['前段','重点'],'exclude_employees':['B'],'start':'2025-12-29','end':'2026-01-05'})
assert r['summary']['quantity']==7
r=a.compute(f,f,raw,{'employee_groups':['不存在']});assert r['summary']['quantity']==0
full=frame(pd.date_range('2026-01-01','2026-03-31'),qty=[2]*31+[4]*28+[6]*31)
r=a.compute(full,full,raw,{'period':'month','start':'2026-02-01','end':'2026-03-31'})
assert [p['quantity'] for p in r['periods']]==[112,186];assert r['periods'][0]['previous']==62
r=a.compute(full,full,raw,{'period':'month','start':'2026-02-10','end':'2026-03-15'});assert all(p['change'] is None for p in r['periods'])
f0=frame(['2026-01-01','2026-01-02','2026-01-04'],qty=[0,3,4]);r=a.compute(f0,f0,raw,{'start':'2026-01-01','end':'2026-01-04'})
assert r['periods'][1]['comparison']=='基期为0';assert r['periods'][2]['quantity'] is None
for query in [{'start':'2026-03-01','end':'2026-02-01'},{'period':'bad'},{'start':'invalid'}]:
 try:a.compute(full,full,raw,query)
 except ValueError:pass
 else:raise AssertionError(query)
# Explicit business date is never shifted. Recorded midnight always is shifted.
raw['fieldmap']={'date':{'role':'业务日期'},'time':{'role':'记录时间'},'emp':{'role':'责任员工'},'proc':{'role':'责任工序'},'defect':{'role':'不良代码'}}
hist=pd.DataFrame({'date':['2026-01-01 02:00:00'],'time':['2026-01-01 00:00:00'],'emp':['A'],'proc':['P1'],'defect':['MPO X']})
f,_=engine.build_frame(hist,engine.build_cfg(raw));assert f.iloc[0]['_date']==pd.Timestamp('2026-01-01');assert f.iloc[0]['_week']=='2026-W01'
raw['P']['业务日期来源']='记录时间';f,_=engine.build_frame(hist,engine.build_cfg(raw));assert f.iloc[0]['_date']==pd.Timestamp('2025-12-31')
raw['fieldmap']['qty']={'role':'数量'};hist['qty']=['oops']
try:engine.build_frame(hist,engine.build_cfg(raw))
except ValueError:pass
else:raise AssertionError('invalid quantity silently accepted')
print('PASS: calendar boundaries, partial periods, no-data vs zero, group unions/exclusions, invalid inputs, midnight business date, quantity checks')
# Real sample, export, configuration compatibility.
raw=engine.default_config();raw['paths']['input']=str(b/'演示数据/每日原表');temp_handle=tempfile.TemporaryDirectory(prefix='quality_trend_test_');base=pathlib.Path(temp_handle.name);raw['paths']['history']=str(base/'history');raw['paths']['output']=str(base/'output')
r=a.analyze(str(base),raw,{'period':'day','start':'2026-10-13','end':'2026-10-19'});assert r['summary']['quantity']>0
for period in ('day','week','month'):
 q={'period':period,'start':'2026-10-13','end':'2026-10-19'};r=a.analyze(str(base),raw,q);assert sum(x['quantity'] or 0 for x in r['periods'])==r['summary']['quantity'];assert abs(sum(x['share'] for x in r['ranking'])-1)<1e-10
out=a.export(str(base),raw,{'period':'week','start':'2026-10-13','end':'2026-10-19'})
import openpyxl
wb=openpyxl.load_workbook(out['path']);assert wb.sheetnames==['周期趋势','对象排行','对象趋势','筛选与口径'];assert wb['周期趋势']._charts
old=engine.merge_config({'P':{'业务日切换时间':'07:30'}});assert old['P']['业务日切换时间']=='07:30' and 'analytics' in old
engine.save_config_file(str(base),raw);assert engine.load_config_file(str(base))['process_groups']==raw['process_groups']
print('PASS: demo day/week/month sums, ranking shares, Excel export, old config migration')
print(json.dumps(r['summary'],ensure_ascii=False))

temp_handle.cleanup()
print("全部自检通过；临时演示结果已清理，生产数据未修改。")
