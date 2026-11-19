'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { integrateLegacyRenderer, integrateLegacyAppearance } = require('../desktop/legacy-handoff');

function prepareLegacy(source, destination) {
  if (!path.isAbsolute(source) || !path.isAbsolute(destination)) throw new Error('需要绝对路径。');
  fs.mkdirSync(destination, { recursive: true });
  const files = fs.readdirSync(source, { withFileTypes: true }).filter((entry) => entry.isFile());
  const manifest = [];
  for (const entry of files) {
    const input = fs.readFileSync(path.join(source, entry.name));
    const output =
      entry.name === 'renderer.js'
        ? Buffer.from(integrateLegacyRenderer(input.toString('utf8')).source, 'utf8')
        : entry.name === 'appearance.js'
          ? Buffer.from(integrateLegacyAppearance(input.toString('utf8')).source, 'utf8')
          : input;
    fs.writeFileSync(path.join(destination, entry.name), output);
    manifest.push({
      name: entry.name,
      sourceSha256: crypto.createHash('sha256').update(input).digest('hex'),
      packagedSha256: crypto.createHash('sha256').update(output).digest('hex'),
      startupHandoffOnly: entry.name === 'renderer.js',
      appearanceBridgeOnly: entry.name === 'appearance.js',
    });
  }
  fs.writeFileSync(
    path.join(destination, 'fusion-manifest.json'),
    JSON.stringify({ files: manifest, canonicalFilesModified: false }, null, 2),
    'utf8',
  );
  return manifest;
}
if (require.main === module)
  prepareLegacy(path.resolve(process.argv[2]), path.resolve(process.argv[3]));
module.exports = { prepareLegacy };
