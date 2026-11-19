'use strict';
(function (root, factory) {
  if (typeof module === 'object' && module.exports)
    module.exports = factory(require('../vendor/qrcode'));
  else root.LabelRender = factory(root.qrcode);
})(typeof window === 'object' ? window : null, (qrFactory) => {
  qrFactory.stringToBytes = qrFactory.stringToBytesFuncs['UTF-8'];
  const escape = (value) =>
    String(value).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c],
    );
  const number = (n) => String(Math.round(n * 1000) / 1000);
  const fontFamily = (value) =>
    ({
      sans: 'Arial,Microsoft YaHei,sans-serif',
      serif: 'SimSun,Times New Roman,serif',
      mono: 'Consolas,Microsoft YaHei,monospace',
    })[value] || 'Arial,Microsoft YaHei,sans-serif';
  function matrix(code) {
    const qr = qrFactory(0, 'M');
    qr.addData(code, 'Byte');
    qr.make();
    return Array.from({ length: qr.getModuleCount() }, (_, y) =>
      Array.from({ length: qr.getModuleCount() }, (_, x) => qr.isDark(y, x)),
    );
  }
  function qrPath(modules, box) {
    const unit = box.size / (modules.length + 8),
      parts = [];
    modules.forEach((line, y) =>
      line.forEach((dark, x) => {
        if (dark)
          parts.push(
            `M${number(box.x + (x + 4) * unit)} ${number(box.y + (y + 4) * unit)}h${number(unit)}v${number(unit)}h-${number(unit)}z`,
          );
      }),
    );
    return `<path d="${parts.join('')}" fill="#000" shape-rendering="crispEdges"/>`;
  }
  function pageSvg(plan, page, namespace = 'page-' + page) {
    const prefix = String(namespace).replace(/[^a-zA-Z0-9_-]/g, '');
    const body = plan.positions
      .filter((p) => p.page === page)
      .map((p) => {
        const modules = matrix(p.record.code);
        const text = p.text
          .map((t, ti) => {
            const tx = t.center ? t.x + t.width / 2 : t.align === 'right' ? t.x + t.width : t.x;
            const baseline =
              t.y + (t.height - (t.font * 25.4) / 72) / 2 + ((t.font * 25.4) / 72) * 0.83;
            const line = t.rule
              ? `<g data-element-id="line-${ti}"><path d="M${number(p.x)} ${number(t.y)}h${number(p.width)}" stroke="#a2aab5" stroke-width="0.15"/></g>`
              : '';
            return (
              line +
              `<g data-element-id="${escape(t.elementId || (['code', 'name'].includes(t.binding) ? t.binding : 'text-' + ti))}"><text x="${number(tx)}" y="${number(baseline)}" font-size="${number((t.font * 25.4) / 72)}" font-family="${fontFamily(t.fontFamily)}" font-weight="${t.bold ? '700' : '400'}" text-anchor="${t.center ? 'middle' : t.align === 'right' ? 'end' : 'start'}" fill="${t.color || '#111'}">${escape(t.value)}</text></g>`
            );
          })
          .join('');
        const b = borderBox(plan.config, p);
        const border = plan.config.border
          ? `<rect data-label-border="true" x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="${b.radius}" fill="none" stroke="${plan.config.borderColor}" stroke-width="${plan.config.borderWidth}"${plan.config.borderStyle === 'solid' ? '' : ` stroke-dasharray="${plan.config.borderStyle === 'dotted' ? plan.config.borderWidth : plan.config.borderWidth * 3} ${plan.config.borderWidth * 2}"${plan.config.borderStyle === 'dotted' ? ' stroke-linecap="round"' : ''}`}/>`
          : '';
        const lines = (p.lines || [])
          .map(
            (l) =>
              `<g data-element-id="${escape(l.id)}"><path d="M${l.x} ${l.y}h${l.width}" stroke="${l.color}" stroke-width="${l.strokeWidth}"/></g>`,
          )
          .join('');
        const qrBackground = `<rect x="${p.qr.x}" y="${p.qr.y}" width="${p.qr.size}" height="${p.qr.size}" fill="#fff"/>`;
        return `<g data-label-code="${escape(p.record.code)}"><title>${escape(p.record.code)}</title><defs><clipPath id="${prefix}-label-clip-${p.index}"><rect x="${p.x}" y="${p.y}" width="${p.width}" height="${p.height}"/></clipPath></defs><g clip-path="url(#${prefix}-label-clip-${p.index})"><rect x="${p.x}" y="${p.y}" width="${p.width}" height="${p.height}" fill="#fff"/>${border}${lines}<g data-element-id="${escape(p.qr.elementId || 'qr')}">${qrBackground}${qrPath(modules, p.qr)}</g>${text}</g></g>`;
      })
      .join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${plan.paper.width}mm" height="${plan.paper.height}mm" viewBox="0 0 ${plan.paper.width} ${plan.paper.height}" role="img" aria-label="第${page + 1}页标签"><rect width="100%" height="100%" fill="#fff"/>${body}</svg>`;
  }
  function borderBox(c, p) {
    const inset = c.borderInset + c.borderWidth / 2,
      width = p.width - 2 * inset,
      height = p.height - 2 * inset,
      n = (v) => Number(number(v));
    return {
      x: n(p.x + inset),
      y: n(p.y + inset),
      width: n(Math.max(0.01, width)),
      height: n(Math.max(0.01, height)),
      radius: n(Math.max(0, Math.min(c.borderRadius, width / 2, height / 2))),
    };
  }
  function labelSvg(plan, index = 0) {
    const p = plan.positions[index],
      shift = {
        ...p,
        index: 0,
        page: 0,
        x: 0,
        y: 0,
        qr: { ...p.qr, x: Number(number(p.qr.x - p.x)), y: Number(number(p.qr.y - p.y)) },
        text: p.text.map((t) => ({
          ...t,
          x: Number(number(t.x - p.x)),
          y: Number(number(t.y - p.y)),
        })),
        lines: (p.lines || []).map((l) => ({
          ...l,
          x: Number(number(l.x - p.x)),
          y: Number(number(l.y - p.y)),
        })),
      };
    return pageSvg(
      { ...plan, paper: { width: p.width, height: p.height }, positions: [shift] },
      0,
      'single',
    );
  }
  function printHtml(plan) {
    return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none';style-src 'unsafe-inline';object-src 'none'"><style>@page{size:${plan.paper.width}mm ${plan.paper.height}mm;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0}.page{width:${plan.paper.width}mm;height:${plan.paper.height}mm;break-after:page;page-break-after:always}.page:last-child{break-after:auto;page-break-after:auto}svg{display:block;width:100%;height:100%}</style>${Array.from({ length: plan.pages }, (_, i) => `<div class="page">${pageSvg(plan, i)}</div>`).join('')}`;
  }
  function warnings(plan) {
    // Byte mode module count is determined by byte length. Check the densest code once.
    const longest = plan.positions.reduce((a, b) =>
      qrFactory.stringToBytes(a.record.code).length >= qrFactory.stringToBytes(b.record.code).length
        ? a
        : b,
    );
    const minimum = longest.qr.size / (matrix(longest.record.code).length + 8);
    return minimum < 0.25
      ? [`二维码模块约${number(minimum)}mm，可能难以扫描；建议增加二维码或标签尺寸，先试印确认。`]
      : [];
  }
  return Object.freeze({ escape, matrix, pageSvg, labelSvg, borderBox, printHtml, warnings });
});
