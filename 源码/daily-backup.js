'use strict';
const fs = require('node:fs');
const path = require('node:path');

// A complete temporary file is renamed into place; an interrupted write is retried.
function ensureDailyBackup(directory, raw, date = new Date()) {
  const day = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  const folder = path.join(directory, 'daily-backups');
  fs.mkdirSync(folder, { recursive: true });
  const target = path.join(folder, day + '.json');
  if (fs.existsSync(target)) return target;
  const temporary = target + '.tmp';
  const fd = fs.openSync(temporary, 'w', 0o600);
  try {
    fs.writeFileSync(fd, typeof raw === 'function' ? raw() : raw, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temporary, target);
  return target;
}
module.exports = { ensureDailyBackup };
