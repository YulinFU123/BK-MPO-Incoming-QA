'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict');
const { createStateEncryption } = require('../desktop/state-encryption');
const safe = {
  isAsyncEncryptionAvailable: async () => true,
  encryptStringAsync: async (v) => Buffer.from(v),
  decryptStringAsync: async (b) => ({ result: b.toString() }),
};
test('new Windows state waits for provider key disk commit before acknowledging encryption', async () => {
  let n = 0,
    now = 0,
    encrypted = 0;
  const s = {
    ...safe,
    encryptStringAsync: async (v) => {
      encrypted++;
      return Buffer.from(v);
    },
  };
  const e = createStateEncryption(s, {
    profile: 'synthetic-only',
    platform: 'win32',
    readKey: async () => ++n >= 3,
    pause: async (ms) => {
      now += ms;
    },
    clock: () => now,
  });
  await e.encryptString('qa');
  assert.equal(n, 3);
  assert.equal(encrypted, 1);
  await e.encryptString('qa2');
  assert.equal(n, 3);
});
test('provider key durability timeout fails without encrypting and a later explicit retry can succeed', async () => {
  let now = 0,
    available = false,
    encrypted = 0;
  const e = createStateEncryption(
    {
      ...safe,
      encryptStringAsync: async () => {
        encrypted++;
        return Buffer.alloc(0);
      },
    },
    {
      profile: 'synthetic',
      platform: 'win32',
      timeout: 200,
      readKey: async () => available,
      pause: async (ms) => (now += ms),
      clock: () => now,
    },
  );
  await assert.rejects(e.encryptString('qa'), (x) => x.code === 'STATE_KEY_NOT_DURABLE');
  assert.equal(encrypted, 0);
  available = true;
  await e.encryptString('qa');
  assert.equal(encrypted, 1);
});
