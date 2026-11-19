'use strict';
const { effectivePreference, choose } = require('../domain/home-source');
const { PlatformError } = require('../domain/errors');
function createHomeOverview({ readRecords, readBI, session, workspaceMode = () => 'auto' }) {
  return async (input) => {
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).some(
        (k) => !['query', 'preference', 'allDates', 'exportRows', 'biFilter', 'biRange', 'biPeriod'].includes(k),
      ) ||
      (input.exportRows !== undefined && typeof input.exportRows !== 'boolean') ||
      (input.allDates !== undefined && typeof input.allDates !== 'boolean')
    )
      throw new PlatformError('INVALID_QUERY', '首页数据范围无效。');
    if (
      input.biFilter &&
      (typeof input.biFilter !== 'object' ||
        Array.isArray(input.biFilter) ||
        Object.keys(input.biFilter).some((k) => !['field', 'value'].includes(k)) ||
        !['process', 'issue', 'shift', 'employee'].includes(input.biFilter.field) ||
        typeof input.biFilter.value !== 'string' ||
        input.biFilter.value.length > 512)
    )
      throw new PlatformError('INVALID_QUERY', 'BI明细筛选无效。');
    if (input.biRange !== undefined && (
      !input.biRange || typeof input.biRange !== 'object' ||
      Object.keys(input.biRange).some((k) => !['start', 'end'].includes(k)) ||
      ![input.biRange.start, input.biRange.end].every((v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) ||
      input.biRange.start > input.biRange.end
    )) throw new PlatformError('INVALID_QUERY', 'BI明细日期范围无效。');
    if (input.biPeriod !== undefined && (input.biPeriod !== 'previous' || !input.biRange))
      throw new PlatformError('INVALID_QUERY', 'BI对比周期无效。');
    const preference = effectivePreference(input.preference, workspaceMode()),
      before = session();
    const checked = () => {
      if (session() !== before)
        throw new PlatformError('SESSION_CHANGED', '工作区已变化，请重新查询。');
    };
    let query = structuredClone(input.query),
      records = await readRecords(query);
    checked();
    let bi = { state: 'not-requested' };
    if (preference.mode !== 'records') {
      try {
        bi = await readBI({
          query,
          preference,
          allDates: !!input.allDates,
          exportRows: !!input.exportRows,
          biFilter: input.biFilter || null,
          ...(input.biRange ? { biRange: input.biRange } : {}),
          ...(input.biPeriod ? { biPeriod: input.biPeriod } : {}),
        });
      } catch (error) {
        checked();
        bi = {
          state: 'error',
          message: String(error.message).includes('首页明细导出最多25000行')
            ? '首页明细导出最多25000行，请缩小范围或使用原BI完整报表导出。'
            : 'BI读取未完成，未当作零。请进入BI核对来源后刷新。',
        };
      }
      checked();
      if (
        input.allDates &&
        bi.range &&
        (bi.range.start < query.start || bi.range.end > query.end)
      ) {
        query = {
          ...query,
          start: bi.range.start < query.start ? bi.range.start : query.start,
          end: bi.range.end > query.end ? bi.range.end : query.end,
        };
        records = await readRecords(query);
        checked();
      }
    }
    return {
      ...records,
      primary: choose(records, bi, preference),
      biSource: bi,
      sourcePreferences: preference,
    };
  };
}
module.exports = { createHomeOverview };
