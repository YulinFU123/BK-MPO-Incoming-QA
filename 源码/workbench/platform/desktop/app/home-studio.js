'use strict';
window.createHomeStudio = ({
  api,
  getContext,
  onNavigate,
  onAction,
  onFunctionSearch,
  onAnalysisTab,
}) => {
  const Q = window.WorkspaceQuery;
  let currentRoute = 'home';
  const model = window.HomeWorkspaces,
    G = window.HomeGraphics,
    ADDRESS = { scope: 'module', module: 'home-workspaces-v2' },
    SOURCE = { scope: 'module', module: 'home-data-source' },
    BI_COLUMNS = { scope: 'module', module: 'home-bi-columns' },
    NAV = { scope: 'global', module: 'home-navigation' };
  const $ = (id) => document.getElementById(id),
    node = (tag, cls, text) => {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text !== undefined) e.textContent = text;
      return e;
    };
  const button = (label, fn, cls = '') => {
    const b = node('button', 'hs-button ' + cls, label);
    b.type = 'button';
    b.onclick = fn;
    return b;
  };
  const icon = (name) => {
    const paths = {
      plus: 'M8 2v12M2 8h12',
      search: 'M7 2a5 5 0 1 0 0 10A5 5 0 0 0 7 2Zm4 9 4 4',
      scan: 'M2 6V2h4m4 0h4v4M2 10v4h4m4 0h4v-4M5 5v6m3-6v6m3-6v6',
      records: 'M3 1h10v14H3ZM6 4h4M6 7h4M6 10h4',
      cube: 'm8 1 6 3.5v7L8 15l-6-3.5v-7Zm-6 3.5 6 3.5 6-3.5M8 8v7',
      clock: 'M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2Zm0 2v4l3 2',
      check: 'M2 8l4 4 8-8',
      chart: 'M2 14h12M4 11V7m4 4V2m4 9V5',
      gear: 'M2 4h12M2 8h12M2 12h12M5 2v4m6 0v4m-6 0v4',
      folder: 'M2 4h5l2 2h5v8H2ZM2 4V2h5l2 2',
      refresh: 'M13 5A6 6 0 1 0 14 10M13 1v4H9',
      download: 'M8 1v9m-4-4 4 4 4-4M2 11v4h12v-4',
      save: 'M2 2h10l2 2v10H2Zm3 0v4h6V2M5 10h6v4',
      filter: 'M2 4h12l-4.5 5.5v4l-3 1.5v-5.5Z',
      chevron: 'm5 3 5 5-5 5',
    };
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [k, v] of Object.entries({
      viewBox: '0 0 16 16',
      width: 16,
      height: 16,
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 1.6,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
    }))
      s.setAttribute(k, v);
    const p = document.createElementNS(s.namespaceURI, 'path');
    p.setAttribute('d', paths[name] || paths.chart);
    s.append(p);
    return s;
  };
  const ib = (label, name, fn, cls = '') => {
    const b = button(label, fn, cls);
    b.prepend(icon(name));
    return b;
  };
  let resizeFrame = 0,
    observedWidth = 0,
    observedHeight = 0;
  let arrangingPanels = false;
  let homeColumns = { sources: {} };
  let data = model.defaults(),
    sourcePreference = { mode: 'auto', channel: 'auto', dailyScope: '', employee: '' },
    nav = { expanded: ['records', 'analysis', 'data', 'system'] },
    ready = false,
    opening = null,
    generation = 0,
    ticket = 0,
    report = null,
    error = '',
    busy = false,
    settingsTab = 'analysis',
    filtersOpen = false,
    queryTimer = null,
    detailTicket = 0;
  const HINT_KEY = 'hs-home-hint-v1';
  const hintSeen = () => {
    try {
      return localStorage.getItem(HINT_KEY) === '1';
    } catch {
      return false;
    }
  };
  const markHintSeen = () => {
    try {
      localStorage.setItem(HINT_KEY, '1');
    } catch {
      /* non-critical */
    }
  };
  const temporary = new Map();
  const transient = () => {
    if (!temporary.has(data.activeId))
      temporary.set(data.activeId, {
        search: '',
        page: 1,
        sort: { ...(active()?.sort || Q.defaultSort()) },
      });
    return temporary.get(data.activeId);
  };
  const active = () => data.views.find((v) => v.id === data.activeId);
  const client = window.createModuleStateClient({
    api,
    onStatus: (value) => {
      const e = $('hsSaveState');
      if (e) {
        e.textContent = {
          saved: '布局已保存',
          pending: '配置待保存',
          saving: '正在保存',
          failed: '未保存 · 请重试',
        }[value];
        e.dataset.state = value;
      }
    },
    onError: (e) => {
      error = e.message;
      showError();
    },
  });
  const localToday = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const shift = (d, n) => {
    const x = new Date(d + 'T00:00:00Z');
    x.setUTCDate(x.getUTCDate() + n);
    return x.toISOString().slice(0, 10);
  };
  function scope() {
    const v = active(),
      cat = getContext().catalog || {},
      today = localToday();
    const { start, end } = Q.resolve(
      {
        range: v.range,
        start: v.start,
        end: v.end,
        datasetId: v.datasetId,
        grain: v.grain,
        sort: v.sort,
      },
      today,
      v.range === 'all' && report?.biSource?.range
        ? {
            start: [cat.dateRange?.start || today, report.biSource.range.start].sort()[0],
            end: [cat.dateRange?.end || today, report.biSource.range.end].sort().at(-1),
          }
        : cat.dateRange,
    );
    const q = transient();
    return {
      start,
      end,
      datasetId: v.datasetId || cat.datasets?.[0]?.id || '',
      filters: { ...v.filters },
      grain: v.grain,
      search: q.search,
      page: q.page,
      pageSize: 10,
      sort: { ...q.sort },
    };
  }
  function dirty() {
    if (!ready) return;
    client.change(ADDRESS, model.validate(data));
  }
  function showError() {
    const e = $('hsError');
    if (e) {
      e.hidden = !error;
      e.textContent = error;
    }
  }
  async function init() {
    if (ready) return true;
    if (opening) return opening;
    const epoch = generation;
    opening = (async () => {
      try {
        const [row, n, source, columns] = await Promise.all([
          client.open(ADDRESS),
          client.open(NAV),
          client.open(SOURCE),
          client.open(BI_COLUMNS),
        ]);
        if (epoch !== generation) return false;
        if (row.corrupt || n.corrupt || source.corrupt || columns.corrupt)
          throw Error('首页配置损坏，请先从配置备份恢复；业务数据未改变。');
        data = model.validate(row.data);
        if (!row.revision) {
          const previous = await api('readModuleState', {
            scope: 'module',
            module: 'home-workspaces',
          });
          if (previous.corrupt) throw Error('旧分析方案损坏，请先恢复配置，原内容未覆盖。');
          if (previous.revision) {
            data = model.validate(previous.data);
            client.change(ADDRESS, data);
            await client.flush();
          }
        }
        nav = n.data;
        homeColumns = columns.data || { sources: {} };
        sourcePreference = {
          ...source.data,
          ...(['bi', 'records'].includes(getContext().dataSourceMode)
            ? { mode: getContext().dataSourceMode }
            : {}),
        };
        ready = true;
        error = '';
        return true;
      } catch (e) {
        if (epoch === generation) {
          error = '首页配置未恢复：' + e.message;
          ready = false;
          render();
        }
        return false;
      } finally {
        if (epoch === generation) opening = null;
      }
    })();
    return opening;
  }
  function ensureDOM() {
    if ($('homeStudio')) return;
    const home = document.querySelector('[data-page="home"]');
    home.prepend(node('div', 'home-studio'));
    home.firstElementChild.id = 'homeStudio';
    new ResizeObserver(() => {
      const { clientWidth: width, clientHeight: height } = $('hsContent') || $('homeStudio');
      if (!report || busy || !getContext().unlocked ||
          (Math.abs(width - observedWidth) < 4 && Math.abs(height - observedHeight) < 4)) return;
      observedWidth = width;
      observedHeight = height;
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        if (report && !busy && getContext().unlocked) renderData();
      });
    }).observe($('homeStudio'));
    const oldIds = ['dashboard', 'homeWorkspace', 'homeMain', 'homeAside'];
    for (const id of oldIds)
      if ($(id))
        $(id)
          .closest(id === 'dashboard' ? '.dashboard' : '.workflow-intro,.directory-layout')
          ?.setAttribute('hidden', '');
    const aside = node('nav', 'hs-nav');
    aside.id = 'hsNavigation';
    aside.setAttribute('aria-label', '首页功能导航');
    $('primaryNavigation').after(aside);
    const top = node('div', 'hs-global-tools');
    top.id = 'hsGlobalTools';
    const label = node('label', 'hs-global-search');
    label.append(icon('search'));
    const input = node('input');
    input.type = 'search';
    input.id = 'hsSearch';
    input.placeholder = '搜索SN、异常、跟进负责人…';
    input.setAttribute('aria-label', '搜索当前分析方案');
    input.oninput = () => {
      if (!ready) return;
      transient().search = input.value;
      transient().page = 1;
      clearTimeout(queryTimer);
      queryTimer = setTimeout(() => refresh(), 250);
    };
    label.append(input);
    top.append(label);
    $('toolbarImport').before(top);
    const dialog = node('dialog', 'hs-dialog');
    dialog.id = 'hsDetail';
    dialog.setAttribute('aria-labelledby', 'hsDetailTitle');
    const zoom = node('dialog', 'hs-dialog hs-chart-zoom');
    zoom.id = 'hsChartZoom';
    zoom.setAttribute('aria-labelledby', 'hsChartZoomTitle');
    document.body.append(zoom, dialog);
    dialog.addEventListener('close', () => {
      if (!dialog.open) {
        detailTicket++;
        dialog.replaceChildren();
      }
    });
  }
  function renderNav() {
    const navRoot = $('hsNavigation');
    if (!navRoot) return;
    navRoot.replaceChildren();
    const top = ib('首页分析', 'chart', () => onNavigate('home'), 'hs-nav-home');
    if (currentRoute === 'home') top.setAttribute('aria-current', 'page');
    navRoot.append(top);
    const mode = getContext().dataSourceMode || 'auto';
    renderGlobalTools(mode);
    const groups = window.WorkbenchNavigation.groupsFor(mode);
    for (const [id, title, ids] of groups) {
      const details = node('details', 'hs-nav-group');
      details.open = nav.expanded.includes(id);
      const sum = node('summary', '', title);
      sum.append(icon('chevron'));
      details.append(sum);
      for (const route of ids) {
        const info = window.WorkbenchNavigation.getRoute(route);
        const b = ib(
          info.title,
          id === 'records'
            ? 'records'
            : id === 'data'
              ? 'folder'
              : id === 'system'
                ? 'gear'
                : 'chart',
          () => onNavigate(route),
          'hs-nav-route',
        );
        if (
          route === currentRoute ||
          (route === 'bi-center' &&
            (currentRoute.startsWith('bi-') || currentRoute === 'analysis-studio'))
        ) {
          b.setAttribute('aria-current', 'page');
          b.classList.add('selected');
        }
        details.append(b);
      }
      details.ontoggle = () => {
        if (!ready) return;
        nav.expanded = details.open
          ? [...new Set([...nav.expanded, id])]
          : nav.expanded.filter((k) => k !== id);
        client.change(NAV, nav);
      };
      navRoot.append(details);
    }
  }
  function renderGlobalTools(mode) {
    const top = $('hsGlobalTools');
    if (!top) return;
    top.replaceChildren($('hsSearch').closest('label'));
    if (mode === 'bi') {
      top.append(
        ib('BI数据与导入', 'folder', () => onAnalysisTab('sources'), 'primary'),
        ib('日周月分析', 'chart', () => onAnalysisTab('analysis')),
        ib('横向A4报告', 'download', () => onAnalysisTab('report')),
      );
    } else if (mode === 'records') {
      top.append(
        ib('新建记录', 'plus', () => onNavigate('legacy-entry'), 'primary'),
        ib('扫码', 'scan', () => onAction('batch-scan')),
        ib('待办跟进', 'clock', () => onNavigate('legacy-followup')),
      );
    }
    $('hsSearch').placeholder =
      mode === 'bi' ? '搜索BI编号、不良项、责任员工…' : '搜索SN、异常、跟进负责人…';
  }
  function selectControl(label, values, value, fn) {
    const wrap = node('label', 'hs-control'),
      text = node('span', '', label),
      s = node('select');
    s.setAttribute('aria-label', label);
    for (const [v, t] of values) {
      const o = new Option(t, v);
      s.add(o);
    }
    s.value = value;
    s.onchange = () => fn(s.value);
    wrap.append(text, s);
    return wrap;
  }
  function render() {
    // The tab strip is appended before the content canvas. Any unexpected
    // error in between used to leave a completely blank page with no message
    // and an unhandled rejection. Always fall back to a readable retry state.
    try {
      renderHome();
    } catch (failure) {
      // Keep the underlying data error visible: it is often the real cause and
      // must not be replaced by the secondary rendering exception.
      const detail = failure?.message || String(failure);
      const previous = error && !error.startsWith('界面渲染失败') ? error + '；' : '';
      const message = `界面渲染失败：${previous}${detail}`;
      error = message;
      const host = $('homeStudio') || document.querySelector('[data-page="home"]');
      if (host) {
        host.replaceChildren();
        host.append(
          node('div', 'hs-starting', message),
          button('重新读取配置', () => {
            load().catch(() => {});
          }),
        );
      }
    }
  }
  function redrawHomeLayout(key, action) {
    const scroll = $('hsContent')?.scrollTop || 0;
    render();
    if ($('hsContent')) $('hsContent').scrollTop = scroll;
    const button = key && $('hsLayout-' + key + '-' + action);
    if (button?.disabled) $('hsLayout-' + key + '-' + (action === 'up' ? 'down' : 'up'))?.focus();
    else if (button) button.focus();
    else $('hsArrangePanels')?.focus();
  }
  function renderHome() {
    ensureDOM();
    renderNav();
    const root = $('homeStudio');
    root.replaceChildren();
    if (!ready) {
      root.append(
        node('div', 'hs-starting', error || '正在恢复分析方案…'),
        button('重新读取配置', () => load()),
      );
      return;
    }
    root.classList.toggle('settings-closed', !data.settingsOpen);
    root.dataset.density = active().density;
    const tabs = node('div', 'hs-tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', '分析方案标签');
    for (const v of data.views.filter((v) => v.open)) {
      const tab = node('div', 'hs-tab-wrap');
      const b = ib(v.name, 'folder', () => switchView(v.id), 'hs-tab');
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(v.id === data.activeId));
      b.dataset.homeTab = v.id;
      const close = button('×', () => closeView(v.id), 'hs-tab-close');
      close.setAttribute('aria-label', '关闭标签 ' + v.name);
      tab.classList.toggle('selected', v.id === data.activeId);
      tab.append(b, close);
      tabs.append(tab);
    }
    tabs.append(ib('新建分析方案', 'plus', () => newView(), 'hs-new-tab'));
    root.append(tabs);
    const canvas = node('div', 'hs-canvas'),
      main = node('div', 'hs-content'),
      settings = node('aside', 'hs-settings');
    main.id = 'hsContent';
    settings.setAttribute('aria-label', '当前分析方案设置');
    const heading = node('header', 'hs-heading'),
      identity = node('div', 'hs-heading-copy'),
      symbol = node('span', 'hs-heading-symbol');
    symbol.append(icon('cube'));
    const copy = node('div');
    copy.append(
      node('h1', '', `智能分析 · ${active().name}`),
      node('p', '', '当前文件中的独立分析视图，筛选与布局分别记忆。'),
    );
    identity.append(symbol, copy);
    const tools = node('div', 'hs-heading-actions');
    tools.append(
      ib('刷新', 'refresh', () => refresh()),
      ib('导出当前明细', 'download', () => exportRows()),
      ...(report?.primary?.source === 'bi' && report.biSource?.homeFields?.columns.length
        ? [button('分析表头', () => editHomeColumns(report.biSource.homeFields))] : []),
      ib('保存布局', 'save', () =>
        client.flush().catch((e) => {
          error = e.message;
          showError();
        }),
      ),
      ib(data.settingsOpen ? '收起设置' : '工作区设置', 'gear', () => {
        data.settingsOpen = !data.settingsOpen;
        dirty();
        render();
      }),
    );
    const arrange = button(arrangingPanels ? '完成布局' : '调整布局', () => {
      arrangingPanels = !arrangingPanels;
      redrawHomeLayout();
    });
    arrange.id = 'hsArrangePanels';
    arrange.setAttribute('aria-pressed', String(arrangingPanels));
    tools.append(arrange);
    heading.append(identity, tools);
    main.append(heading);
    const alert = node('div', 'hs-error');
    alert.id = 'hsError';
    alert.setAttribute('role', 'alert');
    alert.hidden = !error;
    alert.textContent = error;
    main.append(alert);
    renderFilterPanel(main);
    if (!hintSeen()) renderHomeHint(main);
    const cards = node('div', 'hs-metrics');
    cards.id = 'hsMetrics';
    main.append(cards);
    const grid = node('div', 'hs-chart-grid');
    grid.id = 'hsChartGrid';
    const titles = {
      trend: ['异常数量趋势', '双轴：异常条数 / 检验不良件数'],
      issues: ['异常类型分布', '按异常记录条数与构成占比'],
      process: ['工序异常分布', '按异常记录条数'],
      records: ['异常明细', '与当前工作区筛选一致'],
      owners: ['跟进负责人 Top10', '关联条数，不作责任判定'],
      comparison: ['异常条数同期对比', '同长上期按周期顺序对齐'],
      time: ['报检班别分布', '只使用明确的报检班别字段'],
    };
    if (getContext().dataSourceMode === 'bi' || report?.primary?.source === 'bi')
      Object.assign(titles, {
        trend: ['BI不良数量趋势', '单位随来源口径；缺失日期不当作零'],
        issues: ['BI不良项分布', '按不良数量与构成占比'],
        process: [
          'BI' + window.BIFieldLabels.process(report?.biSource) + '分布',
          '按不良数量，非人工记录条数',
        ],
        records: ['BI来源明细', '与当前BI筛选一致，正式记录仍独立保存'],
        owners: ['BI责任员工 Top10', '仅作记录关联，不推定操作责任'],
        comparison: ['BI数量同期对比', '仅对前后来源完整的范围比较'],
        time: ['BI报检班别分布', '不推断责任班别'],
      });
    const panelGroup = {
      trend: 'trend',
      comparison: 'trend',
      issues: 'dist',
      process: 'dist',
      owners: 'rank',
      time: 'rank',
      records: 'detail',
    };
    const order = active().panels;
    for (const [index, key] of order.entries()) {
      const panel = node('section', 'hs-panel hs-panel-' + key);
      panel.dataset.homePanel = key;
      panel.dataset.panelGroup = panelGroup[key] || 'detail';
      const header = node('header', 'hs-panel-heading');
      const text = node('div');
      text.append(node('h2', '', titles[key][0]), node('small', '', titles[key][1]));
      header.append(text);
      if (arrangingPanels) {
        const controls = node('div', 'hs-panel-move');
        for (const [action, step, label] of [['up', -1, '上移'], ['down', 1, '下移']]) {
          const nextIndex = index + step;
          const move = button(label, () => {
            [order[index], order[nextIndex]] = [order[nextIndex], order[index]];
            dirty();
            redrawHomeLayout(key, action);
          });
          move.id = 'hsLayout-' + key + '-' + action;
          move.disabled = nextIndex < 0 || nextIndex >= order.length;
          move.setAttribute('aria-label', label + titles[key][0]);
          controls.append(move);
        }
        header.append(controls);
      } else if (key !== 'records') {
        const controls = node('div', 'hs-chart-actions');
        if (key === 'trend' && !report?.biSource?.sharedAnalysis) controls.append(
          selectControl(
            '趋势周期',
            [
              ['day', '按日'],
              ['week', '按周'],
              ['month', '按月'],
            ],
            active().grain,
            (v) => {
              active().grain = v;
              dirty();
              refresh();
            },
          ),
        );
        const zoom = button('放大', () => enlargeChart(key, titles[key][0]));
        zoom.disabled = !report || busy || (report.primary?.source === 'bi' && !report.primary.available);
        zoom.setAttribute('aria-label', '放大：' + titles[key][0]);
        controls.append(zoom);
        header.append(controls);
      }
      panel.append(header);
      const body = node('div', 'hs-panel-body');
      body.id = 'hsPanel-' + key;
      panel.append(body);
      grid.append(panel);
    }
    main.append(grid);
    const footer = node('div', 'hs-home-foot');
    footer.append(
      node(
        'span',
        '',
        getContext().mode === 'demo' ? '示例数据 · 配置只保留本次会话' : '本机分析 · 不修改源记录',
      ),
    );
    const status = node('span', '', '布局已保存');
    status.id = 'hsSaveState';
    footer.append(status);
    main.append(footer);
    renderSettings(settings);
    canvas.append(main, settings);
    root.append(canvas);
    $('hsSearch').value = transient().search;
    if (!report || busy) {
      for (const title of getContext().dataSourceMode === 'bi'
        ? ['BI不良数量', 'BI来源记录']
        : ['异常记录数', '不良件数', '不良率', '未关闭异常', '超期异常']) {
        const box = node('div', 'hs-metric'),
          copy = node('span', 'hs-metric-copy');
        copy.append(
          node('span', 'hs-metric-label', title),
          node('strong', 'hs-placeholder-value', '—'),
          node('small', 'hs-metric-note', busy ? '正在读取…' : '未读取当前数据'),
        );
        box.append(copy);
        $('hsMetrics').append(box);
      }
    }
    if (report && !busy) renderData();
    else
      for (const e of root.querySelectorAll('.hs-panel-body'))
        e.append(G.empty(busy ? '正在读取当前范围…' : '请选择范围并查询。'));
    root.setAttribute('aria-busy', String(busy));
  }
  function renderSettings(root) {
    const v = active();
    const header = node('header', 'hs-settings-heading');
    header.append(
      icon('gear'),
      node('strong', '', `工作区设置 · ${v.name}`),
      button('关闭设置', () => {
        data.settingsOpen = false;
        dirty();
        render();
      }),
    );
    root.append(header);
    const tabs = node('div', 'hs-setting-tabs');
    for (const [id, title] of [
      ['basic', '工作区'],
      ['analysis', '分析设置'],
    ]) {
      const b = button(title, () => {
        settingsTab = id;
        render();
      });
      b.classList.toggle('selected', settingsTab === id);
      tabs.append(b);
    }
    root.append(tabs);
    if (settingsTab === 'basic') {
      const label = node('label', 'hs-setting-field', '工作区名称'),
        input = node('input');
      input.value = v.name;
      input.maxLength = 64;
      input.setAttribute('aria-label', '分析方案名称');
      input.onchange = () => {
        if (input.value.trim()) {
          v.name = input.value.trim();
          dirty();
          render();
        }
      };
      label.append(input);
      root.append(
        label,
        node(
          'p',
          'hs-setting-help',
          '标签是当前加密文件中的分析视图，不会复制或删除正式异常记录。',
        ),
      );
      const closed = data.views.filter((x) => !x.open);
      if (closed.length) {
        root.append(node('h3', '', '重新打开标签'));
        for (const x of closed)
          root.append(
            button(x.name, () => {
              x.open = true;
              data.activeId = x.id;
              dirty();
              report = null;
              refresh();
            }),
          );
      }
      if (getContext().dataSourceMode !== 'bi')
        root.append(
          ib('管理原记录模板与字段', 'records', () => onNavigate('legacy-settings')),
          node(
            'p',
            'hs-setting-help',
            '此入口打开原记录模块的模板管理；源模板修改并非当前分析视图的独立副本。',
          ),
        );
      return;
    }
    root.append(node('h3', '', '数据与布局'));
    const datasets = getContext().catalog?.datasets || [];
    if (getContext().dataSourceMode !== 'bi')
      root.append(
        selectControl(
          '检验数据集',
          [['', '自动选择首个数据集'], ...datasets.map((d) => [d.id, d.label])],
          v.datasetId,
          (id) => {
            v.datasetId = id;
            dirty();
            refresh();
          },
        ),
      );
    root.append(
      selectControl(
        '表格密度',
        [
          ['comfortable', '标准'],
          ['compact', '紧凑'],
        ],
        v.density,
        (value) => {
          v.density = value;
          dirty();
          render();
        },
      ),
    );
    root.append(node('h3', '', '显示的图表'));
    const names = {
      trend: '异常数量趋势',
      issues: '异常类型分布',
      process:
        report?.primary?.source === 'bi'
          ? window.BIFieldLabels.process(report?.biSource) + '不良分布'
          : '工序异常分布',
      records: '异常明细',
      owners: '跟进负责人Top10',
      comparison: '异常条数同期对比',
      time: '报检班别分布',
    };
    if (getContext().dataSourceMode === 'bi')
      Object.assign(names, {
        trend: 'BI不良数量趋势',
        issues: 'BI不良项分布',
        records: 'BI来源明细',
        owners: 'BI责任员工Top10',
        comparison: 'BI数量同期对比',
        time: 'BI报检班别分布',
      });
    for (const key of model.panels) {
      const label = node('label', 'hs-panel-check'),
        check = node('input');
      check.type = 'checkbox';
      check.checked = v.panels.includes(key);
      check.setAttribute('aria-label', '显示' + names[key]);
      check.onchange = () => {
        v.panels = check.checked ? [...v.panels, key] : v.panels.filter((k) => k !== key);
        dirty();
        render();
      };
      label.append(check, document.createTextNode(names[key]));
      root.append(label);
    }
    root.append(node('h3', '', '统计口径'));
    const note = node('div', 'hs-stat-note');
    if (getContext().dataSourceMode === 'bi')
      note.append(
        node('p', '', '按当前BI来源的确认数量和业务日期统计；缺失日期不当作零。'),
        node('p', '', '日周月分析中的不良率按日期＋工序＋班次匹配产量，缺少有效产量时不推算。'),
        button('配置BI来源与产量', () => onAnalysisTab('sources')),
      );
    else
      note.append(
        node('p', '', '不良率 = 不良件数 ÷ 检验件数。异常条数不作为不良件数。'),
        node('p', '', '条数按发现日期，件数按检验业务日；负责人仅表示跟进关联。'),
      );
    if (report && getContext().dataSourceMode !== 'bi')
      note.append(
        button('查看检验分母与来源', () => drill({ kind: 'quantity' })),
        node('small', '', `当前检验件数：${G.fmt(report.quality?.totals?.inspectedUnits)}`),
      );
    root.append(note);
    root.append(
      node('h3', '', '布局操作'),
      button('恢复默认布局', () => {
        v.panels = model.panels.slice();
        v.density = 'comfortable';
        v.grain = 'week';
        dirty();
        refresh();
      }),
      button(
        '保存当前布局',
        () =>
          client.flush().catch((e) => {
            error = e.message;
            showError();
          }),
        'primary',
      ),
    );
  }
  function renderFilterPanel(root) {
    const panel = node('section', 'hs-filter-panel');
    panel.setAttribute('aria-label', '筛选条件');
    const bi = report?.biSource;
    if (report?.primary?.source === 'bi' && bi?.sharedAnalysis && bi.range) {
      const header = node('div', 'hs-filter-heading');
      header.append(node('strong', '', '跟随工作台筛选'),
        node('span', 'hs-filter-summary', bi.sourceName + ' · ' + bi.range.start + ' 至 ' + bi.range.end +
          ' · ' + bi.sharedAnalysis.conditions + ' 项条件 · ' + bi.rowCount + ' 条'),
        button('打开统一筛选', () => onAnalysisTab(bi.sharedAnalysis.period, bi.analysisLink)));
      panel.append(header);
      const applied = bi.sharedAnalysis.filters || [];
      if (applied.length) {
        const names = { in: '包含所选', equals: '等于', notIn: '排除所选', notEquals: '不等于',
          empty: '为空', notEmpty: '有值', contains: '包含', notContains: '不包含',
          startsWith: '开头是', endsWith: '结尾是', gte: '≥', lte: '≤', between: '介于' };
        const scope = node('details', 'hs-active-bi-filters');
        scope.append(node('summary', '', '查看已应用的筛选条件'));
        const list = node('ul');
        for (const rule of applied)
          list.append(node('li', '', [rule.label, names[rule.op],
            rule.values.map((value) => value || '（空白）').join('、')].filter(Boolean).join(' ')));
        scope.append(list);
        panel.append(scope);
      }
      appendHomeColumnSummary(panel, bi.homeFields);
      const advanced = node('details');
      advanced.append(node('summary', '', '详细配置'));
      renderSourceControls(advanced);
      panel.append(advanced);
      root.append(panel);
      return;
    }
    const header = node('button', 'hs-filter-heading');
    header.type = 'button';
    header.setAttribute('aria-expanded', String(filtersOpen));
    header.append(
      icon('filter'),
      node('strong', '', '筛选条件'),
      node('span', 'hs-filter-summary', filterSummary()),
      icon('chevron'),
    );
    header.onclick = () => {
      filtersOpen = !filtersOpen;
      render();
    };
    panel.append(header);
    if (report?.primary?.source === 'bi') appendHomeColumnSummary(panel, bi?.homeFields);
    if (!filtersOpen) {
      root.append(panel);
      return;
    }
    const body = node('div', 'hs-filter-body');
    {
      renderSourceControls(body);
      const s = scope(),
        date = node('div', 'hs-date-control');
      date.append(node('span', '', '时间范围'));
      const fields = node('div', 'hs-date-fields');
      for (const key of ['start', 'end']) {
        const input = node('input');
        input.type = 'date';
        input.value = s[key];
        input.setAttribute('aria-label', key === 'start' ? '首页开始日期' : '首页结束日期');
        input.onchange = () => {
          const other = scope();
          const start = key === 'start' ? input.value : other.start,
            end = key === 'end' ? input.value : other.end;
          if (start && end && start <= end) {
            active().range = 'custom';
            active().start = start;
            active().end = end;
            dirty();
            refresh();
          } else {
            error = '请填写有效的起止日期。';
            showError();
          }
        };
        fields.append(input);
        if (key === 'start') fields.append(node('span', '', '至'));
      }
      date.append(fields);
      body.append(date);
      const presets = node('div', 'hs-date-presets');
      for (const [days, title] of [
        ['1', '今天'],
        ['7', '近7天'],
        ['30', '近30天'],
        ['month', '本月'],
        ['last-month', '上月'],
        ['90', '近90天'],
        ['all', '全部'],
      ]) {
        const b = button(title, () => {
          active().range = days;
          transient().page = 1;
          dirty();
          refresh();
        });
        b.classList.toggle('selected', active().range === days);
        presets.append(b);
      }
      body.append(presets);
      const filterSpecs = [
        ['process', '工序'],
        ['issue', '异常类型'],
        ['owner', '跟进负责人'],
        ['reporter', '报检人'],
        ['shift', '报检班别'],
      ];
      for (const [key, label] of window.BIFieldLabels.filters(filterSpecs, report)) {
        const values =
          report?.primary?.source === 'bi' && ['process', 'issue', 'shift', 'reporter'].includes(key)
            ? report.biSource?.options?.[key] || []
            : report?.filterOptions?.[key] || [];
        body.append(
          selectControl(
            label,
            [['', '全部'], ...values.map((v) => [v, v])],
            active().filters[key] || '',
            (v) => {
              if (v) active().filters[key] = v;
              else delete active().filters[key];
              transient().page = 1;
              dirty();
              refresh();
            },
          ),
        );
      }
      const actions = node('div', 'hs-filter-actions');
      actions.append(
        button('查询', () => refresh(), 'primary'),
        button('重置', () => {
          active().filters = {};
          transient().search = '';
          $('hsSearch').value = '';
          transient().page = 1;
          dirty();
          refresh();
        }),
      );
      body.append(actions);
    }
    panel.append(body);
    root.append(panel);
  }
  function filterSummary() {
    const s = scope(),
      v = active();
    const parts = [];
    const rangeLabel = {
      '1': '今天',
      '7': '近7天',
      '30': '近30天',
      month: '本月',
      'last-month': '上月',
      '90': '近90天',
      all: '全部时间',
      custom: s.start && s.end ? `${s.start} 至 ${s.end}` : '自定义',
    }[v.range];
    if (rangeLabel) parts.push(rangeLabel);
    for (const [key, label] of [
      ['process', '工序'],
      ['issue', '异常'],
      ['owner', '负责人'],
      ['reporter', '报检人'],
      ['shift', '班别'],
    ])
      if (v.filters[key]) parts.push(`${label}·${v.filters[key]}`);
    if (s.search) parts.push(`搜索·${s.search}`);
    return parts.length ? parts.join('　') : '未设置筛选';
  }
  function renderHomeHint(root) {
    const hint = node('section', 'hs-home-hint');
    hint.setAttribute('aria-label', '首页操作提示');
    const head = node('div', 'hs-home-hint-head');
    head.append(
      icon('chart'),
      node('strong', '', '欢迎使用首页分析'),
      button('知道了', () => {
        markHintSeen();
        hint.remove();
      }, 'hs-hint-close'),
    );
    hint.append(head);
    const items = node('ul', 'hs-home-hint-list');
    const tips = [
      ['点数字卡看明细', '上方每一张指标卡都可以点击，直接下钻到对应的记录或检验明细。'],
      ['筛选收在条件栏里', '点「筛选条件」展开日期、工序、异常类型等筛选；收起时标题上会显示当前生效条件。'],
      ['放大图表与查看明细', '点「放大」看大图；点折线点、排行条或分布分类，在右侧查看对应记录，不改变首页筛选。'],
    ];
    for (const [title, body] of tips) {
      const li = node('li');
      li.append(node('strong', '', title), node('span', '', body));
      items.append(li);
    }
    hint.append(items);
    root.append(hint);
  }
  const homeRoles = [
    ['process', '工序 / 站点'], ['issue', '不良项'], ['employee', '责任员工'],
    ['reporter', '报检人'], ['shift', '班次'],
  ];
  function appendHomeColumnSummary(parent, info) {
    if (!info?.columns.length) return;
    const label = (role) => info.columns.find((c) => c.id === info.effective[role])?.label;
    const actual = node('p', 'hs-home-column-summary',
      [['process', '工序'], ['issue', '不良项']].map(([role, name]) =>
        name + ' · ' + (label(role) || '未识别表头')).join('    /    '));
    if (info.missing.length) actual.append(node('span', '',
      '有已选表头不在当前来源，暂用自动对应。请重新选择。'));
    parent.append(actual);
  }
  function editHomeColumns(info) {
    const d = dialog('首页分析表头');
    const current = { ...(homeColumns.sources[info.sourceId] || {}) };
    const draft = { ...current };
    const grid = node('div', 'hs-home-column-grid');
    const feedback = node('p', 'hs-source-note');
    feedback.setAttribute('role', 'status');
    const labels = new Map(info.columns.map((c) => [c.id, c]));
    const renderChoices = () => {
      grid.replaceChildren();
      for (const [role, name] of homeRoles) {
        const choice = draft[role];
        const automatic = labels.get(info.automatic[role]);
        const shown = choice && labels.get(choice) || automatic;
        const row = node('div', 'hs-home-column-row');
        const sample = node('small', '', shown?.examples.length
          ? '样例值 · ' + shown.examples.join('、')
          : '当前导入数据暂无样例值');
        row.append(selectControl(name, [
          ['', automatic ? '自动 · ' + automatic.label : '自动 · 未识别表头'],
          ...info.columns.map((c) => [c.id, c.label]),
        ], labels.has(choice) ? choice : '', (value) => {
          if (value) draft[role] = value;
          else delete draft[role];
          const selected = value ? labels.get(value) : automatic;
          sample.textContent = selected?.examples.length
            ? '样例值 · ' + selected.examples.join('、') : '当前导入数据暂无样例值';
        }), sample);
        grid.append(row);
      }
    };
    const restore = button('恢复自动对应', () => {
      for (const [role] of homeRoles) delete draft[role];
      renderChoices();
    });
    const save = button('保存并更新首页', async () => {
      const epoch = generation;
      const sources = { ...homeColumns.sources };
      for (const key of Object.keys(draft)) if (!labels.has(draft[key])) delete draft[key];
      if (Object.keys(draft).length) sources[info.sourceId] = draft;
      else delete sources[info.sourceId];
      save.disabled = restore.disabled = true;
      try {
        const next = { sources };
        if (!client.change(BI_COLUMNS, next)) throw Error('首页配置尚未载入。');
        try {
          await client.flush();
        } catch (e) {
          if (epoch === generation) client.change(BI_COLUMNS, homeColumns);
          throw e;
        }
        if (epoch !== generation) return;
        homeColumns = next;
        if (!report?.biSource?.sharedAnalysis) {
          for (const role of ['process', 'issue', 'reporter', 'shift'])
            if (current[role] !== draft[role]) delete active().filters[role];
          if (current.employee !== draft.employee) {
            sourcePreference = { ...sourcePreference, employee: '' };
            client.change(SOURCE, sourcePreference);
          }
          dirty();
        }
        transient().page = 1;
        d.close();
        await refresh();
      } catch (e) {
        feedback.textContent = e.message;
      } finally {
        save.disabled = restore.disabled = false;
      }
    }, 'primary');
    const actions = node('div', 'hs-filter-actions');
    actions.append(restore, save);
    const note = report?.biSource?.sharedAnalysis
      ? '首页沿用工作台已查询的记录范围，图表和下钻按这里选择的列分组。'
      : '首页图表、筛选和明细使用这里选择的原始列。';
    d.append(node('p', 'hs-source-note', info.sourceName + ' · ' + note), grid, feedback, actions);
    renderChoices();
  }
  function renderSourceControls(root) {
    const bar = node('section', 'hs-source-controls');
    bar.setAttribute('aria-label', '首页数据来源');
    const change = (key, value) => {
      sourcePreference = { ...sourcePreference, [key]: value };
      transient().page = 1;
      client.change(SOURCE, sourcePreference);
      report = null;
      refresh();
    };
    if (['records', 'bi'].includes(getContext().dataSourceMode))
      bar.append(
        node(
          'strong',
          '',
          getContext().dataSourceMode === 'bi'
            ? '工作区来源：BI导入不良'
            : '工作区来源：手动录入不良',
        ),
        node('span', 'hs-source-note', '可在工作区管理 → 基本信息中更改；不会合并数据。'),
      );
    else {
      bar.append(
        selectControl(
          '首页主要来源',
          [
            ['auto', '自动：优先可用BI'],
            ['bi', 'BI主要统计'],
            ['records', '人工异常记录'],
          ],
          sourcePreference.mode,
          (v) => change('mode', v),
        ),
      );
    }
    if (sourcePreference.mode !== 'records') {
      bar.append(
        selectControl(
          'BI来源类型',
          [
            ['auto', '自动：优先本工作区下载目录'],
            ['studio', 'BI自由分析（下载目录）'],
            ['daily', '日报导入'],
            ['history', '历史分析'],
          ],
          sourcePreference.channel,
          (v) => change('channel', v),
        ),
      );
      const scopes = report?.biSource?.scopes || [];
      const scopeValues = [
        ...new Set([
          ...scopes,
          ...(sourcePreference.dailyScope ? [sourcePreference.dailyScope] : []),
        ]),
      ];
      if (
        !['history', 'studio'].includes(sourcePreference.channel) &&
        report?.biSource?.channel !== 'studio'
      )
        bar.append(
          selectControl(
            '日报来源范围',
            [['', '单一范围自动识别'], ...scopeValues.map((v) => [v, v])],
            sourcePreference.dailyScope,
            (v) => change('dailyScope', v),
          ),
        );
      const employees = report?.biSource?.options?.employee || [];
      if (!report?.biSource?.sharedAnalysis) bar.append(
        selectControl(
          'BI责任员工',
          [
            ['', '全部'],
            ...[
              ...new Set([
                ...employees,
                ...(sourcePreference.employee ? [sourcePreference.employee] : []),
              ]),
            ].map((v) => [v, v]),
          ],
          sourcePreference.employee,
          (v) => change('employee', v),
        ),
      );
    }
    const note = node('p', 'hs-source-note');
    note.setAttribute('role', 'status');
    note.textContent = busy
      ? '正在读取当前工作区的数据来源…'
      : report?.primary
        ? `当前：${report.primary.label}。${report.primary.notice} ${report.biSource?.note || ''}`
        : '来源按当前工作区记忆；BI数量与人工记录条数始终分开统计。';
    if (report?.biSource?.availableRange) {
      const v = report.biSource;
      note.textContent +=
        ' 数据实际日期：' +
        v.availableRange.start +
        ' 至 ' +
        v.availableRange.end +
        '，共' +
        G.fmt(v.availableRowCount) +
        '条。';
      if (v.state === 'out-of-range')
        bar.append(
          button('查看全部BI日期', () => {
            active().range = 'all';
            dirty();
            return refresh();
          }),
        );
    }
    bar.append(note);
    root.append(bar);
  }
  function chartHeight(panel, width = $('hsPanel-' + panel)?.clientWidth || 480, enlarged = false) {
    if (enlarged) return Math.round(Math.min(570, Math.max(300, width * 0.48)));
    return panel === 'trend'
      ? Math.round(Math.min(400, Math.max(265, width * 0.38)))
      : Math.round(Math.min(320, Math.max(220, width * 0.54)));
  }
  function enlargeChart(key, title) {
    if (!report || busy) return;
    const d = $('hsChartZoom');
    if (d.open) return;
    const snapshot = report;
    const h = node('header', 'hs-dialog-head');
    const label = node('h2', '', title);
    label.id = 'hsChartZoomTitle';
    h.append(label, button('关闭大图', () => d.close(), 'hs-dialog-close'));
    const body = node('div');
    d.replaceChildren(h, node('p', 'hs-dialog-note', '点击图中的数据点、条形或分类查看对应记录。'), body);
    d.showModal();
    let renderedWidth = 0;
    const draw = () => {
      if (!d.open || report !== snapshot) return;
      const width = Math.max(280, body.clientWidth || 900);
      if (Math.abs(width - renderedWidth) < 4) return;
      renderedWidth = width;
      const factory = snapshot.primary?.source === 'bi' ? buildBIPanelChart : buildManualPanelChart;
      body.replaceChildren(factory(snapshot, key, width, true));
    };
    const observe = new ResizeObserver(draw);
    d.addEventListener('close', () => {
      observe.disconnect();
      if (!d.open) d.replaceChildren();
    }, { once: true });
    observe.observe(body);
    draw();
  }
  const biColumns = [
    ['date', 'BI业务日期'],
    ['businessId', '业务编号'],
    ['sn', 'SN'],
    ['process', '工序'],
    ['issue', '不良项'],
    ['quantity', '不良数量'],
    ['employee', 'BI责任员工'],
    ['reporter', '报检人'],
    ['shift', '报检班别'],
    ['status', 'BI处置状态'],
  ];
  function renderBIData() {
    const r = report,
      bi = r.biSource || {},
      available = r.primary.available;
    const metrics = [
      [
        'BI不良数量',
        available ? bi.quantity : null,
        bi.unitLabel || 'pcs',
        bi.previousQuantity === null || bi.previousQuantity === undefined
          ? '上期来源不完整，未计算变化'
          : `较同长上期 ${bi.quantity - bi.previousQuantity >= 0 ? '+' : ''}${G.fmt(bi.quantity - bi.previousQuantity)} ${bi.unitLabel || 'pcs'}`,
        () => drillBI(),
      ],
      [
        'BI明细行数',
        available ? bi.rowCount : null,
        '行',
        '源报表明细行，不等于人工异常条数',
        () => drillBI(),
      ],
      [
        '人工异常记录',
        r.recordCount,
        '条',
        '独立保存，不加入BI数量',
        () => drill({ kind: 'records' }),
      ],
      [
        '人工未关闭',
        r.pending,
        '条',
        '仅按人工处理状态统计',
        () => drill({ kind: 'records', status: 'notClosed' }),
      ],
      [
        '人工超期',
        r.overdue,
        '条',
        '仅按人工处理期限统计',
        () => drill({ kind: 'records', status: 'overdue' }),
      ],
    ];
    $('hsMetrics').replaceChildren();
    const visibleMetrics =
      typeof getContext === 'function' && getContext().dataSourceMode === 'bi'
        ? metrics.slice(0, 2)
        : metrics;
    for (const [title, value, unit, note, action] of visibleMetrics) {
      const card = button('', action, 'hs-metric');
      const copy = node('span', 'hs-metric-copy'),
        line = node('span', 'hs-metric-value');
      copy.append(node('span', 'hs-metric-label', title));
      line.append(node('strong', '', G.fmt(value)), node('small', '', unit));
      copy.append(line, node('small', 'hs-metric-note', note));
      card.append(copy);
      $('hsMetrics').append(card);
    }
    const put = (key, content) => $('hsPanel-' + key)?.replaceChildren(content);
    if (!available) {
      for (const key of model.panels)
        put(key, G.empty(bi.message || '当前没有可用BI，未将缺失当作零。'));
      return;
    }
    for (const key of model.panels) {
      const body = $('hsPanel-' + key);
      if (body && key !== 'records') put(key, buildBIPanelChart(r, key, Math.max(280, (body.clientWidth || 380) - 24)));
    }
    const body = $('hsPanel-records');
    if (body) {
      renderRows(body, bi.rows, bi.page, bi.total, {
        detail: true,
        columns: window.BIFieldLabels.columns(biColumns, bi),
      });
      const pager = node('div', 'hs-pagination');
      pager.append(
        node('span', '', `BI共 ${bi.total} 行 · 第 ${bi.page} 页`),
        button('上一页', () => {
          transient().page = Math.max(1, bi.page - 1);
          refresh();
        }),
        button('下一页', () => {
          transient().page = Math.min(Math.max(1, Math.ceil(bi.total / bi.pageSize)), bi.page + 1);
          refresh();
        }),
      );
      body.append(pager);
    }
  }
  function buildBIPanelChart(r, key, width, enlarged = false) {
    const bi = r.biSource;
    if (key === 'issues') {
      if (enlarged) return G.ranking(bi.issues, { unit: bi.unitLabel || 'pcs', limit: bi.issues.length,
        onSelect: (value) => drillBI({ field: 'issue', value }) });
      return G.donut(bi.issues, bi.quantity, (value) => drillBI({ field: 'issue', value }), {
        unit: bi.unitLabel || 'pcs', label: 'BI不良数量', quantity: true,
      });
    }
    if (key !== 'trend' && key !== 'comparison') {
      const [field, values] = {
        process: ['process', bi.processes], owners: ['employee', bi.employees], time: ['shift', bi.shifts],
      }[key];
      return G.ranking(values, { unit: bi.unitLabel || 'pcs', limit: enlarged ? values.length : key === 'owners' ? 10 : 7,
        onSelect: (value) => drillBI({ field, value }) });
    }
    const comparison = key === 'comparison', trend = bi.trend || [];
    return window.ChartSurface.create({
      title: comparison ? 'BI数量与同长上期' : 'BI不良数量趋势',
      unit: bi.unitLabel || 'pcs', compact: !enlarged, minimumWidth: width, height: chartHeight(key, width, enlarged),
      labels: trend.map((x) => (x.start === x.end ? x.start.slice(5) : x.key.slice(5))),
      fullLabels: trend.map((x) => `${x.start} 至 ${x.end}，来源${x.covered}/${x.days}天`),
      series: [
        { name: 'BI不良数量', values: trend.map((x) => x.quantity) },
        ...(comparison ? [{ name: '同长上期（来源完整才比较）', values: trend.map((x) => x.previous) }] : []),
      ],
      onPoint: (series, index) => {
        const point = trend[index];
        const offset = series === 1
          ? -Math.round((Date.parse(bi.range.end) - Date.parse(bi.range.start)) / 86400000) - 1 : 0;
        drillBI({ start: shift(point.start, offset), end: shift(point.end, offset), previous: series === 1 });
      },
    });
  }
  function drillBI({ field, value, start, end, previous = false } = {}) {
    if (!report?.biSource) return;
    const d = dialog('BI来源明细', true),
      content = node('div'),
      t = ++detailTicket;
    const linked = report.biSource?.sharedAnalysis;
    const base = structuredClone({ ...report.scope, ...(linked ? report.biSource.range : {}) }),
      pref = { ...sourcePreference, mode: 'bi' };
    const biFilter = field ? { field, value } : null;
    const labels = { issue: '不良项', employee: '责任员工', shift: '报检班别',
      process: window.BIFieldLabels.process(report.biSource) };
    renderDrillContext(d, base, { start, end, previous, selection: field ? `${labels[field]}：${value || '未填写'}` : '',
      applied: linked ? report.biSource.sharedAnalysis.filters : null });
    d.append(content);
    let page = 1;
    async function loadPage() {
      content.replaceChildren(G.empty('正在读取BI明细…'));
      try {
        const result = await api('homeOverview', {
          query: { ...base, start: start || base.start, end: end || base.end, page, pageSize: 10 },
          preference: pref,
          biFilter,
          ...(linked && start && end ? { biRange: { start, end } } : {}),
          ...(linked && previous ? { biPeriod: 'previous' } : {}),
        });
        if (t !== detailTicket || !d.open) return;
        const bi = result.biSource;
        if (bi.state !== 'available') {
          content.replaceChildren(G.empty(bi.message || '无可用BI来源。'));
          return;
        }
        renderRows(content, bi.rows, bi.page, bi.total, {
          detail: true,
          columns: window.BIFieldLabels.columns([
            ['sn', '容器号 / SN'], ['date', 'BI业务日期'], ['issue', '不良项'], ['quantity', '不良数量'],
            ['employee', '责任员工'], ['process', '工序'], ['shift', '报检班别'],
            ...(bi.rows.some((row) => row.file || row.sourceRow) ? [['file', '来源文件'], ['sourceRow', '源行号']] : []),
          ], bi),
        });
        const pager = node('div', 'hs-pagination');
        pager.append(
          node(
            'span',
            '',
            `明细 ${bi.total} 行 · 不良数量 ${G.fmt(bi.quantity)} ${bi.unitLabel || 'pcs'} · 第 ${bi.page} 页`,
          ),
          button('上一页', () => {
            page = Math.max(1, bi.page - 1);
            loadPage();
          }),
          button('下一页', () => {
            page = Math.min(Math.max(1, Math.ceil(bi.total / 10)), bi.page + 1);
            loadPage();
          }),
          ...(linked && !bi.analysisLink ? [] : [
            button('打开BI来源', () => {
              d.close();
              if (bi.channel === 'studio' && bi.analysisLink) {
                onAnalysisTab(bi.analysisLink.period, { ...bi.analysisLink, drill: true });
                return;
              }
              onNavigate(
                bi.channel === 'studio'
                  ? 'analysis-studio'
                  : bi.channel === 'daily'
                    ? 'bi-daily'
                    : 'bi-trends',
              );
            }),
          ]),
        );
        pager.children[1].disabled = bi.page <= 1;
        pager.children[2].disabled = bi.page >= Math.max(1, Math.ceil(bi.total / 10));
        content.append(pager);
      } catch (e) {
        if (t === detailTicket && d.open) content.replaceChildren(G.empty(e.message));
      }
    }
    loadPage();
  }
  async function exportBIRows() {
    const before = report?.biSource?.revision ?? '';
    await client.flush();
    const result = await api('homeOverview', {
      query: report.scope,
      preference: { ...sourcePreference, mode: 'bi' },
      exportRows: true,
    });
    const bi = result.biSource;
    if (bi.state !== 'available') throw Error(bi.message || 'BI导出未完成，未生成空报表。');
    if (bi.revision !== before) throw Error('BI来源或筛选已变化，请刷新首页后再导出。');
    const cols = [
      ['channel', '数据来源'],
      ['scopeName', '来源范围'],
      ...window.BIFieldLabels.columns(biColumns, bi),
    ];
    const cell = (value) => {
      let text = String(value ?? '');
      if (/^[=+@\-\t\r]/.test(text)) text = "'" + text;
      return '"' + text.replaceAll('"', '""') + '"';
    };
    const csv =
      '\ufeff' +
      [
        cols.map((x) => cell(x[1])).join(','),
        ...bi.rows.map((row) =>
          cols
            .map(([key]) =>
              cell(
                key === 'channel'
                  ? bi.channel === 'daily'
                    ? 'BI日报'
                    : bi.channel === 'studio'
                      ? 'BI自由分析'
                      : 'BI历史'
                  : key === 'scopeName'
                    ? bi.dailyScope
                    : row[key],
              ),
            )
            .join(','),
        ),
      ].join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })),
      a = node('a');
    a.href = url;
    a.download = 'BI首页明细_' + localToday() + '.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  function renderData() {
    if (!report || !$('hsMetrics')) return;
    if (report.primary?.source === 'bi') return renderBIData();
    const r = report,
      totals = r.quality?.totals || {},
      prevTotals = r.previousQuality?.totals || {},
      rate = r.quality?.rate?.status === 'available' ? r.quality.rate.value : null,
      prevRate =
        r.previousQuality?.rate?.status === 'available' ? r.previousQuality.rate.value : null;
    const pct = (cur, prev) =>
      cur === null || prev === null || prev === 0 ? null : ((cur - prev) / prev) * 100;
    const delta = (label, cur, prev) => {
      if (cur === null || prev === null) return null;
      const d = cur - prev,
        p = pct(cur, prev);
      const dir = d > 0 ? 'up' : d < 0 ? 'down' : 'flat';
      const text =
        d === 0
          ? '持平'
          : `${d > 0 ? '↑' : '↓'} ${Math.abs(d)}${label}${p === null ? '' : ` ${Math.abs(p).toFixed(1)}%`}`;
      return { dir, text };
    };
    const recordDelta = delta(' 条', r.recordCount, r.previousCount);
    const defectiveDelta = delta(' 件', totals.defectiveUnits ?? null, prevTotals.defectiveUnits ?? null);
    const rateDelta =
      rate === null || prevRate === null
        ? null
        : (() => {
            const d = (rate - prevRate) * 100;
            return {
              dir: d > 0 ? 'up' : d < 0 ? 'down' : 'flat',
              text: d === 0 ? '持平' : `${d > 0 ? '↑' : '↓'} ${Math.abs(d).toFixed(2)} pp`,
            };
          })();
    const cards = [
      [
        'records',
        '异常记录数',
        G.fmt(r.recordCount),
        '条',
        r.previousCount ? `较同长上期 ${r.recordDelta > 0 ? '+' : ''}${r.recordDelta} 条` : '上期为0，未计算百分比',
        'records',
        'blue',
        recordDelta,
      ],
      [
        'defective',
        '不良件数',
        G.fmt(totals.defectiveUnits),
        '件',
        '来自当前检验数据集',
        'cube',
        'orange',
        defectiveDelta,
      ],
      [
        'rate',
        '不良率',
        rate === null ? '—' : (rate * 100).toFixed(2) + '%',
        '',
        rate === null
          ? '缺少有效口径，未推算比率'
          : `${G.fmt(totals.defectiveUnits)} ÷ ${G.fmt(totals.inspectedUnits)}`,
        'clock',
        'amber',
        rateDelta,
      ],
      ['pending', '未关闭异常', G.fmt(r.pending), '条', '当前范围内未关闭记录', 'check', 'green', null],
      [
        'overdue',
        '超期异常',
        G.fmt(r.overdue),
        '条',
        '未关闭且处理期限早于今天',
        'clock',
        'purple',
        null,
      ],
    ];
    $('hsMetrics').replaceChildren();
    for (const [id, title, value, unit, note, symbol, color, deltaInfo] of cards) {
      const b = button(
        '',
        () =>
          id === 'rate' || id === 'defective'
            ? drill({ kind: 'quantity' })
            : drill({
                kind: 'records',
                status: id === 'pending' ? 'notClosed' : id === 'overdue' ? 'overdue' : '',
              }),
        'hs-metric ' + color,
      );
      b.dataset.homeMetric = id;
      const badge = node('span', 'hs-metric-icon');
      badge.append(icon(symbol));
      const copy = node('span', 'hs-metric-copy');
      copy.append(node('span', 'hs-metric-label', title));
      const line = node('span', 'hs-metric-value');
      line.append(node('strong', '', value), node('small', '', unit));
      if (deltaInfo) {
        const tag = node('span', 'hs-metric-delta ' + deltaInfo.dir, deltaInfo.text);
        tag.title = '较同长上期';
        line.append(tag);
      }
      copy.append(line, node('small', 'hs-metric-note', note));
      b.append(badge, copy);
      $('hsMetrics').append(b);
    }
    for (const key of model.panels) {
      const body = $('hsPanel-' + key);
      if (!body) continue;
      if (key === 'records') renderRows(body, r.rows, r.page, r.total);
      else body.replaceChildren(buildManualPanelChart(r, key, Math.max(280, (body.clientWidth || 380) - 24)));
    }
  }
  function buildManualPanelChart(r, key, width, enlarged = false) {
    if (key === 'trend' || key === 'comparison') {
      const comparison = key === 'comparison';
      return G.combo(r.trend, {
        width, height: chartHeight(key, width, enlarged), comparison,
        onRange: (p, prior) => {
          const offset = prior ? -Math.round((Date.parse(r.scope.end) - Date.parse(r.scope.start)) / 86400000) - 1 : 0;
          drill({ kind: 'records', start: shift(p.start, offset), end: shift(p.end, offset) });
        },
        onQuantity: (p) => drill({ kind: 'quantity', start: p.start, end: p.end }),
      });
    }
    if (key === 'issues') return enlarged
      ? G.ranking(r.issues, { limit: r.issues.length, onSelect: (value) => filterDrill('issue', value) })
      : G.donut(r.issues, r.recordCount, (value) => filterDrill('issue', value));
    const [field, values, unmapped, missing] = {
      process: ['process', r.processes, '未映射工序'],
      owners: ['owner', r.owners, '未分配', '当前记录未填写跟进负责人；可在原待办跟进页补充。'],
      time: ['shift', r.shifts, '未填写', '未提供报检班别字段，不按自然时间推断生产班次。'],
    }[key];
    if (missing && !values.some((x) => x.value)) return G.empty(missing);
    return G.ranking(values, { limit: enlarged ? values.length : key === 'owners' ? 10 : 7, unmapped,
      onSelect: (value) => filterDrill(field, value) });
  }
  function filterDrill(key, value) {
    drill({ kind: 'records', extra: { [key]: value } });
  }
  function renderRows(root, rows, page, total, { detail = false, columns = null } = {}) {
    root.replaceChildren();
    if (!rows.length) {
      root.append(G.empty('当前筛选没有记录。'));
      return;
    }
    const wrap = node('div', 'hs-table-scroll'),
      table = node('table', 'hs-table' + (detail ? ' hs-table-readonly' : '')),
      head = node('thead'),
      tr = node('tr');
    const cols = columns || [
      ['sequence', '序号'],
      ['date', '发现日期'],
      ['sn', 'SN'],
      ['process', '工序'],
      ['issue', '异常现象'],
      ['owner', '跟进负责人'],
      ['reporter', '报检人'],
      ['shift', '报检班别'],
      ['status', '状态'],
    ];
    for (const [key, label] of cols) {
      const th = node('th');
      if (!detail) {
        const b = button(label, () => {
          const q = transient();
          q.sort = {
            field: key,
            direction: q.sort.field === key && q.sort.direction === 'asc' ? 'desc' : 'asc',
          };
          active().sort = { ...q.sort };
          dirty();
          q.page = 1;
          refresh();
        });
        b.title = '按' + label + '排序';
        th.append(b);
      } else th.textContent = label;
      tr.append(th);
    }
    if (!detail) tr.append(node('th', '', '操作'));
    head.append(tr);
    table.append(head);
    const tbody = node('tbody');
    rows.forEach((row, i) => {
      const tr = node('tr');
      for (const [key] of cols) {
        const td = node('td');
        if (key === 'sequence') td.textContent = (page - 1) * 10 + i + 1;
        else if (key === 'status') {
          const tag = node(
            'span',
            'hs-status ' +
              ({ 待处理: 'pending', 处理中: 'working', 待验证: 'verify', 已关闭: 'closed' }[
                row.status
              ] || ''),
            row.status,
          );
          td.append(tag);
        } else
          td.textContent =
            row[key] === null || row[key] === undefined || row[key] === '' ? '—' : String(row[key]);
        td.title = td.textContent;
        tr.append(td);
      }
      if (!detail) {
        const td = node('td');
        td.append(button('查看', () => showRow(row), 'hs-table-link'));
        tr.append(td);
      }
      tbody.append(tr);
    });
    table.append(tbody);
    wrap.append(table);
    root.append(wrap);
    if (!detail) {
      const pager = node('div', 'hs-pagination');
      pager.append(
        node('span', '', `共 ${total} 条 · 第 ${page} 页`),
        button('上一页', () => {
          transient().page = Math.max(1, page - 1);
          refresh();
        }),
        button('下一页', () => {
          transient().page = Math.min(Math.ceil(total / 10), page + 1);
          refresh();
        }),
      );
      root.append(pager);
    }
  }
  function renderDrillContext(d, base, { start, end, previous = false, selection = '', applied = null } = {}) {
    const row = node('div', 'hs-detail-context');
    const first = start || base.start, last = end || base.end;
    const dates = first === last ? first : `${first} 至 ${last}`;
    for (const label of [previous ? '同长上期' : '', dates, selection, '保留首页已应用的其他筛选'])
      if (label) row.append(node('span', '', label));
    d.append(row);
    if (applied?.length) {
      const details = node('details', 'hs-active-bi-filters');
      const list = node('ul');
      const names = { in: '包含所选', equals: '等于', notIn: '排除所选', notEquals: '不等于',
        empty: '为空', notEmpty: '有值', contains: '包含', notContains: '不包含', startsWith: '开头是',
        endsWith: '结尾是', gte: '≥', lte: '≤', between: '介于' };
      for (const rule of applied) list.append(node('li', '', [rule.label, names[rule.op],
        rule.values.map((value) => value || '（空白）').join('、')].filter(Boolean).join(' ')));
      details.append(node('summary', '', '查看首页筛选条件'), list);
      d.append(details);
    }
  }
  function dialog(title, side = false) {
    const d = $('hsDetail');
    if (d.open) d.close();
    d.replaceChildren();
    d.classList.toggle('hs-detail-side', side);
    const h = node('header', 'hs-dialog-head'), label = node('h2', '', title);
    label.id = 'hsDetailTitle';
    h.append(label, button('关闭', () => d.close(), 'hs-dialog-close'));
    d.append(h);
    d.onclick = (event) => { if (event.target === d) {
      const bounds = d.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX >= bounds.right ||
          event.clientY < bounds.top || event.clientY >= bounds.bottom) d.close();
    } };
    d.showModal();
    return d;
  }
  function showRow(row) {
    const d = dialog('异常分析行 · ' + row.sn),
      list = node('dl', 'hs-record-details');
    for (const [key, label] of [
      ['id', '永久记录编号'],
      ['date', '发现日期'],
      ['sn', 'SN'],
      ['issue', '异常现象'],
      ['process', '工序'],
      ['owner', '跟进负责人'],
      ['reporter', '报检人'],
      ['shift', '报检班别'],
      ['status', '处理状态'],
      ['dueDate', '处理期限'],
      ['relatedCode', '关联编号'],
    ])
      list.append(node('dt', '', label), node('dd', '', row[key] || '未填写'));
    d.append(
      list,
      button('打开原记录查询', () => {
        d.close();
        onNavigate('legacy-records');
      }),
    );
  }
  async function drill({ kind, extra = {}, start, end, status } = {}) {
    if (!report) return;
    const base = structuredClone(report.scope),
      d = dialog(kind === 'quantity' ? '检验数量来源与统计口径' : '当前条件对应异常记录', true);
    const labels = { issue: '异常类型', process: '工序', owner: '跟进负责人', shift: '报检班别' };
    renderDrillContext(d, base, { start, end, selection: Object.entries(extra)
      .map(([key, val]) => `${labels[key] || key}：${val || '未填写'}`).join(' · ') });
    d.append(
      node(
        'p',
        'hs-dialog-note',
        kind === 'quantity'
          ? '件数来自检验事实；不从异常条数推算。不良率 = 不良件数合计 ÷ 检验件数合计。'
          : '按当前分析方案的日期、字段和搜索条件读取。',
      ),
    );
    const content = node('div');
    d.append(content);
    const t = ++detailTicket;
    let page = 1;
    async function fetchPage() {
      content.replaceChildren(G.empty('正在读取…'));
      try {
        const q = {
          ...base,
          start: start || base.start,
          end: end || base.end,
          filters: { ...base.filters, ...extra },
          page,
          pageSize: 10,
        };
        if (kind === 'quantity') {
          const result = await api('listData', {
            ...q,
            source: 'quality',
            search: '',
            sort: { field: 'businessDate', direction: 'desc' },
          });
          if (t !== detailTicket || !d.open) return;
          renderRows(content, result.rows, result.page, result.total, {
            detail: true,
            columns: result.columns.map((c) => [c.key, c.label]),
          });
          pager(result.page, result.total);
        } else {
          const result = await api('homeReport', {
            ...q,
            sort: { field: 'date', direction: 'desc' },
            followup: status || '',
          });
          if (t !== detailTicket || !d.open) return;
          let rows = result.rows;
          renderRows(content, result.rows, result.page, result.total, { detail: true });
          pager(result.page, result.total);
        }
      } catch (e) {
        if (t === detailTicket && d.open) content.replaceChildren(G.empty(e.message));
      }
    }
    function pager(current, total) {
      const p = node('div', 'hs-pagination');
      p.append(
        node('span', '', `共 ${total} 行 · 第 ${current} 页`),
        button('上一页', () => {
          page = Math.max(1, current - 1);
          fetchPage();
        }),
        button('下一页', () => {
          page = Math.min(Math.max(1, Math.ceil(total / 10)), current + 1);
          fetchPage();
        }),
      );
      content.append(p);
    }
    fetchPage();
  }
  async function fetchAll(q, status) {
    const rows = [];
    let revision = null,
      total = null;
    for (let page = 1; page <= 500; page++) {
      const r = await api('homeReport', { ...q, page, pageSize: 50 });
      if (revision !== null && (r.observationRevision !== revision || r.total !== total))
        throw Error('导出期间记录发生变化，请刷新后重试。');
      revision = r.observationRevision;
      total = r.total;
      rows.push(...r.rows);
      if (r.page * r.pageSize >= r.total) {
        const today = localToday();
        return status
          ? rows.filter((x) =>
              status === 'notClosed'
                ? x.status !== '已关闭'
                : x.status !== '已关闭' && x.dueDate && x.dueDate < today,
            )
          : rows;
      }
    }
    throw Error('导出或待办明细超过25000条，请缩小范围。');
  }
  async function exportRows() {
    if (!report) return;
    try {
      if (report.primary?.source === 'bi') return await exportBIRows();
      const rows = await fetchAll({ ...report.scope, sort: transient().sort });
      const cols = [
        ['id', '永久记录编号'],
        ['date', '发现日期'],
        ['sn', 'SN'],
        ['process', '工序'],
        ['issue', '异常现象'],
        ['owner', '跟进负责人'],
        ['reporter', '报检人'],
        ['shift', '报检班别'],
        ['status', '状态'],
      ];
      const cell = (x) => '"' + String(x ?? '').replaceAll('"', '""') + '"';
      const text =
        '\ufeff' +
        [
          cols.map((c) => cell(c[1])).join(','),
          ...rows.map((r) =>
            cols
              .map(([k]) => cell(/^[=+@\-]/.test(String(r[k] || '')) ? "'" + r[k] : r[k]))
              .join(','),
          ),
        ].join('\r\n');
      const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
      const a = node('a');
      a.href = url;
      a.download = '异常分析_' + localToday() + '.csv';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      error = e.message;
      showError();
    }
  }
  async function switchView(id) {
    if (id === data.activeId) return;
    try {
      await client.flush();
      data.activeId = id;
      report = null;
      error = '';
      dirty();
      await refresh();
    } catch (e) {
      error = e.message;
      showError();
    }
  }
  async function closeView(id) {
    if (data.views.filter((v) => v.open).length === 1) {
      error = '至少保留一个分析标签；关闭标签不会删除工作区。';
      showError();
      return;
    }
    try {
      await client.flush();
      data.views.find((v) => v.id === id).open = false;
      if (data.activeId === id) data.activeId = data.views.find((v) => v.open).id;
      dirty();
      report = null;
      await refresh();
    } catch (e) {
      error = e.message;
      showError();
    }
  }
  function newView() {
    const d = dialog('新建分析方案'),
      label = node('label', 'hs-setting-field', '工作区名称'),
      input = node('input');
    input.maxLength = 64;
    input.placeholder = '例如：装管日常异常';
    input.setAttribute('aria-label', '新分析方案名称');
    label.append(input);
    const copy = node('label', 'hs-panel-check'),
      checkbox = node('input');
    checkbox.type = 'checkbox';
    checkbox.checked = true;
    copy.append(checkbox, document.createTextNode('复制当前筛选和布局（不复制业务数据）'));
    const errorLabel = node('p', 'hs-error');
    d.append(
      label,
      copy,
      errorLabel,
      button(
        '创建工作区',
        async () => {
          if (!input.value.trim()) {
            errorLabel.textContent = '请填写工作区名称。';
            return;
          }
          if (data.views.filter((v) => v.id !== 'managed-overview').length >= 32) {
            errorLabel.textContent = '最多32个分析方案，请先复用已有视图。';
            return;
          }
          try {
            await client.flush();
            const v = checkbox.checked ? structuredClone(active()) : model.base();
            v.id = crypto.randomUUID();
            v.name = input.value.trim();
            v.open = true;
            data.views.push(v);
            data.activeId = v.id;
            dirty();
            d.close();
            report = null;
            await refresh();
          } catch (e) {
            errorLabel.textContent = e.message;
          }
        },
        'primary',
      ),
    );
  }
  async function refresh() {
    if (!getContext().unlocked) return;
    ensureDOM();
    if (!(await init())) return;
    const t = ++ticket,
      epoch = generation;
    busy = true;
    error = '';
    render();
    try {
      await client.flush();
      const result = await api('homeOverview', {
        query: scope(),
        preference: sourcePreference,
        allDates: active().range === 'all',
      });
      if (t !== ticket || epoch !== generation || !getContext().unlocked) return;
      // An empty reply means "no data for this scope", not a broken renderer.
      // Keep report null so the normal placeholder state (and a readable
      // notice) is shown instead of turning it into a render failure.
      report = result && typeof result === 'object' ? result : null;
      if (!report) error = '首页数据暂不可用，请检查数据来源后点击“重新读取配置”。';
      sourcePreference = result?.sourcePreferences || sourcePreference;
      transient().page = result?.page || 1;
      busy = false;
      render();
    } catch (e) {
      if (t === ticket && epoch === generation) {
        busy = false;
        report = null;
        error = e.message;
        render();
      }
    }
  }
  async function load() {
    return refresh();
  }
  return {
    load,
    sourceMode: () => sourcePreference.mode,
    async setSourceMode(mode) {
      if (!['records', 'bi'].includes(mode)) throw Error('请选择工作区类型。');
      sourcePreference = { ...sourcePreference, mode };
      client.change(SOURCE, sourcePreference);
      await client.flush();
    },
    async prepare() {
      ensureDOM();
      await init();
      renderNav();
    },
    setRoute(route) {
      currentRoute = route;
      ensureDOM();
      renderNav();
    },
    async inheritWorkspace(preferences, name) {
      if (!(await init())) throw Error('分析配置未恢复，未覆盖原配置。');
      data = model.inheritWorkspace(data, preferences, name);
      temporary.delete('managed-overview');
      dirty();
      await client.flush();
    },
    invalidate() {
      ticket++;
      report = null;
      busy = true;
    },
    fail(text) {
      ticket++;
      report = null;
      busy = false;
      error = text;
      render();
    },
    flush: () => client.flush(),
    async reload() {
      ready = false;
      opening = null;
      return refresh();
    },
    clear() {
      cancelAnimationFrame(resizeFrame);
      observedWidth = 0;
      observedHeight = 0;
      arrangingPanels = false;
      generation++;
      ticket++;
      detailTicket++;
      ready = false;
      opening = null;
      report = null;
      busy = false;
      error = '';
      clearTimeout(queryTimer);
      temporary.clear();
      client.detach();
      data = model.defaults();
      sourcePreference = { mode: 'auto', channel: 'auto', dailyScope: '', employee: '' };
      homeColumns = { sources: {} };
      if ($('hsDetail')?.open) $('hsDetail').close();
      if ($('hsChartZoom')?.open) $('hsChartZoom').close();
      if ($('hsSearch')) $('hsSearch').value = '';
      $('hsDetail')?.replaceChildren();
      $('homeStudio')?.replaceChildren();
      $('hsNavigation')?.replaceChildren();
    },
  };
};
