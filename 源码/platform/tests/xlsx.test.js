'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { deflateRawSync } = require('node:zlib');
const { createXlsxReader } = require('../adapters/xlsx/reader');
const { openZip, crc32, LIMITS } = require('../adapters/xlsx/zip');

// Synthetic OOXML fixtures are built in memory. Independently generated actual
// openpyxl workbooks are exercised by the separate file-flow integration tests.
function zip(entries, method = 8) {
  const locals = [], directories = [];
  let offset = 0;
  for (const [name, value] of entries) {
    const text = Buffer.from(name);
    const raw = Buffer.isBuffer(value) ? value : Buffer.from(value);
    const packed = method === 8 ? deflateRawSync(raw) : raw;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(method, 8); local.writeUInt32LE(crc32(raw), 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(text.length, 26);
    locals.push(local, text, packed);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(0x800, 8); directory.writeUInt16LE(method, 10);
    directory.writeUInt32LE(crc32(raw), 16); directory.writeUInt32LE(packed.length, 20); directory.writeUInt32LE(raw.length, 24); directory.writeUInt16LE(text.length, 28); directory.writeUInt32LE(offset, 42);
    directories.push(directory, text); offset += local.length + text.length + packed.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  const directorySize = directories.reduce((size, item) => size + item.length, 0);
  end.writeUInt32LE(directorySize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...directories, end]);
}
const esc = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const cell = (reference, value, type = 'inlineStr', extra = '') => type === 'inlineStr'
  ? `<c r="${reference}" t="inlineStr" ${extra}><is><t>${esc(value)}</t></is></c>`
  : `<c r="${reference}" t="${type}" ${extra}><v>${esc(value)}</v></c>`;
const row = (number, cells) => `<row r="${number}">${cells.join('')}</row>`;
const sheet = (rows, extra = '') => `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetData>${rows.join('')}</sheetData>${extra}</worksheet>`;
const defaultSheet = () => sheet([
  row(1, [cell('A1', 'SN'), cell('B1', '丝印'), cell('C1', '检验数')]),
  row(2, [cell('A2', '0001Ab'), cell('B2', 'AB12'), cell('C2', '100', 'n')])
]);
function workbook({ sheets = [['中文数据', defaultSheet()]], strings, styles, date1904 = false, rootExtra = '', relationsExtra = '', contentTypes, method = 8 } = {}) {
  const relations = sheets.map((item, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`);
  if (strings !== undefined) relations.push('<Relationship Id="strings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>');
  if (styles !== undefined) relations.push('<Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>');
  const entries = [
    ['[Content_Types].xml', contentTypes || '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'],
    ['_rels/.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="office" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>${rootExtra}</Relationships>`],
    ['xl/workbook.xml', `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr date1904="${date1904 ? '1' : '0'}"/><sheets>${sheets.map((item, index) => `<sheet name="${esc(item[0])}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relations.join('')}${relationsExtra}</Relationships>`],
    ...sheets.map((item, index) => [`xl/worksheets/sheet${index + 1}.xml`, item[1]])
  ];
  if (strings !== undefined) entries.push(['xl/sharedStrings.xml', strings]);
  if (styles !== undefined) entries.push(['xl/styles.xml', styles]);
  return zip(entries, method);
}
const rejectCode = expected => error => error.code === expected;
const reader = createXlsxReader();
const dateStyle = '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="0000"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/></cellXfs></styleSheet>';

test('XLSX reads real ZIP/XML rows preserving Chinese, case and string identifiers', async () => {
  const bytes = workbook();
  const result = await reader.read({ bytes });
  assert.deepEqual(result.rows, [{ SN: '0001Ab', '丝印': 'AB12', '检验数': '100' }]);
  assert.deepEqual(result.rowNumbers, [2]);
  assert.equal(result.sheetName, '中文数据');
  assert.equal(result.warningCount, 0);
  assert.equal(Buffer.compare(bytes, workbook()), 0);
});

test('XLSX lists sheets and header candidates; multi-sheet reads require selection', async () => {
  const bytes = workbook({ sheets: [['表一', defaultSheet()], ['表二', defaultSheet()]] });
  const inspection = await reader.inspect({ bytes });
  assert.deepEqual(inspection.sheets.map(item => item.name), ['表一', '表二']);
  assert.ok(inspection.sheets[0].candidateHeaderRows.includes(1));
  assert.equal(inspection.sheets[0].sample[1].cells[0].value, '0001Ab');
  await assert.rejects(reader.read({ bytes }), rejectCode('SHEET_SELECTION_REQUIRED'));
  assert.equal((await reader.read({ bytes, sheetName: '表二' })).rows.length, 1);
  await assert.rejects(reader.read({ bytes, sheetName: '不存在' }), rejectCode('SHEET_NOT_FOUND'));
});

test('XLSX selected header row and compacted data retain physical Excel row numbers', async () => {
  const bytes = workbook({ sheets: [['数据', sheet([
    row(1, [cell('A1', '仅供测试的标题')]), row(2, [cell('A2', 'SN'), cell('B2', '丝印')]),
    row(3, [cell('A3', '0001'), cell('B3', '0012')]), row(4, [cell('A4', '')]),
    row(6, [cell('A6', 'Ab12'), cell('B6', 'S')])
  ], '<mergeCells><mergeCell ref="A1:B1"/></mergeCells>')]] });
  const result = await reader.read({ bytes, headerRow: 2 });
  assert.deepEqual(result.rowNumbers, [3, 6]);
  assert.equal(result.rows[1].SN, 'Ab12');
});

test('XLSX supports shared rich text and XML entity text without executing content', async () => {
  const strings = '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>SN</t></si><si><r><t>00</t></r><r><t>Ab&amp;&lt;</t></r></si></sst>';
  const bytes = workbook({ strings, sheets: [['数据', sheet([row(1, [cell('A1', '0', 's')]), row(2, [cell('A2', '1', 's')])])]] });
  assert.deepEqual((await reader.read({ bytes })).rows, [{ SN: '00Ab&<' }]);
  const bad = workbook({ strings, sheets: [['数据', sheet([row(1, [cell('A1', 'SN')]), row(2, [cell('A2', '999', 's')])])]] });
  await assert.rejects(reader.read({ bytes: bad }), rejectCode('XLSX_INVALID_STRING'));
});

test('XLSX normalizes Excel date systems and zero-mask identifiers without Number conversion', async () => {
  const bytes = workbook({ styles: dateStyle, sheets: [['数据', sheet([
    row(1, [cell('A1', '日期'), cell('B1', '丝印')]), row(2, [cell('A2', '61', 'n', 's="1"'), cell('B2', '12', 'n', 's="2"')])
  ])]] });
  assert.deepEqual((await reader.read({ bytes })).rows, [{ '日期': '1900-03-01', '丝印': '0012' }]);
  const alternate = workbook({ date1904: true, styles: dateStyle, sheets: [['数据', sheet([row(1, [cell('A1', '日期')]), row(2, [cell('A2', '0', 'n', 's="1"')])])]] });
  assert.equal((await reader.read({ bytes: alternate })).rows[0]['日期'], '1904-01-01');
  const fakeLeap = workbook({ styles: dateStyle, sheets: [['数据', sheet([row(1, [cell('A1', '日期')]), row(2, [cell('A2', '60', 'n', 's="1"')])])]] });
  await assert.rejects(reader.read({ bytes: fakeLeap }), rejectCode('XLSX_INVALID_DATE'));
});

test('XLSX uses exact lexical decimal expansion and warns about long numeric values', async () => {
  const bytes = workbook({ sheets: [['数据', sheet([
    row(1, [cell('A1', '大编号'), cell('B1', '数量')]), row(2, [cell('A2', '123456789012345678', 'n'), cell('B2', '1.25E3', 'n')])
  ])]] });
  const result = await reader.read({ bytes });
  assert.equal(result.rows[0]['大编号'], '123456789012345678');
  assert.equal(result.rows[0]['数量'], '1250');
  assert.equal(result.warnings[0].code, 'LONG_NUMERIC_REVIEW');
  assert.equal(result.warnings[0].requiresAcknowledgement, true);
});

test('XLSX formula cache is read without evaluation; missing cache and cell errors fail', async () => {
  const cached = workbook({ sheets: [['数据', sheet([row(1, [cell('A1', '数量')]), row(2, ['<c r="A2"><f>1+1</f><v>2</v></c>'])])]] });
  const result = await reader.read({ bytes: cached });
  assert.equal(result.rows[0]['数量'], '2');
  assert.equal(result.warnings[0].code, 'CACHED_FORMULA_RESULT');
  const missing = workbook({ sheets: [['数据', sheet([row(1, [cell('A1', '数量')]), row(2, ['<c r="A2"><f>HYPERLINK("secret")</f></c>'])])]] });
  await assert.rejects(reader.read({ bytes: missing }), error => error.code === 'XLSX_FORMULA_CACHE_MISSING' && !error.message.includes('secret'));
  const errorCell = workbook({ sheets: [['数据', sheet([row(1, [cell('A1', '数量')]), row(2, [cell('A2', '#REF!', 'e')])])]] });
  await assert.rejects(reader.read({ bytes: errorCell }), rejectCode('XLSX_CELL_ERROR'));
});

test('XLSX keeps sheet selection possible when another sheet has invalid formula cache', async () => {
  const missing = sheet([row(1, [cell('A1', '数量')]), row(2, ['<c r="A2"><f>1+1</f></c>'])]);
  const bytes = workbook({ sheets: [['正常数据', defaultSheet()], ['待重新计算', missing]] });
  const inspection = await reader.inspect({ bytes });
  assert.equal(inspection.sheets[1].previewError.code, 'XLSX_FORMULA_CACHE_MISSING');
  assert.equal((await reader.read({ bytes, sheetName: '正常数据' })).rows.length, 1);
});

test('XLSX numeric quantities with an exact zero fractional part remain valid integer text', async () => {
  const bytes = workbook({ sheets: [['数据', sheet([row(1, [cell('A1', '数量')]), row(2, [cell('A2', '100.000', 'n')]), row(3, [cell('A3', '+1.2000E2', 'n')])])]] });
  assert.deepEqual((await reader.read({ bytes })).rows, [{ '数量': '100' }, { '数量': '120' }]);
});

test('XLSX refuses blank, duplicate, unsafe and merged headers with actionable codes', async () => {
  const cases = [
    [sheet([row(1, [cell('A1', 'SN')]), row(2, [cell('A2', '001'), cell('B2', 'AB')])]), 'BLANK_HEADER'],
    [sheet([row(1, [cell('A1', 'SN'), cell('B1', ' SN ')]), row(2, [cell('A2', '001')])]), 'DUPLICATE_HEADER'],
    [sheet([row(1, [cell('A1', '__proto__')]), row(2, [cell('A2', '001')])]), 'UNSAFE_HEADER'],
    [sheet([row(1, [cell('A1', 'SN')]), row(2, [cell('A2', '001')])], '<mergeCells><mergeCell ref="A1:B1"/></mergeCells>'), 'MERGED_HEADER_UNSUPPORTED']
  ];
  for (const [xml, code] of cases) await assert.rejects(reader.read({ bytes: workbook({ sheets: [['数据', xml]] }) }), rejectCode(code));
});

test('XLSX rejects malformed XML, DTD declarations and external workbook references', async () => {
  const malformed = workbook({ sheets: [['数据', '<worksheet><sheetData><row></worksheet>']] });
  await assert.rejects(reader.read({ bytes: malformed }), rejectCode('XLSX_INVALID_XML'));
  const dtd = workbook({ sheets: [['数据', '<!DOCTYPE worksheet [<!ENTITY leak SYSTEM "file:///secret">]><worksheet/>']] });
  await assert.rejects(reader.read({ bytes: dtd }), error => error.code === 'XLSX_UNSAFE_XML' && !error.message.includes('secret'));
  const external = workbook({ relationsExtra: '<Relationship Id="external" Type="example/externalLink" Target="https://example.invalid/" TargetMode="External"/>' });
  await assert.rejects(reader.read({ bytes: external }), rejectCode('XLSX_EXTERNAL_RELATIONSHIP'));
  const macro = workbook({ contentTypes: '<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.ms-excel.sheet.macroEnabled.main+xml"/></Types>' });
  await assert.rejects(reader.read({ bytes: macro }), rejectCode('XLSX_UNSUPPORTED_CONTENT'));
});

test('ZIP validates CRC, path uniqueness, path traversal, encrypted flags and ZIP64', async () => {
  const stored = zip([['file.xml', '<a/>']], 0);
  const corrupt = Buffer.from(stored); corrupt[30 + 'file.xml'.length] ^= 1;
  assert.throws(() => openZip(corrupt).read('file.xml'), rejectCode('XLSX_CRC_MISMATCH'));
  assert.throws(() => openZip(zip([['../outside.xml', 'x']])), rejectCode('UNSAFE_ZIP_PATH'));
  assert.throws(() => openZip(zip([['same.xml', 'x'], ['same.xml', 'y']])), rejectCode('UNSAFE_ZIP_PATH'));
  const encrypted = Buffer.from(stored); encrypted.writeUInt16LE(0x801, 6); encrypted.writeUInt16LE(0x801, stored.readUInt32LE(stored.length - 6) + 8);
  assert.throws(() => openZip(encrypted), rejectCode('ENCRYPTED_WORKBOOK'));
  const zip64 = Buffer.from(stored); zip64.writeUInt16LE(0xffff, zip64.length - 12); zip64.writeUInt16LE(0xffff, zip64.length - 14);
  assert.throws(() => openZip(zip64), rejectCode('UNSUPPORTED_ZIP64'));
  await assert.rejects(reader.read({ bytes: stored.subarray(0, 12) }), rejectCode('INVALID_ZIP'));
});

test('ZIP rejects declared and actual decompression sizes exceeding safe bounds', () => {
  const bytes = zip([['file.xml', 'a'.repeat(1000)]]);
  const directory = bytes.readUInt32LE(bytes.length - 6);
  const oversized = Buffer.from(bytes); oversized.writeUInt32LE(LIMITS.entryBytes + 1, directory + 24);
  assert.throws(() => openZip(oversized), rejectCode('XLSX_EXPANSION_LIMIT'));
  const lied = Buffer.from(bytes); lied.writeUInt32LE(1, directory + 24); lied.writeUInt32LE(1, 22);
  assert.throws(() => openZip(lied).read('file.xml'), rejectCode('XLSX_DECOMPRESSION_FAILED'));
});

test('XLSX validates duplicate cell references, row bounds, 256-column and 10000-row limits', async () => {
  const duplicate = workbook({ sheets: [['数据', sheet([row(1, [cell('A1', 'SN')]), row(2, [cell('A2', 'x'), cell('A2', 'y')])])]] });
  await assert.rejects(reader.read({ bytes: duplicate }), rejectCode('XLSX_INVALID_CELL'));
  const beyond = workbook({ sheets: [['数据', sheet([row(1, [cell('IW1', 'SN')]), row(2, [cell('A2', 'x')])])]] });
  await assert.rejects(reader.read({ bytes: beyond }), rejectCode('XLSX_COLUMN_LIMIT'));
  const many = [row(1, [cell('A1', 'SN')])];
  for (let number = 2; number <= 10002; number++) many.push(row(number, [cell('A' + number, 'X' + number)]));
  await assert.rejects(reader.read({ bytes: workbook({ sheets: [['数据', sheet(many)]] }) }), rejectCode('XLSX_ROW_LIMIT'));
});

test('XLSX handles UTF16 internal XML and ignores empty styled trailing header cells', async () => {
  const xml = sheet([row(1, [cell('A1', 'SN'), '<c r="B1" s="0"/>']), row(2, [cell('A2', '0012')])]);
  const bytes = workbook({ sheets: [['数据', Buffer.from('\ufeff' + xml, 'utf16le')]] });
  assert.deepEqual((await reader.read({ bytes })).rows, [{ SN: '0012' }]);
});
