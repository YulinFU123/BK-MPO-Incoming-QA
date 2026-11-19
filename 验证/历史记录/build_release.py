"""Verify and package the current version. Does not delete historical releases."""
from pathlib import Path
import hashlib
import json
import os
import re
import shutil
import zipfile

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / '源码'
OUTPUT = ROOT / '成果'
version = json.loads((SOURCE / 'package.json').read_text(encoding='utf-8-sig'))['version']
assert re.fullmatch(r'\d+\.\d+\.\d+', version), 'Invalid version'
short_version = '.'.join(version.split('.')[:2])
build = ROOT / '构建' / f'异常记录台_{version}_Windows_x64'
log_path = ROOT / '验证' / f'{version}桌面自检.log'
log_bytes = log_path.read_bytes()
log = log_bytes.decode('utf-16' if log_bytes.startswith(b'\xff\xfe') else 'utf-8-sig')
assert 'PASS no final renderer errors' in log and 'AssertionError' not in log, 'Desktop QA required'

def sha256(path):
    hasher = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            hasher.update(chunk)
    return hasher.hexdigest()

sources = {p.relative_to(SOURCE).as_posix(): sha256(p) for p in SOURCE.rglob('*') if p.is_file()}
for name, digest in sources.items():
    assert sha256(build / 'resources' / 'app' / name) == digest, f'Stale build source: {name}'
for sheet in ['app.css', 'foundation.css', 'controls.css', 'workspace.css']:
    assert sheet in sources, f'Missing stylesheet: {sheet}'
shutil.copy2(OUTPUT / f'异常记录台_{version}_使用说明.md', build / '使用说明.md')
shutil.copy2(OUTPUT / f'异常记录台_{version}_核验报告.md', build / '整合核对报告.md')
(build / '源码校验.json').write_text(json.dumps(sources, ensure_ascii=False, indent=2), encoding='utf-8')
archive = OUTPUT / f'异常记录台_{version}_最新版.zip'
pending = archive.with_suffix('.zip.partial')
with zipfile.ZipFile(pending, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as package:
    for file in sorted(build.rglob('*')):
        if file.is_file():
            assert file.name != 'vault.json', 'User data must not be packaged'
            package.write(file, (Path(build.name) / file.relative_to(build)).as_posix())
with zipfile.ZipFile(pending) as package:
    assert package.testzip() is None, 'ZIP CRC failed'
    for name, digest in sources.items():
        assert hashlib.sha256(package.read(f'{build.name}/resources/app/{name}')).hexdigest() == digest
os.replace(pending, archive)
(OUTPUT / f'异常记录台_{version}_SHA256.txt').write_text(f'{sha256(archive)}  {archive.name}\n', encoding='utf-8')
shutil.copytree(build, OUTPUT / build.name, dirs_exist_ok=True)
print(f'Verified {version}: {archive.stat().st_size} bytes; {len(sources)} source files')
