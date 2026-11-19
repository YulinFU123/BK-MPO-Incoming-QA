'use strict';
// Build-time rasterization of the authored SVG; no graphics dependency ships with the app.
const fs = require('node:fs');
const path = require('node:path');
async function render(tooling) {
  if (!tooling || !path.isAbsolute(tooling)) throw Error('请提供构建工具node_modules的绝对路径。');
  const sharp = require(path.join(tooling, 'sharp'));
  const directory = path.join(__dirname, '../desktop/app/assets');
  const source = fs.readFileSync(path.join(directory, 'logo.svg'));
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const frames = [];
  for (const size of sizes) frames.push(await sharp(source).resize(size, size).png().toBuffer());
  fs.writeFileSync(path.join(directory, 'logo.png'), frames.at(-1));
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  for (const [index, size] of sizes.entries()) {
    const at = 6 + index * 16;
    header[at] = header[at + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, at + 4);
    header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(frames[index].length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += frames[index].length;
  }
  fs.writeFileSync(path.join(directory, 'logo.ico'), Buffer.concat([header, ...frames]));
  process.stdout.write(JSON.stringify({ source: 'logo.svg', png: '256x256', ico: sizes }) + '\n');
}
if (require.main === module)
  render(process.argv[2]).catch((error) => {
    process.stderr.write(error.message + '\n');
    process.exitCode = 1;
  });
module.exports = { render };
