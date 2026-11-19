'use strict';
const { PlatformError } = require('../domain/errors');
const ADDRESS = Object.freeze({ scope: 'module', module: 'bi-inbox' });
function createInboxHost({ memory, pick, grant, request, active }) {
  let busy = false;
  return async (body) => {
    if (
      !body ||
      !['read', 'pick', 'save', 'reset', 'poll'].includes(body.action) ||
      Object.keys(body).some((k) => !['action', 'data', 'expectedRevision'].includes(k))
    )
      throw new PlatformError('INVALID_ARGUMENT', '接收操作无效。');
    if (!memory)
      throw new PlatformError('STATE_UNAVAILABLE', '独立配置记忆不可用，未启用自动接收。');
    const before = active(),
      row = await memory.readModuleState(ADDRESS);
    const checked = () => {
      if (active() !== before)
        throw new PlatformError('SESSION_CHANGED', '工作区已切换，本次接收取消。');
    };
    checked();
    if (row.corrupt) throw new PlatformError('STATE_CORRUPT', '接收配置损坏，请从配置备份恢复。');
    if (body.action === 'read') return row;
    if (body.action === 'reset')
      return memory.resetModuleState({
        address: ADDRESS,
        expectedRevision: body.expectedRevision,
        confirmed: true,
      });
    if (body.action === 'pick') {
      const folder = await pick();
      checked();
      if (!folder) return { cancelled: true };
      await grant(folder);
      checked();
      return memory.saveModuleState({
        address: ADDRESS,
        data: { ...row.data, folder, enabled: false },
        expectedRevision: row.revision,
      });
    }
    if (body.action === 'save') {
      if (!body.data || body.data.folder !== row.data.folder)
        throw new PlatformError('INBOX_PICK_REQUIRED', '接收目录请使用选择按钮设置。');
      return memory.saveModuleState({
        address: ADDRESS,
        data: body.data,
        expectedRevision: body.expectedRevision,
      });
    }
    if (busy) throw new PlatformError('BI_BUSY', '正在核对接收文件，请稍后重试。');
    if (!row.data.folder || !row.data.scope.trim())
      throw new PlatformError('INBOX_NOT_CONFIGURED', '请选择接收目录并填写来源范围。');
    busy = true;
    try {
      await grant(row.data.folder);
      checked();
      const result = await request({ route: '/api/fusion/inbox', body: row.data });
      checked();
      return result;
    } finally {
      busy = false;
    }
  };
}
module.exports = { createInboxHost, ADDRESS };
