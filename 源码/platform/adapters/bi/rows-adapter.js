'use strict';

// This adapter accepts explicitly mapped rows. It does not access a company BI page.
const { PlatformError } = require('../../domain/errors');
const { exactText, strictISODate, nonNegativeInteger } = require('../../domain/validation');
const { canonicalJSON, sha256, scopeKey } = require('../../domain/identity');

const MEASURES = Object.freeze(['inspectedUnits', 'defectiveUnits', 'productionUnits', 'defectEvents']);
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_ROWS = 10000;
const MAX_ERRORS = 50;
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function fail(code, message, field) {
  throw new PlatformError(code, message, field ? { field } : {});
}

function assertObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('INVALID_OBJECT', '需要字段对象。', field);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail('UNSAFE_OBJECT', '字段对象必须是普通对象。', field);
  }
  for (const key of Object.keys(value)) {
    if (UNSAFE_KEYS.has(key)) fail('UNSAFE_KEY', '不支持此字段名称。', field);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !own(descriptor, 'value')) fail('UNSAFE_OBJECT', '字段对象不能包含读取或写入函数。', field);
  }
}

function identifier(value, field) {
  const text = exactText(value, { field, required: true });
  if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(text) || UNSAFE_KEYS.has(text)) {
    fail('INVALID_IDENTIFIER', '内部字段名应以英文开头，并仅含英文、数字和下划线。', field);
  }
  return text;
}

function boundedText(value, field, { required = true, max = 256 } = {}) {
  const text = exactText(value, { field, required });
  if (text.length > max) fail('TEXT_TOO_LONG', '字段文本过长。', field);
  return text;
}

function normalizeDataset(spec) {
  assertObject(spec, 'dataset');
  const id = identifier(spec.id, 'dataset.id');
  const version = boundedText(spec.version, 'dataset.version', { max: 64 });
  const label = own(spec, 'label') ? boundedText(spec.label, 'dataset.label') : id;
  if (spec.unit !== 'piece') fail('UNSUPPORTED_UNIT', '当前开发版只支持按件统计。', 'dataset.unit');
  if (!Array.isArray(spec.grainFields) || spec.grainFields.length > 16) {
    fail('INVALID_GRAIN', '统计粒度必须是最多 16 项的字段数组。', 'dataset.grainFields');
  }
  const grainFields = spec.grainFields.map(value => identifier(value, 'dataset.grainFields'));
  if (new Set(grainFields).size !== grainFields.length) {
    fail('INVALID_GRAIN', '统计粒度字段不能重复。', 'dataset.grainFields');
  }
  return { id, label, version, grainFields, unit: 'piece' };
}

function normalizeMapping(mapping, dataset) {
  assertObject(mapping, 'mapping');
  const allowed = new Set(['dateColumn', 'dateFormat', 'dimensions', 'measures']);
  if (Object.keys(mapping).some(key => !allowed.has(key))) {
    fail('UNKNOWN_MAPPING', '映射含有未支持的设置。', 'mapping');
  }
  const dateColumn = boundedText(mapping.dateColumn, 'mapping.dateColumn');
  if (UNSAFE_KEYS.has(dateColumn)) fail('UNSAFE_KEY', '不支持此来源列名。', 'mapping.dateColumn');
  if (!['iso', 'ymd-slash'].includes(mapping.dateFormat)) {
    fail('DATE_FORMAT_REQUIRED', '请明确指定 ISO 或年/月/日日期格式。', 'mapping.dateFormat');
  }
  assertObject(mapping.dimensions, 'mapping.dimensions');
  assertObject(mapping.measures, 'mapping.measures');
  if (Object.keys(mapping.dimensions).length > 32) fail('TOO_MANY_DIMENSIONS', '维度字段不能超过 32 项。', 'mapping.dimensions');
  const dimensions = Object.create(null);
  const measures = Object.create(null);
  const sourceColumns = new Set([dateColumn]);
  const addColumn = (column, field) => {
    const name = boundedText(column, field);
    if (UNSAFE_KEYS.has(name)) fail('UNSAFE_KEY', '不支持此来源列名。', field);
    if (sourceColumns.has(name)) fail('REUSED_COLUMN', '同一来源列不能重复用于多个字段。', field);
    sourceColumns.add(name);
    return name;
  };
  for (const [key, column] of Object.entries(mapping.dimensions)) {
    identifier(key, 'mapping.dimensions');
    dimensions[key] = addColumn(column, 'mapping.dimensions');
  }
  for (const field of dataset.grainFields) {
    if (!own(dimensions, field)) fail('MISSING_GRAIN_MAPPING', '统计粒度字段尚未配置来源列。', field);
  }
  for (const [key, column] of Object.entries(mapping.measures)) {
    if (!MEASURES.includes(key)) fail('UNKNOWN_MEASURE', '存在未支持的数量指标。', 'mapping.measures');
    measures[key] = addColumn(column, 'mapping.measures');
  }
  if (!Object.keys(measures).length) fail('MISSING_MEASURE_MAPPING', '至少配置一项数量指标。', 'mapping.measures');
  return { dateColumn, dateFormat: mapping.dateFormat, dimensions, measures };
}

