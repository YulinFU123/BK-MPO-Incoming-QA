'use strict';
const { app, BrowserWindow, dialog, ipcMain, session, Menu, safeStorage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { createWorkspaceController } = require('../workspace-controller');
const { assertJSONData } = require('../../ports/dto');
const themeModel = require('../theme-contract');
const { PlatformError } = require('../../domain/errors');
const {
  createUnifiedRepository,
  restoreUnifiedBackup,
} = require('../../adapters/encrypted/repository');
const { createLegacyHost } = require('../legacy-host');
const { createBIHost } = require('../bi-host');
const { createAnalysisStudioHost } = require('../analysis-studio-host');
const { createHomeOverview } = require('../../application/home-overview-service');
const { createLabelFiles } = require('../label-files');
const { printLabelDocument } = require('../label-print');
const { createModuleStateHost } = require('../module-state-host');
const { createStateEncryption } = require('../state-encryption');
const { createLabelMemory } = require('../label-memory');
const { createManagedWorkspaceHost } = require('../managed-workspace-host');
const { createManagedBIPreview } = require('../managed-bi-preview');
const { ownDesktopInstance } = require('../single-instance');

app.setName('BK_MPO 智能异常管理工作台');
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
  analysisStudio,
  labelFiles,
  labelMemory,
  moduleState,
  managedHost,
  quitting = false;
const page = pathToFileURL(path.join(__dirname, 'index.html')).href;
const routes = [
  'analysisStudio',
  'managedList',
  'managedCreate',
  'managedUpdate',
  'managedDelete',
  'managedRecover',
  'managedLayout',
  'managedReport',
  'managedFields',
  'managedOpen',
  'managedBackup',
  'managedRestore',

  'importModuleStateBackup',
  'readModuleState',
  'saveModuleState',
  'resetModuleState',
  'moduleStateHistory',
  'restoreModuleState',
  'moduleStateProfiles',
  'saveModuleStateProfile',
  'applyModuleStateProfile',
  'backupModuleState',
  'checkModuleState',
  'status',
  'chooseWorkspace',
  'unlock',
  'openDemo',
  'lock',
  'catalog',
  'overview',
  'homeReport',
  'homeOverview',
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
  'managedList',
  'managedRestore',
  'backupModuleState',
  'checkModuleState',
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

const mainInstance = ownDesktopInstance(app, () => window);
app.whenReady().then(async () => {
  if (!mainInstance) return;
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
    title: 'BK_MPO 智能异常管理工作台',
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
      analysisStudio?.abort();
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
    encryption: createStateEncryption(safeStorage, { profile }),
  });
  try {
    moduleState = await createModuleStateHost({
      controller,
      directory: path.join(profile, 'workbench-state-v1'),
      encryption: createStateEncryption(safeStorage, { profile }),
      pickBackup: () =>
        openDialog({
          title: '选择独立配置备份（不包含业务记录）',
          filters: [{ name: '工作台配置备份', extensions: ['sqlite'] }],
          properties: ['openFile'],
        }),
    });
  } catch (error) {
    const failure =
      error instanceof PlatformError
        ? error
        : new PlatformError('STATE_DATABASE_UNAVAILABLE', '配置库无法打开，原文件已保留。');
    moduleState = Object.fromEntries(
      [
        'importModuleStateBackup',
        'readModuleState',
        'saveModuleState',
        'resetModuleState',
        'moduleStateHistory',
        'restoreModuleState',
        'moduleStateProfiles',
        'saveModuleStateProfile',
        'applyModuleStateProfile',
        'backupModuleState',
        'checkModuleState',
      ].map((name) => [name, () => Promise.reject(failure)]),
    );
    moduleState.flush = async () => {};
    moduleState.close = async () => {};
  }
  const flushModuleUI = async () => {
    await window.webContents.executeJavaScript(
      'window.flushModuleState ? window.flushModuleState() : true',
    );
    await moduleState.flush();
  };
  const lockAll = async () => {
    await flushModuleUI();
    // 排版记忆是次要缓存：关闭时保存失败不阻止退出（避免“暂未关闭”反复弹窗），
    // 关键业务数据由 controller.lock / biHost.close / legacyHost.flush 独立保证。
    try {
      await window.webContents.executeJavaScript(
        'window.flushLabelStudio ? window.flushLabelStudio() : true',
      );
    } catch {
      /* 记忆写入失败时静默降级，不阻断关闭 */
    }
    await biHost?.close();
    analysisStudio?.abort();
    await legacyHost?.flush();
    return controller.lock();
  };
  try {
    const preview = createManagedBIPreview({
      directory: path.join(profile, 'managed-workspaces-v1', 'data'),
      moduleDirectory: path.join(profile, 'workbench-state-v1'),
      encryption: createStateEncryption(safeStorage, { profile }),
      python: path.resolve(__dirname, '../../..', 'python/python.exe'),
      script: path.resolve(__dirname, '../lab_preview_worker.py'),
    });
    managedHost = await createManagedWorkspaceHost({
      directory: path.join(profile, 'managed-workspaces-v1'),
      controller,
      encryption: createStateEncryption(safeStorage, { profile }),
      beforeSwitch: lockAll,
      readBI: (input) => preview.read(input),
      closeBI: () => preview.close(),
      saveBackup: () =>
        saveDialog({
          title: '备份工作区（原Windows账户恢复）',
          defaultPath: '工作区备份.bkw',
          filters: [{ name: '本机工作区备份', extensions: ['bkw'] }],
        }),
      pickBackup: () =>
        openDialog({
          title: '恢复本机工作区副本',
          filters: [{ name: '本机工作区备份', extensions: ['bkw'] }],
          properties: ['openFile'],
        }),
    });
  } catch (error) {
    const unavailable = async () => {
      throw new PlatformError(
        'WORKSPACE_CATALOG_UNAVAILABLE',
        '本机工作区目录暂不可用，原数据已保留。请检查用户目录权限，或打开旧文件。',
      );
    };
    managedHost = Object.fromEntries(
      routes.filter((n) => n.startsWith('managed')).map((n) => [n, unavailable]),
    );
    managedHost.close = async () => {};
  }
  const legacyLock = async () => {
    try {
      await flushModuleUI();
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
    onNavigate: (route) => {
      if (!window.isDestroyed()) window.webContents.send('analysis:navigate-request', { route });
    },
    onDataChange: () => {
      if (!window.isDestroyed()) window.webContents.send('analysis:bi-changed');
    },
    moduleState,
    window,
    controller,
    profile,
    onActivity: () => legacyHost.activity(),
    onExit: () => window.close(),
    qa: !!qaRoot,
  });
  analysisStudio = createAnalysisStudioHost({
    controller,
    memory: moduleState,
    profile,
    python: path.resolve(__dirname, '../../..', 'python/python.exe'),
    script: path.resolve(__dirname, '../lab_worker.py'),
    pickFolder: async () => {
      const r = await dialog.showOpenDialog(window, {
        title: '选择BI或产量下载文件夹',
        properties: ['openDirectory'],
      });
      return r.canceled ? null : r.filePaths[0];
    },
    saveFile: async (extension, label) => {
      const r = await dialog.showSaveDialog(window, {
        title: '保存' + label,
        defaultPath: `BK_MPO_${label}_${Date.now()}.${extension}`,
        filters: [{ name: label, extensions: [extension] }],
      });
      return r.canceled ? null : r.filePath;
    },
    pickScheme: async () => {
      const r = await dialog.showOpenDialog(window, {
        title: '读取分析板块方案',
        filters: [{ name: '分析方案JSON', extensions: ['json'] }],
        properties: ['openFile'],
      });
      return r.canceled ? null : r.filePaths[0];
    },
    pickOriginalTemplate: async () => {
      const r = await dialog.showOpenDialog(window, {
        title: '选择含 container 和分类分析表的原始异常品查询工作簿',
        filters: [{ name: '异常品查询模板', extensions: ['xlsx'] }],
        properties: ['openFile'],
      });
      return r.canceled ? null : r.filePaths[0];
    },
    pickBackup: async () => {
      const r = await dialog.showOpenDialog(window, {
        title: '恢复分析资料到空工作区',
        filters: [{ name: '分析资料备份', extensions: ['labpack'] }],
        properties: ['openFile'],
      });
      return r.canceled ? null : r.filePaths[0];
    },
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
        if (name === 'analysisStudio') value = await analysisStudio.request(args[0]);
        else if (name.startsWith('managed')) value = await managedHost[name](...args);
        else if (name === 'backup' && controller.status().managedId)
          value = await managedHost.managedBackup({ id: controller.status().managedId });
        else if (
          [
            'importModuleStateBackup',
            'readModuleState',
            'saveModuleState',
            'resetModuleState',
            'moduleStateHistory',
            'restoreModuleState',
            'moduleStateProfiles',
            'saveModuleStateProfile',
            'applyModuleStateProfile',
            'backupModuleState',
            'checkModuleState',
          ].includes(name)
        )
          value = await moduleState[name](...args);
        else if (name === 'homeOverview') {
          value = await createHomeOverview({
            readRecords: (q) => controller.homeReport(q),
            readBI: async (input) => {
              if (['auto', 'studio'].includes(input.preference.channel)) {
                const native = await analysisStudio.home(input);
                if (native.state !== 'empty' || input.preference.channel === 'studio')
                  return native;
              }
              const { biRange, biPeriod, ...legacyInput } = input;
              return biHost.home(legacyInput);
            },
            session: () => controller.hostContext().sessionId,
            workspaceMode: () => controller.status().dataSourceMode || 'auto',
          })(args[0]);
        } else if (name === 'showLegacy') {
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
          if (!themeModel.themes.includes(args[0].theme))
            throw new PlatformError('INVALID_THEME', '界面风格无效。');
          window.setTitleBarOverlay({ ...themeModel.windowColors(args[0].theme), height: 34 });
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
    // A second close during the asynchronous flush must never be allowed
    // through: window-all-closed would quit the app before the hosts finish
    // writing module state, BI drafts and legacy records.
    if (quitting) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    quitting = true;
    lockAll()
      .then(async () => {
        // 清理阶段尽力而为：任何单一 host 关闭失败都不应卡住退出。
        await Promise.allSettled([
          managedHost.close(),
          moduleState.close(),
          analysisStudio.close(),
        ]);
        try {
          legacyHost.dispose();
        } catch {}
        try {
          biHost.dispose();
        } catch {}
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
}).catch((error) => {
  // Without this handler an initialization rejection leaves a running process
  // with a hidden window, no error message and no close/flush handlers.
  const detail =
    error instanceof PlatformError
      ? error.message
      : `启动初始化失败：${error?.message || String(error)}`;
  try {
    dialog.showErrorBox('启动失败', `${detail}\n\n原有数据文件未修改，请检查程序目录权限后重新启动。`);
  } catch {
    /* headless startup may have no dialog service */
  }
  app.exit(1);
});
app.on('window-all-closed', () => app.quit());
