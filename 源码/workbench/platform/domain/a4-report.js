'use strict';
(function (root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  else root.A4Report = value;
})(typeof window === 'object' ? window : null, () => {
  const colors = [
    '#1676dc',
    '#ee9343',
    '#24a386',
    '#8b68c7',
    '#e46175',
    '#429cae',
    '#8b9b36',
    '#aa7155',
    '#607abb',
    '#bb679e',
  ];
  const pt = 0.352778;
  const fmt = (v, metric) =>
    v === null || v === undefined
      ? metric === 'rate'
        ? '无分母'
        : '缺失'
      : metric === 'rate'
        ? (v * 100).toFixed(2) + '%'
        : new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(v);
  const textWidth = (text, size) =>
    [...String(text)].reduce(
      (n, c) =>
        n + (c.codePointAt(0) > 255 ? 1 : /[MW]/.test(c) ? 0.85 : /[il1.\s]/.test(c) ? 0.34 : 0.58),
      0,
    ) *
    size *
    pt;
  function wrap(text, width, size) {
    const out = [''];
    for (const ch of String(text)) {
      if (ch === '\n') {
        out.push('');
        continue;
      }
      if (out.at(-1) && textWidth(out.at(-1) + ch, size) > width) out.push(ch);
      else out[out.length - 1] += ch;
    }
    return out;
  }
  function titleFit(text, width, start = 24, min = 14) {
    for (let f = start; f >= min; f -= 0.5) {
      const lines = wrap(text, width, f);
      if (lines.length <= 2) return { lines, font: f, height: lines.length * f * pt * 1.22 };
    }
    throw Error('标题过长，请缩短标题或减小标题字号。');
  }
  function required(chart, width) {
    const title = titleFit(chart.title, width - 8, 12, 10),
      n = chart.data.length;
    let body = 35;
    if (chart.type === 'bar') {
      const labelWidth = Math.min(55, Math.max(22, (width - 16) * 0.36));
      body =
        chart.data.reduce(
          (sum, p) => sum + Math.max(4.2, wrap(p.label, labelWidth, 8.5).length * 3.2 + 0.8),
          0,
        ) + 7;
    } else if (chart.type === 'pie') {
      const radius = Math.min(30, (width - 8) * 0.19),
        legendW = width - 8 - radius * 2 - 13;
      body = Math.max(
        radius * 2 + 4,
        chart.data.reduce(
          (sum, p) =>
            sum +
            Math.max(
              4.6,
              wrap(
                p.label + '  ' + fmt(p.value, chart.metric) + '  100.0%',
                Math.max(10, legendW),
                8.5,
              ).length *
                3.5 +
                1,
            ),
          0,
        ) + 4,
      );
    } else {
      if (n * 9 + 18 > width) return Infinity;
      body =
        48 +
        Math.max(
          0,
          ...chart.data.map(
            (p) => wrap(p.label, Math.max(7, (width - 23) / Math.max(1, n) - 1), 8).length,
          ),
        ) *
          3.3;
    }
    return title.height + body + 6;
  }
  function grid(charts, area, gap) {
    let best = null;
    for (let columns = 1; columns <= Math.min(4, charts.length); columns++) {
      const rows = Math.ceil(charts.length / columns),
        width = (area.width - gap * (columns - 1)) / columns;
      if (width < 72) continue;
      const heights = Array.from({ length: rows }, (_, r) =>
        Math.max(...charts.slice(r * columns, (r + 1) * columns).map((c) => required(c, width))),
      );
      const total = heights.reduce((a, b) => a + b, 0) + gap * (rows - 1);
      if (!Number.isFinite(total) || total > area.height + 0.001) continue;
      const averageHeight = (area.height - gap * (rows - 1)) / rows;
      const score =
        -Math.abs(Math.log(width / averageHeight / 1.5)) - (rows * columns - charts.length) * 0.12;
      if (!best || score > best.score) {
        const spare = (area.height - total) / rows;
        let y = area.y;
        const boxes = [];
        for (let r = 0; r < rows; r++) {
          for (let col = 0; col < columns && r * columns + col < charts.length; col++)
            boxes.push({ x: area.x + col * (width + gap), y, width, height: heights[r] + spare });
          y += heights[r] + spare + gap;
        }
        best = { score, boxes, columns, rows };
      }
    }
    return best;
  }
  const text = (cmd, value, x, y, size = 9, color = '#24364b', anchor = 'start', bold = false) =>
    cmd.push({ kind: 'text', text: String(value), x, y, size, color, anchor, bold });
  const line = (cmd, x1, y1, x2, y2, color = '#d5dfeb', width = 0.18) =>
    cmd.push({ kind: 'line', x1, y1, x2, y2, color, width });
  const rect = (cmd, x, y, w, h, fill = '#ffffff', stroke = '#d5dfeb', width = 0.18) =>
    cmd.push({ kind: 'rect', x, y, w, h, fill, stroke, width });
  const poly = (cmd, points, color, width = 0.6) =>
    cmd.push({ kind: 'polyline', points, color, width });
  function scale(values) {
    const max = Math.max(0, ...values.filter((v) => Number.isFinite(v)));
    if (!max) return { max: 1, step: 0.25 };
    const rough = max / 4,
      power = 10 ** Math.floor(Math.log10(rough)),
      step = ([1, 2, 5, 10].find((n) => n * power >= rough) || 10) * power;
    return { step, max: Math.ceil(max / step) * step };
  }
  function chartCommands(chart, box) {
    if (chart.type === 'pie' && chart.metric === 'rate')
      throw Error('不良率不能相加组成饼图，请改用条形图、柱形图或折线图。');
    const cmd = [];
    rect(cmd, box.x, box.y, box.width, box.height);
    const title = titleFit(chart.title, box.width - 8, 12, 10);
    title.lines.forEach((s, i) =>
      text(
        cmd,
        s,
        box.x + 4,
        box.y + 3 + (i + 1) * title.font * pt,
        title.font,
        '#182e4a',
        'start',
        true,
      ),
    );
    const top = box.y + title.height + 5,
      left = box.x + 4,
      width = box.width - 8,
      height = box.y + box.height - top - 3;
    if (!chart.data.length) {
      text(cmd, '无匹配数据', left + width / 2, top + height / 2, 11, '#60758e', 'middle');
      return cmd;
    }
    const s = scale(chart.data.map((p) => p.value));
    if (chart.type === 'bar') {
      const labelWidth = Math.min(55, Math.max(22, (width - 8) * 0.36)),
        valueWidth = Math.max(
          13,
          ...chart.data.map((p) => textWidth(fmt(p.value, chart.metric), 8.5) + 2),
        ),
        plotX = left + labelWidth + 2,
        plotW = width - labelWidth - valueWidth - 4;
      if (plotW < 12) throw Error('图表数值或分类名称过宽，请减少单页图表数量或使用分页。');
      const baseRows = chart.data.map((p) =>
        Math.max(4.2, wrap(p.label, labelWidth, 8.5).length * 3.2 + 0.8),
      );
      const extra = Math.max(
        0,
        Math.min(9, (height - 8 - baseRows.reduce((a, b) => a + b, 0)) / chart.data.length),
      );
      const used = baseRows.reduce((a, b) => a + b, 0) + extra * chart.data.length;
      const plotTop = top + Math.max(0, (height - 8 - used) / 2);
      let cursor = plotTop;
      for (let i = 0; i < chart.data.length; i++) {
        const p = chart.data[i],
          lines = wrap(p.label, labelWidth, 8.5),
          h = baseRows[i] + extra,
          center = cursor + h / 2,
          thickness = Math.min(5, h * 0.5);
        lines.forEach((value, j) =>
          text(cmd, value, left, center - (lines.length - 1) * 1.6 + j * 3.2 + 1, 8.5),
        );
        rect(cmd, plotX, center - thickness / 2, plotW, thickness, '#edf3fa', '#edf3fa', 0);
        if (Number.isFinite(p.value))
          rect(
            cmd,
            plotX,
            center - thickness / 2,
            Math.max(0.01, (plotW * p.value) / s.max),
            thickness,
            colors[0],
            colors[0],
            0,
          );
        text(
          cmd,
          fmt(p.value, chart.metric),
          left + width,
          center + 1,
          8.5,
          '#182e4a',
          'end',
          true,
        );
        cursor += h;
      }
      for (let tick = 0; tick <= s.max + 0.000001; tick += s.step) {
        const x = plotX + (plotW * tick) / s.max;
        line(cmd, x, plotTop, x, cursor, '#c9d7e8', 0.12);
        text(cmd, fmt(tick, chart.metric), x, cursor + 3, 7.5, '#60758e', 'middle');
      }
    } else if (chart.type === 'pie') {
      const sum = chart.data.reduce((n, p) => n + (p.value || 0), 0),
        radius = Math.min(height / 2 - 2, width * 0.19, 30),
        cx = left + radius + 2,
        cy = top + height / 2;
      let angle = -Math.PI / 2;
      if (sum <= 0) {
        text(cmd, '合计为零', cx, cy, 10, '#60758e', 'middle');
      } else
        chart.data.forEach((p, i) => {
          const sweep = ((p.value || 0) / sum) * Math.PI * 2,
            points = [[cx, cy]];
          for (let a = 0; a <= Math.max(2, Math.ceil(sweep * 40)); a++) {
            const t = angle + (sweep * a) / Math.max(2, Math.ceil(sweep * 40));
            points.push([cx + radius * Math.cos(t), cy + radius * Math.sin(t)]);
          }
          cmd.push({ kind: 'polygon', points, fill: colors[i % colors.length] });
          angle += sweep;
        });
      const legendX = left + radius * 2 + 8,
        legendW = width - radius * 2 - 8;
      const legendHeight = chart.data.reduce(
        (n, p) =>
          n +
          Math.max(
            4.6,
            wrap(
              p.label +
                '  ' +
                fmt(p.value, chart.metric) +
                (sum > 0 ? '  ' + (((p.value || 0) / sum) * 100).toFixed(1) + '%' : ''),
              legendW - 5,
              8.5,
            ).length *
              3.5 +
              1,
          ),
        0,
      );
      let y = top + Math.max(0, (height - legendHeight) / 2) + 3;
      chart.data.forEach((p, i) => {
        const label =
          p.label +
          '  ' +
          fmt(p.value, chart.metric) +
          (sum > 0 ? '  ' + (((p.value || 0) / sum) * 100).toFixed(1) + '%' : '');
        const lines = wrap(label, legendW - 5, 8.5);
        rect(
          cmd,
          legendX,
          y - 2,
          2.5,
          2.5,
          colors[i % colors.length],
          colors[i % colors.length],
          0,
        );
        lines.forEach((v, j) => text(cmd, v, legendX + 4, y + j * 3.5, 8.5));
        y += Math.max(4.6, lines.length * 3.5 + 1);
      });
      if (y > box.y + box.height - 1)
        throw Error('饼图图例过多或名称过长，请增大图表、减少分类或改用条形图。');
    } else {
      const n = chart.data.length,
        x = left + 12,
        y = top + 3,
        w = width - 15,
        step = w / Math.max(1, n),
        labelLines = Math.max(
          1,
          ...chart.data.map((p) => wrap(p.label, Math.max(7, step - 1), 8).length),
        ),
        h = height - Math.max(18, 7 + labelLines * 3.3),
        base = y + h;
      for (let tick = 0; tick <= s.max + 0.000001; tick += s.step) {
        const ty = base - (h * tick) / s.max;
        line(cmd, x, ty, x + w, ty);
        text(cmd, fmt(tick, chart.metric), x - 2, ty + 1, 7.5, '#60758e', 'end');
      }
      let segment = [];
      chart.data.forEach((p, i) => {
        const px = x + step * (i + 0.5);
        if (Number.isFinite(p.value)) {
          const py = base - (h * p.value) / s.max;
          if (chart.type === 'column')
            rect(
              cmd,
              px - step * 0.28,
              py,
              step * 0.56,
              Math.max(0.01, base - py),
              colors[0],
              colors[0],
              0,
            );
          else {
            segment.push([px, py]);
            cmd.push({ kind: 'circle', x: px, y: py, r: 0.8, fill: colors[0] });
          }
          text(cmd, fmt(p.value, chart.metric), px, py - 1.5, 8, '#182e4a', 'middle', true);
        } else {
          if (segment.length > 1) poly(cmd, segment, colors[0]);
          segment = [];
        }
        wrap(p.label, Math.max(7, step - 1), 8).forEach((v, j) =>
          text(cmd, v, px, base + 4 + j * 3.2, 8, '#526c87', 'middle'),
        );
      });
      if (segment.length > 1) poly(cmd, segment, colors[0]);
      line(cmd, x, base, x + w, base, '#9db4cf');
    }
    return cmd;
  }
  function compose(charts, settings, { title = '', subtitle = '' } = {}) {
    if (!Array.isArray(charts) || !charts.length || charts.length > 24)
      throw Error('请加入1至24张图表。');
    for (const c of charts)
      if (
        !['bar', 'column', 'pie', 'line'].includes(c.type) ||
        !Array.isArray(c.data) ||
        c.data.some(
          (p) =>
            typeof p.label !== 'string' ||
            (p.value !== null && (!Number.isFinite(p.value) || p.value < 0)),
        )
      )
        throw Error('图表数据无效。');
    const margin = settings.margin ?? 8,
      gap = settings.gap ?? 4,
      titleBlock = titleFit(title || '不良分析', 297 - 2 * margin, settings.titleSize || 24),
      header = titleBlock.height + 8 + (subtitle ? 5 : 0);
    const area = {
      x: margin,
      y: margin + header,
      width: 297 - margin * 2,
      height: 210 - margin * 2 - header - 7,
    };
    let batches = [];
    if (settings.singlePage) {
      const found = grid(charts, area, gap);
      if (!found)
        throw Error(
          '当前图表数量或条目无法在横向A4单页清晰完整显示。请开启自动分页、缩小筛选范围或减少图表；未删除任何数据。',
        );
      batches = [{ charts, grid: found }];
    } else {
      let current = [];
      for (const c of charts) {
        if (!grid([c], area, gap))
          throw Error(
            `图表“${c.title}”本身条目过多，无法在一张A4内清晰显示；请缩小范围或改图表类型。`,
          );
        if (current.length && !grid([...current, c], area, gap)) {
          batches.push({ charts: current, grid: grid(current, area, gap) });
          current = [];
        }
        current.push(c);
      }
      if (current.length) batches.push({ charts: current, grid: grid(current, area, gap) });
    }
    const pages = batches.map((batch, index) => {
      const commands = [];
      rect(commands, 0, 0, 297, 210, '#ffffff', '#ffffff', 0);
      titleBlock.lines.forEach((t, i) =>
        text(
          commands,
          t,
          297 / 2,
          margin + (i + 1) * titleBlock.font * pt,
          titleBlock.font,
          '#142c48',
          'middle',
          true,
        ),
      );
      if (subtitle)
        text(commands, subtitle, 297 / 2, margin + titleBlock.height + 4, 8.5, '#536b86', 'middle');
      const boxes = batch.grid.boxes;
      batch.charts.forEach((chart, i) => commands.push(...chartCommands(chart, boxes[i])));
      text(
        commands,
        `数据与筛选以平台当前快照为准  ·  第${index + 1}/${batches.length}页`,
        margin,
        210 - margin + 1,
        8,
        '#60758e',
      );
      return { width: 297, height: 210, commands, boxes, charts: batch.charts.map((c) => c.id) };
    });
    return { width: 297, height: 210, pages, title: title || '不良分析' };
  }
  const esc = (s) =>
    String(s).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c],
    );
  function svg(page) {
    const commands = page.commands
      .map((c) => {
        if (c.kind === 'rect')
          return `<rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" fill="${c.fill}" stroke="${c.stroke}" stroke-width="${c.width}"/>`;
        if (c.kind === 'line')
          return `<line x1="${c.x1}" y1="${c.y1}" x2="${c.x2}" y2="${c.y2}" stroke="${c.color}" stroke-width="${c.width}"/>`;
        if (c.kind === 'polyline' || c.kind === 'polygon')
          return `<${c.kind} points="${c.points.map((p) => p.join(',')).join(' ')}" fill="${c.kind === 'polygon' ? c.fill : 'none'}" stroke="${c.color || 'none'}" stroke-width="${c.width || 0}"/>`;
        if (c.kind === 'circle')
          return `<circle cx="${c.x}" cy="${c.y}" r="${c.r}" fill="${c.fill}"/>`;
        return `<text x="${c.x}" y="${c.y}" font-size="${c.size * pt}" font-family="Microsoft YaHei,Arial,sans-serif" font-weight="${c.bold ? 700 : 400}" fill="${c.color}" text-anchor="${c.anchor}">${esc(c.text)}</text>`;
      })
      .join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${page.width}mm" height="${page.height}mm" viewBox="0 0 ${page.width} ${page.height}" role="img" aria-label="横向A4图表报告">${commands}</svg>`;
  }
  function chartSvg(chart) {
    let width = Math.max(
      160,
      chart.type === 'bar' || chart.type === 'pie' ? 160 : chart.data.length * 10 + 30,
    );
    let height = Math.max(70, required(chart, width) + 2);
    const commands = chartCommands(chart, { x: 0, y: 0, width, height });
    return svg({ width, height, commands });
  }
  return Object.freeze({ compose, svg, chartSvg, textWidth, wrap, fmt, required });
});
