# -*- coding: utf-8 -*-
"""
BK 5F 品质驾驶舱 · 配置面板
双击【不良分析面板.bat】→ 弹出独立窗口（Edge/Chrome 应用模式，无地址栏）
全部配置在面板里点选完成，点【生成报表】直接出 Excel。
依赖：pandas、openpyxl（Windows 自带 Edge，无需额外安装界面库）
"""
import os, sys, json, time, threading, subprocess, socket, traceback, datetime as dt, re, shutil, mimetypes
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

from app_paths import DATA_DIR, RESOURCE_DIR
BASE = str(DATA_DIR)
os.makedirs(BASE, exist_ok=True)
sys.path.insert(0, BASE)
_LIBS = os.path.join(BASE, "libs")                    # 免管理员安装的依赖目录
if os.path.isdir(_LIBS):
    sys.path.insert(0, _LIBS)
if sys.stdout is None or sys.stderr is None:          # pythonw 静默启动：日志写文件
    _lf = open(os.path.join(BASE, "panel.log"), "a", encoding="utf-8")
    sys.stdout = sys.stdout or _lf
    sys.stderr = sys.stderr or _lf
import engine  # noqa: E402
import analytics
import daily
import bi_bridge
DATA_LOCK = threading.RLock()

UI = str(RESOURCE_DIR / "ui")
S = dict(running=False, log=[], done=False, error=None, result=None, last_ping=time.time(), pinged=False, bye=0.0, started=0.0)
LOCK = threading.Lock()
PORT = 8765


def logline(msg):
    with LOCK:
        S["log"].append(f"{dt.datetime.now():%H:%M:%S}  {msg}")


