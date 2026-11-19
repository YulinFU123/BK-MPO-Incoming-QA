'use strict';

// The caller supplies an already unlocked snapshot. This adapter never opens a
// vault, rewrites a record, infers a timezone, or reads a file.
const { PlatformError } = require('../../domain/errors');
const { strictISODate, exactText } = require('../../domain/validation');

const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const unsafe = new Set(['__proto__', 'constructor', 'prototype']);
const maxRows = 100000;
const maxErrors = 50;

function isRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function fail(code, message, field) {
  throw new PlatformError(code, message, field ? { field } : {});
}

function fieldId(value, columns, field) {
  const id = exactText(value, { field });
  if (!id) return '';
  if (unsafe.has(id) || !columns.has(id)) {
    fail('LEGACY_MAPPING_INVALID', '映射必须引用当前表头中存在的字段。', field);
  }
  return id;
}

function mappedDate(value) {
  const text = exactText(value, { field: 'observedOn', required: true });
  const slash = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(text);
  const iso = slash
    ? `${slash[1]}-${slash[2].padStart(2, '0')}-${slash[3].padStart(2, '0')}`
    : text;
  return strictISODate(iso, 'observedOn');
}

function mappingFor(template, overrides) {
  if (!Array.isArray(template.columns) || !template.columns.length) {
    fail('LEGACY_TEMPLATE_INVALID', '历史表头缺少字段定义。');
  }
  const columns = new Set();
  for (const column of template.columns) {
    if (!isRecord(column)) fail('LEGACY_TEMPLATE_INVALID', '历史字段定义无效。');
    const id = exactText(column.id, { field: 'columnId', required: true });
    if (unsafe.has(id) || columns.has(id)) fail('LEGACY_TEMPLATE_INVALID', '历史字段标识重复或无效。');
    columns.add(id);
  }
  const saved = template.analysis === undefined ? {} : template.analysis;
  if (!isRecord(saved) || !isRecord(overrides)) fail('LEGACY_MAPPING_INVALID', '历史统计映射格式无效。');
  const allowed = new Set(['date', 'issue', 'code', 'serialNumber', 'dimensions']);
  for (const key of Object.keys(overrides)) {
    if (!allowed.has(key)) fail('LEGACY_MAPPING_INVALID', '包含不支持的映射选项。');
  }
  const select = key => fieldId(own(overrides, key) ? overrides[key] : saved[key], columns, key);
  const dimensions = Object.create(null);
  const group = fieldId(saved.group, columns, 'group');
  // A legacy group can represent an area, process, or any custom field.
  // Preserve that ambiguity as "group"; never silently rename it "process".
  if (group) dimensions.group = group;
  const explicitDimensions = own(overrides, 'dimensions') ? overrides.dimensions : {};
  if (!isRecord(explicitDimensions)) fail('LEGACY_MAPPING_INVALID', '维度映射格式无效。');
  for (const [key, value] of Object.entries(explicitDimensions)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key) || unsafe.has(key)) {
      fail('LEGACY_MAPPING_INVALID', '维度名称必须为安全、稳定的字段标识。');
    }
    const target = fieldId(value, columns, 'dimension');
    if (target) dimensions[key] = target;
    else delete dimensions[key];
  }
  return {
    date: select('date'), issue: select('issue'), code: select('code'),
    serialNumber: fieldId(own(overrides, 'serialNumber') ? overrides.serialNumber : columns.has('sn') ? 'sn' : '', columns, 'serialNumber'),
    dimensions
  };
}

/**
 * Convert a supplied version-1 snapshot to analysis observations, without mutation.
 * Structural/configuration failures throw. Individual bad records are rejected
 * with a bounded, sanitized error list. stats.errorCount includes omitted errors.
 * An unmapped discovery date requires createdLocalDate; createdAt is not used.
 */
function adaptLegacyState(state, { mappings = {} } = {}) {
  if (!isRecord(state) || state.version !== 1 || !Array.isArray(state.templates) ||
      !state.templates.length || !Array.isArray(state.records)) {
    fail('LEGACY_STATE_INVALID', '需要包含表头与记录的版本 1 历史快照。');
  }
  if (state.records.length > maxRows) fail('LEGACY_ROW_LIMIT', '历史快照超过单次处理上限。');
  if (!isRecord(mappings)) fail('LEGACY_MAPPING_INVALID', '映射集合格式无效。');
  const templates = new Map();
  for (const template of state.templates) {
    if (!isRecord(template)) fail('LEGACY_TEMPLATE_INVALID', '历史表头格式无效。');
    const id = exactText(template.id, { field: 'templateId', required: true });
    if (unsafe.has(id) || templates.has(id)) fail('LEGACY_TEMPLATE_DUPLICATE', '历史表头标识重复或无效。');
    templates.set(id, mappingFor(template, own(mappings, id) ? mappings[id] : {}));
  }
  for (const id of Object.keys(mappings)) {
    if (!templates.has(id)) fail('LEGACY_MAPPING_INVALID', '映射引用了不存在的历史表头。');
  }
  const occurrences = new Map();
  for (const record of state.records) {
    if (isRecord(record) && typeof record.id === 'string') {
      const id = record.id.trim();
      occurrences.set(id, (occurrences.get(id) || 0) + 1);
    }
  }
  const observations = [];
  const errors = [];
  let rejected = 0;
  for (const [index, record] of state.records.entries()) {
    let field = 'record';
    try {
      if (!isRecord(record) || !isRecord(record.values)) fail('LEGACY_RECORD_INVALID', '历史记录格式无效。');
      field = 'recordId';
      const id = exactText(record.id, { field, required: true });
      if (occurrences.get(id) !== 1) fail('LEGACY_RECORD_DUPLICATE', '历史记录标识重复。', field);
      field = 'templateId';
      const templateId = exactText(record.templateId, { field, required: true });
      const map = templates.get(templateId);
      if (!map) fail('LEGACY_TEMPLATE_MISSING', '历史记录引用的表头不存在。', field);
      const value = key => key && own(record.values, key) ? record.values[key] : undefined;
      field = 'observedOn';
      const observedOn = mappedDate(map.date ? value(map.date) : record.createdLocalDate);
      field = 'serialNumber';
      const serialNumber = exactText(value(map.serialNumber), { field });
      field = 'relatedCode';
      const relatedCode = exactText(value(map.code), { field });
      field = 'issue';
      const issue = exactText(value(map.issue), { field });
      const dimensions = {};
      for (const [key, sourceField] of Object.entries(map.dimensions)) {
        field = `dimensions.${key}`;
        dimensions[key] = exactText(value(sourceField), { field });
      }
      observations.push({
        id, templateId, observedOn, serialNumber, issue, relatedCode, dimensions,
        source: {
          system: 'legacy-state-v1', recordId: id, templateId,
          dateBasis: map.date ? 'mapped-discovery-date' : 'created-local-date',
          dateField: map.date || 'createdLocalDate'
        }
      });
    } catch (error) {
      rejected += 1;
      if (errors.length < maxErrors) {
        errors.push({
          rowNumber: index + 1, field,
          code: error instanceof PlatformError ? error.code : 'LEGACY_RECORD_INVALID',
          message: '此历史记录未转换，请检查对应字段和映射。'
        });
      }
    }
  }
  return {
    observations, errors,
    stats: {
      total: state.records.length, accepted: observations.length, rejected,
      errorCount: rejected, errorsTruncated: rejected > errors.length
    }
  };
}

module.exports = { adaptLegacyState };
