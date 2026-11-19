"""Package only the verified application and public source, never QA vaults."""
import hashlib, json, os, shutil, zipfile
from pathlib import Path

root=Path(__file__).resolve().parent.parent
build=root/'构建'/'异常记录台_4.0.0_Windows_x64'
out=root/'成果'
log=(root/'验证'/'4.0桌面自检.log').read_text(encoding='utf-16' if (root/'验证'/'4.0桌面自检.log').read_bytes().startswith(b'\xff\xfe') else 'utf-8-sig')
assert 'PASS no final renderer errors' in log and 'AssertionError' not in log
shutil.copy2(out/'异常记录台_4.0.0_使用说明.md',build/'使用说明.md')
shutil.copy2(out/'异常记录台_4.0.0_重构核验报告.md',build/'整合核对报告.md')
digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
sources={str(p.relative_to(root/'源码')):digest(p) for p in (root/'源码').rglob('*') if p.is_file()}
for name,sha in sources.items(): assert digest(build/'resources'/'app'/name)==sha,name
(build/'源码校验.json').write_text(json.dumps(sources,ensure_ascii=False,indent=2),encoding='utf-8')
archive=out/'异常记录台_4.0.0_重构最新版.zip'
partial=archive.with_suffix('.zip.partial')
with zipfile.ZipFile(partial,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
    for p in sorted(build.rglob('*')):
        if p.is_file():
            assert p.name!='vault.json'
            z.write(p,str(Path(build.name)/p.relative_to(build)))
with zipfile.ZipFile(partial) as z:
    assert z.testzip() is None
    for name,sha in sources.items(): assert hashlib.sha256(z.read(build.name+'/resources/app/'+name.replace('\\','/'))).hexdigest()==sha
os.replace(partial,archive)
(out/'异常记录台_4.0.0_SHA256.txt').write_text(digest(archive)+'  '+archive.name+'\n',encoding='utf-8')
latest='最新版：成果\\异常记录台_4.0.0_重构最新版.zip\n上一版：成果\\异常记录台_3.0.0_整合最新版.zip\n使用说明：成果\\异常记录台_4.0.0_使用说明.md\n重构核验：成果\\异常记录台_4.0.0_重构核验报告.md\n源码：源码（发行包 resources/app 也包含完整源码）\n'
(root/'最新版本.txt').write_text(latest,encoding='utf-8-sig')
overview=Path('D:/项目/全部成果')
(overview/'异常记录台成果清单.txt').write_text('项目：'+str(root)+'\n'+latest,encoding='utf-8-sig')
print('VERIFIED',archive,archive.stat().st_size,digest(archive))
