'use strict';

const { PlatformError } = require('./errors');
const DAY = 86_400_000;

function invalid(code, message, field) {
  throw new PlatformError(code, message, { field });
}

function strictISODate(value, field = 'date') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    invalid('INVALID_DATE', '日期必须为 YYYY-MM-DD。', field);
  }
  const time = Date.parse(`${value}T00:00:00.000Z`);
  if (value.slice(0, 4) === '0000' || !Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) {
    invalid('INVALID_DATE', '日期不存在。', field);
  }
  return value;
}

function shiftISODate(iso, days) {
  strictISODate(iso);
  if (!Number.isSafeInteger(days)) invalid('INVALID_DAY_SHIFT', '日期偏移必须为整数。', 'days');
  const time = Date.parse(`${iso}T00:00:00.000Z`) + days * DAY;
  const date = new Date(time);
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) {
    invalid('INVALID_DATE', '日期偏移超出支持范围。', 'days');
  }
  return date.toISOString().slice(0, 10);
}

function dateRange(start, end, { maxDays = 3660 } = {}) {
  strictISODate(start, 'start');
  strictISODate(end, 'end');
  if (!Number.isSafeInteger(maxDays) || maxDays < 1) invalid('INVALID_RANGE_LIMIT', '日期范围限制无效。', 'maxDays');
  const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY) + 1;
  if (days < 1 || days > maxDays) invalid('INVALID_DATE_RANGE', '日期范围倒置或超过上限。', 'range');
  return { start, end, days, dates: Array.from({ length: days }, (_, index) => shiftISODate(start, index)) };
}

function exactText(value, { field = 'text', required = false } = {}) {
  if (value === null || value === undefined) {
    if (required) invalid('REQUIRED_TEXT', '请提供文本字段。', field);
    return '';
  }
  if (typeof value !== 'string') invalid('INVALID_TEXT', '标识字段必须以文本提供，避免丢失前导零或精度。', field);
  const text = value.trim();
  if (required && !text) invalid('REQUIRED_TEXT', '请提供文本字段。', field);
  return text;
}

function nonNegativeInteger(value, { field = 'quantity', nullable = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (nullable) return null;
    invalid('REQUIRED_QUANTITY', '请提供数量。', field);
  }
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d+$/.test(value.trim()))) {
    invalid('INVALID_QUANTITY', '数量必须为非负整数。', field);
  }
  const number = typeof value === 'string' ? Number(value.trim()) : value;
  if (!Number.isSafeInteger(number) || number < 0) invalid('INVALID_QUANTITY', '数量必须为安全范围内的非负整数。', field);
  return number;
}

module.exports = { strictISODate, shiftISODate, dateRange, exactText, nonNegativeInteger };
