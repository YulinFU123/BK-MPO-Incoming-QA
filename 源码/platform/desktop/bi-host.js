'use strict';
const fs = require('node:fs'),
  fsp = require('node:fs/promises'),
  path = require('node:path');
const { randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { PlatformError } = require('../domain/errors');
const { dateRange } = require('../domain/validation');
const { biQualityReport } = require('../adapters/bi/quality-report');
const { startBIWorker } = require('./bi-client');

const BI_PAGES = Object.freeze([
  'daily',
  'trends',
  'groups',
  'home',
  'data',
  'schemes',
  'people',
  'defects',
  'charts',
  'dash',
  'alerts',
  'chk',
  'improve',
  'tools',
]);
const DATA_NAMES = Object.freeze([
  'config.json',
  'config.json.bak',
  'daily_config.json',
  'bi_tasks.json',
  'last_run.json',
  '不良历史数据.csv',
  '导入日志.csv',
  '历史数据库',
  '日报历史',
  '每日原表',
  '分析结果',
  '日报输出',
  '不良分析_控制台.xlsx',
]);
async function copyTree(source, target) {
  const stat = await fsp.lstat(source);
  if (stat.isSymbolicLink())
    throw new PlatformError('BI_LINK_NOT_ALLOWED', 'BI资料含链接，请先提供普通文件副本。');
  if (stat.isDirectory()) {
    await fsp.mkdir(target);
    for (const name of await fsp.readdir(source))
      await copyTree(path.join(source, name), path.join(target, name));
  } else if (stat.isFile()) await fsp.copyFile(source, target, fs.constants.COPYFILE_EXCL);
  else throw new PlatformError('BI_FILE_NOT_SUPPORTED', 'BI资料中包含不支持的文件。');
}
function createBIHost({
  window,
  controller,
  profile,
  onActivity = () => {},
  onExit = () => {},
  qa = false,
}) {
  const { WebContentsView, ipcMain, dialog, shell } = require('electron');
  const root = path.resolve(__dirname, '../..'),
    source = path.join(root, 'bi'),
    ui = path.join(root, 'bi-ui');
  const python = path.join(root, 'python', 'python.exe'),
    url = pathToFileURL(path.join(ui, 'index.html')).href;
  let worker = null,
    view = null,
    starting = null,
    activeContext = null,
    requestedPage = 'daily',
    ready = false,
    maintenance = false,
    disposed = false,
    generation = 0;
  const pendingFlush = new Map();
  let demoFolder = null;
  function context() {
    const value = controller.hostContext();
    if (!value.unlocked) throw new PlatformError('WORKSPACE_LOCKED', '请先打开工作区。');
    return value;
  }
  function dataRoot() {
    const value = context();
    return value.mode === 'file'
      ? value.file + '.bi-data'
      : demoFolder || (demoFolder = path.join(profile, 'bi-demo-' + randomUUID()));
  }
  async function clearDemo() {
    const target = demoFolder;
    demoFolder = null;
    if (!target) return;
    if (
      path.dirname(path.resolve(target)) !== path.resolve(profile) ||
      !path.basename(target).startsWith('bi-demo-')
    )
      throw new PlatformError('BI_DEMO_PATH', '示例清理路径无效。');
    const stat = await fsp.lstat(target).catch(() => null);
    if (stat?.isDirectory() && !stat.isSymbolicLink()) await fsp.rm(target, { recursive: true });
  }
  const trusted = (event) =>
    !disposed &&
    view &&
    event.sender === view.webContents &&
    event.senderFrame === view.webContents.mainFrame &&
    event.senderFrame.url.split('#')[0] === url &&
    controller.status().unlocked;
  async function ensure() {
    context();
    if (worker) return worker;
    if (starting) return starting;
    const sessionId = context().sessionId,
      folder = dataRoot();
    starting = (async () => {
      if (!fs.existsSync(python))
        throw new PlatformError(
          'BI_RUNTIME_UNAVAILABLE',
          '离线 Python 环境包缺失，请使用完整程序目录。',
        );
      if (fs.existsSync(folder) && fs.lstatSync(folder).isSymbolicLink())
        throw new PlatformError('BI_LINK_NOT_ALLOWED', 'BI工作副本目录不能是链接。');
      await fsp.mkdir(folder, { recursive: true });
      if (context().mode === 'demo') {
        const demo = path.join(source, '演示数据', '每日原表'),
          target = path.join(folder, '每日原表');
        if (!fs.existsSync(target) && fs.existsSync(demo)) await copyTree(demo, target);
      }
      const instance = startBIWorker({
        python,
        script: path.join(__dirname, 'bi-worker.py'),
        source,
        data: folder,
      });
      try {
        await instance.ready;
        if (!controller.status().unlocked || context().sessionId !== sessionId)
          throw new PlatformError('SESSION_CHANGED', '工作区已切换。');
        worker = instance;
        activeContext = sessionId;
        return instance;
      } catch (error) {
        instance.abort();
        throw error;
      }
    })().finally(() => {
      starting = null;
    });
    return starting;
  }
  async function request(event, input) {
    if (!trusted(event)) throw new PlatformError('UNTRUSTED_SENDER', '此窗口无权访问BI数据。');
    if (maintenance) throw new PlatformError('BI_BUSY', '正在保留BI备份，请稍后再试。');
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).some((key) => !['route', 'body'].includes(key)) ||
      typeof input.route !== 'string' ||
      input.route.length > 256
    )
      throw new PlatformError('INVALID_ARGUMENT', 'BI请求无效。');
    const instance = await ensure(),
      sessionId = activeContext;
    let value;
    if (input.route === '/fusion/resource') {
      if (!['bi_export_original.js', 'bi_runner_template.js'].includes(input.body?.name))
        throw new PlatformError('INVALID_RESOURCE', '资源不存在。');
      value = fs.readFileSync(path.join(source, 'ui', input.body.name), 'utf8');
    } else if (input.route === '/api/pick') {
      const kind = input.body?.kind;
      if (!['folder', 'file'].includes(kind))
        throw new PlatformError('INVALID_ARGUMENT', '文件选择方式无效。');
      const chosen = await dialog.showOpenDialog(window, {
        title: kind === 'folder' ? '选择BI资料文件夹（读取）' : '选择Excel、CSV或配置资料',
        properties: [kind === 'folder' ? 'openDirectory' : 'openFile'],
        ...(kind === 'file'
          ? { filters: [{ name: 'BI资料', extensions: ['xlsx', 'csv', 'txt', 'json', 'xlsm'] }] }
          : {}),
      });
      const selected = chosen.canceled ? null : chosen.filePaths[0];
      if (selected) await instance.request({ control: 'grant', path: selected });
      value = { path: selected || '' };
    } else if (input.route === '/api/open') {
      const body = input.body || {};
      if (!['file', 'base', 'input', 'history', 'output', 'latest'].includes(body.what))
        throw new PlatformError('INVALID_ARGUMENT', '打开资料的方式无效。');
      let target;
      if (body.what === 'file') target = path.resolve(body.path || '');
      else {
        const paths = body.config?.paths || {};
        target =
          body.what === 'latest'
            ? path.resolve(dataRoot(), paths.output || '分析结果', '不良分析_最新.xlsx')
            : body.what === 'base'
              ? dataRoot()
              : path.resolve(
                  dataRoot(),
                  paths[body.what] ||
                    {
                      input: '每日原表',
                      history: '历史数据库',
                      output: '分析结果',
                      latest: '分析结果/不良分析_最新.xlsx',
                    }[body.what] ||
                    '',
                );
      }
      const relative = path.relative(dataRoot(), target);
      if (relative.startsWith('..') || path.isAbsolute(relative))
        throw new PlatformError('BI_OPEN_NOT_ALLOWED', '只允许打开当前BI工作副本中的资料。');
      if (['input', 'output', 'history'].includes(body.what) && !fs.existsSync(target)) {
        let ancestor = target;
        while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
        const remainder = path.relative(fs.realpathSync(dataRoot()), fs.realpathSync(ancestor));
        if (remainder.startsWith('..') || path.isAbsolute(remainder))
          throw new PlatformError('BI_OPEN_NOT_ALLOWED', '资料目录不能经过工作副本外的链接。');
        await fsp.mkdir(target, { recursive: true });
      }
      if (!fs.existsSync(target)) throw new PlatformError('BI_PATH_MISSING', '资料尚未生成。');
      const real = fs.realpathSync(target),
        realRelative = path.relative(fs.realpathSync(dataRoot()), real);
      if (
        realRelative.startsWith('..') ||
        path.isAbsolute(realRelative) ||
        (!fs.statSync(real).isDirectory() &&
          !['.xlsx', '.csv', '.json', '.txt', '.png'].includes(path.extname(real).toLowerCase()))
      )
        throw new PlatformError('BI_OPEN_NOT_ALLOWED', '此文件类型不能从分析面板启动。');
      const error = await shell.openPath(real);
      if (error)
        throw new PlatformError('BI_OPEN_FAILED', '未能打开资料，请检查是否安装了对应查看软件。');
      value = { ok: true };
    } else if (input.route === '/api/exit') {
      setImmediate(onExit);
      value = { ok: true };
    } else
      value = await instance.request({
        route: input.route,
        ...(Object.hasOwn(input, 'body') ? { body: input.body } : {}),
      });
    if (!trusted(event) || context().sessionId !== sessionId)
      throw new PlatformError('SESSION_CHANGED', '工作区已切换。');
    onActivity();
    return value;
  }
  ipcMain.handle('bi:request', async (event, input) => {
    try {
      return { ok: true, value: await request(event, input) };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof PlatformError ? error.message : 'BI操作未完成，请检查数据与权限。',
      };
    }
  });
  const flushed = (event, id, ok) => {
    if (trusted(event) && pendingFlush.has(id)) {
      pendingFlush.get(id)(ok === true);
      pendingFlush.delete(id);
    }
  };
  const activity = (event) => {
    if (trusted(event)) onActivity();
  };
  ipcMain.on('bi:flush-ready', flushed);
  ipcMain.on('bi:activity', activity);
  function destroyView() {
    ready = false;
    if (view) {
      window.contentView.removeChildView(view);
      view.webContents.close();
      view = null;
    }
    for (const finish of pendingFlush.values()) finish(false);
    pendingFlush.clear();
  }
  async function flush() {
    if (view && ready) {
      const id = randomUUID();
      const ok = await new Promise((resolve) => {
        const timer = setTimeout(() => {
          pendingFlush.delete(id);
          resolve(false);
        }, 15000);
        pendingFlush.set(id, (value) => {
          clearTimeout(timer);
          resolve(value);
        });
        view.webContents.send('bi:flush', id);
      });
      if (!ok)
        throw new PlatformError(
          'BI_NOT_SAVED',
          'BI配置尚未保存或报表正在生成，请完成当前操作后再关闭。',
        );
    }
    if (worker) {
      const status = await worker.request({ route: '/api/status' });
      if (status.running)
        throw new PlatformError('BI_BUSY', 'BI报表正在生成，请等待完成后再关闭。');
    }
  }
  return Object.freeze({
    async show({ section, bounds, theme = 'silver' }) {
      const ticket = ++generation;
      if (!BI_PAGES.includes(section)) throw new PlatformError('INVALID_BI_PAGE', 'BI模块不存在。');
      if (!bounds || ['x', 'y', 'width', 'height'].some((key) => !Number.isFinite(bounds[key])))
        throw new PlatformError('INVALID_BOUNDS', 'BI模块布局无效。');
      await ensure();
      if (ticket !== generation) return { visible: false, cancelled: true };
      requestedPage = section;
      const [width, height] = window.getContentSize(),
        x = Math.max(0, Math.min(width - 1, Math.round(bounds.x))),
        y = Math.max(0, Math.min(height - 1, Math.round(bounds.y)));
      const rect = {
        x,
        y,
        width: Math.max(1, Math.min(width - x, Math.round(bounds.width))),
        height: Math.max(1, Math.min(height - y, Math.round(bounds.height))),
      };
      if (!view) {
        view = new WebContentsView({
          webPreferences: {
            preload: path.join(__dirname, 'bi-preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            devTools: qa,
            spellcheck: false,
          },
        });
        window.contentView.addChildView(view);
        view.setBounds(rect);
        view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        view.webContents.on('will-navigate', (event, target) => {
          if (target.split('#')[0] !== url) event.preventDefault();
        });
        view.webContents.on('did-finish-load', () => {
          ready = true;
          view?.webContents.send('bi:navigate', requestedPage);
        });
        await view.webContents.loadFile(path.join(ui, 'index.html'));
      }
      if (ticket !== generation) return { visible: false, cancelled: true };
      view.setBounds(rect);
      view.setVisible(true);
      if (ready) view.webContents.send('bi:navigate', section);
      if (['silver', 'glass', 'graphite', 'contrast'].includes(theme))
        await view.webContents.executeJavaScript(
          `document.documentElement.dataset.fusionTheme=${JSON.stringify(theme)}`,
        );
      return { visible: true, section };
    },
    hide() {
      generation++;
      view?.setVisible(false);
      return { visible: false };
    },
    flush,
    async quality({ start, end }) {
      dateRange(start, end);
      const sessionId = context().sessionId;
      await flush();
      const instance = await ensure();
      const state = await instance.request({ route: '/api/state' });
      const result = await instance.request({
        route: '/api/analytics',
        body: {
          config: state.config,
          query: { start, end, period: 'day', dimension: 'process', top: 5 },
        },
      });
      if (context().sessionId !== sessionId)
        throw new PlatformError('SESSION_CHANGED', '工作区已切换，请重新核对。');
      return biQualityReport(result, { start, end });
    },
    info() {
      return {
        available: fs.existsSync(python) && fs.existsSync(path.join(source, 'engine.py')),
        pages: BI_PAGES.length,
        started: !!worker,
        storage: '原BI格式，独立明文数据目录；工作区密码仅控制面板访问。',
        backup: 'BI目录与.eap加密备份分别保留。',
      };
    },
    async backup() {
      const sessionId = context().sessionId;
      await flush();
      if (!fs.existsSync(dataRoot()))
        throw new PlatformError('BI_NOT_STARTED', '当前工作区尚未启用BI，暂无BI资料可备份。');
      const chosen = await dialog.showOpenDialog(window, {
        title: '选择BI完整备份保存文件夹（原格式、明文）',
        properties: ['openDirectory', 'createDirectory'],
      });
      if (context().sessionId !== sessionId)
        throw new PlatformError('SESSION_CHANGED', '工作区已切换。');
      if (chosen.canceled) return { cancelled: true };
      const sourceFolder = fs.realpathSync(dataRoot()),
        target = path.join(
          fs.realpathSync(chosen.filePaths[0]),
          'BI完整备份_' +
            new Date().toISOString().replaceAll(':', '-') +
            '_' +
            randomUUID().slice(0, 8),
        );
      const relative = path.relative(sourceFolder, target);
      if (!relative.startsWith('..') && !path.isAbsolute(relative))
        throw new PlatformError('BI_BACKUP_LOCATION', '备份不能放在当前BI数据目录内。');
      maintenance = true;
      try {
        if (worker) {
          const state = await worker.request({ route: '/api/status' });
          if (state.running) throw new PlatformError('BI_BUSY', 'BI报表正在生成，请完成后再备份。');
        }
        await copyTree(sourceFolder, target);
        return { cancelled: false, name: path.basename(target), encrypted: false };
      } finally {
        maintenance = false;
      }
    },
    async importData() {
      if (context().mode !== 'file')
        throw new PlatformError('REAL_WORKSPACE_REQUIRED', '请先新建工作区，再复制原BI资料。');
      const sessionId = context().sessionId,
        target = dataRoot();
      if (worker || starting || (fs.existsSync(target) && fs.readdirSync(target).length))
        throw new PlatformError(
          'BI_COPY_REQUIRES_EMPTY',
          '当前BI副本已有内容。请新建工作区，再复制原BI资料；已有资料不会覆盖。',
        );
      const chosen = await dialog.showOpenDialog(window, {
        title: '选择原BI数据目录（只读复制）',
        properties: ['openDirectory'],
      });
      if (chosen.canceled) return { cancelled: true };
      if (context().sessionId !== sessionId)
        throw new PlatformError('SESSION_CHANGED', '工作区已切换。');
      const sourceFolder = chosen.filePaths[0],
        names = DATA_NAMES.filter((name) => fs.existsSync(path.join(sourceFolder, name)));
      for (const name of fs.readdirSync(sourceFolder))
        if (
          /\.(xlsx|csv)$/i.test(name) &&
          fs.statSync(path.join(sourceFolder, name)).isFile() &&
          !names.includes(name)
        )
          names.push(name);
      if (fs.lstatSync(sourceFolder).isSymbolicLink())
        throw new PlatformError('BI_LINK_NOT_ALLOWED', '请选择原BI资料的真实目录，不使用链接。');
      if (!names.length)
        throw new PlatformError(
          'BI_DATA_NOT_FOUND',
          '未找到BI配置或历史资料，请选择原软件的数据目录。',
        );
      const staging = target + '.copy-' + randomUUID();
      maintenance = true;
      try {
        await fsp.mkdir(staging);
        for (const name of names)
          await copyTree(path.join(sourceFolder, name), path.join(staging, name));
        const configFile = path.join(staging, 'config.json');
        let remapped = false;
        if (fs.existsSync(configFile)) {
          const raw = fs.readFileSync(configFile),
            config = JSON.parse(raw.toString('utf8').replace(/^\uFEFF/, '')),
            copied = new Set(names);
          if (config.paths)
            for (const key of ['input', 'history', 'output'])
              if (config.paths[key]) {
                const resolved = path.resolve(sourceFolder, config.paths[key]),
                  relative = path.relative(sourceFolder, resolved);
                if (relative.startsWith('..') || path.isAbsolute(relative)) {
                  config.paths[key] = {
                    input: '每日原表',
                    history: '历史数据库',
                    output: '分析结果',
                  }[key];
                  remapped = true;
                } else {
                  config.paths[key] = relative;
                  const top = relative.split(path.sep)[0];
                  if (top && !copied.has(top) && fs.existsSync(path.join(sourceFolder, top))) {
                    await copyTree(path.join(sourceFolder, top), path.join(staging, top));
                    copied.add(top);
                  }
                }
              }
          if (remapped) fs.writeFileSync(path.join(staging, '导入前目录配置.json'), raw);
          fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
        }
        if (fs.existsSync(target)) await fsp.rmdir(target);
        await fsp.rename(staging, target);
        return { cancelled: false, copied: names.length, remapped, sourceUnchanged: true };
      } finally {
        maintenance = false;
      }
    },
    async close() {
      if (maintenance) throw new PlatformError('BI_BUSY', 'BI资料正在复制，请完成后再锁定。');
      if (starting) await starting;
      await flush();
      if (worker) await worker.close();
      worker = null;
      activeContext = null;
      generation++;
      destroyView();
      await clearDemo();
    },
    abort() {
      generation++;
      destroyView();
      worker?.abort();
      worker = null;
      activeContext = null;
    },
    dispose() {
      disposed = true;
      destroyView();
      worker?.abort();
      worker = null;
      ipcMain.removeHandler('bi:request');
      ipcMain.removeListener('bi:flush-ready', flushed);
      ipcMain.removeListener('bi:activity', activity);
    },
  });
}
module.exports = { createBIHost, BI_PAGES, DATA_NAMES, copyTree };