# ======================== 旧 Excel 控制台导入 ========================
def legacy_import(path):
    import openpyxl
    wb = openpyxl.load_workbook(path, data_only=True)
    raw = engine.default_config()

    def rows(name, start=2):
        if name not in wb.sheetnames:
            return []
        ws = wb[name]
        hs = [engine.sval(c.value) for c in ws[1]]
        out = []
        for r in ws.iter_rows(min_row=start, values_only=True):
            if all(v is None or engine.sval(v) == "" for v in r):
                continue
            out.append({h: v for h, v in zip(hs, r) if h})
        return out

    def sv(v):
        if isinstance(v, dt.datetime):
            return v.strftime("%Y-%m-%d")
        if isinstance(v, dt.time):
            return f"{v.hour:02d}:{v.minute:02d}"
        return engine.sval(v)
    PCT = {"目标不良率", "预警不良率", "矩阵上升红色%", "矩阵上升橙色%", "矩阵下降绿色%", "集中度高阈值", "集中度中阈值"}
    if "00_管理面板" in wb.sheetnames:
        for r in wb["00_管理面板"].iter_rows(min_row=4, max_col=2, values_only=True):
            k = engine.sval(r[0])
            if k in raw["P"]:
                v = r[1]
                if k in PCT and isinstance(v, (int, float)):
                    v = f"{v * 100:g}%"
                if k == "趋势回看天数" and isinstance(v, dt.datetime):
                    v = 30
                raw["P"][k] = sv(v) if not isinstance(v, (int, float)) or k in PCT else (str(int(v)) if float(v).is_integer() else str(v))
    yn = lambda v: engine.yes(v)
    fm = {}
    for r in rows("字段映射"):
        c = engine.sval(r.get("原表字段"))
        if c:
            fm[c] = {"role": engine.sval(r.get("用途映射")) or "不使用", "show": yn(r.get("明细显示"))}
    raw["fieldmap"] = fm
    OP = {"=": "属于", "!=": "不属于", "~": "包含"}
    sch = []
    for r in rows("筛选方案"):
        name = engine.sval(r.get("方案名称"))
        if not name:
            continue
        conds = []
        for part in re.split(r"[;；]", engine.sval(r.get("附加条件"))):
            m = re.match(r"^\s*(.+?)\s*(!=|=|~)\s*(.+)$", part)
            if m:
                conds.append({"col": m.group(1).strip(), "op": OP[m.group(2)], "vals": engine.split_vals(m.group(3))})
        pie = engine.sval(r.get("饼图"))
        sch.append({"enabled": yn(r.get("启用")), "name": name, "procs": engine.split_vals(r.get("包含工序（、隔开，空=全部）")), "excl": engine.split_vals(r.get("额外排除站点关键字")),
                    "prod": engine.split_vals(r.get("产品类别（MPO/MMC/LCD）")), "shift": engine.split_vals(r.get("班别")), "emp_in": engine.split_vals(r.get("人员组-只看")),
                    "emp_out": engine.split_vals(r.get("人员组-排除")), "def_in": engine.split_vals(r.get("不良组-只看")), "def_out": engine.split_vals(r.get("不良组-排除")),
                    "conds": conds, "range": engine.sval(r.get("日期范围")), "pie": yn(pie) if pie else None, "note": engine.sval(r.get("备注"))})
    if sch:
        raw["schemes"] = sch
    ch = []
    for r in rows("图表配置"):
        if engine.sval(r.get("图表类型")):
            ch.append({"enabled": yn(r.get("启用")), "page": engine.sval(r.get("页面")) or "自定义图表", "title": engine.sval(r.get("图表标题")), "type": engine.sval(r.get("图表类型")),
                       "scheme": engine.sval(r.get("数据方案")), "cat": engine.sval(r.get("分类字段")), "ser": engine.sval(r.get("系列字段")), "metric": engine.sval(r.get("指标")) or "pcs",
                       "top": engine.sval(r.get("TOP")) or "15", "sort": engine.sval(r.get("排序")), "range": engine.sval(r.get("日期范围"))})
    if ch:
        raw["charts"] = ch
    raw["people"] = [{"enabled": engine.sval(r.get("启用")) != "否", "name": engine.sval(r.get("姓名")), "groups": engine.split_vals(r.get("人员组（、隔开）"))}
                     for r in rows("人员名单") if engine.sval(r.get("姓名")) and not engine.sval(r.get("姓名")).startswith("（")]
    dm = {}
    for r in rows("不良类型"):
        c = engine.sval(r.get("不良代码"))
        if c:
            dm[c] = {"stat": engine.sval(r.get("统计")) != "否", "item": engine.sval(r.get("标准不良项目")) or engine.seed_item(c), "split": engine.sval(r.get("按产品拆分")) != "否",
                     "groups": engine.split_vals(r.get("不良组（、隔开）"))}
    raw["defects"] = dm
    for r in rows("预警规则"):
        k = engine.sval(r.get("对象"))
        if k in raw["alerts"]:
            raw["alerts"][k] = engine._alert_full({"依据": engine.sval(r.get("依据")) or "占比", "红线": engine.sval(r.get("红线")), "橙线": engine.sval(r.get("橙线")), "最少pcs": engine.sval(r.get("最少pcs")) or "3",
                                                  "红色": engine.sval(r.get("红色")) or "E00000", "橙色": engine.sval(r.get("橙色")) or "FF9900", "正常色": engine.sval(r.get("正常色")) or "C9D6E8"})
    raw["rules"] = [{"enabled": yn(r.get("启用")), "col": engine.sval(r.get("字段（原表列名）")), "op": engine.sval(r.get("运算")), "vals": engine.split_vals(r.get("值（多个用、隔开）"))}
                    for r in rows("全局筛选规则") if engine.sval(r.get("字段（原表列名）"))]
    chk = {}
    for r in rows("每日检查量"):
        d = r.get("日期")
        try:
            dd = d.strftime("%Y-%m-%d") if isinstance(d, dt.datetime) else engine.sval(d)
            if dd and float(str(r.get("检查量")).replace(",", "")) > 0:
                chk[dd] = float(str(r.get("检查量")).replace(",", ""))
        except (ValueError, TypeError):
            pass
    raw["chk"] = chk
    raw["improve"] = [{"enabled": yn(r.get("启用")), "name": engine.sval(r.get("项目名称")), "item": engine.sval(r.get("标准不良项目（空=全部）")), "proc": engine.sval(r.get("责任工序（空=全部）")),
                       "owner": engine.sval(r.get("负责人")), "start": sv(r.get("开始日期")), "plan": sv(r.get("计划完成")), "n": int(engine.num(r.get("对比天数"), 7) or 7)}
                      for r in rows("改善项目") if engine.sval(r.get("项目名称"))]
    return raw


