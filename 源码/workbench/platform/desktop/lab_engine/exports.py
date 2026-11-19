"""Shared physical-mm report rendering: PDF/PNG plus editable Excel charts and provenance."""
from pathlib import Path
import csv, hashlib, io, json, math, os, sqlite3, tempfile, zipfile
from . import store, analysis

def validate_pages(pages):
    if not isinstance(pages,list) or not 1<=len(pages)<=24: raise ValueError('报告页数无效。')
    def number(v,limit=2000): return isinstance(v,(int,float)) and not isinstance(v,bool) and math.isfinite(v) and abs(v)<=limit
    def color(v): return isinstance(v,str) and len(v)==7 and v.startswith('#') and all(c in '0123456789abcdefABCDEF' for c in v[1:])
    for page in pages:
        if page.get('width')!=297 or page.get('height')!=210 or not isinstance(page.get('commands'),list) or len(page['commands'])>50000: raise ValueError('报告必须为横向A4。')
        for c in page['commands']:
            kind=c.get('kind')
            if kind not in ['rect','line','polyline','polygon','text','circle']: raise ValueError('不支持的报告图形。')
            if any(not number(v) for k,v in c.items() if k in ['x','y','w','h','x1','x2','y1','y2','r','size','width']): raise ValueError('报告坐标无效。')
            if any(not color(c[k]) for k in ['fill','stroke','color'] if k in c): raise ValueError('报告颜色无效。')
            coords=[]
            if kind=='rect':
                if c['w']<0 or c['h']<0: raise ValueError('报告尺寸不能为负数。')
                coords=[(c['x'],c['y']),(c['x']+c['w'],c['y']+c['h'])]
            elif kind=='line': coords=[(c['x1'],c['y1']),(c['x2'],c['y2'])]
            elif kind in ['polyline','polygon']:
                if not isinstance(c.get('points'),list) or len(c['points'])>2048: raise ValueError('图形点数超过限制。')
                coords=c['points']
            elif kind=='text':
                if not isinstance(c.get('text'),str) or len(c['text'])>1024 or not 6<=c['size']<=36 or c.get('anchor') not in ['start','middle','end']: raise ValueError('报告文字无效。')
                coords=[(c['x'],c['y'])]
            else: coords=[(c['x']-c['r'],c['y']-c['r']),(c['x']+c['r'],c['y']+c['r'])]
            if any(len(p)!=2 or any(not number(n) for n in p) or not -.1<=p[0]<=297.1 or not -.1<=p[1]<=210.1 for p in coords): raise ValueError('图表超出横向A4边界，未生成文件。')
    return pages
def font_path(bold=False):
    base=Path(os.environ.get('WINDIR',r'C:\Windows'))/'Fonts'
    names=['simhei.ttf','msyhbd.ttc','msyh.ttc','simsun.ttc'] if bold else ['msyh.ttc','simsun.ttc','simhei.ttf']
    return next((base/n for n in names if (base/n).is_file()),None)
def page_images(pages,dpi=240):
    from PIL import Image, ImageDraw, ImageFont
    scale=dpi/25.4; output=[]; fonts={}
    for page in pages:
        image=Image.new('RGB',(round(297*scale),round(210*scale)),'white'); draw=ImageDraw.Draw(image)
        for c in page['commands']:
            kind=c['kind']; xy=lambda x,y:(x*scale,y*scale)
            if kind=='rect':
                box=[*xy(c['x'],c['y']),*xy(c['x']+c['w'],c['y']+c['h'])]
                draw.rectangle(box,fill=c['fill'],outline=c['stroke'] if c['width'] else None,width=max(1,round(c['width']*scale)))
            elif kind=='line': draw.line([xy(c['x1'],c['y1']),xy(c['x2'],c['y2'])],fill=c['color'],width=max(1,round(c['width']*scale)))
            elif kind in ['polyline','polygon']:
                points=[xy(*p) for p in c['points']]
                if kind=='polygon': draw.polygon(points,fill=c['fill'])
                elif len(points)>1: draw.line(points,fill=c['color'],width=max(1,round(c['width']*scale)))
            elif kind=='circle': draw.ellipse([*xy(c['x']-c['r'],c['y']-c['r']),*xy(c['x']+c['r'],c['y']+c['r'])],fill=c['fill'])
            elif kind=='text':
                key=(c['size'],bool(c.get('bold')))
                if key not in fonts:
                    path=font_path(key[1])
                    if path is None: raise ValueError('缺少中文字体，无法可靠生成中文报告图片。')
                    fonts[key]=ImageFont.truetype(str(path),max(1,round(c['size']*dpi/72)))
                anchor={'start':'ls','middle':'ms','end':'rs'}[c['anchor']]
                draw.text(xy(c['x'],c['y']),c['text'],font=fonts[key],fill=c['color'],anchor=anchor)
        output.append(image)
    return output
