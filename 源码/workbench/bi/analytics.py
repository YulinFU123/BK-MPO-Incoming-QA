# -*- coding: utf-8 -*-
"""Day/week/month analytics. No network, no third-party UI dependencies.
The source is defect events: absent records cannot prove zero production defects.
"""
import copy, datetime as dt, os, tempfile
import pandas as pd
import engine

DIMENSIONS = {"employee": "_emp", "process": "_proc", "item": "_item"}
FILTERS = {"employees": "_emp", "processes": "_proc", "items": "_item", "products": "_prod", "shifts": "_shift"}

def defaults():
    return dict(period="day", start="", end="", dimension="process", top=8,
                employees=[], exclude_employees=[], processes=[], exclude_processes=[],
                employee_groups=[], process_groups=[], items=[], products=[], shifts=[])

def normalize(query):
    q = defaults()
    if not isinstance(query, dict): raise ValueError("分析条件必须是对象")
    q.update({k: v for k, v in query.items() if k in q})
    if q["period"] not in ("day", "week", "month"): raise ValueError("请选择日、周或月")
    if q["dimension"] not in DIMENSIONS: raise ValueError("未知分析维度")
    q["top"] = max(1, min(20, int(q["top"])))
    for k in q:
        if isinstance(defaults()[k], list):
            if not isinstance(q[k], list): raise ValueError("多选条件必须是列表：" + k)
            q[k] = list(dict.fromkeys(str(v).strip() for v in q[k] if str(v).strip()))
    return q

def period_start(day, period):
    day = pd.Timestamp(day).normalize()
    if period == "day": return day
    if period == "week": return day - pd.Timedelta(days=day.weekday())
    return day.replace(day=1)

def next_start(day, period):
    return day + (pd.DateOffset(months=1) if period == "month" else pd.Timedelta(days=7 if period == "week" else 1))

def previous_start(day, period):
    return day - (pd.DateOffset(months=1) if period == "month" else pd.Timedelta(days=7 if period == "week" else 1))

def filter_frame(A, q, raw):
    d = A
    for key, col in FILTERS.items():
        if q[key]: d = d[d[col].isin(q[key])]
    for key, col in (("exclude_employees", "_emp"), ("exclude_processes", "_proc")):
        if q[key]: d = d[~d[col].isin(q[key])]
    if q["employee_groups"]:
        names = {p["name"] for p in raw.get("people", []) if p.get("enabled", True)
                 and set(p.get("groups", [])) & set(q["employee_groups"])}
        d = d[d["_emp"].isin(names)]
    if q["process_groups"]:
        names = {v for g in raw.get("process_groups", []) if g.get("name") in q["process_groups"] for v in g.get("members", [])}
        d = d[d["_proc"].isin(names)]
    return d

