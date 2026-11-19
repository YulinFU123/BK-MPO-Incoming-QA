'use strict';
const fs = require('node:fs'),
  fsp = require('node:fs/promises'),
  path = require('node:path');
const { randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { PlatformError } = require('../domain/errors');
const { dateRange } = require('../domain/validation');
const { biQualityReport } = require('../adapters/bi/quality-report');
const themeModel = require('./theme-contract');
const { startBIWorker } = require('./bi-client');
const { preferences, changesData } = require('../domain/home-source');

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
  moduleState = null,
  onDataChange = () => {},
  onNavigate = () => {},
}) {
  const { WebContentsView, ipcMain, dialog, shell } = require('electron');
  const root = path.resolve(__dirname, '../..'),
    source = path.join(root, 'bi'),
    ui = path.join(root, 'bi-ui');
  const python = path.join(root, 'python', 'python.exe'),
    url = pathToFileURL(path.join(ui, 'index.html')).href;
  let inboxHost = null;
  let worker = null,
    view = null,
    loadingView = null,
    starting = null,
    activeContext = null,
    requestedPage = 'daily',
    ready = false,
    maintenance = false,
    disposed = false,
    generation = 0;
  const pendingFlush = new Map();
  let demoFolder = null;
  const STUDIO_STATE = Object.freeze({ scope: 'module', module: 'analysis-studio' });
  const grantedLinks = new Set();
  let linkCache = { at: 0, folder: '', mapping: null };
  // Mirrors bi/engine.py ROLE_DEFAULT: the daily panel identifies a column's
  // role by its header text. Reusing the same table keeps import and report in
  // lockstep (e.g. Workflow Step in Charge → 责任站点, not 责任工序).
  const COLUMN_ROLE = Object.freeze({
    'Work Date': '业务日期', 'Report Date': '记录时间',
    'Employee in Charge': '责任员工', 'Workflow Category in Charge': '责任工序',
    'Workflow Step in Charge': '责任站点', 'Defect Code': '不良代码',
    'Defect Code Category': '不良大类', 'Shift': '班别', 'Sum of Qty': '数量',
    'Serial Number': '序列号', 'Process Type in Charge': '产品类别备用',
    'Connector Type': '连接器类型', 'Product Type': '产品类型', 'Mfg Order': '工单',
  });
  // Fallback for non-standard / Chinese headers the panel cannot auto-detect:
  // the role the user picked in the import module, carried over by meaning.
  const ROLE_MAP = Object.freeze({
    date: '业务日期', quantity: '数量', defect: '不良代码', employee: '责任员工',
    process: '责任工序', shift: '班别', product: '产品类型', serial: '序列号',
  });
  const BI_ROLES = Object.freeze(new Set([
    '业务日期', '记录时间', '责任员工', '责任工序', '责任站点', '不良代码', '不良大类',
    '班别', '数量', '序列号', '产品类别备用', '连接器类型', '产品类型', '工单', '不使用',
  ]));
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
  // The download folder AND the column→role mapping chosen in the main window's
  // "BI数据与导入" are reused by the daily report. The header is configured once,
  // not twice ("一个导入 一个每日报表制作" should not mean configuring it twice).
  async function linkedInputFolder() {
    const now = Date.now();
    if (now - linkCache.at < 1000) return linkCache.folder;
    let folder = '', mapping = null;
    try {
      if (moduleState && typeof moduleState.readModuleState === 'function') {
        const row = await moduleState.readModuleState(STUDIO_STATE);
        const data = row && !row.corrupt ? row.data : null;
        const sources = data && Array.isArray(data.sources) ? data.sources : [];
        const usable = (s) => s && s.kind === 'defects' && s.confirmed === true &&
          typeof s.folder === 'string' && s.folder.trim() && path.isAbsolute(s.folder.trim());
        const active = sources.find((s) => s && s.id === data.activeSource);
        const chosen = (active && usable(active) ? active : null) || sources.find(usable);
        if (chosen) {
          const candidate = path.resolve(chosen.folder.trim());
          const stat = fs.lstatSync(candidate);
          // realpath keeps grant() and PathPolicy.checked() resolving identically.
          if (stat.isDirectory() && !stat.isSymbolicLink()) folder = fs.realpathSync(candidate);
          mapping = importedFieldmap(chosen);
        }
      }
    } catch {}
    linkCache = { at: now, folder, mapping };
    return folder;
  }
  // Convert the main window's mapping (role→column id) + columns (id→label) into
  // the BI panel's fieldmap (column name→{role, show}). Unknown columns and roles
  // are skipped so the panel still auto-detects anything not explicitly mapped.
  function importedFieldmap(source) {
    if (!source || !source.mapping || !Array.isArray(source.columns)) return null;
    const byId = new Map();
    for (const col of source.columns) if (col && col.id && col.label) byId.set(col.id, col.label);
    const out = {};
    for (const [role, columnId] of Object.entries(source.mapping)) {
      const label = byId.get(columnId);
      if (!label) continue;
      // Standard BI header text wins: it matches exactly how the daily engine
      // classifies columns, avoiding cross-pipeline role drift.
      let biRole = COLUMN_ROLE[label] || ROLE_MAP[role];
      if (!biRole || !BI_ROLES.has(biRole)) continue;
      out[label] = { role: biRole, show: true };
    }
    return Object.keys(out).length ? out : null;
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
    if (worker) {
      if (activeContext !== context().sessionId)
        throw new PlatformError('SESSION_CHANGED', 'BI来源属于此前工作区，请重新打开当前工作区。');
      return worker;
    }
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
        grantedLinks.clear();
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
    // One folder, one header mapping: both are configured in the main window's
    // "BI数据与导入" and inherited here so the daily report needs no second setup.
    let linked = '';
    try {
      linked = await linkedInputFolder();
      const forwarded = input.body?.config?.paths?.input;
      // Authorise only real, non-link directories: the linked download folder
      // and any absolute source folder the panel itself was told to use.
      for (const folder of [linked, typeof forwarded === 'string' && path.isAbsolute(forwarded) ? path.resolve(forwarded) : '']) {
        if (!folder || grantedLinks.has(folder)) continue;
        const stat = await fsp.lstat(folder).catch(() => null);
        if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) continue;
        // Read-only: source files outside the working copy stay read-only.
        await instance.request({ control: 'grant', path: folder });
        grantedLinks.add(folder);
      }
    } catch {
      linked = '';
    }
    let value;
    if (input.route === '/fusion/inbox') {
      if (!inboxHost)
        inboxHost = require('./bi-inbox-host').createInboxHost({
          memory: moduleState,
          active: () => context().sessionId,
          pick: async () => {
            const r = await dialog.showOpenDialog(window, {
              title: '选择扩展专用下载目录 BK_MPO_Inbox',
              properties: ['openDirectory'],
            });
            return r.canceled ? null : r.filePaths[0];
          },
          grant: (folder) => instance.request({ control: 'grant', path: folder }),
          request: (message) => instance.request(message),
        });
      value = await inboxHost(input.body);
    } else if (input.route === '/fusion/defect-memory') {
      value = await require('./bi-filter-state').filterMemory(moduleState, input.body, {
        scope: 'module',
        module: 'daily-defects',
      });
    } else if (input.route === '/fusion/workflow-memory') {
      value = await require('./bi-filter-state').filterMemory(moduleState, input.body, {
        scope: 'module',
        module: 'bi-workflow',
      });
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
      // The linked download folder lives outside the working copy but is the
      // user's own chosen source folder, so "打开原表文件夹" may open it.
      const linkedOpen = body.what === 'input' && !!linked && path.resolve(target) === linked;
      if (!linkedOpen && (relative.startsWith('..') || path.isAbsolute(relative)))
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
        (!linkedOpen && (realRelative.startsWith('..') || path.isAbsolute(realRelative))) ||
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
    } else {
      let body = Object.hasOwn(input, 'body') ? input.body : undefined;
      // Inherited mapping is injected at read time only. Strip it before it is
      // persisted so config.json never becomes a second, stale source of truth:
      // any column still mapped exactly as imported is reset to 不使用, leaving
      // only roles the user actually chose inside this panel.
      if (linked && input.route === '/api/save' && body?.config?.fieldmap) {
        const imported = linkCache.folder === linked ? linkCache.mapping : null;
        if (imported) {
          const fieldmap = { ...body.config.fieldmap };
          let changed = false;
          for (const [column, entry] of Object.entries(imported)) {
            const cur = fieldmap[column];
            const curRole = cur && typeof cur === 'object' ? cur.role : cur;
            if (curRole === entry.role) {
              fieldmap[column] = { ...(typeof cur === 'object' ? cur : {}), role: '不使用' };
              changed = true;
            }
          }
          if (changed) body = { ...body, config: { ...body.config, fieldmap } };
        }
      }
      // While linked, "导入后归档原表" would move originals out of the folder
      // the main window imports from, and would also demand write access to it.
      if (linked && body?.config?.P?.['导入后归档原表'] === '是') {
        body = {
          ...body,
          config: {
            ...body.config,
            P: { ...body.config.P, '导入后归档原表': '否' },
          },
        };
      }
      value = await instance.request({
        route: input.route,
        ...(body !== undefined ? { body } : {}),
      });
      if (linked && input.route === '/api/state' && value?.config?.paths) {
        // Downloaded BI exports have arbitrary names; the default data*.xlsx
        // rule would otherwise find nothing in the linked folder.
        const paths = { ...value.config.paths, input: linked };
        if (paths.pattern === 'data*.xlsx') paths.pattern = '*.xlsx';
        const P = value.config.P?.['导入后归档原表'] === '是'
          ? { ...value.config.P, '导入后归档原表': '否' }
          : value.config.P;
        // Inherit the column→role mapping configured during import. Only fill
        // columns the panel has not explicitly mapped yet; never overwrite a
        // role the user chose here.
        let config = { ...value.config, paths, P };
        let inherited = null;
        const imported = linkCache.folder === linked ? linkCache.mapping : null;
        if (imported && value.config.fieldmap && typeof value.config.fieldmap === 'object') {
          const fieldmap = { ...value.config.fieldmap };
          const applied = {};
          for (const [column, entry] of Object.entries(imported)) {
            const current = fieldmap[column];
            const currentRole = current && typeof current === 'object' ? current.role : current;
            if (currentRole && currentRole !== '不使用') continue;
            fieldmap[column] = entry;
            applied[column] = entry.role;
          }
          if (Object.keys(applied).length) {
            config = { ...config, fieldmap };
            inherited = applied;
          }
        }
        value = { ...value, config, linkedSource: linked, inheritedFieldmap: inherited };
      }
    }
    if (!trusted(event) || context().sessionId !== sessionId)
      throw new PlatformError('SESSION_CHANGED', '工作区已切换。');
    if (changesData(input.route, value)) onDataChange();
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
  const navigate = (event, section) => {
    if (trusted(event) && (section === 'center' || BI_PAGES.includes(section)))
      onNavigate(section === 'center' ? 'bi-center' : 'bi-' + section);
  };
  ipcMain.on('bi:flush-ready', flushed);
  ipcMain.on('bi:activity', activity);
  ipcMain.on('bi:navigate-request', navigate);
  function destroyView() {
    ready = false;
    loadingView = null;
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
        view.setVisible(false);
        window.contentView.addChildView(view);
        view.setBounds(rect);
        view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        view.webContents.on('will-navigate', (event, target) => {
          if (target.split('#')[0] !== url) event.preventDefault();
        });
        const owned = view;
        view.webContents.on('did-finish-load', () => {
          if (owned !== view || owned.webContents.isDestroyed()) return;
          ready = true;
          owned.webContents.send('bi:navigate', requestedPage);
        });
        const load = view.webContents.loadFile(path.join(ui, 'index.html'));
        loadingView = load.catch(() => {
          // A rejected loadFile used to poison the cached view forever: every
          // later show() awaited the same rejected promise. Rebuild instead.
          if (view === owned) destroyView();
          throw new PlatformError(
            'BI_VIEW_LOAD_FAILED',
            'BI 页面加载失败，已重置视图，请重试打开 BI 工作台；原数据未修改。',
          );
        });
        loadingView.catch(() => {});
      }
      await loadingView;
      if (ticket !== generation || !view || view.webContents.isDestroyed())
        return { visible: false, cancelled: true };
      view.setBounds(rect);
      const owned = view;
      await owned.webContents.executeJavaScript(themeModel.embeddedScript(theme, 'bi'));
      if (ticket !== generation || owned !== view || owned.webContents.isDestroyed())
        return { visible: false, cancelled: true };
      owned.setVisible(true);
      if (ready) view.webContents.send('bi:navigate', section);
      return { visible: true, section };
    },
    hide() {
      generation++;
      view?.setVisible(false);
      return { visible: false };
    },
    flush,
    async home(input) {
      const preference = preferences(input.preference);
      dateRange(input.query.start, input.query.end);
      const sessionId = context().sessionId;
      if (!worker && !fs.existsSync(dataRoot()))
        return { state: 'empty', message: '当前工作区尚无BI来源，显示人工异常记录。' };
      await flush();
      if (context().sessionId !== sessionId)
        throw new PlatformError('SESSION_CHANGED', '工作区已变化。');
      const instance = await ensure();
      const result = await instance.request({
        route: '/api/fusion/home',
        body: { ...input, preference },
      });
      if (context().sessionId !== sessionId)
        throw new PlatformError('SESSION_CHANGED', '工作区已变化。');
      return result;
    },
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
        onDataChange();
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
      inboxHost = null;
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
      inboxHost = null;
    },
    dispose() {
      disposed = true;
      destroyView();
      worker?.abort();
      worker = null;
      ipcMain.removeHandler('bi:request');
      ipcMain.removeListener('bi:flush-ready', flushed);
      ipcMain.removeListener('bi:activity', activity);
      ipcMain.removeListener('bi:navigate-request', navigate);
    },
  });
}
module.exports = { createBIHost, BI_PAGES, DATA_NAMES, copyTree };
