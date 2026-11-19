'use strict';
const { printHtml } = require('./label-render');
const { PlatformError } = require('../domain/errors');
async function printLabelDocument(BrowserWindow, plan, { print, authorize }) {
  const printWindow = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true },
  });
  printWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  try {
    await printWindow.loadURL(
      'data:text/html;charset=utf-8,' + encodeURIComponent(printHtml(plan)),
    );
    authorize();
    if (!print)
      return await printWindow.webContents.printToPDF({
        printBackground: true,
        preferCSSPageSize: true,
        pageSize: { width: plan.paper.width / 25.4, height: plan.paper.height / 25.4 },
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      });
    await new Promise((resolve, reject) =>
      printWindow.webContents.print(
        {
          silent: false,
          printBackground: true,
          pageSize: {
            width: Math.round(plan.paper.width * 1000),
            height: Math.round(plan.paper.height * 1000),
          },
          landscape: false,
          margins: { marginType: 'none' },
        },
        (success, reason) =>
          success
            ? resolve()
            : reject(
                new PlatformError(
                  'LABEL_PRINT_CANCELLED',
                  reason === 'cancelled' ? '已取消打印。' : '打印未完成，请检查打印机设置。',
                ),
              ),
      ),
    );
    return null;
  } catch (error) {
    if (error instanceof PlatformError) throw error;
    throw new PlatformError('LABEL_DOCUMENT_FAILED', '标签文档生成未完成，请减少本批数量后重试。');
  } finally {
    if (!printWindow.isDestroyed()) printWindow.destroy();
  }
}
module.exports = { printLabelDocument };
