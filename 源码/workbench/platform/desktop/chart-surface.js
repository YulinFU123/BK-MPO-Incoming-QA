'use strict';
((factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else window.ChartSurface = api;
})(() => {
  const finite = (value) => typeof value === 'number' && Number.isFinite(value);
  function scale(values, integer = false) {
    const valid = values.filter(finite),
      low = Math.min(0, ...valid),
      high = Math.max(0, ...valid);
    const span = high - low || 1;
    const rough = span / 4,
      power = 10 ** Math.floor(Math.log10(rough));
    const nice = [1, 2, 2.5, 5, 10].find((n) => n * power >= rough) * power;
    const step = integer ? Math.max(1, Math.ceil(nice)) : nice;
    const min = Math.floor(low / step) * step,
      max = Math.ceil((high || step) / step) * step;
    const ticks = [];
    for (let i = 0; i <= Math.round((max - min) / step); i++)
      ticks.push(Number((min + i * step).toPrecision(12)));
    return Object.freeze({ min, max, step, ticks: Object.freeze(ticks) });
  }
  function format(value, percent = false) {
    if (!finite(value)) return '缺少数据';
    if (percent)
      return (
        (value * 100).toLocaleString('zh-CN', {
          maximumFractionDigits: value && Math.abs(value) < 0.001 ? 3 : 2,
        }) + '%'
      );
    return value.toLocaleString('zh-CN', { maximumFractionDigits: 4 });
  }
  function layout(labels, series, { percent = false, minimumWidth = 480, compact = false, height } = {}) {
    if (
      !Array.isArray(labels) ||
      !Array.isArray(series) ||
      !series.length ||
      series.some((line) => !Array.isArray(line.values) || line.values.length !== labels.length)
    )
      throw Error('图表周期与数据长度不一致。');
    const values = series.flatMap((line) => line.values);
    const domain = scale(values, !percent && values.filter(finite).every(Number.isInteger));
    const chars = Math.max(
      6,
      ...values.filter(finite).map((value) => format(value, percent).length),
    );
    const labelChars = Math.max(
      0,
      ...labels.map((label) =>
        [...String(label)].reduce((sum, char) => sum + (char.charCodeAt(0) > 255 ? 2 : 1), 0),
      ),
    );
    const compactChars = Math.max(
      1,
      ...values.filter(finite).map((value) => format(value, percent).length),
    );
    const gap = compact
        ? Math.max(42, compactChars * 6 + 14, labelChars * 5.5 + 12)
        : Math.max(56, chars * 7.2 + 22, labelChars * 7 + 16),
      left = compact
        ? Math.max(40, format(domain.max, percent).length * 6 + 14)
        : Math.max(68, format(domain.max, percent).length * 7 + 20),
      right = compact ? 12 : 32;
    const width = Math.max(minimumWidth, left + right + Math.max(1, labels.length) * gap);
    return {
      domain,
      width,
      left,
      right,
      top: compact ? 28 : 38,
      bottom: compact ? 48 : 82,
      height: Number.isFinite(height) ? Math.max(160, height) : compact ? 200 : 320,
      gap,
    };
  }
  const svgNS = 'http://www.w3.org/2000/svg';
  function element(tag, attrs = {}, text) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function svg(tag, attrs = {}, text) {
    const node = document.createElementNS(svgNS, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function plot(labels, lines, options, geometry, seriesOffset = 0) {
    const { domain, width, left, right, top, bottom, height, gap } = geometry;
    const plotHeight = height - top - bottom;
    const x = (i) =>
      labels.length < 2
        ? (left + width - right) / 2
        : left + gap / 2 + (i * (width - left - right - gap)) / (labels.length - 1);
    const y = (value) => top + ((domain.max - value) / (domain.max - domain.min)) * plotHeight;
    const graphic = svg('svg', {
      width,
      height,
      viewBox: `0 0 ${width} ${height}`,
      class: 'chart-surface-svg',
      role: 'group',
      'aria-label': options.title + '；单位：' + options.unit + '；每个数据点均标数',
    });
    for (const value of domain.ticks) {
      graphic.append(
        svg('line', { x1: left, x2: width - right, y1: y(value), y2: y(value), class: 'cs-grid' }),
      );
    }
    labels.forEach((label, i) =>
      graphic.append(
        svg(
          'text',
          { x: x(i), y: height - 18, 'text-anchor': 'middle', class: 'cs-axis', 'data-period': i },
          label,
        ),
      ),
    );
    lines.forEach((line, index) => {
      let d = '',
        active = false;
      line.values.forEach((value, i) => {
        if (!finite(value)) {
          active = false;
          return;
        }
        d += (active ? ' L' : ' M') + x(i) + ',' + y(value);
        active = true;
      });
      const path = svg('path', { d, class: 'cs-line', 'data-series': (seriesOffset + index) % 4 });
      graphic.append(path);
    });
    labels.forEach((_label, i) => {
      const placed = [];
      const entries = lines
        .map((line, index) => ({ line, index, value: line.values[i] }))
        .filter((item) => finite(item.value))
        .sort((a, b) => y(a.value) - y(b.value));
      for (const { line, index, value } of entries) {
        const seriesIndex = seriesOffset + index,
          xx = x(i),
          yy = y(value);
        let labelY = yy - 12;
        while (placed.some((at) => Math.abs(at - labelY) < 19)) labelY += 20;
        placed.push(labelY);
        const point = options.pointNode?.(seriesIndex, i) || svg('circle');
        for (const [key, value] of Object.entries({
          cx: xx,
          cy: yy,
          r: 4.5,
          'data-period': i,
          'data-series': seriesIndex % 4,
        }))
          point.setAttribute(key, String(value));
        point.classList.add('cs-point');
        const message =
          (options.fullLabels?.[i] || labels[i]) +
          '，' +
          line.name +
          '：' +
          format(value, options.percent) +
          (options.percent ? '' : ' ' + options.unit);
        if (!point.hasAttribute('aria-label')) point.setAttribute('aria-label', message);
        point.setAttribute('tabindex', '0');
        if (!point.hasAttribute('role'))
          point.setAttribute('role', options.onPoint ? 'button' : 'img');
        const report = () => options.onReadout?.(message);
        point.addEventListener('focus', report);
        point.addEventListener('pointerenter', report);
        if (options.onPoint) {
          point.addEventListener('click', () => options.onPoint(seriesIndex, i));
          point.addEventListener('keydown', (event) => {
            if (['Enter', ' '].includes(event.key)) {
              event.preventDefault();
              options.onPoint(seriesIndex, i);
            }
          });
        }
        point.append(svg('title', {}, message));
        if (Math.abs(labelY - (yy - 12)) > 2)
          graphic.append(
            svg('line', {
              x1: xx,
              x2: xx,
              y1: yy + 5,
              y2: labelY - 10,
              class: 'cs-leader',
              'data-series': seriesIndex % 4,
            }),
          );
        graphic.append(
          point,
          svg(
            'text',
            {
              x: xx,
              y: labelY,
              'text-anchor': 'middle',
              class: 'cs-value',
              'data-value': value,
              'data-series': seriesIndex % 4,
              'data-period': i,
            },
            format(value, options.percent),
          ),
        );
      }
      lines.forEach((line, index) => {
        if (!finite(line.values[i]))
          graphic.append(
            svg(
              'text',
              {
                x: x(i),
                y: height - 48 - index * 15,
                'text-anchor': 'middle',
                class: 'cs-missing',
                'aria-label': labels[i] + '，' + line.name + '缺少数据',
              },
              '缺数',
            ),
          );
      });
    });
    const axis = svg('svg', {
      width: left,
      height,
      viewBox: `0 0 ${left} ${height}`,
      class: 'cs-fixed-axis',
      role: 'img',
      'aria-label': '纵轴，单位' + options.unit,
    });
    axis.append(
      svg('rect', { width: left - 5, height, class: 'cs-axis-background' }),
      svg('text', { x: 8, y: 17, class: 'cs-unit' }, options.unit),
    );
    for (const value of domain.ticks)
      axis.append(
        svg(
          'text',
          { x: left - 12, y: y(value) + 4, 'text-anchor': 'end', class: 'cs-axis cs-y-label' },
          format(value, options.percent),
        ),
      );
    const row = element('div', { class: 'cs-canvas-row' });
    axis.style.marginRight = -left + 'px';
    axis.style.width = left + 'px';
    axis.style.height = height + 'px';
    row.append(axis, graphic);
    return row;
  }
  function create({
    labels,
    series,
    title = '数量趋势',
    unit = '条记录',
    percent = false,
    dataTable = true,
    ...options
  }) {
    const geometry = layout(labels, series, {
      percent,
      minimumWidth: options.minimumWidth || 480,
      compact: options.compact === true,
      height: options.height,
    });
    const wrapper = element('figure', { class: 'chart-surface' });
    wrapper.style.setProperty('--cs-height', geometry.height + 'px');
    const legend = element('figcaption', { class: 'cs-legend' });
    series.forEach((line, i) => {
      const item = element('span', { class: 'cs-key', 'data-series': i % 4 });
      item.append(element('i', { 'aria-hidden': 'true' }), document.createTextNode(line.name));
      legend.append(item);
    });
    legend.append(element('small', {}, '单位：' + unit));
    const scroll = element('div', {
      class: 'cs-scroll',
      tabindex: '0',
      role: 'region',
      'aria-label': title + '，可横向滚动查看全部' + labels.length + '个周期',
    });
    const settings = { ...options, title, unit, percent };
    if (series.length > 2) {
      series.forEach((line, index) => {
        const pane = element('section', { class: 'cs-series-pane' });
        pane.append(
          element('strong', {}, line.name),
          plot(labels, [line], settings, geometry, index),
        );
        scroll.append(pane);
      });
    } else scroll.append(plot(labels, series, settings, geometry));
    wrapper.append(
      legend,
      scroll,
      element(
        'p',
        { class: 'cs-caption' },
        labels.length +
          '个周期；每个点直接标数，横线对应左侧刻度。缺少数据处断线；可横向滚动查看全部。',
      ),
    );
    if (dataTable) {
      const detail = element('details', { class: 'cs-data' }),
        table = element('table');
      const head = element('tr');
      for (const text of ['周期', ...series.map((line) => line.name + '（' + unit + '）')])
        head.append(element('th', { scope: 'col' }, text));
      const thead = element('thead');
      thead.append(head);
      table.append(thead);
      const tbody = element('tbody');
      labels.forEach((label, i) => {
        const row = element('tr');
        row.append(element('th', { scope: 'row' }, options.fullLabels?.[i] || label));
        series.forEach((line) => row.append(element('td', {}, format(line.values[i], percent))));
        tbody.append(row);
      });
      table.append(tbody);
      detail.append(element('summary', {}, '查看完整图表数据'), table);
      wrapper.append(detail);
    }
    return wrapper;
  }
  return Object.freeze({ scale, format, layout, create });
});
