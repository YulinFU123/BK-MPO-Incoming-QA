'use strict';
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GuideManual = factory();
})(typeof window === 'object' ? window : null, function () {
  // Rectangles use percentages of the referenced file, not of a preview thumbnail.
  return {
    'home': [
      { file: 'assets/guide-manual/home-workspace.png', label: '当前工作区名称', rect: [7.33, 35.56, 12.22, 9.17], kind: 'capture' },
      { file: 'assets/guide-manual/workspace-mode.png', label: '工作区卡片 · 主要数据来源', rect: [20.2063, 45.5554, 28.3981, 9.3264], kind: 'capture' },
      { file: 'assets/guide-manual/home-filter.png', label: '筛选条件 · 当前日期范围', rect: [1.0, 53.11, 98.0, 25.35], kind: 'capture' },
      { file: 'assets/guide-manual/home-quick.png', label: '异常记录 · 快捷录入、记录查询、待办跟进', rect: [2.25, 36.63, 38.88, 47.52], kind: 'capture' },
    ],
    'workspace-manager': [
      { file: 'assets/guide-manual/workspace-new.png', label: '＋ 新建工作区', rect: [65.6289, 23.1047, 26.7322, 32.8704], kind: 'capture' },
      { file: 'assets/guide-previews/workspace-create.png', label: '主要数据来源与录入模板来源', rect: [6.8, 46.5, 86.4, 34], kind: 'capture' },
      { file: 'assets/guide-manual/workspace-basic.png', label: '所选工作区详情 · 基本信息', rect: [35.3301, 39.8831, 10.9677, 15.9664], kind: 'capture' },
      { file: 'assets/guide-manual/workspace-dates.png', label: '分析开始日期与结束日期', rect: [19.5687, 51.1814, 53.69, 17.561], kind: 'capture' },
      { file: 'assets/guide-manual/workspace-tools.png', label: '管理工具', rect: [38.97, 27.1587, 15.0117, 14.0351], kind: 'capture' },
    ],
    'legacy-entry': [
      { file: 'assets/guide-manual/entry-date.png', label: '发现日期 · 自动填今天，可修改', rect: [5.88, 38.4, 60.92, 22.95], kind: 'capture' },
      { file: 'assets/guide-manual/entry-sn.png', label: '扫描或输入 SN', rect: [3.68, 38.97, 92.57, 21.8], kind: 'capture' },
      { file: 'assets/guide-manual/entry-silk.png', label: '底座丝印 · 按文本输入编号', rect: [6.32, 64.6, 88.06, 14.08], kind: 'capture' },
      { file: 'assets/guide-manual/duplicate.png', label: '保存状态 · SN 重复拦截提示', rect: [2.98, 85, 94.03, 10], kind: 'capture' },
      { file: 'assets/guide-manual/entry-save.png', label: '保存记录', rect: [61.66, 72.46, 30.11, 21.8], kind: 'capture' },
    ],
    'legacy-records': [
      { file: 'assets/guide-manual/record-filters.png', label: '组合筛选 · 开始日期', rect: [3.8, 38.66, 22.29, 13.94], kind: 'capture' },
      { file: 'assets/guide-manual/records-sort.png', label: '发现日期列 · 点击排序', rect: [17.1, 60.98, 19.48, 13.97], kind: 'capture' },
      { file: 'assets/guide-manual/records-edit.png', label: '目标记录 · 修改', rect: [70.62, 50.99, 7.59, 14.15], kind: 'capture' },
      { file: 'assets/guide-manual/records-export.png', label: '导出 Excel', rect: [57.19, 13.3, 18.82, 21.82], kind: 'capture' },
    ],
    'legacy-followup': [
      { file: 'assets/guide-manual/followup-status.png', label: '查看 · 未关闭、待处理或已超期', rect: [21.91, 39.27, 71.98, 20.98], kind: 'capture' },
      { file: 'assets/guide-manual/followup-task.png', label: '目标事项 · 更新处理', rect: [8.57, 78.82, 14.97, 14.09], kind: 'capture' },
      { file: 'assets/guide-manual/followup-save.png', label: '异常处理 · 保存处理', rect: [87.89, 84.36, 7.31, 6.22], kind: 'capture' },
    ],
    'legacy-analysis': [
      { file: 'assets/guide-manual/analysis-dates.png', label: '开始日期、结束日期', rect: [5.41, 38.61, 70.33, 22.98], kind: 'capture' },
      { file: 'assets/guide-manual/analysis-distribution.png', label: '分布与关联', rect: [23.03, 23.61, 19.85, 22.66], kind: 'capture' },
      { file: 'assets/guide-manual/analysis-table.png', label: '重点异常 · 点击分类查看关联记录', rect: [3.34, 90.23, 4.58, 9.77], kind: 'capture' },
    ],
    'legacy-settings': [
      { file: 'assets/guide-manual/template.png', label: '当前表头 · 切换表头', rect: [62.67, 4.44, 33.33, 18.89], kind: 'capture' },
      { file: 'assets/guide-manual/settings-field.png', label: '字段与校验 · SN 列名称', rect: [14.95, 39.99, 48.55, 20], kind: 'capture' },
      { file: 'assets/guide-manual/settings-unique.png', label: 'SN 字段 · 唯一值与防重复范围', rect: [25.83, 14.8, 48.55, 70.87], kind: 'capture' },
      { file: 'assets/guide-manual/entry-options.png', label: '快捷录入 · 异常现象候选项', rect: [5.93, 12.82, 88.22, 74.53], kind: 'capture' },
    ],
    'legacy-appearance': [
      { file: 'assets/guide-manual/appearance-theme.png', label: '界面风格 · 主题选项', rect: [2.73, 13.09, 94.43, 73.84], kind: 'capture' },
      { file: 'assets/guide-manual/appearance-density.png', label: '布局 · 信息密度', rect: [51.19, 37.37, 45.98, 14.59], kind: 'capture' },
      { file: 'assets/guide-manual/entry-options.png', label: '快捷录入 · 异常现象候选项', rect: [5.93, 12.82, 88.22, 74.53], kind: 'capture' },
    ],
    'legacy-security': [
      { file: 'assets/guide-manual/security-summary.png', label: '密码与自动锁定 · 加密说明', rect: [2.54, 30.36, 94.83, 39.55], kind: 'capture' },
      { file: 'assets/guide-manual/security-idle.png', label: '未操作多久后锁定', rect: [2.54, 40.47, 94.83, 18.89], kind: 'capture' },
      { file: 'assets/guide-manual/restore-note.png', label: '恢复前说明 · 先备份当前工作区', rect: [5.86, 34.03, 35.17, 9.42], kind: 'capture' },
    ],
    'action:import-record-xlsx': [
      { file: 'assets/guide-manual/records-import.png', label: '导入 Excel', rect: [40.62, 13.3, 18.82, 21.82], kind: 'capture' },
      { file: 'assets/guide-manual/xlsx-preview.png', label: '原始数据预览 · 核对表头与编号', rect: [2.6, 19.8, 94.8, 60], kind: 'capture' },
      { file: 'assets/guide-manual/xlsx-result.png', label: '记录查询 · 导入后的 SN', rect: [24.44, 32.5, 51.11, 35], kind: 'capture' },
    ],
    'action:import-record-csv': [
      { file: 'assets/guide-manual/csv-in.png', label: '更多操作 · 导入 CSV / TSV', rect: [50, 16.9, 45.78, 15.74], kind: 'capture' },
      { file: 'assets/guide-manual/csv-input.svg', label: '原文件首行 · 表头和分隔字段', rect: [4.3, 34.1, 51, 14.1], kind: 'diagram' },
      { file: 'assets/guide-manual/csv-result.png', label: '导入反馈 · 已导入和跳过条数', rect: [1.6, 37.22, 95.47, 25], kind: 'capture' },
    ],
    'action:batch-scan': [
      { file: 'assets/guide-manual/entry-common.png', label: '本批共用信息 · 异常现象', rect: [5.93, 40, 88.22, 20], kind: 'capture' },
      { file: 'assets/guide-manual/batch-scan.png', label: '批量扫码暂存 · 扫描或输入 SN', rect: [6.33, 45.1, 75.92, 8.37], kind: 'capture' },
      { file: 'assets/guide-manual/batch-review.png', label: '核对并统一保存', rect: [78.93, 82.69, 14.62, 6.75], kind: 'capture' },
    ],
    'action:export-records': [
      { file: 'assets/guide-manual/record-filters.png', label: '组合筛选 · 开始日期', rect: [3.8, 38.66, 22.29, 13.94], kind: 'capture' },
      { file: 'assets/guide-manual/records-export.png', label: '导出 Excel', rect: [57.19, 13.3, 18.82, 21.82], kind: 'capture' },
      { file: 'assets/guide-manual/xlsx-records.svg', label: '记录明细 · SN、异常现象与底座丝印', rect: [25.71, 48.31, 70.83, 14.19], kind: 'diagram' },
    ],
    'action:export-record-csv': [
      { file: 'assets/guide-manual/record-count.png', label: '显示条数 · 当前结果范围', rect: [42.89, 41.55, 14.44, 17.44], kind: 'capture' },
      { file: 'assets/guide-manual/csv-out.png', label: '更多操作 · 导出 CSV', rect: [50, 33.56, 45.78, 15.74], kind: 'capture' },
      { file: 'assets/guide-manual/csv-export.svg', label: '底座丝印 · 导出原文中的前导零', rect: [75.95, 48.31, 20.6, 14.19], kind: 'diagram' },
    ],
    'action:export-analysis': [
      { file: 'assets/guide-manual/analysis-dates.png', label: '开始日期、结束日期', rect: [5.41, 38.61, 70.33, 22.98], kind: 'capture' },
      { file: 'assets/guide-manual/analysis-export.png', label: '导出分析 Excel', rect: [71.07, 10.18, 24.46, 21.67], kind: 'capture' },
      { file: 'assets/guide-manual/xlsx-analysis.svg', label: '统计概览 · 范围内记录', rect: [3.33, 77.36, 93.21, 14.19], kind: 'diagram' },
    ],
    'action:export-followup': [
      { file: 'assets/guide-manual/followup-owner.png', label: '负责人包含', rect: [14.03, 39.12, 71.98, 21.73], kind: 'capture' },
      { file: 'assets/guide-manual/followup-export.png', label: '导出当前待办', rect: [72.71, 10.12, 23.05, 21.73], kind: 'capture' },
      { file: 'assets/guide-manual/xlsx-followup.svg', label: '未关闭异常 · 状态、负责人、期限', rect: [28.57, 33.78, 67.98, 43.24], kind: 'diagram' },
    ],
    'action:backup-records': [
      { file: 'assets/guide-manual/backup-scope.png', label: '原异常兼容备份 · 仅含异常模块', rect: [8.74, 51.27, 75.87, 11], kind: 'capture' },
      { file: 'assets/guide-manual/backup-legacy.png', label: '设置与备份 · 原异常兼容备份', rect: [6.25, 29.16, 88.76, 41.44], kind: 'capture' },
      { file: 'assets/guide-manual/backup-all.png', label: '工作区基本资料备份 · 保存加密备份', rect: [38.89, 40, 22.22, 20], kind: 'capture' },
    ],
  };
});
