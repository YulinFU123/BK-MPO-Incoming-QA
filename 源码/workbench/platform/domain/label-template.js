'use strict';
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./code128'));
  else root.LabelTemplate = factory(root.Code128);
})(typeof window === 'object' ? window : null, (barcode) => {
  const round = (n) => Math.round(n * 1000) / 1000;
  const color = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
  // 与 label-render.js 的 fonts 表保持同步；此处仅用于校验与自动模板回读
  const fontIds = Object.freeze([
    'sans',
    'serif',
    'mono',
    'yahei',
    'simhei',
    'simsun',
    'kaiti',
    'fangsong',
    'arial',
    'times',
    'calibri',
    'courier',
  ]);
  function validate(value) {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).some((k) => !['version', 'width', 'height', 'elements'].includes(k)) ||
      ![1, 2].includes(value.version) ||
      !Array.isArray(value.elements) ||
      value.elements.length > 30
    )
      throw Error('自定义模板格式无效。');
    for (const n of ['width', 'height'])
      if (
        typeof value[n] !== 'number' ||
        !Number.isFinite(value[n]) ||
        value[n] < 8 ||
        value[n] > 1000
      )
        throw Error('模板尺寸需在8至1000mm之间。');
    const ids = new Set();
    let qr = 0;
    const elements = value.elements.map((e) => {
      if (
        !e ||
        typeof e !== 'object' ||
        Array.isArray(e) ||
        Object.keys(e).some(
          (k) =>
            ![
              'id',
              'type',
              'x',
              'y',
              'width',
              'height',
              'binding',
              'text',
              'fontSize',
              'bold',
              'fontWeight',
              'align',
              'color',
              'strokeWidth',
              'category',
              'group',
              'valign',
              'fontFamily',
            ].includes(k),
        )
      )
        throw Error('模板元素无效。');
      if (
        typeof e.id !== 'string' ||
        !/^[a-zA-Z0-9-]{1,64}$/.test(e.id) ||
        ids.has(e.id) ||
        !['qr', 'text', 'line', 'barcode'].includes(e.type) ||
        (e.type === 'barcode' && value.version !== 2)
      )
        throw Error('模板元素类型或编号无效。');
      ids.add(e.id);
      if (e.category !== undefined && !['content', 'audit'].includes(e.category))
        throw Error('元素分组无效。');
      for (const n of ['x', 'y', 'width', 'height'])
        if (typeof e[n] !== 'number' || !Number.isFinite(e[n]))
          throw Error('元素位置和尺寸需为有限数字。');
      const result = {
        id: e.id,
        type: e.type,
        x: e.x,
        y: e.y,
        width: e.width,
        height: e.height,
        category: e.category === 'audit' ? 'audit' : 'content',
      };
      if (e.group !== undefined) {
        if (typeof e.group !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(e.group))
          throw Error('组合编号无效。');
        result.group = e.group;
      }
      if (
        e.x < 0 ||
        e.y < 0 ||
        e.width <= 0 ||
        e.height < 0 ||
        e.x + e.width > value.width + 0.001 ||
        e.y + e.height > value.height + 0.001
      )
        throw Error('元素超出标签，请调整位置或尺寸。');
      if (e.type === 'qr') {
        qr++;
        if (e.width < 2 || Math.abs(e.width - e.height) > 0.001)
          throw Error('二维码需为至少2mm的正方形。');
      } else if (e.type === 'barcode') {
        if (e.width < 5 || e.height < 3)
          throw Error('条形码至少宽5mm、高3mm；请结合编号长度检查最窄条宽。');
      } else if (e.type === 'text') {
        if (
          !['code', 'name', 'spec', 'creator', 'fixed'].includes(e.binding) ||
          typeof e.text !== 'string' ||
          e.text.length > 160 ||
          /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(e.text) ||
          typeof e.fontSize !== 'number' ||
          !Number.isFinite(e.fontSize) ||
          e.fontSize < 3 ||
          e.fontSize > 96 ||
          typeof e.bold !== 'boolean' ||
          !['left', 'center', 'right'].includes(e.align) ||
          !color(e.color) ||
          e.height <= 0
        )
          throw Error('文字内容、字号或对齐方式无效。');
        if (e.valign !== undefined && !['top', 'middle', 'bottom'].includes(e.valign))
          throw Error('文字垂直对齐无效。');
        if (e.fontFamily !== undefined && !fontIds.includes(e.fontFamily))
          throw Error('字体无效。');
        if (
          e.fontWeight !== undefined &&
          (typeof e.fontWeight !== 'number' ||
            !Number.isFinite(e.fontWeight) ||
            e.fontWeight < 100 ||
            e.fontWeight > 900)
        )
          throw Error('字重需在100至900之间。');
        Object.assign(result, {
          binding: e.binding,
          text: e.text,
          fontSize: e.fontSize,
          bold: e.bold,
          align: e.align,
          color: e.color,
          valign: e.valign || 'middle',
          fontFamily: e.fontFamily || 'sans',
          ...(e.fontWeight !== undefined ? { fontWeight: e.fontWeight } : {}),
        });
      } else {
        if (
          e.height !== 0 ||
          typeof e.strokeWidth !== 'number' ||
          !Number.isFinite(e.strokeWidth) ||
          e.strokeWidth < 0 ||
          e.strokeWidth > 20 ||
          !color(e.color)
        )
          throw Error('横线粗细需在0至20mm之间。');
        Object.assign(result, { strokeWidth: e.strokeWidth, color: e.color });
      }
      return result;
    });
    if (qr > 1) throw Error('每张标签最多保留一个二维码。');
    return { version: value.version, width: value.width, height: value.height, elements };
  }
  function resize(value, width, height) {
    const t = validate(value);
    if (t.width === width && t.height === height) return t;
    const rx = width / t.width,
      ry = height / t.height;
    return validate({
      version: t.version,
      width,
      height,
      elements: t.elements.map((e) => {
        const w = round(
            Math.max(
              e.type === 'qr' ? 2 : 0.01,
              e.width * (e.type === 'qr' ? Math.min(rx, ry) : rx),
            ),
          ),
          h = e.type === 'qr' ? w : round(e.height * ry);
        return {
          ...e,
          x: round(Math.max(0, Math.min(e.x * rx, width - w))),
          y: round(Math.max(0, Math.min(e.y * ry, height - h))),
          width: w,
          height: h,
          ...(e.type === 'text'
            ? { fontSize: Math.max(3, Math.min(96, round(e.fontSize * Math.min(rx, ry)))) }
            : {}),
        };
      }),
    });
  }
  function visible(e, c) {
    return (
      !(e.category === 'audit' && !c.signatures) &&
      !(e.binding === 'name' && !c.showName) &&
      !(e.binding === 'spec' && c.showSpec === false) &&
      !(e.binding === 'code' && !c.showCode)
    );
  }
  function fromPlan(plan, index = 0) {
    const p = plan.positions[index],
      elements = [
        {
          id: 'qr',
          type: 'qr',
          x: round(p.qr.x - p.x),
          y: round(p.qr.y - p.y),
          width: p.qr.size,
          height: p.qr.size,
        },
      ];
    const handled = new Set();
    for (const [i, t] of p.text.entries()) {
      const binding = t.binding || 'fixed';
      if (['code', 'name', 'spec'].includes(binding)) {
        if (handled.has(binding)) continue;
        handled.add(binding);
        const lines = p.text.filter((t) => t.binding === binding);
        elements.push({
          id: binding,
          type: 'text',
          binding,
          text: '',
          x: round(t.x - p.x),
          y: round(t.y - p.y),
          width: t.width,
          height: round(Math.max(...lines.map((l) => l.y + l.height)) - t.y),
          fontSize: Math.min(96, Math.max(3, t.font)),
          bold: t.bold,
          align: t.center ? 'center' : 'left',
          color: t.color || '#111111',
        });
      } else if (t.value || binding === 'creator')
        elements.push({
          id: 'text-' + i,
          type: 'text',
          binding,
          text: binding === 'creator' ? '' : t.value,
          x: round(t.x - p.x),
          y: round(t.y - p.y),
          width: t.width,
          height: t.height,
          fontSize: Math.min(96, Math.max(3, t.font)),
          bold: t.bold,
          align: t.center ? 'center' : 'left',
          color: t.color || '#111111',
          category: t.category || 'content',
        });
      if (t.rule)
        elements.push({
          id: 'line-' + i,
          type: 'line',
          x: 0,
          y: round(t.y - p.y),
          width: p.width,
          height: 0,
          strokeWidth: 0.15,
          color: '#a2aab5',
          category: 'audit',
        });
    }
    return validate({ version: 1, width: p.width, height: p.height, elements });
  }
  function compose(c, record, { textWidth, mmPerPt }) {
    const t = resize(c.template, c.width, c.height),
      text = [],
      lines = [],
      barcodes = [],
      warnings = [];
    const q = t.elements.find((e) => e.type === 'qr'),
      qr = q ? { x: q.x, y: q.y, size: q.width, elementId: q.id } : null;
    for (const e of t.elements) {
      if (e.type === 'qr') continue;
      if (!visible(e, c)) continue;
      if (e.type === 'barcode') {
        const code = barcode.encode(record.code),
          unit = e.width / (code.modules - 2 * (code.quiet || 0));
        barcodes.push({ ...e, code: record.code });
        if (unit < 0.19)
          warnings.push(
            `条形码最窄条宽约${round(unit)}mm，建议加宽后试扫；条纹已铺满框宽，静区由框外白底承担。`,
          );
        if (
          qr &&
          e.x < qr.x + qr.size &&
          e.x + e.width > qr.x &&
          e.y < qr.y + qr.size &&
          e.y + e.height > qr.y
        )
          warnings.push('条形码与二维码重叠，请调整位置后试印。');
        if (
          t.elements.some(
            (o) =>
              o.id !== e.id &&
              o.type !== 'qr' &&
              visible(o, c) &&
              e.x < o.x + o.width &&
              e.x + e.width > o.x &&
              e.y < o.y + o.height &&
              e.y + e.height > o.y,
          )
        )
          warnings.push('条形码与其他内容重叠，请调整位置，避免遮挡条码及静区。');
        continue;
      }
      if (e.type === 'line') {
        lines.push({ ...e });
        continue;
      }
      const value = e.binding === 'fixed' ? e.text : e.text + String(record[e.binding] ?? '');
      if (!value) continue;
      function wrap(font) {
        const output = [];
        for (const paragraph of value.split('\n')) {
          let line = '';
          for (const ch of paragraph) {
            if (line && textWidth(line + ch, font) > e.width) {
              output.push(line);
              line = ch;
            } else line += ch;
          }
          output.push(line);
        }
        return output;
      }
      const fits = (font) => {
        const rows = wrap(font);
        return (
          rows.length * font * mmPerPt * 1.15 <= e.height + 0.001 &&
          rows.every((s) => textWidth(s, font) <= e.width + 0.001)
        );
      };
      let font = e.fontSize;
      if (!fits(font)) {
        if (!fits(3))
          throw Error('自定义文字框放不下完整内容，请放大文字框、减小字号或关闭相应文字。');
        let lo = 3,
          hi = font;
        for (let i = 0; i < 18; i++) {
          const mid = (lo + hi) / 2;
          if (fits(mid)) lo = mid;
          else hi = mid;
        }
        font = Math.floor(lo * 1000) / 1000;
      }
      const wrapped = wrap(font);
      if (font < e.fontSize - 0.01) warnings.push('部分动态文字已适配字号。');
      const lineHeight = font * mmPerPt * 1.15,
        top =
          e.y +
          (e.height - wrapped.length * lineHeight) * { top: 0, middle: 0.5, bottom: 1 }[e.valign];
      wrapped.forEach((value, i) =>
        text.push({
          value,
          x: e.x,
          y: round(top + i * lineHeight),
          width: e.width,
          height: round(lineHeight),
          font,
          bold: e.bold,
          fontWeight: e.fontWeight ?? (e.bold ? 700 : 400),
          center: e.align === 'center',
          align: e.align,
          color: e.color,
          elementId: e.id,
          binding: e.binding,
          category: e.category,
          fontFamily: e.fontFamily,
        }),
      );
      if (
        qr &&
        value &&
        e.x < qr.x + qr.size &&
        e.x + e.width > qr.x &&
        e.y < qr.y + qr.size &&
        e.y + e.height > qr.y
      )
        warnings.push('文字框与二维码区域重叠，可能影响扫描，请核对。');
    }
    return { qr, text, lines, barcodes, warnings: [...new Set(warnings)], template: t };
  }
  return Object.freeze({ validate, resize, fromPlan, compose, visible });
});