def pdf_bytes(pages,title,subject):
    from reportlab.pdfgen import canvas
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.pdfbase.cidfonts import UnicodeCIDFont
    names={}
    for bold in [False,True]:
        name='LabBold' if bold else 'LabRegular'
        candidates=[font_path(bold),Path(os.environ.get('WINDIR',r'C:\Windows'))/'Fonts/simsun.ttc']
        for file in candidates:
            if file is None: continue
            try:
                if name not in pdfmetrics.getRegisteredFontNames(): pdfmetrics.registerFont(TTFont(name,str(file)))
                names[bold]=name; break
            except Exception: continue
        if bold not in names:
            pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light')); names[bold]='STSong-Light'
    mm=72/25.4; stream=io.BytesIO(); out=canvas.Canvas(stream,pagesize=(297*mm,210*mm),pageCompression=1)
    out.setTitle(title); out.setSubject(subject); out.setAuthor('BK_MPO')
    rgb=lambda value:tuple(int(value[i:i+2],16)/255 for i in [1,3,5])
    for page in pages:
        for c in page['commands']:
            kind=c['kind']
            if kind=='rect':
                out.setFillColorRGB(*rgb(c['fill'])); out.setStrokeColorRGB(*rgb(c['stroke'])); out.setLineWidth(c['width']*mm)
                out.rect(c['x']*mm,(210-c['y']-c['h'])*mm,c['w']*mm,c['h']*mm,fill=1,stroke=int(c['width']>0))
            elif kind=='line':
                out.setStrokeColorRGB(*rgb(c['color'])); out.setLineWidth(c['width']*mm); out.line(c['x1']*mm,(210-c['y1'])*mm,c['x2']*mm,(210-c['y2'])*mm)
            elif kind in ['polyline','polygon'] and c['points']:
                path=out.beginPath(); path.moveTo(c['points'][0][0]*mm,(210-c['points'][0][1])*mm)
                for x,y in c['points'][1:]: path.lineTo(x*mm,(210-y)*mm)
                if kind=='polygon': path.close(); out.setFillColorRGB(*rgb(c['fill'])); out.drawPath(path,stroke=0,fill=1)
                else: out.setStrokeColorRGB(*rgb(c['color'])); out.setLineWidth(c['width']*mm); out.drawPath(path,stroke=1,fill=0)
            elif kind=='circle': out.setFillColorRGB(*rgb(c['fill'])); out.circle(c['x']*mm,(210-c['y'])*mm,c['r']*mm,fill=1,stroke=0)
            elif kind=='text':
                out.setFillColorRGB(*rgb(c['color'])); out.setFont(names[bool(c.get('bold'))],c['size'])
                method={'start':out.drawString,'middle':out.drawCentredString,'end':out.drawRightString}[c['anchor']]
                method(c['x']*mm,(210-c['y'])*mm,c['text'])
        out.showPage()
    out.save(); return stream.getvalue()