def compute(A0, A, raw, query):
    q = normalize(query)
    if A0.empty: return dict(ok=True, empty=True, message="没有可分析的有效日期记录。", query=q)
    earliest, latest = A0["_date"].min(), A0["_date"].max()
    def date_value(v, fallback):
        if not v: return fallback
        try: return pd.Timestamp(dt.date.fromisoformat(str(v)))
        except (ValueError, TypeError): raise ValueError("日期须为 YYYY-MM-DD")
    end = date_value(q["end"], latest)
    span = {"day": pd.Timedelta(days=29), "week": pd.Timedelta(weeks=11), "month": pd.DateOffset(months=11)}[q["period"]]
    start = date_value(q["start"], period_start(end-span, q["period"]))
    if end < start: raise ValueError("开始日期不能晚于结束日期")
    if (end-start).days > 3660: raise ValueError("单次分析最多十年，请缩小日期范围")
    q.update(start=str(start.date()), end=str(end.date()))
    d = filter_frame(A, q, raw)
    selected = d[d["_date"].between(start, end)]
    col = DIMENSIONS[q["dimension"]]
    ranks = selected.groupby(col)["_qty"].sum().sort_values(ascending=False, kind="stable")
    source_dates = set(A0["_date"].tolist())
    # Aggregate once. Exports and charts consume the same returned rows.
    totals = d.groupby("_date")["_qty"].sum()
    grouped = d.groupby(["_date", col])["_qty"].sum()
    total = float(selected["_qty"].sum())
    top_names = list(ranks.head(q["top"]).index)
    series = [dict(name=str(n) or "（空白）", key=str(n), values=[]) for n in top_names]
    rows=[]
    cursor=period_start(start,q["period"])
    while cursor <= end:
        stop=next_start(cursor,q["period"])-pd.Timedelta(days=1)
        lo,hi=max(cursor,start),min(stop,end)
        days=pd.date_range(lo,hi)
        available=sum(day in source_dates for day in days)
        qty=float(totals.reindex(days,fill_value=0).sum())
        partial=lo!=cursor or hi!=stop or cursor<earliest or stop>latest
        prev=previous_start(cursor,q["period"])
        pdays=pd.date_range(prev,cursor-pd.Timedelta(days=1))
        # Conservative comparison: no implied zero when source days are missing.
        comparable=(not partial and all(day in source_dates for day in days)
                    and all(day in source_dates for day in pdays))
        prev_qty=float(totals.reindex(pdays,fill_value=0).sum()) if comparable else None
        change=(qty/prev_qty-1) if prev_qty else None
        status="不完整周期" if partial else "来源日期有缺口" if available<len(days) else "完整记录日期"
        if q["period"]=="week":
            iso=cursor.isocalendar();label=f"{iso.year}-W{iso.week:02d}"
        else: label=cursor.strftime("%Y-%m" if q["period"]=="month" else "%Y-%m-%d")
        rows.append(dict(label=label,start=str(lo.date()),end=str(hi.date()),quantity=qty if available else None,
                         source_days=available,calendar_days=len(days),previous=prev_qty,change=change,
                         status=status,comparison="基期为0" if prev_qty==0 else "可比较" if comparable else "数据或周期不完整"))
        for line,name in zip(series,top_names):
            line["values"].append(float(sum(grouped.get((day,name),0) for day in days)) if available else None)
        cursor=next_start(cursor,q["period"])
    notes=["统计值为不良记录数量（pcs）；同一产品多次记录可能重复贡献，不等于不良品台数。",
           "占比=当前筛选内该对象pcs÷当前筛选总pcs，不是不良率；员工/工序缺少对应检查量时不计算不良率。",
           "无来源记录的日期无法区分停产、未导入或零不良；不填成已确认的零。环比仅对前后完整且每天都有来源记录的周期计算。",
           "同一条件内多选为“或”，不同条件之间为“且”，排除条件优先；人员与工序组展开后按集合筛选，不重复计数。",
           "已应用全局筛选；这里的临时筛选不修改旧筛选方案。自然周为周一至周日，跨年按 ISO 周年。"]
    return dict(ok=True,empty=False,query=q,source=dict(start=str(earliest.date()),end=str(latest.date()),rows=len(A0)),
                summary=dict(quantity=total,records=len(selected),employees=int(selected["_emp"].nunique()),
                             processes=int(selected["_proc"].nunique()),source_days=sum(day in source_dates for day in pd.date_range(start,end))),
                periods=rows,series=series,ranking=[dict(name=str(n) or "（空白）",key=str(n),quantity=float(v),share=float(v/total) if total else 0) for n,v in ranks.items()],
                notes=notes)

def analyze(base,raw,query):
    raw=engine.merge_config(copy.deepcopy(raw))
    hist,_=engine.load_hist(base,raw)
    if hist.empty: return dict(ok=True,empty=True,message="还没有数据：请设置原表目录并扫描。",query=normalize(query))
    engine.ensure_fieldmap(raw,hist.columns)
    engine.ensure_defects(raw,hist,engine.build_cfg(raw)["roles"])
    cfg=engine.build_cfg(raw)
    roles=cfg["roles"]
    if any(k not in roles for k in ("责任员工","责任工序","不良代码")) or not (roles.get("业务日期") or roles.get("记录时间")):
        raise ValueError("必要字段未映射，请到“数据与字段”检查员工、工序、不良代码和日期。")
    A0,bad=engine.build_frame(hist,cfg)
    A,logs=engine.apply_global(A0,cfg)
    result=compute(A0,A,raw,query)
    result["bad_dates"]=bad
    result["global_log"]=logs
    result["raw_patch"]=dict(fieldmap=raw["fieldmap"],defects=raw["defects"])
    return result

