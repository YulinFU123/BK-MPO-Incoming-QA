'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LegacyCommonActions = api;
})(typeof window === 'object' ? window : null, () => {
  const elements = Object.freeze({
    'import-xlsx': 'xlsxFile',
    'import-csv': 'csvFile',
    'batch-scan': 'openBatch',
    'export-xlsx': 'exportXlsx',
    'export-csv': 'exportCsv',
    'analysis-export': 'analysisExport',
    'followup-export': 'followupExport',
    'record-backup': 'sideBackup',
  });
  const sections = Object.freeze({
    'import-xlsx': 'records',
    'import-csv': 'records',
    'batch-scan': 'entry',
    'export-xlsx': 'records',
    'export-csv': 'records',
    'analysis-export': 'analysis',
    'followup-export': 'followup',
    'record-backup': 'records',
  });
  function activate(document, action) {
    if (typeof action !== 'string' || !Object.hasOwn(elements, action))
      throw Error('此公共操作不可用。');
    if (document.querySelector?.('dialog[open]'))
      throw Error('请先完成或关闭当前弹窗，再选择其他操作。');
    const element = document.getElementById(elements[action]);
    if (!element || typeof element.click !== 'function' || element.disabled)
      throw Error('当前操作尚不可用，请先检查当前页面和数据。');
    element.click();
    return { requested: true, action };
  }
  return Object.freeze({ elements, sections, activate });
});
