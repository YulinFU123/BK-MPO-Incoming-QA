# -*- coding: utf-8 -*-
"""Pure offline, application-local dependency installation. No administrator required."""
import sys, os, json, platform, struct, sysconfig, subprocess, pathlib, tempfile, shutil, hashlib
BASE = pathlib.Path(__file__).resolve().parent
LIBS = BASE / "libs"

def probe(path=LIBS):
    code = "import sys; sys.path.insert(0, sys.argv[1]); import pandas,numpy,openpyxl,tzdata; print('pandas',pandas.__version__,'numpy',numpy.__version__,'openpyxl',openpyxl.__version__,'tzdata',tzdata.__version__)"
    return subprocess.run([sys.executable, "-c", code, str(path)], capture_output=True, text=True, encoding="utf-8", errors="replace")

def supported():
    return (sys.implementation.name == "cpython" and sys.version_info[:2] == (3,15)
            and sys.platform == "win32" and struct.calcsize("P") == 8
            and sysconfig.get_platform() == "win-amd64" and not sysconfig.get_config_var("Py_GIL_DISABLED"))

def diagnose():
    p = probe()
    report = dict(executable=sys.executable, version=sys.version, platform=sysconfig.get_platform(),
                  machine=platform.machine(), bits=struct.calcsize("P")*8,
                  free_threaded=bool(sysconfig.get_config_var("Py_GIL_DISABLED")),
                  bundled_wheels_compatible=supported(), dependency_check=p.returncode,
                  output=p.stdout, error=p.stderr)
    text=json.dumps(report,ensure_ascii=False,indent=2)
    (BASE/"environment_report.txt").write_text(text,encoding="utf-8")
    print(text)
    return 0

def main():
    if "--diagnose" in sys.argv:
        return diagnose()
    p=probe()
    if "--check" in sys.argv:
        if p.returncode: print(p.stderr)
        return int(p.returncode != 0)
    if p.returncode == 0:
        print("依赖已就绪：",p.stdout)
        return 0
    print("当前解释器：",sys.executable,sys.version)
    if not supported():
        print("随附离线包仅适配 Windows x64 / 常规 CPython 3.15。请运行 环境诊断.bat，勿重命名 wheel 或强制安装。")
        return 2
    wheel_dir=BASE/"wheels"/"cp315"
    for item in json.loads((BASE/"manifest.json").read_text(encoding="utf-8")):
        f=wheel_dir/item["file"]
        if not f.exists() or hashlib.sha256(f.read_bytes()).hexdigest()!=item["sha256"]:
            print("离线包缺失或损坏：",f.name)
            return 2
    # --isolated ignores user pip configuration; --no-index prevents index access.
    pipcheck=subprocess.run([sys.executable,"-m","pip","--version"],capture_output=True)
    if pipcheck.returncode:
        print("当前 Python 没有 pip。若为官方完整安装版，可运行 python -m ensurepip --user；嵌入式版请更换经公司批准的完整解释器。")
        return 2
    stage=pathlib.Path(tempfile.mkdtemp(prefix="libs_stage_",dir=BASE))
    backup=BASE/"libs_previous"
    try:
        cmd=[sys.executable,"-m","pip","--isolated","--disable-pip-version-check","--no-input",
             "install","--no-index","--only-binary=:all:","--find-links",str(wheel_dir),
             "--target",str(stage),"-r",str(BASE/"requirements-py315.txt")]
        result=subprocess.run(cmd,capture_output=True,text=True,encoding="utf-8",errors="replace")
        (BASE/"install.log").write_text(result.stdout+result.stderr,encoding="utf-8")
        print(result.stdout,result.stderr)
        if result.returncode: return 2
        check=probe(stage)
        with (BASE/"install.log").open("a",encoding="utf-8") as f: f.write(check.stdout+check.stderr)
        if check.returncode:
            print("新依赖导入失败，原 libs 未替换。详见 install.log")
            return 2
        if backup.exists(): shutil.rmtree(backup)
        if LIBS.exists(): LIBS.rename(backup)
        try: stage.rename(LIBS)
        except Exception:
            if backup.exists(): backup.rename(LIBS)
            raise
        print("离线安装完成：",check.stdout)
        print("旧依赖保留在 libs_previous；本程序未修改系统 Python。")
        return 0
    finally:
        if stage.exists(): shutil.rmtree(stage,ignore_errors=True)

if __name__ == "__main__":
    try: sys.exit(main())
    except Exception as exc:
        print(type(exc).__name__+": "+str(exc))
        sys.exit(2)
