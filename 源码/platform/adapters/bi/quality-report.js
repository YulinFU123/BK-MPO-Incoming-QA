'use strict';
function biQualityReport(result, { start, end }) {
  if (!result || result.ok === false) throw Error('BI核对未完成。');
  const periods = result.periods || [];
  const gaps = periods.filter((row) => row.source_days < row.calendar_days);
  const badDates = Number.isSafeInteger(result.bad_dates) ? result.bad_dates : 0;
  return {
    source: 'bi',
    scope: { start, end },
    empty: !!result.empty,
    checked: { records: result.summary?.records || 0, sourceRows: result.source?.rows || 0 },
    checks: [
      {
        id: 'bi-gaps',
        source: 'bi',
        title: 'BI来源未覆盖的日期',
        count: gaps.length,
        severity: gaps.length ? 'notice' : 'ok',
        explanation: '按原BI全局规则核对选定日期；无来源不等于零不良。',
        samples: gaps.slice(0, 20).map((row) => ({ date: row.start, message: row.status })),
        samplesTruncated: gaps.length > 20,
        action: 'bi-trends',
      },
      {
        id: 'bi-bad-dates',
        source: 'bi',
        title: 'BI历史无效日期记录',
        count: badDates,
        severity: badDates ? 'warning' : 'ok',
        explanation:
          '原BI引擎返回的全历史排除条数，不限所选日期。引擎未返回问题行位置，需到BI数据与字段核对原表。',
        samples: [],
        samplesTruncated: badDates > 0,
        action: 'bi-data',
      },
    ],
    note: result.empty
      ? result.message || 'BI历史没有可分析数据，未完成日期覆盖核对。'
      : '沿用已保存BI全局规则；不套用检验数据维度筛选。数量有效性沿用原BI引擎，拒绝时显示检查失败，不记为通过。',
  };
}
module.exports = { biQualityReport };
