'use strict';
(function (root, factory) {
  if (typeof module === 'object' && module.exports)
    module.exports = factory(require('../vendor/qrcode'), require('../domain/code128'));
  else root.LabelRender = factory(root.qrcode, root.Code128);
})(typeof window === 'object' ? window : null, (qrFactory, barcode) => {
  qrFactory.stringToBytes = qrFactory.stringToBytesFuncs['UTF-8'];
  const escape = (value) =>
    String(value).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c],
    );
  const number = (n) => String(Math.round(n * 1000) / 1000);
  const fonts = {
      sans: ["Arial,'Microsoft YaHei',sans-serif", 'Microsoft YaHei'],
      serif: ["SimSun,'Times New Roman',serif", 'SimSun'],
      mono: ["Consolas,'Microsoft YaHei',monospace", 'Consolas'],
      yahei: ["'Microsoft YaHei',Arial,sans-serif", 'Microsoft YaHei'],
      simhei: ["SimHei,'Microsoft YaHei',sans-serif", 'SimHei'],
      simsun: ['SimSun,serif', 'SimSun'],
      kaiti: ['KaiTi,STKaiti,SimSun,serif', 'KaiTi'],
      fangsong: ['FangSong,STFangsong,SimSun,serif', 'FangSong'],
      arial: ['Arial,Helvetica,sans-serif', 'Arial'],
      times: ["'Times New Roman',Times,serif", 'Times New Roman'],
      calibri: ['Calibri,Arial,sans-serif', 'Calibri'],
      courier: ["'Courier New',Courier,monospace", 'Courier New'],
    },
    fontFamily = (value) => (fonts[value] || fonts.sans)[0],
    fontFace = (value) => (fonts[value] || fonts.sans)[1];
  // Excel 需要分别指定西文/中文字体；serif 保持旧行为（西文 Times New Roman、中文 SimSun）
  const latinFaces = {
      sans: 'Arial',
      serif: 'Times New Roman',
      mono: 'Consolas',
      yahei: 'Microsoft YaHei',
      simhei: 'SimHei',
      simsun: 'SimSun',
      kaiti: 'KaiTi',
      fangsong: 'FangSong',
      arial: 'Arial',
      times: 'Times New Roman',
      calibri: 'Calibri',
      courier: 'Courier New',
    },
    eaFaces = {
      sans: 'Microsoft YaHei',
      serif: 'SimSun',
      mono: 'Microsoft YaHei',
      yahei: 'Microsoft YaHei',
      simhei: 'SimHei',
      simsun: 'SimSun',
      kaiti: 'KaiTi',
      fangsong: 'FangSong',
      arial: 'Microsoft YaHei',
      times: 'Microsoft YaHei',
      calibri: 'Microsoft YaHei',
      courier: 'Microsoft YaHei',
    },
    fontLatin = (value) => latinFaces[value] || 'Arial',
    fontEa = (value) => eaFaces[value] || 'Microsoft YaHei';
  const fontIds = Object.freeze(Object.keys(fonts));
  function matrix(code) {
    const qr = qrFactory(0, 'M');
    qr.addData(code, 'Byte');
    qr.make();
    return Array.from({ length: qr.getModuleCount() }, (_, y) =>
      Array.from({ length: qr.getModuleCount() }, (_, x) => qr.isDark(y, x)),
    );
  }
  function qrPath(modules, box) {
    // 黑色模块铺满元素框（size 即二维码符号区），静区改由框外白底承担，
    // 这样选中框/元素框紧贴二维码图案，与条形码「条纹铺满框」的处理一致。
    const unit = box.size / modules.length,
      parts = [];
    modules.forEach((line, y) =>
      line.forEach((dark, x) => {
        if (dark)
          parts.push(
            `M${number(box.x + x * unit)} ${number(box.y + y * unit)}h${number(unit)}v${number(unit)}h-${number(unit)}z`,
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
              `<g data-element-id="${escape(t.elementId || (['code', 'name'].includes(t.binding) ? t.binding : 'text-' + ti))}"><text x="${number(tx)}" y="${number(baseline)}" font-size="${number((t.font * 25.4) / 72)}" font-family="${fontFamily(t.fontFamily)}" font-weight="${t.fontWeight ?? (t.bold ? 700 : 400)}" text-anchor="${t.center ? 'middle' : t.align === 'right' ? 'end' : 'start'}" fill="${t.color || '#111'}">${escape(t.value)}</text></g>`
            );
          })
          .join('');
        const b = borderBox(plan.config, p);
        const border =
          plan.config.border && plan.config.borderWidth > 0
            ? `<rect data-label-border="true" x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="${b.radius}" fill="none" stroke="${plan.config.borderColor}" stroke-width="${plan.config.borderWidth}"${plan.config.borderStyle === 'solid' ? '' : ` stroke-dasharray="${plan.config.borderStyle === 'dotted' ? plan.config.borderWidth : plan.config.borderWidth * 3} ${plan.config.borderWidth * 2}"${plan.config.borderStyle === 'dotted' ? ' stroke-linecap="round"' : ''}`}/>`
            : '';
        const lines = (p.lines || [])
          .filter((l) => l.strokeWidth > 0)
          .map(
            (l) =>
              `<g data-element-id="${escape(l.id)}"><path d="M${l.x} ${l.y}h${l.width}" stroke="${l.color}" stroke-width="${l.strokeWidth}"/></g>`,
          )
          .join('');
        // 静区（4 模块）移到元素框外：白底向外扩展，保证扫码所需留白，同时框内黑色模块铺满
        const qrQuiet = p.qr ? (p.qr.size / modules.length) * 4 : 0;
        const qrBlock = p.qr
          ? `<g data-element-id="${escape(p.qr.elementId || 'qr')}"><rect x="${number(p.qr.x - qrQuiet)}" y="${number(p.qr.y - qrQuiet)}" width="${number(p.qr.size + 2 * qrQuiet)}" height="${number(p.qr.size + 2 * qrQuiet)}" fill="#fff"/>${qrPath(modules, p.qr)}</g>`
          : '';
        const bars = (p.barcodes || []).map((b) => barcodeSvg(b)).join('');
        return `<g data-label-code="${escape(p.record.code)}"><title>${escape(p.record.code)}</title><defs><clipPath id="${prefix}-label-clip-${p.index}"><rect x="${p.x}" y="${p.y}" width="${p.width}" height="${p.height}"/></clipPath></defs><g clip-path="url(#${prefix}-label-clip-${p.index})"><rect x="${p.x}" y="${p.y}" width="${p.width}" height="${p.height}" fill="#fff"/>${border}${lines}${qrBlock}${bars}${text}</g></g>`;
      })
      .join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${plan.paper.width}mm" height="${plan.paper.height}mm" viewBox="0 0 ${plan.paper.width} ${plan.paper.height}" role="img" aria-label="第${page + 1}页标签"><rect width="100%" height="100%" fill="#fff"/>${body}</svg>`;
  }
  function barcodeSvg(box) {
    const encoded = barcode.encode(box.code),
      quiet = encoded.quiet || 0,
      dataBits = encoded.bits.slice(quiet, encoded.bits.length - quiet),
      unit = box.width / dataBits.length,
      parts = [];
    for (let i = 0; i < dataBits.length; ) {
      if (dataBits[i] === '0') {
        i++;
        continue;
      }
      let end = i + 1;
      while (dataBits[end] === '1') end++;
      parts.push(
        `M${number(box.x + i * unit)} ${number(box.y)}h${number((end - i) * unit)}v${number(box.height)}h-${number((end - i) * unit)}z`,
      );
      i = end;
    }
    return `<g data-element-id="${escape(box.id)}" data-barcode="code128" aria-label="Code 128 ${escape(box.code)}"><rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" fill="#fff"/><path d="${parts.join('')}" fill="#000" shape-rendering="crispEdges"/></g>`;
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
        qr: p.qr
          ? { ...p.qr, x: Number(number(p.qr.x - p.x)), y: Number(number(p.qr.y - p.y)) }
          : null,
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
        barcodes: (p.barcodes || []).map((b) => ({
          ...b,
          x: Number(number(b.x - p.x)),
          y: Number(number(b.y - p.y)),
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
    // 若无二维码，跳过扫描难度提示
    if (!plan.positions.some((p) => p.qr)) return [];
    // Byte mode module count is determined by byte length. Check the densest code once.
    const longest = plan.positions.reduce((a, b) =>
      qrFactory.stringToBytes(a.record.code).length >= qrFactory.stringToBytes(b.record.code).length
        ? a
        : b,
    );
    if (!longest.qr) return [];
    // size 现在是纯符号区，模块真实物理尺寸 = size / 模块数；
    // 阈值按扫码枪实际可辨模块（约 0.3mm）校准，比旧的 0.25mm 略保守。
    const minimum = longest.qr.size / matrix(longest.record.code).length;
    return minimum < 0.3
      ? [`二维码模块约${number(minimum)}mm，可能难以扫描；建议增加二维码或标签尺寸，先试印确认。`]
      : [];
  }
  return Object.freeze({
    escape,
    matrix,
    pageSvg,
    labelSvg,
    borderBox,
    printHtml,
    warnings,
    fontFamily,
    fontFace,
    fontLatin,
    fontEa,
    fontIds,
  });
});
