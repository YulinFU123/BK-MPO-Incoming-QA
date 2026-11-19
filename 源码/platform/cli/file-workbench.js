'use strict';

// Local developer entry. Passwords are read interactively or from explicit stdin;
// never accept them in arguments/config, print them, or send them over IPC.
const fs = require('node:fs/promises');
const path = require('node:path');
const readline = require('node:readline');
const { createInterface } = require('node:readline/promises');
const { createPlatform, createFilePlatform } = require('../index');
const { restoreEncryptedBackup } = require('../adapters/encrypted/repository');
const { PlatformError } = require('../domain/errors');
const { assertJSONData } = require('../ports/dto');

function parseArgs(args) {
  const [command, ...tail] = args;
  const result = { command };
  const flags = new Set(['create', 'yes', 'ack-warnings', 'password-stdin']);
  const values = new Set(['file', 'config', 'store', 'dataset', 'start', 'end', 'output']);
  for (let i = 0; i < tail.length; i++) {
    const key = tail[i].startsWith('--') ? tail[i].slice(2) : '';
    if (flags.has(key)) result[key] = true;
    else if (values.has(key) && tail[i + 1] && !tail[i + 1].startsWith('--')) result[key] = tail[++i];
    else throw new PlatformError('INVALID_ARGUMENT', '参数无效；使用 help 查看说明。');
  }
  return result;
}

function required(options, key) {
  if (!options[key]) throw new PlatformError('MISSING_ARGUMENT', `缺少 --${key} 参数。`);
  return options[key];
}

async function readBounded(file, maxBytes) {
  const handle = await fs.open(path.resolve(file), 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size <= 0 || stat.size > maxBytes) throw new PlatformError('FILE_SIZE_LIMIT', '文件为空或超过大小限制。');
    const bytes = await handle.readFile();
    if (bytes.length > maxBytes) throw new PlatformError('FILE_SIZE_LIMIT', '文件超过大小限制。');
    return bytes;
  } finally { await handle.close(); }
}

async function readPassword(options) {
  if (options['password-stdin']) {
    let value = '';
    for await (const chunk of process.stdin) {
      value += chunk.toString('utf8');
      if (value.length > 4096) throw new PlatformError('INVALID_PASSWORD', '密码输入过长。');
    }
    return value.replace(/\r?\n$/, '');
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new PlatformError('PASSWORD_TTY_REQUIRED', '请在终端中输入密码，或显式使用 --password-stdin。');
  readline.emitKeypressEvents(process.stdin);
  const previousRaw = process.stdin.isRaw;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdout.write('工作区密码（不显示）：');
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (error) => {
      process.stdin.removeListener('keypress', onKey);
      process.stdin.setRawMode(!!previousRaw);
      process.stdin.pause();
      process.stdout.write('\n');
      if (error) reject(error); else resolve(value);
    };
    function onKey(text, key = {}) {
      if (key.ctrl && key.name === 'c') return finish(new PlatformError('CANCELLED', '已取消。'));
      if (key.name === 'return' || key.name === 'enter') return finish();
      if (key.name === 'backspace') { value = [...value].slice(0, -1).join(''); return; }
      if (text && !key.ctrl && !key.meta && !/[\x00-\x1f\x7f]/.test(text)) {
        value += text;
        if (value.length > 1024) finish(new PlatformError('INVALID_PASSWORD', '密码输入过长。'));
      }
    }
    process.stdin.on('keypress', onKey);
  });
}

async function confirmImport(options, preview) {
  if (preview.stats.errorCount || !preview.stats.validRowCount) throw new PlatformError('INVALID_PREVIEW', '存在无效行，整批未导入。');
  if (options.yes) {
    if (preview.requiresAcknowledgement && !options['ack-warnings']) throw new PlatformError('WARNINGS_NOT_ACKNOWLEDGED', '存在导入警告，请核对后明确使用 --ack-warnings。');
    return;
  }
  if (!process.stdin.isTTY) throw new PlatformError('CONFIRMATION_REQUIRED', '请交互确认导入，或显式使用 --yes。');
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const value = await terminal.question(preview.requiresAcknowledgement ? '请核对以上警告，输入 IMPORT 确认导入并接受警告：' : '输入 IMPORT 确认导入，其他输入取消：');
    if (value !== 'IMPORT') throw new PlatformError('CANCELLED', '已取消，未导入。');
  } finally { terminal.close(); }
}

