'use strict';
// Shared BI preview rendering for the workspace manager. Counts never become workflow KPIs.
window.WorkspaceBIView = (() => {
  const el = (tag, cls = '', text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = String(text);
    return n;
  };
  function table(rows, unit, info = {}) {
    const wrap = el('div', 'wm-table-wrap'),
      t = el('table'),
      head = el('thead'),
      tr = el('tr');
    const columns = [
      ['date', '业务日期'],
      ['process', window.BIFieldLabels.process(info)],
      ['issue', '不良项'],
      ['quantity', '不良数量（' + unit + '）'],
      ['employee', 'BI责任员工'],
      ['reporter', '报检人'],
      ['shift', '班次'],
      ['sn', 'SN'],
    ];
    columns.forEach(([, label]) => tr.append(el('th', '', label)));
    head.append(tr);
    t.append(head);
    const body = el('tbody');
    for (const row of rows || []) {
      const line = el('tr');
      for (const [key] of columns)
        line.append(
          el('td', '', key === 'quantity' ? window.HomeGraphics.fmt(row[key]) : row[key] || '—'),
        );
      body.append(line);
    }
    t.append(body);
    wrap.append(t);
    if (!rows?.length) wrap.append(el('p', 'wm-note', '当前条件没有匹配的BI明细。'));
    return wrap;
  }
  function render(body, { report, button, panel, onAll, onOpen, onDetails }) {
    const G = window.HomeGraphics,
      bi = report.biSource || {},
      ok = report.primary.available,
      unit = bi.unitLabel || '未确认';
    body.append(el('h3', 'wm-section-label', '工作区不良数据预览 · BI自由分析'));
    const metrics = el('div', 'wm-metrics');
    for (const [label, value, note, color] of [
      ['不良数量', ok ? bi.quantity : null, unit, 'blue'],
      ['BI明细行数', ok ? bi.rowCount : null, '不与人工记录条数相加', 'coral'],
      [
        '上期不良数量',
        ok ? bi.previousQuantity : null,
        bi.previousQuantity == null ? '来源覆盖不完整时不推算' : '同长上期 · ' + unit,
        'amber',
      ],
      ['有数据天数', ok ? bi.coverageDays : null, '缺失日期不等于零不良', 'green'],
    ]) {
      const card = el('div', 'wm-metric ' + color);
      card.append(el('small', '', label), el('strong', '', G.fmt(value)), el('span', '', note));
      metrics.append(card);
    }
    body.append(
      metrics,
      el(
        'p',
        'wm-note',
        '来源：' +
          (bi.sourceName || '本工作区BI自由分析') +
          '。人工跟进状态、关闭率及检验件数不作为BI指标。',
      ),
    );
    if (bi.availableRange)
      body.append(
        el(
          'p',
          'wm-period',
          `已有BI日期 ${bi.availableRange.start} 至 ${bi.availableRange.end} · 共 ${G.fmt(bi.availableRowCount)} 行`,
        ),
      );
    if (!ok) {
      const state = el('section', 'wm-bi-state');
      state.setAttribute('role', 'status');
      state.append(el('p', '', bi.message || '此工作区尚未导入BI数据，未以人工0条替代。'));
      if (bi.availableRange) state.append(button('查看全部已有BI日期', onAll, 'primary'));
      state.append(button('打开BI数据源与分析', onOpen));
      body.append(state);
      return;
    }
    body.append(
      el(
        'p',
        'wm-period',
        `${report.scope.start} 至 ${report.scope.end} · 按当前导入映射和班次规则统计`,
      ),
    );
    const grid = el('div', 'wm-chart-grid'),
      fullTrend = bi.trend || [],
      first = fullTrend.findIndex((x) => Number.isFinite(x.quantity)),
      last = fullTrend.findLastIndex((x) => Number.isFinite(x.quantity)),
      trend = first < 0 ? [] : fullTrend.slice(first, last + 1);
    body.append(
      el(
        'p',
        'wm-note',
        trend.length === 1
          ? '当前仅1个有数据周期，暂不能判断变化趋势。'
          : '趋势图显示首尾有数据日期之间的周期，区间内缺失保留断点；统计总数仍按上方筛选范围。',
      ),
    );
    grid.append(
      panel(
        '不良数量趋势（' + unit + '）',
        window.ChartSurface.create({
          title: '工作区BI不良数量趋势',
          unit,
          compact: true,
          labels: trend.map((x) => (x.start === x.end ? x.start.slice(5) : x.key.slice(5))),
          fullLabels: trend.map((x) => `${x.start} 至 ${x.end}，来源${x.covered}/${x.days}天`),
          series: [{ name: '不良数量', values: trend.map((x) => x.quantity) }],
          onPoint: (_series, index) =>
            onDetails('周期BI明细', { start: trend[index].start, end: trend[index].end }),
        }),
        'wm-chart-wide',
      ),
      panel(
        '不良类型分布',
        G.donut(
          bi.issues,
          bi.quantity,
          (value) => onDetails(value || '未填写不良项', { biFilter: { field: 'issue', value } }),
          { unit, label: '不良数量', quantity: true },
        ),
      ),
      panel(
        window.BIFieldLabels.process(bi) + '不良分布',
        G.ranking(bi.processes, {
          unit,
          onSelect: (value) =>
            onDetails(value || '未填写' + window.BIFieldLabels.process(bi), {
              biFilter: { field: 'process', value },
            }),
        }),
      ),
      panel(
        'BI责任员工关联数量 Top 5',
        G.ranking(bi.employees, {
          unit,
          limit: 5,
          onSelect: (value) =>
            onDetails(value || '未填写员工', { biFilter: { field: 'employee', value } }),
        }),
        'wm-chart-wide',
      ),
    );
    body.append(grid);
    const recent = el('section', 'wm-recent');
    recent.append(
      el('h3', '', '最近BI不良明细'),
      button('完整BI分析', onOpen),
      table(bi.rows, unit, bi),
    );
    body.append(recent);
    body.append(
      el(
        'p',
        'wm-note',
        bi.note || '按实际来源口径统计；不良数量不自动等于去重件数，没有匹配产量不计算真实不良率。',
      ),
    );
  }
  return Object.freeze({ render, table });
})();
