'use strict';
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createPlatform, createFilePlatform } = require('../index');
const { restoreEncryptedBackup } = require('../adapters/encrypted/repository');
const { homeDemo: dashboardDemo } = require('../fixtures/home-demo');
const { assertJSONData } = require('../ports/dto');
const { PlatformError } = require('../domain/errors');
const version = require('../package.json').version;
const { createMemoryRepository } = require('../adapters/memory/quality-repository');
const { validateFullLegacyState, decodeLegacyBackup } = require('../adapters/legacy/full-state');

const fail = (code, message) => {
  throw new PlatformError(code, message);
};

/** Host-only session state: renderer never receives paths, bytes or keys. */
function createWorkspaceController({
  dialogs,
  clock = () => Date.now(),
  onLocked = () => {},
  repositoryFactory,
  restoreFactory = restoreEncryptedBackup,
  legacyEnabled = false,
  demoFactory = dashboardDemo,
}) {
  let epoch = 0,
    platform = null,
    mode = 'locked',
    workspaceName = '未打开数据文件',
    opening = false;
  let openingDone = null,
    closingTask = null;
  let managedId = null;
  let dataSourceMode = 'auto';
  let currentFile = null,
    demoPrepared = false;
  const selections = new Map(),
    workbooks = new Map(),
    previews = new Map();
  const status = () => ({
    version,
    managedId,
    dataSourceMode,
    unlocked: !!platform,
    mode,
    workspaceName,
    capabilities: platform ? { ...platform.capabilities, desktopConnected: true } : null,
  });
  const assertEpoch = (token) => {
    if (epoch !== token) fail('SESSION_CHANGED', '工作区已切换，请重新操作。');
  };
  function requireUnlocked() {
    if (!platform) fail('WORKSPACE_LOCKED', '请先打开数据文件或进入示例。');
  }
  function expire() {
    const now = clock();
    for (const [key, entry] of selections) if (entry.expiresAt <= now) selections.delete(key);
    for (const [key, entry] of workbooks)
      if (entry.expiresAt <= now) {
        workbooks.delete(key);
        for (const [id, owner] of previews)
          if (owner === key) {
            platform?.imports.cancelPreview(id);
            previews.delete(id);
          }
      }
  }
  async function readBounded(file) {
    const handle = await fs.open(file, 'r');
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size <= 0 || stat.size > 25 * 1024 * 1024)
        fail('FILE_SIZE_LIMIT', '工作簿为空或超过 25MB，请拆分后导入。');
      const bytes = await handle.readFile();
      if (bytes.length > 25 * 1024 * 1024) fail('FILE_SIZE_LIMIT', '工作簿超过 25MB。');
      return bytes;
    } finally {
      await handle.close();
    }
  }
  async function guarded(work) {
    requireUnlocked();
    const token = epoch,
      instance = platform;
    const value = await work(instance, () => {
      assertEpoch(token);
      return platform === instance;
    });
    assertEpoch(token);
    if (platform !== instance) fail('SESSION_CHANGED', '工作区已切换，请重新操作。');
    return value;
  }
  function lock() {
    if (closingTask) return closingTask;
    epoch++;
    const previous = platform;
    const pendingOpening = openingDone;
    platform = null;
    mode = 'locked';
    opening = false;
    workspaceName = '未打开数据文件';
    currentFile = null;
    managedId = null;
    dataSourceMode = 'auto';
    demoPrepared = false;
    selections.clear();
    workbooks.clear();
    for (const id of previews.keys()) previous?.imports.cancelPreview(id);
    previews.clear();
    try {
      onLocked();
    } catch {
      /* notification failure must not prevent key cleanup */
    }
    closingTask = (async () => {
      if (previous?.close) await previous.close();
      if (pendingOpening) await pendingOpening;
      return status();
    })().finally(() => {
      closingTask = null;
    });
    return closingTask;
  }
  function selected(file, create, extra = {}) {
    expire();
    if (selections.size >= 4) selections.clear();
    const selectionToken = randomUUID();
    const entry = { file, create, ...extra, epoch, expiresAt: clock() + 600000 };
    selections.set(selectionToken, entry);
    return { cancelled: false, selectionToken, workspaceName: path.basename(file), create };
  }
  function dailyBackup(instance = platform) {
    if (mode !== 'file' || !currentFile || !instance?.legacy?.completeBackupSync) return null;
    const date = new Date(clock()),
      day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const target = path.join(currentFile + '.backups', day + '.eap');
    if (fsSync.existsSync(target)) return null;
    let lastError;
    // A transient Windows share/permission refusal often clears immediately.
    // Retry once so a single hiccup does not leave the day without a backup.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        instance.legacy.completeBackupSync({ file: target });
        return null;
      } catch (error) {
        lastError = error;
      }
    }
    const reason =
      typeof lastError?.details?.reason === 'string'
        ? lastError.details.reason
        : typeof lastError?.code === 'string'
          ? lastError.code
          : 'IO_ERROR';
    return `数据已保存，但当日完整加密备份未生成（${reason}）。请立即手动备份一次，并检查备份目录权限或文件占用。`;
  }
  const commands = {
    status,
    renameManaged({ id, name, dataSourceMode: sourceMode }) {
      if (id === managedId && typeof name === 'string' && name.trim() && name.length <= 48)
        workspaceName = name.trim();
      if (id === managedId && ['auto', 'records', 'bi'].includes(sourceMode))
        dataSourceMode = sourceMode;
      return status();
    },
    async openManaged({ id, name, file, password, dataSourceMode: sourceMode = 'auto' }) {
      if (platform || opening || closingTask)
        fail('WORKSPACE_ALREADY_OPEN', '请先完成当前工作区的保存。');
      const chosen = selected(file, false);
      const result = await commands.unlock({ selectionToken: chosen.selectionToken, password });
      managedId = id;
      workspaceName = name;
      dataSourceMode = sourceMode;
      return status();
    },
    hostContext: () => ({ unlocked: !!platform, sessionId: epoch, mode, file: currentFile }),
    async chooseWorkspace({ create = false } = {}) {
      if (typeof create !== 'boolean') fail('INVALID_ARGUMENT', '打开方式无效。');
      if (platform || opening || closingTask)
        fail('WORKSPACE_ALREADY_OPEN', '请先完成当前工作区的打开或锁定。');
      const token = epoch;
      const file = await dialogs.chooseWorkspace({ create });
      assertEpoch(token);
      return file ? selected(file, create) : { cancelled: true };
    },
    async unlock({ selectionToken, password }) {
      expire();
      if (platform || opening || closingTask)
        fail('WORKSPACE_ALREADY_OPEN', '已有正在打开或锁定的工作区。');
      const entry = selections.get(selectionToken);
      if (!entry || entry.epoch !== epoch)
        fail('SELECTION_EXPIRED', '文件选择已过期，请重新选择。');
      if (typeof password !== 'string' || password.length > 1024)
        fail('PASSWORD_INVALID', '密码格式无效。');
      const token = epoch;
      opening = true;
      let finishOpening;
      const pending = new Promise((resolve) => {
        finishOpening = resolve;
      });
      openingDone = pending;
      let opened;
      try {
        if (entry.backupFile) {
          const repository = await restoreFactory({
            backupFile: entry.backupFile,
            file: entry.file,
            password,
          });
          try {
            const core = await createPlatform({ repository });
            opened = {
              ...core,
              close: () => repository.close(),
              backup: (input) => repository.backup(input),
              ...(repository.unified
                ? {
                    legacy: {
                      snapshot: async () => (await repository.snapshot()).legacyState,
                      save: (data) => repository.saveLegacy(data),
                      backup: (data) => repository.legacyBackup(data),
                      completeBackupSync: (input) => repository.backupSync(input),
                      changePassword: (current, next) => repository.changePassword(current, next),
                    },
                  }
                : {}),
            };
          } catch (error) {
            await repository.close();
            throw error;
          }
        } else
          opened = await createFilePlatform({
            file: entry.file,
            password,
            create: entry.create,
            ...(repositoryFactory ? { repositoryFactory } : {}),
          });
        assertEpoch(token);
        epoch++;
        platform = opened;
        mode = 'file';
        currentFile = entry.file;
        workspaceName = path.basename(entry.file);
        selections.clear();
        return status();
      } catch (error) {
        if (opened?.close) await opened.close();
        throw error;
      } finally {
        if (epoch === token || platform === opened) opening = false;
        if (openingDone === pending) openingDone = null;
        finishOpening();
      }
    },
    async openDemo() {
      if (platform || opening || closingTask)
        fail('WORKSPACE_ALREADY_OPEN', '请先完成当前工作区的打开或锁定。');
      const token = epoch;
      opening = true;
      try {
        const date = new Date(clock());
        const today = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        const fixture = demoFactory(today);
        const repository = createMemoryRepository({ legacyStateEnabled: legacyEnabled });
        const core = await createPlatform({ ...fixture, repository });
        const preview = await core.imports.previewRows(fixture);
        await core.imports.commitPreview(preview.previewId, { acknowledgeWarnings: true });
        assertEpoch(token);
        epoch++;
        demoPrepared = false;
        platform = legacyEnabled
          ? {
              ...core,
              legacy: {
                snapshot: async () => (await repository.snapshot()).legacyState,
                save: (data) => {
                  validateFullLegacyState(data);
                  repository.replaceLegacySync(data);
                  return structuredClone(data);
                },
                backup: () => {
                  fail('DEMO_NOT_SAVED', '示例模式不生成加密业务备份。');
                },
                changePassword: () => {
                  fail('DEMO_NOT_SAVED', '示例模式没有可修改的密码。');
                },
              },
            }
          : core;
        mode = 'demo';
        workspaceName = '示例工作区';
        return status();
      } finally {
        opening = false;
      }
    },
    lock,
    async legacyBootstrap(defaults) {
      return guarded(async (instance) => {
        if (!instance.legacy)
          fail('LEGACY_UNAVAILABLE', '此文件不包含完整异常记录模块，请新建融合工作区。');
        const state = await instance.legacy.snapshot();
        if (mode === 'demo' && state && !demoPrepared && defaults) {
          const complete = structuredClone(state);
          complete.templates = complete.templates.map((template) => {
            const initial = defaults.templates.find((item) => item.id === template.id);
            return initial
              ? { ...initial, ...template, columns: structuredClone(initial.columns) }
              : template;
          });
          instance.legacy.save(complete);
          demoPrepared = true;
          return complete;
        }
        if (state) return state;
        validateFullLegacyState(defaults);
        return instance.legacy.save(defaults);
      });
    },
    legacySave(data) {
      requireUnlocked();
      if (!platform.legacy) fail('LEGACY_UNAVAILABLE', '异常记录模块不可用。');
      platform.legacy.save(validateFullLegacyState(data));
      const warning = dailyBackup();
      return warning ? { saved: true, backupWarning: warning } : { saved: true };
    },
    legacyBackup(data) {
      requireUnlocked();
      if (managedId)
        fail('MANAGED_BACKUP_REQUIRED', '请在工作区管理中点击备份，生成可恢复的本机备份。');
      if (!platform.legacy) fail('LEGACY_UNAVAILABLE', '异常记录模块不可用。');
      return platform.legacy.backup(data);
    },
    legacyChangePassword(current, next) {
      if (managedId)
        fail('MANAGED_PASSWORD_NOT_REQUIRED', '此工作区由Windows账户保护，无需设置工作区密码。');
      return guarded((instance) => instance.legacy.changePassword(current, next));
    },
    legacyReadBackup(raw, password) {
      return guarded(() => decodeLegacyBackup(raw, password));
    },
    legacyRestore(raw, password) {
      return guarded(async (instance, authorize) => {
        const data = await decodeLegacyBackup(raw, password);
        authorize();
        return instance.legacy.save(data);
      });
    },
    importLegacyRecords({ raw, password, replaceConfirmed = false }) {
      return guarded(async (instance, authorize) => {
        if (mode !== 'file' || !instance.legacy)
          fail('REAL_WORKSPACE_REQUIRED', '请先新建或打开融合工作区，再读取原软件数据。');
        const existing = await instance.legacy.snapshot();
        authorize();
        if (existing && replaceConfirmed !== true)
          fail(
            'LEGACY_REPLACE_CONFIRMATION_REQUIRED',
            '读取原数据会替换当前工作区的异常记录、表头与跟进，数量数据保留。请确认后继续。',
          );
        const data = await decodeLegacyBackup(raw, password);
        authorize();
        const backupFile = currentFile + '.before-record-import-' + randomUUID() + '.eap';
        await instance.backup({ file: backupFile });
        authorize();
        instance.legacy.save(data);
        return {
          importedCount: data.records.length,
          templateCount: data.templates.length,
          backupCreated: true,
          backupName: path.basename(backupFile),
        };
      });
    },
    catalog: () => guarded((instance) => instance.queries.catalog()),
    overview: (input) => guarded((instance) => instance.analysis.overview(input)),
    homeReport: (input) =>
      guarded((instance) => {
        const d = new Date(clock());
        const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        return instance.analysis.home(input, { today });
      }),
    qualityReport: (input) => guarded((instance) => instance.quality.inspect(input)),
    listData: (input) => guarded((instance) => instance.queries.listData(input)),
    async pickWorkbook() {
      return guarded(async (instance, authorize) => {
        const file = await dialogs.pickWorkbook();
        if (!file) return { cancelled: true };
        const bytes = await readBounded(file);
        const inspected = await instance.imports.inspectWorkbook({ bytes });
        authorize();
        for (const id of previews.keys()) instance.imports.cancelPreview(id);
        previews.clear();
        workbooks.clear();
        const workbookToken = randomUUID();
        workbooks.set(workbookToken, { bytes, expiresAt: clock() + 600000 });
        return { cancelled: false, workbookToken, fileName: path.basename(file), ...inspected };
      });
    },
    previewImport(input) {
      assertJSONData(input);
      return guarded(async (instance, authorize) => {
        expire();
        const workbook = workbooks.get(input.workbookToken);
        if (!workbook) fail('WORKBOOK_EXPIRED', '工作簿已过期，请重新选择文件。');
        const preview = await instance.imports.previewWorkbook({
          bytes: workbook.bytes,
          dataset: input.dataset,
          mapping: input.mapping,
          source: input.source,
        });
        authorize();
        previews.set(preview.previewId, input.workbookToken);
        return preview;
      });
    },
    commitImport({ previewId, acknowledgeWarnings = false }) {
      return guarded((instance, authorize) => {
        expire();
        if (!previews.has(previewId)) fail('PREVIEW_EXPIRED', '预览已取消或过期，请重新预览。');
        return instance.imports
          .commitPreview(previewId, { acknowledgeWarnings, authorize })
          .then((result) => {
            const warning = dailyBackup(instance);
            return warning ? { ...result, backupWarning: warning } : result;
          });
      });
    },
    cancelImport({ previewId }) {
      requireUnlocked();
      previews.delete(previewId);
      return platform.imports.cancelPreview(previewId);
    },
    backup() {
      return guarded(async (instance, authorize) => {
        if (mode !== 'file') fail('DEMO_NOT_SAVED', '示例工作区不保存文件，请新建自己的数据文件。');
        const file = await dialogs.backup();
        if (!file) return { cancelled: true };
        authorize();
        return { cancelled: false, ...(await instance.backup({ file })) };
      });
    },
    async restoreWorkspace() {
      if (platform || opening || closingTask)
        fail('WORKSPACE_ALREADY_OPEN', '恢复前请先完成当前工作区的打开或锁定。');
      const token = epoch;
      const backupFile = await dialogs.restoreSource();
      assertEpoch(token);
      if (!backupFile) return { cancelled: true };
      const file = await dialogs.restoreDestination();
      assertEpoch(token);
      return file ? selected(file, false, { backupFile }) : { cancelled: true };
    },
  };
  return Object.freeze(commands);
}
module.exports = { createWorkspaceController };
