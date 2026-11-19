'use strict';
// Reuse computed original analysis data and the original clickable point/bar nodes.
(() => {
  if (!window.AnalyticsUI || !window.InsightsUI || window.LegacyChartPresentation) return;
  const originalAnalysis = window.AnalyticsUI,
    originalInsights = window.InsightsUI;
  let analysisData = null,
    insightData = null;
  const svg = (tag, attrs, text) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    if (text !== undefined) node.textContent = text;
    return node;
  };
  function trend() {
    const data = analysisData,
      box = document.getElementById('trendPlot');
    if (!data || !box) return;
    const originalPoints = [...box.querySelectorAll('.chart-point')];
    const reference = document.getElementById('analysisReference').value;
    const series = [{ name: '本期异常记录', values: data.buckets.map((row) => row.count) }];
    if (reference === 'previous' && data.comparable)
      series.push({
        name: '前期记录（等长对齐）',
        values: data.buckets.map((row) => row.previousCount),
      });
    if (reference === 'average' && data.bucketType === 'day')
      series.push({ name: '7日移动平均', values: data.buckets.map((row) => row.average) });
    const chart = window.ChartSurface.create({
      title: '异常记录趋势',
      minimumWidth: Math.max(480, box.clientWidth),
      unit: '条记录',
      dataTable: false,
      labels: data.buckets.map((row) => row.label),
      fullLabels: data.buckets.map(
        (row) => row.start + ' 至 ' + row.end + (row.partial ? '（部分周期）' : ''),
      ),
      series,
      pointNode: (line, index) => (line === 0 ? originalPoints[index] : null),
      onReadout: (message) => {
        document.getElementById('trendReadout').textContent = message;
      },
    });
    box.replaceChildren(chart);
    let narrative = document.getElementById('fusionAnalysisInsights');
    if (!narrative) {
      narrative = document.createElement('div');
      narrative.id = 'fusionAnalysisInsights';
      box.closest('.trend-section').before(narrative);
    }
    narrative.replaceChildren(
      window.InsightSummary.create(window.AnalysisInsights.legacy(data), {
        onAction: (action) => {
          if (action.kind !== 'legacy-period') return;
          const index = data.buckets.findIndex(
            (row) => row.start === action.start && row.end === action.end,
          );
          if (index >= 0)
            box
              .querySelectorAll('.chart-point')
              [index]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        },
      }),
    );
    const oldLegend = box.closest('.trend-section')?.querySelector(':scope>.chart-legend');
    if (oldLegend) oldLegend.hidden = true;
    const summary = document.getElementById('analysisSummary');
    if (summary && !summary.previousElementSibling?.classList.contains('chart-heading'))
      box.closest('.trend-scroll').before(summary);
  }
  function pareto() {
    const graphic = document.querySelector('#paretoPlot .pareto-svg'),
      source = insightData?.insights?.pareto;
    if (!graphic || !source?.length) return;
    const bars = [...graphic.querySelectorAll('.pareto-bar')];
    const plotted = source
      .slice(0, 10)
      .map((item) => ({ ...item, label: item.key === '' ? '未填写（空）' : item.label }));
    if (source.length > 10)
      plotted.push({
        label: '其他 ' + (source.length - 10) + ' 类',
        count: source.slice(10).reduce((sum, item) => sum + item.count, 0),
        cumulative: 1,
      });
    if (bars.length !== plotted.length) return;
    const width = 960,
      height = 330,
      left = 68,
      right = 76,
      top = 36,
      bottom = 90;
    const plotHeight = height - top - bottom,
      plotWidth = width - left - right;
    const scale = window.ChartSurface.scale(
      plotted.map((item) => item.count),
      true,
    );
    const yCount = (value) => top + (1 - value / scale.max) * plotHeight;
    const yPercent = (value) => top + (1 - value) * plotHeight;
    const x = (i) => left + ((i + 0.5) * plotWidth) / plotted.length,
      barWidth = Math.min(56, (plotWidth / plotted.length) * 0.58);
    graphic.setAttribute('viewBox', `0 0 ${width} ${height}`);
    graphic.replaceChildren();
    graphic.append(
      svg('text', { x: 10, y: 18, class: 'chart-axis' }, '记录数（条）'),
      svg(
        'text',
        { x: width - 12, y: 18, 'text-anchor': 'end', class: 'chart-axis' },
        '累计占比（%）',
      ),
    );
    for (const value of scale.ticks)
      graphic.append(
        svg('line', {
          x1: left,
          x2: width - right,
          y1: yCount(value),
          y2: yCount(value),
          class: 'chart-grid',
        }),
        svg(
          'text',
          { x: left - 10, y: yCount(value) + 4, 'text-anchor': 'end', class: 'chart-axis' },
          value,
        ),
      );
    for (const value of [0, 0.25, 0.5, 0.75, 1])
      graphic.append(
        svg(
          'text',
          { x: width - right + 10, y: yPercent(value) + 4, class: 'chart-axis' },
          value * 100 + '%',
        ),
      );
    const threshold = Number(document.getElementById('paretoThreshold').value);
    graphic.append(
      svg('line', {
        x1: left,
        x2: width - right,
        y1: yPercent(threshold),
        y2: yPercent(threshold),
        class: 'pareto-reference',
      }),
    );
    let path = '';
    plotted.forEach((item, i) => {
      const bar = bars[i];
      for (const [key, value] of Object.entries({
        x: x(i) - barWidth / 2,
        y: yCount(item.count),
        width: barWidth,
        height: top + plotHeight - yCount(item.count),
      }))
        bar.setAttribute(key, String(value));
      graphic.append(
        bar,
        svg(
          'text',
          {
            x: x(i),
            y: height - bottom + 25,
            'text-anchor': 'middle',
            class: 'chart-axis',
            'data-full-label': item.label,
          },
          item.label,
        ),
        svg(
          'text',
          {
            x: x(i),
            y: height - bottom + 49,
            'text-anchor': 'middle',
            class: 'pareto-value',
            'data-count': item.count,
          },
          item.count + '条',
        ),
      );
      graphic.append(
        svg('circle', { cx: x(i), cy: yPercent(item.cumulative), r: 4, class: 'pareto-point' }),
        svg(
          'text',
          {
            x: x(i),
            y: yPercent(item.cumulative) - 11,
            'text-anchor': 'middle',
            class: 'pareto-value',
            'data-cumulative': item.cumulative,
          },
          window.ChartSurface.format(item.cumulative, true),
        ),
      );
      path += (i ? ' L' : 'M') + x(i) + ',' + yPercent(item.cumulative);
    });
    graphic.append(svg('path', { d: path, fill: 'none', class: 'pareto-line' }));
  }
  window.AnalyticsUI = Object.freeze({
    ...originalAnalysis,
    render(data, handlers) {
      analysisData = data;
      originalAnalysis.render(data, handlers);
      trend();
    },
  });
  window.InsightsUI = Object.freeze({
    ...originalInsights,
    render(data, handlers) {
      insightData = data;
      originalInsights.render(data, handlers);
      pareto();
    },
  });
  document.getElementById('analysisReference').addEventListener('change', () => {
    trend();
  });
  document.getElementById('analysisChangeSort').addEventListener('change', () => {
    trend();
  });
  document.getElementById('analysisExpandCombos').addEventListener('click', () => {
    trend();
  });
  document.getElementById('paretoThreshold').addEventListener('change', () => {
    pareto();
  });
  document.getElementById('paretoExpand').addEventListener('click', () => {
    pareto();
  });
  window.LegacyChartPresentation = Object.freeze({ trend, pareto });
  // The original app can render before this adapter is injected. Refresh its
  // original calculation once after readiness so first navigation never shows
  // the obsolete unlabelled graph. Later user ranges/filters are untouched.
  const firstPaint = new MutationObserver(ensureFirstPaint);
  function ensureFirstPaint() {
    if (analysisData) {
      firstPaint.disconnect();
      return;
    }
    if (
      !document.getElementById('workspace')?.hidden &&
      document.getElementById('analysisKpis')?.children.length
    ) {
      document.dispatchEvent(new Event('analysischange'));
      if (analysisData) firstPaint.disconnect();
    }
  }
  firstPaint.observe(document.getElementById('workspace'), {
    attributes: true,
    attributeFilter: ['hidden'],
  });
  firstPaint.observe(document.getElementById('analysisKpis'), { childList: true });
  ensureFirstPaint();
})();
