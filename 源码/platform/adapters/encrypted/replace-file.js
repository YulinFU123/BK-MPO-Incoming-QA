'use strict';

const fs = require('node:fs');
const RETRY_DELAYS = Object.freeze([20, 50, 100, 200, 400]);
const TRANSIENT_WINDOWS = new Set(['EPERM', 'EACCES', 'EBUSY']);
const sleeper = new Int32Array(new SharedArrayBuffer(4));

/** Keep the original atomic operation: never unlink/copy over the destination.
 * The legacy save contract is synchronous; total extra blocking is at most
 * 770ms, only for Windows sharing/access errors. All other failures stop once.
 * Dependencies below are host/test-only and never accepted from renderer IPC.
 */
function replaceFile(
  source,
  destination,
  {
    platform = process.platform,
    rename = fs.renameSync,
    wait = (milliseconds) => Atomics.wait(sleeper, 0, 0, milliseconds),
  } = {},
) {
  let attempts = 0;
  for (;;) {
    try {
      attempts++;
      rename(source, destination);
      return { attempts };
    } catch (error) {
      if (
        platform !== 'win32' ||
        !TRANSIENT_WINDOWS.has(error.code) ||
        attempts > RETRY_DELAYS.length
      ) {
        error.atomicAttempts = attempts;
        throw error;
      }
      wait(RETRY_DELAYS[attempts - 1]);
    }
  }
}

module.exports = { replaceFile };
