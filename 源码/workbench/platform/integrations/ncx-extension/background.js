/* BI NC Exporter - 后台：监听导出下载、调用本地小程序 */
importScripts('common.js', 'platform-common.js', 'platform-control.js');

const DATA_NAME = /^data(\s?[（(]\d+[)）])?\.xlsx$/i;
const baseName = (p) =>
  String(p || '')
    .split(/[\\/]/)
    .pop();

async function getArmed() {
  return (await chrome.storage.session.get('armed')).armed || null;
}
async function setArmed(a) {
  if (a) await chrome.storage.session.set({ armed: a });
  else await chrome.storage.session.remove('armed');
}
const fresh = (a) => a && Date.now() - a.armedAt < (a.timeoutSec || 180) * 1000;
function tell(tabId, msg) {
  if (tabId != null) chrome.tabs.sendMessage(tabId, msg, { frameId: 0 }).catch(() => {});
}
function native(msg) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendNativeMessage(NCX.HOST_NAME, msg, (resp) => {
        if (chrome.runtime.lastError)
          resolve({ ok: false, nativeError: true, message: chrome.runtime.lastError.message });
        else resolve(resp || { ok: false, message: '本地小程序没有返回内容' });
      });
    } catch (e) {
      resolve({ ok: false, nativeError: true, message: String((e && e.message) || e) });
    }
  });
}

/* 1. 下载开始：识别本次导出的 data.xlsx */
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  (async () => {
    const a = await getArmed();
    const name = baseName(item.filename);
    if (
      fresh(a) &&
      a.downloadId == null &&
      DATA_NAME.test(name) &&
      (!a.bridge || NCXBridge.isReportDownload(item)) &&
      item.startTime &&
      Date.parse(item.startTime) >= a.armedAt - 2000
    ) {
      a.downloadId = item.id;
      await setArmed(a);
      tell(a.tabId, { type: 'dl-started', name });
      if (a.bridge) {
        suggest({
          filename: 'BK_MPO_Inbox/NCX_' + a.bridge.runId + '.xlsx',
          conflictAction: 'uniquify',
        });
      } else if (a.workMode === 'B') {
        const sub = (a.watchSubfolder || 'NC_Exporter').replace(/[\\/:*?"<>|]/g, '_');
        suggest({ filename: sub + '/' + name, conflictAction: 'uniquify' });
      } else suggest();
      return;
    }
    suggest();
  })().catch(() => {
    try {
      suggest();
    } catch (e) {}
  });
  return true;
});

/* 2. 下载状态变化 */
chrome.downloads.onChanged.addListener(async (delta) => {
  const a = await getArmed();
  if (!a) return;
  if (
    !a.bridge &&
    a.downloadId == null &&
    delta.filename &&
    delta.filename.current &&
    fresh(a) &&
    DATA_NAME.test(baseName(delta.filename.current))
  ) {
    a.downloadId = delta.id;
    await setArmed(a);
    tell(a.tabId, { type: 'dl-started', name: baseName(delta.filename.current) });
  }
  if (delta.id !== a.downloadId || !delta.state) return;
  if (delta.state.current === 'interrupted') {
    await setArmed(null);
    tell(a.tabId, { type: 'dl-result', ok: false, stage: 'download', message: '下载被中断' });
    return;
  }
  if (delta.state.current !== 'complete') return;
  await setArmed(null);
  const [item] = await chrome.downloads.search({ id: delta.id });
  const src = item && item.filename;
  tell(a.tabId, { type: 'dl-done', path: src });
  let r;
  if (a.bridge) {
    try {
      await NCXBridge.receipt(a.bridge, item);
      r = {
        type: 'dl-result',
        ok: true,
        stage: 'watcher',
        message: 'Excel与回执下载完成，等待平台核对分析。',
      };
    } catch (error) {
      r = { type: 'dl-result', ok: false, stage: 'receipt', message: error.message };
    }
  } else if (a.workMode === 'B') {
    r = {
      type: 'dl-result',
      ok: true,
      stage: 'watcher',
      path: src,
      message:
        '已存到下载目录的 ' +
        (a.watchSubfolder || 'NC_Exporter') +
        ' 文件夹，等监视程序转移并启动分析程序',
    };
  } else {
    // 月度：放进文件夹时统一改名为 data.xlsx
    const targetName = a.mode === 'monthly' ? 'data.xlsx' : '';
    const resp = await native({
      action: 'deliver',
      src,
      batPath: a.batPath,
      transferMode: a.transferMode,
      preventDuplicate: a.preventDuplicate,
      launchMethod: a.launchMethod,
      targetName,
    });
    r = Object.assign({ type: 'dl-result', stage: 'host', path: src, mode: a.mode }, resp);
  }
  await chrome.storage.local.set({ lastResult: Object.assign({ at: Date.now() }, r) });
  tell(a.tabId, r);
});

/* 3. 面板消息 */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!['arm', 'disarm', 'openOptions'].includes(msg.type)) return;
  (async () => {
    if (msg.type === 'arm') {
      const s = await NCX.loadSettings();
      const mode = msg.mode === 'monthly' ? 'monthly' : 'daily';
      const bridge = s.platformBridge ? NCXBridge.arm(msg.platform, sender) : null;
      const prior = await getArmed();
      if (fresh(prior) && (prior.tabId !== sender.tab?.id || prior.downloadId != null))
        return { ok: false, message: '另一个下载任务尚未完成，请等待或停止旧任务。' };
      await setArmed({
        tabId: sender.tab && sender.tab.id,
        armedAt: Date.now(),
        downloadId: null,
        timeoutSec: s.downloadTimeout,
        bridge,
        mode,
        workMode: s.workMode,
        batPath: NCX.batFor(s, mode),
        transferMode: s.transferMode,
        preventDuplicate: s.preventDuplicate,
        launchMethod: s.launchMethod,
        watchSubfolder: s.watchSubfolder,
      });
      return { ok: true };
    }
    if (msg.type === 'disarm') {
      await setArmed(null);
      return { ok: true };
    }
    if (msg.type === 'openOptions') {
      chrome.runtime.openOptionsPage();
      return { ok: true };
    }
    return { ok: false };
  })().then(sendResponse, (e) => sendResponse({ ok: false, message: String(e) }));
  return true;
});

/* 4. 工具栏图标：显示/隐藏面板 */
chrome.action.onClicked.addListener((tab) => {
  if (
    tab.id != null &&
    /^https:\/\/[^/]*(powerbi\.com|fabric\.microsoft\.com)\//.test(tab.url || '')
  ) {
    chrome.tabs.sendMessage(tab.id, { type: 'toggle' }, { frameId: 0 }).catch(() => {});
  } else chrome.runtime.openOptionsPage();
});
