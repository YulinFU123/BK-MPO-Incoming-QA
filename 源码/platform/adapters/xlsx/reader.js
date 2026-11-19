'use strict';

const path = require('node:path').posix;
const { DOMParser } = require('../../vendor/xmldom');
const { PlatformError } = require('../../domain/errors');
const { strictISODate } = require('../../domain/validation');
const { openZip } = require('./zip');

const fail = (code, message, details = {}) => { throw new PlatformError(code, message, details); };
const elements = (parent, name) => Array.from(parent.getElementsByTagNameNS('*', name));
const children = (parent, name) => Array.from(parent.childNodes || []).filter(node => node.nodeType === 1 && (!name || node.localName === name));
const textOf = (parent, name) => children(parent, name)[0]?.textContent ?? '';
const integer = (value, minimum, maximum) => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) >= minimum && Number(value) <= maximum;
const unsafeHeaders = new Set(['__proto__', 'constructor', 'prototype']);

function parseXml(bytes, rootName) {
  if (!bytes) fail('XLSX_MISSING_PART', '工作簿缺少必要的内部文件。');
  let xml;
  try {
    let encoding = 'utf-8';
    if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0x3c && bytes[1] === 0)) encoding = 'utf-16le';
    else if ((bytes[0] === 0xfe && bytes[1] === 0xff) || (bytes[0] === 0 && bytes[1] === 0x3c)) encoding = 'utf-16be';
    xml = new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch { fail('XLSX_INVALID_XML', '工作簿内部文本编码损坏。'); }
  if (/<!\s*(DOCTYPE|ENTITY)\b/i.test(xml)) fail('XLSX_UNSAFE_XML', '工作簿 XML 不能包含文档类型或实体声明。');
  // This bound is checked before DOM allocation, then verified by node traversal.
  if ((xml.match(/</g) || []).length > 500000) fail('XLSX_XML_LIMIT', '工作簿 XML 节点数量超过限制。');
  let document;
  try {
    document = new DOMParser({
      onError: () => { throw new Error('invalid XML'); }
    }).parseFromString(xml, 'application/xml');
  } catch { fail('XLSX_INVALID_XML', '工作簿内部 XML 结构无效。'); }
  if (!document.documentElement || document.documentElement.localName !== rootName || elements(document, 'parsererror').length) fail('XLSX_INVALID_XML', '工作簿内部 XML 类型不正确。');
  let count = 0;
  const stack = [[document.documentElement, 1]];
  while (stack.length) {
    const [node, depth] = stack.pop();
    if (++count > 500000 || depth > 128) fail('XLSX_XML_LIMIT', '工作簿 XML 复杂度超过限制。');
    for (let child = node.firstChild; child; child = child.nextSibling) stack.push([child, depth + 1]);
  }
  return document;
}

