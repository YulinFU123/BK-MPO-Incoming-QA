'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const model = require('../domain/label-memory');
const { assertJSONData } = require('../ports/dto');
const { PlatformError } = require('../domain/errors');
const { replaceFile } = require('../adapters/encrypted/replace-file');

/** Separate Windows-account-encrypted preferences; never writes the business vault. */
function createLabelMemory({ controller, directory, encryption, replace = replaceFile }) {
  let queue = Promise.resolve();
  const demos = new Map();
  function context() {
    const c = controller.hostContext();
    if (!c.unlocked) throw new PlatformError('WORKSPACE_LOCKED', '请先打开工作区。');
    const scope =
      c.mode === 'demo'
        ? `demo-${c.sessionId}`
        : createHash('sha256').update(path.resolve(c.file).toLowerCase()).digest('hex');
    return { sessionId: c.sessionId, scope, demo: c.mode === 'demo' };
  }
  function guard(c) {
    const now = context();
    if (now.sessionId !== c.sessionId || now.scope !== c.scope)
      throw new PlatformError('SESSION_CHANGED', '工作区已变化，记忆操作已取消。');
  }
  async function available() {
    if (
      !(await encryption?.isEncryptionAvailable()) ||
      encryption.getSelectedStorageBackend?.() === 'basic_text'
    )
      throw new PlatformError(
        'LABEL_MEMORY_UNAVAILABLE',
        '当前环境无法进行本机加密记忆，仍可正常排版和导出。',
      );
  }
  const file = (c) => path.join(directory, c.scope + '.v2.bin');
  async function load(c) {
    if (c.demo) return structuredClone(demos.get(c.scope) || model.empty());
    await available();
    let handle;
    try {
      handle = await fs.open(file(c), 'r');
      if ((await handle.stat()).size > 2 * 1024 * 1024) throw Error('size');
      const encrypted = await handle.readFile();
      const data = JSON.parse(await encryption.decryptString(encrypted));
      assertJSONData(data);
      return model.validate(data);
    } catch (error) {
      if (error.code === 'ENOENT') {
        // Read-only import from 0.7 preferences. Leave its ciphertext available to rollback.
        let previous;
        try {
          previous = await fs.open(path.join(directory, c.scope + '.bin'), 'r');
          if ((await previous.stat()).size > 2 * 1024 * 1024) throw Error('size');
          const data = JSON.parse(await encryption.decryptString(await previous.readFile()));
          assertJSONData(data);
          return { ...model.validate(data), revision: 0 };
        } catch (legacyError) {
          if (legacyError.code === 'ENOENT') return model.empty();
          throw new PlatformError(
            'LABEL_MEMORY_READ',
            '未能读取旧版排版记忆，原文件保留。可继续临时排版。',
          );
        } finally {
          await previous?.close();
        }
      }
      throw new PlatformError(
        'LABEL_MEMORY_READ',
        '未能读取排版记忆，原文件保留。请重试，或继续临时排版。',
      );
    } finally {
      await handle?.close();
    }
  }
  function serial(work) {
    const next = queue.then(work);
    queue = next.catch(() => {});
    return next;
  }
  const reply = (c, state) => ({
    state,
    persistence: c.demo ? 'session-only' : 'windows-account-encrypted',
  });
  return Object.freeze({
    clearSession: () => demos.clear(),
    read() {
      const c = context();
      return serial(async () => {
        guard(c);
        const data = await load(c);
        guard(c);
        return reply(c, data);
      });
    },
    save(input) {
      const c = context();
      let requested;
      try {
        assertJSONData(input);
        requested = model.validate(input);
      } catch (error) {
        throw new PlatformError('LABEL_MEMORY_ARGUMENT', error.message);
      }
      return serial(async () => {
        guard(c);
        const current = await load(c);
        guard(c);
        if (requested.revision !== current.revision)
          throw new PlatformError(
            'LABEL_MEMORY_CONFLICT',
            '排版记忆已在其他窗口更新。请重新读取记忆，再保存当前方案。',
          );
        const next = { ...requested, revision: current.revision + 1 };
        if (c.demo) {
          demos.set(c.scope, next);
          return reply(c, next);
        }
        const bytes = await encryption.encryptString(JSON.stringify(next));
        guard(c);
        await fs.mkdir(directory, { recursive: true });
        const temp = path.join(directory, c.scope + '.' + randomUUID() + '.tmp');
        let handle;
        try {
          handle = await fs.open(temp, 'wx');
          await handle.writeFile(bytes);
          await handle.sync();
          await handle.close();
          handle = null;
          guard(c);
          replace(temp, file(c));
          return reply(c, next);
        } catch (error) {
          if (error instanceof PlatformError) throw error;
          throw new PlatformError(
            'LABEL_MEMORY_WRITE',
            '本次排版记忆未保存，原记忆保留。可以继续排版，稍后点击“立即记住”重试。',
          );
        } finally {
          await handle?.close();
          await fs.unlink(temp).catch(() => {});
        }
      });
    },
  });
}
module.exports = { createLabelMemory };
