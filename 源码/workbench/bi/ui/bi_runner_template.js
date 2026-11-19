/* Generated into the BI console script. No local-server requests or credentials. */
(async () => {
  const job = __DAILY_JOB_JSON__;
  if (window.NC_DAILY_RUNNING) {
    alert('已有日报脚本正在运行，请等待结束。');
    return;
  }
  window.NC_DAILY_RUNNING = true;
  let result = { id: job.id, status: 'failed' };
  const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  try {
    if (window.PBI_EXPORT_TEST_RUNNING || window.PBI_SCAN_RUNNING) {
      throw new Error('已有导出或筛选扫描正在运行，请结束后重试。');
    }
    function documents() {
      const found = [];
      function visit(doc) {
        if (found.includes(doc)) return;
        found.push(doc);
        for (const frame of doc.querySelectorAll('iframe')) {
          try { if (frame.contentDocument) visit(frame.contentDocument); } catch (_) { /* Inaccessible frames stay inaccessible. */ }
        }
      }
      visit(document);
      return found;
    }
    function findInput(kind) {
      const pattern = kind === 'start' ? /开始日期|Start date/i : /结束日期|End date/i;
      const inputs = documents().flatMap(doc => [...doc.querySelectorAll('input')]);
      const matches = inputs.filter(input => {
        const rect = input.getBoundingClientRect();
        const style = input.ownerDocument.defaultView.getComputedStyle(input);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' &&
          pattern.test(input.getAttribute('aria-label') || '');
      });
      if (matches.length !== 1) throw new Error('日期控件不可唯一识别，请检查NC Details页面是否完全加载。');
      return matches[0];
    }
    function parseDate(value) {
      const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(String(value).trim());
      if (!match) throw new Error('BI日期格式暂不支持，请使用年/月/日。');
      return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
    }
    function setDate(kind, value) {
      // Re-find controls after every change because Power BI can replace their DOM nodes.
      const input = findInput(kind);
      const view = input.ownerDocument.defaultView;
      const setter = Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, 'value').set;
      input.focus();
      setter.call(input, value.replace(/-/g, '/'));
      input.dispatchEvent(new view.Event('input', { bubbles: true }));
      input.dispatchEvent(new view.Event('change', { bubbles: true }));
      input.blur();
    }
    if (job.start > parseDate(findInput('end').value)) {
      setDate('end', job.end);
      await pause(700);
      setDate('start', job.start);
    } else {
      setDate('start', job.start);
      await pause(700);
      setDate('end', job.end);
    }
    await pause(3000);
    if (parseDate(findInput('start').value) !== job.start || parseDate(findInput('end').value) !== job.end) {
      throw new Error('BI日期未保持目标值，未请求导出。');
    }
    // Input values alone do not prove model refresh: the downloaded filter text is checked locally.
    __DAILY_EXPORT_BODY__
    result = { ...window.PBI_EXPORT_TEST_RESULT, id: job.id, requestedStart: job.start, requestedEnd: job.end };
  } catch (error) {
    result.error = String(error);
    result.status = 'failed';
  } finally {
    window.NC_DAILY_RUNNING = false;
    const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'NCDetails_job_' + job.id + '.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    console.log('BI导出请求结果；实际下载、入库和日报状态请看本地工作台。', result);
  }
})();
