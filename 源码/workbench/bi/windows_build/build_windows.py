"""Build on a Windows x64 CPython 3.12 machine, then copy the whole output folder.

--prepare: explicitly download pinned Windows wheels on an internet-connected PC.
Default: install only from that wheel cache and build without accessing package indexes.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import shutil
import struct
import subprocess
import sys
import venv
from pathlib import Path

HERE = Path(__file__).resolve().parent
APP = HERE.parent
CACHE = HERE / 'wheelhouse_win312'
ENV = HERE / '.build_env'
DIST = HERE / 'dist'


def run(arguments, **kwargs):
    subprocess.run([str(value) for value in arguments], check=True, **kwargs)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prepare', action='store_true', help='仅下载构建依赖（需外网Windows电脑）')
    options = parser.parse_args()
    if os.name != 'nt' or struct.calcsize('P') != 8 or platform.machine().lower() not in ('amd64', 'x86_64'):
        raise RuntimeError('必须在Windows x64上构建，不能把Linux二进制当作Windows EXE。')
    if sys.version_info[:2] != (3, 12):
        raise RuntimeError('请用标准Windows x64 CPython 3.12运行本脚本。')
    requirements = HERE / 'requirements-win312.txt'
    if options.prepare:
        CACHE.mkdir(exist_ok=True)
        run([sys.executable, '-m', 'pip', 'download', '--only-binary=:all:',
             '--dest', CACHE, '-r', requirements])
        hashes = {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in CACHE.glob('*.whl')}
        (HERE / 'wheelhouse-sha256.json').write_text(json.dumps(hashes, indent=2), encoding='utf-8')
        print('依赖下载完成。可离线运行“一键构建EXE.bat”。')
        return
    if (APP / 'libs').exists():
        raise RuntimeError('请在新解压的干净源码目录构建，不要混入旧版libs依赖。')
    manifest = HERE / 'wheelhouse-sha256.json'
    if not manifest.exists():
        raise RuntimeError('缺少Windows构建依赖。先在外网Windows电脑运行“准备构建依赖.bat”。')
    for filename, digest in json.loads(manifest.read_text(encoding='utf-8')).items():
        path = CACHE / filename
        if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            raise RuntimeError('依赖文件缺失或校验失败：' + filename)
    if not (ENV / 'Scripts' / 'python.exe').exists():
        venv.EnvBuilder(with_pip=True).create(ENV)
    python = ENV / 'Scripts' / 'python.exe'
    run([python, '-m', 'pip', 'install', '--no-index', '--find-links', CACHE, '-r', requirements])
    run([python, APP / 'selftest_daily.py'], cwd=APP)
    run([python, APP / 'selftest_integrity.py'], cwd=APP)
    run([python, '-m', 'PyInstaller', '--clean', '--noconfirm', '--distpath', DIST,
         '--workpath', HERE / 'build', HERE / 'QualityWorkbench.spec'], cwd=APP)
    output = DIST / '质量工作台'
    for name in ('V10.2_使用与升级说明.txt', 'V10.2_自检与改进记录.md'):
        if (APP / name).exists():
            shutil.copy2(APP / name, output / name)
    (output / '便携版说明.txt').write_text(
        '整个文件夹一起复制到公司电脑。双击质量工作台.exe；不必安装Python、不运行pip。\n'
        '用户数据保存于exe旁的用户数据目录，升级时完整保留。不能只复制exe。\n'
        '需要公司允许程序运行，且具备Edge或Chrome；当前不包含浏览器。\n'
        '本包无代码签名；组织策略阻止时需使用公司批准方式。\n', encoding='utf-8')
    freeze = subprocess.check_output([str(python), '-m', 'pip', 'freeze'], text=True)
    (output / '构建依赖版本.txt').write_text(freeze, encoding='utf-8')
    # The built EXE must complete its own synthetic tests before we label output usable.
    result = subprocess.run([str(output / '质量工作台.exe'), '--self-test'], timeout=120)
    if result.returncode:
        raise RuntimeError('EXE内置自检失败，请查看dist/质量工作台/用户数据/启动日志.txt。')
    (output / '用户数据' / '启动日志.txt').unlink(missing_ok=True)
    archive = shutil.make_archive(str(HERE / '质量工作台_Windows_x64_便携版'), 'zip', DIST, '质量工作台')
    print('构建及EXE内部自检通过：' + archive)
    print('发布前仍须在断网Windows电脑验证打开窗口、文件选择、中文路径和PNG导出。')


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print('构建未完成：' + str(exc), file=sys.stderr)
        raise SystemExit(1)