const print = value => process.stdout.write(JSON.stringify(value, null, 2) + '\n');

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.command || options.command === 'help') {
    console.log(`异常分析平台 0.2.0-dev.1 · 文件工作台（开发版）
inspect --file <xlsx>
import --file <xlsx> --config <映射JSON> --store <独立加密文件> [--create]
report --store <加密文件> --dataset <数据集ID> --start YYYY-MM-DD --end YYYY-MM-DD
backup --store <加密文件> --output <新备份文件>
restore --file <加密备份> --store <不存在的新加密文件>

密码默认在终端隐藏输入；自动化可显式使用 --password-stdin，从标准输入读取。
导入默认要求交互确认，--yes 明确确认；有警告时还需 --ack-warnings。
--create 仅允许新建，绝不覆盖已有库；旧版 QualityDeskOffline 数据不读取不迁移。
本工具未连接公司 BI 和桌面 UI；操作前请阅读 README 与测试限制。`);
    return;
  }
  if (options.command === 'inspect') {
    const bytes = await readBounded(required(options, 'file'), 25 * 1024 * 1024);
    const platform = await createPlatform();
    print(await platform.imports.inspectWorkbook({ bytes }));
    return;
  }
  if (options.command === 'import') {
    const bytes = await readBounded(required(options, 'file'), 25 * 1024 * 1024);
    const configuration = JSON.parse((await readBounded(required(options, 'config'), 128 * 1024)).toString('utf8'));
    assertJSONData(configuration);
    if (Object.keys(configuration).some(key => !['dataset', 'mapping', 'source'].includes(key))) throw new PlatformError('INVALID_CONFIG', '映射文件只允许 dataset、mapping、source。');
    const store = path.resolve(required(options, 'store'));
    const transient = await createPlatform();
    const preview = await transient.imports.previewWorkbook({ bytes, ...configuration });
    print(preview);
    await confirmImport(options, preview);
    const password = await readPassword(options);
    const platform = await createFilePlatform({ file: store, password, create: !!options.create });
    try {
      const checked = await platform.imports.previewWorkbook({ bytes, ...configuration });
      print(await platform.imports.commitPreview(checked.previewId, { acknowledgeWarnings: true }));
    } finally { await platform.close(); }
    return;
  }
  if (options.command === 'restore') {
    const backupFile = path.resolve(required(options, 'file'));
    const file = path.resolve(required(options, 'store'));
    const password = await readPassword(options);
    const repository = await restoreEncryptedBackup({ backupFile, file, password });
    await repository.close();
    print({ status: 'restored-to-new-file' });
    return;
  }
  if (!['report', 'backup'].includes(options.command)) throw new PlatformError('INVALID_COMMAND', '未知命令，使用 help 查看说明。');
  const file = path.resolve(required(options, 'store'));
  const password = await readPassword(options);
  const platform = await createFilePlatform({ file, password });
  try {
    if (options.command === 'report') print(await platform.analysis.overview({ datasetId: required(options, 'dataset'), start: required(options, 'start'), end: required(options, 'end') }));
    else { await platform.backup({ file: path.resolve(required(options, 'output')) }); print({ status: 'encrypted-backup-created' }); }
  } finally { await platform.close(); }
}

if (require.main === module) main().catch(error => {
  print({ ok: false, error: error instanceof PlatformError ? { code: error.code, message: error.message } : { code: 'OPERATION_FAILED', message: '操作未完成，请检查文件、参数或权限。' } });
  process.exitCode = 1;
});

module.exports = { parseArgs, readBounded };
