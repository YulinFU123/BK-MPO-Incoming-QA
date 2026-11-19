"""Read-only XLSX/CSV inspection and explicit field mapping."""
from pathlib import Path
from datetime import date, datetime, timedelta
from collections import Counter
import csv, hashlib, io, json, math, re
import openpyxl

ALIASES = {
    'date': ['业务日期','生产日期','发生日期','发现日期','check date','work date','business date','production date','日期','date','created on','nc creation date','报告时间'],
    'defect': ['不良项','不良类型','异常现象','不良现象','defect description','nc description','defect','failure code','nc code','报告异常代码'],
    'quantity': ['不良件数','不良数量','数量','defect qty','sum of qty','qty','quantity','nc quantity','scrap quantity'],
    'employee': ['employee in charge','责任员工','责任人','作业员','员工','operator'],
    'reporter': ['报检人','报检员','检验员','reported by','report full name','inspector','报告人'],
    'process': ['工序','生产工序','在制工序','workflow step in charge','workflow step name','process','operation','process type in charge'],
    'shift': ['班次','班别','shift'], 'floor': ['楼层','区域','floor','area'],
    'product': ['产品','产品型号','product','part number','model','型号'], 'serial': ['sn','序列号','serial number'],
}
PRODUCTION = ['产量','生产数量','生产件数','当日产能（有公式）','当日产能','检验数量','production qty','output','inspected quantity','total qty','quantity','qty','数量']
def norm(value): return re.sub(r'[\s_：:()（）\-]+', '', str(value or '').strip().casefold())

def schema_for(columns):
    fields = sorted((column['id'], norm(column['label'])) for column in columns)
    return hashlib.sha256(json.dumps(fields).encode()).hexdigest()

def display(value):
    if isinstance(value, (datetime,date)): return value.isoformat(sep=' ') if isinstance(value,datetime) else value.isoformat()
    if value is None: return ''
    if isinstance(value,bool): return 'TRUE' if value else 'FALSE'
    if isinstance(value,float): return str(int(value)) if value.is_integer() else str(value)
    return str(value).strip()
def primitive(cell):
    value = cell.value
    if cell.data_type == 'e': return None
    if isinstance(value,float) and not math.isfinite(value): return None
    if isinstance(value,(date,datetime)): return display(value)
    if isinstance(value,(int,float)) and re.fullmatch(r'0{1,64}',cell.number_format or '') and float(value).is_integer():
        return str(int(value)).zfill(len(cell.number_format))
    return value if isinstance(value,(str,int,float,bool)) or value is None else str(value)
def tables(file):
    file = Path(file)
    if file.suffix.lower()=='.csv':
        raw=file.read_bytes()
        try: text=raw.decode('utf-8-sig')
        except UnicodeDecodeError: text=raw.decode('gb18030')
        try: dialect=csv.Sniffer().sniff(text[:8192],delimiters=',\t;')
        except csv.Error: dialect=csv.excel
        rows=list(csv.reader(io.StringIO(text),dialect))
        if len(rows)>200001: raise ValueError('CSV超过20万行，请拆分文件。')
        return [(file.stem,rows)]
    if file.suffix.lower()!='.xlsx': raise ValueError('请使用XLSX或CSV；旧XLS请先另存为XLSX。')
    from zipfile import ZipFile
    with ZipFile(file) as archive:
        if any('vbaProject' in n or 'externalLinks/' in n for n in archive.namelist()): raise ValueError('不导入宏或外部链接工作簿，请另存普通XLSX。')
        if sum(x.file_size for x in archive.infolist())>300*1024*1024: raise ValueError('工作簿解压后过大。')
    book=openpyxl.load_workbook(file,read_only=True,data_only=True,keep_links=False)
    result=[]
    try:
        if book.properties.creator=='BK_MPO_ANALYSIS_REPORT': raise ValueError('这是平台导出的报告，请将报告输出目录与BI原始下载目录分开。')
        for sheet in book.worksheets[:20]:
            if sheet.max_column and sheet.max_column>128: raise ValueError('每张表最多128列。')
            if sheet.max_row and sheet.max_row>200001: raise ValueError('每张表最多20万行。')
            if (sheet.max_row or 0)*(sheet.max_column or 0)>2000000: raise ValueError('工作表超过200万个单元格，请拆分。')
            rows=[[primitive(c) for c in row] for row in sheet.iter_rows()]
            result.append((sheet.title,rows))
    finally: book.close()
    return result
