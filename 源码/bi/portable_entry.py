"""Windows EXE entry: no installation, pip, auto-update or external network access."""
import os
import sys
import tempfile
import traceback
from pathlib import Path

from app_paths import DATA_DIR, RESOURCE_DIR


def notify(message):
    if os.name == 'nt':
        import ctypes
        ctypes.windll.user32.MessageBoxW(None, message, '质量工作台', 0x10)
    elif sys.stderr:
        print(message, file=sys.stderr)


def main():
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryFile(dir=DATA_DIR):
            pass
    except OSError:
        notify('无法写入用户数据目录。请把整个程序文件夹放到自己有写权限的位置再运行。')
        return 1
    log = open(DATA_DIR / '启动日志.txt', 'a', encoding='utf-8', buffering=1)
    sys.stdout = sys.stderr = log
    lock = None
    try:
        if '--self-test' in sys.argv:
            import runpy
            for filename in ('selftest_daily.py', 'selftest_integrity.py'):
                runpy.run_path(str(RESOURCE_DIR / filename), run_name='__main__')
            return 0
        if os.name == 'nt':
            import msvcrt
            lock = open(DATA_DIR / 'app.lock', 'a+b')
            if lock.tell() == 0:
                lock.write(b'0')
                lock.flush()
            lock.seek(0)
            try:
                msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError:
                notify('这份工作台已在运行，请切换到已有窗口。')
                return 1
        import panel
        panel.main()
        return 0
    except SystemExit as exc:
        return int(exc.code or 0)
    except Exception:
        traceback.print_exc()
        notify('启动失败。详情已保存到“用户数据/启动日志.txt”。请保留日志，勿删除历史数据。')
        return 1
    finally:
        if lock:
            lock.close()
        log.flush()


if __name__ == '__main__':
    raise SystemExit(main())
