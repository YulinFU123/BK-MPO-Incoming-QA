'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { PlatformError } = require('../domain/errors');
const { createLabelEncryption } = require('./label-encryption');
/** The initial Windows provider key can precede its Local State disk commit.
 * Never acknowledge recoverable configuration until that key is durable.
 * No key bytes are returned, logged, copied or modified by this adapter.
 */
function createStateEncryption(
  safeStorage,
  {
    profile,
    platform = process.platform,
    timeout = 20000,
    readKey = async () => {
      let handle;
      try {
        handle = await fs.open(path.join(profile, 'Local State'), 'r+');
        const stat = await handle.stat();
        if (stat.size > 1024 * 1024) return false;
        const state = JSON.parse(await handle.readFile('utf8'));
        const wrapped = state.os_crypt?.encrypted_key;
        if (typeof wrapped !== 'string' || wrapped.length < 20) return false;
        // Flush the existing provider-owned file, without changing its contents.
        await handle.sync();
        return true;
      } catch {
        return false;
      } finally {
        await handle?.close();
      }
    },
    pause = (ms) => new Promise((r) => setTimeout(r, ms)),
    clock = Date.now,
  } = {},
) {
  const base = createLabelEncryption(safeStorage);
  let ready = null;
  async function durable() {
    if (platform !== 'win32') return;
    if (!ready)
      ready = (async () => {
        const deadline = clock() + timeout;
        do {
          if (await readKey()) return;
          await pause(100);
        } while (clock() < deadline);
        throw new PlatformError(
          'STATE_KEY_NOT_DURABLE',
          '本机加密正在初始化，配置尚未保存。请稍后点击“重试保存”，期间保留当前窗口。',
        );
      })().catch((error) => {
        ready = null;
        throw error;
      });
    await ready;
  }
  return Object.freeze({
    isEncryptionAvailable: base.isEncryptionAvailable,
    async decryptString(bytes) {
      try {
        return await base.decryptString(bytes);
      } catch (error) {
        if (/temporarily unavailable/i.test(error.message || ''))
          throw new PlatformError(
            'STATE_ENCRYPTION_UNAVAILABLE',
            '本机加密暂不可用，请稍后重新读取配置。',
          );
        throw error;
      }
    },
    async encryptString(value) {
      if (!(await base.isEncryptionAvailable()))
        throw new PlatformError('STATE_ENCRYPTION_UNAVAILABLE', '本机加密暂不可用，请稍后重试。');
      await durable();
      return base.encryptString(value);
    },
  });
}
module.exports = { createStateEncryption };
