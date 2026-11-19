'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createSQLiteStateStore } = require('../adapters/state/sqlite-state-store');
const { createModuleStateService } = require('../application/module-state-service');
const { workspaceIdentity } = require('./module-state-host');
const { startBIWorker } = require('./bi-client');
const studio = require('../domain/analysis-studio');
const calendar = require('../domain/analysis-calendar');

/** Catalog-owned IDs only. Does not unlock, switch or write a workspace. */
function createManagedBIPreview({
  directory,
  moduleDirectory,
  encryption,
  python,
  script,
  workerFactory = startBIWorker,
}) {
  let worker = null,
    store = null,
    closed = false;
  async function state(file) {
    const settings = path.join(moduleDirectory, 'modules.sqlite');
    try {
      await fs.access(settings);
    } catch (e) {
      if (e.code === 'ENOENT') return { config: studio.defaults(), calendar: calendar.defaults() };
      throw e;
    }
    store ||= await createSQLiteStateStore(settings, { readOnly: true });
    const context = () => ({
      unlocked: true,
      epoch: 1,
      workspace: workspaceIdentity({ mode: 'file', file }),
    });
    const memory = createModuleStateService({ store, encryption, context });
    const [source, rule] = await Promise.all([
      memory.read({ scope: 'module', module: 'analysis-studio' }),
      memory.read({ scope: 'module', module: 'analysis-calendar' }),
    ]);
    if (source.corrupt || rule.corrupt)
      throw Error('BI来源或班次规则不可读取，请打开工作区恢复配置。');
    return { config: studio.validate(source.data), calendar: calendar.validate(rule.data) };
  }
  return Object.freeze({
    async read({ id, file, query, allDates = false, biFilter = null }) {
      if (closed) throw Error('工作区预览已关闭。');
      if (
        !/^ws_[a-f0-9-]{36}$/.test(id) ||
        path.resolve(file) !== path.resolve(directory, id + '.eap')
      )
        throw Error('工作区预览范围无效。');
      if (
        biFilter &&
        (!['process', 'issue', 'shift', 'employee'].includes(biFilter.field) ||
          typeof biFilter.value !== 'string' ||
          biFilter.value.length > 512 ||
          Object.keys(biFilter).some((k) => !['field', 'value'].includes(k)))
      )
        throw Error('BI明细筛选无效。');
      try {
        await fs.access(file + '.analysis-data/analysis-v1.sqlite');
      } catch (e) {
        if (e.code === 'ENOENT')
          return { state: 'empty', channel: 'studio', message: '此工作区尚未导入BI自由分析数据。' };
        throw e;
      }
      try {
        const saved = await state(file);
        worker ||= workerFactory({ python, script, source: path.dirname(script), data: directory });
        return await worker.request({
          body: {
            action: 'home',
            workspaceId: id,
            ...saved,
            query,
            allDates,
            biFilter,
            preference: {},
          },
        });
      } catch (e) {
        worker?.abort();
        worker = null;
        await store?.close().catch(() => {});
        store = null;
        return {
          state: 'error',
          hasData: true,
          channel: 'studio',
          message: 'BI预览未完成，未当作零：' + e.message,
        };
      }
    },
    async close() {
      closed = true;
      await worker?.close();
      await store?.close();
      worker = store = null;
    },
  });
}
module.exports = { createManagedBIPreview };