def header_info(rows, kind='defects', header=0):
    aliases={role:[norm(x) for x in (PRODUCTION if role=='quantity' and kind=='production' else names)] for role,names in ALIASES.items()}
    if kind == 'defects':
        aliases['date'].insert(aliases['date'].index(norm('报告时间')), norm('判定时间'))
    def score(row):
        vals={norm(x) for x in row if x is not None}
        return sum((4 if role in ['date','quantity','defect'] else 2) for role,names in aliases.items() if vals.intersection(names))
    chosen=header-1 if header else max(range(min(len(rows),100)),key=lambda i:(score(rows[i]),sum(bool(display(x)) for x in rows[i])),default=0)
    if chosen<0 or chosen>=len(rows): raise ValueError('表头行超出文件范围。')
    values=rows[chosen]
    count=max((len(r) for r in rows),default=0)
    if count>128: raise ValueError('列数超过128，请整理工作表。')
    columns=[]; occurrences={}; mapping={}; confidence={}
    for i in range(count):
        title=display(values[i] if i<len(values) else '') or f'未命名列{i+1}'
        key=norm(title); occurrences[key]=occurrences.get(key,0)+1
        fid='h_'+hashlib.sha256((key+'#'+str(occurrences[key])).encode()).hexdigest()[:16]
        samples=[r[i] for r in rows[chosen+1:chosen+25] if i<len(r) and r[i] is not None and display(r[i])][:5]
        dtype='number' if samples and all(isinstance(x,(int,float)) and not isinstance(x,bool) for x in samples) else 'text'
        if samples and all(re.match(r'^\d{4}[-/]\d{1,2}[-/]\d{1,2}',display(x)) for x in samples): dtype='date'
        columns.append({'id':fid,'label':title,'type':dtype,'index':i,'examples':[display(x) for x in samples]})
    for role,names in aliases.items():
        candidates=sorted([(names.index(norm(c['label'])),c['id']) for c in columns if norm(c['label']) in names])
        if role=='process':
            family_ids={c['id'] for c in columns if norm(c['label'])==norm('Process Type in Charge')
                        and c['examples'] and all(x.strip().upper() in {'LCD','MMC','MMC24','MPO'} for x in c['examples'] if x.strip())}
            candidates=[c for c in candidates if c[1] not in family_ids]
        if candidates: mapping[role]=candidates[0][1]; confidence[role]='exact' if len(candidates)==1 else 'review'
    schema=schema_for(columns)
    return {'headerRow':chosen+1,'columns':columns,'mapping':mapping,'confidence':confidence,'schema':schema,'score':score(values)}
def inspect(file, source, *, field_coverage=True):
    sheets=tables(file)
    if not sheets: raise ValueError('工作簿没有可读取的工作表。')
    selected=next((pair for pair in sheets if pair[0]==source.get('sheet')),None) if source.get('sheet') else max(sheets,key=lambda pair:header_info(pair[1],source['kind'],source.get('headerRow',0))['score'] if pair[1] else -1)
    if selected is None: raise ValueError('未找到配置的工作表，请重新选择。')
    name,rows=selected
    if not rows: raise ValueError('工作表没有数据或表头。')
    info=header_info(rows,source['kind'],source.get('headerRow',0))
    data_rows=rows[info['headerRow']:]
    if source['kind'] == 'production':
        from .production_binding import add_hints
        add_hints(info, data_rows)
    if source['kind']=='defects':
        suggest_work_date(info, data_rows, source.get('dateFormat','auto'))
        decision_columns = mlight_decision_columns(name, info['columns'])
        if decision_columns:
            info['mlightReasonColumn'] = decision_columns['判定原因']
            judgment = decision_columns.get('判定时间')
            if judgment:
                # Recommendations are distinct from an already confirmed
                # mapping. The UI reconciles and retains explicit choices.
                info['mapping']['date'] = judgment
                info['confidence']['date'] = 'review'
        judgment = next((c['id'] for c in info['columns']
                         if c['id'] == info['mapping'].get('date') and norm(c['label']) == norm('判定时间')), None)
        if judgment:
            info['decisionDateColumn'] = judgment
        if field_coverage:
            present = Counter()
            records = 0
            for row in data_rows:
                populated = [index for index, value in enumerate(row) if display(value)]
                if populated:
                    records += 1
                    present.update(populated)
            for column in info['columns']:
                column['blankRows'] = records - present[column['index']]
    return {**info,'sheet':name,'sheets':[p[0] for p in sheets],'rowCount':max(0,len(rows)-info['headerRow']),
            'preview':[[display(x) for x in row[:len(info['columns'])]] for row in data_rows[:5]]}


