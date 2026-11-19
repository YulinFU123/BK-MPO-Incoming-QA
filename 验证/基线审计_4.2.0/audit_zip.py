from pathlib import Path, PurePosixPath
import collections, csv, hashlib, json, zipfile

audit = Path(__file__).resolve().parent
project = audit.parent.parent
archive = project/'成果'/'异常记录台_4.2.0_最新版.zip'
runtime = audit/'运行副本'
runtime.mkdir(exist_ok=False)

def file_sha(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()

before = file_sha(archive)
entries=[]
with zipfile.ZipFile(archive,'r') as z:
    bad = z.testzip()
    assert bad is None,bad
    for item in z.infolist():
        path=PurePosixPath(item.filename)
        assert not path.is_absolute() and '..' not in path.parts and ':' not in item.filename,item.filename
        if item.is_dir():continue
        h=hashlib.sha256()
        with z.open(item) as f:
            for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
        entries.append({'path':item.filename,'bytes':item.file_size,'compressed_bytes':item.compress_size,'crc32':f'{item.CRC:08x}','sha256':h.hexdigest()})
    z.extractall(runtime)
    prefix='异常记录台_4.2.0_Windows_x64'
    source_map=json.loads(z.read(prefix+'/源码校验.json'))
    mismatches=[]
    for name,sha in source_map.items():
        if hashlib.sha256(z.read(prefix+'/resources/app/'+name.replace('\\','/'))).hexdigest()!=sha:mismatches.append(name)
    package=json.loads(z.read(prefix+'/resources/app/package.json'))
    binary_version=z.read(prefix+'/version').decode().strip()
after=file_sha(archive)
assert before==after
by_hash=collections.defaultdict(list)
for entry in entries:by_hash[entry['sha256']].append(entry['path'])
summary={'zip':str(archive),'bytes':archive.stat().st_size,'sha256_before':before,'sha256_after':after,'crc':'PASS','file_count':len(entries),'uncompressed_bytes':sum(e['bytes'] for e in entries),'source_manifest_files':len(source_map),'source_manifest_mismatches':mismatches,'package':package,'runtime_version_file':binary_version,'same_content_groups':[v for v in by_hash.values() if len(v)>1],'sensitive_name_candidates':[e['path'] for e in entries if any(term in e['path'].lower() for term in ['vault.json','.sqlite','.db','.env','backup','test','log'])]}
(audit/'baseline.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
with (audit/'baseline-files.csv').open('w',encoding='utf-8-sig',newline='') as f:
    writer=csv.DictWriter(f,fieldnames=entries[0].keys());writer.writeheader();writer.writerows(entries)
(audit/'原始ZIP-SHA256.txt').write_text(before+'  '+archive.name+'\n',encoding='utf-8')
print(json.dumps(summary,ensure_ascii=False))