def read_names_file(path):
    import pandas as pd
    if path.lower().endswith(".csv"):
        df = pd.read_csv(path, dtype=str, keep_default_na=False)
    else:
        df = pd.read_excel(path, sheet_name=0, dtype=str).fillna("")
    df.columns = [str(c).strip() for c in df.columns]
    nc = "姓名" if "姓名" in df.columns else df.columns[0]
    gc = next((c for c in df.columns if c in ("人员组", "组别", "组")), None)
    return [{"enabled": True, "name": str(r[nc]).strip(), "groups": engine.split_vals(r[gc]) if gc else []} for _, r in df.iterrows() if str(r[nc]).strip()]


# ======================== Windows 原生选择对话框 ========================
def pick_dialog(kind, initial=""):
    if os.name != "nt":
        return ""
    if kind == "folder":
        ps = ("Add-Type -AssemblyName System.Windows.Forms; $f=New-Object System.Windows.Forms.Form; $f.TopMost=$true; "
              "$d=New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description='选择文件夹'; "
              + ("$d.SelectedPath='" + initial.replace("'", "''") + "'; " if initial and os.path.isdir(initial) else "")
              + "if($d.ShowDialog($f) -eq 'OK'){[Console]::OutputEncoding=[Text.Encoding]::UTF8; Write-Output $d.SelectedPath}")
    else:
        ps = ("Add-Type -AssemblyName System.Windows.Forms; $f=New-Object System.Windows.Forms.Form; $f.TopMost=$true; "
              "$d=New-Object System.Windows.Forms.OpenFileDialog; $d.Filter='Excel/CSV|*.xlsx;*.xls;*.csv|所有文件|*.*'; "
              "if($d.ShowDialog($f) -eq 'OK'){[Console]::OutputEncoding=[Text.Encoding]::UTF8; Write-Output $d.FileName}")
    try:
        out = subprocess.run(["powershell", "-NoProfile", "-STA", "-Command", ps], capture_output=True, timeout=300)
        return out.stdout.decode("utf-8", "ignore").strip()
    except Exception:
        return ""


def open_path(p):
    try:
        if os.name == "nt":
            os.startfile(p)
        elif sys.platform == "darwin":
            subprocess.Popen(["open", p])
        else:
            subprocess.Popen(["xdg-open", p])
    except Exception as ex:
        logline(f"打开失败：{ex}")


