"""Incremental BI filter guard; original source/storage protocols remain intact."""
import copy
import json
from pathlib import Path

FIELDS=('Product Type','FG_SPEC_PRODUCT_TYPE2','Cost Center','Channel Type','Mfg Order',
        'Report Workflow','FG_Spec','Part Number','Disposition Type','Process Type','SN',
        'Shift','Site、Resource Category')

def normalize(value):
    if not isinstance(value,dict) or set(value)-set(FIELDS):
        raise ValueError('BI筛选字段无效。')
    result={}
    for name in FIELDS:
        row=value.get(name,{'mode':'keep','values':[]})
        if (not isinstance(row,dict) or set(row)-{'mode','values'} or row.get('mode') not in ('keep','all','include')
            or not isinstance(row.get('values'),list) or len(row['values'])>2000
            or any(not isinstance(v,str) or not v or len(v)>512 or any(ord(c)<32 and c!='\t' for c in v) for v in row['values'])):
            raise ValueError('BI筛选格式无效。')
        values=list(dict.fromkeys(row['values']))
        if (row['mode']=='include') != bool(values):raise ValueError('指定多选必须有值；其他模式不携带值。')
        if name=='Site、Resource Category' and any(len(v.split('\t'))!=2 or not all(v.split('\t')) for v in values):
            raise ValueError('楼层需要精确父子路径。')
        result[name]={'mode':row['mode'],'values':values}
    return result

def check_proof(job,result):
    filters=job['config'].get('exportFilters')
    if filters is None:return
    proof=result.get('filterProof')
    if not isinstance(proof,dict) or proof.get('version')!=1:raise ValueError('缺少网页筛选复核记录，未自动入库。')
    dates=proof.get('dates',{})
    if dates!={'start':job['query']['start'],'end':job['query']['end'],'status':'verified'}:raise ValueError('日期输入与滑杆未复核。')
    entries=proof.get('fields')
    if not isinstance(entries,list):raise ValueError('筛选复核格式无效。')
    expected={k:v for k,v in filters.items() if v['mode']!='keep'}
    if len(entries)!=len(expected) or {x.get('field') for x in entries if isinstance(x,dict)}!=set(expected):raise ValueError('筛选复核字段缺失或重复。')
    for row in entries:
        wanted=expected[row['field']]
        if (row.get('status')!='verified' or row.get('complete') is not True or row.get('mode')!=wanted['mode']
            or row.get('requested')!=wanted['values'] or not isinstance(row.get('selected'),list)
            or any(not isinstance(v,str) for v in row['selected'])):raise ValueError('筛选未可靠复核。')
        if wanted['mode']=='include' and set(row['selected'])!=set(wanted['values']):raise ValueError('筛选结果与任务快照不一致。')
        if wanted['mode']=='all' and (row.get('allVerified') is not True or not row['selected']):raise ValueError('未确认全选状态。')

def install(bridge):
    if getattr(bridge,'_filter_guard_installed',False):return
    original_start,original_poll,original_validate=bridge.start,bridge._poll,bridge.validate_download
    def start(base,body):
        filters=normalize(body['exportFilters']) if 'exportFilters' in body else None
        response=original_start(base,body)
        if filters is not None:
            job=bridge.JOBS[response['job']]
            job['config']['exportFilters']=filters
            job['config']['filterProofVersion']=1
            response['config']=copy.deepcopy(job['config'])
        return response
    def poll(base,job):
        marker=Path(job['folder'])/('NCDetails_job_'+job['id']+'.json')
        if 'exportFilters' in job['config'] and marker.exists() and marker.stat().st_size<=2_000_000:
            try:result=json.loads(marker.read_text(encoding='utf-8-sig'))
            except (UnicodeError,json.JSONDecodeError):return original_poll(base,job)
            if isinstance(result,dict) and result.get('status')=='export_clicked_download_unverified':
                check_proof(job,result)
        return original_poll(base,job)
    def validate(job,rows,metadata):
        original_validate(job,rows,metadata)
        # Exact raw header names only. Missing columns are NOT invented aliases.
        # DOM readback is configuration evidence, not proof of data completeness.
        for field,request in job['config'].get('exportFilters',{}).items():
            if request['mode']!='include':continue
            columns = ('SN', 'Serial Number') if field == 'SN' else (field,)
            column = next((name for name in columns if all(name in row.get('raw', {}) for row in rows)), None)
            if column is None:
                raise ValueError('导出缺少可核对的筛选列：'+field+'；下载文件保留，请人工核对后手动导入。')
            if any((row['raw'][column] or '(空白)') not in request['values'] for row in rows):
                raise ValueError('下载明细与'+field+'筛选不一致，未入库。')
        if 'Exported data exceeded' in metadata or '某些数据可能已被省略' in metadata:
            raise ValueError('导出提示数据截断，未作为完整快照入库。')
    bridge.start,bridge._poll,bridge.validate_download=start,poll,validate
    bridge._filter_guard_installed=True
