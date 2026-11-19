'use strict';
const { PlatformError } = require('../domain/errors');

/** Reject executable/accessor payloads before cloning, hashing or serialization. */
function assertJSONData(value) {
  const seen = new Set();
  let nodes = 0;
  let textSize = 0;
  function visit(item, depth) {
    if (++nodes > 250000 || depth > 16) throw new PlatformError('PAYLOAD_TOO_COMPLEX', '数据结构超过限制。');
    if (typeof item === 'string') {
      textSize += item.length;
      if (textSize > 8 * 1024 * 1024) throw new PlatformError('PAYLOAD_TOO_LARGE', '数据超过大小限制。');
      return;
    }
    if (item === null || typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item))) return;
    if (typeof item !== 'object' || seen.has(item)) throw new PlatformError('INVALID_PAYLOAD', '需要不含循环引用的普通 JSON 数据。');
    const proto = Object.getPrototypeOf(item);
    if ((!Array.isArray(item) && proto !== Object.prototype && proto !== null) || (Array.isArray(item) && proto !== Array.prototype)) throw new PlatformError('INVALID_PAYLOAD', '数据包含不支持的对象。');
    const keys = Reflect.ownKeys(item);
    if (keys.some(key => typeof key !== 'string')) throw new PlatformError('INVALID_PAYLOAD', '数据字段名无效。');
    if (Array.isArray(item) && (keys.length !== item.length + 1 || keys.some(key => key !== 'length' &&
        (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= item.length)))) throw new PlatformError('INVALID_PAYLOAD', '数组必须连续且不含额外字段。');
    seen.add(item);
    for (const key of keys) {
      if (Array.isArray(item) && key === 'length') continue;
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new PlatformError('UNSAFE_KEY', '数据字段名无效。');
      textSize += key.length;
      if (textSize > 8 * 1024 * 1024) throw new PlatformError('PAYLOAD_TOO_LARGE', '数据超过大小限制。');
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new PlatformError('INVALID_PAYLOAD', '数据不能包含访问器。');
      visit(descriptor.value, depth + 1);
    }
    seen.delete(item);
  }
  visit(value, 0);
  return value;
}

module.exports = { assertJSONData };
