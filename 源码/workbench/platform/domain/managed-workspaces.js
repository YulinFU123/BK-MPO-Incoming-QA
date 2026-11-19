'use strict';
const { PlatformError } = require('./errors');
const { dateRange } = require('./validation');
const query = require('./workspace-query');
const colors = ['blue', 'green', 'coral', 'purple', 'cyan'];
const text = (v, max) => typeof v === 'string' && v.length <= max && !/[\x00-\x1f]/.test(v);
function metadata(input) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some(
      (k) =>
        !['name', 'process', 'description', 'color', 'favorite', 'archived', 'analysis'].includes(
          k,
        ),
    )
  )
    throw new PlatformError('WORKSPACE_INVALID', '工作区设置无效。');
  const v = {
    name: '',
    process: '',
    description: '',
    color: 'blue',
    favorite: false,
    archived: false,
    analysis: { range: '30', grain: 'week', datasetId: '' },
    ...input,
  };
  try {
    v.analysis = query.normalize(v.analysis);
  } catch {
    throw new PlatformError('WORKSPACE_INVALID', '请检查日期、周期和排序设置。');
  }
  if (
    !text(v.name, 48) ||
    !v.name.trim() ||
    !text(v.process, 32) ||
    !text(v.description, 240) ||
    !colors.includes(v.color) ||
    typeof v.favorite !== 'boolean' ||
    typeof v.archived !== 'boolean' ||
    !v.analysis ||
    Object.keys(v.analysis).some(
      (k) => !['range', 'grain', 'datasetId', 'start', 'end', 'sort'].includes(k),
    ) ||
    !query.ranges.includes(v.analysis.range) ||
    !['day', 'week', 'month'].includes(v.analysis.grain) ||
    !text(v.analysis.datasetId, 128) ||
    !text(v.analysis.start, 10) ||
    !text(v.analysis.end, 10)
  )
    throw new PlatformError('WORKSPACE_INVALID', '请检查名称、工序及分析设置。');
  if (v.analysis.range === 'custom') dateRange(v.analysis.start, v.analysis.end);
  return { ...structuredClone(v), name: v.name.trim(), process: v.process.trim() };
}
function emptyState(name, process = '') {
  const field = (id, label, type = 'text', extra = {}) => ({
    id,
    label,
    type,
    auto: 'none',
    required: false,
    keep: false,
    options: '',
    width: 140,
    ...extra,
  });
  return {
    version: 1,
    prefix: name,
    datePattern: 'compact',
    activeTemplateId: 'general',
    templates: [
      {
        id: 'general',
        name,
        titlePrefix: name,
        analysis: { date: 'found_date', issue: 'issue', code: 'code', group: 'process' },
        columns: [
          field('no', '序号', 'number', { auto: 'sequence', width: 70 }),
          field('found_date', '发现日期', 'date', { auto: 'today', required: true }),
          field('sn', 'SN', 'text', { required: true, unique: true, width: 210 }),
          field('process', '工序', 'choice', { options: process, default: process, keep: true }),
          field('issue', '异常现象', 'choice', { required: true, width: 240, formSpan: 2 }),
          field('code', '关联编号'),
          field('area', '区域', 'choice'),
          field('reporter', '报检人', 'choice'),
          field('shift', '报检班别', 'choice', { options: '白班,夜班' }),
        ],
      },
    ],
    records: [],
  };
}
module.exports = { metadata, emptyState, colors };