function resolvePart(base, target) {
  if (typeof target !== 'string' || !target || target.includes('\\') || /[\u0000-\u0020?#%:]/.test(target)) fail('XLSX_UNSAFE_RELATIONSHIP', '工作簿内部引用路径无效。');
  const resolved = path.normalize(target.startsWith('/') ? target.slice(1) : path.join(path.dirname(base), target));
  if (resolved === '..' || resolved.startsWith('../') || resolved.startsWith('/')) fail('XLSX_UNSAFE_RELATIONSHIP', '工作簿引用超出内部文档范围。');
  return resolved;
}

function relationships(bytes, base) {
  const doc = parseXml(bytes, 'Relationships');
  const map = new Map();
  for (const relation of children(doc.documentElement, 'Relationship')) {
    const id = relation.getAttribute('Id');
    const type = relation.getAttribute('Type');
    if (!id || map.has(id)) fail('XLSX_INVALID_RELATIONSHIP', '工作簿引用编号重复或缺失。');
    if (relation.getAttribute('TargetMode') === 'External') fail('XLSX_EXTERNAL_RELATIONSHIP', '此开发版不接受包含外部文档引用的工作簿。');
    map.set(id, { type, target: resolvePart(base, relation.getAttribute('Target')) });
  }
  return map;
}

function columnNumber(letters) {
  let number = 0;
  for (const letter of letters) number = number * 26 + letter.charCodeAt(0) - 64;
  return number;
}
function columnLetters(number) {
  let result = '';
  for (; number > 0; number = Math.floor((number - 1) / 26)) result = String.fromCharCode(65 + (number - 1) % 26) + result;
  return result;
}
function cellReference(reference) {
  const match = /^([A-Z]{1,3})([1-9]\d{0,6})$/.exec(reference);
  if (!match || Number(match[2]) > 1048576 || columnNumber(match[1]) > 256) fail('XLSX_COLUMN_LIMIT', '单元格位置无效，最多支持 256 列。');
  return { column: columnNumber(match[1]), row: Number(match[2]) };
}

function decimalText(raw) {
  const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:[Ee]([+-]?\d+))?$/.exec(raw);
  if (!match) fail('XLSX_INVALID_NUMBER', 'Excel 数值格式无效。');
  const exponent = Number(match[4] || 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 1024 || raw.length > 2048) fail('XLSX_INVALID_NUMBER', 'Excel 数值长度超过限制。');
  if (!match[4]) return raw.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '').replace(/^\+/, '');
  const digits = match[2] + (match[3] || '');
  const point = match[2].length + exponent;
  const expanded = point <= 0 ? `0.${'0'.repeat(-point)}${digits}` : point >= digits.length ? digits + '0'.repeat(point - digits.length) : `${digits.slice(0, point)}.${digits.slice(point)}`;
  return (match[1] === '+' ? '' : match[1]) + expanded.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

function serialDate(raw, date1904) {
  if (!/^\d+(?:\.\d+)?$/.test(raw)) fail('XLSX_INVALID_DATE', 'Excel 日期序列无效。');
  const serial = Math.floor(Number(raw));
  if (!Number.isSafeInteger(serial) || serial < (date1904 ? 0 : 1) || serial > 2958465 || (!date1904 && serial === 60)) fail('XLSX_INVALID_DATE', 'Excel 日期序列超出范围。');
  const time = Date.UTC(date1904 ? 1904 : 1899, date1904 ? 0 : 11, date1904 ? 1 : 31) + (serial - (!date1904 && serial > 60 ? 1 : 0)) * 86400000;
  return strictISODate(new Date(time).toISOString().slice(0, 10), 'businessDate');
}

function loadWorkbook(bytes) {
  const zip = openZip(bytes);
  if (zip.names.some(name => /vbaProject|externalLinks\//i.test(name))) fail('XLSX_UNSUPPORTED_CONTENT', '不支持宏或外部链接工作簿，请保存为普通 XLSX。');
  const types = parseXml(zip.read('[Content_Types].xml'), 'Types');
  if (elements(types, 'Override').some(node => /macroEnabled|vbaProject/i.test(node.getAttribute('ContentType')))) fail('XLSX_UNSUPPORTED_CONTENT', '不支持启用宏的工作簿。');
  const rootRelations = relationships(zip.read('_rels/.rels'), 'root.xml');
  const office = [...rootRelations.values()].filter(item => item.type.endsWith('/officeDocument'));
  if (office.length !== 1) fail('XLSX_MISSING_WORKBOOK', '工作簿主文档引用缺失或不唯一。');
  const workbookPart = office[0].target;
  const workbookDoc = parseXml(zip.read(workbookPart), 'workbook');
  const relPath = path.join(path.dirname(workbookPart), '_rels', path.basename(workbookPart) + '.rels');
  const relations = relationships(zip.read(relPath), workbookPart);
  const date1904 = ['1', 'true'].includes(elements(workbookDoc, 'workbookPr')[0]?.getAttribute('date1904'));
  const sheets = [];
  const names = new Set();
  for (const sheet of elements(workbookDoc, 'sheet')) {
    const id = sheet.getAttribute('r:id') || sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const relation = relations.get(id);
    const name = sheet.getAttribute('name');
    if (!name || names.has(name) || !relation || !relation.type.endsWith('/worksheet')) fail('XLSX_INVALID_SHEET', '工作表名称或引用无效；仅支持普通工作表。');
    const state = sheet.getAttribute('state') || 'visible';
    if (!['visible', 'hidden', 'veryHidden'].includes(state)) fail('XLSX_INVALID_SHEET', '工作表显示状态无效。');
    names.add(name); sheets.push({ name, state, part: relation.target });
  }
  if (!sheets.length || sheets.length > 256) fail('XLSX_SHEET_LIMIT', '工作表数量不在支持范围内。');
  let strings = [];
  const shared = [...relations.values()].find(item => item.type.endsWith('/sharedStrings'));
  if (shared) {
    const doc = parseXml(zip.read(shared.target), 'sst');
    strings = children(doc.documentElement, 'si').map(node => elements(node, 't').map(item => item.textContent).join(''));
    if (strings.length > 200000) fail('XLSX_STRING_LIMIT', '共享文本数量超过限制。');
  }
  const styles = [];
  const formats = new Map();
  const style = [...relations.values()].find(item => item.type.endsWith('/styles'));
  if (style) {
    const doc = parseXml(zip.read(style.target), 'styleSheet');
    for (const item of elements(doc, 'numFmt')) {
      const id = item.getAttribute('numFmtId');
      if (!integer(id, 0, 65535) || formats.has(Number(id))) fail('XLSX_INVALID_STYLE', '工作簿数字格式定义无效。');
      formats.set(Number(id), item.getAttribute('formatCode'));
    }
    for (const item of children(elements(doc, 'cellXfs')[0] || {}, 'xf')) {
      const id = item.getAttribute('numFmtId') || '0';
      if (!integer(id, 0, 65535)) fail('XLSX_INVALID_STYLE', '单元格样式编号无效。');
      styles.push(Number(id));
    }
  }

  function sheetRows(sheet, warningSink) {
    const document = parseXml(zip.read(sheet.part), 'worksheet');
    if (elements(document, 'hyperlink').some(node => node.getAttribute('r:id'))) fail('XLSX_EXTERNAL_RELATIONSHIP', '此开发版不接受外部链接单元格。');
    const rows = new Map();
    const rowElements = children(elements(document, 'sheetData')[0] || {}, 'row');
    if (rowElements.length > 11000) fail('XLSX_ROW_LIMIT', '工作表物理行数量超过开发版限制。');
    for (const row of rowElements) {
      const rowText = row.getAttribute('r');
      if (!integer(rowText, 1, 1048576) || rows.has(Number(rowText))) fail('XLSX_INVALID_ROW', '工作表行号缺失或重复。');
      const rowNumber = Number(rowText);
      const cells = new Map();
      for (const cell of children(row, 'c')) {
        const reference = cell.getAttribute('r');
        const location = cellReference(reference);
        if (location.row !== rowNumber || cells.has(location.column)) fail('XLSX_INVALID_CELL', '单元格坐标重复或与行号不一致。', { rowNumber, column: columnLetters(location.column) });
        const type = cell.getAttribute('t') || 'n';
        const valueNodes = children(cell, 'v');
        const formula = children(cell, 'f').length > 0;
        const raw = valueNodes[0]?.textContent ?? '';
        if (valueNodes.length > 1) fail('XLSX_INVALID_CELL', '单元格含重复值。', { rowNumber, column: columnLetters(location.column) });
        if (formula && !valueNodes.length) fail('XLSX_FORMULA_CACHE_MISSING', '公式缺少缓存结果，请在 Excel 中重新计算并保存。', { rowNumber, column: columnLetters(location.column) });
        if (type === 'e') fail('XLSX_CELL_ERROR', '工作表含 Excel 错误单元格，请修正后重试。', { rowNumber, column: columnLetters(location.column) });
        let value = raw;
        let numeric = false;
        if (type === 's') {
          if (!integer(raw, 0, strings.length - 1)) fail('XLSX_INVALID_STRING', '共享文本索引无效。', { rowNumber, column: columnLetters(location.column) });
          value = strings[Number(raw)];
        } else if (type === 'inlineStr') value = elements(cell, 't').map(node => node.textContent).join('');
        else if (type === 'b') {
          if (!['0', '1', ''].includes(raw)) fail('XLSX_INVALID_CELL', '布尔单元格值无效。', { rowNumber, column: columnLetters(location.column) });
          value = raw === '1' ? 'TRUE' : raw === '0' ? 'FALSE' : '';
        } else if (type === 'd') {
          const match = /^(\d{4}-\d{2}-\d{2})(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?)?$/.exec(raw);
          if (!match) fail('XLSX_INVALID_DATE', '日期单元格值无效。', { rowNumber, column: columnLetters(location.column) });
          value = strictISODate(match[1]);
        } else if (type === 'n') {
          if (raw) {
            numeric = true;
            value = decimalText(raw);
            const styleText = cell.getAttribute('s') || '0';
            if (!integer(styleText, 0, Math.max(0, styles.length - 1))) fail('XLSX_INVALID_STYLE', '单元格样式索引超出范围。', { rowNumber, column: columnLetters(location.column) });
            const formatId = styles[Number(styleText)] || 0;
            const format = formats.get(formatId) || '';
            const cleaned = format.replace(/"[^"]*"|\\.|\[[^\]]*\]/g, '');
            const isDate = (formatId >= 14 && formatId <= 17) || formatId === 22 || (formatId >= 27 && formatId <= 36) || (formatId >= 50 && formatId <= 58) || /[yd]/i.test(cleaned);
            if (isDate) value = serialDate(value, date1904);
            else {
              if (/^0{1,128}$/.test(format) && /^\d+$/.test(value)) value = value.padStart(format.length, '0');
              if (value.replace(/^[+-]?0*/, '').replace(/[^0-9]/g, '').length > 15) warningSink({ code: 'LONG_NUMERIC_REVIEW', message: '数值超过 Excel 常见精度范围；如用作编号，请核对原始来源并改为文本。', rowNumber, column: columnLetters(location.column), requiresAcknowledgement: true });
            }
          }
        } else if (type !== 'str') fail('XLSX_UNSUPPORTED_CELL_TYPE', '工作簿包含不支持的单元格类型。', { rowNumber, column: columnLetters(location.column) });
        if (value.length > 32767) fail('XLSX_CELL_TEXT_LIMIT', '单元格文本超过限制。', { rowNumber, column: columnLetters(location.column) });
        if (formula) warningSink({ code: 'CACHED_FORMULA_RESULT', message: '已读取公式缓存，未执行公式；请确认源文件已重新计算并保存。', rowNumber, column: columnLetters(location.column), requiresAcknowledgement: true });
        cells.set(location.column, { value, numeric, type, formula });
      }
      rows.set(rowNumber, cells);
    }
    const merges = elements(document, 'mergeCell').map(node => {
      const parts = node.getAttribute('ref').split(':');
      if (parts.length !== 2) fail('XLSX_INVALID_MERGE', '合并单元格范围无效。');
      return { first: cellReference(parts[0]), last: cellReference(parts[1]) };
    });
    return { rows, merges };
  }
  return { sheets, date1904, sheetRows };
}

function createXlsxReader() {
  return Object.freeze({
    async inspect({ bytes }) {
      const workbook = loadWorkbook(bytes);
      const sheets = workbook.sheets.map(sheet => {
        let content;
        try { content = workbook.sheetRows(sheet, () => {}); }
        catch (error) {
          if (!(error instanceof PlatformError)) throw error;
          return { name: sheet.name, state: sheet.state, candidateHeaderRows: [], sample: [], previewError: { code: error.code, message: error.message } };
        }
        const sample = [...content.rows].sort((a, b) => a[0] - b[0]).filter(([, cells]) => [...cells.values()].some(cell => cell.value.trim())).slice(0, 8)
          .map(([rowNumber, cells]) => ({ rowNumber, cells: [...cells].sort((a, b) => a[0] - b[0]).slice(0, 32).map(([column, cell]) => ({ column: columnLetters(column), value: cell.value, numeric: cell.numeric })) }));
        const candidateHeaderRows = sample.filter(row => row.cells.length >= 2 && new Set(row.cells.map(cell => cell.value.trim())).size === row.cells.length && !content.merges.some(merge => row.rowNumber >= merge.first.row && row.rowNumber <= merge.last.row)).map(row => row.rowNumber);
        return { name: sheet.name, state: sheet.state, candidateHeaderRows, sample };
      });
      return { format: 'xlsx', date1904: workbook.date1904, sheets };
    },
    async read({ bytes, sheetName, headerRow = 1 }) {
      const workbook = loadWorkbook(bytes);
      if (!Number.isSafeInteger(headerRow) || headerRow < 1 || headerRow > 1048575) fail('INVALID_HEADER_ROW', '请选择有效的 Excel 表头行。');
      if (sheetName === undefined) {
        if (workbook.sheets.length !== 1 || workbook.sheets[0].state !== 'visible') fail('SHEET_SELECTION_REQUIRED', '请明确选择需要导入的工作表。');
        sheetName = workbook.sheets[0].name;
      }
      if (typeof sheetName !== 'string') fail('INVALID_SHEET', '工作表名称必须为文本。');
      const sheet = workbook.sheets.find(item => item.name === sheetName);
      if (!sheet) fail('SHEET_NOT_FOUND', '找不到指定工作表。');
      const warnings = [];
      let warningCount = 0;
      const content = workbook.sheetRows(sheet, warning => { warningCount++; if (warnings.length < 100) warnings.push(warning); });
      if (content.merges.some(merge => headerRow >= merge.first.row && headerRow <= merge.last.row)) fail('MERGED_HEADER_UNSUPPORTED', '所选表头行包含合并单元格，请选单层完整表头或先在 Excel 中整理。');
      const headerCells = content.rows.get(headerRow);
      if (!headerCells || ![...headerCells.values()].some(cell => cell.value.trim())) fail('HEADER_ROW_EMPTY', '所选表头行为空。');
      const dataRows = [...content.rows].filter(([rowNumber, cells]) => rowNumber > headerRow && [...cells.values()].some(cell => cell.value.trim())).sort((a, b) => a[0] - b[0]);
      if (dataRows.length > 10000) fail('XLSX_ROW_LIMIT', '每次最多导入 10000 条数据，请拆分。');
      const usedColumns = new Set([...headerCells].filter(([, cell]) => cell.value.trim()).map(([column]) => column).concat(dataRows.flatMap(([, cells]) => [...cells].filter(([, cell]) => cell.value !== '').map(([column]) => column))));
      const headers = [];
      const names = new Set();
      for (const column of [...usedColumns].sort((a, b) => a - b)) {
        const name = headerCells.get(column)?.value.trim() || '';
        if (!name) fail('BLANK_HEADER', '有数据的列缺少表头，请补齐表头。', { rowNumber: headerRow, column: columnLetters(column) });
        if (name.length > 256 || unsafeHeaders.has(name)) fail('UNSAFE_HEADER', '表头名称过长或不受支持。', { rowNumber: headerRow, column: columnLetters(column) });
        if (names.has(name)) fail('DUPLICATE_HEADER', '表头名称重复，请先区分各列。', { rowNumber: headerRow, column: columnLetters(column) });
        names.add(name); headers.push([column, name]);
      }
      if (!dataRows.length) fail('EMPTY_ROWS', '工作表在所选表头后没有数据。');
      return {
        rows: dataRows.map(([, cells]) => Object.fromEntries(headers.map(([column, name]) => [name, cells.get(column)?.value ?? '']))),
        rowNumbers: dataRows.map(([rowNumber]) => rowNumber), sheetName, headerRow,
        warnings, warningCount, warningsTruncated: warningCount > warnings.length
      };
    }
  });
}

module.exports = { createXlsxReader };
