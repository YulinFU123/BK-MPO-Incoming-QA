"""Build a fresh offline Windows directory using explicitly supplied runtimes.

No downloads, installer, pip, elevation, active-version replacement or deletion.
"""
import argparse
import json
from pathlib import Path
import shutil
import subprocess


def build(source_root, electron, python_source, target, node='node', report_runtime=None):
    source_root, electron, python_source = [Path(p).resolve(strict=True) for p in (source_root, electron, python_source)]
    target = Path(target).resolve()
    if target.exists():
        raise ValueError('输出目录已存在；请选择新的构建目录，禁止覆盖在用版本。')
    if source_root == target or source_root in target.parents or target in source_root.parents:
        raise ValueError('输出不能覆盖源码或位于源码内。')
    platform = source_root / 'platform'
    version = json.loads((platform / 'package.json').read_text(encoding='utf-8'))['version']
    executable = next((electron / name for name in ('异常分析平台.exe','异常记录台.exe','electron.exe') if (electron / name).exists()), electron / 'electron.exe')
    if not executable.exists():
        raise ValueError('Electron目录缺少已验证的主程序。')
    target.mkdir(parents=True)
    for item in electron.iterdir():
        if item.is_file() and (item.suffix.lower() in ('.exe', '.dll', '.pak', '.dat', '.bin') or item.name in ('LICENSE', 'LICENSES.chromium.html', 'version', 'vk_swiftshader_icd.json')):
            shutil.copy2(item, target / ('异常分析平台.exe' if item == executable else item.name))
    shutil.copytree(electron / 'locales', target / 'locales')
    resources = target / 'resources'
    resources.mkdir()
    shutil.copy2(electron / 'resources' / 'default_app.asar', resources / 'default_app.asar')
    app = resources / 'app'
    app.mkdir()
    ignore = shutil.ignore_patterns('__pycache__', '*.pyc')
    shutil.copytree(platform, app / 'platform', ignore=ignore)
    retired = ('bi_export_original.js', 'bi_runner_template.js', 'bi-filter-model.js',
               'bi-filter-script.js', 'bi-filter-ui.js')
    shutil.copytree(source_root / 'bi', app / 'bi',
                    ignore=shutil.ignore_patterns('__pycache__', '*.pyc', *retired))
    shutil.copy2(platform / 'desktop' / 'bi-receipt-section.js', app / 'bi/ui/bi_bridge.js')
    subprocess.run([node, str(platform / 'scripts' / 'prepare-legacy.js'), str(source_root), str(app / 'legacy')], check=True)
    subprocess.run([node, str(platform / 'scripts' / 'prepare-bi.js'), str(app / 'bi'), str(app / 'bi-ui')], check=True)
    runtime = app / 'python'
    runtime.mkdir()
    for item in python_source.iterdir():
        if item.is_file() and (item.suffix.lower() in ('.exe', '.dll') or item.name.lower().startswith('license')):
            shutil.copy2(item, runtime / item.name)
    ignore_packages = shutil.ignore_patterns('__pycache__', '*.pyc', 'tests', 'test')
    shutil.copytree(python_source / 'DLLs', runtime / 'DLLs', ignore=ignore_packages)
    shutil.copytree(python_source / 'Lib', runtime / 'Lib', ignore=shutil.ignore_patterns('site-packages', '__pycache__', '*.pyc', 'test', 'tests', 'idlelib', 'ensurepip', 'venv'))
    packages = runtime / 'Lib' / 'site-packages'
    packages.mkdir()
    prefixes = ('pandas', 'numpy', 'openpyxl', 'python_dateutil', 'six', 'et_xmlfile', 'tzdata')
    for item in (python_source / 'Lib' / 'site-packages').iterdir():
        if item.name == 'dateutil' or item.name.startswith(prefixes):
            if item.is_dir():
                shutil.copytree(item, packages / item.name, ignore=ignore_packages)
            else:
                shutil.copy2(item, packages / item.name)
    report_source=Path(report_runtime).resolve(strict=True) if report_runtime else python_source
    report_packages=report_source/'Lib'/'site-packages'
    for item in report_packages.iterdir():
        if item.name=='PIL' or any(item.name==prefix or item.name.startswith(prefix+'-') or item.name==prefix+'.libs' for prefix in ('reportlab','pillow','charset_normalizer','pypdf')):
            if item.is_dir(): shutil.copytree(item,packages/item.name,ignore=ignore_packages)
            else: shutil.copy2(item,packages/item.name)
    probe = "import sys,json,pandas,numpy,openpyxl,dateutil,reportlab,PIL,pypdf;print(json.dumps({'python':sys.version.split()[0],'pandas':pandas.__version__,'numpy':numpy.__version__,'openpyxl':openpyxl.__version__,'dateutil':dateutil.__version__,'reportlab':reportlab.Version,'pillow':PIL.__version__,'pypdf_test':pypdf.__version__}))"
    info = subprocess.run([str(runtime / 'python.exe'), '-I', '-B', '-c', probe], check=True, capture_output=True, text=True)
    (runtime / 'runtime-versions.json').write_text(info.stdout, encoding='utf-8')
    (app / 'package.json').write_text(json.dumps({'name': 'exception-analysis-platform-preview', 'productName': 'BK_MPO 智能异常管理工作台', 'version': version, 'main': 'bootstrap.js', 'private': True}, ensure_ascii=False, indent=2), encoding='utf-8')
    (app / 'bootstrap.js').write_text("'use strict';\nrequire('./platform/desktop/app/main');\n", encoding='utf-8')
    return {'version': version, 'program': str(target / '异常分析平台.exe'), 'offline': True}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root', required=True)
    parser.add_argument('--electron-runtime', required=True)
    parser.add_argument('--python-runtime', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--node', default='node')
    parser.add_argument('--report-runtime', help='Same Python ABI local runtime containing reportlab and Pillow; no downloads')
    args = parser.parse_args()
    print(json.dumps(build(args.source_root, args.electron_runtime, args.python_runtime, args.output, args.node,args.report_runtime), ensure_ascii=True))