def xlsx_bytes(pages,charts,db,config):
    from openpyxl import Workbook
    from openpyxl.drawing.image import Image
    from openpyxl.chart import BarChart, LineChart, PieChart, Reference
    from openpyxl.chart.label import DataLabelList
    from openpyxl.drawing.spreadsheet_drawing import AbsoluteAnchor
    from openpyxl.drawing.xdr import XDRPoint2D, XDRPositiveSize2D
    from openpyxl.styles import Font, PatternFill, Alignment
    wb=Workbook(); wb.remove(wb.active); images=page_images(pages); handles=[]
    wb.properties.creator='BK_MPO_ANALYSIS_REPORT'
    for index,image in enumerate(images):
        ws=wb.create_sheet('横向A4报告' if index==0 else f'横向A4_{index+1}')
        stream=io.BytesIO(); image.save(stream,format='PNG'); stream.seek(0); handles.append(stream)
        drawing=Image(stream); drawing.width=297/25.4*96; drawing.height=210/25.4*96; ws.add_image(drawing,'A1')
        ws.column_dimensions['A'].width=(drawing.width-5)/7
        for row in [1,2]: ws.row_dimensions[row].height=210/25.4*72/2
        ws.print_area='A1:A2'; ws.sheet_view.showGridLines=False; ws.page_setup.orientation='landscape'; ws.page_setup.paperSize=ws.PAPERSIZE_A4
        ws.page_setup.fitToWidth=1; ws.page_setup.fitToHeight=1; ws.sheet_properties.pageSetUpPr.fitToPage=True
        ws.page_margins.left=ws.page_margins.right=ws.page_margins.top=ws.page_margins.bottom=0
    native=wb.create_sheet('可编辑图表'); native.sheet_view.showGridLines=False
    stats=wb.create_sheet('统计数据'); stats.append(['图表','分类','数值','单位'])
    for index,chart in enumerate(charts):
        start=stats.max_row+1
        metric_label = {'rate':'不良率','rows':'记录条数','quantity':'不良数量'}[chart['metric']]
        for point in chart['data']: stats.append([chart['title'],point['label'],point['value'],metric_label])
        if not chart['data']: continue
        obj=PieChart() if chart['type']=='pie' else LineChart() if chart['type']=='line' else BarChart()
        if isinstance(obj,BarChart): obj.type='bar' if chart['type']=='bar' else 'col'
        obj.title=chart['title']; obj.add_data(Reference(stats,min_col=3,min_row=start,max_row=stats.max_row),titles_from_data=False)
        obj.set_categories(Reference(stats,min_col=2,min_row=start,max_row=stats.max_row)); obj.dataLabels=DataLabelList(); obj.dataLabels.showVal=True
        if chart['metric']=='rate': obj.dataLabels.numFmt='0.00%'; obj.y_axis.numFmt='0.00%'
        if chart['type']=='pie': obj.dataLabels.showPercent=True
        else: obj.legend=None; obj.y_axis.title=metric_label; obj.x_axis.scaling.min=0
        obj.width=13.5; obj.height=max(7,min(16,len(chart['data'])*.4+2))
        col=index%2; band=index//2
        obj.anchor=AbsoluteAnchor(pos=XDRPoint2D(col*145*36000,band*170*36000),ext=XDRPositiveSize2D(int(obj.width*360000),int(obj.height*360000)))
        native.add_chart(obj)
    sources={s['id']:s for s in config['sources']}
    used=list(dict.fromkeys(c['sourceId'] for c in config['report']['charts']))
    from . import grouping_semantics
    groupings={sid:grouping_semantics.from_db(db,sources[sid]) for sid in used}
    labels={g['label'] for g in groupings.values()}
    grouping_header=next(iter(labels)) if len(labels)==1 else '分类（产品类型／工序）'
    original=[(sid,c['id'],(sources[sid]['name']+' · ' if len(used)>1 else '')+c['label']) for sid in used for c in sources[sid]['columns']]
    detail=wb.create_sheet('筛选明细'); detail.append(['数据源','来源文件','源行','业务日期',grouping_header,'班次','不良项','数量','责任员工','报检人']+[c[2] for c in original])
    notes=wb.create_sheet('口径与筛选'); notes.append(['图表','数据源','日期范围','指标','筛选条件','产量口径'])
    seen=set()
    for index,definition in enumerate(config['report']['charts']):
        source=sources[definition['sourceId']]; query=definition['query']
        if definition.get('defect'): query={**query,'filters':[*query['filters'],{'field':'defect','op':'equals','values':[definition['defect']],'caseSensitive':True}]}
        _,span,_,rows=analysis.core(db,source,query)
        for r in rows:
            key=(source['id'],r['id'])
            if key in seen: continue
            seen.add(key)
            if detail.max_row>=1048576: raise ValueError('筛选明细超过Excel单表行数上限，请缩小报告范围。')
            detail.append([source['name'],r['file'],r['row'],r['date'],r['process'],r['shift'],r['defect'],r['quantity'],r['employee'],r['reporter']]+[r['values'].get(fid) if sid==source['id'] else None for sid,fid,_ in original])
        metric_label = {'rate':'不良率','rows':'记录条数','quantity':'不良件数' if source['unit']=='units' else '不良数量'}[definition['metric']]
        rate_note = ('产品类型分类，无法匹配工序产量' if groupings[source['id']]['kind']=='productType' else '日期＋工序＋班次；分子已确认件数才计算') if definition['metric']=='rate' else '按图表筛选范围汇总'
        notes.append([charts[index]['title'],source['name'],' 至 '.join(span or []),metric_label,json.dumps(query['filters'],ensure_ascii=False),rate_note])
    for ws in [stats,detail,notes]:
        ws.freeze_panes='A2'; ws.auto_filter.ref=ws.dimensions
        for cell in ws[1]: cell.font=Font(color='FFFFFF',bold=True); cell.fill=PatternFill('solid',fgColor='163859'); cell.alignment=Alignment(vertical='center')
        ws.row_dimensions[1].height=24
        for col in ws.columns:
            ws.column_dimensions[col[0].column_letter].width=min(42,max(14,max(len(str(c.value or '')) for c in list(col)[:100])*1.2))
        for row in ws.iter_rows():
            for cell in row:
                if isinstance(cell.value,str): cell.data_type='s'
    stream=io.BytesIO(); wb.save(stream); return stream.getvalue()
