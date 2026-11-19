'use strict';

const { createHash } = require('node:crypto');
const { PlatformError } = require('./errors');

function canonicalJSON(value) {
  const seen = new Set();
  function normalize(item) {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (typeof item !== 'object') throw new PlatformError('INVALID_JSON', '输入必须是完整的 JSON 数据。');
    if (seen.has(item)) throw new PlatformError('INVALID_JSON', '输入不能包含循环引用。');
    seen.add(item);
    let result;
    if (Array.isArray(item)) {
      const keys = Reflect.ownKeys(item);
      if (keys.length !== item.length + 1 || keys.some(key => typeof key !== 'string' || (key !== 'length' &&
          (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= item.length)))) throw new PlatformError('INVALID_JSON', '数组必须连续且没有额外属性。');
      result = Array.from({ length: item.length }, (_, index) => {
        const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new PlatformError('INVALID_JSON', '输入不能包含访问器。');
        return normalize(descriptor.value);
      });
    } else {
      const prototype = Object.getPrototypeOf(item);
      if (prototype !== Object.prototype && prototype !== null) throw new PlatformError('INVALID_JSON', '输入必须使用普通对象。');
      result = Object.create(null);
      for (const key of Object.keys(item).sort()) {
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new PlatformError('INVALID_JSON', '输入不能包含访问器。');
        result[key] = normalize(descriptor.value);
      }
    }
    seen.delete(item);
    return result;
  }
  return JSON.stringify(normalize(value));
}

function sha256(value) {
  if (typeof value !== 'string' && !Buffer.isBuffer(value)) throw new PlatformError('INVALID_HASH_INPUT', '校验输入必须为文本或字节。');
  return createHash('sha256').update(value).digest('hex');
}

function scopeKey(fact) {
  const fields = [...fact.grainFields].sort();
  return sha256(canonicalJSON({
    datasetId: fact.datasetId,
    businessDate: fact.businessDate,
    unit: fact.unit,
    grainFields: fields,
    dimensions: Object.fromEntries(fields.map(field => [field, fact.dimensions[field]]))
  }));
}

module.exports = { canonicalJSON, sha256, scopeKey };
