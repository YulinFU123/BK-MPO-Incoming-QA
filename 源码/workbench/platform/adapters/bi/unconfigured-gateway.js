'use strict';
const { PlatformError } = require('../../domain/errors');

function createUnconfiguredGateway() {
  return Object.freeze({
    capabilities: Object.freeze({ automaticExport: false, status: 'not-configured' }),
    async requestExport() {
      throw new PlatformError('BI_NOT_CONFIGURED', '尚未取得 BI 项目源码及真实导出契约，自动导出未接入。');
    }
  });
}

module.exports = { createUnconfiguredGateway };