def export(db,body):
    if store.revision(db)!=body['snapshot']['revision'] or store.report_signature(body['config'],body.get('calendar'))!=body['snapshot']['signature']: raise ValueError('数据或设置已更新，请重新预览报告后导出。')
    from .service import handle
    snapshot=handle(db,{'action':'reportData','config':body['config'],'calendar':body.get('calendar',{})})
    pages=validate_pages(body['pages']); fmt=body['format']; target=Path(body['output'])
    if fmt=='pdf': content=pdf_bytes(pages,snapshot['title'],json.dumps([{'source':c['sourceName'],'range':c['range'],'query':c['query']} for c in snapshot['charts']],ensure_ascii=False))
    elif fmt=='xlsx':
        rules=body.get('calendar',{}).get('sources',{})
        effective={**body['config'],'sources':[{**s,**({'calendar':rules[s['id']]} if s['id'] in rules else {})} for s in body['config']['sources']]}
        content=xlsx_bytes(pages,snapshot['charts'],db,effective)
    elif fmt=='png':
        images=page_images(pages); stream=io.BytesIO()
        if len(images)==1: images[0].save(stream,format='PNG',dpi=(240,240))
        else:
            with zipfile.ZipFile(stream,'w',zipfile.ZIP_DEFLATED) as archive:
                for i,image in enumerate(images):
                    data=io.BytesIO(); image.save(data,format='PNG',dpi=(240,240)); archive.writestr(f'A4报告_{i+1:02d}.png',data.getvalue())
        content=stream.getvalue()
    else: raise ValueError('导出格式无效。')
    with target.open('xb') as stream: stream.write(content)
    return {'fileName':target.name,'pages':len(pages),'bytes':len(content)}
