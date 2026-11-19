(() => {
  const section = document.createElement('section');
  section.innerHTML =
    '<h2>平台联动与定时导出</h2><p>独立开发分支，不替换原可用扩展。专用文件夹：下载/BK_MPO_Inbox。平台中选择同一个目录，设置独立来源范围并启用自动接收。</p><p><label><input id="ncxb-enabled" type="checkbox">启用平台联动（不调用BAT，不剪切下载文件）</label></p><p><label><input id="ncxb-schedule" type="checkbox">每天自动尝试导出上一工作日</label> <input id="ncxb-time" type="time" value="08:30"></p><button class="btn" id="ncxb-save">保存联动设置</button> <button class="btn" id="ncxb-run">立即导出并联动</button><p id="ncxb-status" role="status"></p><p>需保留一个已登录的目标报表页面，浏览器保持运行。定时可能因休眠或策略延后；不会自动登录。自动失败会停止，当天不无限重试。原筛选设置仍在上方配置。</p>';
  document.querySelector('main').prepend(section);
  const $ = (id) => document.getElementById(id),
    status = $('ncxb-status');
  chrome.storage.local.get(['platformBridge', 'platformBridgeResult']).then((result) => {
    const value = result.platformBridge || { enabled: false, schedule: false, time: '08:30' };
    $('ncxb-enabled').checked = value.enabled;
    $('ncxb-schedule').checked = value.schedule;
    $('ncxb-time').value = value.time;
    status.textContent = result.platformBridgeResult?.message || '尚未启用平台联动。';
  });
  async function send(type) {
    const result = await chrome.runtime.sendMessage({
      type,
      config: {
        enabled: $('ncxb-enabled').checked,
        schedule: $('ncxb-schedule').checked,
        time: $('ncxb-time').value,
      },
    });
    status.textContent = result.message || '操作未完成';
  }
  $('ncxb-save').onclick = () =>
    send('ncx-bridge-save').catch((error) => (status.textContent = error.message));
  $('ncxb-run').onclick = () =>
    send('ncx-bridge-run').catch((error) => (status.textContent = error.message));
})();
