'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { PlatformError } = require('../../domain/errors');
const { strictISODate } = require('../../domain/validation');
const { adaptLegacyState } = require('./state-adapter');

function legacyRoot() {
  const base = path.resolve(__dirname, '../../..');
  const candidates = [base, path.join(base, 'legacy')];
  const found = candidates.find(
    (directory) =>
      fs.existsSync(path.join(directory, 'vault.js')) &&
      fs.existsSync(path.join(directory, 'renderer.js')),
  );
  if (!found)
    throw new PlatformError(
      'LEGACY_SOURCE_MISSING',
      '完整录入模块未随包提供，请重新解压完整软件包。',
    );
  return found;
}

/** Validate the complete v1 document, retaining all business/config/history fields. */
function validateFullLegacyState(state) {
  const { validState } = require(path.join(legacyRoot(), 'vault'));
  let count = 0,
    chars = 0;
  const seen = new Set();
  function visit(value, depth) {
    if (++count > 2000000 || depth > 40)
      throw new PlatformError('LEGACY_STATE_LIMIT', '异常记录数据超过开发版容量限制。');
    if (
      value === null ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))
    )
      return;
    if (typeof value === 'string') {
      chars += value.length;
      if (chars > 32 * 1024 * 1024)
        throw new PlatformError('LEGACY_STATE_LIMIT', '异常记录数据超过开发版容量限制。');
      return;
    }
    if (typeof value !== 'object' || seen.has(value))
      throw new PlatformError('LEGACY_STATE_INVALID', '异常记录数据必须是完整 JSON。');
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null && !Array.isArray(value))
      throw new PlatformError('LEGACY_STATE_INVALID', '异常记录数据类型无效。');
    const keys = Reflect.ownKeys(value);
    if (
      Array.isArray(value) &&
      (keys.length !== value.length + 1 ||
        keys.some(
          (key) =>
            key !== 'length' &&
            (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length),
        ))
    )
      throw new PlatformError('LEGACY_STATE_INVALID', '异常记录数组存在缺项。');
    seen.add(value);
    for (const key of keys) {
      if (Array.isArray(value) && key === 'length') continue;
      if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key))
        throw new PlatformError('LEGACY_STATE_INVALID', '异常记录字段无效。');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value'))
        throw new PlatformError('LEGACY_STATE_INVALID', '异常记录不能包含访问器。');
      chars += key.length;
      if (chars > 32 * 1024 * 1024)
        throw new PlatformError('LEGACY_STATE_LIMIT', '异常记录数据超过开发版容量限制。');
      visit(descriptor.value, depth + 1);
    }
    seen.delete(value);
  }
  visit(state, 0);
  if (!validState(state)) throw new PlatformError('LEGACY_STATE_INVALID', '异常记录数据结构无效。');
  return state;
}

/** The same explicit date formats accepted by the original renderer. Projection only. */
function normalizeLegacyDate(value) {
  const text = String(value ?? '').trim();
  let hit =
    /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text) ||
    /^(\d{4})年(\d{1,2})月(\d{1,2})日?$/.exec(text);
  let year, month, day;
  if (hit) [, year, month, day] = hit;
  else {
    hit = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
    if (!hit) return '';
    [, month, day, year] = hit;
  }
  const iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  try {
    return strictISODate(iso);
  } catch {
    return '';
  }
}

function legacyAnalysisProjection(raw) {
  validateFullLegacyState(raw);
  const state = structuredClone(raw),
    mappings = {};
  for (const template of state.templates) {
    const columns = template.columns;
    const byLabel = (words) =>
      columns.find((column) => words.some((word) => column.label.includes(word)))?.id || '';
    const saved = template.analysis || {};
    const present = (id) => (columns.some((column) => column.id === id) ? id : '');
    const pick = (key, fallback) => (Object.hasOwn(saved, key) ? present(saved[key]) : fallback);
    template.analysis = {
      date: pick(
        'date',
        columns.find((column) => column.auto === 'today' || column.type === 'date')?.id || '',
      ),
      issue: pick('issue', byLabel(['异常现象', '问题', '不良'])),
      code: pick('code', byLabel(['底座丝印', '丝印'])),
      group: pick('group', byLabel(['工序', '区域'])),
    };
    const serial = columns.find(
      (column) => column.id === 'sn' || /^SN$/i.test(column.label.trim()),
    );
    const dimensions = {};
    for (const [key, id] of Object.entries({
      process: 'process',
      model: 'model',
      materialLot: 'lot',
      area: 'area',
    }))
      if (present(id)) dimensions[key] = id;
    mappings[template.id] = { ...(serial ? { serialNumber: serial.id } : {}), dimensions };
    for (const record of state.records.filter((item) => item.templateId === template.id)) {
      const dateId = template.analysis.date;
      if (dateId) record.values[dateId] = normalizeLegacyDate(record.values[dateId]);
      else if (!record.createdLocalDate) {
        const date = new Date(record.createdAt);
        if (Number.isFinite(date.getTime()))
          record.createdLocalDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      }
    }
  }
  return adaptLegacyState(state, { mappings });
}

async function decodeLegacyBackup(raw, password) {
  const { open } = require(path.join(legacyRoot(), 'vault'));
  let decoded;
  try {
    decoded = await open(raw, password);
    return structuredClone(validateFullLegacyState(decoded.data));
  } catch {
    throw new PlatformError(
      'LEGACY_BACKUP_AUTH_FAILED',
      '原记录数据的密码不正确，或备份格式已损坏。',
    );
  } finally {
    if (decoded?.key) decoded.key.fill(0);
    if (decoded?.salt) decoded.salt.fill(0);
  }
}

module.exports = {
  legacyRoot,
  validateFullLegacyState,
  normalizeLegacyDate,
  legacyAnalysisProjection,
  decodeLegacyBackup,
};