def backup(db,body):
    root=Path(body['output']).parent
    with tempfile.TemporaryDirectory(prefix='analysis-backup-',dir=root) as temporary:
        file=Path(temporary)/'database.sqlite'; snapshot=sqlite3.connect(file); db.backup(snapshot); snapshot.close()
        entries={'database.sqlite':file.read_bytes(),'sources.json':json.dumps(body['config'],ensure_ascii=False).encode('utf-8')}
        manifest={'format':'BK-MPO-ANALYSIS','version':1,'sha256':{name:hashlib.sha256(data).hexdigest() for name,data in entries.items()}}
        if 'calendar' in body:
            manifest.update(calendar=body['calendar'],calendarSha256=store.digest(body['calendar']))
        with Path(body['output']).open('xb') as stream, zipfile.ZipFile(stream,'w',zipfile.ZIP_DEFLATED) as archive:
            for name,data in entries.items(): archive.writestr(name,data)
            archive.writestr('manifest.json',json.dumps(manifest))
    return {'fileName':Path(body['output']).name,'revision':store.revision(db)}
def read_backup(body):
    with zipfile.ZipFile(body['input']) as archive:
        if len(archive.namelist())!=3 or set(archive.namelist())!={'database.sqlite','sources.json','manifest.json'} or sum(i.file_size for i in archive.infolist())>700*1024*1024: raise ValueError('分析备份结构或大小无效。')
        manifest=json.loads(archive.read('manifest.json'))
        if manifest.get('format')!='BK-MPO-ANALYSIS' or manifest.get('version')!=1: raise ValueError('分析备份版本无效。')
        entries={name:archive.read(name) for name in ['database.sqlite','sources.json']}
        for name,data in entries.items():
            if hashlib.sha256(data).hexdigest()!=manifest['sha256'].get(name): raise ValueError('分析备份校验失败，未恢复。')
        config=json.loads(entries['sources.json'])
        calendar=manifest.get('calendar',{'version':1,'sources':{}})
        if 'calendar' in manifest and store.digest(calendar)!=manifest.get('calendarSha256'): raise ValueError('备份班次规则校验失败，未恢复。')
        for source in config['sources']: source['auto']=False
    return config,entries,calendar
def inspectBackup(db,body):
    config,_,calendar=read_backup(body)
    return {'config':config,'calendar':calendar}
def restore(db,body):
    if db.execute('SELECT count(*) FROM files').fetchone()[0]: raise ValueError('恢复只允许空分析库，请先新建工作区，原资料未改变。')
    config,entries,calendar=read_backup(body)
    if json.loads(body.get('approvedConfig','{}'))!=config: raise ValueError('备份配置未经验证或已改变，未恢复。')
    if calendar.get('sources') and json.loads(body.get('approvedCalendar','{}'))!=calendar: raise ValueError('备份班次规则未经确认，未恢复。')
    db_folder=Path(db.execute('PRAGMA database_list').fetchone()[2]).parent
    with tempfile.TemporaryDirectory(prefix='analysis-restore-',dir=db_folder) as temporary:
        file=Path(temporary)/'database.sqlite'; file.write_bytes(entries['database.sqlite']); donor=sqlite3.connect(file)
        try:
            if donor.execute('PRAGMA integrity_check').fetchone()[0]!='ok' or donor.execute('PRAGMA user_version').fetchone()[0]!=1 or donor.execute("SELECT count(*) FROM sqlite_master WHERE type IN ('trigger','view')").fetchone()[0]: raise ValueError('分析备份数据库未通过完整性校验。')
            required={'meta','sources','files','records'}
            tables = {r[0] for r in donor.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            history = {'import_batches', 'import_record_baseline', 'import_record_covers'}
            if tables not in (required, required | history):
                raise ValueError('分析备份数据库结构无效。')
            donor.backup(db)
        finally: donor.close()
    with db:
        store.ensure_import_history_schema(db)
    store.clear_rows_cache()
    return {'config':config,'calendar':calendar,'revision':store.revision(db)}
