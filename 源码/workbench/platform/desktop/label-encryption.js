'use strict';
/** Electron45 async OS encryption; no plaintext or hardcoded-key fallback. */
function createLabelEncryption(safeStorage, platform = process.platform) {
  return Object.freeze({
    async isEncryptionAvailable() {
      return (
        platform === 'win32' &&
        typeof safeStorage.isAsyncEncryptionAvailable === 'function' &&
        (await safeStorage.isAsyncEncryptionAvailable())
      );
    },
    encryptString: (value) => safeStorage.encryptStringAsync(value),
    decryptString: async (bytes) => (await safeStorage.decryptStringAsync(bytes)).result,
  });
}
module.exports = { createLabelEncryption };
