#!/usr/bin/env node
'use strict';

/** Recovery tool for encrypted snapshots left behind by a failed Windows
 * atomic save. The snapshots are complete .eap ciphertext, never plaintext.
 * Run with the same Python-independent Node runtime that ships in the app:
 *
 *   node recover-encrypted-snapshot.js --file <工作区.eap> --list
 *   set VAULT_PASSWORD=... (or use --password-stdin)
 *   node recover-encrypted-snapshot.js --file <工作区.eap> --inspect <副本名>
 *   node recover-encrypted-snapshot.js --file <工作区.eap> --restore <副本名>
 *
 * --restore keeps a copy of the current file as <工作区.eap>.before-recovery-*
 * before publishing, so the operation itself stays reversible.
 */
const fs = require('node:fs');
const {
  listRecoverySnapshots,
  inspectRecoverySnapshot,
  restoreRecoverySnapshot,
} = require('../adapters/encrypted/repository');

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] || null;
}
function has(name) {
  return process.argv.includes(name);
}
async function password() {
  if (has('--password-stdin')) {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    return Buffer.concat(chunks).toString('utf8').trim();
  }
  const value = option('--password') || process.env.VAULT_PASSWORD;
  if (!value) {
    console.error('请通过环境变量 VAULT_PASSWORD 或 --password-stdin 提供工作区密码。');
    process.exit(2);
  }
  return value;
}
function summarize(state) {
  if (!state || typeof state !== 'object') return '空';
  const counts = {};
  for (const key of ['datasets', 'batches', 'facts', 'observations']) {
    if (Array.isArray(state[key])) counts[key] = state[key].length;
  }
  return JSON.stringify(
    { ...counts, hasLegacyState: Boolean(state.legacyState) },
    null,
    0,
  );
}

async function main() {
  const file = option('--file');
  if (!file || !fs.existsSync(file)) {
    console.error('用法：--file <工作区.eap> [--list | --inspect <副本名> | --restore <副本名>]');
    process.exit(2);
  }
  const snapshots = listRecoverySnapshots(file);
  if (has('--list') || (!has('--inspect') && !has('--restore'))) {
    if (!snapshots.length) {
      console.log('未发现可恢复副本。');
      return 0;
    }
    console.log(`发现 ${snapshots.length} 个可恢复副本（按时间从新到旧）：`);
    for (const snapshot of snapshots)
      console.log(
        `  ${snapshot.name}  ${snapshot.bytes} bytes  ${new Date(snapshot.mtimeMs).toLocaleString('zh-CN')}`,
      );
    return 0;
  }
  const name = option('--inspect') || option('--restore');
  if (!snapshots.some((snapshot) => snapshot.name === name)) {
    console.error(`未找到指定副本：${name}。请先运行 --list。`);
    return 2;
  }
  const secret = await password();
  if (has('--inspect')) {
    const checked = await inspectRecoverySnapshot({
      file,
      recoveryFile: name,
      password: secret,
    });
    console.log(`副本可解密：${checked.bytes} bytes，内容 ${summarize(checked.state)}`);
    return 0;
  }
  const result = await restoreRecoverySnapshot({
    file,
    recoveryFile: name,
    password: secret,
  });
  console.log(`已恢复：${result.restoredFrom}`);
  console.log(`恢复前的工作区副本：${result.preRestoreBackup}`);
  console.log('请重新打开工作区核对内容，确认无误后再清理上述副本文件。');
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`恢复失败 [${error.code || 'UNKNOWN'}]：${error.message}`);
    process.exit(1);
  },
);
