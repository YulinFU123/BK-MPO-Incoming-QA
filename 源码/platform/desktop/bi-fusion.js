'use strict';
// Loaded after the preserved BI scripts, before boot. No local web server.
api = async function (route, body) {
  try {
    const result = await window.bi.request(body === undefined ? { route } : { route, body });
    if (!result.ok) {
      toast(result.error || '操作未完成', 'bad');
      return { ok: false, error: result.error };
    }
    const value = result.value;
    if (value?.ok === false && value.error) toast(value.error, 'bad');
    return value;
  } catch {
    toast('分析进程连接已中断，请回到数据安全页重新打开工作区。', 'bad');
    return { ok: false };
  }
};
let fusionPage = 'daily';
let fusionFiltersExpanded = false;
const originalTrendResultPanel = resultPanel;
resultPanel = function (el) {
  const index = el.children.length;
  originalTrendResultPanel(el);
  if (!TR.result || TR.pending || TR.error || TR.dirty || TR.resultKey !== trendKey()) return;
  const summary = window.InsightSummary.create(window.AnalysisInsights.bi(TR.result), {
    onAction: (action) => {
      if (TR.dirty || TR.resultKey !== trendKey()) return;
      if (action.kind === 'bi-group') {
        const row = TR.result.ranking?.find((item) => item.key === action.key);
        if (row) trendDrill(row);
      }
    },
  });
  el.insertBefore(summary, el.children[index] || null);
};
// Only the presentation is replaced; BI periods and quantities come from the original engine.
trendChart = function (rows, lines) {
  return window.ChartSurface.create({
    title: 'BI不良数量趋势',
    unit: 'pcs',
    labels: rows.map((row) => row.label),
    fullLabels: rows.map((row) => row.start + ' 至 ' + row.end),
    series: lines.map((line) => ({ name: line.name, values: line.values })),
  });
};
const originalDailyChartSvg = dailyChartSvg;
dailyChartSvg = function (title, rows, result, query, maximum, trend) {
  const graphic = originalDailyChartSvg(title, rows, result, query, maximum, trend);
  if (!rows.length || !Number.isFinite(maximum) || maximum <= 0) return graphic;
  // The static PNG keeps original row order, quantities and denominator notes.
  const group = svgEl('g', { 'aria-label': '数量刻度，单位pcs' });
  for (let i = 0; i <= 4; i++) {
    const x = 385 + (545 * i) / 4;
    group.append(
      svgEl('line', {
        x1: x,
        x2: x,
        y1: 108,
        y2: 112 + rows.length * 50,
        stroke: '#a8b7c6',
        'stroke-width': 1,
      }),
    );
    group.append(
      svgEl(
        'text',
        { x, y: 105, 'text-anchor': 'middle', 'font-size': 12, fill: '#405467' },
        window.ChartSurface.format((maximum * i) / 4),
      ),
    );
  }
  graphic.insertBefore(group, graphic.children[1]);
  return graphic;
};
window.bi.onNavigate((page) => {
  fusionPage = page;
  if (S.cfg && PAGES[page]) go(page);
});
window.bi.onFlush(async (id) => {
  try {
    clearTimeout(saveT);
    await saveChain;
    if (S.cfg) {
      const result = await api('/api/save', { config: clone(S.cfg) });
      if (!result?.ok) throw new Error('save');
    }
    if (
      typeof dailySave === 'function' &&
      typeof D !== 'undefined' &&
      D.ready &&
      !(await dailySave())
    )
      throw new Error('daily save');
    const status = await api('/api/status');
    if (status.running) throw new Error('busy');
    window.bi.flushReady(id, true);
  } catch {
    window.bi.flushReady(id, false);
  }
});
// Keep graph previews, remove only decorative glyphs from control labels.
function cleanControls() {
  const page = document.getElementById('page');
  if (page && S.page) {
    page.dataset.biPage = S.page;
    page.setAttribute('role', 'region');
    page.setAttribute(
      'aria-label',
      window.WorkbenchNavigation?.getRoute('bi-' + S.page)?.title || 'BI分析内容',
    );
  }
  if (S.page === 'trends')
    for (const card of document.querySelectorAll('#page>.card')) {
      const header = card.querySelector(':scope>.hd');
      if (
        header?.querySelector('h3')?.textContent !== '分析范围' ||
        card.querySelector('.fusion-filter-card')
      )
        continue;
      const details = document.createElement('details'),
        summary = document.createElement('summary'),
        body = document.createElement('div');
      details.className = 'fusion-filter-card';
      details.open = fusionFiltersExpanded;
      body.className = 'fusion-filter-body';
      summary.append(header);
      const hint = document.createElement('span');
      hint.className = 'fusion-filter-hint';
      hint.textContent = '展开筛选和周期设置';
      summary.append(hint);
      for (const child of [...card.childNodes]) body.append(child);
      details.append(summary, body);
      card.append(details);
      details.addEventListener('toggle', () => {
        fusionFiltersExpanded = details.open;
        hint.textContent = details.open ? '收起筛选设置' : '展开筛选和周期设置';
      });
    }
  for (const node of document.querySelectorAll('button,.btn'))
    for (const text of [...node.childNodes])
      if (text.nodeType === Node.TEXT_NODE) {
        const cleaned = text.textContent.replace(/^[\s▶►⬇⬆✓✔✘✕⚙↻⟳↗＋]+/u, '').trimStart();
        if (cleaned !== text.textContent) text.textContent = cleaned;
      }
}
new MutationObserver(cleanControls).observe(document.body, { subtree: true, childList: true });
boot().then(() => {
  if (PAGES[fusionPage]) go(fusionPage);
  cleanControls();
});
