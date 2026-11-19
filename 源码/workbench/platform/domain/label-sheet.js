'use strict';
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LabelSheet = factory();
})(typeof window === 'object' ? window : null, () => {
  const presets = { a4: [210, 297], a3: [297, 420], a5: [148, 210], letter: [215.9, 279.4] };
  const defaults = {
    paperSize: 'a4',
    paperWidth: 210,
    paperHeight: 297,
    separateMargins: false,
    marginLeft: 10,
    marginRight: 10,
    marginTop: 10,
    marginBottom: 10,
    pageAlignX: 'center',
    pageAlignY: 'start',
    lastRowAlign: 'start',
  };
  const round = (n) => Math.round(n * 1000) / 1000;
  function validate(c) {
    if (!Object.hasOwn(presets, c.paperSize) && c.paperSize !== 'custom')
      throw Error('纸张类型无效。');
    for (const k of ['paperWidth', 'paperHeight'])
      if (!Number.isFinite(c[k]) || c[k] < 20 || c[k] > 2000)
        throw Error('纸张宽高需在20至2000mm之间。');
    if (typeof c.separateMargins !== 'boolean') throw Error('独立边距开关无效。');
    for (const k of ['marginLeft', 'marginRight', 'marginTop', 'marginBottom'])
      if (!Number.isFinite(c[k]) || c[k] < 0 || c[k] > 500) throw Error('各边距需在0至500mm之间。');
    for (const k of ['pageAlignX', 'pageAlignY', 'lastRowAlign'])
      if (!['start', 'center', 'end'].includes(c[k])) throw Error('纸张对齐方式无效。');
    return c;
  }
  function measure(c) {
    const size = presets[c.paperSize];
    const paper = size
      ? {
          width: size[c.orientation === 'landscape' ? 1 : 0],
          height: size[c.orientation === 'landscape' ? 0 : 1],
        }
      : { width: c.paperWidth, height: c.paperHeight };
    const margins = Object.fromEntries(
      ['Left', 'Right', 'Top', 'Bottom'].map((k) => [
        k.toLowerCase(),
        c.separateMargins ? c['margin' + k] : c.margin,
      ]),
    );
    const printable = {
      x: margins.left,
      y: margins.top,
      width: round(paper.width - margins.left - margins.right),
      height: round(paper.height - margins.top - margins.bottom),
    };
    if (printable.width <= 0 || printable.height <= 0)
      throw Error('页边距占满纸张，请减小边距或增大纸张。');
    return { paper, margins, printable };
  }
  function grid(c, count) {
    const area = measure(c),
      { printable: p } = area;
    const fits = Math.floor((p.width + 0.001 + c.gapX) / (c.width + c.gapX)),
      rows = Math.floor((p.height + 0.001 + c.gapY) / (c.height + c.gapY));
    if (fits < 1 || rows < 1) throw Error('标签超过当前可打印区域，请调整纸张、边距或标签尺寸。');
    const columns = c.columns ? Math.min(c.columns, fits) : fits,
      capacity = columns * rows,
      pages = Math.ceil(count / capacity),
      warnings = [];
    if (c.columns && columns < c.columns)
      warnings.push(`当前可打印宽度最多容纳${columns}列，已自动调整。`);
    const factor = { start: 0, center: 0.5, end: 1 };
    const positions = Array.from({ length: count }, (_, index) => {
      const page = Math.floor(index / capacity),
        local = index % capacity,
        n = Math.min(capacity, count - page * capacity),
        usedCols = Math.min(columns, n),
        usedRows = Math.ceil(n / columns),
        column = local % columns,
        band = Math.floor(local / columns);
      const gridW = usedCols * c.width + (usedCols - 1) * c.gapX,
        gridH = usedRows * c.height + (usedRows - 1) * c.gapY;
      const inRow = Math.min(columns, n - band * columns),
        rowW = inRow * c.width + (inRow - 1) * c.gapX;
      return {
        page,
        column,
        band,
        x: round(
          p.x +
            (p.width - gridW) * factor[c.pageAlignX] +
            (gridW - rowW) * factor[c.lastRowAlign] +
            column * (c.width + c.gapX),
        ),
        y: round(p.y + (p.height - gridH) * factor[c.pageAlignY] + band * (c.height + c.gapY)),
      };
    });
    return { ...area, columns, rows, capacity, pages, positions, warnings };
  }
  return Object.freeze({ presets, defaults, validate, measure, grid });
});
