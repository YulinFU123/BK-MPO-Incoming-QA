import sys, pathlib, subprocess, ctypes
base=pathlib.Path(__file__).resolve().parent
p=subprocess.run([sys.executable,"-m","py_compile",str(base/"panel.py")],capture_output=True)
check=subprocess.run([sys.executable,str(base/"setup_deps.py"),"--check"],capture_output=True)
if p.returncode or check.returncode:
    ctypes.windll.user32.MessageBoxW(None,"请先双击 不良分析面板.bat 完成环境安装或查看错误。", "启动提示", 48)
    sys.exit(1)
exe=pathlib.Path(sys.executable).with_name("pythonw.exe")
subprocess.Popen([str(exe if exe.exists() else pathlib.Path(sys.executable)),str(base/"panel.py")],cwd=base,creationflags=0x08000000)
