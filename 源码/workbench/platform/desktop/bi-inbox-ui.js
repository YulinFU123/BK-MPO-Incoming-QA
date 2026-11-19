'use strict';
// Independent receipt receiver. No browser control, credentials or new server.
(() => {
  const state = {
    row: null,
    loading: false,
    busy: false,
    message: '尚未读取接收配置',
    latest: null,
    timer: null,
  };
  const original = biPanel;
  const node = (tag, text) => {
    const e = document.createElement(tag);
    if (text) e.textContent = text;
    return e;
  };
  async function call(action, extra = {}) {
    const result = await window.bi.request({ route: '/fusion/inbox', body: { action, ...extra } });
    if (!result.ok)
      throw Error(
        typeof result.error === 'string' ? result.error : result.error?.message || '接收未完成',
      );
    return result.value;
  }
  function schedule() {
    clearTimeout(state.timer);
    if (state.row?.data.enabled) state.timer = setTimeout(tick, 10000);
  }
  async function tick() {
    if (state.busy) {
      schedule();
      return;
    }
    state.busy = true;
    try {
      const result = await call('poll');
      const done = result.results.filter((r) => r.state === 'done');
      if (done.length) state.latest = done.at(-1);
      state.message =
        result.results.map((r) => r.message).join('；') ||
        `已接收${result.completedCount}次，没有新的完整回执。`;
    } catch (error) {
      state.message = error.message;
    } finally {
      state.busy = false;
      schedule();
      update();
    }
  }
  async function load() {
    if (state.loading || state.row) return;
    state.loading = true;
    try {
      state.row = await call('read');
      state.message = '配置按当前工作区独立保存。';
      schedule();
    } catch (error) {
      state.message = error.message;
    } finally {
      state.loading = false;
      if (S.page === 'daily') render();
    }
  }
  function update() {
    const target = document.getElementById('ncx-inbox-status');
    if (target) target.textContent = state.message;
  }
  biPanel = function () {
    const box = original();
    if (!state.row && !state.loading) queueMicrotask(load);
    const panel = node('details');
    panel.className = 'ncx-inbox-panel';
    panel.open = true;
    panel.append(node('summary', '扩展下载后：本地接收与入库'));
    panel.append(
      node(
        'p',
        '使用本次联动扩展的专用下载目录 BK_MPO_Inbox。完整回执与Excel同时就绪后才核对入库；原下载文件保留。',
      ),
    );
    const status = node('p', state.message);
    status.id = 'ncx-inbox-status';
    status.setAttribute('role', 'status');
    const data = state.row?.data;
    function button(label, work) {
      const b = node('button', label);
      b.className = 'btn';
      b.type = 'button';
      b.disabled = !data || state.busy;
      b.onclick = async () => {
        state.busy = true;
        b.disabled = true;
        try {
          await work();
        } catch (error) {
          state.message = error.message;
        } finally {
          state.busy = false;
          schedule();
          render();
        }
      };
      return b;
    }
    if (data) {
      panel.append(node('p', data.folder || '尚未选择接收目录'));
      panel.append(
        button('选择专用接收目录', async () => {
          const result = await call('pick');
          if (!result.cancelled) state.row = result;
        }),
      );
      const scope = node('input');
      scope.value = data.scope;
      scope.maxLength = 128;
      scope.placeholder = '例如 BK5F_NC明细（同一筛选范围保持同名）';
      const floor = node('input');
      floor.value = data.floor;
      floor.maxLength = 128;
      floor.placeholder = '可留空；填写后逐行核对楼层';
      const scopeLabel = node('label', '来源范围');
      scopeLabel.append(scope);
      const floorLabel = node('label', '限定楼层');
      floorLabel.append(floor);
      const enabled = node('input');
      enabled.type = 'checkbox';
      enabled.checked = data.enabled;
      const replace = node('input');
      replace.type = 'checkbox';
      replace.checked = data.replace;
      const enableLabel = node('label', ' 自动接收（平台和BI引擎运行期间，每10秒检查）');
      enableLabel.prepend(enabled);
      const replaceLabel = node('label', ' 允许更新同日期的完整快照（保留旧版，默认关闭）');
      replaceLabel.prepend(replace);
      panel.append(scopeLabel, floorLabel, enableLabel, replaceLabel);
      panel.append(
        button('保存接收设置', async () => {
          state.row = await call('save', {
            data: {
              ...data,
              scope: scope.value.trim(),
              floor: floor.value.trim(),
              enabled: enabled.checked,
              replace: replace.checked,
            },
            expectedRevision: state.row.revision,
          });
          state.message = '当前工作区接收设置已保存。';
        }),
      );
      const check = button('立即检查', async () => {});
      check.onclick = () => tick();
      panel.append(check);
      if (state.latest)
        panel.append(
          button('查看最近一次分析', async () => {
            const q = window.BIWorkflow.latestQuery(D.q, state.latest);
            await dailyAnalyze(q);
            state.message = `本次${state.latest.analysis.count}条，数量合计${state.latest.analysis.quantity}；不良率需要另行核对产量分母。`;
          }),
        );
      panel.append(
        button('重置本模块设置', async () => {
          if (!confirm('重置接收目录和自动接收设置？历史数据与原文件保留。')) return;
          state.row = await call('reset', { expectedRevision: state.row.revision });
          state.latest = null;
          state.message = '本模块已重置。';
        }),
      );
    }
    panel.append(status);
    box.append(panel);
    return box;
  };
  window.addEventListener('pagehide', () => clearTimeout(state.timer));
  if (S.cfg && S.page === 'daily') render();
})();