def mlight_decision_columns(sheet, columns):
    if sheet.strip().casefold() != 'container':
        return None
    ids = {column['label']: column['id'] for column in columns}
    fields = ('容器号', '状态', '报告异常代码', '判定异常代码', '判定类型', '判定原因')
    return ids if all(field in ids for field in fields) else None


PENDING_DECISION_STATES = frozenset(('未判', '待判', '未判定', '待判定'))


def normal_blank_decision(raw, columns):
    status = display(raw.get(columns['状态']))
    if status in PENDING_DECISION_STATES:
        return 'pending'
    if status == '已判' and display(raw.get(columns['判定类型'])).casefold() == 'release':
        return 'release'
    return None


def suggest_work_date(info, rows, date_format):
    check = next((c for c in info['columns'] if c['id']==info['mapping'].get('date')), None)
    work = next((c for c in info['columns'] if norm(c['label'])=='workdate'), None)
    if not check or norm(check['label'])!='checkdate' or not work:
        return
    check_index, work_index = check['index'], work['index']
    missing = 0
    for row in rows:
        if not any(display(value) for value in row):
            continue
        if check_index>=len(row) or not display(row[check_index]):
            missing += 1
        try:
            parse_date(row[work_index] if work_index<len(row) else None, fmt=date_format)
        except ValueError:
            return
    if missing:
        info['mapping']['date'] = work['id']
        info['confidence']['date'] = 'review'
        info['dateFallback'] = {'missingCheckDates': missing}


def parse_date(value, cutoff=0, fmt='auto'):
    text=display(value)
    if not text: raise ValueError('日期为空')
    if isinstance(value,(float,int)) and 1<=value<100000:
        day=datetime(1899,12,30)+timedelta(days=value)
    else:
        match=re.fullmatch(r'(\d{4})[年/-](\d{1,2})[月/-](\d{1,2})(?:日)?(?:[ T](\d{1,2}):(\d\d)(?::(\d\d)(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)?)?',text)
        if not match:
            other=re.fullmatch(r'(\d{1,2})/(\d{1,2})/(\d{4})(.*)',text)
            if not other: raise ValueError('无法明确识别日期，请使用含年份的日期')
            a,b,year,tail=other.groups(); a,b=int(a),int(b)
            selected=fmt if fmt in ['mdy','dmy'] else 'dmy' if a>12 and b<=12 else 'mdy' if b>12 and a<=12 else None
            if selected is None: raise ValueError('斜杠日期存在月日歧义，请在来源设置选择月/日/年或日/月/年')
            month,dd=(a,b) if selected=='mdy' else (b,a)
            if not tail.strip(): return date(int(year),month,dd).isoformat()
            normalized=f'{int(year):04d}-{month:02d}-{dd:02d}'+tail
            if re.search(r'\b(?:AM|PM)\b',tail,re.I):
                # Excel/BI exports commonly omit seconds ("3/4/2026 3:45 PM").
                # shift_calendar.clock() already accepts both forms; keep this
                # parser consistent so one odd row cannot reject a whole file.
                day=None
                for pattern in ('%Y-%m-%d %I:%M:%S %p','%Y-%m-%d %I:%M %p'):
                    try:
                        day=datetime.strptime(normalized,pattern)
                        break
                    except ValueError:
                        continue
                if day is None:
                    raise ValueError('无法识别12小时制时间，请使用 h:mm AM/PM 或 h:mm:ss AM/PM')
                if cutoff and day.hour<cutoff: day-=timedelta(days=1)
                return day.date().isoformat()
            return parse_date(normalized,cutoff,'ymd')
        y,m,d,h,minute,second=match.groups(); day=datetime(int(y),int(m),int(d),int(h or 0),int(minute or 0),int(second or 0))
        if h is None: return day.date().isoformat()
    if cutoff and day.hour<cutoff: day-=timedelta(days=1)
    return day.date().isoformat()