function readDate(value, format) {
  const text = boundedText(value, 'businessDate', { max: 10 });
  if (format === 'iso') return strictISODate(text, 'businessDate');
  const match = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(text);
  if (!match) fail('INVALID_DATE', '日期不符合已指定的年/月/日格式。', 'businessDate');
  return strictISODate(`${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`, 'businessDate');
}

function previewBiRows({ rows, dataset: spec, mapping: rawMapping, source = {} }) {
  const dataset = normalizeDataset(spec);
  const mapping = normalizeMapping(rawMapping, dataset);
  assertObject(source, 'source');
  const batchId = boundedText(source.batchId, 'source.batchId', { max: 128 });
  const rowOffset = source.rowOffset === undefined ? 2 : source.rowOffset;
  if (!Number.isSafeInteger(rowOffset) || rowOffset < 1 || rowOffset > 1048576) {
    fail('INVALID_ROW_OFFSET', '起始行号无效。', 'source.rowOffset');
  }
  if (!Array.isArray(rows) || rows.length > MAX_ROWS) {
    fail('ROW_LIMIT', '每次应提供最多 10000 行数据。', 'rows');
  }
  if (rows.length === 0) fail('EMPTY_ROWS', '没有可预览的数据。', 'rows');
  if (rowOffset + rows.length - 1 > 1048576) fail('INVALID_ROW_OFFSET', '数据行号超出工作表范围。', 'source.rowOffset');
  const rowNumbers = source.rowNumbers;
  if (rowNumbers !== undefined && (!Array.isArray(rowNumbers) || rowNumbers.length !== rows.length ||
      rowNumbers.some((number, index) => !Number.isSafeInteger(number) || number < rowOffset || number > 1048576 ||
        (index > 0 && number <= rowNumbers[index - 1])))) {
    fail('INVALID_ROW_NUMBERS', '来源行号必须与数据逐行对应并保持递增。', 'source.rowNumbers');
  }
  const facts = [];
  const errors = [];
  const seen = new Set();
  let errorCount = 0;
  rows.forEach((row, index) => {
    const rowNumber = rowNumbers ? rowNumbers[index] : rowOffset + index;
    let field = 'row';
    try {
      assertObject(row, field);
      field = 'businessDate';
      const businessDate = readDate(own(row, mapping.dateColumn) ? row[mapping.dateColumn] : undefined, mapping.dateFormat);
      const dimensions = Object.create(null);
      for (const [key, column] of Object.entries(mapping.dimensions)) {
        field = key;
        dimensions[key] = boundedText(own(row, column) ? row[column] : undefined, key, {
          required: dataset.grainFields.includes(key), max: 1024
        });
      }
      const measures = {};
      for (const key of MEASURES) {
        field = key;
        const column = mapping.measures[key];
        measures[key] = nonNegativeInteger(column && own(row, column) ? row[column] : undefined, { field: key, nullable: true });
      }
      if (Object.values(measures).every(value => value === null)) fail('MISSING_MEASURES', '本行没有有效数量指标。', 'measures');
      if (measures.defectiveUnits !== null && measures.inspectedUnits !== null && measures.defectiveUnits > measures.inspectedUnits) {
        fail('NUMERATOR_EXCEEDS_DENOMINATOR', '不良件数不能大于检验件数。', 'defectiveUnits');
      }
      const fact = {
        id: sha256(canonicalJSON({ batchId, rowNumber })),
        datasetId: dataset.id,
        businessDate,
        grainFields: [...dataset.grainFields],
        dimensions: { ...dimensions },
        unit: dataset.unit,
        measures,
        source: { batchId, rowNumber }
      };
      field = 'grain';
      const key = scopeKey(fact);
      if (seen.has(key)) fail('DUPLICATE_GRAIN', '本次数据包含同日、同粒度的重复统计行。', field);
      seen.add(key);
      facts.push(fact);
    } catch (error) {
      if (!(error instanceof PlatformError)) throw error;
      errorCount++;
      if (errors.length < MAX_ERRORS) {
        // Never copy arbitrary exception messages or cell values into preview errors.
        errors.push({ rowNumber, field, code: error.code || 'INVALID_ROW', message: '本行校验未通过，请检查对应字段。' });
      }
    }
  });
  return {
    dataset,
    facts,
    errors,
    stats: { rowCount: rows.length, validRowCount: facts.length, errorCount, truncatedErrors: errorCount > errors.length },
    mappingFingerprint: sha256(canonicalJSON({ dataset, mapping }))
  };
}

module.exports = { normalizeDataset, previewBiRows };
