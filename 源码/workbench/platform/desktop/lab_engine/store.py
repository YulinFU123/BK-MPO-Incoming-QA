"""Versioned derived analysis database; originals are read only, imports transactional."""
from pathlib import Path
from datetime import datetime, timezone
from collections import Counter, OrderedDict
import hashlib, json, os, sqlite3
from uuid import uuid4
from . import tabular
_rows_cache=OrderedDict()

def clear_rows_cache():
    _rows_cache.clear()

def ensure_import_history_schema(db):
    statements = (
        '''CREATE TABLE IF NOT EXISTS import_batches(
            file_id INTEGER PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
            batch_key TEXT NOT NULL UNIQUE, withdrawn INTEGER NOT NULL DEFAULT 0,
            legacy INTEGER NOT NULL DEFAULT 0)''',
        '''CREATE TABLE IF NOT EXISTS import_record_baseline(
            record_id INTEGER PRIMARY KEY REFERENCES records(id) ON DELETE CASCADE,
            active INTEGER NOT NULL)''',
        '''CREATE TABLE IF NOT EXISTS import_record_covers(
            cover_file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
            record_id INTEGER NOT NULL REFERENCES records(id) ON DELETE CASCADE,
            PRIMARY KEY(cover_file_id,record_id))''',
        'CREATE INDEX IF NOT EXISTS import_cover_record ON import_record_covers(record_id)',
    )
    for statement in statements:
        db.execute(statement)

