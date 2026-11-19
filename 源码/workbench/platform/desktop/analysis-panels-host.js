'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const P = require('../domain/analysis-panels');
const MAX_BYTES = 4 * 1024 * 1024;
const hash = (data) => createHash('sha256').update(data).digest('hex');
const encode = (value) => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const clone = (value) => structuredClone(value);
const samePath = (a, b) => {
  a = path.resolve(a);
  b = path.resolve(b);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
};
const limited = (value) => {
  const bytes = encode(value);
  if (bytes.length > MAX_BYTES) throw Error('配置超过4MB，请减少过长的筛选值或分成多个方案。');
  return bytes;
};

function createAnalysisPanelsHost({
  context,
  check,
  root,
  readConfig,
  saveFile,
  pickScheme,
  io = fs,
}) {
  const cache = new Map();
  let queue = Promise.resolve();
  function address(c) {
    return c.mode === 'file'
      ? path.join(root(c), 'analysis-panels.settings.json')
      : 'demo:' + c.sessionId;
  }
  async function readJson(file) {
    const stat = await io.lstat(file);
    if (stat.isSymbolicLink() || stat.size > MAX_BYTES)
      throw Error('配置文件为联接或超过4MB，未读取。');
    const bytes = await io.readFile(file);
    return { bytes, value: JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')) };
  }
  async function atomic(file, bytes, beforeCommit = async () => {}) {
    const parent = path.dirname(file);
    await io.mkdir(parent, { recursive: true });
    if ((await io.lstat(parent)).isSymbolicLink()) throw Error('配置目录不能是联接。');
    const temporary = file + '.tmp-' + randomUUID();
    let handle;
    try {
      handle = await io.open(temporary, 'wx', 0o600);
      await handle.writeFile(bytes);
      await handle.sync();
      await handle.close();
      handle = null;
      if (!Buffer.from(await io.readFile(temporary)).equals(bytes))
        throw Error('配置写入校验失败。');
      await beforeCommit();
      for (let attempt = 0; ; attempt++) {
        try {
          await io.rename(temporary, file);
          break;
        } catch (e) {
          if (!['EPERM', 'EACCES', 'EBUSY'].includes(e.code) || attempt === 2) throw e;
          await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)));
          await beforeCommit();
        }
      }
    } finally {
      await handle?.close().catch(() => {});
      await io.unlink(temporary).catch(() => {});
    }
  }
  async function load(c, config) {
    const file = address(c),
      previous = cache.get(file);
    if (c.mode !== 'file') {
      const data = previous || {
        state: P.defaults(config),
        signature: '',
        persisted: false,
        writable: true,
        file: null,
      };
      cache.set(file, data);
      return clone(data);
    }
    try {
      const raw = await readJson(file),
        state = P.validate(raw.value);
      check(c);
      const data = { state, signature: hash(raw.bytes), persisted: true, writable: true, file };
      cache.set(file, data);
      return clone(data);
    } catch (error) {
      if (error.code === 'ENOENT' && !previous) {
        // A prior recovery snapshot means a missing main file is not a fresh reset.
        try {
          const backup = await readJson(file + '.last-good');
          const data = {
            state: P.validate(backup.value),
            signature: '',
            persisted: false,
            writable: false,
            file,
            warning: '配置文件缺失，已展示上次有效配置；请恢复配置文件后继续保存。',
          };
          cache.set(file, data);
          return clone(data);
        } catch (backupError) {
          if (backupError.code !== 'ENOENT')
            throw Error('主配置和恢复快照无法读取；文件保留，请从已分享的方案恢复。');
        }
        const state = P.defaults(config),
          bytes = encode(state);
        await atomic(file, bytes, async () => {
          check(c);
          try {
            await io.lstat(file);
            throw Error('配置文件已由外部创建，请重新读取。');
          } catch (e) {
            if (e.code !== 'ENOENT') throw e;
          }
        });
        const data = { state, signature: hash(bytes), persisted: true, writable: true, file };
        cache.set(file, data);
        return clone(data);
      }
      if (previous)
        return {
          ...clone(previous),
          writable: false,
          warning: '配置文件尚未完整或无法读取，继续展示上次有效设置；未覆盖文件。',
        };
      try {
        const backup = await readJson(file + '.last-good');
        return {
          state: P.validate(backup.value),
          signature: '',
          persisted: false,
          writable: false,
          file,
          warning: '主配置无效，已展示上次有效快照；请修复或替换主配置文件。',
        };
      } catch {
        throw Error('分析板块配置无法读取，原文件未修改。请检查JSON或从方案文件恢复。');
      }
    }
  }
  async function save(c, config, state, signature) {
    const current = await load(c, config);
    if (!current.writable) throw Error(current.warning);
    if (signature !== current.signature)
      throw Error(
        '配置文件已被外部修改；本地修改保留，未覆盖新文件。请先分享当前方案或重新读取配置。',
      );
    const next = P.validate(state);
    next.revision = current.state.revision + 1;
    if (!Number.isSafeInteger(next.revision)) throw Error('配置修订号超出范围，未修改文件。');
    const bytes = limited(next);
    if (c.mode !== 'file') {
      const data = {
        state: next,
        signature: hash(encode(next)),
        persisted: false,
        writable: true,
        file: null,
      };
      cache.set(address(c), data);
      return clone(data);
    }
    const file = address(c);
    const oldBytes = await io.readFile(file);
    if (hash(oldBytes) !== signature) throw Error('配置在保存前发生变化，未覆盖。');
    await atomic(file + '.last-good', oldBytes, async () => check(c));
    await atomic(file, bytes, async () => {
      check(c);
      if (hash(await io.readFile(file)) !== signature)
        throw Error('配置在保存期间被替换，未覆盖。');
    });
    const data = { state: next, signature: hash(bytes), persisted: true, writable: true, file };
    cache.set(file, data);
    return clone(data);
  }
  async function operation(input, c) {
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).some(
        (k) => !['action', 'panelState', 'signature', 'sourceId', 'schemeId'].includes(k),
      )
    )
      throw Error('分析方案操作参数无效。');
    check(c);
    const config = await readConfig();
    check(c);
    if (input.action === 'panelsLoad') return load(c, config);
    if (input.action === 'panelsSave') return save(c, config, input.panelState, input.signature);
    if (!['panelsExport', 'panelsImport'].includes(input.action))
      throw Error('分析方案操作不存在。');
    const source = config.sources.find((s) => s.id === input.sourceId && s.kind === 'defects');
    if (!source) throw Error('请先选择不良数据源，再使用方案。');
    if (input.action === 'panelsExport') {
      const state = P.validate(input.panelState),
        slot = state.sources[source.id];
      const selected = slot?.schemes.find((s) => s.id === input.schemeId);
      if (!selected) throw Error('请选择需要分享的分析方案。');
      const output = await saveFile('json', '分析方案');
      check(c);
      if (!output) return { cancelled: true };
      if (path.extname(output).toLowerCase() !== '.json' || samePath(output, address(c)))
        throw Error('分享方案请保存为另一个JSON文件，不能覆盖当前配置。');
      await atomic(output, limited(P.share(selected)), async () => check(c));
      return { file: output, shared: true };
    }
    const selected = await pickScheme();
    check(c);
    if (!selected) return { cancelled: true };
    const imported = P.readShare((await readJson(selected)).value, source);
    const current = await load(c, config);
    if (current.signature !== input.signature) throw Error('配置已经变化，请重新读取后导入。');
    const state = clone(current.state),
      slot = P.ensure(state, source, config);
    imported.id = randomUUID();
    const baseName = imported.name.slice(0, 65);
    let count = 1;
    while (slot.schemes.some((s) => s.name === imported.name))
      imported.name = baseName + '（导入' + count++ + '）';
    slot.schemes.push(imported);
    slot.active = imported.id;
    return { ...(await save(c, config, state, current.signature)), imported: imported.name };
  }
  return Object.freeze({
    request(input) {
      // Serialize file operations so two clicks cannot create competing writes.
      const c = context();
      const task = queue.catch(() => {}).then(() => operation(input, c));
      queue = task.catch(() => {});
      return task;
    },
    clear() {
      cache.clear();
    },
  });
}
module.exports = { createAnalysisPanelsHost };
