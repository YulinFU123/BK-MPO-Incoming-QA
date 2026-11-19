'use strict';
(function (root, factory) {
  const model = factory(
    typeof module === 'object' && module.exports ? require('./label-template') : root.LabelTemplate,
    typeof module === 'object' && module.exports ? require('./label-sheet') : root.LabelSheet,
  );
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.LabelLayout = model;
})(typeof window === 'object' ? window : null, (templates, sheets) => {
  const mmPerPt = 25.4 / 72;
  const round = (value) => Math.round(value * 1000) / 1000;
  const base = {
    ...sheets.defaults,
    kind: 'fixture',
    width: 50,
    height: 50,
    qrSize: 22,
    fontSize: 9,
    padding: 2,
    gapX: 5,
    gapY: 5,
    margin: 10,
    columns: 0,
    orientation: 'landscape',
    signatures: true,
    sort: true,
    qrMode: 'auto',
    qrScale: 100,
    layout: 'auto',
    showName: true,
    showSpec: true,
    showCode: true,
    border: true,
    allowDuplicates: false,
    composition: 'auto',
    template: null,
    borderWidth: 0.25,
    borderInset: 0,
    borderRadius: 0,
    borderStyle: 'solid',
    borderColor: '#444444',
  };
  const ranges = {
    width: [8, 1000],
    height: [8, 1000],
    qrSize: [2, 1000],
    fontSize: [3, 96],
    padding: [0, 40],
    gapX: [0, 100],
    gapY: [0, 100],
    margin: [0, 60],
    columns: [0, 50],
    qrScale: [10, 100],
    borderWidth: [0, 20],
    borderInset: [0, 40],
    borderRadius: [0, 40],
  };
  const titles = {
    width: '标签宽',
    height: '标签高',
    qrSize: '二维码大小',
    fontSize: '字号',
    padding: '标签内边距',
    gapX: '横向间距',
    gapY: '纵向间距',
    margin: '纸张页边距',
    columns: '每排张数',
    qrScale: '二维码占比',
    borderWidth: '边框粗细',
    borderInset: '边框内缩',
    borderRadius: '边框圆角',
  };
  const asciiWidths = {
    I: 0.278,
    J: 0.5,
    M: 0.833,
    W: 0.944,
    F: 0.611,
    L: 0.556,
    T: 0.611,
    '-': 0.333,
    '.': 0.278,
    '/': 0.278,
    ':': 0.278,
    _: 0.556,
    i: 0.222,
    l: 0.222,
    m: 0.833,
    w: 0.722,
  };
  function textWidth(text, pt) {
    return (
      [...text].reduce(
        (sum, c) =>
          sum +
          (asciiWidths[c] ??
            (/\d/.test(c) ? 0.556 : /[A-Z]/.test(c) ? 0.69 : /[a-z]/.test(c) ? 0.56 : 1)),
        0,
      ) *
      pt *
      mmPerPt
    );
  }
  function config(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('排版参数无效。');
    if (Object.keys(input).some((key) => !Object.hasOwn(base, key)))
      throw Error('存在不支持的排版参数。');
    const c = sheets.validate({ ...base, ...input });
    if (
      !['fixture', 'stripper'].includes(c.kind) ||
      !['landscape', 'portrait'].includes(c.orientation) ||
      !['auto', 'manual'].includes(c.qrMode) ||
      !['auto', 'vertical', 'horizontal'].includes(c.layout) ||
      !['auto', 'custom'].includes(c.composition) ||
      !['solid', 'dashed', 'dotted'].includes(c.borderStyle) ||
      !/^#[0-9a-f]{6}$/i.test(c.borderColor)
    )
      throw Error('标签类型或纸张方向无效。');
    for (const [name, [min, max]] of Object.entries(ranges))
      if (
        typeof c[name] !== 'number' ||
        !Number.isFinite(c[name]) ||
        c[name] < min ||
        c[name] > max
      )
        throw Error(
          `${titles[name]}需在${min}至${max}${name === 'fontSize' ? 'pt' : name === 'columns' ? '张' : 'mm'}之间。`,
        );
    if (!Number.isInteger(c.columns)) throw Error('每排张数应为整数，0表示自动。');
    for (const key of [
      'signatures',
      'sort',
      'showName',
      'showSpec',
      'showCode',
      'border',
      'allowDuplicates',
    ])
      if (typeof c[key] !== 'boolean') throw Error('开关参数无效。');
    c.borderInset = Math.min(
      c.borderInset,
      Math.max(0, (Math.min(c.width, c.height) - c.borderWidth - 0.05) / 2),
    );
    c.borderRadius = Math.min(
      c.borderRadius,
      Math.max(0, (Math.min(c.width, c.height) - 2 * c.borderInset - c.borderWidth) / 2),
    );
    if (c.template !== null) c.template = templates.resize(c.template, c.width, c.height);
    if (c.composition === 'custom' && c.template === null) throw Error('请先设计一个自定义模板。');
    return c;
  }
  function preset(kind) {
    return {
      ...base,
      ...(kind === 'stripper'
        ? { kind, width: 62, height: 20, qrSize: 17, padding: 1.5, signatures: false }
        : {}),
    };
  }
  function records(input, { allowDuplicates = false } = {}) {
    if (!Array.isArray(input) || !input.length || input.length > 2000)
      throw Error('请填写1至2000个编号。');
    const seen = new Set();
    return input.map((item, i) => {
      if (
        !item ||
        typeof item !== 'object' ||
        Array.isArray(item) ||
        Object.keys(item).some((k) => !['code', 'name', 'spec', 'creator'].includes(k))
      )
        throw Error('编号数据格式无效。');
      const row = {};
      for (const [key, max] of [
        ['code', 128],
        ['name', 100],
        ['creator', 60],
        ...(Object.hasOwn(item, 'spec') ? [['spec', 100]] : []),
      ]) {
        if (
          (item[key] !== undefined && typeof item[key] !== 'string') ||
          String(item[key] ?? '').length > max ||
          /[\u0000-\u001f\u007f]/.test(item[key] ?? '')
        )
          throw Error(`第${i + 1}项文字无效或过长。`);
        row[key] = String(item[key] ?? '').trim();
      }
      if (!row.code) throw Error(`第${i + 1}项编号不能为空。`);
      if (!allowDuplicates && seen.has(row.code))
        throw Error(`编号重复：${row.code}；需要多张相同标签时可开启“允许重复编号”。`);
      seen.add(row.code);
      return row;
    });
  }
  function parse(text, name = '', creators = {}, options = {}) {
    if (typeof text !== 'string' || text.length > 300000) throw Error('编号列表过长。');
    return records(
      text
        .split(/[\r\n\t]+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((code) => ({
          code,
          name,
          creator: Object.hasOwn(creators, code) ? creators[code] : '',
        })),
      options,
    );
  }
  function continuous(prefix, start, end, digits = 3) {
    if (
      typeof prefix !== 'string' ||
      prefix.length > 115 ||
      /[\u0000-\u001f\u007f]/.test(prefix) ||
      ![start, end, digits].every(Number.isInteger) ||
      start < 0 ||
      end < start ||
      end > 999999999 ||
      end - start >= 2000 ||
      digits < 1 ||
      digits > 12
    )
      throw Error('连续编号需递增整数，每批最多2000个，补零位数1至12。');
    return Array.from(
      { length: end - start + 1 },
      (_, i) => prefix + String(start + i).padStart(digits, '0'),
    );
  }
  function fitText(text, width, pt) {
    if (width <= 0) throw Error('标签内容宽度不足，请增加宽度或减小内边距。');
    let size = Math.min(pt, (width / Math.max(0.001, textWidth(text, pt))) * pt);
    if (!text) return { lines: [], font: pt };
    if (size >= 3) return { lines: [text], font: round(size) };
    size = Math.min(pt, 3);
    let lines = [''];
    for (const char of text) {
      const last = lines.length - 1;
      if (lines[last] && textWidth(lines[last] + char, size) > width) lines.push(char);
      else lines[last] += char;
    }
    if (lines.length > 4) throw Error('文字在当前宽度无法完整显示，请加宽标签或关闭对应文字。');
    return { lines, font: size };
  }
  function plan(input, items) {
    const c = config(input),
      rows = records(items, c);
    if (c.sort)
      rows.sort(
        (a, b) =>
          a.code.localeCompare(b.code, 'en', { numeric: true, sensitivity: 'variant' }) ||
          a.code.localeCompare(b.code),
      );
    const grid = sheets.grid(c, rows.length),
      { paper, printable, margins, columns, capacity, pages } = grid,
      perColumn = grid.rows,
      warnings = [...grid.warnings];
    if (c.composition === 'custom') {
      const positions = rows.map((record, index) => {
        const { x, y, column: col, band } = grid.positions[index];
        const shape = templates.compose(c, record, { textWidth, mmPerPt });
        warnings.push(...shape.warnings);
        return {
          index,
          page: Math.floor(index / capacity),
          column: col,
          band,
          record,
          x,
          y,
          width: c.width,
          height: c.height,
          qr: shape.qr ? { ...shape.qr, x: round(x + shape.qr.x), y: round(y + shape.qr.y) } : null,
          text: shape.text.map((t) => ({ ...t, x: round(x + t.x), y: round(y + t.y) })),
          lines: shape.lines.map((l) => ({ ...l, x: round(x + l.x), y: round(y + l.y) })),
          barcodes: shape.barcodes.map((b) => ({ ...b, x: round(x + b.x), y: round(y + b.y) })),
        };
      });
      const repeated = rows.length - new Set(rows.map((r) => r.code)).size;
      if (repeated) warnings.push(`本批含${repeated}张重复编号标签，按设置保留。`);
      return {
        config: c,
        paper,
        printable,
        margins,
        columns,
        rows: perColumn,
        capacity,
        pages,
        qrSize: positions[0].qr ? positions[0].qr.size : 0,
        warnings: [...new Set(warnings)],
        layout: 'custom',
        positions,
      };
    }
    const innerW = c.width - 2 * c.padding,
      innerH = c.height - 2 * c.padding;
    if (innerW <= 0 || innerH <= 0) throw Error('内边距占满了标签，请减小内边距。');
    const hasText =
      c.showCode ||
      (c.showName && rows.some((r) => r.name)) ||
      (c.showSpec && rows.some((r) => r.spec)) ||
      c.signatures;
    const vertical =
      !hasText || c.layout === 'vertical' || (c.layout === 'auto' && c.width / c.height < 1.6);
    const gap = hasText ? Math.min(1.5, innerH * 0.06) : 0;
    const signFont = Math.max(3, Math.min(c.fontSize, 9)),
      signHeight = signFont * mmPerPt * 1.35;
    const signatureHeight = c.signatures ? signHeight * 3 : 0;
    let available = vertical ? innerW : Math.min(innerH, innerW * 0.54);
    let qrSize =
      c.qrMode === 'auto' ? (available * c.qrScale) / 100 : Math.min(c.qrSize, available);
    const codeWidth = vertical ? innerW : innerW - qrSize - gap;
    const typography = rows.map((r) => ({
      code: fitText(c.showCode ? r.code : '', codeWidth, c.fontSize + 0.5),
      name: fitText(c.showName ? r.name : '', codeWidth, c.fontSize),
      spec: fitText(c.showSpec ? r.spec || '' : '', codeWidth, c.fontSize),
    }));
    const codeLines = Math.max(...typography.map((t) => t.code.lines.length)),
      nameLines = Math.max(...typography.map((t) => t.name.lines.length)),
      specLines = Math.max(...typography.map((t) => t.spec.lines.length));
    const actualFont = Math.max(
      3,
      ...typography.flatMap((t) => [
        t.code.lines.length ? t.code.font : 0,
        t.name.lines.length ? t.name.font : 0,
        t.spec.lines.length ? t.spec.font : 0,
      ]),
    );
    const lineHeight = actualFont * mmPerPt * 1.23;
    const textHeight = (codeLines + nameLines + specLines) * lineHeight + signatureHeight;
    if (vertical) {
      available = Math.min(innerW, innerH - textHeight - gap);
      qrSize = c.qrMode === 'auto' ? (available * c.qrScale) / 100 : Math.min(c.qrSize, available);
    } else if (textHeight > innerH + 0.001) {
      throw Error('文字与审核栏高于标签，请增加高度、减小字号或关闭不需要的内容。');
    }
    if (qrSize < 2 || available < 2)
      throw Error('内容放不下，请关闭不需要的文字/审核栏，或调整尺寸和内边距。');
    qrSize = round(qrSize);
    if (c.qrMode === 'manual' && qrSize < c.qrSize - 0.01)
      warnings.push(`二维码已适配为${qrSize}mm，避免超出标签。`);
    if (
      typography.some(
        (t) =>
          (t.code.lines.length && t.code.font < c.fontSize + 0.49) ||
          (t.name.lines.length && t.name.font < c.fontSize - 0.01) ||
          (t.spec.lines.length && t.spec.font < c.fontSize - 0.01),
      )
    )
      warnings.push('长文字已自动缩小或换行，内容完整保留。');
    const duplicateCount = rows.length - new Set(rows.map((r) => r.code)).size;
    if (duplicateCount) warnings.push(`本批含${duplicateCount}张重复编号标签，按你的设置保留。`);
    const positions = rows.map((row, index) => {
      const { x, y, column: col, band } = grid.positions[index],
        text = [];
      const add = (layout, tx, top, width, lineCount, bold = false, binding = 'fixed') => {
        layout.lines.forEach((value, j) =>
          text.push({
            value,
            x: round(tx),
            y: round(top + j * lineHeight),
            width: round(width),
            height: round(lineHeight),
            font: layout.font,
            bold,
            center: vertical,
            binding,
          }),
        );
        return top + lineCount * lineHeight;
      };
      const contentHeight = vertical ? qrSize + gap + textHeight : Math.max(qrSize, textHeight);
      const top = y + c.padding + (innerH - contentHeight) / 2;
      const qr = vertical
        ? { x: round(x + (c.width - qrSize) / 2), y: round(top), size: qrSize }
        : { x: round(x + c.padding), y: round(y + (c.height - qrSize) / 2), size: qrSize };
      const tx = vertical ? x + c.padding : x + c.padding + qrSize + gap,
        tw = vertical ? innerW : codeWidth;
      let cursor = vertical ? top + qrSize + gap : y + (c.height - textHeight) / 2;
      cursor = add(typography[index].code, tx, cursor, tw, codeLines, true, 'code');
      cursor = add(typography[index].name, tx, cursor, tw, nameLines, false, 'name');
      cursor = add(typography[index].spec, tx, cursor, tw, specLines, false, 'spec');
      if (c.signatures) {
        const titleWidth = Math.min(19, tw * 0.5);
        for (const [title, value] of [
          ['制作人：', row.creator],
          ['审核人：', ''],
          ['QA审核：', ''],
        ]) {
          const font = Math.min(signFont, titleWidth / Math.max(0.001, textWidth(title, 1)));
          const valueFont = value
            ? Math.min(font, (tw - titleWidth) / Math.max(0.001, textWidth(value, 1)))
            : font;
          if (Math.min(font, valueFont) < 3)
            throw Error('审核文字在当前宽度放不下，请加宽或关闭审核栏。');
          text.push({
            value: title,
            x: round(tx),
            y: round(cursor),
            width: round(titleWidth),
            height: round(signHeight),
            font: round(font),
            bold: false,
            center: false,
            rule: true,
            category: 'audit',
            binding: 'fixed',
          });
          text.push({
            value,
            x: round(tx + titleWidth),
            y: round(cursor),
            width: round(tw - titleWidth),
            height: round(signHeight),
            font: round(valueFont),
            bold: false,
            center: false,
            category: 'audit',
            binding: title === '制作人：' ? 'creator' : 'fixed',
          });
          cursor += signHeight;
        }
      }
      return {
        index,
        page: Math.floor(index / capacity),
        column: col,
        band,
        record: row,
        x,
        y,
        width: c.width,
        height: c.height,
        qr,
        text,
      };
    });
    return {
      config: c,
      paper,
      printable,
      margins,
      columns,
      rows: perColumn,
      capacity,
      pages,
      qrSize,
      warnings,
      layout: vertical ? 'vertical' : 'horizontal',
      positions,
    };
  }
  return Object.freeze({
    config,
    preset,
    records,
    parse,
    continuous,
    plan,
    textWidth,
    mmPerPt,
    toTemplate: templates.fromPlan,
  });
});
