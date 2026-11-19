'use strict';
window.createWorkspaceNavigation = ({ status, view, navigate, act, beforeSearch, afterSearch }) => {
  const model = window.WorkbenchNavigation;
  const sourceMode = () => status().dataSourceMode || 'auto';
  const $ = (id) => document.getElementById(id);
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  let enabled = false,
    results = [],
    cursor = 0,
    searchTicket = 0,
    searchPending = false;
  function destination(id) {
    return id.startsWith('action:') ? model.getAction(id.slice(7)) : model.getRoute(id);
  }
  function activate(id) {
    if (!enabled || !model.destinationAllowed(id, sourceMode())) return;
    if (id.startsWith('action:')) act(id.slice(7));
    else navigate(id);
  }
  function row(id) {
    const info = destination(id);
    if (!info) throw Error('功能目录存在无效入口');
    const button = make('button', 'function-row');
    button.type = 'button';
    button.dataset.destination = id;
    button.disabled = !enabled;
    const copy = make('span', 'function-copy');
    copy.append(make('strong', '', info.title), make('small', '', info.description));
    button.append(copy, make('span', 'function-open', '打开'));
    return button;
  }
  function section(title, items, description) {
    const block = make('section', 'function-section');
    const head = make('div', 'function-section-head');
    head.append(make('h2', '', title));
    if (description) head.append(make('p', '', description));
    block.append(head);
    const visible = items.filter((id) => model.destinationAllowed(id, sourceMode()));
    for (const id of visible) block.append(row(id));
    block.hidden = !visible.length;
    return block;
  }
  function initHubs() {
    for (const id of [
      'homeMain',
      'homeAside',
      'analysisMain',
      'analysisAside',
      'dataImports',
      'dataRules',
      'settingsMain',
      'settingsAside',
    ])
      $(id).replaceChildren();
    $('homeMain').append(
      section(
        '日常处理',
        ['legacy-entry', 'legacy-records', 'legacy-followup'],
        '先登记，再查询核对，持续跟进处理。',
      ),
    );
    $('homeAside').append(
      section('常用操作', [
        'action:import-record-xlsx',
        'action:import-quantity',
        'legacy-analysis',
        'security',
      ]),
    );
    $('analysisMain').append(
      section(
        '文件夹自由分析',
        ['analysis-studio'],
        '指定下载路径，核对字段，筛选日周月数据，组合A4图表。',
      ),
      section('异常记录', ['legacy-analysis'], '按记录条数、异常分类与处理进度。'),
      section('检验数量', ['overview'], '按检验件数与不良件数计算，保留分母口径。'),
    );
    $('analysisAside').append(section('BI工作台', ['bi-center']));
    $('dataImports').append(
      section('标签与工具', ['label-studio'], '按编号生成标签，尺寸、间距与纸张统一排版。'),
      section('核对与追溯', ['quality-check'], '先确认数据是否齐全，再解读变化。'),
      section('导入与明细', [
        'action:import-record-xlsx',
        'action:import-record-csv',
        'action:import-quantity',
        'import',
        'data',
      ]),
    );
    $('dataRules').append(section('异常字段与校验', ['legacy-settings']));
    $('settingsMain').append(section('显示与访问', ['legacy-appearance', 'legacy-security']));
    $('settingsAside').append(
      section(
        '备份与恢复',
        ['security', 'action:backup-records'],
        '加密工作区、BI完整目录和兼容备份分别管理。',
      ),
    );
  }
  function renderBiTools() {
    const tools = make('div', 'lab-workbench-tools');
    tools.setAttribute('role', 'group');
    tools.setAttribute('aria-label', '历史报表与工具');
    const mode = sourceMode();
    if (!model.allows('analysis-studio', mode)) return tools;

    const history = make('select');
    history.setAttribute('aria-label', '历史工具');
    const placeholder = make('option', '', '历史工具');
    placeholder.value = '';
    placeholder.disabled = true;
    history.append(placeholder);
    for (const { title, routes } of window.BIWorkflow.groups) {
      const group = make('optgroup');
      group.label = title.replace(/^\d+\s+/, '');
      for (const id of routes) {
        if (!model.allows(id, mode)) continue;
        const option = make('option', '', model.getRoute(id).title);
        option.value = id;
        group.append(option);
      }
      if (group.children.length) history.append(group);
    }
    history.value = '';
    history.onchange = () => {
      const route = history.value;
      history.value = '';
      activate(route);
    };
    tools.append(history);
    return tools;
  }
  function setEnabled(value) {
    enabled = value === true;
    document
      .querySelectorAll('[data-view],[data-destination]')
      .forEach((node) => (node.disabled = !enabled));
    $('openFunctions').disabled = !enabled;
    if (!enabled) {
      searchTicket++;
      if ($('functionDialog').open) $('functionDialog').close();
    }
  }
  function renderNav() {
    const nav = $('primaryNavigation');
    nav.replaceChildren();
    const active = model.primaryFor(view(), sourceMode());
    for (const id of model.primaryForMode(sourceMode())) {
      const route = model.getRoute(id),
        button = make('button', 'nav-item', route.title);
      button.type = 'button';
      button.dataset.view = id;
      button.disabled = !enabled;
      button.classList.toggle('active', id === active);
      button.title = route.title;
      const shapes = {
        home: 'M2 7.5 8 2l6 5.5V14H2ZM6 14V9h4v5',
        'legacy-entry': 'M2 6V2h4m4 0h4v4M2 10v4h4m4 0h4v-4M5 5v6m3-6v6m3-6v6',
        'legacy-records': 'M3 2h10v12H3ZM6 5h4M6 8h4M6 11h4',
        'legacy-followup': 'M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2Zm0 2v4l3 2',
        'analysis-hub': 'M2 14h12M4 12V8m4 4V3m4 9V6',
        'data-center': 'M2 4h5l2 2h5v8H2ZM2 4V2h5l2 2',
        'settings-hub': 'M2 4h12M2 8h12M2 12h12M5 2v4m6 0v4m-6 0v4',
      };
      const symbol = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      for (const [key, value] of Object.entries({
        viewBox: '0 0 16 16',
        width: 14,
        height: 14,
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': 1.3,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        'aria-hidden': 'true',
        class: 'home-nav-symbol',
      }))
        symbol.setAttribute(key, value);
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      line.setAttribute('d', shapes[id] || shapes['data-center']);
      symbol.append(line);
      button.prepend(symbol);
      if (id === active) button.setAttribute('aria-current', 'page');
      nav.append(button);
      if (id === active) {
        const peers = model.peers(view(), sourceMode());
        if (peers.length) {
          const list = make('div', 'context-navigation');
          list.setAttribute('aria-label', route.title + '的相关功能');
          for (const item of peers) {
            const leaf = make('button', 'nav-item context-item', item.title);
            leaf.type = 'button';
            leaf.dataset.view = item.id;
            leaf.disabled = !enabled;
            leaf.title = item.title;
            if (item.id === view()) {
              leaf.classList.add('active');
              leaf.setAttribute('aria-current', 'page');
            }
            list.append(leaf);
          }
          nav.append(list);
        }
      }
    }
  }
  function setView() {
    initHubs();
    renderNav();
    const actions = model
      .contextActions(view(), sourceMode())
      .filter((id) =>
        model.destinationAllowed(id.startsWith('route:') ? id : 'action:' + id, sourceMode()),
      );
    for (const [index, id] of ['toolbarImport', 'toolbarSecondary'].entries()) {
      const button = $(id),
        key = actions[index];
      button.hidden = !key;
      if (!key) continue;
      const route = key.startsWith('route:') ? model.getRoute(key.slice(6)) : null,
        action = route || model.getAction(key);
      button.textContent = action.title;
      button.title = action.description;
      button.disabled = !enabled;
      button.dataset.commonAction = key;
    }
    $('homeWorkspace').textContent =
      status().mode === 'demo'
        ? '当前是示例工作区，修改在关闭示例后清空。'
        : '当前工作区已打开，异常记录与数量使用加密文件；BI目录单独备份。';
  }
  function renderResults() {
    results = model.search($('functionQuery').value, sourceMode());
    cursor = 0;
    const list = $('functionResults');
    list.replaceChildren();
    for (const [index, item] of results.entries()) {
      const option = make('button', 'function-result');
      option.type = 'button';
      option.tabIndex = -1;
      option.id = 'function-result-' + index;
      option.setAttribute('role', 'option');
      option.dataset.resultIndex = index;
      const copy = make('span', 'function-copy');
      copy.append(make('strong', '', item.title), make('small', '', item.description));
      option.append(
        copy,
        make('span', 'function-tag', item.kind === 'action' ? '操作' : item.section),
      );
      list.append(option);
    }
    $('functionEmpty').hidden = results.length > 0;
    $('functionCount').textContent = results.length + ' 项';
    highlight();
  }
  function highlight() {
    [...$('functionResults').children].forEach((node, index) => {
      node.classList.toggle('selected', index === cursor);
      node.setAttribute('aria-selected', String(index === cursor));
      if (index === cursor) {
        $('functionQuery').setAttribute('aria-activedescendant', node.id);
        node.scrollIntoView({ block: 'nearest' });
      }
    });
    if (!results.length) $('functionQuery').removeAttribute('aria-activedescendant');
  }
  function choose(index) {
    const item = results[index];
    if (!item) return;
    $('functionDialog').close();
    activate((item.kind === 'action' ? 'action:' : '') + item.id);
  }
  async function openSearch() {
    if (!enabled || $('functionDialog').open || document.querySelector('dialog[open]')) return;
    const ticket = ++searchTicket;
    searchPending = true;
    try {
      await beforeSearch();
      if (ticket !== searchTicket || !enabled) return;
      $('functionQuery').value = '';
      renderResults();
      $('functionDialog').showModal();
      $('functionQuery').focus();
    } catch {
      afterSearch();
    } finally {
      searchPending = false;
    }
  }
  function init() {
    renderNav();
    initHubs();
    setEnabled(false);
    $('primaryNavigation').addEventListener('click', (event) => {
      const button = event.target.closest('[data-view]');
      if (button && !button.disabled && model.allows(button.dataset.view, sourceMode()))
        navigate(button.dataset.view);
    });
    $('workspaceView').addEventListener('click', (event) => {
      const button = event.target.closest('[data-destination]');
      if (button && !button.disabled) activate(button.dataset.destination);
    });
    $('openFunctions').onclick = openSearch;
    $('functionClose').onclick = () => $('functionDialog').close();
    $('functionQuery').oninput = renderResults;
    $('functionQuery').onkeydown = (event) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        if (!results.length) return;
        if (event.key === 'Home') cursor = 0;
        else if (event.key === 'End') cursor = results.length - 1;
        else
          cursor =
            (cursor + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
        highlight();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        choose(cursor);
      }
    };
    $('functionResults').addEventListener('pointerdown', (event) => event.preventDefault());
    $('functionResults').onclick = (event) => {
      const node = event.target.closest('[data-result-index]');
      if (node) choose(Number(node.dataset.resultIndex));
    };
    $('functionDialog').addEventListener('close', () => {
      searchTicket++;
      $('functionQuery').value = '';
      $('functionResults').replaceChildren();
      afterSearch();
    });
  }
  return Object.freeze({
    init,
    renderBiTools,
    setEnabled,
    setView,
    openSearch,
    isOpen: () => $('functionDialog').open || searchPending,
  });
};
