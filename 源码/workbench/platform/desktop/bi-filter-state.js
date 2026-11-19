'use strict';
const { PlatformError } = require('../domain/errors');
const ADDRESS = Object.freeze({ scope: 'module', module: 'bi-export' });
async function filterMemory(host, body, address = ADDRESS) {
  if (!host) throw new PlatformError('STATE_UNAVAILABLE', '配置记忆暂不可用，不会以明文替代。');
  if (!body || Object.keys(body).some((k) => !['action', 'data', 'expectedRevision'].includes(k)))
    throw new PlatformError('STATE_INVALID', '配置操作无效。');
  if (body.action === 'read') return host.readModuleState(address);
  if (body.action === 'save')
    return host.saveModuleState({
      address,
      data: body.data,
      expectedRevision: body.expectedRevision,
    });
  if (body.action === 'reset')
    return host.resetModuleState({
      address,
      expectedRevision: body.expectedRevision,
      confirmed: true,
    });
  throw new PlatformError('STATE_INVALID', '配置操作无效。');
}
module.exports = { filterMemory, ADDRESS };
