# -*- coding: utf-8 -*-
"""
BK 5F 品质驾驶舱 · 分析引擎（由【不良分析面板】调用，也可单独运行：python engine.py）
读取：每日原表(xlsx) → 历史数据库 → 按 config.json 的规则筛选 → 生成 Excel 报表
"""
import os, re, sys, glob, json, shutil, hashlib, zipfile, tempfile, threading, datetime as dt
_LIBS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "libs")      # 免管理员安装的依赖目录（setup_deps.py 创建）
if os.path.isdir(_LIBS) and _LIBS not in sys.path:
    sys.path.insert(0, _LIBS)
from xml.sax.saxutils import escape
import pandas as pd
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.formatting.rule import ColorScaleRule, DataBarRule
from openpyxl.chart import BarChart, LineChart, PieChart, DoughnutChart, Reference
from openpyxl.chart.label import DataLabelList, DataLabel
from openpyxl.chart.marker import DataPoint, Marker
from openpyxl.chart.series import SeriesLabel
from openpyxl.chart.title import Title
from openpyxl.chart.text import Text, RichText
from openpyxl.chart.layout import Layout, ManualLayout
from openpyxl.drawing.text import (Paragraph, ParagraphProperties, CharacterProperties, RegularTextRun, RichTextProperties)
from openpyxl.worksheet.properties import PageSetupProperties
from openpyxl.utils import get_column_letter as L

U = "pcs"
FONT = "Microsoft YaHei"
NAVY = "1F3864"
HDR = PatternFill("solid", start_color="1F4E78")
TOT = PatternFill("solid", start_color="FFF2CC")
SEC = PatternFill("solid", start_color="D9E1F2")
GREYF = PatternFill("solid", start_color="F2F2F2")
thin = Side(style="thin", color="BFBFBF")
BD = Border(left=thin, right=thin, top=thin, bottom=thin)
ST = {"red": ("FFC7CE", "9C0006"), "orange": ("FFE0B2", "C65911"), "yellow": ("FFF2CC", "7F6000"),
      "green": ("C6EFCE", "006100"), "purple": ("E4DFEC", "5B2C8B"), "blue": ("DDEBF7", "1F4E78"), "": (None, "000000")}
PALETTE = ["2E75B6", "ED7D31", "A5A5A5", "FFC000", "5B9BD5", "70AD47", "264478", "9E480E", "7030A0", "00B0F0"]
PIE_COLORS = ["C00000", "ED7D31", "4472C4", "70AD47", "7030A0", "00B0F0", "BF8F00", "A5A5A5", "FF66CC", "264478"]
GOOD_RULE = {"正常色": "70AD47", "橙色": "FFC000", "红色": "E00000"}
LOW_RULE = {"正常色": "C9D6E8", "橙色": "FF9900", "红色": "E00000"}


# ======================== 通用工具 ========================
def sval(v):
    return "" if v is None or (isinstance(v, float) and pd.isna(v)) else str(v).strip()


def split_vals(s):
    if isinstance(s, (list, tuple, set)):
        return [str(x).strip() for x in s if str(x).strip()]
    s = sval(s)
    return [x.strip() for x in re.split(r"[、,，;；\n]", s) if x.strip()] if s else []


def yes(v):
    return v is True or sval(v) in ("是", "Y", "y", "1", "True", "TRUE", "true", "yes", "Yes")


def num(v, d=0.0):
    try:
        t = sval(v)
        return float(t.rstrip("%")) / (100 if t.endswith("%") else 1)
    except ValueError:
        return d


def pct_val(v, d=1.0):
    v = sval(v)
    try:
        if v.endswith("%"):
            return float(v[:-1]) / 100
        f = float(v)
        return f if f < 1 else f / 100
    except ValueError:
        return d


def hdr(ws, r, c, v, fill=HDR, color="FFFFFF"):
    x = ws.cell(row=r, column=c, value=v)
    x.font = Font(name=FONT, bold=True, color=color, size=10)
    x.fill = fill
    x.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    x.border = BD
    return x


def cell(ws, r, c, v, bold=False, fill=None, fmt=None, center=False, color=None, size=10, wrap=False, border=True):
    x = ws.cell(row=r, column=c, value=v)
    x.font = Font(name=FONT, bold=bold, color=color, size=size)
    if border:
        x.border = BD
    if fill:
        x.fill = fill
    if fmt:
        x.number_format = fmt
    if center or wrap:
        x.alignment = Alignment(horizontal="center" if center else None, vertical="center", wrap_text=wrap)
    return x


def stcell(ws, r, c, v, key, **kw):
    bg, fg = ST.get(key, ST[""])
    return cell(ws, r, c, v, fill=PatternFill("solid", start_color=bg) if bg else None, color=fg, **kw)


def section(ws, r, text, ncol=10, c0=1):
    for c in range(c0, c0 + ncol):
        ws.cell(row=r, column=c).fill = SEC
    x = ws.cell(row=r, column=c0, value=text)
    x.font = Font(name=FONT, bold=True, size=12, color="1F4E78")
    ws.row_dimensions[r].height = 20


def widths(ws, lst):
    for j, w in enumerate(lst, 1):
        ws.column_dimensions[L(j)].width = w


def databar(ws, rng, color):
    ws.conditional_formatting.add(rng, DataBarRule(start_type="num", start_value=0, end_type="max", color=color))


def heat(ws, rng, c1="FFFFFF", c2="F8696B"):
    ws.conditional_formatting.add(rng, ColorScaleRule(start_type="num", start_value=0, start_color=c1, end_type="max", end_color=c2))


def fmt_pct(v, d=1):
    return "" if v is None or (isinstance(v, float) and pd.isna(v)) else f"{v * 100:.{d}f}%"


def link(ws, r, c, text, target):
    x = ws.cell(row=r, column=c, value=text)
    x.hyperlink = f"#'{target}'!A1"
    x.font = Font(name=FONT, color="0563C1", underline="single", size=10)
    x.border = BD


# ======================== 图表库 ========================
LABELS = {}


def cm_h(n, base=2.8, per=0.62):
    return max(6.5, per * n + base)


def rows_for(h_cm):
    return int(h_cm / 0.53) + 2


def mk_title(t, sz=1100):
    cp = CharacterProperties(sz=sz, b=True)
    para = Paragraph(pPr=ParagraphProperties(defRPr=cp), r=[RegularTextRun(rPr=cp, t=t)])
    return Title(tx=Text(rich=RichText(p=[para])), overlay=False)


def _tick_font(ch, rot=None, sz=800):
    cp = CharacterProperties(sz=sz)
    body = RichTextProperties(rot=rot, vert="horz") if rot is not None else RichTextProperties()
    ch.x_axis.txPr = RichText(bodyPr=body, p=[Paragraph(pPr=ParagraphProperties(defRPr=cp), endParaRPr=cp)])


def _mark(series, labels):
    mark = f"CHT_{len(LABELS) + 1}"
    series.tx = SeriesLabel(v=mark)
    LABELS[mark] = labels


def _lbl(series, pos=None):
    series.dLbls = DataLabelList()
    series.dLbls.showVal = True
    series.dLbls.showSerName = series.dLbls.showCatName = series.dLbls.showLegendKey = series.dLbls.showPercent = False
    if pos:
        series.dLbls.dLblPos = pos


def inject_labels(path):
    """把 'pcs | 占比' 之类的自定义文字写进数据点标签"""
    if not LABELS:
        return
    tmp = path + ".tmp"
    A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
    with zipfile.ZipFile(path) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for it in zin.infolist():
            data = zin.read(it.filename)
            if it.filename.startswith("xl/charts/chart"):
                x = data.decode("utf-8")
                m = re.search(r"<tx><v>(CHT_\d+)</v></tx>", x)
                if m and m.group(1) in LABELS:
                    for i, t in enumerate(LABELS[m.group(1)]):
                        rich = (f'<tx><rich><a:bodyPr {A}/><a:p {A}><a:pPr><a:defRPr sz="900" b="1"/></a:pPr>'
                                f'<a:r><a:rPr lang="zh-CN" sz="900" b="1"/><a:t>{escape(t)}</a:t></a:r></a:p></rich></tx>')
                        x = x.replace(f'<dLbl><idx val="{i}"/>', f'<dLbl><idx val="{i}"/>{rich}', 1)
                    data = x.encode("utf-8")
            zout.writestr(it, data)
    shutil.move(tmp, path)


class DataSheet:
    """所有图表的数据都放在【图表数据】页，图表引用这里"""
    def __init__(self, ws):
        self.ws, self.r = ws, 1

    def block(self, title, header, rows, fmts=None):
        ws, r = self.ws, self.r
        ws.cell(row=r, column=1, value=title).font = Font(name=FONT, bold=True, color="1F4E78")
        for j, h in enumerate(header, 1):
            hdr(ws, r + 1, j, h)
        if not rows:
            rows = [[""] + [0] * (len(header) - 1)]
        for i, row in enumerate(rows):
            for j, v in enumerate(row, 1):
                if isinstance(v, float) and pd.isna(v):
                    v = None
                c = ws.cell(row=r + 2 + i, column=j, value=v)
                c.font = Font(name=FONT, size=10)
                if fmts and fmts.get(j):
                    c.number_format = fmts[j]
        r_hdr, r1 = r + 1, r + 1 + len(rows)
        self.r = r1 + 3
        return r_hdr, r1


def build_chart(ws, anchor, title, kind, wd, r_hdr, r1, ncols, w=13.2, h=7.2, levels=None, rule=None, labels=None,
                colors=None, pct_axis=False, dash_from=None, rot=None, cat_col=1, val_col=2, no_labels=False):
    """kind: bar|col|stack|pstack|sbar|line|combo|pareto|pie|donut|hist ；数据 [A=分类, B..=系列]，表头在 r_hdr"""
    cat = Reference(wd, min_col=cat_col, min_row=r_hdr + 1, max_row=r1)
    vcols = list(range(val_col, val_col + ncols - 1))
    colors = colors or PALETTE
    if kind in ("pie", "donut"):
        ch = PieChart() if kind == "pie" else DoughnutChart()
        if kind == "donut":
            ch.holeSize = 50
        ch.add_data(Reference(wd, min_col=vcols[0], min_row=r_hdr, max_row=r1), titles_from_data=True)
        ch.set_categories(cat)
        s = ch.series[0]
        n = r1 - r_hdr
        if labels:
            _mark(s, labels)
        for i in range(n):
            dp = DataPoint(idx=i)
            dp.graphicalProperties.solidFill = PIE_COLORS[i % len(PIE_COLORS)]
            dp.graphicalProperties.line.solidFill = "FFFFFF"
            s.dPt.append(dp)
        if labels:
            s.dLbls = DataLabelList(dLbl=[DataLabel(idx=i, showVal=True, showSerName=False, showCatName=False, showLegendKey=False, showPercent=False) for i in range(n)])
            s.dLbls.showVal = True
        else:
            _lbl(s)
            s.dLbls.showPercent, s.dLbls.showVal = True, False
        ch.legend.position = "r"
        ch.title = mk_title(title)
        ch.width, ch.height = w, h
        ws.add_chart(ch, anchor)
        return ch
    if kind == "line":
        ch = LineChart()
        for ci in vcols:
            ch.add_data(Reference(wd, min_col=ci, min_row=r_hdr, max_row=r1), titles_from_data=True)
        ch.set_categories(cat)
        for i, s in enumerate(ch.series):
            col = colors[i % len(colors)]
            s.graphicalProperties.line.solidFill = col
            s.graphicalProperties.line.width = 28575
            s.smooth = False
            if dash_from is not None and i >= dash_from:
                s.graphicalProperties.line.dashStyle = "dash"
                s.graphicalProperties.line.width = 19050
                s.marker = Marker(symbol="none")
            else:
                s.marker = Marker(symbol="circle", size=6)
                if i == 0 and not no_labels:
                    _lbl(s, "t")
        ch.x_axis.delete = False
        ch.y_axis.delete = False
        if pct_axis:
            ch.y_axis.number_format = "0.00%"
    elif kind in ("combo", "pareto"):
        ch = BarChart()
        ch.type = "col"
        ch.add_data(Reference(wd, min_col=vcols[0], min_row=r_hdr, max_row=r1), titles_from_data=True)
        ch.set_categories(cat)
        s = ch.series[0]
        s.graphicalProperties.solidFill = colors[0]
        s.graphicalProperties.line.noFill = True
        _lbl(s, "outEnd")
        ch.gapWidth = 40 if kind == "combo" else 20
        ln = LineChart()
        for ci in vcols[1:]:
            ln.add_data(Reference(wd, min_col=ci, min_row=r_hdr, max_row=r1), titles_from_data=True)
        ln.set_categories(cat)
        for i, s2 in enumerate(ln.series):
            s2.graphicalProperties.line.solidFill = "C00000" if i == 0 else colors[(i + 1) % len(colors)]
            s2.graphicalProperties.line.width = 22225
            s2.smooth = False
            s2.marker = Marker(symbol="circle", size=5)
            _lbl(s2, "t")
        ln.y_axis.axId = 200
        ln.y_axis.crosses = "max"
        ln.y_axis.number_format = "0%" if kind == "pareto" else "0.00%"
        ln.y_axis.majorGridlines = None
        ln.y_axis.delete = False
        if kind == "pareto":
            ln.y_axis.scaling.min, ln.y_axis.scaling.max = 0, 1
        ch += ln
        ch.x_axis.delete = False
        ch.y_axis.delete = False
        ch.y_axis.majorGridlines = None
    else:
        ch = BarChart()
        horiz = kind in ("bar", "sbar")
        ch.type = "bar" if horiz else "col"
        stacked = kind in ("stack", "pstack", "sbar")
        if stacked:
            ch.grouping = "percentStacked" if kind == "pstack" else "stacked"
            ch.overlap = 100
        for ci in vcols:
            ch.add_data(Reference(wd, min_col=ci, min_row=r_hdr, max_row=r1), titles_from_data=True)
        ch.set_categories(cat)
        single = ncols == 2
        for i, s in enumerate(ch.series):
            s.graphicalProperties.solidFill = colors[i % len(colors)]
            s.graphicalProperties.line.noFill = True
            if single and levels:
                for k, lv in enumerate(levels):
                    dp = DataPoint(idx=k)
                    dp.graphicalProperties.solidFill = (rule["正常色"], rule["橙色"], rule["红色"])[lv]
                    dp.graphicalProperties.line.noFill = True
                    s.dPt.append(dp)
            if single and labels:
                _mark(s, labels)
                s.dLbls = DataLabelList(dLbl=[DataLabel(idx=k, showVal=True, showSerName=False, showCatName=False, showLegendKey=False, dLblPos="outEnd") for k in range(len(labels))])
                s.dLbls.showVal = True
                s.dLbls.dLblPos = "outEnd"
            else:
                _lbl(s, None if stacked else "outEnd")
        ch.gapWidth = 5 if kind == "hist" else (35 if horiz else 60)
        if horiz:
            ch.x_axis.scaling.orientation = "maxMin"
            ch.y_axis.delete = single
            if single:
                ch.y_axis.majorGridlines = None
                ch.plot_area.layout = Layout(manualLayout=ManualLayout(layoutTarget="inner", xMode="edge", yMode="edge", x=0.27, y=0.14, w=0.50, h=0.83))
        else:
            ch.y_axis.delete = False
        ch.x_axis.delete = False
        if pct_axis and not horiz:
            ch.y_axis.number_format = "0.0%"
        if kind == "pstack":
            ch.y_axis.number_format = "0%"
        if not horiz and (rot or (r1 - r_hdr) > 8):
            _tick_font(ch, rot=rot if rot is not None else -2700000)
    ch.title = mk_title(title)
    if ncols > 2 or kind in ("combo", "pareto", "pie", "donut"):
        ch.legend.position = "b"
    else:
        ch.legend = None
    ch.width, ch.height = w, h
    ws.add_chart(ch, anchor)
    return ch


# ======================== 配置（config.json）========================
MONITOR = ["物料穿错", "装管反", "并纤反", "PIN孔堵", "插芯内部断纤", "纤缩/无纤"]
ROLES = ["业务日期", "记录时间", "责任员工", "责任工序", "责任站点", "不良代码", "不良大类", "班别", "数量",
         "序列号", "产品类别备用", "连接器类型", "产品类型", "工单", "不使用"]
ROLE_DEFAULT = {"Work Date": "业务日期", "Report Date": "记录时间", "Employee in Charge": "责任员工",
                "Workflow Category in Charge": "责任工序", "Workflow Step in Charge": "责任站点",
                "Defect Code": "不良代码", "Defect Code Category": "不良大类", "Shift": "班别",
                "Sum of Qty": "数量", "Serial Number": "序列号", "Process Type in Charge": "产品类别备用",
                "Connector Type": "连接器类型", "Product Type": "产品类型", "Mfg Order": "工单"}
SHOW_DEFAULT = {"Serial Number", "Mfg Order", "Work Date", "Failure Code", "Failure Code Category", "Workflow Step Name",
                "Resource Name", "Report Date", "Report Full Name", "Shift", "Defect Code", "Defect Code Category",
                "Disposition Type", "Check Full Name", "Product Type", "Connector Type", "Channel Type",
                "Workflow Category in Charge", "Workflow Step in Charge", "Employee in Charge", "Determination status", "Part Number"}
RANGE_OPTS = ["单日", "最近7天", "最近14天", "最近30天", "本周", "上周", "本月", "上月", "全部历史", "自定义"]
CHART_TYPES = ["横向条形图", "柱形图", "堆积柱形图", "百分比堆积柱形图", "堆积条形图", "折线图", "柱线组合图", "帕累托图", "饼图", "圆环图", "直方图", "热力图"]
DIMS = ["责任员工", "责任工序", "责任站点", "不良代码", "标准不良项目", "不良大类", "不良组", "班别", "产品类别", "业务日期", "业务周", "业务月", "连接器类型", "产品类型"]
OPS = ["等于", "不等于", "属于", "不属于", "包含", "不包含", "为空", "不为空"]
ALERT_KEYS = ["人员", "人员总览", "不良", "工序", "不良大类", "班别"]


def seed_item(code):
    c = re.sub(r"^CN_", "", sval(code))
    c = re.sub(r"^(MPO|MMC24|MMC|LCD)_+", "", c).strip("_")
    if any(k in c for k in ("穿错物料", "物料少穿", "物料穿反", "物料穿错")):
        return "物料穿错"
    if "纤缩" in c or c.endswith("无纤"):
        return "纤缩/无纤"
    if "PIN" in c and "堵" in c:
        return "PIN孔堵"
    return c or sval(code)


