'use strict';
const { DOMParser } = require('../vendor/xmldom');
const { openZip } = require('../adapters/xlsx/zip');
const { zip, png } = require('./label-assets');
const render = require('./label-render');
const posix = require('node:path').posix;
const esc = render.escape;
function xml(bytes) {
  if (!bytes) throw Error('Excel缺少必要文档。');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (/<!\s*(DOCTYPE|ENTITY)/i.test(text) || text.length > 16 * 1024 * 1024)
    throw Error('Excel内部XML不符合读取要求。');
  if ((text.match(/</g) || []).length > 500000) throw Error('工作表内容过多，请拆分后读取编号。');
  const document = new DOMParser({
    onError: () => {
      throw Error('Excel内部XML损坏。');
    },
  }).parseFromString(text, 'application/xml');
  const pending = [[document.documentElement, 1]];
  let count = 0;
  while (pending.length) {
    const [node, depth] = pending.pop();
    if (!node || ++count > 500000 || depth > 128)
      throw Error('工作簿结构过于复杂，请另存为普通XLSX。');
    for (let child = node.firstChild; child; child = child.nextSibling)
      pending.push([child, depth + 1]);
  }
  return document;
}
const nodes = (root, name) => Array.from(root.getElementsByTagNameNS('*', name));
function labelsFromWorkbook(bytes) {
  const archive = openZip(bytes);
  if (archive.names.some((n) => /vbaProject|externalLinks\//i.test(n)))
    throw Error('请使用不含宏和外部链接的XLSX。');
  const relations = xml(archive.read('xl/_rels/workbook.xml.rels'));
  const relationMap = new Map(
    nodes(relations, 'Relationship').map((r) => {
      if (r.getAttribute('TargetMode') === 'External') throw Error('工作簿包含外部链接。');
      const target = r.getAttribute('Target');
      if (/[\\:%?#]/.test(target)) throw Error('工作簿引用路径无效。');
      const resolved = posix.normalize(
        target.startsWith('/') ? target.slice(1) : posix.join('xl', target),
      );
      if (!resolved.startsWith('xl/') || resolved.includes('../')) throw Error('工作簿引用越界。');
      return [r.getAttribute('Id'), resolved];
    }),
  );
  const shared = archive.read('xl/sharedStrings.xml');
  const strings = shared
    ? nodes(xml(shared), 'si').map((si) =>
        nodes(si, 't')
          .map((t) => t.textContent)
          .join(''),
      )
    : [];
  const styles = archive.read('xl/styles.xml'),
    formats = new Map(),
    xf = [];
  if (styles) {
    const doc = xml(styles);
    for (const f of nodes(doc, 'numFmt'))
      formats.set(f.getAttribute('numFmtId'), f.getAttribute('formatCode'));
    const cellXfs = nodes(doc, 'cellXfs')[0];
    if (cellXfs) for (const x of nodes(cellXfs, 'xf')) xf.push(x.getAttribute('numFmtId'));
  }
  const sheets = [];
  for (const sheet of nodes(xml(archive.read('xl/workbook.xml')), 'sheet')) {
    const name = sheet.getAttribute('name'),
      part = relationMap.get(sheet.getAttribute('r:id'));
    const cells = new Map(),
      errors = [];
    for (const c of nodes(xml(archive.read(part)), 'c')) {
      const ref = c.getAttribute('r');
      if (!/^[A-Z]{1,3}[1-9]\d{0,6}$/.test(ref) || cells.size > 100000)
        throw Error('工作表范围超出标签读取限制。');
      const type = c.getAttribute('t'),
        raw = nodes(c, 'v')[0]?.textContent || '';
      if (type === 'e') {
        errors.push(ref);
        continue;
      }
      let value =
        type === 's'
          ? strings[Number(raw)]
          : type === 'inlineStr'
            ? nodes(c, 't')
                .map((t) => t.textContent)
                .join('')
            : raw;
      if (typeof value !== 'string') throw Error('工作表文本索引无效。');
      if (!type || type === 'n') {
        const fmt = formats.get(xf[Number(c.getAttribute('s') || 0)]);
        if (fmt && /^0{1,64}$/.test(fmt) && /^\d+$/.test(value))
          value = value.padStart(fmt.length, '0');
      }
      cells.set(ref, value.trim());
    }
    const headers = [...cells].filter(([, v]) =>
      ['编号', '完整编号', '夹具编号', '设备编号', '资产编号', 'SN'].includes(v),
    );
    const found = new Map(),
      duplicates = [];
    for (const [ref, value] of cells) {
      const match = /^([A-Z]+)(\d+)$/.exec(ref),
        col = match[1],
        row = Number(match[2]);
      const columnHeader = headers.find(
        ([h]) => h.replace(/\d+$/, '') === col && Number(h.match(/\d+$/)[0]) < row,
      );
      const candidate = columnHeader
        ? value.length > 0 && value.length <= 128 && !/[\u0000-\u001f\u007f]/.test(value)
        : /^[A-Za-z0-9][A-Za-z0-9_.:/-]*-\d+$/.test(value);
      if (!candidate) continue;
      if (found.has(value)) {
        duplicates.push({ code: value, cell: ref });
        continue;
      }
      const labelName = cells.get(col + (row + 1));
      const makerTitle = cells.get(col + (row + 2));
      let creator = '';
      if (makerTitle === '制作人：' || makerTitle === '制作人:') {
        const next = col.length === 1 ? String.fromCharCode(col.charCodeAt(0) + 1) : null;
        creator = next ? cells.get(next + (row + 2)) || '' : '';
      }
      let resolvedName = labelName && /[\u3400-\u9fff]/.test(labelName) ? labelName : name;
      if (columnHeader) {
        const headerRow = columnHeader[0].match(/\d+$/)[0];
        const findColumn = (titles) =>
          [...cells]
            .find(([r, v]) => r.match(/\d+$/)[0] === headerRow && titles.includes(v))?.[0]
            .replace(/\d+$/, '');
        const nameCol = findColumn(['名称', '标签名称', '类别']),
          creatorCol = findColumn(['制作人', '制作人：']);
        if (nameCol) resolvedName = cells.get(nameCol + row) ?? '';
        if (creatorCol) creator = cells.get(creatorCol + row) || '';
      }
      found.set(value, { code: value, name: resolvedName, creator, cell: ref });
    }
    if (found.size > 2000) throw Error('每张表最多读取2000个编号，请拆分后重试。');
    sheets.push({ name, records: [...found.values()], duplicates, errorCells: errors.length });
  }
  return { sheets };
}
const letters = (n) => {
  let s = '';
  for (n++; n; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const relNs = 'http://schemas.openxmlformats.org/package/2006/relationships';
function exportWorkbook(plan) {
  const entries = [],
    sheetNames = [],
    overrides = [],
    relations = [],
    styles = [],
    styleMap = new Map(),
    fonts = ['<font><sz val="11"/><name val="Arial"/></font>'];
  const style = (t) => {
    const key = [t.font, t.bold, t.center, t.align, t.color].join(':');
    if (styleMap.has(key)) return styleMap.get(key);
    const id = styles.length + 1,
      font = fonts.length;
    fonts.push(
      `<font>${t.bold ? '<b/>' : ''}<sz val="${t.font}"/><color rgb="FF${(t.color || '#111111').slice(1).toUpperCase()}"/><name val="${t.bold ? 'Arial' : 'Microsoft YaHei'}"/></font>`,
    );
    styles.push(
      `<xf numFmtId="49" fontId="${font}" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center" horizontal="${t.center ? 'center' : t.align === 'right' ? 'right' : 'left'}" wrapText="0"/></xf>`,
    );
    styleMap.set(key, id);
    return id;
  };
  for (let page = 0; page < plan.pages; page++) {
    const ps = plan.positions.filter((p) => p.page === page),
      mx = plan.margins.left,
      my = plan.margins.top;
    const xPoints = new Set([0]),
      yPoints = new Set([0]);
    const px = (v) => Math.round((v * 96) / 25.4),
      yr = (v) => Math.round(v * 1000) / 1000;
    for (const p of ps) {
      xPoints.add(px(p.x + p.width - mx));
      yPoints.add(yr(p.y + p.height - my));
      for (const t of plan.config.composition === 'custom' ? [] : p.text) {
        xPoints.add(px(t.x - mx));
        xPoints.add(px(t.x + t.width - mx));
        yPoints.add(yr(t.y - my));
        yPoints.add(yr(t.y + t.height - my));
      }
    }
    const xs = [...xPoints].sort((a, b) => a - b),
      ys = [...yPoints].sort((a, b) => a - b),
      cellMap = new Map(),
      merges = [];
    for (const p of ps)
      for (const t of plan.config.composition === 'custom' ? [] : p.text) {
        const x1 = xs.indexOf(px(t.x - mx)),
          x2 = xs.indexOf(px(t.x + t.width - mx)) - 1,
          y1 = ys.indexOf(yr(t.y - my)),
          y2 = ys.indexOf(yr(t.y + t.height - my)) - 1;
        if (x1 < 0 || x2 < x1 || y1 < 0 || y2 < y1) throw Error('文字区域过小，无法导出Excel。');
        const a = letters(x1) + (y1 + 1),
          b = letters(x2) + (y2 + 1);
        if (a !== b) merges.push(`<mergeCell ref="${a}:${b}"/>`);
        if (!cellMap.has(y1)) cellMap.set(y1, []);
        cellMap
          .get(y1)
          .push(
            `<c r="${a}" s="${style(t)}" t="inlineStr"><is><t xml:space="preserve">${esc(t.value)}</t></is></c>`,
          );
      }
    const cols = xs
      .slice(0, -1)
      .map(
        (v, i) =>
          `<col min="${i + 1}" max="${i + 1}" width="${(xs[i + 1] - v) / 8}" customWidth="1"/>`,
      )
      .join('');
    const rows = ys
      .slice(0, -1)
      .map(
        (v, i) =>
          `<row r="${i + 1}" ht="${((ys[i + 1] - v) * 72) / 25.4}" customHeight="1">${(cellMap.get(i) || []).join('')}</row>`,
      )
      .join('');
    const pageId = page + 1;
    const sheet = `<worksheet xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${cols}</cols><sheetData>${rows}</sheetData><mergeCells count="${merges.length}">${merges.join('')}</mergeCells><printOptions horizontalCentered="0"/><pageMargins left="${plan.margins.left / 25.4}" right="${plan.margins.right / 25.4}" top="${plan.margins.top / 25.4}" bottom="${plan.margins.bottom / 25.4}" header="0" footer="0"/><pageSetup paperWidth="${plan.paper.width}mm" paperHeight="${plan.paper.height}mm" orientation="${plan.paper.width > plan.paper.height ? 'landscape' : 'portrait'}" scale="100"/><drawing r:id="drawing"/></worksheet>`;
    entries.push(
      [`xl/worksheets/sheet${pageId}.xml`, sheet],
      [
        `xl/worksheets/_rels/sheet${pageId}.xml.rels`,
        `<Relationships xmlns="${relNs}"><Relationship Id="drawing" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${pageId}.xml"/></Relationships>`,
      ],
    );
    const shapes = [],
      imageRels = [];
    const emu = (v) => Math.round(v * 36000);
    const anchor = (x, y, w, h, inside) =>
      `<xdr:absoluteAnchor><xdr:pos x="${emu(x - mx)}" y="${emu(y - my)}"/><xdr:ext cx="${emu(w)}" cy="${emu(h)}"/>${inside}<xdr:clientData/></xdr:absoluteAnchor>`;
    for (const p of ps) {
      const id = p.index + 1,
        rid = 'image' + id;
      entries.push([`xl/media/label${id}.png`, png(render.matrix(p.record.code))]);
      imageRels.push(
        `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/label${id}.png"/>`,
      );
      const picture = `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${id * 2}" name="${esc(p.record.code)}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic>`;
      shapes.push(anchor(p.qr.x, p.qr.y, p.qr.size, p.qr.size, picture));
      const c = plan.config,
        b = render.borderBox(c, p),
        dash =
          c.borderStyle === 'solid'
            ? ''
            : `<a:custDash><a:ds d="${c.borderStyle === 'dotted' ? 100000 : 300000}" sp="200000"/></a:custDash>`;
      const border = `<xdr:sp><xdr:nvSpPr><xdr:cNvPr id="${id * 2 + 1}" name="标签边界${id}"/><xdr:cNvSpPr/></xdr:nvSpPr><xdr:spPr><a:prstGeom prst="${b.radius ? 'roundRect' : 'rect'}"><a:avLst>${b.radius ? `<a:gd name="adj" fmla="val ${Math.round((100000 * b.radius) / Math.min(b.width, b.height))}"/>` : ''}</a:avLst></a:prstGeom><a:noFill/><a:ln w="${emu(c.borderWidth)}" cap="${c.borderStyle === 'dotted' ? 'rnd' : 'flat'}"><a:solidFill><a:srgbClr val="${c.borderColor.slice(1).toUpperCase()}"/></a:solidFill>${dash}</a:ln></xdr:spPr></xdr:sp>`;
      if (c.border) shapes.push(anchor(b.x, b.y, b.width, b.height, border));
      for (const [i, l] of (p.lines || []).entries()) {
        const shape = `<xdr:sp><xdr:nvSpPr><xdr:cNvPr id="${100000 + p.index * 40 + i}" name="自定义横线${i + 1}"/><xdr:cNvSpPr/></xdr:nvSpPr><xdr:spPr><a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:noFill/><a:ln w="${emu(l.strokeWidth)}"><a:solidFill><a:srgbClr val="${l.color.slice(1).toUpperCase()}"/></a:solidFill></a:ln></xdr:spPr></xdr:sp>`;
        shapes.push(anchor(l.x, l.y, l.width, 0, shape));
      }
      if (c.composition === 'custom')
        for (const [i, t] of p.text.entries()) {
          const shape = `<xdr:sp><xdr:nvSpPr><xdr:cNvPr id="${1000000 + p.index * 100 + i}" name="文字${i + 1}"/><xdr:cNvSpPr txBox="1"/></xdr:nvSpPr><xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></xdr:spPr><xdr:txBody><a:bodyPr lIns="0" rIns="0" tIns="0" bIns="0" anchor="ctr" wrap="none"><a:noAutofit/></a:bodyPr><a:lstStyle/><a:p><a:pPr algn="${t.center ? 'ctr' : t.align === 'right' ? 'r' : 'l'}"/><a:r><a:rPr lang="zh-CN" sz="${Math.round(t.font * 100)}" b="${t.bold ? 1 : 0}"><a:solidFill><a:srgbClr val="${(t.color || '#111111').slice(1).toUpperCase()}"/></a:solidFill><a:latin typeface="${{ sans: 'Arial', serif: 'Times New Roman', mono: 'Consolas' }[t.fontFamily] || 'Arial'}"/><a:ea typeface="${t.fontFamily === 'serif' ? 'SimSun' : 'Microsoft YaHei'}"/></a:rPr><a:t xml:space="preserve">${esc(t.value)}</a:t></a:r><a:endParaRPr/></a:p></xdr:txBody></xdr:sp>`;
          shapes.push(anchor(t.x, t.y, t.width, t.height, shape));
        }
    }
    entries.push(
      [
        `xl/drawings/drawing${pageId}.xml`,
        `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${shapes.join('')}</xdr:wsDr>`,
      ],
      [
        `xl/drawings/_rels/drawing${pageId}.xml.rels`,
        `<Relationships xmlns="${relNs}">${imageRels.join('')}</Relationships>`,
      ],
    );
    sheetNames.push(`<sheet name="标签${pageId}" sheetId="${pageId}" r:id="sheet${pageId}"/>`);
    relations.push(
      `<Relationship Id="sheet${pageId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${pageId}.xml"/>`,
    );
    overrides.push(
      `<Override PartName="/xl/worksheets/sheet${pageId}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/drawings/drawing${pageId}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`,
    );
  }
  const area = Array.from({ length: plan.pages }, (_, page) => {
    const ps = plan.positions.filter((p) => p.page === page);
    const maxX =
      Math.max(...ps.flatMap((p) => [p.x + p.width, ...p.text.map((t) => t.x + t.width)])) -
      plan.config.margin;
    const xs = new Set([0]);
    for (const p of ps) {
      xs.add(Math.round(((p.x + p.width - plan.margins.left) * 96) / 25.4));
      for (const t of plan.config.composition === 'custom' ? [] : p.text) {
        xs.add(Math.round(((t.x - plan.margins.left) * 96) / 25.4));
        xs.add(Math.round(((t.x + t.width - plan.margins.left) * 96) / 25.4));
      }
    }
    const ys = new Set([0]);
    for (const p of ps) {
      ys.add(Math.round((p.y + p.height - plan.margins.top) * 1000));
      for (const t of plan.config.composition === 'custom' ? [] : p.text) {
        ys.add(Math.round((t.y - plan.margins.top) * 1000));
        ys.add(Math.round((t.y + t.height - plan.margins.top) * 1000));
      }
    }
    void maxX;
    return `<definedName name="_xlnm.Print_Area" localSheetId="${page}">'标签${page + 1}'!$A$1:$${letters(xs.size - 2)}$${ys.size - 1}</definedName>`;
  }).join('');
  const listId = plan.pages + 1;
  const listRows = [
    ['完整编号', '名称', '制作人'],
    ...plan.positions.map((p) => [p.record.code, p.record.name, p.record.creator]),
  ]
    .map(
      (row, i) =>
        `<row r="${i + 1}">${row.map((v, j) => `<c r="${letters(j)}${i + 1}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`).join('')}</row>`,
    )
    .join('');
  entries.push([
    `xl/worksheets/sheet${listId}.xml`,
    `<worksheet xmlns="${ns}"><sheetViews><sheetView workbookViewId="0"/></sheetViews><cols><col min="1" max="1" width="32" customWidth="1"/><col min="2" max="3" width="22" customWidth="1"/></cols><sheetData>${listRows}</sheetData></worksheet>`,
  ]);
  sheetNames.push(`<sheet name="编号清单" sheetId="${listId}" r:id="sheet${listId}"/>`);
  relations.push(
    `<Relationship Id="sheet${listId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${listId}.xml"/>`,
  );
  overrides.push(
    `<Override PartName="/xl/worksheets/sheet${listId}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  );
  entries.push(
    [
      'xl/workbook.xml',
      `<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${sheetNames.join('')}</sheets><definedNames>${area}</definedNames></workbook>`,
    ],
    [
      'xl/_rels/workbook.xml.rels',
      `<Relationships xmlns="${relNs}">${relations.join('')}<Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ],
    [
      'xl/styles.xml',
      `<styleSheet xmlns="${ns}"><fonts count="${fonts.length}">${fonts.join('')}</fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${styles.length + 1}"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>${styles.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0"/></cellStyles></styleSheet>`,
    ],
    [
      '_rels/.rels',
      `<Relationships xmlns="${relNs}"><Relationship Id="workbook" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ],
    [
      '[Content_Types].xml',
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${overrides.join('')}</Types>`,
    ],
  );
  return zip(entries);
}
module.exports = { labelsFromWorkbook, exportWorkbook };
