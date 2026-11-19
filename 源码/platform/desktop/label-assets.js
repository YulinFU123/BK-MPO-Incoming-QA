'use strict';
const { deflateSync, deflateRawSync } = require('node:zlib');
const { crc32 } = require('../adapters/xlsx/zip');
function zip(entries) {
  const locals = [],
    central = [];
  let offset = 0,
    size = 0;
  const now = new Date(),
    date =
      ((Math.max(1980, Math.min(2107, now.getFullYear())) - 1980) << 9) |
      ((now.getMonth() + 1) << 5) |
      now.getDate(),
    time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  for (const [name, data0] of entries) {
    if (!name || name.includes('..') || name.startsWith('/') || name.includes('\\'))
      throw Error('导出内部名称无效。');
    const data = Buffer.from(data0),
      bytes = deflateRawSync(data),
      filename = Buffer.from(name),
      crc = crc32(data),
      head = Buffer.alloc(30),
      dir = Buffer.alloc(46);
    head.writeUInt32LE(0x04034b50);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x800, 6);
    head.writeUInt16LE(8, 8);
    head.writeUInt16LE(time, 10);
    head.writeUInt16LE(date, 12);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(bytes.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(filename.length, 26);
    dir.writeUInt32LE(0x02014b50);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x800, 8);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt16LE(time, 12);
    dir.writeUInt16LE(date, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(bytes.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(filename.length, 28);
    dir.writeUInt32LE(offset, 42);
    locals.push(head, filename, bytes);
    central.push(dir, filename);
    offset += head.length + filename.length + bytes.length;
    size += dir.length + filename.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(size, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...central, end]);
}
function png(modules) {
  const count = (modules.length + 8) * 12,
    raw = Buffer.alloc((count * 3 + 1) * count, 255);
  for (let y = 0; y < count; y++) {
    const start = y * (count * 3 + 1);
    raw[start] = 0;
    for (let x = 0; x < count; x++) {
      const mx = Math.floor(x / 12) - 4,
        my = Math.floor(y / 12) - 4;
      if (modules[my]?.[mx]) raw.fill(0, start + 1 + x * 3, start + 4 + x * 3);
    }
  }
  const chunk = (type, data) => {
    const name = Buffer.from(type),
      size = Buffer.alloc(4),
      crc = Buffer.alloc(4);
    size.writeUInt32BE(data.length);
    crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
    return Buffer.concat([size, name, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(count);
  ihdr.writeUInt32BE(count, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
module.exports = { zip, png };
