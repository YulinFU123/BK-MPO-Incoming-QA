'use strict';
const path = require('node:path');
const fs = require('node:fs/promises');
const { createHash, randomUUID } = require('node:crypto');
const { createSQLiteStateStore } = require('../adapters/state/sqlite-state-store');
const { createModuleStateService } = require('../application/module-state-service');
const { PlatformError } = require('../domain/errors');
const { assertJSONData } = require('../ports/dto');
function workspaceIdentity(c) {
  return c.mode === 'demo'
    ? `demo:${c.sessionId}`
    : c.file
      ? createHash('sha256').update(path.resolve(c.file).toLowerCase()).digest('hex')
      : '';
}
async function createModuleStateHost({
  controller,
  directory,
  encryption,
  pickBackup = async () => null,
}) {
  const store = await createSQLiteStateStore(path.join(directory, 'modules.sqlite'));
  const context = () => {
    const c = controller.hostContext();
    const workspace = workspaceIdentity(c);
    return { unlocked: c.unlocked, epoch: c.sessionId, workspace };
  };
  const service = createModuleStateService({ store, encryption, context });
  let temporary = null;
  async function invoke(method, input) {
    assertJSONData(input);
    const address = ['read', 'history', 'profiles'].includes(method) ? input : input.address;
    const c = controller.hostContext(),
      before = context();
    let target = service;
    if (address?.scope !== 'global' && c.mode === 'demo') {
      if (!temporary)
        temporary = (async () => {
          const memory = await createSQLiteStateStore(':memory:');
          // Explicit demo-only RAM storage. This is never a disk/plaintext fallback.
          const ram = {
            isEncryptionAvailable: async () => true,
            encryptString: async (s) => Buffer.from(s),
            decryptString: async (b) => b.toString('utf8'),
          };
          return {
            store: memory,
            service: createModuleStateService({ store: memory, encryption: ram, context }),
          };
        })();
      target = (await temporary).service;
      const now = context();
      if (now.epoch !== before.epoch || now.workspace !== before.workspace)
        throw new PlatformError('SESSION_CHANGED', '工作区已变化，本次配置操作已取消。');
    }
    return target[method](input);
  }
  return Object.freeze({
    readModuleState: (input) => invoke('read', input),
    saveModuleState: (input) => invoke('save', input),
    resetModuleState: (input) => invoke('reset', input),
    moduleStateHistory: (input) => invoke('history', input),
    restoreModuleState: (input) => invoke('restore', input),
    moduleStateProfiles: (input) => invoke('profiles', input),
    saveModuleStateProfile: (input) => invoke('saveProfile', input),
    applyModuleStateProfile: (input) => invoke('applyProfile', input),
    async importModuleStateBackup({ address, expectedRevision, confirmed }) {
      if (confirmed !== true)
        throw new PlatformError('STATE_RECOVERY_REQUIRED', '请先确认仅恢复当前模块配置。');
      const before = context();
      if (controller.hostContext().mode === 'demo' && address.scope !== 'global')
        throw new PlatformError(
          'STATE_INVALID',
          '示例配置只在当前会话中，请打开实际工作区后恢复模块备份。',
        );
      const selected = await pickBackup();
      if (!selected) return { cancelled: true };
      const now = context();
      if (now.epoch !== before.epoch || now.workspace !== before.workspace)
        throw new PlatformError('SESSION_CHANGED', '工作区已变化，恢复已取消。');
      const info = await fs.stat(selected);
      if (!info.isFile() || info.size > 50 * 1024 * 1024)
        throw new PlatformError('STATE_INVALID', '请选择50MB以内的独立配置备份。');
      const original = await createSQLiteStateStore(selected, { readOnly: true });
      try {
        const incoming = createModuleStateService({ store: original, encryption, context });
        const saved = await incoming.read(address);
        if (!saved.revision || saved.corrupt)
          throw new PlatformError(
            'STATE_BACKUP_MISMATCH',
            '备份中没有当前工作区的有效模块配置。工作区路径与Windows账户需要一致。',
          );
        return service.recover({ address, data: saved.data, expectedRevision, confirmed: true });
      } finally {
        await original.close();
      }
    },
    async backupModuleState() {
      await service.flush();
      const backups = path.join(directory, 'backups');
      await fs.mkdir(backups, { recursive: true });
      const file = path.join(backups, `settings-${Date.now()}-${randomUUID()}.sqlite`);
      try {
        await store.backup(file);
        return {
          saved: true,
          fileName: path.basename(file),
          scope: 'windows-account-only',
          demoOmitted: controller.hostContext().mode === 'demo',
        };
      } catch (error) {
        await fs.unlink(file).catch(() => {});
        throw new PlatformError(
          'STATE_BACKUP_FAILED',
          '配置备份未完成，请重试。业务数据未受影响。',
        );
      }
    },
    checkModuleState: () => store.check(),
    async flush() {
      await service.flush();
      if (temporary) await (await temporary).service.flush();
    },
    async close() {
      await service.flush();
      if (temporary) {
        const t = await temporary;
        await t.service.flush();
        await t.store.close();
      }
      await store.close();
    },
  });
}
module.exports = { createModuleStateHost, workspaceIdentity };