# ======================== 后台任务 ========================
def run_job(raw):
    with LOCK:
        S.update(running=True, done=False, error=None, result=None, log=[], started=time.time())
    try:
        with DATA_LOCK:
            res = engine.run_report(BASE, raw, log=logline)
            # Do not overwrite settings edited while the job was running.
            with engine._CONFIG_LOCK:
                current = engine.load_config_file(BASE)
                for key in ("fieldmap", "defects"):
                    for name, value in res["raw"][key].items(): current[key].setdefault(name, value)
                engine.save_config_file(BASE, current)
        summary = {k: v for k, v in res.items() if k != "raw"}
        with open(os.path.join(BASE, "last_run.json"), "w", encoding="utf-8") as f:
            json.dump(dict(summary, time=f"{dt.datetime.now():%Y-%m-%d %H:%M}"), f, ensure_ascii=False, default=str)
        with LOCK:
            S["result"] = dict(summary, raw=res["raw"])
    except Exception as ex:
        traceback.print_exc()
        with LOCK:
            S["error"] = str(ex)
        logline("✘ " + str(ex))
    finally:
        with LOCK:
            S.update(running=False, done=True)


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype="application/json; charset=utf-8"):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False, default=str).encode("utf-8")
        elif isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urlparse(self.path)
        p = u.path
        if p == "/api/ping":
            S["last_ping"], S["pinged"], S["bye"] = time.time(), True, 0.0
            return self._send(200, {"ok": True})
        if p == "/api/state":
            last = None
            lp = os.path.join(BASE, "last_run.json")
            if os.path.exists(lp):
                try:
                    last = json.load(open(lp, encoding="utf-8"))
                except Exception:
                    pass
            return self._send(200, dict(config=engine.default_config() if 'default' in u.query else engine.load_config_file(BASE), last=last, base=BASE, first_run=not os.path.exists(os.path.join(BASE, "config.json")),
                                        meta=dict(roles=engine.ROLES, ops=engine.OPS, chart_types=engine.CHART_TYPES, dims=engine.DIMS, ranges=engine.RANGE_OPTS,
                                                  alert_keys=engine.ALERT_KEYS, monitor=engine.MONITOR, role_default=engine.ROLE_DEFAULT)))
        if p == "/favicon.ico":
            return self._send(204, b"", "image/x-icon")
        if p == "/api/status":
            since = int(parse_qs(u.query).get("since", ["0"])[0])
            with LOCK:
                return self._send(200, dict(running=S["running"], done=S["done"], error=S["error"], log=S["log"][since:], n=len(S["log"]), result=S["result"] if S["done"] else None,
                                            elapsed=round(time.time() - S["started"], 1) if S["running"] else 0))
        # 静态文件
        if p in ("/", "/index.html"):
            p = "/index.html"
        fp = os.path.normpath(os.path.join(UI, p.lstrip("/")))
        if os.path.commonpath([UI, fp]) == UI and os.path.isfile(fp):
            ct = {".js": "application/javascript", ".css": "text/css", ".html": "text/html", ".json": "application/json", ".svg": "image/svg+xml"}.get(os.path.splitext(fp)[1].lower()) \
                or mimetypes.guess_type(fp)[0] or "application/octet-stream"
            with open(fp, "rb") as f:
                return self._send(200, f.read(), ct + ("; charset=utf-8" if ct.startswith("text") or "javascript" in ct else ""))
        self._send(404, {"error": "not found"})

    def do_POST(self):
        origin=self.headers.get("Origin")
        host=self.headers.get("Host", "")
        if origin and origin != "http://" + host:
            return self._send(403, {"ok":False,"error":"不接受跨站请求"})
        if host.split(":")[0] not in ("127.0.0.1", "localhost"):
            return self._send(403, {"ok":False,"error":"仅允许本机访问"})
        try:
            n = int(self.headers.get("Content-Length") or 0)
            if not 0 <= n <= 128 * 1024 * 1024:
                return self._send(413, {"ok": False, "error": "请求过大，请减少一次导出的图片数量。"})
        except ValueError:
            return self._send(400, {"ok": False, "error": "无效请求长度。"})
        try:
            body = json.loads(self.rfile.read(n) or b"{}")
        except (UnicodeError, json.JSONDecodeError):
            return self._send(400, {"ok": False, "error": "请求格式错误，请刷新页面后重试。"})
        if not isinstance(body, dict):
            return self._send(400, {"ok": False, "error": "请求内容必须是对象。"})
        p = urlparse(self.path).path
        try:
            if p.startswith("/api/bi/"):
                with DATA_LOCK:
                    result = bi_bridge.dispatch(BASE, p.rsplit("/", 1)[-1], body)
                return self._send(200, result)
            if p.startswith("/api/daily/"):
                with DATA_LOCK:
                    result = daily.dispatch(BASE, p.rsplit("/", 1)[-1], body)
                return self._send(200, result)
            if p == "/api/save":
                engine.save_config_file(BASE, body["config"])
                return self._send(200, {"ok": True, "time": f"{dt.datetime.now():%H:%M:%S}"})
            if p == "/api/scan":
                with DATA_LOCK:
                    result = engine.scan_data(BASE, body["config"], force=bool(body.get("force")))
                return self._send(200, result)
            if p == "/api/preview":
                with DATA_LOCK:
                    result = engine.preview_scheme(BASE, body["config"], body["scheme"])
                return self._send(200, result)
            if p in ("/api/analytics", "/api/analytics/export"):
                with DATA_LOCK:
                    result = (analytics.export if p.endswith("/export") else analytics.analyze)(BASE, body["config"], body.get("query", {}))
                return self._send(200, result)
            if p == "/api/run":
                with LOCK:
                    if S["running"]:
                        return self._send(200, {"ok": False, "error": "正在生成中"})
                    S.update(running=True, done=False, error=None, result=None, log=[], started=time.time())
                try:
                    engine.save_config_file(BASE, body["config"])
                    threading.Thread(target=run_job, args=(body["config"],), daemon=True).start()
                except Exception:
                    with LOCK: S["running"] = False
                    raise
                return self._send(200, {"ok": True})
            if p == "/api/open":
                cfg = engine.merge_config(body.get("config") or engine.load_config_file(BASE))
                what = body.get("what")
                target = {"input": engine.abspath(BASE, cfg["paths"]["input"]), "output": engine.abspath(BASE, cfg["paths"]["output"]),
                          "history": engine.abspath(BASE, cfg["paths"]["history"]), "base": BASE}.get(what)
                if what == "latest":
                    target = os.path.join(engine.abspath(BASE, cfg["paths"]["output"]), "不良分析_最新.xlsx")
                if what == "file":
                    target = body.get("path")
                if target:
                    os.makedirs(target, exist_ok=True) if what in ("input", "output", "history") else None
                    if os.path.exists(target):
                        open_path(target)
                        return self._send(200, {"ok": True})
                return self._send(200, {"ok": False, "error": "路径不存在"})
            if p == "/api/pick":
                return self._send(200, {"path": pick_dialog(body.get("kind", "folder"), body.get("initial", ""))})
            if p == "/api/legacy":
                path = body.get("path") or os.path.join(BASE, "不良分析_控制台.xlsx")
                if not os.path.exists(path):
                    return self._send(200, {"ok": False, "error": f"找不到文件：{path}"})
                return self._send(200, {"ok": True, "config": legacy_import(path)})
            if p == "/api/names":
                return self._send(200, {"people": read_names_file(body["path"])})
            if p == "/api/bye":
                S["bye"] = time.time()
                return self._send(200, {"ok": True})
            if p == "/api/exit":
                self._send(200, {"ok": True})
                threading.Thread(target=lambda: (time.sleep(0.3), os._exit(0)), daemon=True).start()
                return
        except ValueError as ex:
            return self._send(200, {"ok": False, "error": str(ex)})
        except Exception as ex:
            traceback.print_exc()
            return self._send(200, {"ok": False, "error": f"操作失败：{type(ex).__name__}；请保留程序日志以便排查。"})
        self._send(404, {"error": "not found"})


