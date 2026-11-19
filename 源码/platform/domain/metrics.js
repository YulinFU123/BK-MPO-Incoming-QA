'use strict';

const { dateRange, strictISODate } = require('./validation');
const { canonicalJSON, scopeKey } = require('./identity');
const { PlatformError } = require('./errors');
const MEASURES = ['inspectedUnits', 'defectiveUnits', 'productionUnits', 'defectEvents'];
const OWN = (object, key) => Object.hasOwn(object || {}, key);

function validFilters(filters) {
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) throw new PlatformError('INVALID_FILTERS', '筛选条件必须为对象。');
  for (const [field, value] of Object.entries(filters)) {
    if (['__proto__', 'constructor', 'prototype'].includes(field) || typeof value !== 'string') {
      throw new PlatformError('INVALID_FILTERS', '筛选值必须为文本。', { field });
    }
  }
}

function matches(item, filters, fields = []) {
  return Object.entries(filters).every(([field, value]) => fields.includes(field)
    ? item[field] === value
    : OWN(item.dimensions, field) && item.dimensions[field] === value);
}

function observationStats(items) {
  const serials = new Set(items.filter(item => item.serialNumber).map(item => item.serialNumber));
  return { recordCount: items.length, uniqueSerialCount: serials.size, missingSerialCount: items.filter(item => !item.serialNumber).length };
}

function groupByDate(items, field) {
  const groups = new Map();
  for (const item of items) {
    const date = item[field];
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date).push(item);
  }
  return groups;
}

function summarizeObservations(observations, { start, end, filters = {} }) {
  const range = dateRange(start, end);
  validFilters(filters);
  const selected = observations.filter(item => {
    strictISODate(item.observedOn, 'observedOn');
    return item.observedOn >= start && item.observedOn <= end && matches(item, filters, ['templateId', 'serialNumber', 'issue', 'relatedCode']);
  });
  const issues = new Map();
  for (const item of selected) issues.set(item.issue || '', (issues.get(item.issue || '') || 0) + 1);
  const byDate = groupByDate(selected, 'observedOn');
  return {
    scope: { start, end, filters: structuredClone(filters), dateBasis: 'observedOn' },
    ...observationStats(selected),
    issues: [...issues].map(([issue, count]) => ({ issue, count })).sort((a, b) => b.count - a.count || a.issue.localeCompare(b.issue)),
    trend: range.dates.map(date => ({ date, ...observationStats(byDate.get(date) || []) }))
  };
}

function qualityStats(items, initialReasons = []) {
  const reasons = new Set(initialReasons);
  if (!items.length) reasons.add('NO_FACTS');
  const units = new Set(items.map(item => item.unit));
  if (units.size > 1) reasons.add('MIXED_UNITS');
  if ([...units].some(unit => unit !== 'piece')) reasons.add('UNSUPPORTED_UNIT');
  const grains = new Set(items.map(item => canonicalJSON([...item.grainFields].sort())));
  if (grains.size > 1) reasons.add('MIXED_GRAINS');
  const keys = new Set();
  for (const item of items) {
    const key = scopeKey(item);
    if (keys.has(key)) reasons.add('DUPLICATE_GRAIN');
    keys.add(key);
    for (const name of MEASURES) {
      const value = item.measures?.[name];
      if (value !== undefined && value !== null && (!Number.isSafeInteger(value) || value < 0)) reasons.add('INVALID_MEASURE');
    }
    const numerator = item.measures?.defectiveUnits;
    const denominator = item.measures?.inspectedUnits;
    if (numerator === undefined || numerator === null) reasons.add('MISSING_NUMERATOR');
    if (denominator === undefined || denominator === null) reasons.add('MISSING_DENOMINATOR');
    if (denominator === 0) reasons.add('ZERO_DENOMINATOR');
    if (Number.isSafeInteger(numerator) && Number.isSafeInteger(denominator) && numerator > denominator) reasons.add('NUMERATOR_EXCEEDS_DENOMINATOR');
  }
  const totals = {};
  const incompatible = ['MIXED_UNITS', 'UNSUPPORTED_UNIT', 'MIXED_GRAINS', 'DUPLICATE_GRAIN', 'UNSUPPORTED_FILTER'].some(reason => reasons.has(reason));
  for (const name of MEASURES) {
    const complete = items.length > 0 && items.every(item => Number.isSafeInteger(item.measures?.[name]) && item.measures[name] >= 0);
    const total = complete ? items.reduce((sum, item) => sum + item.measures[name], 0) : null;
    if (total !== null && !Number.isSafeInteger(total)) reasons.add('TOTAL_OVERFLOW');
    totals[name] = incompatible || total === null || !Number.isSafeInteger(total) ? null : total;
  }
  const available = reasons.size === 0;
  return {
    factCount: items.length,
    totals,
    rate: {
      status: available ? 'available' : 'unavailable',
      value: available ? totals.defectiveUnits / totals.inspectedUnits : null,
      numerator: totals.defectiveUnits,
      denominator: totals.inspectedUnits,
      reasons: [...reasons].sort()
    }
  };
}

function summarizeQualityFacts(facts, { start, end, filters = {}, datasetId }) {
  const range = dateRange(start, end);
  validFilters(filters);
  if (typeof datasetId !== 'string' || !datasetId.trim()) throw new PlatformError('DATASET_REQUIRED', '请明确选择一个 BI 数据集。');
  const candidates = facts.filter(item => {
    strictISODate(item.businessDate, 'businessDate');
    return item.datasetId === datasetId && item.businessDate >= start && item.businessDate <= end;
  });
  const unsupported = Object.keys(filters).some(field => candidates.length === 0 || candidates.some(item => !item.grainFields.includes(field) || !OWN(item.dimensions, field)));
  const selected = candidates.filter(item => matches(item, filters));
  const reasons = unsupported ? ['UNSUPPORTED_FILTER'] : [];
  const byDate = groupByDate(selected, 'businessDate');
  return {
    scope: { datasetId, start, end, filters: structuredClone(filters), dateBasis: 'businessDate' },
    ...qualityStats(selected, reasons),
    trend: range.dates.map(date => ({ date, ...qualityStats(byDate.get(date) || [], reasons) }))
  };
}

module.exports = { summarizeObservations, summarizeQualityFacts };
