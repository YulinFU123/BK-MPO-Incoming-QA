'use strict';
const { app, BrowserWindow, ipcMain, session, Menu, dialog, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { Vault, open } = require('./vault');
const { ensureDailyBackup } = require('./daily-backup');
const { authBounds, createWindowShell } = require('./window-shell');
const testMode = process.argv.includes('--quality-qa');
const qaVisible = testMode && process.argv.includes('--qa-visible');
const qaData = testMode && process.argv.find(v => v.startsWith('--qa-data='));
const qaIdleArg = testMode && process.argv.find(v => v.startsWith('--qa-idle-ms='));
const qaIdleMs = qaIdleArg ? Math.max(1000,Number(qaIdleArg.slice(13))||0) : 0;
app.setName('QualityDeskOffline');
const dataDirectory=qaData ? path.resolve(qaData.slice(10)) : path.join(app.getPath('appData'), 'QualityDeskOffline');
fs.mkdirSync(dataDirectory,{recursive:true});
app.setPath('userData',dataDirectory);
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-domain-reliability');
let win, vault, windowShell, lastActivity = Date.now(), idleMinutes = 10, authBusy = false, mayClose = false, lockPending = false;
const pageURL = pathToFileURL(path.join(__dirname, 'index.html')).href;
const trusted = e => !!win && e.sender === win.webContents && e.senderFrame?.url.split('#')[0] === pageURL;
const result = fn => { try { return { ok: true, value: fn() }; } catch (e) { return { ok: false, error: e.message }; } };
function timeoutValue(value) { return [0,5,10,15,30].includes(Number(value)) ? Number(value) : 10; }
function auth(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!trusted(event)) return { ok: false, error: '来源无效。' };
    if (authBusy) return { ok: false, error: '正在处理，请稍候。' };
    authBusy = true;
    try { const value = await fn(...args); lastActivity = Date.now(); lockPending = false; return { ok: true, value }; }
    catch(e) { return { ok: false, error: e.message }; }
    finally { authBusy = false; }
  });
}
if (!testMode && !app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
  app.whenReady().then(() => {
    vault = new Vault(path.join(app.getPath('userData'), 'vault.json'));
    Menu.setApplicationMenu(null);
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !/^(file:|devtools:|data:|blob:)/.test(details.url) }));
    session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => callback(permission === 'clipboard-sanitized-write'));
    session.defaultSession.setPermissionCheckHandler((wc, permission) => permission === 'clipboard-sanitized-write');
    ipcMain.handle('vault:status', e => trusted(e) ? { ok:true, value:{exists:vault.exists()} } : {ok:false,error:'来源无效。'});
    auth('vault:setup', (password, data) => vault.setup(password, data));
    auth('vault:unlock', password => vault.unlock(password));
    auth('vault:password', (current, next) => vault.changePassword(current, next));
    auth('vault:restore', (raw, password) => vault.restore(raw, password));
    auth('vault:read-backup', async (raw, password) => { if (!vault.key) throw Error('请先解锁。'); const decoded = await open(raw, password); decoded.key.fill(0); return decoded.data; });
    ipcMain.on('vault:save', (e, data) => { e.returnValue = trusted(e) ? result(() => { if(authBusy) throw Error('密码操作进行中，请稍后保存。'); vault.save(data); idleMinutes=timeoutValue(data.security?.idleMinutes);try{ensureDailyBackup(dataDirectory,()=>vault.backup(data));}catch(error){return {backupWarning:'数据已保存，但每日备份失败：'+error.message}} }) : {ok:false,error:'来源无效。'}; });
    ipcMain.on('vault:backup', (e, data) => { e.returnValue = trusted(e) ? result(() => vault.backup(data)) : {ok:false,error:'来源无效。'}; });
    ipcMain.on('vault:lock', e => { e.returnValue = trusted(e) ? result(() => { if(authBusy) throw Error('密码操作进行中，请稍后锁定。'); vault.lock(); lockPending=false; windowShell.setMode('auth'); }) : {ok:false,error:'来源无效。'}; });
    ipcMain.on('vault:activity', e => { if(trusted(e)) { lastActivity=Date.now(); lockPending=false; } });
    ipcMain.on('vault:timeout', (e, minutes) => { if(trusted(e)) { idleMinutes=timeoutValue(minutes); lastActivity=Date.now(); } });
    ipcMain.on('app:close-ready', e => { if(trusted(e)) { mayClose=true; win.close(); } });
    ipcMain.handle('window:state', e => trusted(e) ? result(() => windowShell.state()) : {ok:false,error:'来源无效。'});
    ipcMain.handle('window:mode', (e, mode) => trusted(e) ? result(() => {
      if (mode === 'workspace' && !vault.key) throw Error('请先解锁工作台。');
      if (mode === 'auth' && vault.key) throw Error('请先保存并锁定工作台。');
      return windowShell.setMode(mode);
    }) : {ok:false,error:'来源无效。'});
    ipcMain.handle('window:control', (e, action) => trusted(e) ? result(() => windowShell.control(action)) : {ok:false,error:'来源无效。'});
    win = new BrowserWindow({ ...authBounds(screen.getPrimaryDisplay().workArea), frame:false, resizable:false, maximizable:false, show:false, backgroundColor:'#f7f9fc', title:'异常记录台', icon:path.join(__dirname,'icon.png'), webPreferences:{preload:path.join(__dirname,'preload.js'),nodeIntegration:false,contextIsolation:true,sandbox:true,devTools:testMode,spellcheck:false,offscreen:testMode&&!qaVisible,backgroundThrottling:!testMode} });
    windowShell = createWindowShell(win, screen);
    win.once('ready-to-show', () => { if (!testMode || qaVisible) win.show(); });
    win.webContents.setWindowOpenHandler(() => ({action:'deny'}));
    win.webContents.on('will-navigate', (e, url) => { if(url.split('#')[0]!==pageURL) e.preventDefault(); });
    // A fresh main document must authenticate again, including an explicit reload.
    win.webContents.on('did-start-navigation', (e, url, isInPlace, isMainFrame) => {
      if (isMainFrame && !isInPlace && url.split('#')[0] === pageURL) {
        vault.lock();
        windowShell.setMode('auth');
      }
    });
    win.on('close', event => { if(vault.key&&!mayClose) { event.preventDefault(); win.webContents.send('app:close-request'); } });
    win.webContents.on('render-process-gone', () => { vault.lock(); mayClose=true; dialog.showErrorBox('界面已关闭','请重新打开软件。已保存的数据仍在加密文件中。'); win.close(); });
    win.loadFile(path.join(__dirname,'index.html'));
    setInterval(() => { if(vault.key && idleMinutes && !authBusy && !lockPending && Date.now()-lastActivity>=(qaIdleMs||idleMinutes*60000)) {lockPending=true;win.webContents.send('vault:lock-request');} },testMode?1000:5000).unref();
  });
}
app.on('window-all-closed', () => { if(vault) vault.lock(); app.quit(); });
