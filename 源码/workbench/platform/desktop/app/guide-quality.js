'use strict';
// Isolated example workspace; rectangles are percentages of each final PNG.
(function (root, build) {
  if (typeof module === 'object' && module.exports) module.exports = build();
  else root.GuideQuality = build();
})(globalThis, function () {
  const capture = (name, label, rect) => ({
    file: `assets/guide-quality/${name}.png`, label, rect, kind: 'capture',
  });
  return {
    'analysis-hub': [
      capture('analysis-objects', '异常记录趋势与检验数量：两类统计入口', [5.76, 13.49, 88.48, 50.32]),
      capture('analysis-open', '检验数量与不良率 · 打开', [6.72, 33.01, 86.54, 34.06]),
      capture('analysis-scope', '统计口径：数据集、当前范围、比较前期', [17.98, 30.72, 66.01, 38.6]),
    ],
    'overview': [
      capture('overview-import', '检验数量分析页的「导入检验数量」', [47.34, 20.14, 12.96, 9.86]),
      capture('overview-scope', '数据集、起止日期、快捷日期与刷新', [2.96, 28.08, 94.01, 11.69]),
      capture('overview-metrics', '不良率与前期比较、检验件数和不良件数', [1.35, 18.17, 97.22, 63.62]),
    ],
    'data-center': [
      capture('data-kind', '异常 Excel／CSV 与检验数量各有入口', [5.82, 13.13, 88.23, 50.06]),
      capture('data-rules', '异常表头与校验', [7.53, 24.9, 84.95, 19.53]),
      capture('data-trace', '核对与追溯 · 数据质量核对', [5.7, 18.61, 88.48, 20.32]),
    ],
    'import': [
      capture('import-entry', '选择 Excel 文件', [73.15, 42.04, 19.23, 15.93]),
      capture('import-mapping', '业务日期、检验件数、不良件数的来源列', [4.96, 65.27, 90.18, 24.37]),
      capture('import-preview', '问题行：行号、字段和错误信息', [4.65, 16.82, 90.59, 6.22]),
      capture('import-batch', '已导入批次：工作表、导入时间、行数', [1.07, 33.09, 97.78, 33.58]),
    ],
    'data': [
      capture('detail-query', '数据集、开始日期与结束日期', [7.89, 26.4, 84.36, 11.25]),
      capture('detail-locate', '搜索当前数据', [34.92, 15.62, 29.98, 8.72]),
      capture('detail-origin', '来源行 38：检验件数为空的明细行', [2.51, 67.9, 95.06, 11.54]),
    ],
    'quality-check': [
      capture('check-scope', '调整核对范围：数据集、日期、工序', [1.26, 29.01, 97.56, 42.03]),
      capture('check-categories', '检验数量：缺少检验件数的项数与说明', [1.52, 33.57, 97.03, 33.09]),
      capture('check-source', '查看位置：原表行号、批次和「查看这行」', [3.53, 38.69, 93.04, 23.04]),
    ],
    'action:import-quantity': [
      capture('action-file', '数量导入向导 · 选择文件', [42.74, 43.44, 14.36, 13.48]),
      capture('action-map', '业务日期、检验件数和不良件数映射', [4.02, 16.27, 91.94, 25.78]),
      capture('action-confirm', '确认导入', [46.42, 22.34, 7.25, 9.83]),
    ],
  };
});
