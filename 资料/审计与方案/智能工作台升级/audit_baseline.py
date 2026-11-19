"""Read-only project audit. Writes evidence only to this audit directory."""
from pathlib import Path
import hashlib
import json
import os
import subprocess
import zipfile

ROOT = Path(r'D:\项目\BK_MPO来料异常跟进')
OUT = Path(__file__).parent
def sha(p):
    return hashlib.file_digest(p.open('rb'), 'sha256').hexdigest()
def inventory(root):
    return [{'path': str(p.relative_to(root)).replace('\\', '/'), 'bytes': p.stat().st_size,
             'sha256': sha(p)} for p in sorted(root.rglob('*')) if p.is_file() and '__pycache__' not in p.parts]
index = json.loads((ROOT/'成果/版本索引.json').read_text(encoding='utf-8'))
packages = []
for label, entry in [('original',index['baseline']),('currentDesktop',index['current']),
                     ('platform',index['development']),('bi',index['biBaseline'])]:
    p = ROOT/entry['package']
    digest = sha(p)
    assert digest == entry['sha256'], f'{label}: package fingerprint changed'
    with zipfile.ZipFile(p) as z:
        assert z.testzip() is None
        names=z.namelist()
        assert all(not n.startswith(('/', '\\')) and '..' not in Path(n).parts for n in names)
        packages.append({'kind':label,'version':entry['version'],'path':str(p),'sha256':digest,
                         'crc':'passed','files':sum(not n.endswith('/') for n in names)})
files = inventory(ROOT/'源码')
platform = [x for x in files if x['path'].startswith('platform/')]
with zipfile.ZipFile(ROOT/index['development']['package']) as z:
    for f in platform:
        b=z.read('源码/'+f['path'])
        assert hashlib.sha256(b).hexdigest()==f['sha256'], f['path']
legacy=[x for x in files if '/' not in x['path']]
bi=[x for x in files if x['path'].startswith('bi/')]
metadata=[]
for p in [Path(os.environ['APPDATA'])/'QualityDeskOffline/vault.json',
          Path(os.environ['APPDATA'])/'ExceptionAnalysisPlatformPreview']:
    metadata.append({'path':str(p),'exists':p.exists(),'isDirectory':p.is_dir(),
                     'size':p.stat().st_size if p.is_file() else None,'contentsRead':False})
program=ROOT/index['development']['program']
probe="const s=require('node:sqlite');const d=new s.DatabaseSync(':memory:');console.log(JSON.stringify({versions:process.versions,sqlite:d.prepare('select sqlite_version() as v').get().v}));d.close()"
env=dict(os.environ,ELECTRON_RUN_AS_NODE='1')
r=subprocess.run([str(program),'-e',probe],env=env,capture_output=True,text=True,encoding='utf-8',timeout=30)
assert r.returncode==0, r.stderr
runtime=json.loads(r.stdout.strip().splitlines()[-1])
result={'auditVersion':1,'date':'2026-10-29','baseline':'0.8.0-dev.1',
        'originalCompatibilityBaseline':'4.2.0','packages':packages,
        'sourceCounts':{'legacy':len(legacy),'bi':len(bi),'platform':len(platform)},
        'publishedSourceMatches':True,'runtime':runtime,'businessMetadata':metadata,
        'formalDataOpened':False,'knownIssue':'QA-WINDOWS-SAVE-001 remains open',
        'newSource':'源码/workbench (independent upgrade branch)',
        'preservedSource':'源码/platform (published 0.8 baseline, read-only in this iteration)'}
for name,value in [('基线审计.json',result),('原源码SHA256.json',files)]:
    (OUT/name).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(result,ensure_ascii=True))
