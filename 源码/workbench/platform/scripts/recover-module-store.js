'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createSQLiteStateStore } = require('../adapters/state/sqlite-state-store');
/** Produce a verified recovery file only. Never replaces a live profile/database. */
async function recover(source, target) {
  source = path.resolve(source);
  target = path.resolve(target);
  if (source === target) throw Error('恢复目标必须是新的文件。');
  try {
    await fs.access(target);
    throw Error('恢复目标已存在，禁止覆盖。');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const store = await createSQLiteStateStore(source, { readOnly: true });
  try {
    if ((await store.check()).integrity !== 'ok') throw Error('备份未通过完整性检查。');
    await store.backup(target);
  } finally {
    await store.close();
  }
  const checked = await createSQLiteStateStore(target, { readOnly: true });
  try {
    if ((await checked.check()).integrity !== 'ok') throw Error('恢复文件未通过检查。');
  } finally {
    await checked.close();
  }
  return {
    file: target,
    activeStoreModified: false,
    requiresSameWindowsAccountAndOriginalEncryptionProfile: true,
  };
}
module.exports = { recover };
if (require.main === module) {
  if (process.argv.length !== 4) {
    console.error('用法：node scripts/recover-module-store.js 配置备份.sqlite 新的恢复文件.sqlite');
    process.exitCode = 2;
  } else
    recover(process.argv[2], process.argv[3])
      .then((v) => console.log(JSON.stringify(v)))
      .catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
      });
}
