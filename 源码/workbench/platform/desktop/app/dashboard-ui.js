'use strict';
window.createDashboard = ({ api, getContext, getScope, onNavigate }) => {
  const $ = (id) => document.getElementById(id);
  const model = window.DashboardModel;
  const make = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = String(text);
    return n;
  };
  let lastTrendSummary = null,
    lastTrendWidth = 0;
  let trendFrame = 0;
  let epoch = 0,
    detailEpoch = 0,
    saved = null,
    detail = null;
  const valid = (ticket) => ticket === epoch && getContext().unlocked;
  function message(target, text, error = false) {
    const n = make('p', 'dashboard-message' + (error ? ' dashboard-error' : ''), text);
    if (error) n.setAttribute('role', 'alert');
    target.replaceChildren(n);
  }
  function closeDetail() {
    detailEpoch++;
    detail = null;
    if ($('dashboardDetail').open) $('dashboardDetail').close();
    $('dashboardDetailBody').replaceChildren();
  }
  async function detailPage(page) {
    if (!detail || !getContext().unlocked) return;
    const current = detail,
      ticket = ++detailEpoch;
    message($('dashboardDetailBody'), '正在读取对应明细…');
    $('dashboardPrevious').disabled = $('dashboardNext').disabled = true;
    $('dashboardDetailPage').textContent = '正在读取';
    try {
      const query = model.detailQuery(current.scope, current.source, { ...current.filter, page });
      const result = await api('listData', query);
      if (ticket !== detailEpoch || detail !== current || !getContext().unlocked) return;
      current.page = result.page;
      const root = $('dashboardDetailBody');
      root.replaceChildren();
      const table = make('table', 'dashboard-data-table');
      const head = make('thead'),
        hrow = make('tr');
      for (const text of ['序号', ...result.columns.map((c) => c.label)]) {
        const th = make('th', '', text);
        th.scope = 'col';
        hrow.append(th);
      }
      head.append(hrow);
      table.append(head);
      const body = make('tbody');
      result.rows.forEach((row, index) => {
        const tr = make('tr');
        tr.append(make('td', '', (result.page - 1) * result.pageSize + index + 1));
        for (const c of result.columns)
          tr.append(
            make('td', '', row[c.key] === null || row[c.key] === undefined ? '—' : row[c.key]),
          );
        body.append(tr);
      });
      table.append(body);
      root.append(table);
      if (!result.rows.length)
        root.append(make('p', 'dashboard-message', '当前条件没有明细。缺少数据不代表不良率为零。'));
      $('dashboardDetailPage').textContent =
        `共 ${model.number(result.total)} 行 · 第 ${result.page} 页`;
      $('dashboardPrevious').disabled = result.page <= 1;
      $('dashboardNext').disabled = result.page * result.pageSize >= result.total;
    } catch (error) {
      if (ticket !== detailEpoch || detail !== current || !getContext().unlocked) return;
      message($('dashboardDetailBody'), `明细未读取：${error.message}`, true);
      $('dashboardDetailPage').textContent = '读取失败，可重试';
    }
  }
  function openDetail(title, source, filter = {}, explanation = '') {
    if (!saved || !getContext().unlocked) return;
    closeDetail();
    detail = { scope: structuredClone(saved.scope), source, filter, page: 1 };
    $('dashboardDetailTitle').textContent = title;
    $('dashboardDetailScope').textContent =
      `${filter.date || saved.scope.start} 至 ${filter.date || saved.scope.end} · ${source === 'quality' ? saved.datasetLabel : '原异常记录'}${filter.issue !== undefined ? ' · 分类：' + (filter.issue || '未填写') : ''}`;
    const filters = Object.entries(saved.scope.filters)
      .map(([key, value]) => `${saved.dimensionNames[key] || key}：${value}`)
      .join('；');
    $('dashboardDetailExplanation').textContent =
      (explanation || '明细按当前范围和条件读取；记录条数与不良件数分别统计。') +
      (filters ? ` 筛选：${filters}。` : ' 未附加维度筛选。');
    $('dashboardDetail').showModal();
    detailPage(1);
  }
  function renderCards(summary) {
    const root = $('dashboardCards');
    root.replaceChildren();
    for (const card of summary.cards) {
      const button = make('button', 'dashboard-metric dashboard-' + card.id);
      button.type = 'button';
      button.dataset.dashboardMetric = card.id;
      button.setAttribute(
        'aria-label',
        `${card.title} ${card.display}${card.unit}，查看统计口径与明细`,
      );
      button.append(make('span', 'dashboard-metric-label', card.title));
      const value = make('span', 'dashboard-metric-value');
      const badge = make(
        'span',
        'dashboard-metric-symbol',
        { records: '记', inspected: '检', defective: '不', rate: '%' }[card.id],
      );
      badge.setAttribute('aria-hidden', 'true');
      value.append(badge);
      value.append(make('strong', '', card.display), make('small', '', card.unit));
      button.append(
        value,
        make('span', 'dashboard-metric-note', card.note),
        make('span', 'dashboard-metric-action', '统计口径与明细'),
      );
      button.onclick = () =>
        openDetail(card.title + '明细', card.source, {}, card.formula + ' ' + card.note);
      if (!summary.observationAvailable && card.source === 'observations') {
        button.disabled = true;
        button.title = '异常记录无法应用当前维度筛选，请调整筛选。';
      }
      if (card.source === 'quality' && !saved.scope.datasetId) button.disabled = true;
      root.append(button);
    }
  }
  function renderTrend(summary) {
    const target = $('dashboardTrend');
    lastTrendSummary = summary;
    lastTrendWidth = target.clientWidth;
    target.replaceChildren();
    if (!summary.trend.length) {
      message(
        target,
        summary.observationAvailable
          ? '当前首页尚无趋势汇总；可查看原异常记录趋势，不需要先导入检验数量。'
          : '异常记录不支持当前筛选，无法显示同口径趋势。',
      );
      const button = make('button', 'button secondary', '打开异常记录趋势');
      button.type = 'button';
      button.onclick = () => onNavigate('legacy-analysis');
      target.append(button);
      return;
    }
    target.append(
      window.ChartSurface.create({
        title: '异常记录日趋势',
        compact: true,
        minimumWidth: Math.max(360, target.clientWidth - 2),
        unit: '条记录',
        labels: summary.trend.map((d) => d.date.slice(5)),
        fullLabels: summary.trend.map((d) => d.date),
        series: [{ name: '异常记录', values: summary.trend.map((d) => d.recordCount) }],
        onPoint: (_series, i) =>
          openDetail(`${summary.trend[i].date} 异常记录`, 'observations', {
            date: summary.trend[i].date,
          }),
      }),
    );
  }
  function renderIssues(summary) {
    const target = $('dashboardIssues');
    target.replaceChildren();
    if (!summary.issues.length) {
      message(
        target,
        summary.observationAvailable
          ? '当前范围没有异常分类数据。'
          : '当前筛选无法用于异常记录分类。',
      );
      return;
    }
    const palette = ['#1680ff', '#ff9b48', '#25c28b', '#8d68e8', '#f1c34a', '#43bbcf'];
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 180 180');
    svg.setAttribute('class', 'home-donut');
    svg.setAttribute('role', 'group');
    svg.setAttribute('aria-label', `异常分类构成，共${summary.recordCount}条`);
    let offset = 0;
    summary.issues.forEach((item, index) => {
      const circle = document.createElementNS(ns, 'circle');
      const length = 2 * Math.PI * 61;
      for (const [key, value] of Object.entries({
        cx: 90,
        cy: 90,
        r: 61,
        fill: 'none',
        stroke: palette[index % palette.length],
        'stroke-width': 22,
        'stroke-dasharray': `${item.share * length} ${length}`,
        'stroke-dashoffset': -offset * length,
        transform: 'rotate(-90 90 90)',
        role: 'button',
        tabindex: 0,
        'aria-label': `${item.issue || '未填写异常'}，${item.count}条，${(item.share * 100).toFixed(1)}%`,
      }))
        circle.setAttribute(key, value);
      const open = () =>
        openDetail(
          item.issue || '未填写异常',
          'observations',
          { issue: item.issue },
          `构成占比 ${(item.share * 100).toFixed(1)}%；分母为当前范围${summary.recordCount}条异常记录，不是不良率。`,
        );
      circle.onclick = open;
      circle.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      };
      svg.append(circle);
      offset += item.share;
    });
    for (const [text, y, cls] of [
      [model.number(summary.recordCount), 92, 'home-donut-value'],
      ['异常记录', 111, 'home-donut-label'],
    ]) {
      const n = document.createElementNS(ns, 'text');
      n.setAttribute('x', 90);
      n.setAttribute('y', y);
      n.setAttribute('text-anchor', 'middle');
      n.setAttribute('class', cls);
      n.textContent = text;
      svg.append(n);
    }
    const legend = make('div', 'home-donut-legend');
    target.append(svg, legend);
    for (const [index, item] of summary.issues.entries()) {
      const button = make('button', 'dashboard-issue');
      button.type = 'button';
      const heading = make('span', 'dashboard-issue-heading');
      const dot = make('i', 'home-legend-dot');
      dot.style.backgroundColor = palette[index % palette.length];
      heading.append(dot);
      heading.append(
        make('strong', '', item.issue || '未填写异常'),
        make('span', '', `${model.number(item.count)} 条 · ${(item.share * 100).toFixed(1)}%`),
      );
      const track = make('span', 'dashboard-issue-track'),
        bar = make('span');
      bar.style.width = `${item.share * 100}%`;
      track.append(bar);
      button.append(heading, track, make('small', '', '查看该分类记录'));
      button.onclick = () =>
        openDetail(
          `${item.issue || '未填写异常'} · ${model.number(item.count)} 条`,
          'observations',
          { issue: item.issue },
          `构成占比 ${(item.share * 100).toFixed(1)}%；分母为当前范围 ${model.number(summary.recordCount)} 条异常记录，不是不良率。`,
        );
      legend.append(button);
    }
  }
  function renderRecent(result, error) {
    const root = $('dashboardRecent');
    root.replaceChildren();
    if (error) {
      message(root, `最近记录未读取：${error.message}`, true);
      return;
    }
    if (!result?.rows.length) {
      message(root, '当前范围暂无有效日期的异常记录。');
      return;
    }
    const table = make('table', 'dashboard-data-table'),
      thead = make('thead'),
      head = make('tr');
    const columns = [
      ['observedOn', '发现日期'],
      ['serialNumber', 'SN'],
      ['issue', '异常现象'],
      ['relatedCode', '关联编号'],
    ];
    for (const [, label] of columns) {
      const th = make('th', '', label);
      th.scope = 'col';
      head.append(th);
    }
    head.append(make('th', '', '明细'));
    thead.append(head);
    table.append(thead);
    const body = make('tbody');
    for (const row of result.rows.slice(0, 5)) {
      const tr = make('tr');
      for (const [key] of columns) tr.append(make('td', '', row[key] || '未填写'));
      const td = make('td'),
        button = make('button', 'button quiet', '查看');
      button.type = 'button';
      button.setAttribute('aria-label', `查看 ${row.serialNumber || row.id} 的记录`);
      button.onclick = () => openDetail('单条异常记录', 'observations', { rowId: row.id });
      td.append(button);
      tr.append(td);
      body.append(tr);
    }
    table.append(body);
    root.append(table);
  }
  function invalidate() {
    const ticket = ++epoch;
    cancelAnimationFrame(trendFrame);
    trendFrame = 0;
    lastTrendSummary = null;
    closeDetail();
    saved = null;
    $('dashboardCards').replaceChildren();
    for (const id of ['dashboardTrend', 'dashboardIssues', 'dashboardRecent'])
      message($(id), '正在读取当前范围…');
    $('dashboardFeedback').textContent = '正在刷新数据…';
    $('dashboardRange').textContent = '正在读取上方所选日期范围…';
    return ticket;
  }
  function fail(text) {
    if (!getContext().unlocked) return;
    invalidate();
    message($('dashboardCards'), '来源未读取，本次不显示旧数值。请刷新重试。', true);
    $('dashboardFeedback').textContent = text;
    for (const id of ['dashboardTrend', 'dashboardIssues', 'dashboardRecent'])
      message($(id), '来源未读取，请刷新重试。', true);
  }
  async function load() {
    const context = getContext();
    if (!context.unlocked) return;
    const ticket = invalidate();
    try {
      const scope = structuredClone(getScope());
      const [report, recent] = await Promise.allSettled([
        scope.datasetId ? api('overview', scope) : Promise.resolve(null),
        api('listData', { ...model.detailQuery(scope, 'observations'), pageSize: 5 }),
      ]);
      if (!valid(ticket)) return;
      saved = {
        scope,
        datasetLabel: context.datasetLabel || '未选择检验数据集',
        dimensionNames: context.dimensionNames,
      };
      const data = report.status === 'fulfilled' ? report.value : null;
      const recentData = recent.status === 'fulfilled' ? recent.value : null;
      const summary = model.summarize(data, recentData?.total ?? null, context.reasonLabels);
      $('dashboardRange').textContent =
        `${scope.start} 至 ${scope.end} · 检验来源：${saved.datasetLabel}`;
      renderCards(summary);
      renderTrend(summary);
      renderIssues(summary);
      renderRecent(recentData, recent.status === 'rejected' ? recent.reason : null);
      $('dashboardFeedback').textContent =
        report.status === 'rejected'
          ? `汇总未读取：${report.reason.message}。请重试。`
          : `已刷新 ${new Date().toLocaleTimeString('zh-CN')} · 点击卡片、数据点或分类查看明细`;
      if (report.status === 'rejected') {
        $('dashboardCards').replaceChildren();
        message($('dashboardCards'), '汇总未读取，本次不显示上次数值。请刷新重试。', true);
      }
    } catch (error) {
      if (!valid(ticket)) return;
      saved = null;
      $('dashboardCards').replaceChildren();
      for (const id of ['dashboardTrend', 'dashboardIssues', 'dashboardRecent'])
        message($(id), '当前范围无效，请检查日期后重试。', true);
      $('dashboardFeedback').textContent = error.message;
    }
  }
  $('dashboardRefresh').onclick = load;
  const trendResize = new ResizeObserver(() => {
    cancelAnimationFrame(trendFrame);
    // Read/paint on the next frame rather than changing the observed box
    // inside the observer delivery cycle.
    trendFrame = requestAnimationFrame(() => {
      trendFrame = 0;
      const width = $('dashboardTrend').clientWidth;
      if (
        lastTrendSummary &&
        getContext().unlocked &&
        width > 0 &&
        Math.abs(width - lastTrendWidth) > 1
      )
        renderTrend(lastTrendSummary);
    });
  });
  trendResize.observe($('dashboardTrend'));
  $('dashboardDetailClose').onclick = closeDetail;
  $('dashboardDetail').addEventListener('close', () => {
    if (!$('dashboardDetail').open) {
      detailEpoch++;
      detail = null;
      $('dashboardDetailBody').replaceChildren();
    }
  });
  $('dashboardPrevious').onclick = () => detailPage(Math.max(1, detail.page - 1));
  $('dashboardNext').onclick = () => detailPage(detail.page + 1);
  $('dashboardDetailRetry').onclick = () => detailPage(detail?.page || 1);
  $('dashboardAllRecords').onclick = () => openDetail('当前范围异常记录', 'observations');
  return Object.freeze({
    load,
    invalidate,
    fail,
    clear() {
      cancelAnimationFrame(trendFrame);
      trendFrame = 0;
      lastTrendSummary = null;
      epoch++;
      saved = null;
      closeDetail();
      for (const id of ['dashboardCards', 'dashboardTrend', 'dashboardIssues', 'dashboardRecent'])
        $(id).replaceChildren();
      for (const id of [
        'dashboardRange',
        'dashboardFeedback',
        'dashboardDetailTitle',
        'dashboardDetailScope',
        'dashboardDetailExplanation',
        'dashboardDetailPage',
      ])
        $(id).textContent = '';
    },
  });
};
