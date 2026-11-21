'use strict';
window.HomeGraphics = (() => {
  const ns = 'http://www.w3.org/2000/svg',
    palette = ['#1683ff', '#18bb8f', '#ffb521', '#9469ed', '#ff7277', '#68b8f7', '#a8bfdc'];
  const s = (tag, attrs = {}, text) => {
    const x = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) x.setAttribute(k, v);
    if (text !== undefined) x.textContent = text;
    return x;
  };
  const nice = (n) => {
    if (n <= 0) return 1;
    const p = 10 ** Math.floor(Math.log10(n)),
      v = n / p;
    return [1, 2, 5, 10].find((x) => x >= v) * p;
  };
  const fmt = (n) =>
    n === null || n === undefined
      ? '—'
      : Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  function empty(text) {
    const p = document.createElement('p');
    p.className = 'home-chart-empty';
    p.textContent = text;
    return p;
  }
  function frame(title, width, height) {
    const svg = s('svg', {
      viewBox: `0 0 ${width} ${height}`,
      width,
      height,
      role: 'group',
      'aria-label': title,
    });
    return svg;
  }
  function hit(el, label, callback) {
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-label', label);
    el.append(s('title', {}, label));
    el.onclick = callback;
    el.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        callback();
      }
    };
  }
  function combo(
    rows,
    { comparison = false, onRange = () => {}, onQuantity = () => {}, width = 390, height = 205 } = {},
  ) {
    if (!rows.length) return empty('当前范围没有可绘制的周期。');
    width = Math.max(width, rows.length * 48 + 96);
    const H = height,
      L = 48,
      R = 48,
      T = 42,
      B = 32,
      W = width - L - R,
      Y = H - T - B;
    const hasQuantity = rows.some((r) => Number.isFinite(r.defectiveUnits));
    const svg = frame(comparison ? '本期与上期异常条数' : '异常条数与不良件数，双纵轴', width, H);
    const leftAxis = window.ChartData.countAxis(
        Math.max(...rows.map((r) => Math.max(r.recordCount, comparison ? r.previousCount : 0))),
      ),
      leftMax = leftAxis.top,
      rightMax = nice(Math.max(0, ...rows.map((r) => r.defectiveUnits || 0)));
    for (let i = 0; i < leftAxis.ticks.length; i++) {
      const ratio = leftAxis.ticks[i] / leftMax;
      const y = T + Y - ratio * Y;
      svg.append(
        s('line', { x1: L, x2: width - R, y1: y, y2: y, class: 'home-grid-line' }),
        s(
          'text',
          { x: L - 6, y: y + 3, 'text-anchor': 'end', class: 'home-axis' },
          fmt(leftAxis.ticks[i]),
        ),
      );
      if (!comparison && hasQuantity)
        svg.append(
          s('text', { x: width - R + 6, y: y + 3, class: 'home-axis' }, fmt(rightMax * ratio)),
        );
    }
    svg.append(s('text', { x: L, y: 13, class: 'home-axis' }, '异常（条）'));
    if (!comparison && hasQuantity)
      svg.append(
        s('text', { x: width - R, y: 13, 'text-anchor': 'end', class: 'home-axis' }, '不良（件）'),
      );
    const step = W / rows.length,
      bar = Math.min(22, step * 0.48);
    const labels = [], markers = [];
    let path = '',
      active = false;
    rows.forEach((r, i) => {
      const x = L + step * (i + 0.5),
        y = T + Y - (r.recordCount / leftMax) * Y;
      const rect = s('rect', {
        x: x - bar / 2,
        y,
        width: bar,
        height: r.recordCount ? Math.max(0.8, T + Y - y) : 0,
        rx: 2,
        fill: 'var(--combo-bar)',
      });
      hit(rect, `${r.start} 至 ${r.end}，异常${r.recordCount}条`, () => onRange(r));
      svg.append(rect);
      const countY = y - 7;
      labels.push(
        s(
          'text',
          { x, y: countY, 'text-anchor': 'middle', class: 'home-value' },
          fmt(r.recordCount),
        ),
      );
      if (comparison) {
        const py = T + Y - (r.previousCount / leftMax) * Y;
        const prev = s('rect', {
          x: x + bar / 2 + 1,
          y: py,
          width: Math.max(5, bar / 3),
          height: Math.max(0.8, T + Y - py),
          fill: 'var(--combo-prior)',
          rx: 1,
        });
        hit(prev, `同长上期对应周期${r.previousCount}条`, () => onRange(r, true));
        svg.append(prev);
      }
      const label = r.start === r.end ? r.start.slice(5) : r.key.slice(5);
      svg.append(s('text', { x, y: H - 10, 'text-anchor': 'middle', class: 'home-axis' }, label));
      if (!comparison && r.defectiveUnits !== null) {
        const yy = T + Y - (r.defectiveUnits / rightMax) * Y;
        path += (active ? 'L' : 'M') + x + ' ' + yy + ' ';
        active = true;
        const circle = s('circle', {
          cx: x,
          cy: yy,
          r: 3.5,
          fill: 'var(--combo-line)',
          stroke: 'var(--combo-paper)',
          'stroke-width': 1.5,
        });
        hit(circle, `${r.start} 至 ${r.end}，不良${r.defectiveUnits}件`, () => onQuantity(r));
        markers.push(circle);
        const above = yy - 9;
        const lineY = Math.abs(above - countY) >= 18 ? above
          : (yy + 18 <= H - B + 3 ? Math.max(yy + 17, countY + 18) : countY - 18);
        labels.push(
          s(
            'text',
            {
              x,
              y: lineY,
              'text-anchor': 'middle',
              class: 'home-value home-green',
            },
            fmt(r.defectiveUnits),
          ),
        );
      } else active = false;
    });
    if (path)
      svg.append(s('path', { d: path, fill: 'none', stroke: 'var(--combo-line)', 'stroke-width': 2.5, 'pointer-events': 'none' }));
    for (const node of markers) svg.append(node);
    for (const node of labels) svg.append(node);
    const wrap = document.createElement('div');
    wrap.className = 'home-graphic-scroll';
    const legend = document.createElement('div');
    legend.className = 'home-chart-legend';
    for (const [name, color] of [
      ['异常条数', 'var(--combo-bar)'],
      [comparison ? '同长上期' : '不良件数', comparison ? 'var(--combo-prior)' : 'var(--combo-line)'],
    ]) {
      const label = document.createElement('span'),
        dot = document.createElement('i');
      dot.style.background = color;
      label.append(dot, document.createTextNode(name));
      legend.append(label);
    }
    wrap.append(legend, svg);
    return wrap;
  }
  function donut(
    items,
    total,
    onSelect,
    { unit = '条', label = '异常记录', quantity = false } = {},
  ) {
    ({ items, total } = window.ChartData.donut(items, total, { quantity }));
    if (total && typeof onSelect !== 'function') throw Error('分类图缺少查看明细的操作。');
    if (!total) return empty('当前范围没有异常分类。');
    const wrap = document.createElement('div');
    wrap.className = 'home-donut-layout';
    const svg = frame(label + '分类构成，单位' + unit, 180, 180),
      length = 2 * Math.PI * 62;
    let offset = 0;
    items.forEach((r, i) => {
      const c = s('circle', {
        cx: 90,
        cy: 90,
        r: 62,
        fill: 'none',
        stroke: palette[i % palette.length],
        'stroke-width': 27,
        'stroke-dasharray': `${(r.count / total) * length} ${length}`,
        'stroke-dashoffset': -offset * length,
        transform: 'rotate(-90 90 90)',
      });
      hit(
        c,
        `${r.value || '未填写'}：${r.count}${unit}，占${((r.count / total) * 100).toFixed(1)}%`,
        () => onSelect(r.value),
      );
      svg.append(c);
      offset += r.count / total;
    });
    svg.append(
      s('text', { x: 90, y: 91, 'text-anchor': 'middle', class: 'home-donut-number' }, fmt(total)),
      s(
        'text',
        { x: 90, y: 111, 'text-anchor': 'middle', class: 'home-axis' },
        label + '（' + unit + '）',
      ),
    );
    const legend = document.createElement('div');
    legend.className = 'home-donut-items';
    items.forEach((r, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'home-legend-item';
      const dot = document.createElement('i');
      dot.style.background = palette[i % palette.length];
      const name = document.createElement('span');
      name.textContent = r.value || '未填写';
      const value = document.createElement('strong');
      value.textContent = fmt(r.count) + ' · ' + ((r.count / total) * 100).toFixed(1) + '%';
      b.append(dot, name, value);
      b.onclick = () => onSelect(r.value);
      legend.append(b);
    });
    wrap.append(svg, legend);
    return wrap;
  }
  function ranking(
    items,
    { onSelect = () => {}, limit = 7, unit = '条', unmapped = '未填写' } = {},
  ) {
    if (!items.length) return empty('当前范围没有可分析的数据。');
    const wrap = document.createElement('div');
    wrap.className = 'home-rank';
    const max = Math.max(1, ...items.map((r) => r.count));
    for (const r of items.slice(0, limit)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'home-rank-item';
      const label = document.createElement('span');
      label.textContent = r.value || unmapped;
      label.title = label.textContent;
      const track = document.createElement('span');
      track.className = 'home-rank-track';
      const bar = document.createElement('i');
      bar.style.width = (r.count / max) * 100 + '%';
      track.append(bar);
      const count = document.createElement('strong');
      count.textContent = fmt(r.count) + ' ' + unit;
      b.append(label, track, count);
      b.setAttribute('aria-label', `${r.value || unmapped} ${r.count}${unit}`);
      b.onclick = () => onSelect(r.value);
      wrap.append(b);
    }
    return wrap;
  }
  return { combo, donut, ranking, empty, fmt, palette };
})();