def watchdog():
    while True:
        time.sleep(2)
        if S["running"]:
            continue
        if S["bye"] and time.time() - S["bye"] > 6:
            os._exit(0)
        if S["pinged"] and time.time() - S["last_ping"] > 180:
            os._exit(0)
        if not S["pinged"] and time.time() - S["last_ping"] > 90:
            os._exit(0)


def find_browser():
    cands = []
    for env in ("PROGRAMFILES(X86)", "PROGRAMFILES", "LOCALAPPDATA"):
        root = os.environ.get(env)
        if root:
            cands += [os.path.join(root, r"Microsoft\Edge\Application\msedge.exe"), os.path.join(root, r"Google\Chrome\Application\chrome.exe")]
    return next((c for c in cands if os.path.exists(c)), None)


def open_window(url):
    b = find_browser()
    if b:
        prof = os.path.join(BASE, ".app_profile")
        try:
            subprocess.Popen([b, f"--app={url}", "--window-size=1320,840", f"--user-data-dir={prof}", "--no-first-run", "--no-default-browser-check", "--disable-extensions"])
            return True
        except Exception:
            pass
    import webbrowser
    webbrowser.open(url)
    return False


def main():
    global PORT
    for port in range(8765, 8800):
        try:
            srv = ThreadingHTTPServer(("127.0.0.1", port), H)
            PORT = port
            break
        except OSError:
            continue
    else:
        print("找不到可用端口")
        return
    url = f"http://127.0.0.1:{PORT}/"
    print("=" * 56)
    print("  BK 5F 品质驾驶舱 · 配置面板 已启动")
    print(f"  {url}")
    print("  关闭面板窗口即自动退出（本黑窗口也会随之关闭）")
    print("=" * 56)
    S["last_ping"] = time.time()
    threading.Thread(target=watchdog, daemon=True).start()
    if "--no-window" not in sys.argv:
        open_window(url)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
