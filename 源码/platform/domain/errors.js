'use strict';

/** Public error details contain codes and field names, never source row values. */
class PlatformError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PlatformError';
    this.code = code;
    this.details = structuredClone(details);
  }
}

module.exports = { PlatformError };
