'use strict';
(() => {
  const model = window.BIWorkflow;
  const memory = {
    loaded: false,
    loading: null,
    revision: 0,
    data: model.defaults(),
    dirty: 0,
    saved: 0,
    saving: null,
    timer: null,
    error: '',
    pending: {},
  };
  const make = (tag, text, cls) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  };
  async function call(action, extra = {}) {
    const result = await window.bi.request({
      route: '/fusion/workflow-memory',
      body: { action, ...extra },
    });
    if (!result.ok)
      throw Error(typeof result.error === 'string' ? result.error : 'BI收纳设置未保存。');
    return result.value;
  }
  function feedback() {
    const node = document.getElementById('bi-workflow-memory');
    if (node)
      node.textContent =
        memory.error ||
        (memory.loaded
          ? memory.saved === memory.dirty
            ? '收纳状态已记住'
            : '收纳状态待保存'
          : '正在读取收纳设置…');
  }
  function applyDisclosure() {
    const node = document.getElementById('bi-acquisition');
    if (node) node.open = memory.data.acquisitionOpen;
    feedback();
  }
  async function load() {
    if (memory.loaded) return;
    if (memory.loading) return memory.loading;
    memory.loading = (async () => {
      const row = await call('read');
      if (row.corrupt) throw Error('BI收纳设置损坏，请恢复配置或重置本模块，业务数据未改变。');
      memory.revision = row.revision;
      memory.data = { ...model.preferences(row.data), ...memory.pending };
      memory.pending = {};
      memory.loaded = true;
      memory.error = '';
      if (memory.dirty) await save();
    })()
      .catch((error) => {
        memory.error = error.message;
      })
      .finally(() => {
        memory.loading = null;
        // Restoring layout must not recreate live form controls or lose focus.
        if (S.page === 'daily') applyDisclosure();
        else feedback();
      });
    return memory.loading;
  }
  async function save() {
    clearTimeout(memory.timer);
    if (!memory.loaded) throw Error('请先重新读取BI收纳设置。');
    if (memory.saving) return memory.saving;
    memory.saving = (async () => {
      while (memory.saved !== memory.dirty) {
        const seq = memory.dirty,
          data = model.preferences(memory.data);
        const row = await call('save', { data, expectedRevision: memory.revision });
        memory.revision = row.revision;
        memory.saved = seq;
        memory.error = '';
      }
    })()
      .catch((error) => {
        memory.error = error.message;
        throw error;
      })
      .finally(() => {
        memory.saving = null;
        feedback();
      });
    return memory.saving;
  }
  function remember(details, key) {
    details.open = memory.data[key];
    details.addEventListener('toggle', () => {
      if (details.open === memory.data[key]) return;
      memory.data = { ...memory.data, [key]: details.open };
      if (!memory.loaded) memory.pending[key] = details.open;
      memory.dirty++;
      clearTimeout(memory.timer);
      if (memory.loaded) memory.timer = setTimeout(() => save().catch(() => {}), 350);
      feedback();
    });
  }
  const originalPanel = biPanel;
  biPanel = function () {
    const box = originalPanel(),
      summary = box.querySelector(':scope > summary');
    box.classList.add('bi-acquisition');
    box.id = 'bi-acquisition';
    summary.textContent = '扩展下载文件接收（可选）';
    const inbox = box.querySelector('.ncx-inbox-panel');
    box.append(
      make(
        'p',
        '已有 Excel 可直接使用下方「手动导入」。扩展下载的文件可在这里接收。',
        'bi-workflow-note',
      ),
    );
    if (inbox) box.append(inbox);
    remember(box, 'acquisitionOpen');
    const state = make('p', '', 'bi-workflow-note');
    state.id = 'bi-workflow-memory';
    state.setAttribute('role', 'status');
    const retry = make('button', '重试收纳记忆', 'btn');
    retry.type = 'button';
    retry.onclick = async () => {
      try {
        if (memory.loaded) await save();
        else await load();
      } catch (error) {
        memory.error = error.message;
        feedback();
      }
    };
    const reset = make('button', '恢复默认收纳', 'btn');
    reset.type = 'button';
    reset.onclick = async () => {
      try {
        if (!memory.loaded) await load();
        if (!memory.loaded) throw Error(memory.error || '配置尚未读取。');
        await save();
        const row = await call('reset', { expectedRevision: memory.revision });
        memory.revision = row.revision;
        memory.data = model.preferences(row.data);
        memory.dirty = memory.saved = 0;
        applyDisclosure();
      } catch (error) {
        memory.error = error.message;
        feedback();
      }
    };
    box.append(state, retry, reset);
    if (!memory.loaded && !memory.loading && !memory.error) queueMicrotask(load);
    queueMicrotask(feedback);
    return box;
  };
  const originalImport = dailyImportPanel,
    originalFilters = dailyFilters;
  dailyImportPanel = function () {
    const node = originalImport();
    node.id = 'bi-local-import';
    return node;
  };
  dailyFilters = function () {
    const node = originalFilters();
    node.id = 'bi-local-filters';
    return node;
  };
  function showAt(id) {
    const node = document.getElementById(id);
    if (!node) return toast('页面尚未就绪，请稍后重试。', 'bad');
    if (node.tagName === 'DETAILS') node.open = true;
    node.scrollIntoView({ block: 'start', behavior: 'auto' });
  }
  function action(label, work, disabled = false) {
    const button = make('button', label, 'btn');
    button.type = 'button';
    button.disabled = disabled;
    button.onclick = async () => {
      if (button.disabled) return;
      button.disabled = true;
      try {
        await work();
      } catch (error) {
        toast(error.message || '操作未完成，请重试。', 'bad');
      } finally {
        button.disabled = disabled;
      }
    };
    return button;
  }
  function draw() {
    const page = document.getElementById('page');
    if (!page || !S.cfg) return;
    if (S.page === 'data')
      for (const head of page.querySelectorAll('.card > .hd')) {
        const title = head.querySelector('h3'),
          note = head.querySelector('p');
        if (title?.textContent === '全局筛选规则') {
          title.textContent = '历史报表全局筛选规则';
          if (note)
            note.textContent =
              '适用于历史分析、历史报表及首页的历史来源；不覆盖日报或首页的额外筛选。';
        }
        if (title?.textContent === '数据源' && note)
          note.textContent =
            '建议使用选择文件夹按钮；相对路径按当前工作区的BI数据副本解析，不是EXE所在目录。';
      }
    let root = document.getElementById('bi-workflow-ribbon');
    if (!root) {
      root = make('section', undefined, 'bi-workflow-ribbon');
      root.id = 'bi-workflow-ribbon';
      page.before(root);
    }
    const shortcutsOpen = document.getElementById('bi-workflow-shortcuts')?.open === true;
    root.replaceChildren();
    root.setAttribute('aria-label', 'BI当前流程与数据范围');
    const daily = S.page === 'daily',
      trend = S.page === 'trends';
    const q =
      trend && !TR.dirty && TR.resultKey === trendKey()
        ? TR.result?.query || trendQuery()
        : S.cfg.analytics?.query || {};
    const context = model.context({
      page: S.page,
      daily: D.q,
      history: q,
      dirty: daily
        ? !!D.result && D.key !== dkey(D.q)
        : trend && (TR.dirty || TR.resultKey !== trendKey()),
    });
    root.append(
      make(
        'strong',
        `当前：${context.lane} · ${window.WorkbenchNavigation.getRoute('bi-' + S.page)?.title || ''}`,
      ),
    );
    const controls = make('div', undefined, 'bi-workflow-actions');

    controls.append(
      action('1　导入数据', () => (daily ? showAt('bi-local-import') : window.bi.navigate('data'))),
    );
    controls.append(
      action('2　筛选范围', () =>
        daily ? showAt('bi-local-filters') : window.bi.navigate('trends'),
      ),
    );
    controls.append(
      action(
        (daily && D.working) || (trend && TR.pending) ? '3　分析中…' : '3　更新分析',
        () => (daily ? dailyAnalyze() : trend ? loadTrend() : window.bi.navigate('trends')),
        daily ? !!D.working : trend && TR.pending,
      ),
    );
    controls.append(
      action(daily ? '4　导出日报素材' : trend ? '4　导出当前趋势' : '4　完整Excel报表', () => {
        if (daily) return dailyExport();
        if (!trend) return window.bi.navigate('home');
        const button = [...page.querySelectorAll('button')].find(
          (x) => x.textContent.trim() === '导出当前趋势 Excel',
        );
        if (!button || button.disabled) return toast('请先更新当前历史趋势，再导出。', 'bad');
        button.click();
      }),
    );
    if (daily) controls.append(action('扩展文件接收', () => showAt('bi-acquisition')));
    const more = make('select');
    more.setAttribute('aria-label', 'BI全部功能');
    const placeholder = make('option', '全部功能…');
    placeholder.value = '';
    more.append(placeholder);
    for (const group of model.groups) {
      const optgroup = make('optgroup');
      optgroup.label = group.title;
      for (const route of group.routes) {
        const option = make('option', window.WorkbenchNavigation.getRoute(route).title);
        option.value = route.slice(3);
        option.selected = route === 'bi-' + S.page;
        optgroup.append(option);
      }
      more.append(optgroup);
    }
    more.onchange = () => {
      if (more.value) window.bi.navigate(more.value);
    };
    controls.append(more);
    const shortcuts = make('details', undefined, 'bi-shortcuts');
    shortcuts.id = 'bi-workflow-shortcuts';
    shortcuts.open = shortcutsOpen;
    shortcuts.append(
      make('summary', '流程快捷操作'),
      controls,
      make('p', context.filters, 'bi-workflow-note'),
    );
    root.append(
      action('返回BI工作台', () => window.bi.navigate('center')),
      shortcuts,
      make(
        'p',
        `来源：${context.scope}；日期：${context.range}；处置：${context.status}`,
        'bi-workflow-note',
      ),
      ...((daily && D.result && D.key !== dkey(D.q)) ||
      (trend && (TR.dirty || TR.resultKey !== trendKey()))
        ? [make('p', context.notice, 'bi-workflow-note')]
        : []),
    );
  }
  const originalRender = render;
  render = function () {
    originalRender();
    draw();
  };
  const originalGo = go;
  go = function (page) {
    const previous = S.page;
    originalGo(page);
    if (previous !== page && model.pages.includes('bi-' + page)) window.bi.navigate(page);
  };
  for (const event of ['input', 'change'])
    document.addEventListener(event, (event) => {
      // Only refresh the range readout for page fields. Rebuilding the ribbon
      // while typing in its own select/search popup would steal keyboard focus.
      if (document.getElementById('page')?.contains(event.target)) queueMicrotask(draw);
    });
  window.BIWorkflowMemory = {
    flush: async () => {
      if (memory.loading) await memory.loading;
      if (memory.dirty !== memory.saved) await save();
    },
  };
  window.addEventListener('pagehide', () => clearTimeout(memory.timer));
  if (S.cfg) draw();
})();