FRONT = ["03-剪线", "04-并带", "05-剥线", "06-注胶", "07-装管"]


def default_config():
    return {
        "version": 9,
        "analytics": {"query": {}, "presets": []},
        "process_groups": [],
        "paths": {"input": "每日原表", "history": "历史数据库", "output": "分析结果", "pattern": "data*.xlsx"},
        "P": {
            "业务日期来源": "业务日期", "业务日切换时间": "08:00",
            "去重字段": "Serial Number、Report Date、Defect Code、Workflow Step in Charge、Employee in Charge",
            "重新导入全部文件": "否", "导入后归档原表": "否",
            "基准日期": "", "分析窗口": "最近7天", "自定义开始日期": "", "自定义结束日期": "", "方案分析表范围": "单日", "趋势回看天数": "30",
            "看板方案": "每日看板", "月度风险方案": "全部工序", "专项不良项目": "、".join(MONITOR), "专项图统计范围": "当日",
            "专项图人员TOP": "12", "矩阵最多行数": "30", "产品类别": "MPO、MMC、LCD", "产品类别颜色": "8FAADC、1F3864、BFBFBF",
            "目标不良率": "0.15%", "预警不良率": "0.20%",
            "连续上升红灯天数": "3", "连续上升橙灯天数": "2", "明显上升倍数": "1.5", "预警最少pcs": "3", "重复异常天数红": "3",
            "重复异常天数橙": "2", "复发判定零天数": "5", "持续出现天数": "5", "矩阵上升红色%": "30%", "矩阵上升橙色%": "10%",
            "矩阵下降绿色%": "10%", "集中度高阈值": "50%", "集中度中阈值": "30%",
            "输出驾驶舱": "是", "输出趋势分析": "是", "输出月度分析": "是", "输出风险与集中度": "是", "输出自定义图表": "是",
            "输出方案分析表": "是", "输出改善项目": "是",
            "人员筛选模式": "不筛选", "全局排除站点关键字": "返修", "剔除责任员工为空": "是", "自动生成单工序表": "是",
            "图表人员TOP": "15", "图表不良TOP": "15", "交叉表最多列数": "30",
        },
        "fieldmap": {},      # 列名 -> {"role":..., "show": bool}
        "schemes": [
            {"enabled": True, "name": "每日看板", "procs": FRONT, "excl": [], "prod": [], "shift": [], "emp_in": [], "emp_out": [],
             "def_in": ["看板监控"], "def_out": [], "conds": [], "range": "", "pie": True, "note": "驾驶舱使用：前端工序 + ‘看板监控’不良组"},
            {"enabled": True, "name": "全部工序", "procs": [], "excl": [], "prod": [], "shift": [], "emp_in": [], "emp_out": [],
             "def_in": [], "def_out": [], "conds": [], "range": "", "pie": False, "note": "月度分析/风险页使用：不限工序"},
            {"enabled": True, "name": "剪线-装管", "procs": FRONT, "excl": [], "prod": [], "shift": [], "emp_in": [], "emp_out": [],
             "def_in": [], "def_out": [], "conds": [], "range": "", "pie": True, "note": "多个工序合并成一张表"},
        ],
        "charts": [
            {"enabled": True, "page": "自定义图表", "title": "各工序不良占比", "type": "饼图", "scheme": "全部工序", "cat": "责任工序", "ser": "", "metric": "pcs", "top": 8, "sort": "降序", "range": ""},
            {"enabled": True, "page": "自定义图表", "title": "人员不良TOP15", "type": "横向条形图", "scheme": "全部工序", "cat": "责任员工", "ser": "", "metric": "pcs", "top": 15, "sort": "降序", "range": ""},
            {"enabled": True, "page": "自定义图表", "title": "不良项目帕累托", "type": "帕累托图", "scheme": "全部工序", "cat": "标准不良项目", "ser": "", "metric": "pcs", "top": 12, "sort": "降序", "range": ""},
            {"enabled": True, "page": "自定义图表", "title": "每日不良（按产品类别堆积）", "type": "堆积柱形图", "scheme": "每日看板", "cat": "业务日期", "ser": "产品类别", "metric": "pcs", "top": 30, "sort": "日期", "range": "最近14天"},
            {"enabled": True, "page": "自定义图表", "title": "工序×产品类别", "type": "柱形图", "scheme": "全部工序", "cat": "责任工序", "ser": "产品类别", "metric": "pcs", "top": 10, "sort": "降序", "range": ""},
            {"enabled": True, "page": "自定义图表", "title": "员工不良数分布（直方图）", "type": "直方图", "scheme": "全部工序", "cat": "责任员工", "ser": "", "metric": "人数", "top": 20, "sort": "", "range": ""},
            {"enabled": True, "page": "自定义图表", "title": "人员×不良项目热力图", "type": "热力图", "scheme": "全部工序", "cat": "责任员工", "ser": "标准不良项目", "metric": "pcs", "top": 15, "sort": "降序", "range": ""},
        ],
        "people": [],        # {"name":..., "groups":[...]}
        "defects": {},       # code -> {"stat":bool,"item":str,"split":bool,"groups":[...]}
        "alerts": {k: _alert_full(v) for k, v in (
            ("人员", ("占比", "8%", "4%", 3)), ("人员总览", ("占比", "3%", "1.5%", 3)), ("不良", ("占比", "20%", "10%", 3)),
            ("工序", ("占比", "20%", "10%", 3)), ("不良大类", ("占比", "20%", "10%", 3)), ("班别", ("占比", "60%", "50%", 3)))},
        "rules": [],         # {"enabled","col","op","vals":[...]}
        "chk": {},           # "YYYY-MM-DD" -> 检查量
        "improve": [],
    }


def _alert_full(a):
    """alerts 简写 (依据,红,橙,最少) → 完整字典"""
    if isinstance(a, dict):
        d = dict(a)
    else:
        d = {"依据": a[0], "红线": a[1], "橙线": a[2], "最少pcs": a[3]}
    d.setdefault("红色", "E00000")
    d.setdefault("橙色", "FF9900")
    d.setdefault("正常色", "C9D6E8")
    return d


def merge_config(raw):
    """把用户 config 与默认配置合并（缺的项补默认，已有的不动）"""
    base = default_config()
    raw = raw or {}
    for k in ("paths", "P"):
        base[k].update(raw.get(k, {}))
    for k in ("fieldmap", "schemes", "charts", "people", "defects", "rules", "chk", "improve", "analytics", "process_groups"):
        if k in raw:
            base[k] = raw[k]
    al = {k: _alert_full(v) for k, v in base["alerts"].items()}
    for k, v in (raw.get("alerts") or {}).items():
        al[k] = _alert_full(v)
    base["alerts"] = al
    return base


def build_cfg(raw):
    """config.json → 引擎内部结构"""
    raw = merge_config(raw)
    P = {k: sval(v) for k, v in raw["P"].items()}
    cfg = {"P": P, "raw": raw}
    roles, show = {}, []
    for col, m in raw["fieldmap"].items():
        role = sval(m.get("role"))
        if role and role != "不使用" and role not in roles:
            roles[role] = col
        if m.get("show"):
            show.append(col)
    cfg["roles"], cfg["show"] = roles, show
    schemes = []
    for s in raw["schemes"]:
        if not s.get("enabled", True) or not sval(s.get("name")):
            continue
        conds = []
        for c in s.get("conds", []):
            if sval(c.get("col")) and sval(c.get("op")):
                conds.append((sval(c["col"]), sval(c["op"]), split_vals(c.get("vals", []))))
        procs = split_vals(s.get("procs", []))
        pie = s.get("pie")
        schemes.append(dict(name=sval(s["name"])[:31], procs=procs, excl=split_vals(s.get("excl", [])), prod=split_vals(s.get("prod", [])),
                            shift=split_vals(s.get("shift", [])), emp_in=split_vals(s.get("emp_in", [])), emp_out=split_vals(s.get("emp_out", [])),
                            def_in=split_vals(s.get("def_in", [])), def_out=split_vals(s.get("def_out", [])), conds=conds,
                            range=sval(s.get("range")), pie=yes(pie) if pie not in (None, "") else len(procs) > 1))
    cfg["schemes"] = schemes
    cfg["charts"] = [{"页面": c.get("page", "自定义图表"), "图表标题": sval(c.get("title")), "图表类型": sval(c.get("type")), "数据方案": sval(c.get("scheme")),
                      "分类字段": sval(c.get("cat")), "系列字段": sval(c.get("ser")), "指标": sval(c.get("metric")), "TOP": sval(c.get("top")),
                      "排序": sval(c.get("sort")), "日期范围": sval(c.get("range"))}
                     for c in raw["charts"] if c.get("enabled", True) and sval(c.get("type")) and sval(c.get("cat"))]
    people = {}
    for p in raw["people"]:
        if p.get("enabled", True) and sval(p.get("name")):
            people.setdefault(sval(p["name"]), set()).update(split_vals(p.get("groups", [])) or ["名单"])
    cfg["people"] = people
    dm, off = {}, set()
    for code, d in raw["defects"].items():
        dm[code] = dict(item=sval(d.get("item")) or seed_item(code), split=d.get("split", True) is not False, groups=set(split_vals(d.get("groups", []))))
        if d.get("stat") is False:
            off.add(code)
    cfg["defmap"], cfg["def_off"] = dm, off
    split = {}
    for v in dm.values():
        split[v["item"]] = split.get(v["item"], True) and v["split"]
    cfg["item_split"] = split
    cfg["alerts"] = {k: {"依据": sval(v["依据"]), "红线": sval(v["红线"]), "橙线": sval(v["橙线"]), "最少pcs": sval(v["最少pcs"]),
                         "红色": sval(v["红色"]).lstrip("#").upper(), "橙色": sval(v["橙色"]).lstrip("#").upper(), "正常色": sval(v["正常色"]).lstrip("#").upper()}
                     for k, v in raw["alerts"].items()}
    cfg["rules"] = [(sval(r["col"]), sval(r["op"]), split_vals(r.get("vals", []))) for r in raw["rules"] if r.get("enabled", True) and sval(r.get("col")) and sval(r.get("op"))]
    chk = {}
    for k, v in raw["chk"].items():
        d = pd.to_datetime(k, errors="coerce")
        try:
            f = float(str(v).replace(",", ""))
        except ValueError:
            continue
        if pd.notna(d) and f > 0:
            chk[d.normalize()] = f
    cfg["chk"] = chk
    imp = []
    for i in raw["improve"]:
        sd = pd.to_datetime(sval(i.get("start")), errors="coerce")
        if i.get("enabled", True) and sval(i.get("name")) and pd.notna(sd):
            imp.append(dict(name=sval(i["name"]), item=sval(i.get("item")), proc=sval(i.get("proc")), owner=sval(i.get("owner")),
                            start=sd.normalize(), plan=sval(i.get("plan")), n=int(num(i.get("n"), 7) or 7)))
    cfg["improve"] = imp
    prods = split_vals(P["产品类别"]) or ["MPO", "MMC", "LCD"]
    cols = [c.lstrip("#").upper() for c in split_vals(P["产品类别颜色"])]
    cfg["prods"] = prods
    cfg["prod_colors"] = {p: (cols[i] if i < len(cols) else PALETTE[i % len(PALETTE)]) for i, p in enumerate(prods)}
    return cfg


# ======================== 数据导入 / 历史库 / 去重 ========================
def abspath(base, p):
    return p if os.path.isabs(p) else os.path.join(base, p)


def read_raw(path):
    raw = pd.read_excel(path, sheet_name=0, header=None, dtype=object, nrows=30)
    h = next((i for i in range(len(raw)) if raw.iloc[i].notna().sum() >= 5), 0)
    df = pd.read_excel(path, sheet_name=0, header=h, dtype=object)
    df.columns = [str(c).strip() for c in df.columns]
    idc = "Serial Number" if "Serial Number" in df.columns else df.columns[0]
    return df[df[idc].notna()].copy()


def to_str(df):
    def f(v):
        if v is None or (isinstance(v, float) and pd.isna(v)):
            return ""
        if isinstance(v, (dt.datetime, pd.Timestamp)):
            return v.strftime("%Y-%m-%d %H:%M:%S")
        if isinstance(v, float) and v.is_integer():
            return str(int(v))
        return str(v).strip()
    return df.map(f) if hasattr(df, "map") else df.applymap(f)


LOG_COLS = ["文件名", "文件指纹", "导入时间", "原始行数", "新增行数", "重复/更新行数", "异常行数", "业务日范围", "结果"]


def list_input_files(base, raw):
    folder = abspath(base, raw["paths"]["input"])
    os.makedirs(folder, exist_ok=True)
    pat = raw["paths"].get("pattern") or "data*.xlsx"
    return sorted((f for f in glob.glob(os.path.join(folder, pat)) if not os.path.basename(f).startswith("~$")), key=os.path.getmtime)