def filename_date(name):
    match=re.search(r'(?<!\d)(20\d{2})[-_年]?(\d\d)[-_月]?(\d\d)(?!\d)',name)
    return date(*map(int,match.groups())).isoformat() if match else None
def number(value):
    if isinstance(value,bool): raise ValueError('数量不是数字')
    try: out=float(str(value).replace(',','').strip())
    except (TypeError,ValueError): raise ValueError('数量不是数字')
    if not math.isfinite(out) or out<0 or out>1e12: raise ValueError('数量必须是0至一万亿之间的有限数字')
    return out
def read_records(file,source):
    info=inspect(file,source,field_coverage=False)
    if source.get('schema') and info['schema']!=source['schema']: raise ValueError('表头结构与已确认映射不一致，请重新识别确认；本文件未导入。')
    rows=next(rows for name,rows in tables(file) if name==info['sheet'])
    if source['kind'] == 'production':
        from .production_binding import read_records as read_production
        return read_production(file, source, info, rows)
    mapping=source['mapping']; columns=info['columns']; output=[]; errors=[]
    normal_blanks = Counter()
    decision_columns = mlight_decision_columns(info['sheet'], columns) if info.get('mlightReasonColumn') else None
    from . import shift_calendar
    calendar=shift_calendar.validate(source.get('calendar',{}))
    if calendar['mode']=='check-time' and calendar['timeColumn'] not in {c['id'] for c in columns}:
        raise ValueError('班次时间列不在当前文件中，请重新选择Check Date并确认规则。')
    fallback=filename_date(Path(file).name) if source.get('dateFromFilename') and not mapping.get('date') else None
    if not mapping.get('date') and not fallback: raise ValueError('缺少日期列，文件名也没有已确认的完整日期。')
    judgment_date = any(c['id'] == mapping.get('date') and norm(c['label']) == norm('判定时间') for c in columns)
    if judgment_date and calendar['mode'] == 'check-time' and calendar['dateBasis'] != 'mapped' and calendar['timeColumn'] != mapping['date']:
        raise ValueError('统计日期已选判定时间，但班次规则仍按其他时间列归日；请把班次时间改为判定时间，或选择保持映射日期后重新导入。')
    skipped_undated = 0
    for index,row in enumerate(rows[info['headerRow']:],start=info['headerRow']+1):
        if not any(display(x) for x in row): continue
        raw={c['id']:(row[c['index']] if c['index']<len(row) else None) for c in columns}
        try:
            get=lambda role:raw.get(mapping.get(role,''))
            if judgment_date and not display(get('date')):
                # No judgment time means no place on a judged-date trend.
                # Keep the source workbook untouched; never substitute the
                # report timestamp, filename date, or the computer's date.
                skipped_undated += 1
                continue
            business=parse_date(get('date'),source.get('cutoff',0),source.get('dateFormat','auto')) if mapping.get('date') else fallback
            qty=number(get('quantity')) if mapping.get('quantity') else 1.
            canonical={role:display(get(role)) for role in ALIASES if role not in ['date','quantity']}
            if calendar['mode']=='check-time':
                business,canonical['shift'],note=shift_calendar.apply(raw,business,calendar,source.get('dateFormat','auto'))
                if note: canonical['shiftNote']=note
            if decision_columns and not display(raw.get(decision_columns['判定原因'])):
                decision = normal_blank_decision(raw, decision_columns)
                if decision == 'pending':
                    canonical['pendingDecision'] = True
                if decision and not canonical['defect']:
                    normal_blanks[decision] += 1
            if source['kind']=='production' and (not canonical['process'] or not canonical['shift']): raise ValueError('产量缺少工序或班次')
            output.append({'date':business,'quantity':qty,**canonical,'values':raw,'row':index})
        except (ValueError,TypeError) as error:
            if len(errors)<20: errors.append({'row':index,'message':str(error)})
    if errors: raise ValueError(f'文件含无效行，未部分导入：'+ '; '.join(f"第{x["row"]}行 {x["message"]}" for x in errors[:5]))
    if normal_blanks:
        info['normalDecisionBlanks'] = dict(normal_blanks)
    if skipped_undated:
        info['skippedUndatedDecisions'] = skipped_undated
    dates=sorted({r['date'] for r in output} or ({fallback} if fallback else set()))
    return output, info, dates
