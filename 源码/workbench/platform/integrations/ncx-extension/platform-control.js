/* Service-worker companion. Only uses the user's existing logged-in report tab. */
const NCXBridge = (() => {
  const ALARM = 'bk-mpo-export-check';
  const report = (url) => {
    try {
      const u = new URL(url);
      return u.protocol === 'https:' && u.hostname === 'app.powerbi.com' ? u.pathname : '';
    } catch {
      return '';
    }
  };
  const validDate = (value) =>
    typeof value === 'string' &&
    /^\d{4}-\d\d-\d\d$/.test(value) &&
    new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
  const name = (path) =>
    String(path || '')
      .split(/[\\/]/)
      .pop();
  function isReportDownload(item) {
    return [item.url, item.finalUrl, item.referrer].some(
      (url) => typeof url === 'string' && /^(blob:)?https:\/\/app\.powerbi\.com\//.test(url),
    );
  }
  function arm(input, sender) {
    if (
      !input ||
      !validDate(input.start) ||
      !validDate(input.end) ||
      input.start > input.end ||
      !report(input.source) ||
      !sender.tab ||
      report(sender.tab.url) !== report(input.source)
    )
      throw Error('本次导出日期或来源不完整，未绑定平台下载。');
    const filters = input.filters;
    if (
      !filters ||
      !['floors', 'connectors'].every(
        (key) =>
          Array.isArray(filters[key]) &&
          filters[key].length > 0 &&
          filters[key].length <= 2000 &&
          filters[key].every(
            (value) => typeof value === 'string' && value.length > 0 && value.length <= 512,
          ),
      )
    )
      throw Error('楼层或连接器核对范围缺失，未绑定下载。');
    return {
      filters,
      runId: crypto.randomUUID().replaceAll('-', ''),
      period: { start: input.start, end: input.end },
      filterVerified: input.filterVerified === true,
      source: input.source,
    };
  }
  async function receipt(run, item) {
    if (!item || item.state !== 'complete' || name(item.filename) !== 'NCX_' + run.runId + '.xlsx')
      throw Error('下载名称或完成状态不匹配，未生成完成回执。');
    const value = {
      format: 'BK-MPO-NCX-EXPORT',
      version: 1,
      ...run,
      file: name(item.filename),
      downloadComplete: true,
      downloadId: item.id,
      completedAt: new Date().toISOString(),
    };
    const id = await chrome.downloads.download({
      url: 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(value)),
      filename: 'BK_MPO_Inbox/NCX_' + run.runId + '_complete.json',
      saveAs: false,
      conflictAction: 'uniquify',
    });
    for (let round = 0; round < 60; round++) {
      const [current] = await chrome.downloads.search({ id });
      if (current?.state === 'complete') return value;
      if (current?.state === 'interrupted') throw Error('回执下载中断；Excel保留。');
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw Error('回执尚未完成，平台不会导入不完整任务。');
  }
  async function ensureAlarm() {
    const { platformBridge } = await chrome.storage.local.get('platformBridge');
    if (platformBridge?.enabled && platformBridge.schedule) {
      if (!(await chrome.alarms.get(ALARM)))
        await chrome.alarms.create(ALARM, { periodInMinutes: 1 });
    } else await chrome.alarms.clear(ALARM);
  }
  async function start() {
    const settings = await NCX.loadSettings();
    if (!settings.platformBridge) throw Error('请先启用平台联动。');
    const target = report(settings.reportUrl);
    if (!target) throw Error('请先填写有效的Power BI报表地址。');
    const tabs = (await chrome.tabs.query({ url: 'https://app.powerbi.com/*' })).filter(
      (tab) => report(tab.url) === target,
    );
    if (tabs.length !== 1)
      throw Error('请保留一个已登录的目标报表标签页；不会自动登录或猜测标签。');
    const response = await chrome.tabs.sendMessage(
      tabs[0].id,
      { type: 'ncx-scheduled-run' },
      { frameId: 0 },
    );
    if (!response?.ok) throw Error(response?.message || '目标页面未就绪。');
    return { ok: true, message: '已通知目标报表执行筛选和导出；下载完成仍需单独核对。' };
  }
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== ALARM) return;
    const { platformBridge: config } = await chrome.storage.local.get('platformBridge');
    if (!config?.enabled || !config.schedule) return;
    const now = new Date(),
      day = NCX.ymd(now),
      at = NCX.pad(now.getHours()) + ':' + NCX.pad(now.getMinutes());
    if (at < config.time || config.lastAttemptDay === day) return;
    config.lastAttemptDay = day;
    await chrome.storage.local.set({ platformBridge: config });
    try {
      const result = await start();
      await chrome.storage.local.set({
        platformBridgeResult: { at: new Date().toISOString(), ...result },
      });
    } catch (error) {
      await chrome.storage.local.set({
        platformBridgeResult: { at: new Date().toISOString(), ok: false, message: error.message },
      });
    }
  });
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (!['ncx-bridge-save', 'ncx-bridge-run'].includes(message.type)) return;
    if (sender.url !== chrome.runtime.getURL('options.html')) {
      reply({ ok: false, message: '来源不受支持。' });
      return;
    }
    (async () => {
      if (message.type === 'ncx-bridge-run') return start();
      const input = message.config;
      if (
        !input ||
        typeof input.enabled !== 'boolean' ||
        typeof input.schedule !== 'boolean' ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)
      )
        throw Error('定时设置无效。');
      const old = (await chrome.storage.local.get('platformBridge')).platformBridge || {};
      await chrome.storage.local.set({
        platformBridge: {
          enabled: input.enabled,
          schedule: input.schedule,
          time: input.time,
          lastAttemptDay: old.lastAttemptDay || '',
        },
      });
      await ensureAlarm();
      return { ok: true, message: '联动设置已保存；工作日期沿用原扩展的上一工作日规则。' };
    })().then(reply, (error) => reply({ ok: false, message: error.message }));
    return true;
  });
  chrome.runtime.onStartup.addListener(() => ensureAlarm().catch(() => {}));
  chrome.runtime.onInstalled.addListener(() => ensureAlarm().catch(() => {}));
  ensureAlarm().catch(() => {});
  return { arm, receipt, isReportDownload };
})();
