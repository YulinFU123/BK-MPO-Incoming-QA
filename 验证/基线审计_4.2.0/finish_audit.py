from pathlib import Path
import csv
import hashlib
import json
import shutil
import zipfile

ROOT = Path(r'D:\项目\BK_MPO来料异常跟进')
AUDIT = ROOT / '验证' / '基线审计_4.2.0'
OUT = ROOT / '成果' / '4.2.0_基线审计'
EVIDENCE = OUT / '证据'
BASELINE = ROOT / '成果' / '异常记录台_4.2.0_最新版.zip'
EXPECTED = '76424238d746a201911f824992801bcb8b097f463c0fe47e259b528e5e2f1ec2'

def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()

rows = list(csv.DictReader((AUDIT / 'baseline-files.csv').open(encoding='utf-8-sig', newline='')))
actual = digest(BASELINE)
assert actual == EXPECTED, 'Original ZIP changed'
mismatches = []
for row in rows:
    path = AUDIT / '运行副本' / row['path']
    if not path.is_file() or digest(path) != row['sha256']:
        mismatches.append(row['path'])
assert len(rows) == 100 and not mismatches, mismatches
ui = json.loads((AUDIT / '测试' / 'ui-audit.json').read_text(encoding='utf-8-sig'))
log = (AUDIT / '功能回归.log').read_text(encoding='utf-8-sig')
passed = sum(line.startswith('PASS ') for line in log.splitlines())
assert passed == 92, passed
assert sum(case['status'] == 'FAIL' for case in ui['cases']) == 3

EVIDENCE.mkdir(exist_ok=True)
verification = {
    'report_date': '2026-10-26', 'original_zip_sha256': actual,
    'original_zip_unchanged': True, 'extracted_baseline_files_checked': len(rows),
    'extracted_baseline_mismatches': mismatches, 'existing_regression_pass': passed,
    'supplemental_pass': 3, 'supplemental_fail': 3,
    'scope': 'audit documents only; no application source edits or new release'
}
(EVIDENCE / 'final-verification.json').write_text(json.dumps(verification, ensure_ascii=False, indent=2), encoding='utf-8')
shutil.copy2(AUDIT / 'baseline-files.csv', OUT / 'baseline-files.csv')
for name in ['baseline.json', 'harness-provenance.json', '功能回归.log', '加密测试.log', '规则测试.log', '界面专项.log']:
    shutil.copy2(AUDIT / name, EVIDENCE / name)
for name in ['ui-audit.json', 'qa_desktop.js', 'audit_ui.js', 'test_vault.js', 'test_integration_rules.js', 'import-fixture.xlsx']:
    shutil.copy2(AUDIT / '测试' / name, EVIDENCE / name)
for path in sorted((AUDIT / '测试').glob('audit-*.png')):
    shutil.copy2(path, EVIDENCE / path.name)
(EVIDENCE / 'README.md').write_text('''# 证据复核说明

结果来自独立 QA EXE 与合成数据。测试脚本保留本机路径，跨电脑运行前须改为该电脑的独立解压副本和测试数据目录，不得指向正式 vault。

本机复核：在原审计的测试目录中使用 Node 运行 qa_desktop.js、audit_ui.js、test_vault.js、test_integration_rules.js；完整应用来自原 4.2.0 ZIP。不要同时启动多个使用相同调试端口或 QA 目录的实例。

本证据目录不包含应用 EXE 或用户数据；不是独立软件发布包。ui-audit.json 是最终有效样本，未收录的初次无效尝试在报告中已披露。
''', encoding='utf-8')
manifest = OUT / '审计交付文件SHA256.csv'
with manifest.open('w', encoding='utf-8-sig', newline='') as stream:
    writer = csv.writer(stream)
    writer.writerow(['path', 'bytes', 'sha256'])
    for path in sorted(OUT.rglob('*')):
        if path.is_file() and path != manifest:
            writer.writerow([path.relative_to(OUT).as_posix(), path.stat().st_size, digest(path)])
package = ROOT / '成果' / '异常记录台_4.2.0_基线审计与改造计划.zip'
assert not package.exists(), 'Audit package already exists; preserve it rather than overwrite'
with zipfile.ZipFile(package, 'x', zipfile.ZIP_DEFLATED) as archive:
    for path in sorted(OUT.rglob('*')):
        if path.is_file():
            archive.write(path, '4.2.0_基线审计/' + path.relative_to(OUT).as_posix())
with zipfile.ZipFile(package) as archive:
    assert archive.testzip() is None
checksum = digest(package)
package.with_suffix('.sha256.txt').write_text(checksum + '  ' + package.name + '\n', encoding='utf-8')
index = Path(r'D:\项目\全部成果\异常记录台成果清单.txt')
existing = index.read_text(encoding='utf-8-sig')
entry = '\n基线审计（2026-10-26，非新版程序）：成果\\4.2.0_基线审计\\00_审计结论.md\n审计与改造计划包：成果\\异常记录台_4.2.0_基线审计与改造计划.zip\n'
if '基线审计（2026-10-26' not in existing:
    with index.open('a', encoding='utf-8') as stream:
        stream.write(entry)
print(json.dumps({'verification': verification, 'audit_package': str(package), 'bytes': package.stat().st_size, 'sha256': checksum}, ensure_ascii=True, indent=2))