def export(base,raw,query):
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill
    from openpyxl.chart import LineChart, Reference
    result=analyze(base,raw,query)
    if result.get("empty"): raise ValueError(result["message"])
    wb=Workbook();ws=wb.active;ws.title="周期趋势"
    ws.append(["周期","开始","结束","不良记录pcs","来源日期数","日历天数","前周期pcs","环比","状态","环比说明"])
    for r in result["periods"]:
        ws.append([r[k] for k in ("label","start","end","quantity","source_days","calendar_days","previous","change","status","comparison")])
        ws.cell(ws.max_row,8).number_format="0.0%"
    chart=LineChart();chart.title="不良记录数量趋势";chart.y_axis.title="pcs";chart.display_blanks="gap"
    chart.add_data(Reference(ws,min_col=4,min_row=1,max_row=ws.max_row),titles_from_data=True)
    chart.set_categories(Reference(ws,min_col=1,min_row=2,max_row=ws.max_row));ws.add_chart(chart,"L2")
    rank=wb.create_sheet("对象排行");rank.append(["对象","不良记录pcs","筛选内占比"])
    for r in result["ranking"]:
        rank.append([r["name"],r["quantity"],r["share"]]);rank.cell(rank.max_row,3).number_format="0.0%"
    lines=wb.create_sheet("对象趋势");lines.append(["周期"]+[r["name"] for r in result["series"]])
    for i,row in enumerate(result["periods"]): lines.append([row["label"]]+[r["values"][i] for r in result["series"]])
    info=wb.create_sheet("筛选与口径");info.append(["条件","值"])
    labels = dict(period="周期", start="开始日期", end="结束日期", dimension="对比维度", top="排行数量", employees="指定员工", exclude_employees="排除员工", processes="指定工序", exclude_processes="排除工序", employee_groups="人员组", process_groups="工序组", items="不良项目", products="产品", shifts="班别")
    for key,val in result["query"].items(): info.append([labels.get(key,key),"、".join(val) if isinstance(val,list) else val])
    info.append(["数据来源日期范围",result["source"]["start"] + " ～ " + result["source"]["end"]])
    for note in result["notes"]: info.append(["统计说明",note])
    info.append(["全局筛选配置",__import__("json").dumps({"P":raw.get("P",{}),"rules":raw.get("rules",[])},ensure_ascii=False)])
    for sheet in wb:
        sheet.freeze_panes="A2";sheet.auto_filter.ref=sheet.dimensions
        for cell in sheet[1]: cell.fill=PatternFill("solid",fgColor="163F48");cell.font=Font(color="FFFFFF",bold=True)
        for column in sheet.columns: sheet.column_dimensions[column[0].column_letter].width=22
        # Untrusted names must remain text, never Excel formulas.
        for row in sheet:
            for cell in row:
                if isinstance(cell.value,str): cell.data_type="s"
    info.column_dimensions["B"].width=100
    folder=engine.abspath(base,raw["paths"]["output"]);os.makedirs(folder,exist_ok=True)
    name="趋势分析_"+result["query"]["period"]+"_"+dt.datetime.now().strftime("%Y%m%d_%H%M%S_%f")+".xlsx"
    path=os.path.join(folder,name)
    fd,tmp=tempfile.mkstemp(suffix=".xlsx",dir=folder);os.close(fd)
    try: wb.save(tmp);os.replace(tmp,path)
    finally:
        if os.path.exists(tmp):os.unlink(tmp)
    return dict(ok=True,path=path)
