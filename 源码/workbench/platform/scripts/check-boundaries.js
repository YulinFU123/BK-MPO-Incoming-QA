'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const failures = [];
function inspect(relative) {
  for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
    const file = path.join(relative, entry.name);
    if (entry.isDirectory()) { inspect(file); continue; }
    if (!entry.name.endsWith('.js')) continue;
    const content = fs.readFileSync(path.join(root, file), 'utf8');
    for (const match of content.matchAll(/require\(['"]([^'"]+)['"]\)/g)) {
      const dependency = match[1];
      if (relative.startsWith('domain') && !(dependency.startsWith('./') || ['node:crypto','crypto'].includes(dependency))) failures.push(`${file}: forbidden ${dependency}`);
      if (relative.startsWith('application') && (!dependency.startsWith('../domain/') && !dependency.startsWith('../ports/') && !['node:crypto'].includes(dependency))) failures.push(`${file}: forbidden ${dependency}`);
    }
    if ((relative.startsWith('domain') || relative.startsWith('application')) && /\b(window|document|ipcRenderer|ipcMain)\s*[.[]/.test(content)) failures.push(`${file}: UI reference`);
  }
}
inspect('domain'); inspect('application');
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
else console.log('Layer boundary check passed (static require/UI scan; not a security sandbox).');