def file_md5(f):
    h = hashlib.md5()
    with open(f, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def import_data(base, raw, log=print, dry=False, extra_files=None):
    """遍历原表文件夹 → 识别表头 → 去重 → 写入历史库。dry=True 只读不写（面板扫描用）"""
    P = raw["P"]
    hdir = abspath(base, raw["paths"]["history"])
    os.makedirs(hdir, exist_ok=True)
    hp, lp = os.path.join(hdir, "不良历史数据.csv"), os.path.join(hdir, "导入日志.csv")
    hist = pd.read_csv(hp, dtype=str, keep_default_na=False, encoding="utf-8-sig") if os.path.exists(hp) else pd.DataFrame()
    lg = pd.read_csv(lp, dtype=str, keep_default_na=False, encoding="utf-8-sig") if os.path.exists(lp) else pd.DataFrame(columns=LOG_COLS)
    force = yes(P.get("重新导入全部文件"))
    seen = set() if force else set(lg.loc[lg["结果"] == "成功", "文件指纹"])
    files = extra_files or list_input_files(base, raw)
    keys = split_vals(P.get("去重字段"))
    msgs, changed = [], False
    pending_archive = []
    for f in files:
        md5 = file_md5(f)
        if md5 in seen:
            continue
        try:
            rawdf = read_raw(f)
        except Exception as ex:
            msgs.append(f"  [失败] {os.path.basename(f)}：{ex}")
            if not dry:
                lg.loc[len(lg)] = [os.path.basename(f), md5, f"{dt.datetime.now():%Y-%m-%d %H:%M:%S}", 0, 0, 0, 0, "", f"读取失败：{ex}"]
            continue
        s = to_str(rawdf)
        n_raw = len(s)
        if not n_raw:
            msgs.append(f"  [跳过] {os.path.basename(f)}：空表")
            continue
        dcol = next((c for c in ("Work Date", "Report Date") if c in s.columns), None)
        ts = pd.to_datetime(s[dcol], errors="coerce") if dcol else pd.Series(pd.NaT, index=s.index)
        bad = int(ts.isna().sum())
        rng = f"{ts.min():%Y-%m-%d} ~ {ts.max():%Y-%m-%d}" if ts.notna().any() else ""
        s["来源文件"] = os.path.basename(f)
        s["导入时间"] = f"{dt.datetime.now():%Y-%m-%d %H:%M:%S}"
        before = len(hist)
        hist = pd.concat([hist, s], ignore_index=True).fillna("")
        k = [c for c in keys if c in hist.columns] or [c for c in hist.columns if c not in ("来源文件", "导入时间")]
        hist = hist.drop_duplicates(subset=k, keep="last").reset_index(drop=True)
        new_rows = len(hist) - before
        lg.loc[len(lg)] = [os.path.basename(f), md5, s["导入时间"].iloc[0], n_raw, new_rows, n_raw - new_rows, bad, rng, "成功"]
        msgs.append(f"导入 {os.path.basename(f)}：{n_raw} 行 → 新增 {new_rows}，重复/更新 {n_raw - new_rows}，日期异常 {bad}")
        changed = True
        if not dry and yes(P.get("导入后归档原表")) and os.path.dirname(os.path.abspath(f)) == os.path.abspath(abspath(base, raw["paths"]["input"])):
            pending_archive.append(f)
    if not dry and (changed or force):
        # Commit history before its import log. A failed log commit can be retried
        # through deduplication; the reverse order could hide uncommitted data.
        for frame, target in ((hist, hp), (lg, lp)):
            fd, tmp = tempfile.mkstemp(prefix="import_", suffix=".csv", dir=hdir)
            os.close(fd)
            try:
                frame.to_csv(tmp, index=False, encoding="utf-8-sig")
                os.replace(tmp, target)
            finally:
                if os.path.exists(tmp): os.unlink(tmp)
        for f in pending_archive:
            arc = os.path.join(os.path.dirname(f), "已导入")
            os.makedirs(arc, exist_ok=True)
            target = os.path.join(arc, os.path.basename(f))
            if os.path.exists(target):
                stem, ext = os.path.splitext(os.path.basename(f))
                target = os.path.join(arc, stem + dt.datetime.now().strftime("_%Y%m%d_%H%M%S_%f") + ext)
            try: shutil.move(f, target)
            except OSError as ex: msgs.append(f"  [警告] 数据已入库但原表归档失败：{os.path.basename(f)}：{ex}")
    return hist, lg, msgs


def ensure_fieldmap(raw, columns):
    """补全字段映射：新列按默认规则给用途/是否在明细显示，已有的不动"""
    fm = raw.setdefault("fieldmap", {})
    for c in columns:
        if c in ("来源文件", "导入时间"):
            continue
        if c not in fm:
            fm[c] = {"role": ROLE_DEFAULT.get(c, "不使用"), "show": c in SHOW_DEFAULT}
    return raw


def ensure_defects(raw, hist, roles):
    """原表出现的新不良代码 → 追加到不良类型（返回新增数）"""
    dcol, ccol = roles.get("不良代码"), roles.get("不良大类")
    if not dcol or dcol not in hist.columns:
        return 0
    defs = raw.setdefault("defects", {})
    added = 0
    first = not defs
    for code, n in hist[dcol].value_counts().items():
        if not code or code in defs:
            continue
        item = seed_item(code)
        cat = ""
        if ccol and ccol in hist.columns:
            m = hist.loc[hist[dcol] == code, ccol]
            m = m[m != ""]
            cat = m.mode().iloc[0] if len(m) else ""
        groups = (["看板监控"] if item in MONITOR else []) + split_vals(cat)
        defs[code] = {"stat": True, "item": item, "split": item != "物料穿错", "groups": groups, "new": not first}
        added += 1
    return added


# ======================== 标准化 ========================
def build_frame(hist, cfg):
    P, roles = cfg["P"], cfg["roles"]
    A = hist.copy()

    def col(role):
        c = roles.get(role)
        return A[c].astype(str).str.strip() if c and c in A.columns else pd.Series("", index=A.index)
    use = "业务日期" if P["业务日期来源"] == "业务日期" and roles.get("业务日期") else ("记录时间" if roles.get("记录时间") else "业务日期")
    ts = pd.to_datetime(col(use), errors="coerce")
    has_time = ((ts.dt.hour != 0) | (ts.dt.minute != 0)).any()
    m = re.match(r"^\s*(\d{1,2})[:：](\d{2})", P["业务日切换时间"] or "08:00")
    off = pd.Timedelta(hours=int(m.group(1)), minutes=int(m.group(2))) if m else pd.Timedelta(hours=8)
    date = (ts - off).dt.normalize() if use == "记录时间" else ts.dt.normalize()
    bad = int(date.isna().sum())
    A["_date"] = date
    A = A[A["_date"].notna()].copy()
    d = A["_date"]
    A["_day"] = d.dt.strftime("%m/%d")
    iso = d.dt.isocalendar()
    A["_week"] = iso["year"].astype(str) + "-W" + iso["week"].astype(str).str.zfill(2)
    A["_month"] = d.dt.strftime("%Y-%m")
    for k, role in (("_emp", "责任员工"), ("_proc", "责任工序"), ("_step", "责任站点"), ("_code", "不良代码"), ("_cat", "不良大类"), ("_shift", "班别")):
        A[k] = col(role).loc[A.index]
    qc = roles.get("数量")
    if qc and qc in A.columns:
        qty = pd.to_numeric(A[qc], errors="coerce")
        invalid = qty.isna() | (qty < 0) | qty.isin([float("inf"), -float("inf")])
        if invalid.any():
            raise ValueError(f"数量字段【{qc}】有 {int(invalid.sum())} 行为空、非数字或负数；请修正原表，不能自动当作1。")
        A["_qty"] = qty
    else:
        A["_qty"] = 1.0
    pr = A["_code"].str.extract(r"(MPO|MMC|LCD)")[0]
    fb = col("产品类别备用").loc[A.index].str.extract(r"(MPO|MMC|LCD)")[0]
    A["_prod"] = pr.fillna(fb).fillna("其他")
    dm = cfg["defmap"]
    A["_item"] = A["_code"].map(lambda c: dm[c]["item"] if c in dm else seed_item(c))

    def gs(c, cat):
        s = set(dm[c]["groups"]) if c in dm else set()
        return s or ({cat} if cat else set())
    A["_gs"] = [gs(c, k) for c, k in zip(A["_code"], A["_cat"])]
    A["_grp"] = A["_gs"].map(lambda s: next((x for x in sorted(s) if x != "看板监控"), next(iter(sorted(s)), "")))
    A["连接器类型_"] = col("连接器类型").loc[A.index]
    A["产品类型_"] = col("产品类型").loc[A.index]
    return A, bad


def apply_global(A, cfg):
    P = cfg["P"]
    log = []
    for f, op, vals in cfg["rules"]:
        if f not in A.columns:
            log.append(f"  [跳过] 找不到列：{f}")
            continue
        s = A[f].astype(str).str.strip()
        b = len(A)
        if op in ("等于", "属于"):
            m = s.isin(vals)
        elif op in ("不等于", "不属于"):
            m = ~s.isin(vals)
        elif op == "包含":
            m = s.apply(lambda x: any(v in x for v in vals))
        elif op == "不包含":
            m = s.apply(lambda x: not any(v in x for v in vals))
        elif op == "为空":
            m = s.isin(["", "nan", "None"])
        elif op == "不为空":
            m = ~s.isin(["", "nan", "None"])
        else:
            continue
        A = A[m]
        log.append(f"  {f} {op} {'、'.join(vals)}：{b} → {len(A)}")
    for k in split_vals(P["全局排除站点关键字"]):
        b = len(A)
        A = A[~A["_step"].str.contains(k, regex=False)]
        log.append(f"  责任站点 不含 {k}：{b} → {len(A)}")
    if yes(P["剔除责任员工为空"]):
        b = len(A)
        A = A[A["_emp"] != ""]
        log.append(f"  剔除责任员工为空：{b} → {len(A)}")
    if cfg["def_off"]:
        b = len(A)
        A = A[~A["_code"].isin(cfg["def_off"])]
        log.append(f"  不良类型 统计=否（{len(cfg['def_off'])}种）：{b} → {len(A)}")
    mode = P["人员筛选模式"]
    if mode in ("只看名单", "排除名单"):
        b = len(A)
        m = A["_emp"].isin(cfg["people"].keys())
        A = A[m] if mode == "只看名单" else A[~m]
        log.append(f"  人员{mode}（名单 {len(cfg['people'])} 人）：{b} → {len(A)}")
    return A, log


def in_gs(series, mapping, groups):
    g = set(groups)
    return series.map(lambda x: bool(mapping.get(x, set()) & g))


def apply_scheme(A, g, cfg):
    d = A
    if g["procs"]:
        d = d[d["_proc"].isin(g["procs"])]
    for k in g["excl"]:
        d = d[~d["_step"].str.contains(k, regex=False)]
    if g["prod"]:
        d = d[d["_prod"].isin(g["prod"])]
    if g["shift"]:
        d = d[d["_shift"].isin(g["shift"])]
    if g["emp_in"]:
        d = d[in_gs(d["_emp"], cfg["people"], g["emp_in"])]
    if g["emp_out"]:
        d = d[~in_gs(d["_emp"], cfg["people"], g["emp_out"])]
    if g["def_in"]:
        gi = set(g["def_in"])
        d = d[d["_gs"].map(lambda s: bool(s & gi))]
    if g["def_out"]:
        go = set(g["def_out"])
        d = d[~d["_gs"].map(lambda s: bool(s & go))]
    for f, op, vals in g["conds"]:
        if f in d.columns:
            s = d[f].astype(str)
            if op in ("=", "等于", "属于"):
                d = d[s.isin(vals)]
            elif op in ("!=", "不等于", "不属于"):
                d = d[~s.isin(vals)]
            else:
                d = d[s.apply(lambda x: any(v in x for v in vals))]
    return d


def resolve_range(mode, base, p_start, p_end, dmin):
    mode = sval(mode) or "单日"
    base = pd.Timestamp(base).normalize()
    D = pd.Timedelta
    if mode in ("单日", "当日"):
        return base, base
    m = re.match(r"最近(\d+)天", mode)
    if m:
        return base - D(days=int(m.group(1)) - 1), base
    if mode == "本周":
        return base - D(days=base.weekday()), base
    if mode == "上周":
        mon = base - D(days=base.weekday() + 7)
        return mon, mon + D(days=6)
    if mode == "本月":
        return base.replace(day=1), base
    if mode == "上月":
        last = base.replace(day=1) - D(days=1)
        return last.replace(day=1), last
    if mode == "全部历史":
        return dmin, base
    if mode == "自定义":
        s, e = pd.to_datetime(sval(p_start), errors="coerce"), pd.to_datetime(sval(p_end), errors="coerce")
        return (s if pd.notna(s) else base), (e if pd.notna(e) else base)
    return base, base


def in_range(d, s, e):
    return d[(d["_date"] >= s) & (d["_date"] <= e)]


# ======================== 分析计算 ========================
def counts(d, key):
    v = d.groupby(key)["_qty"].sum().sort_values(ascending=False, kind="stable")
    return v[v.index != ""]


def level(n, p, rule):
    if n < num(rule["最少pcs"], 0):
        return 0
    if sval(rule["依据"]) == "pcs":
        v, red, org = n, num(rule["红线"], 1e9), num(rule["橙线"], 1e9)
    else:
        v, red, org = p, pct_val(rule["红线"]), pct_val(rule["橙线"])
    return 2 if v >= red else 1 if v >= org else 0


def rule_text(rule):
    if sval(rule["依据"]) == "pcs":
        return f"红≥{rule['红线']}{U} 橙≥{rule['橙线']}{U}"
    return f"红≥{pct_val(rule['红线']) * 100:g}% 橙≥{pct_val(rule['橙线']) * 100:g}%"


def tparams(P):
    return dict(up_red=int(num(P["连续上升红灯天数"], 3)), up_org=int(num(P["连续上升橙灯天数"], 2)), mult=num(P["明显上升倍数"], 1.5),
                minpcs=num(P["预警最少pcs"], 3), zero=int(num(P["复发判定零天数"], 5)), persist=int(num(P["持续出现天数"], 5)),
                rep_red=int(num(P["重复异常天数红"], 3)), rep_org=int(num(P["重复异常天数橙"], 2)))


def trend_status(v, T):
    """v=按生产日排序的每日pcs（含当日）→ (文字, 颜色, 级别0/1/2)"""
    v = [float(x) for x in v]
    n = len(v)
    if n == 0 or sum(v) == 0:
        return "", "", 0
    cur, hist = v[-1], v[:-1]
    avg7 = (sum(hist[-7:]) / len(hist[-7:])) if hist else 0
    up = 0
    for i in range(n - 1, 0, -1):
        if v[i] > v[i - 1]:
            up += 1
        else:
            break
    down = 0
    for i in range(n - 1, 0, -1):
        if v[i] < v[i - 1]:
            down += 1
        else:
            break
    appear = sum(1 for x in v[-7:] if x > 0)
    if cur > 0 and hist and sum(hist) == 0:
        return "★ 新增", "purple", 1
    if cur > 0 and len(hist) > T["zero"] and sum(hist[-T["zero"]:]) == 0 and sum(hist) > 0:
        return "↺ 复发", "yellow", 1
    if up >= T["up_red"] and cur >= T["minpcs"]:
        return f"↑ 连续上升{up}天", "red", 2
    if hist and cur >= avg7 * T["mult"] and cur >= T["minpcs"] and avg7 > 0:
        return f"↑ 明显上升(均值×{cur / avg7:.1f})", "red", 2
    if up >= T["up_org"] and cur >= 1:
        return f"↑ 连续上升{up}天", "orange", 1
    if appear >= T["persist"] and cur > 0:
        return (f"→ 每日出现({appear}/7天)" if appear >= 7 else f"→ 持续出现{appear}天"), "", 0
    if down >= 3:
        return f"↓ 改善中(连降{down}天)", "green", 0
    return "→ 稳定" if cur > 0 else "", "", 0


def series_by(d, key, days):
    if d.empty:
        return pd.DataFrame(columns=days)
    p = d.pivot_table(index=key, columns="_date", values="_qty", aggfunc="sum", fill_value=0)
    return p.reindex(columns=days, fill_value=0)


def person_stats(d_win, days, cfg, T):
    if d_win.empty:
        return pd.DataFrame()
    rule = cfg["alerts"]["人员"]
    total = d_win["_qty"].sum()
    piv = series_by(d_win, "_emp", days)
    ti = d_win.groupby(["_emp", "_item"])["_qty"].sum().reset_index().sort_values(["_emp", "_qty"], ascending=[True, False]).drop_duplicates("_emp").set_index("_emp")
    tp = d_win.groupby(["_emp", "_proc"])["_qty"].sum().reset_index().sort_values(["_emp", "_qty"], ascending=[True, False]).drop_duplicates("_emp").set_index("_emp")
    last = d_win.groupby("_emp")["_date"].max()
    nit = d_win.groupby("_emp")["_item"].nunique()
    rows = []
    for emp, r in piv.iterrows():
        vals = r.values
        pcs, nd = vals.sum(), int((vals > 0).sum())
        consec = 0
        for x in vals[::-1]:
            if x > 0:
                consec += 1
            else:
                break
        lv_share = level(pcs, pcs / total, rule)
        lv = max(lv_share, 2 if nd >= T["rep_red"] else 1 if nd >= T["rep_org"] else 0)
        rows.append(dict(emp=emp, pcs=pcs, share=pcs / total, days=nd, consec=consec, lv_share=lv_share, items=int(nit.get(emp, 0)),
                         top_item=ti.loc[emp, "_item"], top_item_n=ti.loc[emp, "_qty"], proc=tp.loc[emp, "_proc"], last=last.get(emp),
                         score=pcs + 2 * nd + 3 * consec, level=lv))
    return pd.DataFrame(rows).sort_values(["score", "pcs"], ascending=False).reset_index(drop=True)


def concentration(d, cfg):
    P = cfg["P"]
    hi, mid = pct_val(P["集中度高阈值"], 0.5), pct_val(P["集中度中阈值"], 0.3)
    minp = num(P["预警最少pcs"], 3)
    if d.empty:
        return pd.DataFrame()
    g = d.groupby(["_item", "_emp"])["_qty"].sum().reset_index()
    rows = []
    for item, sub in g.groupby("_item"):
        sub = sub.sort_values("_qty", ascending=False)
        tot, n = sub["_qty"].sum(), len(sub)
        top1, top1n = sub.iloc[0]["_emp"], sub.iloc[0]["_qty"]
        ratio = top1n / tot
        if tot < minp:
            lvl, txt, how = "", "样本少", "pcs较少，继续观察"
        elif ratio >= hi:
            lvl, txt, how = "red", "高度集中", "优先查人员：培训/操作习惯/WOI执行"
        elif ratio >= mid:
            lvl, txt, how = "orange", "中度集中", "人员+工艺并查"
        else:
            lvl, txt, how = "blue", "人员分散", "优先查工艺/物料/治具/设备/WOI"
        rows.append(dict(item=item, pcs=tot, people=n, top1=top1, top1n=top1n, ratio=ratio, lvl=lvl, txt=txt, how=how))
    return pd.DataFrame(rows).sort_values("pcs", ascending=False).reset_index(drop=True)


def health_scores(d, days, cfg, T):
    """工序健康度(100分) = 100 − 50×占比 − 红灯人员×5(≤15) − 重复异常人员×3(≤15) − 趋势恶化(红10/橙5)"""
    if d.empty:
        return pd.DataFrame()
    total = d["_qty"].sum()
    rule = cfg["alerts"]["人员"]
    rows = []
    for proc, sub in d.groupby("_proc"):
        if not proc:
            continue
        pcs = sub["_qty"].sum()
        share = pcs / total
        piv = series_by(sub, "_emp", days)
        nred = nrep = 0
        for emp, r in piv.iterrows():
            v = r.values
            if level(v.sum(), v.sum() / pcs, rule) == 2:
                nred += 1
            if (v > 0).sum() >= T["rep_red"]:
                nrep += 1
        tr = series_by(sub, "_proc", days).iloc[0].values if len(sub) else []
        txt, col, lv = trend_status(list(tr), T)
        pen = 10 if lv == 2 else 5 if col == "orange" else 0
        score = max(0, 100 - 50 * share - min(15, 5 * nred) - min(15, 3 * nrep) - pen)
        rows.append(dict(proc=proc, pcs=pcs, share=share, nred=nred, nrep=nrep, trend=txt, tcol=col, score=score))
    return pd.DataFrame(rows).sort_values("score").reset_index(drop=True)


# ======================== 上下文与公共函数 ========================
def scheme_by_name(cfg, name):
    return next((g for g in cfg["schemes"] if g["name"] == name), None)


def scheme_df(ctx, name):
    if name in ctx["cache"]:
        return ctx["cache"][name]
    g = scheme_by_name(ctx["cfg"], name)
    if g is None:
        ctx["warn"].append(f"找不到（或未启用）筛选方案【{name}】，已改用全部数据——请在面板里检查【驾驶舱设置】或【图表中心】")
        d = ctx["A"]
    else:
        d = apply_scheme(ctx["A"], g, ctx["cfg"])
    d = d[d["_date"] <= ctx["base"]]
    ctx["cache"][name] = d
    return d


def day_lbl(ts):
    return f"{ts.month:02d}/{ts.day:02d}"


def pcsfmt(v):
    return int(v) if float(v).is_integer() else round(float(v), 2)


def matrix_rows(S, days_lb, days_w, cfg, maxrows):
    split, prods = cfg["item_split"], cfg["prods"]
    X = S[S["_date"].isin(days_lb)].copy()
    if X.empty:
        return []
    X["_pl"] = [p if (split.get(i, True) and p != "其他") else "" for i, p in zip(X["_item"], X["_prod"])]
    pv = X.pivot_table(index=["_item", "_pl"], columns="_date", values="_qty", aggfunc="sum", fill_value=0).reindex(columns=days_lb, fill_value=0)
    wt = pv[days_w].sum(axis=1)
    pv, wt = pv[wt > 0], wt[wt > 0]
    item_tot = wt.groupby(level=0).sum().sort_values(ascending=False, kind="stable")
    rows = []
    for item in item_tot.index:
        sub = pv.loc[[item]]
        for (it, pl), vals in sorted(sub.iterrows(), key=lambda kv: prods.index(kv[0][1]) if kv[0][1] in prods else 99):
            rows.append(dict(label=(pl + it) if pl else it, item=it, pl=pl, vals=vals))
    if len(rows) > maxrows:
        rest = rows[maxrows - 1:]
        agg = sum((r["vals"] for r in rest[1:]), rest[0]["vals"])
        rows = rows[:maxrows - 1] + [dict(label="其他项目", item="其他项目", pl="", vals=agg)]
    return rows


def day_key(cur, prev, T):
    if cur <= 0:
        return "green" if (prev or 0) >= 2 else ""
    if prev is None:
        return ""
    if prev <= 0:
        return "purple"
    ch = (cur - prev) / prev
    if ch >= T["m_red"] and cur - prev >= 2:
        return "red"
    if ch >= T["m_org"] and cur - prev >= 1:
        return "orange"
    if ch <= -T["m_grn"]:
        return "green"
    return ""


def rule_for_dim(dim, alerts):
    return alerts["人员"] if dim == "_emp" else alerts["工序"] if dim == "_proc" else alerts["不良大类"] if dim == "_cat" \
        else alerts["班别"] if dim == "_shift" else alerts["不良"]


def kpi_card(ws, c, label, value, sub, key="blue"):
    bg, fg = ST[key]
    fill = PatternFill("solid", start_color=bg)
    for rr, v, f, h in ((5, label, Font(name=FONT, size=9, color="595959"), 18), (6, value, Font(name=FONT, size=20, bold=True, color=fg), 34),
                        (7, sub, Font(name=FONT, size=9, color="595959"), 18)):
        ws.merge_cells(start_row=rr, start_column=c, end_row=rr, end_column=c + 1)
        x = ws.cell(row=rr, column=c, value=v)
        x.font, x.fill = f, fill
        x.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        ws.cell(row=rr, column=c + 1).fill = fill
        ws.row_dimensions[rr].height = h


# ======================== 01 每日驾驶舱 ========================
def write_dashboard(wb, ctx):
    cfg, P, T, DS = ctx["cfg"], ctx["P"], ctx["T"], ctx["DS"]
    ws = wb.create_sheet("01_每日驾驶舱")
    ws.sheet_view.showGridLines = False
    sname = P["看板方案"]
    S = scheme_df(ctx, sname)
    w0, w1 = ctx["win"]
    days_w = [d for d in ctx["days_all"] if w0 <= d <= w1] or [ctx["cur_day"]]
    cur_day = days_w[-1]
    days_lb = sorted(set([d for d in ctx["days_all"] if d <= cur_day][-int(num(P["趋势回看天数"], 30)):]) | set(days_w))
    nd = len(days_w)
    chk, prods, pcol = ctx["chk"], cfg["prods"], cfg["prod_colors"]
    tot_lb = S.groupby("_date")["_qty"].sum().reindex(days_lb, fill_value=0)
    has_chk = any(chk.get(d) for d in days_lb)
    rate_lb = [(tot_lb[d] / chk[d]) if chk.get(d) else None for d in days_lb]
    cur = float(tot_lb[cur_day])
    prev = float(tot_lb.iloc[-2]) if len(tot_lb) > 1 else None
    hist7 = tot_lb.iloc[:-1].tail(7)
    avg7 = float(hist7.mean()) if len(hist7) else 0.0
    cur_rate = (cur / chk[cur_day]) if chk.get(cur_day) else None
    target, warn = pct_val(P["目标不良率"], 0.0015), pct_val(P["预警不良率"], 0.002)

    lvl, reasons = 0, []
    if cur_rate is not None:
        if cur_rate >= warn:
            lvl = 2
            reasons.append(f"不良率 {cur_rate:.2%} ≥ 预警线 {warn:.2%}")
        elif cur_rate >= target:
            lvl = max(lvl, 1)
            reasons.append(f"不良率 {cur_rate:.2%} ≥ 目标线 {target:.2%}")
    if avg7 > 0 and cur >= avg7 * T["mult"] and cur >= T["minpcs"]:
        lvl = 2
        reasons.append(f"当日 {cur:.0f}pcs ≥ 前7日均值 {avg7:.0f}pcs × {T['mult']:g}")
    elif avg7 > 0 and cur >= avg7 * 1.2 and cur >= T["minpcs"]:
        lvl = max(lvl, 1)
        reasons.append(f"当日 {cur:.0f}pcs 高于前7日均值 {avg7:.0f}pcs 的 20% 以上")
    ttxt, tcol, tlv = trend_status(list(tot_lb.values), T)
    if tlv == 2:
        lvl = 2
        reasons.append(f"总量{ttxt[2:]}")
    elif tcol == "orange":
        lvl = max(lvl, 1)
        reasons.append(f"总量{ttxt[2:]}")

    ps = person_stats(in_range(S, w0, w1), days_w, cfg, T)
    n_red = int((ps["lv_share"] == 2).sum()) if len(ps) else 0
    n_rep = int((ps["days"] >= T["rep_red"]).sum()) if len(ps) else 0
    rows = matrix_rows(S, days_lb, days_w, cfg, int(num(P["矩阵最多行数"], 30)))
    for r in rows:
        r["trend"] = trend_status(list(r["vals"].values), T)
    n_tred = sum(1 for r in rows if r["trend"][2] == 2)
    mtd = float(S[(S["_date"] >= cur_day.replace(day=1)) & (S["_date"] <= cur_day)]["_qty"].sum())

    ncol = max(16, nd + 5)
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=ncol)
    x = ws.cell(row=1, column=1, value=f"BK 5F 品质驾驶舱 ｜ 方案：{sname} ｜ 业务日 {cur_day:%Y-%m-%d}（{w0:%m/%d}~{w1:%m/%d}，{nd}个生产日）")
    x.font = Font(name=FONT, bold=True, size=16, color="FFFFFF")
    x.fill = PatternFill("solid", start_color=NAVY)
    x.alignment = Alignment(vertical="center", indent=1)
    ws.row_dimensions[1].height = 32
    ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=ncol)
    x = ws.cell(row=2, column=1, value=f"●  品质状态：{['正常', '注意', '异常'][lvl]}    " + ("；".join(reasons) if reasons else "未触发任何预警线"))
    x.font = Font(name=FONT, bold=True, size=13, color="FFFFFF" if lvl != 1 else "000000")
    x.fill = PatternFill("solid", start_color=["00B050", "FFC000", "C00000"][lvl])
    x.alignment = Alignment(vertical="center", indent=1)
    ws.row_dimensions[2].height = 26
    note = "不良率口径=不良pcs ÷ 面板【每日检查量】" if has_chk else "未填写【每日检查量】，本页只显示pcs与占比，不显示真实不良率"
    ws.cell(row=3, column=1, value=f"{note}｜红灯=任一触发：不良率≥预警线 / 当日≥前7日均值×{T['mult']:g} / 连续上升≥{T['up_red']}天").font = Font(name=FONT, size=9, color="595959")

    dl = None if prev is None else cur - prev
    cards = [
        ("当日不良", f"{cur:.0f}", f"{cur_day:%m/%d} · {U}", ["blue", "yellow", "red"][lvl]),
        ("当日不良率", f"{cur_rate:.2%}" if cur_rate is not None else "—", f"目标{target:.2%} · 预警{warn:.2%}" if cur_rate is not None else "未填检查量",
         "blue" if cur_rate is None else "red" if cur_rate >= warn else "yellow" if cur_rate >= target else "green"),
        ("较前一生产日", f"{dl:+.0f}" if dl is not None else "—", (f"{dl / prev:+.1%}" if prev else "") if dl is not None else "",
         "blue" if dl is None else "red" if (dl > 0 and prev and dl / prev >= 0.3) else "orange" if dl > 0 else "green"),
        ("前7日均值", f"{avg7:.1f}", f"{U}/日", "blue"),
        ("重点人员(占比红)", f"{n_red}", "个人占比/pcs超红线", "red" if n_red else "green"),
        ("重复异常人员", f"{n_rep}", f"窗口内出现≥{T['rep_red']}天", "red" if n_rep else "green"),
        ("趋势红灯项目", f"{n_tred}", "连续上升/明显上升", "red" if n_tred else "green"),
        ("本月累计", f"{mtd:.0f}", f"{cur_day:%Y-%m} 月初至今 · {U}", "blue"),
    ]
    for i, (lb, v, sb, key) in enumerate(cards):
        kpi_card(ws, 1 + 2 * i, lb, v, sb, key)

    r = 9
    section(ws, r, "一、多日趋势矩阵（日期横向 · 不良项目纵向 · 颜色=较前一生产日变化）", ncol)
    hr = r + 1
    hdr(ws, hr, 1, "指标 / 不良项目")
    for j, d in enumerate(days_w):
        hdr(ws, hr, 2 + j, day_lbl(d))
    tc = 2 + nd
    hdr(ws, hr, tc, "合计")
    ws.merge_cells(start_row=hr, start_column=tc + 1, end_row=hr, end_column=tc + 3)
    hdr(ws, hr, tc + 1, "趋势判断")
    for k in (tc + 2, tc + 3):
        hdr(ws, hr, k, None)
    r_chk, r_pcs, r_rate, r_dlt = hr + 1, hr + 2, hr + 3, hr + 4
    i0 = hr + 5
    i1 = i0 + len(rows) - 1
    cell(ws, r_chk, 1, "检查量", bold=True, fill=GREYF)
    cell(ws, r_pcs, 1, "不良数(pcs)", bold=True, fill=TOT)
    cell(ws, r_rate, 1, "不良率", bold=True, fill=GREYF)
    cell(ws, r_dlt, 1, "较前日变化(pcs)", bold=True, fill=GREYF)
    for j, d in enumerate(days_w):
        c = 2 + j
        cl = L(c)
        cell(ws, r_chk, c, chk.get(d), fill=GREYF, fmt="#,##0", center=True)
        cell(ws, r_pcs, c, f"=SUM({cl}{i0}:{cl}{i1})" if rows else 0, bold=True, fill=TOT, center=True)
        cell(ws, r_rate, c, f'=IF(N({cl}{r_chk})=0,"",{cl}{r_pcs}/{cl}{r_chk})', fill=GREYF, fmt="0.00%", center=True)
        if j == 0:
            k0 = days_lb.index(d)
            pv_d = days_lb[k0 - 1] if k0 > 0 else None
            cell(ws, r_dlt, c, (float(tot_lb[d]) - float(tot_lb[pv_d])) if pv_d is not None else None, fill=GREYF, center=True, fmt="+0;-0;0")
        else:
            cell(ws, r_dlt, c, f"={cl}{r_pcs}-{L(c - 1)}{r_pcs}", fill=GREYF, center=True, fmt="+0;-0;0")
    cell(ws, r_chk, tc, f"=SUM(B{r_chk}:{L(tc - 1)}{r_chk})", fill=GREYF, fmt="#,##0", center=True)
    cell(ws, r_pcs, tc, f"=SUM(B{r_pcs}:{L(tc - 1)}{r_pcs})", bold=True, fill=TOT, center=True)
    all_chk = all(chk.get(d) for d in days_w)
    cell(ws, r_rate, tc, f'=IF(N({L(tc)}{r_chk})=0,"",{L(tc)}{r_pcs}/{L(tc)}{r_chk})' if all_chk else "", fill=GREYF, fmt="0.00%", center=True)
    cell(ws, r_dlt, tc, "", fill=GREYF)
    for rr in (r_chk, r_rate, r_dlt):
        ws.merge_cells(start_row=rr, start_column=tc + 1, end_row=rr, end_column=tc + 3)
        cell(ws, rr, tc + 1, "", fill=GREYF)
    ws.merge_cells(start_row=r_pcs, start_column=tc + 1, end_row=r_pcs, end_column=tc + 3)
    stcell(ws, r_pcs, tc + 1, ttxt or "→ 稳定", tcol, bold=True, center=True)
    for i, rw in enumerate(rows):
        rr = i0 + i
        cell(ws, rr, 1, rw["label"])
        vals = rw["vals"]
        for j, d in enumerate(days_w):
            k = days_lb.index(d)
            v = float(vals[d])
            pvv = float(vals[days_lb[k - 1]]) if k > 0 else None
            stcell(ws, rr, 2 + j, pcsfmt(v) if v else 0, day_key(v, pvv, T), center=True)
        cell(ws, rr, tc, f"=SUM(B{rr}:{L(tc - 1)}{rr})", bold=True, center=True)
        ws.merge_cells(start_row=rr, start_column=tc + 1, end_row=rr, end_column=tc + 3)
        txt, col, _ = rw["trend"]
        stcell(ws, rr, tc + 1, txt, col, center=True)
    if not rows:
        cell(ws, i0, 1, "窗口内无数据", color="808080")
    r = (i1 if rows else i0) + 1
    ws.cell(row=r, column=1, value="颜色：红=较前日上升≥%s且≥2pcs  橙=上升≥%s  绿=下降≥%s  紫=新出现(前一日为0)    趋势：★新增 ↺复发 ↑连续上升/明显上升 →持续出现 ↓改善中" %
            (fmt_pct(T["m_red"], 0), fmt_pct(T["m_org"], 0), fmt_pct(T["m_grn"], 0))).font = Font(name=FONT, size=9, color="595959")
    ws.row_dimensions[hr].height = 20

    widths(ws, [20] + [9.5] * 40)
    ANCH = [1, 7, 14]
    state = {"row": r + 2}

    def add_group(title, makers):
        section(ws, state["row"], title, ncol)
        top = state["row"] + 1
        for i, mk in enumerate(makers):
            mk(f"{L(ANCH[i % 3])}{top + (i // 3) * 16}")
        state["row"] = top + ((len(makers) + 2) // 3) * 16 + 1

    DW, DH = 13.2, 7.2
    day_names = [day_lbl(d) for d in days_w]
    ma = []
    for k, d in enumerate(days_lb):
        if d in days_w:
            lo = max(0, k - 6)
            seg = [rate_lb[m] for m in range(lo, k + 1) if rate_lb[m] is not None] if has_chk else [float(tot_lb.iloc[m]) for m in range(lo, k + 1)]
            ma.append(sum(seg) / len(seg) if seg else None)

    def mk_trend(anchor):
        if has_chk:
            rows_ = [[day_names[i], rate_lb[days_lb.index(d)], ma[i], target, warn] for i, d in enumerate(days_w)]
            hr_, r1_ = DS.block("驾驶舱-不良率趋势", ["日期", "不良率", "7日均线", "目标线", "预警线"], rows_, {2: "0.00%", 3: "0.00%", 4: "0.00%", 5: "0.00%"})
            build_chart(ws, anchor, "不良率趋势（含7日均线/目标/预警）", "line", DS.ws, hr_, r1_, 5, DW, DH, colors=["2E75B6", "7F7F7F", "00B050", "C00000"], dash_from=2, pct_axis=True)
        else:
            rows_ = [[day_names[i], float(tot_lb[d]), ma[i]] for i, d in enumerate(days_w)]
            hr_, r1_ = DS.block("驾驶舱-每日不良pcs趋势", ["日期", "不良pcs", "7日均线"], rows_)
            build_chart(ws, anchor, "每日不良pcs趋势（含7日均线）", "line", DS.ws, hr_, r1_, 3, DW, DH, colors=["2E75B6", "7F7F7F"])

    def mk_prod(anchor):
        pv = S[S["_date"].isin(days_w)].pivot_table(index="_date", columns="_prod", values="_qty", aggfunc="sum", fill_value=0).reindex(days_w, fill_value=0)
        cols = [p for p in prods if p in pv.columns] + [p for p in pv.columns if p not in prods and pv[p].sum() > 0]
        rows_ = [[day_names[i]] + [float(pv.loc[d, c]) if c in pv.columns else 0 for c in cols] for i, d in enumerate(days_w)]
        hr_, r1_ = DS.block("驾驶舱-每日不良(按产品类别)", ["日期"] + cols, rows_)
        build_chart(ws, anchor, "每日不良pcs（按产品类别）", "col", DS.ws, hr_, r1_, len(cols) + 1, DW, DH, colors=[pcol.get(c, "A5A5A5") for c in cols])

    def mk_proc(anchor):
        pv = S[S["_date"].isin(days_w)].pivot_table(index="_date", columns="_proc", values="_qty", aggfunc="sum", fill_value=0).reindex(days_w, fill_value=0)
        order = list(pv.sum().sort_values(ascending=False).index)
        top, rest = order[:6], order[6:]
        rows_ = [[day_names[i]] + [float(pv.loc[d, c]) for c in top] + ([float(pv.loc[d, rest].sum())] if rest else []) for i, d in enumerate(days_w)]
        hr_, r1_ = DS.block("驾驶舱-每日不良(按工序堆积)", ["日期"] + top + (["其他"] if rest else []), rows_)
        build_chart(ws, anchor, "每日不良pcs（按工序堆积）", "stack", DS.ws, hr_, r1_, len(top) + (1 if rest else 0) + 1, DW, DH)

    item_w = in_range(S, w0, w1).groupby("_item")["_qty"].sum().sort_values(ascending=False)

    def mk_top5(anchor):
        ti = list(item_w.index[:5])
        pv = S[S["_date"].isin(days_w) & S["_item"].isin(ti)].pivot_table(index="_date", columns="_item", values="_qty", aggfunc="sum", fill_value=0).reindex(days_w, fill_value=0)
        rows_ = [[day_names[i]] + [float(pv.loc[d, c]) if c in pv.columns else 0 for c in ti] for i, d in enumerate(days_w)]
        hr_, r1_ = DS.block("驾驶舱-TOP5不良项目每日趋势", ["日期"] + ti, rows_)
        build_chart(ws, anchor, "TOP5 不良项目每日趋势", "line", DS.ws, hr_, r1_, len(ti) + 1, DW, DH, no_labels=True)

    def mk_pie(anchor):
        top, rest = item_w.head(6), item_w.iloc[6:].sum()
        names = list(top.index) + (["其他"] if rest > 0 else [])
        vals = [float(v) for v in top.values] + ([float(rest)] if rest > 0 else [])
        tt = sum(vals) or 1
        hr_, r1_ = DS.block("驾驶舱-不良项目占比", ["不良项目", "pcs"], [[n, v] for n, v in zip(names, vals)])
        build_chart(ws, anchor, f"不良项目占比（{nd}个生产日）", "pie", DS.ws, hr_, r1_, 2, DW, DH, labels=[f"{int(v)}{U} | {v / tt:.1%}" for v in vals])

    def mk_pareto(anchor):
        t = item_w.head(10)
        tt = float(item_w.sum()) or 1
        cum, rows_ = 0, []
        for n, v in t.items():
            cum += float(v)
            rows_.append([n, float(v), cum / tt])
        hr_, r1_ = DS.block("驾驶舱-不良项目帕累托", ["不良项目", "pcs", "累计占比"], rows_, {3: "0%"})
        build_chart(ws, anchor, "不良项目帕累托（柱=pcs 线=累计占比）", "pareto", DS.ws, hr_, r1_, 3, DW, DH, colors=["2E75B6", "C00000"], rot=-2700000)

    add_group("二、趋势图", [mk_trend, mk_prod, mk_proc, mk_top5, mk_pie, mk_pareto])

    items = split_vals(P["专项不良项目"])
    pr_days = [cur_day] if P["专项图统计范围"] == "当日" else days_w
    Sp = S[S["_date"].isin(pr_days)]
    topn = int(num(P["专项图人员TOP"], 12))

    def mk_person(item):
        def f(anchor):
            sub = Sp[Sp["_item"] == item]
            tot = float(sub["_qty"].sum())
            if sub.empty:
                ws[anchor].value = f"{item}：{'当日' if len(pr_days) == 1 else '窗口内'}无数据"
                ws[anchor].font = Font(name=FONT, color="808080")
                return
            pv = sub.pivot_table(index="_emp", columns="_prod", values="_qty", aggfunc="sum", fill_value=0)
            cols = [p for p in prods if p in pv.columns] + [p for p in pv.columns if p not in prods]
            pv = pv[cols]
            pv = pv.loc[pv.sum(axis=1).sort_values(ascending=False, kind="stable").index].head(topn)
            rows_ = [[e] + [float(v) if v else None for v in rr] for e, rr in pv.iterrows()]
            hr_, r1_ = DS.block(f"驾驶舱-专项-{item}", ["责任人"] + cols, rows_)
            if len(pr_days) == 1:
                k0 = days_lb.index(cur_day)
                pv_d = days_lb[k0 - 1] if k0 > 0 else None
                ptot = float(S[(S["_date"] == pv_d) & (S["_item"] == item)]["_qty"].sum()) if pv_d is not None else 0
                chg = f"｜较前日{(tot - ptot) / ptot:+.0%}" if ptot > 0 else ("｜前日无" if pv_d is not None else "")
                title = f"{item}｜{cur_day:%m/%d} {tot:.0f}{U}{chg}"
            else:
                title = f"{item}｜近{nd}个生产日 {tot:.0f}{U}"
            build_chart(ws, anchor, title, "col", DS.ws, hr_, r1_, len(cols) + 1, DW, DH, colors=[pcol.get(c, "A5A5A5") for c in cols], rot=-2700000)
        return f
    if items:
        add_group(f"三、专项不良责任人分布（{'当日' if len(pr_days) == 1 else '窗口'} · TOP{topn} · 按产品类别分色）", [mk_person(i) for i in items])
    extra = [c for c in cfg["charts"] if c["页面"] == "每日驾驶舱"]
    if extra:
        add_group("四、自定义图表（来自面板【图表中心】）", [(lambda sp: (lambda anchor: custom_chart(ctx, ws, anchor, sp, DW, DH)))(sp) for sp in extra])
    ctx["dash"] = dict(cur=cur, rate=cur_rate, lvl=lvl, reasons=reasons, n_red=n_red, n_rep=n_rep, n_tred=n_tred, rows=rows, cur_day=cur_day, days_w=days_w, days_lb=days_lb, tot_lb=tot_lb)


# ======================== 02 趋势分析 ========================
def write_trend(wb, ctx):
    cfg, P, T, DS = ctx["cfg"], ctx["P"], ctx["T"], ctx["DS"]
    ws = wb.create_sheet("02_趋势分析")
    ws.sheet_view.showGridLines = False
    dd = ctx["dash"]
    S = scheme_df(ctx, P["看板方案"])
    days_w, days_lb, cur_day, chk = dd["days_w"], dd["days_lb"], dd["cur_day"], ctx["chk"]
    w0, w1 = ctx["win"]
    has_chk = any(chk.get(d) for d in days_w)
    ws.cell(row=1, column=1, value=f"趋势分析 ｜ 方案：{P['看板方案']} ｜ {days_w[0]:%m/%d}~{days_w[-1]:%m/%d}").font = Font(name=FONT, bold=True, size=16, color=NAVY)
    tot = S.groupby("_date")["_qty"].sum().reindex(days_lb, fill_value=0)

    r = 3
    section(ws, r, "一、每日汇总与状态", 10)
    for j, h in enumerate(["业务日", "检查量", "不良pcs", "不良率", "较前日(pcs)", "较前日%", "7日均线(pcs)", "状态"], 1):
        hdr(ws, r + 1, j, h)
    r0 = r + 2
    for i, d in enumerate(days_w):
        rr = r0 + i
        k = days_lb.index(d)
        pv = float(tot.iloc[k - 1]) if k > 0 else None
        seg = tot.iloc[max(0, k - 6):k + 1]
        txt, col, _ = trend_status(list(tot.iloc[:k + 1].values), T)
        cell(ws, rr, 1, f"{d:%Y-%m-%d}", center=True)
        cell(ws, rr, 2, chk.get(d), fmt="#,##0", center=True)
        cell(ws, rr, 3, float(tot[d]), center=True, bold=True)
        cell(ws, rr, 4, f'=IF(N(B{rr})=0,"",C{rr}/B{rr})', fmt="0.00%", center=True)
        cell(ws, rr, 5, f"=C{rr}-C{rr - 1}" if i else (float(tot[d]) - pv if pv is not None else None), fmt="+0;-0;0", center=True)
        cell(ws, rr, 6, f'=IF(N(C{rr - 1})=0,"",E{rr}/C{rr - 1})' if i else (((float(tot[d]) - pv) / pv) if pv else None), fmt="+0.0%;-0.0%;0.0%", center=True)
        cell(ws, rr, 7, float(seg.mean()), fmt="0.0", center=True)
        stcell(ws, rr, 8, txt, col, center=True)
    r1 = r0 + len(days_w) - 1
    databar(ws, f"C{r0}:C{r1}", "5B9BD5")
    rows_ = [[day_lbl(d), float(tot[d]), (float(tot[d]) / chk[d]) if chk.get(d) else None] for d in days_w]
    if has_chk:
        hr_, b1 = DS.block("趋势-每日汇总", ["日期", "不良pcs", "不良率"], rows_, {3: "0.00%"})
        build_chart(ws, "J3", "每日不良pcs与不良率", "combo", DS.ws, hr_, b1, 3, 15, 7.5, colors=["9DC3E6", "C00000"])
    else:
        hr_, b1 = DS.block("趋势-每日汇总", ["日期", "不良pcs"], [x[:2] for x in rows_])
        build_chart(ws, "J3", "每日不良pcs", "col", DS.ws, hr_, b1, 2, 15, 7.5)
    r = max(r1 + 2, 3 + 17) + 1

    section(ws, r, "二、项目趋势预警（新增 / 复发 / 连续上升 / 明显上升 / 持续出现 / 改善中）", 10)
    for j, h in enumerate(["不良项目", "当日", "前一日", "前7日均值", "变化", "近7日出现天数", "趋势状态", "说明"], 1):
        hdr(ws, r + 1, j, h)
    rows = matrix_rows(S, days_lb, days_w, cfg, 60)
    lst = []
    for rw in rows:
        v = [float(x) for x in rw["vals"].values]
        txt, col, lv = trend_status(v, T)
        if txt or v[-1] > 0:
            lst.append((lv, v[-1], rw, v, txt, col))
    lst.sort(key=lambda x: (-x[0], 0 if x[5] == "orange" else 1, -x[1]))
    rr = r + 2
    for lv, cur, rw, v, txt, col in lst[:40]:
        hist7 = v[:-1][-7:]
        avg = sum(hist7) / len(hist7) if hist7 else 0
        cell(ws, rr, 1, rw["label"])
        cell(ws, rr, 2, cur, center=True, bold=True)
        cell(ws, rr, 3, v[-2] if len(v) > 1 else None, center=True)
        cell(ws, rr, 4, avg, fmt="0.0", center=True)
        cell(ws, rr, 5, f"=B{rr}-C{rr}" if len(v) > 1 else None, fmt="+0;-0;0", center=True)
        cell(ws, rr, 6, sum(1 for x in v[-7:] if x > 0), center=True)
        stcell(ws, rr, 7, txt, col, center=True)
        sug = {"red": "优先排查：对照WOI/工艺/物料/人员变化", "orange": "持续观察，必要时现场确认", "purple": "首次出现：确认是否新物料/新机种/新人员",
               "yellow": "已沉寂后再出现：核对改善措施是否失效", "green": "改善措施有效，继续保持"}.get(col, "")
        cell(ws, rr, 8, sug, color="595959")
        rr += 1
    if rr == r + 2:
        cell(ws, rr, 1, "窗口内无趋势预警", color="808080")
        rr += 1
    r = rr + 1

    Sw = in_range(S, w0, w1)
    ps = person_stats(Sw, days_w, cfg, T)
    section(ws, r, f"三、人员重复异常（窗口 {len(days_w)} 个生产日；红=出现≥{T['rep_red']}天或占比超红线，橙=出现≥{T['rep_org']}天）", 11)
    for j, h in enumerate(["排名", "责任员工", "窗口pcs", "占比", "出现天数", "当前连续天数", "涉及项目数", "主要不良项目", "主要工序", "最近发生", "风险分", "等级"], 1):
        hdr(ws, r + 1, j, h)
    rr = r + 2
    for i, p in ps.head(30).iterrows():
        key = ["", "orange", "red"][int(p["level"])]
        for j, v in enumerate([i + 1, p["emp"], p["pcs"], p["share"], p["days"], p["consec"], p["items"], f"{p['top_item']}({p['top_item_n']:.0f})", p["proc"],
                               f"{p['last']:%m/%d}" if pd.notna(p["last"]) else "", p["score"], ("", "● 关注", "● 重点")[int(p["level"])]], 1):
            stcell(ws, rr, j, v, key, center=j not in (2, 8, 9), fmt="0.0%" if j == 4 else None)
        rr += 1
    if ps.empty:
        cell(ws, rr, 1, "无数据", color="808080")
    r = rr + 1

    section(ws, r, "四、工序每日趋势（颜色越红越多）", 3 + len(days_w))
    hdr(ws, r + 1, 1, "责任工序")
    for j, d in enumerate(days_w):
        hdr(ws, r + 1, 2 + j, day_lbl(d))
    hdr(ws, r + 1, 2 + len(days_w), "合计")
    hdr(ws, r + 1, 3 + len(days_w), "趋势")
    pv = series_by(S[S["_date"].isin(days_lb)], "_proc", days_lb)
    pv = pv[pv.index != ""]
    pv = pv.loc[pv[days_w].sum(axis=1).sort_values(ascending=False).index]
    rr = r + 2
    for proc, row in pv.iterrows():
        if row[days_w].sum() == 0:
            continue
        cell(ws, rr, 1, proc)
        for j, d in enumerate(days_w):
            cell(ws, rr, 2 + j, float(row[d]) or 0, center=True)
        cell(ws, rr, 2 + len(days_w), f"=SUM(B{rr}:{L(1 + len(days_w))}{rr})", bold=True, center=True)
        txt, col, _ = trend_status(list(row.values), T)
        stcell(ws, rr, 3 + len(days_w), txt, col, center=True)
        rr += 1
    if rr > r + 2:
        heat(ws, f"B{r + 2}:{L(1 + len(days_w))}{rr - 1}")
    widths(ws, [24, 12, 10, 10, 10, 11, 22, 34, 12, 10, 9, 9])


# ======================== 小工具 ========================
def put_row(ws, rr, vals, key="", left=(), fmts=None, fill=None, bold_cols=()):
    for j, v in enumerate(vals, 1):
        kw = dict(center=j not in left, fmt=(fmts or {}).get(j), bold=j in bold_cols)
        if key:
            stcell(ws, rr, j, v, key, **kw)
        else:
            cell(ws, rr, j, v, fill=fill, **kw)


def heads(ws, r, hs):
    for j, h in enumerate(hs, 1):
        hdr(ws, r, j, h)


# ======================== 自定义图表（面板【图表中心】）========================
KINDS = {"横向条形图": "bar", "柱形图": "col", "堆积柱形图": "stack", "百分比堆积柱形图": "pstack", "堆积条形图": "sbar",
         "折线图": "line", "柱线组合图": "combo", "帕累托图": "pareto", "饼图": "pie", "圆环图": "donut", "直方图": "hist", "热力图": "heat"}
DIMCOL = {"责任员工": "_emp", "责任工序": "_proc", "责任站点": "_step", "不良代码": "_code", "标准不良项目": "_item", "不良项目": "_item",
          "不良大类": "_cat", "不良组": "_grp", "班别": "_shift", "产品类别": "_prod", "业务日期": "_date", "业务周": "_week",
          "业务月": "_month", "连接器类型": "连接器类型_", "产品类型": "产品类型_"}
DATE_DIMS = ("_date", "_week", "_month")


def dim_col(name, d):
    return DIMCOL.get(name) or (name if name in d.columns else None)


def custom_data(ctx, sp):
    cfg, P = ctx["cfg"], ctx["P"]
    kind = KINDS.get(sp["图表类型"])
    d = scheme_df(ctx, sp["数据方案"] or "全部工序")
    rng = sp["日期范围"] or P["分析窗口"]
    s, e = resolve_range(rng, ctx["base"], P["自定义开始日期"], P["自定义结束日期"], ctx["days_all"][0])
    d = in_range(d, s, e)
    cat, ser = dim_col(sp["分类字段"], d), (dim_col(sp["系列字段"], d) if sp["系列字段"] else None)
    info = f"方案={sp['数据方案'] or '全部工序'}｜{s:%m/%d}~{e:%m/%d}"
    if cat is None:
        return dict(err=f"找不到分类字段【{sp['分类字段']}】")
    if d.empty:
        return dict(err="所选方案/日期范围内无数据")
    metric = sp["指标"] or "pcs"
    top = int(num(sp["TOP"], 15)) or 15
    order = sp["排序"] or "降序"
    isdate = cat in DATE_DIMS

    def agg(keys):
        return d.groupby(keys)["_emp"].nunique() if metric == "人数" else d.groupby(keys)["_qty"].sum()

    def lab(idx):
        return [f"{x:%m/%d}" if isinstance(x, pd.Timestamp) else str(x) for x in idx]
    out = dict(kind=kind, info=info, title=sp["图表标题"] or sp["图表类型"], rule=rule_for_dim(cat, cfg["alerts"]), levels=None, labels=None)
    if kind == "hist":
        ent = d.groupby(cat)["_qty"].sum()
        bins = [(1, 1, "1pcs"), (2, 2, "2pcs"), (3, 4, "3-4pcs"), (5, 9, "5-9pcs"), (10, 1e9, "10pcs以上")]
        out.update(kind="hist", header=[f"{sp['分类字段']}不良pcs区间", f"{sp['分类字段']}数"], rows=[[n, int(((ent >= lo) & (ent <= hi)).sum())] for lo, hi, n in bins], fmts={})
        return out
    if kind == "heat" or (ser and kind in ("col", "stack", "pstack", "sbar", "line", "bar")):
        pv = agg([cat, ser]).unstack(fill_value=0)
        if metric == "占比":
            pv = pv / pv.values.sum()
        if isdate or order == "日期":
            pv = pv.sort_index()
            pv = pv.tail(top) if isdate else pv.head(top)
        else:
            pv = pv.loc[pv.sum(axis=1).sort_values(ascending=(order == "升序"), kind="stable").index].head(top)
        prods = cfg["prods"]
        cols = [p for p in prods if p in pv.columns] + sorted([c for c in pv.columns if c not in prods], key=lambda c: -pv[c].sum())
        if kind != "heat" and len(cols) > 8:
            keep = cols[:7]
            pv = pv[keep].assign(其他=pv[cols[7:]].sum(axis=1))
            cols = keep + ["其他"]
        pv = pv[cols] if kind != "heat" else pv[cols[:15]]
        out.update(header=[sp["分类字段"]] + list(pv.columns), rows=[[lb] + [(float(v) if (v or kind in ("heat", "line")) else None) for v in r] for lb, r in zip(lab(pv.index), pv.values)],
                   fmts={j: "0.0%" for j in range(2, len(pv.columns) + 2)} if metric == "占比" else {},
                   colors=[cfg["prod_colors"].get(c, PALETTE[i % len(PALETTE)]) for i, c in enumerate(pv.columns)] if ser == "_prod" else None, pv=pv)
        return out
    v = agg(cat)
    if kind == "combo" and isdate and any(ctx["chk"].get(x) for x in v.index):
        v = v.sort_index().tail(top)
        out.update(header=[sp["分类字段"], "不良pcs", "不良率"], kind="combo", fmts={3: "0.00%"},
                   rows=[[lb, float(x), (float(x) / ctx["chk"][i]) if ctx["chk"].get(i) else None] for lb, x, i in zip(lab(v.index), v.values, v.index)])
        return out
    if kind == "combo":
        out["kind"] = kind = "col"
    if metric == "不良率":
        if isdate and any(ctx["chk"].get(x) for x in v.index):
            v = pd.Series({i: x / ctx["chk"][i] for i, x in v.items() if ctx["chk"].get(i)})
        else:
            out["note"] = "不良率需要：分类=业务日期 且 已填【每日检查量】，已改用pcs"
            metric = "pcs"
    tot = float(v.sum()) or 1
    if isdate or order == "日期":
        v = v.sort_index().tail(top) if isdate else v.sort_index().head(top)
    else:
        v = v.sort_values(ascending=(order == "升序"), kind="stable")
        v = v[v.index != ""]
    if kind in ("pie", "donut"):
        vv = v.sort_values(ascending=False)
        rest = float(vv.iloc[top:].sum())
        v = vv.head(top)
        names = lab(v.index) + (["其他"] if rest > 0 else [])
        vals = [float(x) for x in v.values] + ([rest] if rest > 0 else [])
        out.update(header=[sp["分类字段"], metric], rows=[[n, x] for n, x in zip(names, vals)], fmts={},
                   labels=[f"{x:.0f}{U} | {x / tot:.1%}" if metric == "pcs" else f"{x:.2f}" for x in vals])
        return out
    if kind == "pareto":
        v = v.sort_values(ascending=False).head(top)
        cum, rows = 0, []
        for n, x in zip(lab(v.index), v.values):
            cum += float(x)
            rows.append([n, float(x), cum / tot])
        out.update(header=[sp["分类字段"], metric, "累计占比"], rows=rows, fmts={3: "0%"})
        return out
    v = v.head(top) if not isdate else v
    vals = [float(x) for x in v.values]
    if metric == "占比":
        vals = [x / tot for x in vals]
    out.update(header=[sp["分类字段"], metric if metric != "pcs" else "不良pcs"], rows=[[n, x] for n, x in zip(lab(v.index), vals)], fmts={2: "0.0%" if metric in ("占比", "不良率") else "0"})
    if kind in ("bar", "col") and metric == "pcs":
        out["levels"] = [level(x, x / tot, out["rule"]) for x in vals]
        out["labels"] = [f"{x:.0f}{U} | {x / tot:.1%}" for x in vals]
    return out


def write_heat(ws, r, title, header, rows, c0=1):
    section(ws, r, title, len(header) + 1, c0)
    for j, h in enumerate(header):
        hdr(ws, r + 1, c0 + j, h)
    for i, row in enumerate(rows):
        for j, v in enumerate(row):
            cell(ws, r + 2 + i, c0 + j, v, center=j > 0, fmt="0.0%" if isinstance(v, float) and v < 1 and not float(v).is_integer() else None)
    if rows:
        heat(ws, f"{L(c0 + 1)}{r + 2}:{L(c0 + len(header) - 1)}{r + 1 + len(rows)}")
    return len(rows) + 3


def custom_chart(ctx, ws, anchor, sp, w, h):
    res = custom_data(ctx, sp)
    if "err" in res or res["kind"] == "heat":
        ws[anchor].value = f"【{sp['图表标题']}】" + (res.get("err") or "热力图只能放在【自定义图表】页")
        ws[anchor].font = Font(name=FONT, color="C00000")
        return
    DS = ctx["DS"]
    hr, r1 = DS.block(f"自定义-{res['title']}（{res['info']}）", res["header"], res["rows"], res["fmts"])
    n = len(res["header"])
    kind = res["kind"]
    build_chart(ws, anchor, res["title"], kind, DS.ws, hr, r1, n, w, h, levels=res["levels"], rule=res["rule"], labels=res["labels"], colors=res.get("colors"),
                pct_axis=bool(res["fmts"].get(2)) and kind in ("col", "line"), rot=-2700000 if kind in ("col", "stack", "hist", "pareto") and r1 - hr > 6 else None)


def write_custom_page(wb, ctx):
    ws = wb.create_sheet("06_自定义图表")
    ws.sheet_view.showGridLines = False
    ws.cell(row=1, column=1, value="自定义图表（由面板【图表中心】驱动：选方案 / 分类 / 系列 / 指标 / 图表类型）").font = Font(name=FONT, bold=True, size=16, color=NAVY)
    specs = [c for c in ctx["cfg"]["charts"] if c["页面"] != "每日驾驶舱"]
    if not specs:
        ws["A3"] = "面板【图表中心】里没有启用的图表"
    r, slot = 3, 0
    W_, H_ = 16.5, 8.5
    for sp in specs:
        if KINDS.get(sp["图表类型"]) == "heat":
            if slot:
                r += 18
                slot = 0
            res = custom_data(ctx, sp)
            if "err" in res:
                ws.cell(row=r, column=1, value=f"【{sp['图表标题']}】{res['err']}").font = Font(name=FONT, color="C00000")
                r += 2
                continue
            r += write_heat(ws, r, f"{res['title']}（{res['info']}）", res["header"], res["rows"]) + 1
            continue
        custom_chart(ctx, ws, f"{L(1 if slot == 0 else 11)}{r}", sp, W_, H_)
        slot += 1
        if slot == 2:
            slot, r = 0, r + 18
    widths(ws, [9] * 30)


# ======================== 03 月度分析 ========================
def write_monthly(wb, ctx):
    cfg, P, T, DS = ctx["cfg"], ctx["P"], ctx["T"], ctx["DS"]
    ws = wb.create_sheet("03_月度分析")
    ws.sheet_view.showGridLines = False
    SM = scheme_df(ctx, P["月度风险方案"])
    SD = scheme_df(ctx, P["看板方案"])
    cur_day, chk = ctx["dash"]["cur_day"], ctx["chk"]
    D = pd.Timedelta
    m0 = cur_day.replace(day=1)
    pm_last = m0 - D(days=1)
    pm0 = pm_last.replace(day=1)
    pm_end = min(pm0 + D(days=cur_day.day - 1), pm_last)
    this, ps_, pf = in_range(SM, m0, cur_day), in_range(SM, pm0, pm_end), in_range(SM, pm0, pm_last)
    thisD, psD, pfD = in_range(SD, m0, cur_day), in_range(SD, pm0, pm_end), in_range(SD, pm0, pm_last)
    warn = pct_val(P["预警不良率"], 0.002)
    ws.cell(row=1, column=1, value=f"月度分析 ｜ {cur_day:%Y年%m月}（{m0:%m/%d}~{cur_day:%m/%d}）vs 上月同期（{pm0:%m/%d}~{pm_end:%m/%d}）｜方案：{P['月度风险方案']}").font = Font(name=FONT, bold=True, size=16, color=NAVY)
    if this.empty:
        ws["A3"] = "本月暂无数据"
        return
    no_prev = pf.empty
    if no_prev:
        ws.cell(row=2, column=1, value="提示：历史库里没有上月数据，上月对比列暂为空（积累到上月数据后自动出现）").font = Font(name=FONT, size=10, color="C00000")

    def metrics(df):
        if df.empty:
            return dict(pcs=None, nd=None, avg=None, ppl=None, items=None, abn=None, rep=None)
        daily = df.groupby("_date")["_qty"].sum()
        mean = daily.mean()
        abn = sum(1 for d, v in daily.items() if v >= mean * T["mult"])
        rep = int((df.groupby("_emp")["_date"].nunique() >= T["rep_red"]).sum())
        return dict(pcs=float(daily.sum()), nd=len(daily), avg=float(mean), ppl=df["_emp"].nunique(), items=df["_item"].nunique(), abn=abn, rep=rep)

    def rate_of(df):
        if df.empty:
            return None
        daily = df.groupby("_date")["_qty"].sum()
        has = [d for d in daily.index if chk.get(d)]
        return (sum(daily[d] for d in has) / sum(chk[d] for d in has)) if has else None
    a, b, c = metrics(this), metrics(ps_), metrics(pf)
    a["rate"], b["rate"], c["rate"] = rate_of(thisD), rate_of(psD), rate_of(pfD)
    new_items = sorted(set(this["_item"]) - set(pf["_item"])) if not pf.empty else []
    r = 3
    section(ws, r, "一、月度核心指标对比（红=恶化 绿=改善，变化≥±10%判定）", 8)
    heads(ws, r + 1, ["指标", "本月累计", "上月同期", "上月全月", "较上月同期", "变化%", "状态", "说明"])
    spec = [("不良pcs", "pcs", "0", True), ("生产日数", "nd", "0", False), ("日均不良pcs", "avg", "0.0", True), ("不良率（看板方案口径）", "rate", "0.00%", True),
            ("涉及人数", "ppl", "0", True), ("涉及不良项目数", "items", "0", True), ("异常天数", "abn", "0", True), ("重复异常人员数", "rep", "0", True)]
    notes = {"rate": f"看板方案pcs ÷ 每日检查量（方案：{P['看板方案']}）", "abn": f"日pcs ≥ 月内日均×{T['mult']:g} 的天数", "rep": f"月内出现≥{T['rep_red']}天的人员"}
    rr = r + 2
    for name, k, f, judge in spec:
        va, vb, vc = a[k], b[k], c[k]
        cell(ws, rr, 1, name, bold=True)
        for j, v in enumerate([va, vb, vc], 2):
            cell(ws, rr, j, v, fmt=f, center=True)
        cell(ws, rr, 5, f'=IF(OR(B{rr}="",C{rr}=""),"",B{rr}-C{rr})', fmt=("+0.00%;-0.00%" if k == "rate" else "+0.0;-0.0;0"), center=True)
        cell(ws, rr, 6, f'=IF(OR(N(C{rr})=0,B{rr}=""),"",(B{rr}-C{rr})/C{rr})', fmt="+0.0%;-0.0%;0.0%", center=True)
        st, key = "", ""
        if judge and vb and va is not None:
            ch = (va - vb) / vb if vb else 0
            st, key = ("恶化", "red") if ch >= 0.1 else ("改善", "green") if ch <= -0.1 else ("持平", "")
        elif judge and vb is None:
            st = "无上月数据"
        stcell(ws, rr, 7, st, key, center=True)
        cell(ws, rr, 8, notes.get(k, ""), color="595959")
        rr += 1
    cell(ws, rr, 1, "本月新增不良项目", bold=True)
    ws.merge_cells(start_row=rr, start_column=2, end_row=rr, end_column=8)
    stcell(ws, rr, 2, ("、".join(new_items) if new_items else ("上月无数据，无法判断" if no_prev else "无（上月全月均已出现）")), "purple" if new_items else "")
    r = rr + 3

    section(ws, r, "二、自然周汇总（月内截取，月初月末可能为不完整周）", 8)
    heads(ws, r + 1, ["周次", "生产日数", "不良pcs", "日均pcs", "看板方案pcs", "检查量", "不良率", "较上周"])
    rows_w, rr, prev_v = [], r + 2, None
    for wname in sorted(this["_week"].unique()):
        g = this[this["_week"] == wname]
        gd = thisD[thisD["_week"] == wname]
        daily = g.groupby("_date")["_qty"].sum()
        dd_ = gd.groupby("_date")["_qty"].sum()
        has = [d for d in daily.index if chk.get(d)]
        cs = sum(chk[d] for d in has)
        pc = float(daily.sum())
        dpc = float(sum(dd_.get(d, 0) for d in has))
        rate = (dpc / cs) if cs else None
        put_row(ws, rr, [wname, len(daily), pc, f"=C{rr}/B{rr}", float(dd_.sum()), cs or None, rate, (pc - prev_v) if prev_v is not None else None], fmts={4: "0.0", 6: "#,##0", 7: "0.00%", 8: "+0;-0;0"})
        rows_w.append([wname, float(dd_.sum()), rate])
        prev_v = pc
        rr += 1
    if any(x[2] is not None for x in rows_w):
        hr_, r1_ = DS.block("月度-每周汇总", ["周次", "看板方案pcs", "不良率"], rows_w, {3: "0.00%"})
        build_chart(ws, f"K{r}", "每周看板方案不良pcs与不良率", "combo", DS.ws, hr_, r1_, 3, 15, 7.2, colors=["9DC3E6", "C00000"])
    else:
        hr_, r1_ = DS.block("月度-每周汇总", ["周次", "不良pcs"], [[x[0], x[1]] for x in rows_w])
        build_chart(ws, f"K{r}", "每周不良pcs", "col", DS.ws, hr_, r1_, 2, 15, 7.2)
    r = max(rr, r + rows_for(7.2)) + 2

    section(ws, r, "三、不良项目帕累托（累计≤80%=主要改善对象）", 7)
    heads(ws, r + 1, ["排名", "标准不良项目", "不良pcs", "占比", "累计占比", "上月同期", "主要改善对象"])
    it = counts(this, "_item")
    tot = float(it.sum())
    pit = counts(ps_, "_item")
    cum, rr, prow = 0.0, r + 2, []
    for i, (n, v) in enumerate(it.head(15).items()):
        before = cum / tot
        cum += float(v)
        major = before < 0.8
        put_row(ws, rr, [i + 1, n, float(v), f"=C{rr}/{tot}", f"=SUM($D${r + 2}:D{rr})", None if ps_.empty else float(pit.get(n, 0)), "● 主要" if major else ""],
                key="orange" if major else "", left=(2,), fmts={4: "0.0%", 5: "0.0%"})
        prow.append([n, float(v), cum / tot])
        rr += 1
    hr_, r1_ = DS.block("月度-帕累托", ["不良项目", "pcs", "累计占比"], prow[:12], {3: "0%"})
    build_chart(ws, f"K{r}", "不良项目帕累托（本月）", "pareto", DS.ws, hr_, r1_, 3, 15, 7.5, colors=["2E75B6", "C00000"], rot=-2700000)
    r = max(rr, r + rows_for(7.5)) + 2

    section(ws, r, "四、本月 vs 上月同期（TOP10项目）", 6)
    heads(ws, r + 1, ["标准不良项目", "本月", "上月同期", "变化", "变化%", "状态"])
    rr, crow = r + 2, []
    for n, v in it.head(10).items():
        pv_ = float(pit.get(n, 0))
        ch = (v - pv_) / pv_ if pv_ else None
        key = "" if ps_.empty else "purple" if not pv_ else "red" if ch >= 0.3 else "green" if ch <= -0.3 else ""
        stt = "无上月数据" if ps_.empty else "新增" if not pv_ else ("上升" if ch >= 0.3 else "下降" if ch <= -0.3 else "持平")
        put_row(ws, rr, [n, float(v), None if ps_.empty else pv_, None if ps_.empty else f"=B{rr}-C{rr}", None if ps_.empty else f'=IF(C{rr}=0,"",D{rr}/C{rr})', stt],
                key=key, left=(1,), fmts={4: "+0;-0;0", 5: "+0.0%;-0.0%"})
        crow.append([n, float(v), None if ps_.empty else pv_])
        rr += 1
    hr_, r1_ = DS.block("月度-本月vs上月同期", ["不良项目", "本月", "上月同期"], crow)
    build_chart(ws, f"K{r}", "本月 vs 上月同期（TOP10项目）", "col", DS.ws, hr_, r1_, 3, 15, 7.5, colors=["2E75B6", "BFBFBF"], rot=-2700000)
    r = max(rr, r + rows_for(7.5)) + 2

    section(ws, r, "五、工序月度占比", 7)
    heads(ws, r + 1, ["责任工序", "不良pcs", "占比", "涉及人数", "上月同期", "变化%", "预警"])
    pc = counts(this, "_proc")
    ppc = counts(ps_, "_proc")
    rule = cfg["alerts"]["工序"]
    rr, pie_rows = r + 2, []
    for n, v in pc.items():
        lv = level(v, v / tot, rule)
        pvv = float(ppc.get(n, 0))
        put_row(ws, rr, [n, float(v), f"=B{rr}/{tot}", int(this[this["_proc"] == n]["_emp"].nunique()), None if ps_.empty else pvv,
                         None if ps_.empty else f'=IF(E{rr}=0,"",(B{rr}-E{rr})/E{rr})', ("", "● 关注", "● 重点")[lv]],
                key=["", "orange", "red"][lv], left=(1,), fmts={3: "0.0%", 6: "+0.0%;-0.0%"})
        pie_rows.append([n, float(v)])
        rr += 1
    top8, rest = pie_rows[:8], sum(x[1] for x in pie_rows[8:])
    pr = top8 + ([["其他", rest]] if rest else [])
    hr_, r1_ = DS.block("月度-工序占比", ["责任工序", "pcs"], pr)
    build_chart(ws, f"K{r}", "工序占比（本月）", "pie", DS.ws, hr_, r1_, 2, 13, 7.5, labels=[f"{int(v)}{U} | {v / tot:.1%}" for n, v in pr])
    r = max(rr, r + rows_for(7.5)) + 2
    weeks = sorted(this["_week"].unique())
    pw = this.pivot_table(index="_proc", columns="_week", values="_qty", aggfunc="sum", fill_value=0).reindex(columns=weeks, fill_value=0)
    pw = pw.loc[pw.sum(axis=1).sort_values(ascending=False).index]
    pw = pw[pw.index != ""]
    r += write_heat(ws, r, "工序 × 周次 热力图（pcs）", ["责任工序"] + weeks, [[n] + [float(x) for x in row] for n, row in pw.iterrows()]) + 1

    section(ws, r, "六、人员不良TOP20（占比=个人/本月全部；红橙按【预警规则】人员总览）", 8)
    heads(ws, r + 1, ["排名", "责任员工", "不良pcs", "占比", "出现天数", "主要不良项目", "主要工序", "预警"])
    pe = counts(this, "_emp")
    arule = cfg["alerts"]["人员总览"]
    tp = this.groupby(["_emp", "_item"])["_qty"].sum().reset_index().sort_values(["_emp", "_qty"], ascending=[True, False]).drop_duplicates("_emp").set_index("_emp")
    tpp = this.groupby(["_emp", "_proc"])["_qty"].sum().reset_index().sort_values(["_emp", "_qty"], ascending=[True, False]).drop_duplicates("_emp").set_index("_emp")
    dys = this.groupby("_emp")["_date"].nunique()
    rr, lvs, labs, prow2 = r + 2, [], [], []
    for i, (n, v) in enumerate(pe.head(20).items()):
        lv = level(v, v / tot, arule)
        lvs.append(lv)
        labs.append(f"{v:.0f}{U} | {v / tot:.1%}")
        put_row(ws, rr, [i + 1, n, float(v), f"=C{rr}/{tot}", int(dys.get(n, 0)), f"{tp.loc[n, '_item']}({tp.loc[n, '_qty']:.0f})", tpp.loc[n, "_proc"], ("", "● 关注", "● 重点")[lv]],
                key=["", "orange", "red"][lv], left=(2, 6, 7), fmts={4: "0.0%"})
        prow2.append([n, float(v)])
        rr += 1
    hr_, r1_ = DS.block("月度-人员TOP20", ["责任员工", "pcs"], prow2)
    build_chart(ws, f"K{r}", f"人员不良TOP20（{rule_text(arule)}）", "bar", DS.ws, hr_, r1_, 2, 15, cm_h(20), levels=lvs, rule=arule, labels=labs)
    r = max(rr, r + rows_for(cm_h(20))) + 2
    items8 = list(it.index[:8])
    emps = list(pe.index[:20])
    ph = this[this["_emp"].isin(emps) & this["_item"].isin(items8)].pivot_table(index="_emp", columns="_item", values="_qty", aggfunc="sum", fill_value=0).reindex(index=emps, columns=items8, fill_value=0)
    write_heat(ws, r, "人员 × 不良项目 热力图（TOP20人员 × TOP8项目）", ["责任员工"] + items8, [[n] + [float(x) for x in row] for n, row in ph.iterrows()])
    widths(ws, [20, 18, 11, 11, 11, 18, 14, 14, 3] + [9] * 20)


# ======================== 04 风险与集中度 ========================
def write_risk(wb, ctx):
    cfg, P, T, DS = ctx["cfg"], ctx["P"], ctx["T"], ctx["DS"]
    ws = wb.create_sheet("04_风险与集中度")
    ws.sheet_view.showGridLines = False
    w0, w1 = ctx["win"]
    days_w = ctx["dash"]["days_w"]
    SM = scheme_df(ctx, P["月度风险方案"])
    d = in_range(SM, w0, w1)
    ws.cell(row=1, column=1, value=f"风险与集中度 ｜ {w0:%m/%d}~{w1:%m/%d} ｜ 方案：{P['月度风险方案']}").font = Font(name=FONT, bold=True, size=16, color=NAVY)
    if d.empty:
        ws["A3"] = "窗口内无数据"
        return
    r = 3
    section(ws, r, "一、工序健康度（100分制，越低越需关注）", 9)
    heads(ws, r + 1, ["责任工序", "不良pcs", "占比", "红灯人员", "重复异常人员", "趋势", "健康度", "等级"])
    hs = health_scores(d, days_w, cfg, T)
    rr, lv_s, lab_s, srows = r + 2, [], [], []
    for _, h in hs.iterrows():
        sc = h["score"]
        key = "green" if sc >= 85 else "orange" if sc >= 70 else "red"
        lv_s.append(0 if sc >= 85 else 1 if sc >= 70 else 2)
        lab_s.append(f"{sc:.0f}分")
        put_row(ws, rr, [h["proc"], float(h["pcs"]), h["share"], int(h["nred"]), int(h["nrep"]), h["trend"], round(sc, 1), "健康" if sc >= 85 else "关注" if sc >= 70 else "异常"],
                key=key, left=(1, 6), fmts={3: "0.0%", 7: "0.0"})
        srows.append([h["proc"], round(sc, 1)])
        rr += 1
    cell(ws, rr, 1, "公式：100 − 50×占比 − 红灯人员×5(≤15) − 重复异常人员×3(≤15) − 趋势恶化(红10/橙5)；≥85健康 70-85关注 <70异常", color="808080", size=9, border=False)
    hr_, r1_ = DS.block("风险-工序健康度", ["责任工序", "健康度"], srows)
    build_chart(ws, f"K{r}", "工序健康度（分）", "bar", DS.ws, hr_, r1_, 2, 14, cm_h(len(srows)), levels=lv_s, rule=GOOD_RULE, labels=lab_s)
    r = max(rr + 1, r + rows_for(cm_h(len(srows)))) + 2

    section(ws, r, f"二、不良集中度（TOP1人员占比：≥{P['集中度高阈值']}高度集中→查人员；<{P['集中度中阈值']}分散→查工艺/物料/治具/WOI）", 9)
    heads(ws, r + 1, ["标准不良项目", "不良pcs", "涉及人数", "TOP1员工", "TOP1 pcs", "集中度", "判断", "推荐调查方向"])
    cn = concentration(d, cfg)
    rr, lv_c, lab_c, crow = r + 2, [], [], []
    for _, c in cn.head(20).iterrows():
        put_row(ws, rr, [c["item"], float(c["pcs"]), int(c["people"]), c["top1"], float(c["top1n"]), c["ratio"], c["txt"], c["how"]], key=c["lvl"], left=(1, 4, 8), fmts={6: "0%"})
        lv_c.append(2 if c["lvl"] == "red" else 1 if c["lvl"] == "orange" else 0)
        lab_c.append(f"{c['ratio']:.0%}（{c['pcs']:.0f}{U}）")
        crow.append([c["item"], c["ratio"]])
        rr += 1
    hr_, r1_ = DS.block("风险-不良集中度", ["不良项目", "TOP1占比"], crow, {2: "0%"})
    build_chart(ws, f"K{r}", "不良集中度（TOP1人员占比，红=高度集中）", "bar", DS.ws, hr_, r1_, 2, 14, cm_h(len(crow)), levels=lv_c, rule=LOW_RULE, labels=lab_c)
    r = max(rr, r + rows_for(cm_h(len(crow)))) + 2

    ps = person_stats(d, days_w, cfg, T)
    section(ws, r, "三、风险人员榜（风险分 = pcs + 2×出现天数 + 3×当前连续天数）", 10)
    heads(ws, r + 1, ["排名", "责任员工", "窗口pcs", "出现天数", "连续天数", "涉及项目数", "主要不良项目", "主要工序", "风险分", "等级"])
    rr, lv_p, lab_p, prow = r + 2, [], [], []
    for i, p in ps.head(20).iterrows():
        put_row(ws, rr, [i + 1, p["emp"], float(p["pcs"]), int(p["days"]), int(p["consec"]), int(p["items"]), f"{p['top_item']}({p['top_item_n']:.0f})", p["proc"], float(p["score"]),
                         ("", "● 关注", "● 重点")[int(p["level"])]], key=["", "orange", "red"][int(p["level"])], left=(2, 7, 8))
        lv_p.append(int(p["level"]))
        lab_p.append(f"{p['score']:.0f}分")
        prow.append([p["emp"], float(p["score"])])
        rr += 1
    if prow:
        hr_, r1_ = DS.block("风险-人员风险分", ["责任员工", "风险分"], prow)
        build_chart(ws, f"K{r}", "风险人员TOP20（风险分）", "bar", DS.ws, hr_, r1_, 2, 14, cm_h(len(prow)), levels=lv_p, rule=LOW_RULE, labels=lab_p)
    r = max(rr, r + rows_for(cm_h(max(len(prow), 1)))) + 2

    section(ws, r, "四、改善优先级矩阵（评分 = pcs × 涉及人数 × 占比，归一到100分）", 8)
    heads(ws, r + 1, ["标准不良项目", "不良pcs", "涉及人数", "占比", "原始分", "优先级评分", "优先级", "建议"])
    g = concentration(d, cfg)
    tot = float(d["_qty"].sum())
    g["raw"] = g["pcs"] * g["people"] * g["pcs"] / tot
    mx = g["raw"].max() or 1
    g = g.sort_values("raw", ascending=False).head(15)
    rr, lv_g, lab_g, grow = r + 2, [], [], []
    for _, x in g.iterrows():
        sc = x["raw"] / mx * 100
        put_row(ws, rr, [x["item"], float(x["pcs"]), int(x["people"]), x["pcs"] / tot, round(float(x["raw"]), 1), round(sc, 1), "P1 优先改善" if sc >= 70 else "P2 计划改善" if sc >= 40 else "P3 观察", x["how"]],
                key="red" if sc >= 70 else "orange" if sc >= 40 else "", left=(1, 8), fmts={4: "0.0%"})
        lv_g.append(2 if sc >= 70 else 1 if sc >= 40 else 0)
        lab_g.append(f"{sc:.0f}分")
        grow.append([x["item"], round(sc, 1)])
        rr += 1
    hr_, r1_ = DS.block("风险-改善优先级", ["不良项目", "评分"], grow)
    build_chart(ws, f"K{r}", "改善优先级评分", "bar", DS.ws, hr_, r1_, 2, 14, cm_h(len(grow)), levels=lv_g, rule=LOW_RULE, labels=lab_g)
    widths(ws, [20, 16, 11, 14, 11, 16, 20, 34, 10, 10])


# ======================== 07 改善项目 ========================
def write_improve(wb, ctx):
    cfg, P, DS = ctx["cfg"], ctx["P"], ctx["DS"]
    ws = wb.create_sheet("07_改善项目")
    ws.sheet_view.showGridLines = False
    ws.cell(row=1, column=1, value="改善项目追踪（改善前 vs 改善后 每日平均不良pcs）").font = Font(name=FONT, bold=True, size=16, color=NAVY)
    SM = scheme_df(ctx, P["月度风险方案"])
    days = ctx["days_all"]
    imps = cfg["improve"]
    if not imps:
        ws["A3"] = "面板【改善项目】里没有启用的项目。填写：项目名称、标准不良项目、开始日期、对比天数后重新生成。"
        return
    heads(ws, 3, ["项目", "不良项目", "责任工序", "负责人", "开始日期", "计划完成", "对比天数", "改善前日均", "改善后日均", "改善率", "最新一日", "判定"])
    rr, charts = 4, []
    for im in imps:
        d = SM
        if im["item"]:
            d = d[d["_item"].isin(split_vals(im["item"]))]
        if im["proc"]:
            d = d[d["_proc"].isin(split_vals(im["proc"]))]
        daily = d.groupby("_date")["_qty"].sum().reindex(days, fill_value=0)
        before = daily[[x for x in days if x < im["start"]]].tail(im["n"])
        after = daily[[x for x in days if x >= im["start"]]].head(im["n"])
        bavg = float(before.mean()) if len(before) else None
        aavg = float(after.mean()) if len(after) else None
        rate = ((bavg - aavg) / bavg) if bavg and aavg is not None else None
        if rate is None or len(after) < min(3, im["n"]):
            st, key = "数据不足", ""
        else:
            st, key = ("改善有效", "green") if rate >= 0.2 else ("效果不明显", "yellow") if rate > -0.1 else ("恶化", "red")
        put_row(ws, rr, [im["name"], im["item"] or "全部", im["proc"] or "全部", im["owner"], f"{im['start']:%Y-%m-%d}", im["plan"], im["n"], bavg, aavg, rate,
                         float(daily.iloc[-1]) if len(daily) else None, st], left=(1, 2, 3, 4), fmts={8: "0.0", 9: "0.0", 10: "+0.0%;-0.0%"})
        stcell(ws, rr, 12, st, key, center=True, bold=True)
        rr += 1
        hr_, r1_ = DS.block(f"改善-{im['name']}", ["日期", "每日不良pcs"], [[day_lbl(x), float(daily[x])] for x in days[-30:]])
        charts.append((f"{im['name']}：每日不良pcs（开始日 {im['start']:%m/%d}）", hr_, r1_))
    top = rr + 2
    for i, (t, hr_, r1_) in enumerate(charts):
        build_chart(ws, f"{'A' if i % 2 == 0 else 'G'}{top + (i // 2) * 17}", t, "line", DS.ws, hr_, r1_, 2, 15, 7.5)
    widths(ws, [28, 16, 14, 12, 12, 12, 9, 12, 12, 10, 10, 12])


# ======================== 方案分析表 ========================
def rank_block(ws, r, ttl, d, key, cfg, total, extra, top, kind, chart_col, label, pie=False):
    rule = cfg["alerts"][kind]
    vc = counts(d, key)
    if vc.empty:
        return r, []
    hs = ["排名", label, f"数量({U})", "占比", "累计占比"] + [e[0] for e in extra] + ["预警"]
    section(ws, r, ttl, len(hs))
    heads(ws, r + 1, hs)
    r0 = r + 2
    lvs, hot = [], []
    for i, (k, n) in enumerate(vc.items()):
        rr = r0 + i
        sub = d[d[key] == k]
        n = float(n)
        lv = level(n, n / total, rule)
        lvs.append(lv)
        vals = [i + 1, k, pcsfmt(n), f"=C{rr}/{total}", f"=SUM($D${r0}:D{rr})"] + [fn(sub, rr) for _, fn in extra] + [("", "● 关注", "● 重点")[lv]]
        for j, v in enumerate(vals, 1):
            is_f = isinstance(v, str) and v.startswith("=")
            fmt = "0.0%" if (j in (4, 5) or (is_f and 5 < j < len(vals))) else None
            c = cell(ws, rr, j, v, center=not (isinstance(v, str) and not is_f) or j == len(vals), fmt=fmt,
                     fill=PatternFill("solid", start_color=ST[["", "orange", "red"][lv]][0]) if lv else None, bold=lv == 2 and j in (2, 3, 4))
            if j == len(vals) and lv:
                c.font = Font(name=FONT, bold=True, color=rule[["", "橙色", "红色"][lv]])
        if lv:
            hot.append((k, int(n), n / total, sub, lv))
    r1 = r0 + len(vc) - 1
    cell(ws, r1 + 1, 2, "合计", bold=True, fill=TOT)
    cell(ws, r1 + 1, 3, f"=SUM(C{r0}:C{r1})", bold=True, fill=TOT, center=True)
    cell(ws, r1 + 1, 4, f"=SUM(D{r0}:D{r1})", bold=True, fill=TOT, center=True, fmt="0.0%")
    nn = min(top, len(vc))
    labels = [f"{pcsfmt(v)}{U} | {v / total:.1%}" for v in vc.values[:nn]]
    build_chart(ws, f"{L(chart_col)}{r}", f"{label} TOP{nn}（{rule_text(rule)}）", "bar", ws, r + 1, r0 + nn - 1, 2, 17, cm_h(nn), levels=lvs[:nn], rule=rule, labels=labels, cat_col=2, val_col=3)
    h = cm_h(nn)
    if pie:
        pl = [f"{pcsfmt(v)}{U} | {v / total:.1%}" for k, v in vc.items()]
        build_chart(ws, f"{L(chart_col + 11)}{r}", f"{label}占比", "pie", ws, r + 1, r1, 2, 13, 11, labels=pl, cat_col=2, val_col=3)
        h = max(h, 11)
    return max(r1 + 2, r + rows_for(h)) + 2, hot


def top_of(col):
    def f(sub, rr):
        v = counts(sub, col)
        return v.index[0] if len(v) else ""
    return f


def top_n_of(col):
    def f(sub, rr):
        v = counts(sub, col)
        return pcsfmt(v.iloc[0]) if len(v) else 0
    return f


def share_of(letter):
    return lambda sub, rr: f"=IF(C{rr}=0,0,{letter}{rr}/C{rr})"


def scheme_desc(g):
    desc = []
    for k, lab in (("emp_in", "人员组只看"), ("emp_out", "人员组排除"), ("def_in", "不良组只看"), ("def_out", "不良组排除"), ("prod", "产品类别"), ("shift", "班别"), ("excl", "排除站点")):
        if g[k]:
            desc.append(f"{lab}:{'、'.join(g[k])}")
    if g["conds"]:
        desc.append("附加条件:" + ";".join(f"{a}{b}{'、'.join(c)}" for a, b, c in g["conds"]))
    return "；".join(desc)


def scheme_sheet(wb, g, d, cfg, ctx, rng_txt):
    P = cfg["P"]
    ws = wb.create_sheet(g["name"])
    total = float(d["_qty"].sum()) if len(d) else 0
    desc = scheme_desc(g)
    head = f"【{g['name']}】工序：{'、'.join(g['procs']) or '全部'}｜范围：{rng_txt}" + (f"｜{desc}" if desc else "")
    if total:
        ve, vd = counts(d, "_emp"), counts(d, "_code")
        msg = (f"{head}｜不良 {pcsfmt(total)}{U}，{d['_emp'].nunique()} 人｜最多员工：{ve.index[0]} {pcsfmt(ve.iloc[0])}{U}({ve.iloc[0] / total:.1%})"
               f"｜最多不良：{vd.index[0]} {pcsfmt(vd.iloc[0])}{U}({vd.iloc[0] / total:.1%})")
    else:
        msg = f"{head}｜无数据"
    ws.cell(row=1, column=1, value=msg).font = Font(name=FONT, bold=True, size=12, color=NAVY)
    show = [c for c in cfg["show"] if c in d.columns]
    det = d.sort_values(["_date", "_proc", "_emp"])[["_date", "_prod", "_item"] + show]
    cols = ["业务日期", "产品类别", "标准不良项目"] + show
    r = 5
    section(ws, r, f"一、明细（{len(d)} 条，表头可筛选）", len(cols))
    heads(ws, r + 1, cols)
    for i, row in enumerate(det.itertuples(index=False), r + 2):
        for j, v in enumerate(row, 1):
            c = ws.cell(row=i, column=j, value=(v.to_pydatetime() if isinstance(v, pd.Timestamp) else v))
            c.font = Font(name=FONT, size=10)
            if isinstance(v, pd.Timestamp):
                c.number_format = "yyyy-mm-dd"
    end = r + 1 + max(len(det), 1)
    ws.auto_filter.ref = f"A{r + 1}:{L(len(cols))}{end}"
    ws.freeze_panes = ws.cell(row=r + 2, column=1)
    r = end + 3
    if not total:
        return ws
    ws.cell(row=r - 1, column=1, value="▼ 以下为不良分析（图表在表格右侧）").font = Font(name=FONT, bold=True, color=NAVY)
    CH = 12
    te, td = int(num(P["图表人员TOP"], 15)), int(num(P["图表不良TOP"], 15))
    nu = lambda s, rr: s["_emp"].nunique()
    if len(g["procs"]) > 1 or g["pie"]:
        r, _ = rank_block(ws, r, "二、工序不良占比", d, "_proc", cfg, total, [("人数", nu), ("最多员工", top_of("_emp")), ("该员工数", top_n_of("_emp")), ("最多不良", top_of("_item"))], td, "工序", CH, "责任工序", pie=True)
    r, hot_e = rank_block(ws, r, "三、人员不良排名（占比=个人/本表合计）", d, "_emp", cfg, total, [("最多不良项目", top_of("_item")), ("该不良数", top_n_of("_item")), ("占个人", share_of("G"))], te, "人员", CH, "责任员工")
    r, hot_d = rank_block(ws, r, "四、不良代码排名（占比=该不良/本表合计）", d, "_code", cfg, total, [("涉及人数", nu), ("最多员工", top_of("_emp")), ("该员工数", top_n_of("_emp"))], td, "不良", CH, "不良代码")
    r, _ = rank_block(ws, r, "五、标准不良项目排名", d, "_item", cfg, total, [("涉及人数", nu), ("最多员工", top_of("_emp")), ("产品类别", top_of("_prod"))], td, "不良", CH, "标准不良项目")
    if (d["_cat"] != "").any():
        r, _ = rank_block(ws, r, "六、不良大类排名", d, "_cat", cfg, total, [("涉及人数", nu), ("最多员工", top_of("_emp"))], td, "不良大类", CH, "不良大类")
    if (d["_shift"] != "").any():
        r, _ = rank_block(ws, r, "七、班别不良分布", d, "_shift", cfg, total, [("人数", nu), ("人均", lambda s, rr: f"=IF(F{rr}=0,0,C{rr}/F{rr})"), ("最多员工", top_of("_emp")), ("最多不良", top_of("_item"))], td, "班别", CH, "班别")

    def fe(x):
        k, n, p, sub, lv = x
        v = counts(sub, "_item")
        return f"{k} {n}{U}({p:.1%}，主要{v.index[0]} {pcsfmt(v.iloc[0])}{U})"

    def fd(x):
        k, n, p, sub, lv = x
        v = counts(sub, "_emp")
        return f"{k} {n}{U}({p:.1%}，最多{v.index[0]} {pcsfmt(v.iloc[0])}{U})"
    he, hd = sorted(hot_e, key=lambda x: (-x[4], -x[1]))[:6], sorted(hot_d, key=lambda x: (-x[4], -x[1]))[:5]
    for rr, t in ((2, "▲ 重点人员：" + ("；".join(fe(x) for x in he) if he else "无（未超过预警线）")), (3, "▲ 重点不良：" + ("；".join(fd(x) for x in hd) if hd else "无（未超过预警线）"))):
        c = ws.cell(row=rr, column=1, value=t)
        c.font = Font(name=FONT, bold=True, color="C00000")
        c.fill = PatternFill("solid", start_color=ST["red"][0])
    maxc = int(num(P["交叉表最多列数"], 30))
    ve = counts(d, "_emp")
    dl = list(counts(d, "_code").index[:maxc])
    section(ws, r, "八、员工 × 不良代码 交叉表（越红越集中）", len(dl) + 3)
    hr = r + 1
    hdr(ws, hr, 1, "责任员工")
    for j, c in enumerate(dl, 2):
        hdr(ws, hr, j, c)
    tc = len(dl) + 2
    hdr(ws, hr, tc, f"合计({U})")
    hdr(ws, hr, tc + 1, f"{U} | 占比")
    ct = d.groupby(["_emp", "_code"])["_qty"].sum().unstack(fill_value=0).reindex(index=ve.index, columns=dl, fill_value=0)
    x0 = hr + 1
    for i, e in enumerate(ve.index):
        rr = x0 + i
        cell(ws, rr, 1, e)
        for j, c in enumerate(dl, 2):
            v = ct.loc[e, c]
            cell(ws, rr, j, pcsfmt(v) if v else None, center=True)
        cell(ws, rr, tc, f"=SUM(B{rr}:{L(tc - 1)}{rr})", bold=True, center=True)
        cell(ws, rr, tc + 1, f'={L(tc)}{rr}&"{U} | "&TEXT({L(tc)}{rr}/{total},"0.0%")', center=True)
    x1 = x0 + len(ve) - 1
    cell(ws, x1 + 1, 1, "合计", bold=True, fill=TOT)
    for j in range(2, tc + 1):
        cell(ws, x1 + 1, j, f"=SUM({L(j)}{x0}:{L(j)}{x1})", bold=True, fill=TOT, center=True)
    ws.conditional_formatting.add(f"B{x0}:{L(tc - 1)}{x1}", ColorScaleRule(start_type="num", start_value=1, start_color="FFF2F2", end_type="max", end_color="F8696B"))
    for j in range(3, len(cols) + 1):
        ws.column_dimensions[L(j)].width = 13
    ws.column_dimensions["A"].width = 14
    ws.column_dimensions["B"].width = 24
    ws.column_dimensions["F"].width = 20
    return ws


def write_overview(wb, ctx, out_groups):
    ws = wb.create_sheet("05_方案总览")
    ws.sheet_view.showGridLines = False
    ws.cell(row=1, column=1, value="筛选方案总览（点方案名跳转到对应分析表）").font = Font(name=FONT, bold=True, size=16, color=NAVY)
    heads(ws, 3, ["方案", "包含工序", "日期范围", f"不良({U})", "人数", "最多员工", "该员工", "最多不良项目", "该项目", "其他筛选"])
    for i, (g, d, rtxt) in enumerate(out_groups):
        rr = 4 + i
        ve, vi = counts(d, "_emp"), counts(d, "_item")
        n = float(d["_qty"].sum()) if len(d) else 0
        link(ws, rr, 1, g["name"], g["name"])
        for j, v in enumerate(["、".join(g["procs"]) or "全部", rtxt, pcsfmt(n), d["_emp"].nunique(), ve.index[0] if len(ve) else "", pcsfmt(ve.iloc[0]) if len(ve) else 0,
                               vi.index[0] if len(vi) else "", pcsfmt(vi.iloc[0]) if len(vi) else 0, scheme_desc(g)], 2):
            cell(ws, rr, j, v, center=j in (4, 5, 7, 9))
    ws.cell(row=5 + len(out_groups), column=1, value="提示：多工序合并表与单工序表之间会有重复计数，仅作各自视角的分析。").font = Font(name=FONT, size=9, color="595959")
    widths(ws, [18, 44, 14, 10, 8, 12, 9, 18, 9, 40])


def write_importlog(wb, ctx, hist, log, msgs, bad_rows):
    ws = wb.create_sheet("08_导入日志")
    ws.sheet_view.showGridLines = False
    ws.cell(row=1, column=1, value="导入日志与数据检查").font = Font(name=FONT, bold=True, size=16, color=NAVY)
    r = 3
    section(ws, r, "本次运行", 9)
    lines = msgs or ["本次没有新文件需要导入（使用历史数据库）"]
    for i, t in enumerate(lines):
        ws.cell(row=r + 1 + i, column=1, value=t.strip()).font = Font(name=FONT, size=10)
    r += len(lines) + 2
    for t in ctx["warn"]:
        ws.cell(row=r, column=1, value="[警告] " + t).font = Font(name=FONT, size=10, color="C00000")
        r += 1
    section(ws, r, "全局筛选过程", 9)
    fl_ = ctx["filter_log"] or ["  无"]
    for i, t in enumerate(fl_):
        ws.cell(row=r + 1 + i, column=1, value=t.strip()).font = Font(name=FONT, size=10)
    r += len(fl_) + 2
    section(ws, r, f"历史数据库：{len(hist)} 行｜日期无法解析被忽略 {bad_rows} 行｜生产日 {len(ctx['days_all'])} 天", 9)
    heads(ws, r + 1, ["业务日", "历史库行数", "筛选后pcs", "已填检查量"])
    cnt = ctx["A0"].groupby("_date").size()
    ft = ctx["A"].groupby("_date")["_qty"].sum()
    for i, d in enumerate(sorted(cnt.index)):
        put_row(ws, r + 2 + i, [f"{d:%Y-%m-%d}", int(cnt[d]), float(ft.get(d, 0)), ctx["chk"].get(d)], fmts={3: "0", 4: "#,##0"})
    r += len(cnt) + 4
    section(ws, r, "导入记录（新→旧）", 9)
    heads(ws, r + 1, [c for c in LOG_COLS if c != "文件指纹"])
    for i, (_, row) in enumerate(log.iloc[::-1].head(60).iterrows()):
        put_row(ws, r + 2 + i, [row[c] for c in LOG_COLS if c != "文件指纹"], left=(1, 8))
    widths(ws, [36, 18, 18, 12, 12, 14, 12, 24, 14])


# ======================== 扫描 / 预览（面板使用）========================
_SCAN = {"sig": None, "hist": None, "files": None}


def _sig(base, raw):
    sig = [(f, os.path.getsize(f), os.stat(f).st_mtime_ns) for f in list_input_files(base, raw)]
    hp = os.path.join(abspath(base, raw["paths"]["history"]), "不良历史数据.csv")
    if os.path.exists(hp):
        sig.append((hp, os.path.getsize(hp), os.stat(hp).st_mtime_ns))
    lp = os.path.join(abspath(base, raw["paths"]["history"]), "导入日志.csv")
    if os.path.exists(lp): sig.append((lp, os.path.getsize(lp), os.stat(lp).st_mtime_ns))
    sig.append((abspath(base, raw["paths"]["history"]), raw["P"].get("去重字段"), raw["P"].get("重新导入全部文件")))
    return tuple(sig)


def load_hist(base, raw, force=False):
    sig = _sig(base, raw)
    if not force and _SCAN["sig"] == sig and _SCAN["hist"] is not None:
        return _SCAN["hist"], _SCAN["files"]
    lp = os.path.join(abspath(base, raw["paths"]["history"]), "导入日志.csv")
    seen = set(pd.read_csv(lp, dtype=str, keep_default_na=False, encoding="utf-8-sig")["文件指纹"]) if os.path.exists(lp) else set()
    hist, lg, msgs = import_data(base, raw, dry=True)
    files = []
    for f in list_input_files(base, raw):
        files.append(dict(name=os.path.basename(f), size=os.path.getsize(f), mtime=dt.datetime.fromtimestamp(os.path.getmtime(f)).strftime("%Y-%m-%d %H:%M"),
                          imported=file_md5(f) in seen))
    _SCAN.update(sig=sig, hist=hist, files=files)
    return hist, files


def scan_data(base, raw, force=False):
    """扫描：返回表头信息 + 各维度取值，供面板勾选；同时补全字段映射/不良类型"""
    raw = merge_config(raw)
    hist, files = load_hist(base, raw, force)
    if hist.empty:
        return dict(rows=0, files=files, columns=[], raw_patch=None)
    cols = [c for c in hist.columns if c not in ("来源文件", "导入时间")]
    ensure_fieldmap(raw, cols)
    cfg = build_cfg(raw)
    ensure_defects(raw, hist, cfg["roles"])
    cfg = build_cfg(raw)
    n = len(hist)
    info = []
    for c in cols:
        s = hist[c]
        ne = s[s != ""]
        info.append(dict(name=c, sample=str(ne.iloc[0])[:40] if len(ne) else "", unique=int(ne.nunique()), empty=round((n - len(ne)) / n, 4) if n else 0))
    A, bad = build_frame(hist, cfg)

    def vc(col, top=None):
        v = A.groupby(col)["_qty"].sum().sort_values(ascending=False)
        v = v[v.index != ""]
        return [dict(v=str(k), n=float(x)) for k, x in (v.head(top) if top else v).items()]
    days = A.groupby("_date")["_qty"].sum()
    dc = A["_code"].value_counts()
    cat = {}
    ccol = cfg["roles"].get("不良大类")
    if ccol:
        for code in dc.index[:2000]:
            m = hist.loc[hist[cfg["roles"]["不良代码"]] == code, ccol]
            m = m[m != ""]
            cat[code] = m.mode().iloc[0] if len(m) else ""
    groups = sorted({g for d in raw["defects"].values() for g in split_vals(d.get("groups", []))} | {"看板监控"})
    return dict(rows=n, bad_dates=bad, files=files, columns=info, procs=vc("_proc"), shifts=vc("_shift"), prods=vc("_prod"), items=vc("_item"),
                employees=vc("_emp"), defects=[dict(code=k, n=int(x), cat=cat.get(k, "")) for k, x in dc.items() if k],
                days=[dict(d=f"{k:%Y-%m-%d}", n=float(x)) for k, x in days.items()], groups=groups,
                steps=vc("_step"), conn=vc("连接器类型_"), raw_patch=dict(fieldmap=raw["fieldmap"], defects=raw["defects"]))


def preview_scheme(base, raw, scheme):
    """某个筛选方案当前筛出多少数据（面板实时预览）"""
    raw = merge_config(raw)
    hist, _ = load_hist(base, raw)
    if hist.empty:
        return dict(pcs=0)
    cols = [c for c in hist.columns if c not in ("来源文件", "导入时间")]
    ensure_fieldmap(raw, cols)
    ensure_defects(raw, hist, build_cfg(raw)["roles"])
    raw2 = dict(raw)
    raw2["schemes"] = [dict(scheme, enabled=True, name=scheme.get("name") or "预览")]
    cfg = build_cfg(raw2)
    if not cfg["schemes"]:
        return dict(pcs=0)
    A0, _ = build_frame(hist, cfg)
    A, _ = apply_global(A0, cfg)
    base_pcs = float(A["_qty"].sum())
    d = apply_scheme(A, cfg["schemes"][0], cfg)
    if d.empty:
        return dict(pcs=0, base=base_pcs, people=0, top_emp=[], top_item=[], days=[])
    dd = d.groupby("_date")["_qty"].sum()
    return dict(pcs=float(d["_qty"].sum()), base=base_pcs, people=int(d["_emp"].nunique()),
                top_emp=[dict(v=k, n=float(x)) for k, x in counts(d, "_emp").head(3).items()],
                top_item=[dict(v=k, n=float(x)) for k, x in counts(d, "_item").head(3).items()],
                days=[dict(d=f"{k:%m/%d}", n=float(x)) for k, x in dd.items()])


# ======================== 主流程 ========================
def safe_name(n, used):
    n = re.sub(r"[\\/?*\[\]:]", "_", n)[:31]
    base, k = n, 2
    while n in used:
        n = f"{base[:28]}_{k}"
        k += 1
    used.add(n)
    return n


def run_report(base, raw, log=print, only=None):
    """生成报表。返回 dict(output, raw(补全后的配置), warnings)"""
    t0 = dt.datetime.now()
    raw = merge_config(raw)
    log("== BK 5F 品质驾驶舱 · 开始生成 ==")
    hist, lg, msgs = import_data(base, raw)
    for m in msgs:
        log(m)
    _SCAN["sig"] = None
    if hist.empty:
        raise RuntimeError(f"没有数据：请把原表放进文件夹【{abspath(base, raw['paths']['input'])}】")
    cols = [c for c in hist.columns if c not in ("来源文件", "导入时间")]
    ensure_fieldmap(raw, cols)
    cfg = build_cfg(raw)
    nadd = ensure_defects(raw, hist, cfg["roles"])
    if nadd:
        log(f"【不良类型】新增 {nadd} 个不良代码（可在面板里归类）")
    cfg = build_cfg(raw)
    P = cfg["P"]
    miss = [r for r in ("责任员工", "责任工序", "不良代码") if r not in cfg["roles"]]
    if miss or not (cfg["roles"].get("业务日期") or cfg["roles"].get("记录时间")):
        raise RuntimeError("【字段映射】缺少必要用途：" + ("、".join(miss) or "业务日期/记录时间") + "，请在面板【数据与字段】里选择")
    A0, bad = build_frame(hist, cfg)
    A, flog = apply_global(A0, cfg)
    if A.empty:
        raise RuntimeError("全局筛选后没有数据，请检查面板里的全局筛选规则/不良类型/人员名单")
    days_all = sorted(pd.to_datetime(A0["_date"].unique()))
    bd = pd.to_datetime(sval(P["基准日期"]), errors="coerce")
    cands = [d for d in days_all if pd.isna(bd) or d <= bd.normalize()]
    cur_day = cands[-1] if cands else days_all[-1]
    win = resolve_range(P["分析窗口"], cur_day, P["自定义开始日期"], P["自定义结束日期"], days_all[0])
    T = tparams(P)
    T.update(m_red=pct_val(P["矩阵上升红色%"], 0.3), m_org=pct_val(P["矩阵上升橙色%"], 0.1), m_grn=pct_val(P["矩阵下降绿色%"], 0.1))
    ctx = dict(cfg=cfg, P=P, T=T, A=A, A0=A0, base=cur_day, cur_day=cur_day, win=win, days_all=days_all, chk=cfg["chk"], cache={}, warn=[], filter_log=flog)
    log(f"数据：历史 {len(hist)} 行 → 筛选后 {len(A)} 行｜生产日 {len(days_all)} 天｜业务日 {cur_day:%Y-%m-%d}｜窗口 {win[0]:%m/%d}~{win[1]:%m/%d}")
    LABELS.clear()
    wb = Workbook()
    wb.remove(wb.active)
    ctx["DS"] = DataSheet(wb.create_sheet("图表数据"))

    def page(name, fn, *a):
        try:
            log(f"  生成 {name} …")
            fn(wb, ctx, *a)
        except Exception as ex:
            import traceback
            traceback.print_exc()
            ctx["warn"].append(f"页面【{name}】生成失败：{ex}")
    page("01_每日驾驶舱", write_dashboard)
    if "dash" in ctx:
        page("02_趋势分析", write_trend)
        page("03_月度分析", write_monthly)
        page("04_风险与集中度", write_risk)
    used = {"图表数据", "01_每日驾驶舱", "02_趋势分析", "03_月度分析", "04_风险与集中度", "05_方案总览", "06_自定义图表", "07_改善项目", "08_导入日志"}
    schemes = list(cfg["schemes"])
    if yes(P["自动生成单工序表"]):
        have = {tuple(g["procs"]) for g in schemes if len(g["procs"]) == 1}
        for p in sorted(A["_proc"].unique()):
            if p and (p,) not in have:
                schemes.append(dict(name=re.sub(r"^\d+-", "", p), procs=[p], excl=[], prod=[], shift=[], emp_in=[], emp_out=[], def_in=[], def_out=[], conds=[], range="", pie=False))
    out_groups = []
    for g in schemes:
        g = dict(g)
        g["name"] = safe_name(g["name"], used)
        s, e = resolve_range(g["range"] or P["方案分析表范围"], cur_day, P["自定义开始日期"], P["自定义结束日期"], days_all[0])
        d = in_range(apply_scheme(A, g, cfg), s, min(e, cur_day))
        out_groups.append((g, d, f"{s:%m/%d}" if s == e else f"{s:%m/%d}~{e:%m/%d}"))
    page("05_方案总览", write_overview, out_groups)
    page("06_自定义图表", write_custom_page)
    page("07_改善项目", write_improve)
    page("08_导入日志", write_importlog, hist, lg, msgs, bad)
    if yes(P["输出方案分析表"]):
        for g, d, rt in out_groups:
            try:
                scheme_sheet(wb, g, d, cfg, ctx, rt)
                log(f"  方案 {g['name']}：{pcsfmt(d['_qty'].sum()) if len(d) else 0} {U}（{rt}）")
            except Exception as ex:
                import traceback
                traceback.print_exc()
                ctx["warn"].append(f"方案【{g['name']}】生成失败：{ex}")
    for flag, name in (("输出驾驶舱", "01_每日驾驶舱"), ("输出趋势分析", "02_趋势分析"), ("输出月度分析", "03_月度分析"),
                       ("输出风险与集中度", "04_风险与集中度"), ("输出自定义图表", "06_自定义图表"), ("输出改善项目", "07_改善项目")):
        if not yes(P[flag]) and name in wb.sheetnames:
            wb.remove(wb[name])
    if only:
        for n in list(wb.sheetnames):
            if n not in only and n != "图表数据":
                wb.remove(wb[n])
    order = ["01_每日驾驶舱", "02_趋势分析", "03_月度分析", "04_风险与集中度", "05_方案总览", "06_自定义图表", "07_改善项目", "08_导入日志"]
    wb._sheets.sort(key=lambda s: (order.index(s.title) if s.title in order else 50 if s.title != "图表数据" else 99))
    wb.active = 0
    for w_ in wb.worksheets:
        w_.page_setup.orientation = "landscape"
        w_.page_setup.fitToWidth = 1
        w_.page_setup.fitToHeight = 0
        w_.sheet_properties.pageSetUpPr = PageSetupProperties(fitToPage=True)
    outdir = abspath(base, raw["paths"]["output"])
    os.makedirs(outdir, exist_ok=True)
    out = os.path.join(outdir, f"不良分析_{cur_day:%Y%m%d}_{dt.datetime.now():%H%M%S_%f}.xlsx")
    wb.save(out)
    inject_labels(out)
    if not only:
        shutil.copyfile(out, os.path.join(outdir, "不良分析_最新.xlsx"))
    for w in ctx["warn"]:
        log("[警告] " + w)
    log(f"完成（{(dt.datetime.now() - t0).seconds}秒）：{out}")
    return dict(output=out, latest=os.path.join(outdir, "不良分析_最新.xlsx"), raw=raw, warnings=ctx["warn"], cur_day=f"{cur_day:%Y-%m-%d}",
                dash=dict(lvl=ctx["dash"]["lvl"], cur=ctx["dash"]["cur"], rate=ctx["dash"]["rate"], reasons=ctx["dash"]["reasons"]) if "dash" in ctx else None)


def load_config_file(base):
    p = os.path.join(base, "config.json")
    if os.path.exists(p):
        with open(p, encoding="utf-8") as f:
            return merge_config(json.load(f))
    return default_config()


_CONFIG_LOCK = threading.RLock()

def save_config_file(base, raw):
    p = os.path.join(base, "config.json")
    with _CONFIG_LOCK:
        fd, tmp = tempfile.mkstemp(prefix="config_", suffix=".tmp", dir=base)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(raw, f, ensure_ascii=False, indent=1)
                f.flush()
                os.fsync(f.fileno())
            if os.path.exists(p):
                shutil.copyfile(p, p + ".bak")
            os.replace(tmp, p)
        finally:
            if os.path.exists(tmp): os.unlink(tmp)


if __name__ == "__main__":
    BASE = os.path.dirname(os.path.abspath(__file__))
    raw_ = load_config_file(BASE)
    res = run_report(BASE, raw_)
    save_config_file(BASE, res["raw"])
    if os.name == "nt":
        os.startfile(res["output"])