def digest(value): return hashlib.sha256(json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
def report_signature(config, calendar=None):
    return digest({'config':config,'calendar':calendar}) if calendar and calendar.get('sources') else digest(config)
def mapping_hash(source):
    value={k:source.get(k) for k in ['kind','sheet','headerRow','mapping','schema','cutoff','dateFormat','uniqueColumns','dateFromFilename']}
    if source.get('schema') and tabular.schema_for(source['columns']) != source['schema']:
        value['selectedColumns'] = sorted(column['id'] for column in source['columns'])
    if source.get('calendar',{}).get('mode')=='check-time':
        from . import shift_calendar
        value['calendar']=shift_calendar.validate(source['calendar'])
    if source.get('kind') == 'production':
        from .production_binding import active, normalize
        if active(source.get('productionBinding')):
            value['productionBinding'] = normalize(source.get('productionBinding'))
    return digest(value)
def connect(root):
    root=Path(root)
    if os.name=='nt':
        import ctypes
        if ctypes.windll.kernel32.GetDriveTypeW(str(root.resolve().anchor))==4: raise ValueError('分析数据库不能放在网络共享盘，请使用本机工作区；BI下载来源仍可选共享目录。')
    root.mkdir(parents=True,exist_ok=True)
    file=root/'analysis-v1.sqlite'
    db=sqlite3.connect(file,timeout=10)
    db.row_factory=sqlite3.Row
    version=db.execute('PRAGMA user_version').fetchone()[0]
    if version not in (0,1): db.close(); raise ValueError('分析库版本较新，原文件保留，请使用对应版本程序。')
    if version==0 and db.execute("SELECT count(*) FROM sqlite_master WHERE type='table'").fetchone()[0]: db.close(); raise ValueError('分析库结构无法确认，原文件保留。')
    db.execute('PRAGMA journal_mode=WAL'); db.execute('PRAGMA foreign_keys=ON')
    db.executescript('''CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value INTEGER NOT NULL);
    INSERT OR IGNORE INTO meta VALUES('revision',0);
    CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY,map_hash TEXT NOT NULL,columns_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS files(id INTEGER PRIMARY KEY,source_id TEXT NOT NULL,path TEXT NOT NULL,fingerprint TEXT NOT NULL,map_hash TEXT NOT NULL,active INTEGER NOT NULL,dates_json TEXT NOT NULL,row_count INTEGER NOT NULL,created TEXT NOT NULL,size INTEGER NOT NULL,mtime REAL NOT NULL);
    CREATE INDEX IF NOT EXISTS files_source ON files(source_id,active,path);
    CREATE TABLE IF NOT EXISTS records(id INTEGER PRIMARY KEY,file_id INTEGER NOT NULL REFERENCES files(id),source_id TEXT NOT NULL,row_no INTEGER NOT NULL,business_date TEXT NOT NULL,quantity REAL NOT NULL,canonical_json TEXT NOT NULL,values_json TEXT NOT NULL,signature TEXT NOT NULL,occurrence INTEGER NOT NULL,active INTEGER NOT NULL DEFAULT 1);
    CREATE INDEX IF NOT EXISTS record_dates ON records(source_id,business_date,active);
    CREATE INDEX IF NOT EXISTS record_signature ON records(source_id,signature,occurrence);
    PRAGMA user_version=1;''')
    ensure_import_history_schema(db)
    db.commit(); return db
def revision(db): return db.execute("SELECT value FROM meta WHERE key='revision'").fetchone()[0]

def file_access_message(name):
    return (
        f'无法读取「{Path(name).name}」。如果文件在 Excel 中打开，请关闭后重试。'
        'OneDrive 文件请先选「始终保留在此设备上」，等同步完成。'
        '如果仍无法读取，请用有读取权限的本地文件夹或联系管理员。'
    )

def folder(source):
    path=Path(source['folder']).expanduser().resolve(strict=True)
    if not path.is_dir() or path==Path(path.anchor): raise ValueError('请选择具体文件夹，不扫描磁盘根目录。')
    return path
def file_path(source,name):
    base=folder(source)
    if not isinstance(name,str) or Path(name).name!=name or name.startswith('~$'): raise ValueError('文件名无效。')
    path=base/name
    if path.is_symlink() or not path.is_file() or path.resolve().parent!=base: raise ValueError('仅支持所选目录内的普通文件，不跟随链接。')
    if path.suffix.lower() not in ['.xlsx','.csv'] or path.stat().st_size>50*1024*1024: raise ValueError('仅支持不超过50MB的XLSX/CSV。')
    return path
def scan(db,source):
    base=folder(source); output=[]
    expected_mapping = mapping_hash(source)
    for path in sorted(base.iterdir(),key=lambda p:p.name.casefold()):
        if path.suffix.lower() not in ['.xlsx','.csv'] or path.name.startswith('~$') or not path.is_file() or path.is_symlink(): continue
        if len(output)>=500: raise ValueError('目录超过500个数据文件，请按业务分目录。')
        stat=path.stat()
        prior=db.execute('SELECT size,mtime,map_hash FROM files WHERE source_id=? AND path=? AND active=1 ORDER BY id DESC LIMIT 1',(source['id'],path.name)).fetchone()
        status='未变化' if prior and prior['map_hash']==expected_mapping and prior['size']==stat.st_size and prior['mtime']==stat.st_mtime else '待核对'
        output.append({'name':path.name,'size':stat.st_size,'modified':stat.st_mtime,'status':status})
    return {'files':output,'revision':revision(db),'count':len(output)}
def import_files(db,source,names=None):
    if not source.get('confirmed'): raise ValueError('请先识别并确认表头映射。')
    listing=scan(db,source)['files']; allowed={r['name'] for r in listing}
    if names is not None and (not isinstance(names,list) or any(n not in allowed for n in names)): raise ValueError('导入文件不在已扫描目录中。')
    names=list(allowed) if names is None else names
    names.sort()
    mhash=mapping_hash(source); results=[]; total=0
    old=db.execute('SELECT map_hash FROM sources WHERE id=?',(source['id'],)).fetchone()
    rebuilding=bool(old and old['map_hash']!=mhash)
    for name in names:
        try:
            path=file_path(source,name); before=path.stat()
            if not before.st_size: raise ValueError('文件还未写入完成')
            with path.open('rb') as stream: fingerprint=hashlib.file_digest(stream,'sha256').hexdigest()
            identity=digest([fingerprint,tabular.filename_date(name) if source.get('dateFromFilename') else None])
            if db.execute('SELECT id FROM files WHERE source_id=? AND fingerprint=? AND map_hash=? AND active=1',(source['id'],identity,mhash)).fetchone():
                results.append({'name':name,'status':'跳过重复文件','rows':0}); continue
            if db.execute('''SELECT f.id FROM files f JOIN import_batches b ON b.file_id=f.id
                             WHERE f.source_id=? AND f.fingerprint=? AND f.map_hash=? AND b.withdrawn=1''',
                          (source['id'],identity,mhash)).fetchone():
                results.append({'name':name,'status':'已撤销批次','rows':0,
                                'warning':'如需重新使用此文件，请在导入历史中恢复此批次。'})
                continue
            data,info,dates=tabular.read_records(path,source)
            selected_ids = {column['id'] for column in source['columns']}
            selected_columns = [column for column in info['columns'] if column['id'] in selected_ids]
            if len(selected_columns) != len(selected_ids):
                raise ValueError('有已选列不在此文件中，请重新识别表头。')
            after=path.stat()
            if (before.st_size,before.st_mtime_ns)!=(after.st_size,after.st_mtime_ns): raise ValueError('文件仍在变化，请等待下载完成')
            if len(data)>200000: raise ValueError('文件超过20万行')
            counts=Counter(); prepared=[]
            for row in data:
                canon={k:v for k,v in row.items() if k not in ['values','row']}
                raw={k:tabular.display(v) for k,v in row['values'].items()}
                if source['mapping'].get('date'): raw[source['mapping']['date']]=row['date']
                if source['mapping'].get('quantity') and not row.get('productionMissing'): raw[source['mapping']['quantity']]=str(row['quantity'])
                if source.get('calendar',{}).get('mode')=='check-time':
                    from . import shift_calendar
                    moment=shift_calendar.clock(row['values'].get(source['calendar']['timeColumn']),source.get('dateFormat','auto'))
                    raw['__shift_time']=moment.isoformat() if moment else ''
                key=({'date':row['date'],'process':row['process'],'shift':row['shift'],'key':{k:raw.get(k,'') for k in source.get('uniqueColumns',[])}} if source['kind']=='production' else {'date':row['date'],'key':{k:raw.get(k,'') for k in source['uniqueColumns']}} if source.get('uniqueColumns') else {'date':row['date'],'values':raw})
                sign=digest(key); counts[sign]+=1
                if (source.get('uniqueColumns') or source['kind']=='production') and counts[sign]>1: raise ValueError('唯一字段重复；产量默认每日期/工序/班次一行，明细表请补选产品等唯一字段；文件未部分导入')
                prepared.append((row,canon,sign,counts[sign]))
            with db:
                register_import_history(db, source['id'])
                current=db.execute('SELECT map_hash FROM sources WHERE id=?',(source['id'],)).fetchone()
                if current and current['map_hash']!=mhash:
                    db.execute('UPDATE files SET active=0 WHERE source_id=?',(source['id'],))
                db.execute('INSERT INTO sources VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET map_hash=excluded.map_hash,columns_json=excluded.columns_json',(source['id'],mhash,json.dumps([{k:c[k] for k in ['id','label','type']} for c in selected_columns],ensure_ascii=False)))
                cursor=db.execute('INSERT INTO files(source_id,path,fingerprint,map_hash,active,dates_json,row_count,created,size,mtime) VALUES(?,?,?,?,1,?,?,?,?,?)',(source['id'],name,identity,mhash,json.dumps(dates),len(data),datetime.now(timezone.utc).isoformat(),before.st_size,before.st_mtime))
                fid=cursor.lastrowid
                db.execute('INSERT INTO import_batches(file_id,batch_key) VALUES(?,?)', (fid, uuid4().hex))
                if source.get('updateMode','replace_dates')=='replace_dates' and dates:
                    marks=','.join('?' for _ in dates)
                    # Cover withdrawn predecessors too, so restoring one later
                    # cannot reintroduce rows replaced while it was withdrawn.
                    db.execute(f'''INSERT OR IGNORE INTO import_record_covers
                        SELECT ?,r.id FROM records r JOIN files f ON f.id=r.file_id
                        LEFT JOIN import_batches b ON b.file_id=f.id
                        WHERE r.source_id=? AND f.path=? AND f.map_hash=? AND f.id<?
                        AND (f.active=1 OR b.withdrawn=1) AND r.business_date IN ({marks})''',
                        [fid,source['id'],name,mhash,fid,*dates])
                db.executemany(
                    'INSERT INTO records(file_id,source_id,row_no,business_date,quantity,canonical_json,values_json,signature,occurrence) VALUES(?,?,?,?,?,?,?,?,?)',
                    ((fid,source['id'],r['row'],r['date'],r['quantity'],json.dumps(c,ensure_ascii=False),
                      json.dumps({key:value for key,value in r['values'].items() if key in selected_ids},ensure_ascii=False),
                      sign,occurrence) for r,c,sign,occurrence in prepared),
                )
                db.execute('''INSERT INTO import_record_baseline(record_id,active)
                              SELECT id,1 FROM records WHERE file_id=?''', (fid,))
                refresh_import_masks(db, source['id'])
                db.execute("UPDATE meta SET value=value+1 WHERE key='revision'")
            total+=len(data)
            unassigned=sum(bool(row.get('shiftNote')) for row in data)
            blank_defects=sum(not row['defect'] for row in data) if source['kind']=='defects' else 0
            warnings=[]
            skipped_undated = info.get('skippedUndatedDecisions', 0)
            if skipped_undated:
                warnings.append(f'{skipped_undated} 条判定时间为空，未纳入日期分析；原文件保留，未使用报告时间或文件名代替。')
            if unassigned:
                warnings.append(f'{unassigned} 行未归班。')
            if blank_defects:
                warnings.append(f'保留了 {blank_defects} 条不良项为空的记录，可在分析中筛选「空白」。')
            normal_blanks = info.get('normalDecisionBlanks', {})
            production_import = info.get('productionImport', {})
            if production_import.get('pendingQuantityRows'):
                warnings.append(f'保留 {production_import["pendingQuantityRows"]} 条产量待补充记录；涉及的统计范围不计算不良率。')
            if production_import.get('skippedHeaderRows'):
                warnings.append(f'已跳过 {production_import["skippedHeaderRows"]} 行重复表头。')
            if production_import.get('filledCells'):
                warnings.append(f'按显式绑定继承了 {production_import["filledCells"]} 个分组单元格。')
            for key, label in [('pending', '未判定'), ('release', '已判放行')]:
                count = normal_blanks.get(key, 0)
                if count:
                    warnings.append(f'{label}的空白判定原因 {count} 条。')
            results.append({'name':name,'status':'已导入','rows':len(data),'dates':dates,
                            **({'skippedUndatedDecisions':skipped_undated} if skipped_undated else {}),
                            **({'unassignedRows':unassigned} if unassigned else {}),
                            **({'blankDefectRows':blank_defects} if blank_defects else {}),
                            **({'warning':' '.join(warnings)} if warnings else {})})
        except PermissionError:
            results.append({'name':name,'status':'未导入','error':file_access_message(name),'rows':0})
        except Exception as error:
            results.append({'name':name,'status':'未导入','error':str(error),'rows':0})
    return {'files':results,'importedRows':total,'revision':revision(db),'rebuilding':rebuilding,'errors':sum('error' in r for r in results)}


def register_import_history(db, source_id):
    """Preserve legacy visibility exactly, without guessing old overwrite rules."""
    ensure_import_history_schema(db)
    missing = db.execute('''SELECT f.id FROM files f LEFT JOIN import_batches b ON b.file_id=f.id
                            WHERE f.source_id=? AND b.file_id IS NULL''', (source_id,)).fetchall()
    db.executemany('INSERT INTO import_batches(file_id,batch_key,legacy) VALUES(?,?,1)',
                   ((row['id'], uuid4().hex) for row in missing))
    db.execute('''INSERT OR IGNORE INTO import_record_baseline(record_id,active)
                  SELECT id,active FROM records WHERE source_id=?''', (source_id,))
    # A compatible older program can update this database without recording
    # cover edges. Preserve any such inactive mask instead of reviving it.
    db.execute('''UPDATE import_record_baseline SET active=0 WHERE active=1 AND record_id IN(
        SELECT r.id FROM records r WHERE r.source_id=? AND r.active=0 AND NOT EXISTS(
            SELECT 1 FROM import_record_covers cover JOIN files f ON f.id=cover.cover_file_id
            WHERE cover.record_id=r.id AND f.active=1))''', (source_id,))


def refresh_import_masks(db, source_id):
    db.execute('''UPDATE records SET active=(
        SELECT CASE WHEN baseline.active=1 AND NOT EXISTS(
            SELECT 1 FROM import_record_covers cover
            JOIN files covering ON covering.id=cover.cover_file_id
            WHERE cover.record_id=records.id AND covering.active=1
        ) THEN 1 ELSE 0 END FROM import_record_baseline baseline
        WHERE baseline.record_id=records.id)
        WHERE source_id=? AND id IN (SELECT record_id FROM import_record_baseline)''', (source_id,))


def import_history(db, source, offset=0):
    if type(offset) is not int or not 0 <= offset <= 100000:
        raise ValueError('导入批次位置无效。')
    with db:
        register_import_history(db, source['id'])
    expected = mapping_hash(source)
    registered = db.execute('SELECT map_hash FROM sources WHERE id=?', (source['id'],)).fetchone()
    total = db.execute('SELECT count(*) FROM files WHERE source_id=?', (source['id'],)).fetchone()[0]
    rows = db.execute('''WITH ranked AS (
                        SELECT r.file_id,ROW_NUMBER() OVER(
                            PARTITION BY r.signature,r.occurrence ORDER BY r.file_id DESC,r.id DESC) AS rank
                        FROM records r JOIN files f ON f.id=r.file_id
                        WHERE r.source_id=? AND r.active=1 AND f.active=1),
                        visible AS (SELECT file_id,count(*) AS row_count FROM ranked WHERE rank=1 GROUP BY file_id)
                        SELECT f.*,b.batch_key,b.withdrawn,b.legacy,COALESCE(v.row_count,0) AS visible_rows
                        FROM files f JOIN import_batches b ON b.file_id=f.id
                        LEFT JOIN visible v ON v.file_id=f.id
                        WHERE f.source_id=? ORDER BY f.id DESC LIMIT 50 OFFSET ?''',
                      (source['id'], source['id'], offset)).fetchall()
    batches = []
    for row in rows:
        compatible = bool(registered and registered['map_hash'] == expected == row['map_hash'])
        actionable = compatible and (row['active'] == 1 or row['withdrawn'] == 1)
        batches.append({
            'batchId': row['batch_key'], 'name': row['path'], 'created': row['created'],
            'rowCount': row['row_count'], 'dates': json.loads(row['dates_json']),
            'visibleRows': row['visible_rows'] if row['active'] else 0,
            'withdrawn': bool(row['withdrawn']), 'legacy': bool(row['legacy']),
            'canChange': actionable,
            'status': '已撤销' if row['withdrawn'] else '已导入' if row['active'] else '旧映射批次',
            'note': ('此批次与当前字段映射不同，请核对来源后重新导入原档。' if not actionable else
                     '历史批次撤销时不自动复活更早覆盖记录，可重新导入正确原档。' if row['legacy'] else ''),
        })
    return {'batches': batches, 'revision': revision(db), 'total': total, 'offset': offset,
            'more': offset + len(rows) < total}


def set_import_batch(db, source, batch_id, enabled, expected_revision):
    if (not isinstance(batch_id, str) or len(batch_id) != 32 or
            any(char not in '0123456789abcdef' for char in batch_id) or type(enabled) is not bool or
            type(expected_revision) is not int or expected_revision < 0):
        raise ValueError('导入批次操作参数无效。')
    with db:
        # Acquire the write lock before the revision check. Every analysis data
        # mutation shares this revision, including other database connections.
        db.execute("UPDATE meta SET value=value WHERE key='revision'")
        if revision(db) != expected_revision:
            raise ValueError('分析数据已变化，请刷新批次列表后重试。')
        register_import_history(db, source['id'])
        row = db.execute('''SELECT f.*,b.withdrawn,b.legacy FROM import_batches b
                            JOIN files f ON f.id=b.file_id WHERE b.batch_key=? AND f.source_id=?''',
                         (batch_id, source['id'])).fetchone()
        registered = db.execute('SELECT map_hash FROM sources WHERE id=?', (source['id'],)).fetchone()
        if not row:
            raise ValueError('批次不属于当前来源，请重新读取批次列表。')
        if (not registered or registered['map_hash'] != mapping_hash(source) or
                row['map_hash'] != registered['map_hash'] or not (row['active'] or row['withdrawn'])):
            raise ValueError('批次与当前字段映射不同，未改动分析数据，请核对来源并从原档重新导入。')
        changed = bool(row['withdrawn']) == enabled
        if changed:
            db.execute('UPDATE import_batches SET withdrawn=? WHERE file_id=?', (int(not enabled), row['id']))
            db.execute('UPDATE files SET active=? WHERE id=?', (int(enabled), row['id']))
            refresh_import_masks(db, source['id'])
            db.execute("UPDATE meta SET value=value+1 WHERE key='revision'")
    clear_rows_cache()
    return {'changed': changed, 'enabled': enabled, 'revision': revision(db),
            'legacy': bool(row['legacy']),
            'message': ('已恢复该导入批次。' if enabled else
                        '旧批次已移出分析，可从原档重导正确批次。' if row['legacy'] else
                        '已撤销该导入批次，可在导入历史中恢复。')}
def load_rows(db,source,start=None,end=None):
    registered=db.execute('SELECT map_hash FROM sources WHERE id=?',(source['id'],)).fetchone()
    if not registered: return []
    if registered['map_hash']!=mapping_hash(source): raise ValueError('字段映射已改变，请重新导入该来源后分析。旧批次仍保留。')
    cache_key=(db.execute('PRAGMA database_list').fetchone()[2],revision(db),db.total_changes,db.execute('PRAGMA data_version').fetchone()[0],source['id'],registered['map_hash'],start,end)
    if cache_key in _rows_cache:
        _rows_cache.move_to_end(cache_key);return _rows_cache[cache_key]
    where='r.source_id=? AND r.active=1 AND f.active=1'; args=[source['id']]
    if start: where+=' AND r.business_date>=?'; args.append(start)
    if end: where+=' AND r.business_date<=?'; args.append(end)
    query=f'''SELECT * FROM (SELECT r.*,f.path AS filename,ROW_NUMBER() OVER(PARTITION BY r.signature,r.occurrence ORDER BY r.file_id DESC,r.id DESC) AS rank FROM records r JOIN files f ON r.file_id=f.id WHERE {where}) WHERE rank=1'''
    output=[]
    for row in db.execute(query,args):
        if len(output)>=500000: raise ValueError('当前分析超过50万行，请缩小日期范围。')
        output.append({**json.loads(row['canonical_json']),'values':json.loads(row['values_json']),'file':row['filename'],'row':row['row_no'],'id':row['id']})
    if len(output)<=100000:
        _rows_cache[cache_key]=output
        while len(_rows_cache)>3 or sum(len(rows) for rows in _rows_cache.values())>100000:_rows_cache.popitem(last=False)
    return output
def catalog(db,source):
    rows=db.execute('SELECT dates_json FROM files WHERE source_id=? AND active=1',(source['id'],)).fetchall()
    dates=sorted({d for row in rows for d in json.loads(row['dates_json'])})
    return {'dates':dates,'start':dates[0] if dates else None,'end':dates[-1] if dates else None,'files':len(rows),'revision':revision(db)}
