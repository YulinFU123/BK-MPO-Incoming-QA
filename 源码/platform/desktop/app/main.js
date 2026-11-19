'use strict';
const { app, BrowserWindow, dialog, ipcMain, session, Menu, safeStorage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { createWorkspaceController } = require('../workspace-controller');
const { assertJSONData } = require('../../ports/dto');
const { PlatformError } = require('../../domain/errors');
const {
  createUnifiedRepository,
  restoreUnifiedBackup,
} = require('../../adapters/encrypted/repository');
const { createLegacyHost } = require('../legacy-host');
const { createBIHost } = require('../bi-host');
const { createLabelFiles } = require('../label-files');
const { printLabelDocument } = require('../label-print');
const { createLabelMemory } = require('../label-memory');
const { createLabelEncryption } = require('../label-encryption');

app.setName('异常分析平台');
const qaRoot = process.env.PLATFORM_DESKTOP_QA_ROOT;
const profile = qaRoot
  ? path.resolve(qaRoot, 'profile')
  : path.join(app.getPath('appData'), 'ExceptionAnalysisPlatformPreview');
fs.mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
let window,
  controller,
  legacyHost,
  biHost,
  labelFiles,
  labelMemory,
  quitting = false;
const page = pathToFileURL(path.join(__dirname, 'index.html')).href;
const routes = [
  'status',
  'chooseWorkspace',
  'unlock',
  'openDemo',
  'lock',
  'catalog',
  'overview',
  'qualityReport',
  'pickLabelWorkbook',
  'exportLabels',
  'readLabelMemory',
  'saveLabelMemory',
  'biQuality',
  'listData',
  'pickWorkbook',
  'previewImport',
  'commitImport',
  'cancelImport',
  'backup',
  'restoreWorkspace',
  'showLegacy',
  'hideLegacy',
  'legacyAction',
  'appearance',
  'originalRecordInfo',
  'importOriginalRecords',
  'showBI',
  'hideBI',
  'biInfo',
  'backupBI',
  'importBIData',
];
const noArgs = new Set([
  'status',
  'openDemo',
  'lock',
  'catalog',
  'pickWorkbook',
  'backup',
  'pickLabelWorkbook',
  'readLabelMemory',
  'restoreWorkspace',
  'hideLegacy',
  'originalRecordInfo',
  'hideBI',
  'biInfo',
  'backupBI',
  'importBIData',
]);
const originalRecordFile = path.join(app.getPath('appData'), 'QualityDeskOffline', 'vault.json');

async function openDialog(options) {
  const result = await dialog.showOpenDialog(window, options);
  return result.canceled ? null : result.filePaths[0];
}
async function saveDialog(options) {
  const result = await dialog.showSaveDialog(window, options);
  return result.canceled ? null : result.filePath;
}
const encryptedFilter = [{ name: '融合工作区加密文件', extensions: ['eap'] }];
app.on('web-contents-created', (_event, contents) => {
  contents.on('before-input-event', (event, input) => {
    if (
      input.type === 'keyDown' &&
      !input.alt &&
      !input.shift &&
      (input.control || input.meta) &&
      input.key.toLowerCase() === 'k' &&
      window &&
      !window.isDestroyed() &&
      controller?.status().unlocked
    ) {
      event.preventDefault();
      window.webContents.send('analysis:function-search');
    }
  });
});

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  session.defaultSession.webRequest.onBeforeRequest((details, callback) =>
    callback({ cancel: !/^(file:|devtools:|data:|blob:)/.test(details.url) }),
  );
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) =>
    callback(permission === 'clipboard-sanitized-write'),
  );
  session.defaultSession.setPermissionCheckHandler(
    (_webContents, permission) => permission === 'clipboard-sanitized-write',
  );
  window = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 980,
    minHeight: 680,
    show: false,
    title: '异常分析平台',
    icon: path.join(__dirname, 'assets', 'logo.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#EEF2F6', symbolColor: '#142333', height: 34 },
    backgroundColor: '#EEF2F6',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      devTools: !!qaRoot,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.on('page-title-updated', (event) => event.preventDefault());
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== page) event.preventDefault();
  });
  controller = createWorkspaceController({
    repositoryFactory: createUnifiedRepository,
    restoreFactory: restoreUnifiedBackup,
    legacyEnabled: true,
    dialogs: {
      chooseWorkspace: ({ create }) =>
        create
          ? saveDialog({
              title: '新建融合工作区',
              defaultPath: '异常工作区.eap',
              filters: encryptedFilter,
              properties: ['createDirectory'],
            })
          : openDialog({
              title: '打开融合工作区',
              filters: encryptedFilter,
              properties: ['openFile'],
            }),
      pickWorkbook: () =>
        openDialog({
          title: '选择要导入的 Excel',
          filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }],
          properties: ['openFile'],
        }),
      backup: () =>
        saveDialog({
          title: '完整工作区备份（异常记录及数量数据）',
          defaultPath: '异常工作区备份.eap',
          filters: encryptedFilter,
        }),
      restoreSource: () =>
        openDialog({ title: '选择加密备份', filters: encryptedFilter, properties: ['openFile'] }),
      restoreDestination: () =>
        saveDialog({
          title: '恢复到新文件（不能覆盖）',
          defaultPath: '异常工作区恢复.eap',
          filters: encryptedFilter,
        }),
    },
    onLocked: () => {
      labelFiles?.clear();
      labelMemory?.clearSession();
      legacyHost?.destroyView();
      biHost?.abort();
      if (!window.isDestroyed()) window.webContents.send('analysis:locked');
    },
  });
  labelFiles = createLabelFiles({
    controller,
    pick: () =>
      openDialog({
        title: '只读提取标签编号',
        filters: [{ name: 'Excel工作簿', extensions: ['xlsx'] }],
        properties: ['openFile'],
      }),
    save: (extension) =>
      saveDialog({
        title: '导出标签（不覆盖现有文件）',
        defaultPath: `二维码标签_${Date.now()}.${extension}`,
        filters: [{ name: '标签文件', extensions: [extension] }],
      }),
    printDocument: (plan, options) => printLabelDocument(BrowserWindow, plan, options),
  });
  labelMemory = createLabelMemory({
    controller,
    directory: path.join(profile, 'label-memory'),
    encryption: createLabelEncryption(safeStorage),
  });
  const lockAll = async () => {
    const flushed = await window.webContents.executeJavaScript(
      'window.flushLabelStudio ? window.flushLabelStudio() : true',
    );
    if (quitting && flushed === false)
      throw new PlatformError(
        'LABEL_MEMORY_WRITE',
        '排版记忆未保存。请重试“立即记住”，或关闭自动记忆后再退出。',
      );
    await biHost?.close();
    await legacyHost?.flush();
    return controller.lock();
  };
  const legacyLock = async () => {
    try {
      await biHost?.close();
      legacyHost.destroyView();
      await controller.lock();
    } catch (error) {
      dialog.showErrorBox(
        '暂未锁定',
        error instanceof PlatformError ? error.message : '当前操作尚未完成，请稍后再锁定。',
      );
    }
  };
  legacyHost = createLegacyHost({
    window,
    controller,
    onLock: legacyLock,
    onAppearance: (value) => window.webContents.send('analysis:appearance', value),
    qa: !!qaRoot,
  });
  biHost = createBIHost({
    window,
    controller,
    profile,
    onActivity: () => legacyHost.activity(),
    onExit: () => window.close(),
    qa: !!qaRoot,
  });
  ipcMain.on('analysis:activity', (event) => {
    if (
      event.sender === window.webContents &&
      event.senderFrame === window.webContents.mainFrame &&
      event.senderFrame.url.split('#')[0] === page
    )
      legacyHost.activity();
  });
  for (const name of routes)
    ipcMain.handle(`analysis:${name}`, async (event, ...args) => {
      try {
        if (
          event.sender !== window.webContents ||
          event.senderFrame !== window.webContents.mainFrame ||
          event.senderFrame.url.split('#')[0] !== page
        )
          throw new PlatformError('UNTRUSTED_SENDER', '此窗口无权访问数据。');
        if (noArgs.has(name) ? args.length !== 0 : args.length !== 1)
          throw new PlatformError('INVALID_ARGUMENT', '操作参数无效。');
        if (!noArgs.has(name)) {
          assertJSONData(args[0]);
          if (!args[0] || typeof args[0] !== 'object' || Array.isArray(args[0]))
            throw new PlatformError('INVALID_ARGUMENT', '操作参数无效。');
        }
        let value;
        if (name === 'showLegacy') {
          biHost.hide();
          value = await legacyHost.show(args[0]);
        } else if (name === 'showBI') {
          legacyHost.hide();
          value = await biHost.show(args[0]);
        } else if (name === 'hideBI') value = biHost.hide();
        else if (name === 'biInfo') value = biHost.info();
        else if (name === 'biQuality') value = await biHost.quality(args[0]);
        else if (name === 'backupBI') value = await biHost.backup();
        else if (name === 'importBIData') value = await biHost.importData();
        else if (name === 'hideLegacy') value = legacyHost.hide();
        else if (name === 'legacyAction') {
          if (
            typeof args[0].action !== 'string' ||
            Object.keys(args[0]).some((key) => key !== 'action')
          )
            throw new PlatformError('INVALID_ARGUMENT', '公共操作参数无效。');
          value = await legacyHost.runAction(args[0].action);
        } else if (name === 'lock') value = await lockAll();
        else if (name === 'originalRecordInfo') {
          let size = 0;
          try {
            size = fs.statSync(originalRecordFile).size;
          } catch {}
          value = {
            exists: size > 0,
            size,
            description:
              '原异常记录台的本机加密数据，只读读取；输入原密码后复制到当前融合工作区，原文件不会被修改。',
          };
        } else if (name === 'importOriginalRecords') {
          if (
            typeof args[0].password !== 'string' ||
            args[0].password.length > 1024 ||
            Object.keys(args[0]).some((key) => !['password', 'replaceConfirmed'].includes(key))
          )
            throw new PlatformError('INVALID_ARGUMENT', '读取参数无效。');
          const size = fs.statSync(originalRecordFile).size;
          if (size <= 0 || size > 45 * 1024 * 1024)
            throw new PlatformError(
              'LEGACY_SOURCE_LIMIT',
              '原数据大小超过当前开发版容量，请保留原件并使用完整备份导入。',
            );
          await legacyHost.flush();
          value = await controller.importLegacyRecords({
            raw: fs.readFileSync(originalRecordFile, 'utf8'),
            ...args[0],
          });
          legacyHost.destroyView();
        } else if (name === 'pickLabelWorkbook') value = await labelFiles.pick();
        else if (name === 'exportLabels') value = await labelFiles.export(args[0]);
        else if (name === 'readLabelMemory') value = await labelMemory.read();
        else if (name === 'saveLabelMemory') value = await labelMemory.save(args[0]);
        else if (name === 'appearance') {
          const colors = {
            silver: ['#EEF2F6', '#142333'],
            glass: ['#e9f1fa', '#142333'],
            graphite: ['#181f28', '#edf2f7'],
            contrast: ['#ffffff', '#101820'],
          };
          const colorsForTheme = colors[args[0].theme];
          if (!colorsForTheme) throw new PlatformError('INVALID_THEME', '界面风格无效。');
          window.setTitleBarOverlay({
            color: colorsForTheme[0],
            symbolColor: colorsForTheme[1],
            height: 34,
          });
          value = true;
        } else value = await controller[name](...args);
        if (window.isDestroyed()) throw new PlatformError('SESSION_CHANGED', '窗口已关闭。');
        return { ok: true, value };
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof PlatformError
              ? { code: error.code, message: error.message }
              : { code: 'OPERATION_FAILED', message: '操作未完成，请检查文件、数据或权限。' },
        };
      }
    });
  window.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    lockAll()
      .then(() => {
        legacyHost.dispose();
        biHost.dispose();
        window.destroy();
        app.quit();
      })
      .catch((error) => {
        quitting = false;
        dialog.showErrorBox(
          '暂未关闭',
          error instanceof PlatformError
            ? error.message
            : '当前输入还未保存，请检查数据文件与权限后重试。',
        );
      });
  });
  if (qaRoot) {
    let screenshot = 0;
    const captureInput = async (event, input) => {
      if (input.type === 'keyDown' && input.control && input.shift && input.key === 'F12') {
        event.preventDefault();
        try {
          const image = await window.capturePage();
          fs.writeFileSync(path.join(qaRoot, `desktop-${++screenshot}.png`), image.toPNG());
        } catch {
          fs.writeFileSync(path.join(qaRoot, 'capture-status.txt'), 'Window capture unavailable');
        }
      }
    };
    window.webContents.on('before-input-event', captureInput);
    app.on('web-contents-created', (_event, contents) =>
      contents.on('before-input-event', captureInput),
    );
  }
  window.once('ready-to-show', () => window.show());
  await window.loadFile(path.join(__dirname, 'index.html'));
  if (!window.isVisible()) window.show();
});
app.on('window-all-closed', () => app.quit());
