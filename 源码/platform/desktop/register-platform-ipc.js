'use strict';

const { PlatformError } = require('../domain/errors');
const { assertJSONData } = require('../ports/dto');

// The current desktop main/preload do not import this adapter yet. The host must
// reserve these channels for this registration's lifetime; no Electron import,
// file access, network access, credentials or production storage are required.
const CHANNELS = Object.freeze([
  'platform:capabilities',
  'platform:preview-rows',
  'platform:commit-preview',
  'platform:overview',
  'platform:cancel-preview',
]);

const authError = (code) => ({
  ok: false,
  error: {
    code,
    message: code === 'WORKSPACE_LOCKED' ? '请先解锁工作台。' : '此窗口无权调用分析平台。',
  },
});

function safeError(error) {
  if (
    error instanceof PlatformError &&
    /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code) &&
    typeof error.message === 'string' &&
    error.message.length <= 256
  ) {
    return { ok: false, error: { code: error.code, message: error.message } };
  }
  return { ok: false, error: { code: 'INTERNAL_ERROR', message: '操作未完成，请重试。' } };
}

function requireObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PlatformError('INVALID_ARGUMENT', '请提供完整的参数对象。');
  }
}

function requirePreviewId(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 128) {
    throw new PlatformError('INVALID_PREVIEW_ID', '预览编号无效。');
  }
}

function requireCommit(value) {
  if (typeof value === 'string') {
    requirePreviewId(value);
    return;
  }
  requireObject(value);
  requirePreviewId(value.previewId);
  if (
    Object.keys(value).some((key) => !['previewId', 'acknowledgeWarnings'].includes(key)) ||
    (Object.hasOwn(value, 'acknowledgeWarnings') && typeof value.acknowledgeWarnings !== 'boolean')
  ) {
    throw new PlatformError('INVALID_ARGUMENT', '确认导入的参数无效。');
  }
}

/**
 * Register a narrow, authenticated IPC surface using host-owned dependencies.
 * Registration never removes existing handlers to make room for a new one.
 * @returns {Function} Idempotent disposer for successfully registered channels.
 */
function registerPlatformIpc({ ipcMain, isTrusted, isUnlocked, platform }) {
  if (
    !ipcMain ||
    typeof ipcMain.handle !== 'function' ||
    typeof ipcMain.removeHandler !== 'function' ||
    typeof isTrusted !== 'function' ||
    typeof isUnlocked !== 'function' ||
    !platform ||
    !platform.imports ||
    !platform.analysis
  ) {
    throw new PlatformError('INVALID_DESKTOP_PORT', '桌面平台接口尚未配置完整。');
  }
  for (const method of ['previewRows', 'commitPreview', 'cancelPreview']) {
    if (typeof platform.imports[method] !== 'function')
      throw new PlatformError('INVALID_DESKTOP_PORT', '导入接口尚未配置完整。');
  }
  if (typeof platform.analysis.overview !== 'function')
    throw new PlatformError('INVALID_DESKTOP_PORT', '分析接口尚未配置完整。');
  const routes = {
    'platform:capabilities': { noArgs: true, run: () => platform.capabilities },
    'platform:preview-rows': {
      validate: requireObject,
      run: (input) => platform.imports.previewRows(input),
    },
    'platform:commit-preview': {
      validate: requireCommit,
      run: (input, event) =>
        platform.imports.commitPreview(typeof input === 'string' ? input : input.previewId, {
          acknowledgeWarnings: typeof input === 'object' && input.acknowledgeWarnings === true,
          authorize: async () => {
            if (disposed)
              throw new PlatformError('DESKTOP_ADAPTER_DISPOSED', '桌面分析接口已关闭。');
            if (!(await isTrusted(event)))
              throw new PlatformError('UNTRUSTED_SENDER', '此窗口无权调用分析平台。');
            if (disposed)
              throw new PlatformError('DESKTOP_ADAPTER_DISPOSED', '桌面分析接口已关闭。');
            return !!(await isUnlocked(event));
          },
        }),
    },
    'platform:overview': {
      validate: requireObject,
      run: (input) => platform.analysis.overview(input),
    },
    'platform:cancel-preview': {
      validate: requirePreviewId,
      run: (id) => platform.imports.cancelPreview(id),
    },
  };
  const installed = [];
  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const channel of installed.splice(0).reverse()) ipcMain.removeHandler(channel);
  }
  try {
    for (const channel of CHANNELS) {
      const route = routes[channel];
      ipcMain.handle(channel, async (event, ...args) => {
        try {
          // Gates run for every invocation, including invocations awaiting an
          // asynchronous trust decision. No authentication decision is cached.
          if (!(await isTrusted(event))) return authError('UNTRUSTED_SENDER');
          if (!(await isUnlocked(event))) return authError('WORKSPACE_LOCKED');
          if (disposed) throw new PlatformError('DESKTOP_ADAPTER_DISPOSED', '桌面分析接口已关闭。');
          if (route.noArgs) {
            if (args.length !== 0)
              throw new PlatformError('INVALID_ARGUMENT', '此操作不接受参数。');
            const value = await route.run();
            if (disposed)
              throw new PlatformError('DESKTOP_ADAPTER_DISPOSED', '桌面分析接口已关闭。');
            if (!(await isTrusted(event))) return authError('UNTRUSTED_SENDER');
            if (!(await isUnlocked(event))) return authError('WORKSPACE_LOCKED');
            if (disposed)
              throw new PlatformError('DESKTOP_ADAPTER_DISPOSED', '桌面分析接口已关闭。');
            return { ok: true, value: structuredClone(value) };
          }
          if (args.length !== 1)
            throw new PlatformError('INVALID_ARGUMENT', '此操作需要一个参数。');
          assertJSONData(args[0]);
          route.validate(args[0]);
          const input = structuredClone(args[0]);
          const value = await route.run(input, event);
          if (disposed) throw new PlatformError('DESKTOP_ADAPTER_DISPOSED', '桌面分析接口已关闭。');
          // A long-running analysis/import must not deliver data to a relocked window.
          if (!(await isTrusted(event))) return authError('UNTRUSTED_SENDER');
          if (!(await isUnlocked(event))) return authError('WORKSPACE_LOCKED');
          if (disposed) throw new PlatformError('DESKTOP_ADAPTER_DISPOSED', '桌面分析接口已关闭。');
          return { ok: true, value: structuredClone(value) };
        } catch (error) {
          return safeError(error);
        }
      });
      installed.push(channel);
    }
  } catch (error) {
    dispose();
    throw error;
  }
  return dispose;
}

module.exports = { registerPlatformIpc, CHANNELS };
