"""Describe the saved grouping field without rewriting records or mappings."""
import re

def norm(value):
    return re.sub(r'[\s_()-]+', '', str(value or '').casefold())

def describe(source, values):
    identity=source.get('mapping',{}).get('process','')
    column=next((c for c in source.get('columns',[]) if c['id']==identity),None)
    label=column['label'] if column else ''
    explicit=norm(label) in {'producttype','productfamily','productline','产品类型','产品系列','产品类别'}
    family=False
    if not explicit and norm(label) in {'processtypeincharge','reportprocesstype'}:
        for value in values:
            text=str(value or '').strip().upper()
            if not text:continue
            if not re.fullmatch(r'(?:MPO|MMC|LCD)\d*',text):
                family=False;break
            family=True
    product=explicit or family
    return {'kind':'productType' if product else 'process','label':'产品类型' if product else '工序',
            'columnId':identity,'sourceColumn':label}

def from_rows(source, rows):
    return describe(source,(r.get('process','') for r in rows))

def from_db(db,source):
    identity=source.get('mapping',{}).get('process','')
    column=next((c for c in source.get('columns',[]) if c['id']==identity),None)
    label=norm(column['label']) if column else ''
    if label not in {'processtypeincharge','reportprocesstype'}:
        return describe(source,[])
    values=db.execute("SELECT DISTINCT json_extract(r.canonical_json,'$.process') FROM records r JOIN files f ON r.file_id=f.id WHERE r.source_id=? AND r.active=1 AND f.active=1",(source['id'],))
    return describe(source,(r[0] for r in values))
