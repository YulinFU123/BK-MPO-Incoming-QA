'use strict';

const { inflateRawSync } = require('node:zlib');
const { PlatformError } = require('../../domain/errors');

const LIMITS = Object.freeze({ fileBytes: 25 * 1024 * 1024, entryBytes: 16 * 1024 * 1024, totalBytes: 64 * 1024 * 1024, entries: 10000 });
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
const fail = (code, message) => { throw new PlatformError(code, message); };

/** A bounded ZIP reader for OOXML. Never extracts files or follows paths. */
function openZip(input) {
  if (!(input instanceof Uint8Array) || !input.byteLength || input.byteLength > LIMITS.fileBytes) fail('XLSX_FILE_LIMIT', '工作簿应为不超过 25MB 的 XLSX 文件。');
  const bytes = Buffer.from(input);
  const inBounds = (offset, length) => Number.isSafeInteger(offset) && offset >= 0 && length >= 0 && offset + length <= bytes.length;
  if (bytes.length < 22) fail('INVALID_ZIP', '工作簿压缩结构不完整。');
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (bytes.readUInt32LE(offset) === 0x06054b50 && offset + 22 + bytes.readUInt16LE(offset + 20) === bytes.length) { end = offset; break; }
  }
  if (end < 0) fail('INVALID_ZIP', '仅支持未加密的 XLSX 文件，请另存为 XLSX 后重试。');
  const count = bytes.readUInt16LE(end + 10);
  const directorySize = bytes.readUInt32LE(end + 12);
  const directoryOffset = bytes.readUInt32LE(end + 16);
  if (bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6) || bytes.readUInt16LE(end + 8) !== count) fail('UNSUPPORTED_ZIP', '不支持分卷工作簿。');
  if (count === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) fail('UNSUPPORTED_ZIP64', '此工作簿使用 ZIP64，请拆分后另存。');
  if (!count || count > LIMITS.entries) fail('XLSX_ENTRY_LIMIT', '工作簿内部文件数量超过限制。');
  if (!inBounds(directoryOffset, directorySize) || directoryOffset + directorySize !== end) fail('INVALID_ZIP', '工作簿目录损坏。');
  const entries = new Map();
  const spans = [];
  let cursor = directoryOffset;
  let declaredTotal = 0;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for (let index = 0; index < count; index++) {
    if (!inBounds(cursor, 46) || bytes.readUInt32LE(cursor) !== 0x02014b50) fail('INVALID_ZIP', '工作簿目录条目损坏。');
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const checksum = bytes.readUInt32LE(cursor + 16);
    const packed = bytes.readUInt32LE(cursor + 20);
    const size = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const disk = bytes.readUInt16LE(cursor + 34);
    const attributes = bytes.readUInt32LE(cursor + 38);
    const offset = bytes.readUInt32LE(cursor + 42);
    if (packed === 0xffffffff || size === 0xffffffff || offset === 0xffffffff || disk) fail('UNSUPPORTED_ZIP64', '不支持此压缩目录格式。');
    if (!inBounds(cursor + 46, nameLength + extraLength + commentLength) || cursor + 46 + nameLength + extraLength + commentLength > end) fail('INVALID_ZIP', '工作簿条目名称损坏。');
    let name;
    try { name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength)); } catch { fail('INVALID_ZIP_NAME', '工作簿内部名称编码无效。'); }
    if (!name || name.includes('\\') || name.startsWith('/') || /[\u0000-\u001f:]/.test(name) || name.split('/').some(part => part === '.' || part === '..') || entries.has(name)) fail('UNSAFE_ZIP_PATH', '工作簿含重复或不安全的内部路径。');
    if (((attributes >>> 16) & 0xf000) === 0xa000) fail('UNSAFE_ZIP_PATH', '工作簿不能包含符号链接。');
    if (flags & 1 || flags & 0x40) fail('ENCRYPTED_WORKBOOK', '请先在 Excel 中解密工作簿。');
    if (method !== 0 && method !== 8) fail('UNSUPPORTED_ZIP_METHOD', '工作簿使用了不支持的压缩方法。');
    declaredTotal += size;
    if (size > LIMITS.entryBytes || declaredTotal > LIMITS.totalBytes) fail('XLSX_EXPANSION_LIMIT', '工作簿解压大小超过限制，请拆分。');
    if (!inBounds(offset, 30) || offset + 30 > directoryOffset || bytes.readUInt32LE(offset) !== 0x04034b50) fail('INVALID_ZIP', '工作簿数据头损坏。');
    const localFlags = bytes.readUInt16LE(offset + 6);
    const localMethod = bytes.readUInt16LE(offset + 8);
    const localNameLength = bytes.readUInt16LE(offset + 26);
    const localExtra = bytes.readUInt16LE(offset + 28);
    const start = offset + 30 + localNameLength + localExtra;
    if (localFlags !== flags || localMethod !== method || !inBounds(offset + 30, localNameLength + localExtra) || !inBounds(start, packed) || start + packed > directoryOffset) fail('INVALID_ZIP', '工作簿压缩数据越界。');
    if (!bytes.subarray(offset + 30, offset + 30 + localNameLength).equals(bytes.subarray(cursor + 46, cursor + 46 + nameLength))) fail('INVALID_ZIP', '工作簿目录名称与数据头不一致。');
    if (!(flags & 8) && (bytes.readUInt32LE(offset + 14) !== checksum || bytes.readUInt32LE(offset + 18) !== packed || bytes.readUInt32LE(offset + 22) !== size)) fail('INVALID_ZIP', '工作簿目录长度校验失败。');
    if (method === 0 && packed !== size) fail('INVALID_ZIP', '未压缩条目长度不一致。');
    entries.set(name, { name, packed, size, start, checksum, method });
    spans.push([offset, start + packed]);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (cursor !== end) fail('INVALID_ZIP', '工作簿目录范围不一致。');
  spans.sort((a, b) => a[0] - b[0]);
  if (spans.some((span, index) => index && span[0] < spans[index - 1][1])) fail('INVALID_ZIP', '工作簿数据条目发生重叠。');
  const cache = new Map();
  return Object.freeze({
    names: Object.freeze([...entries.keys()]),
    read(name) {
      if (cache.has(name)) return cache.get(name);
      const entry = entries.get(name);
      if (!entry) return null;
      let output;
      const packed = bytes.subarray(entry.start, entry.start + entry.packed);
      try { output = entry.method === 0 ? Buffer.from(packed) : inflateRawSync(packed, { maxOutputLength: Math.max(1, entry.size) }); }
      catch { fail('XLSX_DECOMPRESSION_FAILED', '工作簿解压失败或超过声明大小。'); }
      if (output.length !== entry.size || crc32(output) !== entry.checksum) fail('XLSX_CRC_MISMATCH', '工作簿内容校验失败。');
      cache.set(name, output);
      return output;
    }
  });
}

module.exports = { openZip, crc32, LIMITS };
