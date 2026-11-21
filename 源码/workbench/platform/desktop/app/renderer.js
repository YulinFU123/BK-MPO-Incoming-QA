'use strict';
(() => {
  // Layout only: native windows keep their caption-button reservation. The
  // isolated browser bridge has no native caption buttons.
  if (typeof window.previewAppearance === 'function')
    document.documentElement.dataset.browserPreview = 'true';
  const $ = (id) => document.getElementById(id);
  const icon = (name, size) => window.WorkbenchIcons.create(name, size);
  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  };
  let manager;
  // The catalog is replaced wholesale by the catalog IPC. Keep a complete
  // shape available so a partial/empty reply can never break home rendering.
  const emptyCatalog = () => ({
    datasets: [],
    batches: [],
    dateRange: null,
    dimensionOptions: {},
  });
  const state = {
    status: { unlocked: false, mode: 'locked', workspaceName: '' },
    catalog: emptyCatalog(),
    view: 'home',
    navigationEpoch: 0,
    datasetId: '',
    filters: {},
    chart: 'rate',
    source: 'quality',
    page: 1,
    pageSize: 50,
    sort: { field: 'businessDate', direction: 'desc' },
    report: null,
    rowIds: [],
    qualityReturn: null,
    table: null,
    selection: null,
    busy: 0,
    request: 0,
    legacyTicket: 0,
    lastLegacySignature: null,
    originalReplaceRequired: false,
    import: { step: 1, workbook: null, preview: null, columns: [] },
  };
  manager = window.createWorkspaceManager({
    api,
    canResume: () => state.status.unlocked,
    onResume: async () => {
      const live = await api('status');
      if (!live?.unlocked || live.managedId !== state.status.managedId ||
          live.mode !== state.status.mode || (live.dataSourceMode !== 'auto' && live.dataSourceMode !== state.status.dataSourceMode)) {
        await applyStatus(live);
        return;
      }
      manager.hide();
      document.body.classList.toggle('workbench-home', state.view === 'home');
      state.lastLegacySignature = null;
      scheduleLegacyLayout();
      $('manageWorkspaces').focus({ preventScroll: true });
    },
    onGuide: () => {
      void guideUI.open('workspace-manager');
    },
    onOpen: async (status, route, options) => {
      await applyStatus(status, { deferNavigation: true });
      if (status.analysisPreferences)
        await homeStudio.inheritWorkspace(status.analysisPreferences, status.workspaceName);
      showView(route, options);
    },
    onOldFile: () =>
      run(async () => {
        await api('lock');
        manager.hide();
        await selectWorkspace(false);
      }),
    onDemo: () =>
      run(async () => {
        await api('lock');
        manager.hide();
        await applyStatus(await api('openDemo'));
      }),
    beforeLeave: async () => {
      await window.flushModuleState();
      await labelUI.flush();
      await hideLegacy();
    },
  });
  const workspaceManagerButton = element('button', 'button quiet', '工作区管理');
  workspaceManagerButton.type = 'button';
  workspaceManagerButton.id = 'manageWorkspaces';
  workspaceManagerButton.onclick = () =>
    run(async () => {
      await window.flushModuleState();
      await hideLegacy();
      await manager.open();
    });
  document.querySelector('.toolbar-actions').prepend(workspaceManagerButton);
  window.addEventListener('workbench:workspace-renamed', (event) => {
    if (event.detail?.id === state.status.managedId) {
      state.status.workspaceName = event.detail.name;
      $('workspaceLabel').textContent = event.detail.name;
    }
  });
  const navigation = window.WorkbenchNavigation;
  const trail = navigation.createBackTrail();
  const tabNames = { sources: '数据源与导入', day: '日分析', week: '周分析', month: '月分析', report: '横向A4报告' };
  function refreshBack() {
    const button = $('pageBack'), previous = trail.peek();
    button.hidden = !state.status.unlocked;
    button.disabled = !previous;
    button.title = previous ? '返回：' + (tabNames[previous.analysisTab] || names[previous.view]) + '（Alt + ←）' : '当前没有上一页';
    button.setAttribute('aria-label', button.title);
  }
  function goBack() {
    if (!state.status.unlocked || state.busy || document.querySelector('dialog[open]') ||
        document.body.classList.contains('workspace-management')) return;
    const previous = trail.back();
    if (previous) showView(previous.view, { analysisTab: previous.analysisTab, fromBack: true });
  }
  $('pageBack').onclick = goBack;
  const names = Object.fromEntries(navigation.routes.map((route) => [route.id, route.title]));
  const legacySections = navigation.legacySections;
  const biSections = navigation.biSections;
  const navigationUI = window.createWorkspaceNavigation({
    status: () => state.status,
    view: () => state.view,
    navigate: showView,
    act: (id) => run(() => executeCommon(id)),
    beforeSearch: hideLegacy,
    afterSearch: () => {
      state.lastLegacySignature = null;
      scheduleLegacyLayout();
    },
  });
  const guideUI = window.createGuideUI({
    api,
    beforeOpen: hideLegacy,
    afterClose: () => {
      state.lastLegacySignature = null;
      scheduleLegacyLayout();
    },
    context: () =>
      document.body.classList.contains('workspace-management') ? 'workspace-manager' : state.view,
    onError: (error) => toast(error.message, true),
    allowed: (id) => {
      const mode = state.status.dataSourceMode || 'auto';
      if (id.startsWith('action:')) return navigation.destinationAllowed(id, mode);
      const route =
        id.startsWith('bi-') && !navigation.getRoute(id)
          ? 'bi-center'
          : id.startsWith('label-')
            ? 'label-studio'
            : id;
      return (
        !navigation.getRoute(route) ||
        navigation.allows(route, mode)
      );
    },
  });
  const guideButton = element('button', 'button quiet', '新手引导');
  guideButton.type = 'button';
  guideButton.id = 'openFeatureGuide';
  // The global button always opens the illustrated reader. BI's separate live
  // walkthrough remains available under 数据源与导入 → 导入实操引导.
  guideButton.onclick = () => guideUI.open();
  document.querySelector('.toolbar-actions').prepend(guideButton);
  const dimensionNames = {
    process: '工序',
    model: '型号',
    materialLot: '批次',
    operator: '人员',
    area: '区域',
    relatedCode: '关联编号',
    group: '分组',
  };
  const number = (value) =>
    value === null || value === undefined || !Number.isFinite(value)
      ? '—'
      : new Intl.NumberFormat('zh-CN').format(value);
  const percent = (value) =>
    value === null || value === undefined || !Number.isFinite(value)
      ? '—'
      : `${(value * 100).toFixed(2)}%`;
  const today = () => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };
  const shiftDate = (iso, days) => {
    const date = new Date(`${iso}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  };
  const currentDataset = () => state.catalog.datasets.find((item) => item.id === state.datasetId);
  const classicDashboard = window.createDashboard({
    api,
    onNavigate: showView,
    getScope: queryScope,
    getContext: () => ({
      unlocked: state.status.unlocked,
      datasetLabel: currentDataset()?.label,
      dimensionNames,
      reasonLabels,
    }),
  });
  const homeStudio = window.createHomeStudio({
    api,
    getContext: () => ({
      unlocked: state.status.unlocked,
      mode: state.status.mode,
      dataSourceMode: state.status.dataSourceMode || 'auto',
      catalog: state.catalog || emptyCatalog(),
    }),
    onNavigate: showView,
    onAction: executeCommon,
    onFunctionSearch: () => navigationUI.openSearch(),
    onAnalysisTab: (tab, query) => showView('analysis-studio', { analysisTab: tab, analysisQuery: query }),
  });
  const dashboard = {
    load: () => homeStudio.load(),
    invalidate: () => {
      classicDashboard.invalidate();
      homeStudio.invalidate();
    },
    fail: (text) => {
      classicDashboard.fail(text);
      homeStudio.fail(text);
    },
    clear: () => {
      classicDashboard.clear();
      homeStudio.clear();
    },
  };
  const qualityUI = window.createDataQualityUI({
    api,
    getScope: queryScope,
    unlocked: () => state.status.unlocked,
    onOpen: openQualitySource,
  });
  const labelUI = window.createLabelStudio({ api, unlocked: () => state.status.unlocked });
  const analysisUI = window.createAnalysisStudioUI({
    api,
    unlocked: () => state.status.unlocked,
    renderTools: navigationUI.renderBiTools,
    onTabChange: (before, after) => {
      if (state.view !== 'analysis-studio' || !state.status.unlocked) return;
      trail.syncTab(before);
      trail.visit(state.view, after);
      refreshBack();
    },
  });
  let biRefreshTimer;
  window.workbench?.onBIChanged?.(() => {
    if (!state.status.unlocked) return;
    clearTimeout(biRefreshTimer);
    homeStudio.invalidate();
    biRefreshTimer = setTimeout(() => {
      if (state.status.unlocked && state.view === 'home')
        homeStudio.load().catch((error) => toast(error.message, true));
    }, 100);
  });
  window.flushLabelStudio = () => labelUI.flush();
  const memoryAddresses = {
    shell: { scope: 'global', module: 'shell' },
    analysis: { scope: 'module', module: 'analysis' },
    query: { scope: 'module', module: 'query' },
    page: { scope: 'page', module: 'query', page: 'main' },
    session: { scope: 'workspace', module: 'session' },
  };
  let restoringMemory = false,
    workspaceMemoryReady = false,
    restoredScroll = null;
  const memory = window.createModuleStateClient({
    api,
    onStatus: (value) => {
      const messages = {
        saved: '配置已同步',
        pending: '配置待保存',
        saving: '正在保存配置',
        failed: '配置未保存 · 点击配置记忆重试',
      };
      $('moduleSaveStatus').textContent = messages[value];
      $('moduleSaveStatus').dataset.state = value;
    },
    onError: (error) => toast(error.message, true),
  });
  window.flushModuleState = async () => {
    await memory.flush();
    await homeStudio.flush();
    await guideUI.flush();
    await analysisUI.flush();
  };
  function shellMemory() {
    return {
      theme: document.documentElement.dataset.theme,
      compact: $('compactRows').checked,
      sidebarWidth: Number($('memorySidebarWidth').value),
      sidebarCollapsed: document.body.classList.contains('sidebar-collapsed'),
    };
  }
  function rememberModuleUI(target = 'all') {
    if (restoringMemory) return;
    if (['all', 'global'].includes(target)) memory.change(memoryAddresses.shell, shellMemory());
    if (!workspaceMemoryReady || !state.status.unlocked) return;
    const start = $('startDate').value,
      end = $('endDate').value;
    if (['all', 'analysis'].includes(target) && start && end && start <= end)
      memory.change(memoryAddresses.analysis, {
        datasetId: state.datasetId,
        start,
        end,
        filters: { ...state.filters },
        chart: state.chart,
      });
    if (['all', 'query'].includes(target))
      memory.change(memoryAddresses.query, {
        source: state.source,
        pageSize: state.pageSize,
        sort: { ...state.sort },
      });
    if (['all', 'analysis', 'query', 'page'].includes(target))
      memory.change(memoryAddresses.page, {
        search: $('dataSearch').value,
        page: state.page,
        scroll: Math.round($('mainContent').scrollTop),
      });
    if (target === 'all')
      memory.change(memoryAddresses.session, { lastRoute: state.view, currentTemplateId: '' });
  }
  async function applyRemembered(a, v) {
    restoringMemory = true;
    try {
      if (
        ['home-workspaces', 'home-workspaces-v2', 'home-navigation', 'home-data-source', 'home-bi-columns'].includes(
          a.module,
        )
      ) {
        await homeStudio.reload();
      } else if (a.module === 'shell') {
        setTheme(v.theme, false);
        $('compactRows').checked = v.compact;
        document.body.classList.toggle('compact-rows', v.compact);
        document.body.classList.toggle('sidebar-collapsed', v.sidebarCollapsed);
        $('toggleSidebar').textContent = v.sidebarCollapsed ? '展开侧栏' : '收起侧栏';
        $('toggleSidebar').setAttribute('aria-label', $('toggleSidebar').textContent);
        $('memorySidebarWidth').value = v.sidebarWidth;
        document.documentElement.style.setProperty('--saved-sidebar-width', v.sidebarWidth + 'px');
        scheduleLegacyLayout();
      } else if (a.module === 'analysis') {
        if (state.catalog.datasets.some((x) => x.id === v.datasetId)) state.datasetId = v.datasetId;
        if (!v.datasetId) state.datasetId = state.catalog.datasets[0]?.id || '';
        $('datasetSelect').value = state.datasetId;
        const range = state.catalog.dateRange,
          end = range?.end || today();
        $('startDate').value =
          v.start ||
          (range?.start && range.start > shiftDate(end, -29) ? range.start : shiftDate(end, -29));
        $('endDate').value = v.end || end;
        state.filters = { ...v.filters };
        state.chart = v.chart;
        renderFilters();
        document.querySelectorAll('[data-chart]').forEach((b) => {
          const on = b.dataset.chart === state.chart;
          b.classList.toggle('selected', on);
          b.setAttribute('aria-pressed', String(on));
        });
      } else if (a.module === 'query' && a.scope === 'module') {
        state.source = v.source;
        state.pageSize = v.pageSize;
        state.sort = { ...v.sort };
        $('pageSize').value = v.pageSize;
        document.querySelectorAll('[data-source]').forEach((b) => {
          const on = b.dataset.source === state.source;
          b.classList.toggle('selected', on);
          b.setAttribute('aria-pressed', String(on));
        });
      } else if (a.module === 'query') {
        $('dataSearch').value = v.search;
        state.page = v.page;
        restoredScroll = v.scroll;
      }
    } finally {
      restoringMemory = false;
    }
  }
  async function restoreWorkspaceMemory() {
    workspaceMemoryReady = false;
    for (const name of ['analysis', 'query', 'page', 'session']) {
      const row = await memory.open(memoryAddresses[name]);
      await applyRemembered(memoryAddresses[name], row.data);
    }
    workspaceMemoryReady = true;
    await loadAnalysis();
  }
  const memoryUI = window.createModuleStateUI({
    api,
    client: memory,
    reload: async () => {
      await analysisUI.reload();
      const g = await memory.open(memoryAddresses.shell);
      await applyRemembered(memoryAddresses.shell, g.data);
      if (state.status.unlocked) await restoreWorkspaceMemory();
    },
    apply: async (a, v) => {
      if (a.module === 'analysis-studio') {
        await analysisUI.reload();
        return;
      }
      await applyRemembered(a, v);
      if (a.scope !== 'global') {
        await loadAnalysis();
        if (state.view === 'data') await loadTable();
      }
    },
    beforeOpen: async () => {
      await homeStudio.flush();
      await analysisUI.flush();
      analysisUI.deactivate();
      await hideLegacy();
    },
    afterClose: () => {
      scheduleLegacyLayout();
      if (state.view === 'analysis-studio') analysisUI.activate();
    },
    isUnlocked: () => state.status.unlocked,
    sourceMode: () => state.status.dataSourceMode || 'auto',
  });

  function clearQualitySamples() {
    state.rowIds = [];
    state.qualityReturn = null;
    $('qualitySampleScope').hidden = true;
  }
  function openQualitySource(check, sample) {
    if (check.action === 'data') {
      const samples = sample
        ? [sample]
        : (check.samples || []).filter((row) => row.factId).slice(0, 20);
      if (!samples.length) return;
      state.qualityReturn = queryScope();
      if (state.datasetId !== samples[0].datasetId) state.filters = {};
      state.datasetId = samples[0].datasetId;
      $('datasetSelect').value = state.datasetId;
      state.source = 'quality';
      state.page = 1;
      state.sort = { field: 'businessDate', direction: 'desc' };
      $('dataSearch').value = '';
      state.rowIds = samples
        .filter((row) => row.datasetId === state.datasetId)
        .map((row) => row.factId);
      $('qualitySampleScope').hidden = false;
      $('qualitySampleLabel').textContent =
        `仅查看 ${state.rowIds.length} 行核对样本；完整影响数量见核对页。`;
      document.querySelectorAll('[data-source]').forEach((button) => {
        const selected = button.dataset.source === 'quality';
        button.classList.toggle('selected', selected);
        button.setAttribute('aria-pressed', String(selected));
      });
      renderFilters();
      showView('data');
    } else if (navigation.getRoute(check.action)) showView(check.action);
  }

  function toast(message, error = false) {
    const node = element('div', `toast${error ? ' error' : ''}`);
    node.setAttribute('role', error ? 'alert' : 'status');
    node.append(icon(error ? 'warning' : 'check', 17), element('span', '', message));
    const close = element('button', 'icon-button', '关闭');
    close.type = 'button';
    close.setAttribute('aria-label', '关闭提示');
    close.onclick = () => node.remove();
    node.append(close);
    $('toastRegion').append(node);
    while ($('toastRegion').children.length > 3) $('toastRegion').firstChild.remove();
    setTimeout(() => node.remove(), error ? 11000 : 6500);
  }

  async function api(name, input) {
    if (!window.workbench || typeof window.workbench[name] !== 'function')
      throw new Error('桌面接口尚未就绪，请重新启动开发工作台。');
    const result =
      input === undefined ? await window.workbench[name]() : await window.workbench[name](input);
    if (!result || !result.ok) {
      const error = new Error(result?.error?.message || '操作未完成，请重试。');
      error.code = result?.error?.code;
      if (error.code === 'WORKSPACE_LOCKED') resetWorkspace();
      throw error;
    }
    return result.value;
  }

  async function run(work) {
    if (state.busy) return;
    state.busy++;
    $('busyLine').hidden = false;
    document.body.setAttribute('aria-busy', 'true');
    try {
      return await work();
    } catch (error) {
      toast(error.message || '操作未完成，请重试。', true);
    } finally {
      state.busy--;
      $('busyLine').hidden = true;
      document.body.removeAttribute('aria-busy');
      updateImportButtons();
    }
  }

  function populateIcons(parent = document) {
    parent
      .querySelectorAll('[data-icon]')
      .forEach((node) => node.replaceChildren(icon(node.dataset.icon)));
  }

  function setTheme(value, persist = true) {
    const theme = ['silver', 'glass', 'graphite', 'contrast'].includes(value) ? value : 'silver';
    document.documentElement.dataset.theme = theme;
    window.WorkbenchTheme.applyDocument(document.documentElement, theme, 'shell');
    $('themeSelect').value = theme;
    if (window.workbench?.appearance) api('appearance', { theme }).catch(() => {});
    try {
      if (persist) queueMicrotask(() => rememberModuleUI('global'));
    } catch {}
    if (state.report) drawChart();
    scheduleLegacyLayout();
  }

  function resetWorkspace() {
    guideUI.close();
    document.body.classList.remove('reference-home', 'workbench-home', 'workbench-shell');
    workspaceMemoryReady = false;
    memory.detach();
    state.status = { ...state.status, unlocked: false, mode: 'locked', workspaceName: '' };
    state.navigationEpoch++;
    trail.clear();
    refreshBack();
    navigationUI.setEnabled(false);
    state.catalog = emptyCatalog();
    state.datasetId = '';
    state.report = null;
    state.table = null;
    state.filters = {};
    state.selection = null;
    state.legacyTicket++;
    state.lastLegacySignature = null;
    $('legacyMount').hidden = true;
    $('biMount').hidden = true;
    $('workspaceView').classList.remove('legacy-host');
    state.source = 'quality';
    state.page = 1;
    state.sort = { field: 'businessDate', direction: 'desc' };
    state.request++;
    tableRequest++;
    $('passwordInput').value = '';
    $('confirmPasswordInput').value = '';
    $('passwordInput').type = 'password';
    $('togglePassword').textContent = '显示';
    $('togglePassword').setAttribute('aria-label', '显示密码');
    $('togglePassword').title = '显示密码';
    $('unlockForm').hidden = true;
    $('workspaceView').hidden = true;
    $('lockView').hidden = false;
    $('modeBadge').hidden = true;
    $('workspaceLabel').textContent = '尚未打开工作区';
    $('workspaceLabel').parentElement.classList.remove('unlocked');

    $('lockButton').disabled = true;
    $('viewTitle').textContent = '工作区';
    document.querySelectorAll('[data-view]').forEach((button) => {
      button.disabled = true;
    });
    $('datasetSelect').replaceChildren(new Option('尚无数据集', ''));
    $('dataTableBody').replaceChildren();
    $('dataTableHead').replaceChildren();
    $('trendChart').replaceChildren();
    $('issueDistribution').replaceChildren();
    $('batchList').replaceChildren();
    $('dimensionFilters').replaceChildren();
    $('sheetSample').replaceChildren();
    $('previewSummary').replaceChildren();
    $('previewProblems').replaceChildren();
    $('mappingGrid').replaceChildren();
    $('sheetSelect').replaceChildren();
    $('headerRowSelect').replaceChildren();
    $('scopeDetails').replaceChildren();
    $('qualityStatus').replaceChildren();
    $('qualityScopeDisclosure').hidden = true;
    $('qualityScopeDisclosure').open = false;
    $('qualityScopeSummary').textContent = '';
    $('quantityInsights').replaceChildren();
    qualityUI.clear();
    dashboard.clear();
    labelUI.clear();
    analysisUI.clear();
    clearQualitySamples();
    $('importDatasetSelect').replaceChildren(new Option('建立新数据集', ''));
    $('dataSearch').value = '';
    $('datasetName').value = '';
    $('datasetId').value = '';
    $('pickedFileName').textContent = '';
    $('selectedWorkspace').textContent = '';
    for (const id of ['metricRate', 'metricInspected', 'metricDefective', 'metricRecords'])
      $(id).textContent = '—';
    $('metricRateChange').textContent = '尚无可比较的前期数据';
    $('metricSerials').textContent = '与数量事实独立统计';
    $('securityWorkspace').textContent = '本地工作区';
    $('storageDescription').textContent = '尚未打开加密文件。';
    document.querySelectorAll('[data-source]').forEach((button) => {
      const selected = button.dataset.source === 'quality';
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    $('bottomStatus').textContent = '本地文件，离线可用';
    $('rowStatus').textContent = '整合开发版';
    if ($('importDialog').open) closeImport(false);
    closeOriginalRecords();
    if ($('restoreNoticeDialog').open) $('restoreNoticeDialog').close();
    state.import = { step: 1, workbook: null, preview: null, columns: [] };
    memoryUI.clear();
    if (manager && !manager.transition) manager.open();
  }

  async function applyStatus(status, { deferNavigation = false } = {}) {
    if (!status?.unlocked) {
      resetWorkspace();
      if (status?.version) $('versionLabel').textContent = status.version;
      return;
    }
    manager.hide();
    state.status = status;
    trail.clear();
    refreshBack();
    document.body.classList.add('workbench-shell');
    navigationUI.setEnabled(false);
    state.selection = null;
    $('passwordInput').value = '';
    $('confirmPasswordInput').value = '';
    $('unlockForm').hidden = true;
    $('lockView').hidden = true;
    $('workspaceView').hidden = false;

    $('lockButton').disabled = true;
    document.querySelectorAll('[data-view]').forEach((button) => {
      button.disabled = true;
    });
    $('workspaceLabel').textContent =
      status.workspaceName || (status.mode === 'demo' ? '示例工作区' : '本地工作区');
    $('workspaceLabel').parentElement.classList.add('unlocked');
    $('modeBadge').hidden = status.mode !== 'demo';
    $('demoNotice').hidden = status.mode !== 'demo';
    $('versionLabel').textContent = status.version || '开发版';
    $('bottomStatus').textContent =
      status.mode === 'demo' ? '示例模式，关闭后清空' : '本地加密文件，离线可用';
    await refreshCatalog(true);
    if (state.status !== status || !state.status.unlocked) return;
    try {
      await restoreWorkspaceMemory();
    } catch (error) {
      $('moduleSaveStatus').textContent = '模块配置未恢复';
      toast(error.message, true);
    }
    if (state.status !== status || !state.status.unlocked) return;
    await homeStudio.prepare();
    if (!['records', 'bi'].includes(state.status.dataSourceMode)) {
      let selectedMode = homeStudio.sourceMode();
      if (!['records', 'bi'].includes(selectedMode))
        selectedMode = await window.chooseWorkspaceSource({ name: status.workspaceName });
      if (!selectedMode) {
        await api('lock');
        resetWorkspace();
        return;
      }
      await homeStudio.setSourceMode(selectedMode);
      state.status = { ...state.status, dataSourceMode: selectedMode };
    }
    navigationUI.setEnabled(true);
    $('lockButton').disabled = false;
    $('lockButton').textContent = status.mode === 'demo' ? '退出示例' : '锁定工作区';
    const savedRoute = memory.current(memoryAddresses.session)?.data.lastRoute;
    if (!deferNavigation)
      showView(savedRoute && navigation.getRoute(savedRoute) ? savedRoute : 'home');
  }

  async function selectWorkspace(create) {
    const selected = await api('chooseWorkspace', { create });
    if (selected.cancelled) return;
    state.selection = selected;
    $('passwordInput').type = 'password';
    $('togglePassword').textContent = '显示';
    $('togglePassword').setAttribute('aria-label', '显示密码');
    $('togglePassword').title = '显示密码';
    $('selectedWorkspace').textContent =
      selected.workspaceName || (create ? '新的加密工作区' : '已选择加密文件');
    $('passwordLabel').textContent = create ? '设置工作区密码' : '工作区密码';
    $('passwordInput').autocomplete = create ? 'new-password' : 'current-password';
    $('passwordInput').minLength = create ? 12 : 1;
    $('confirmPasswordWrap').hidden = !create;
    $('confirmPasswordInput').required = create;
    $('confirmPasswordInput').value = '';
    $('passwordHelp').textContent = create
      ? '至少 12 个字符。请保管密码，忘记后无法恢复数据。'
      : '密码仅用于打开此工作区。';
    $('unlockButton').textContent = create ? '创建并打开' : '打开工作区';
    $('unlockForm').hidden = false;
    $('passwordInput').value = '';
    $('passwordInput').focus();
  }

  function showView(view, { analysisTab = null, analysisQuery = null, fromBack = false } = {}) {
    if (!state.status.unlocked) return;
    if (!navigation.getRoute(view)) {
      toast('未找到该功能入口，请使用查找功能。', true);
      return;
    }
    ({ view, analysisTab } = navigation.resolveView(
      view,
      state.status.dataSourceMode || 'auto',
      analysisTab,
    ));
    if (!fromBack) {
      trail.syncTab(analysisUI.currentTab());
      trail.visit(view, analysisTab === 'analysis' ? analysisUI.analysisPeriod() : analysisTab);
    }
    refreshBack();
    guideUI.close();
    const legacy = Object.hasOwn(legacySections, view),
      bi = Object.hasOwn(biSections, view),
      embedded = legacy || bi;
    state.view = view;
    if (view !== 'analysis-studio') analysisUI.deactivate();
    document.body.classList.toggle('workbench-home', view === 'home');
    if (workspaceMemoryReady && !restoringMemory)
      memory.change(memoryAddresses.session, { lastRoute: view, currentTemplateId: '' });
    state.navigationEpoch++;
    $('viewTitle').textContent =
      view === 'analysis-studio' ? names['bi-center'] : names[view] || names.overview;
    navigationUI.setView();
    homeStudio.setRoute(view);
    document.querySelectorAll('[data-workspace-source]').forEach((node) => {
      node.hidden = node.dataset.workspaceSource !== state.status.dataSourceMode;
    });
    document.querySelectorAll('[data-page]').forEach((page) => {
      page.hidden = page.dataset.page !== view;
    });
    $('legacyMount').hidden = !legacy;
    $('biMount').hidden = !bi;
    $('workspaceView').classList.toggle('legacy-host', embedded);
    const quantityScope = ['home', 'overview', 'data', 'quality-check'].includes(view);
    const qualityDisclosure = $('qualityScopeDisclosure');
    if (view === 'quality-check') {
      $('qualityScopeFields').append($('dataScope'), $('dimensionFilters'));
      qualityDisclosure.hidden = false;
      qualityDisclosure.open = false;
    } else if (view === 'home') {
      $('homeScope').append($('dataScope'), $('dimensionFilters'));
      qualityDisclosure.hidden = true;
    } else {
      qualityDisclosure.before($('dataScope'), $('dimensionFilters'));
      qualityDisclosure.hidden = true;
    }
    $('dataScope').hidden = !quantityScope;
    $('dimensionFilters').hidden =
      !quantityScope ||
      !Object.keys(state.catalog?.dimensionOptions?.[state.datasetId] || {}).length;
    if (embedded) {
      $('mainContent').scrollTop = 0;
      $('rowStatus').textContent = bi
        ? 'BI 原格式资料 · 独立明文目录'
        : state.status.mode === 'demo'
          ? '示例内存，退出不保存'
          : '当前工作区自动加密保存';
      scheduleLegacyLayout();
      return;
    }
    hideLegacy().catch((error) => toast(error.message, true));
    $('mainContent').scrollTop = 0;
    $('mainContent').focus({ preventScroll: true });
    const directoryStatus = {
      home: '按录入、查询与跟进顺序处理',
      'analysis-hub': '记录条数、检验数量与BI历史分别统计',
      'data-center': '异常、检验与BI资料分别导入',
      'settings-hub': '加密工作区与BI目录分别备份',
    }[view];
    if (directoryStatus) $('rowStatus').textContent = directoryStatus;
    if (view === 'overview' && state.report) drawChart();
    if (view === 'home')
      dashboard.load().catch((error) => toast(`首页读取失败：${error?.message || error}`, true));
    if (view === 'data') loadTable();
    if (view === 'security') renderSecurity();
    if (view === 'import') renderBatches();
    if (view === 'quality-check') {
      qualityUI.load();
      $('rowStatus').textContent = '只读核对，问题项可能涉及同一行；不会自动更改记录。';
    }
    if (view === 'label-studio') {
      labelUI.activate();
      $('rowStatus').textContent = '夹具标签制作与排版只生成标签，不修改异常记录和原Excel。';
    }
    if (view === 'analysis-studio') {
      if (analysisTab) analysisUI.openTab(analysisTab, analysisQuery).catch((e) => toast(e.message, true));
      else analysisUI.activate();
      $('rowStatus').textContent = 'BI自由分析 · 日期＋工序＋班次匹配 · 本机分析资料单独备份';
    }
  }

  async function executeCommon(id) {
    const action = navigation.getAction(id);
    if (
      !action ||
      !state.status.unlocked ||
      !navigation.allows(action.route, state.status.dataSourceMode || 'auto')
    )
      return;
    showView(action.route);
    const epoch = state.navigationEpoch;
    if (action.action === 'quantity-import') return openImport();
    await updateLegacyLayout();
    if (!state.status.unlocked || epoch !== state.navigationEpoch || state.view !== action.route)
      return;
    await api('legacyAction', { action: action.action });
  }

  async function hideLegacy() {
    state.legacyTicket++;
    state.lastLegacySignature = null;
    if (window.workbench?.hideLegacy) await api('hideLegacy');
    if (window.workbench?.hideBI) await api('hideBI');
  }

  let legacyLayoutTimer;
  function scheduleLegacyLayout() {
    clearTimeout(legacyLayoutTimer);
    legacyLayoutTimer = setTimeout(updateLegacyLayout, 40);
  }

  async function updateLegacyLayout() {
    const bi = Object.hasOwn(biSections, state.view),
      legacy = Object.hasOwn(legacySections, state.view);
    if (
      !state.status.unlocked ||
      (!legacy && !bi) || document.body.classList.contains('workspace-management') ||
      $('importDialog').open ||
      navigationUI.isOpen() ||
      guideUI.isOpen() ||
      $('memoryDialog').open
    )
      return;
    const mount = $(bi ? 'biMount' : 'legacyMount');
    if (mount.hidden) return;
    const rect = mount.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const input = {
      section: (bi ? biSections : legacySections)[state.view],
      bounds: {
        x: Math.max(0, Math.round(rect.x)),
        y: Math.max(0, Math.round(rect.y)),
        width: Math.max(1, Math.floor(rect.width)),
        height: Math.max(1, Math.floor(rect.height)),
      },
      theme: document.documentElement.dataset.theme,
    };
    const signature = JSON.stringify([bi, input]);
    if (state.lastLegacySignature === signature) return;
    state.lastLegacySignature = signature;
    const ticket = ++state.legacyTicket;
    try {
      await api(bi ? 'showBI' : 'showLegacy', input);
    } catch (error) {
      if (ticket === state.legacyTicket && state.status.unlocked) {
        state.lastLegacySignature = null;
        toast(error.message, true);
      }
    }
  }

  async function refreshCatalog(resetRange = false) {
    clearQualitySamples();
    if (state.view === 'home') dashboard.invalidate();
    try {
      const catalog = await api('catalog');
      state.catalog =
        catalog && typeof catalog === 'object' ? { ...emptyCatalog(), ...catalog } : emptyCatalog();
    } catch (error) {
      if (state.view === 'home') dashboard.fail(error.message);
      throw error;
    }
    const datasets = state.catalog.datasets || [];
    if (!datasets.some((item) => item.id === state.datasetId))
      state.datasetId = datasets[0]?.id || '';
    $('datasetSelect').replaceChildren();
    if (!datasets.length) $('datasetSelect').append(new Option('尚无数据集', ''));
    for (const dataset of datasets)
      $('datasetSelect').append(new Option(dataset.label || dataset.id, dataset.id));
    $('datasetSelect').value = state.datasetId;
    if (resetRange || !$('startDate').value || !$('endDate').value) {
      const range = state.catalog.dateRange;
      const end = range?.end || today();
      $('endDate').value = end;
      $('startDate').value =
        range?.start && range.start > shiftDate(end, -29) ? range.start : shiftDate(end, -29);
    }
    state.filters = {};
    renderFilters();
    renderBatches();
    renderSecurity();
    await loadAnalysis();
    if (state.view === 'data') await loadTable();
  }

  function renderFilters() {
    const container = $('dimensionFilters');
    container.replaceChildren();
    const options = state.catalog.dimensionOptions?.[state.datasetId] || {};
    for (const [key, values] of Object.entries(options)) {
      const label = element('label', '', dimensionNames[key] || key);
      const select = document.createElement('select');
      select.setAttribute('aria-label', `筛选${dimensionNames[key] || key}`);
      select.append(new Option('全部', ''));
      for (const value of values) select.append(new Option(value || '未填写', value));
      select.value = state.filters[key] || '';
      select.onchange = () => {
        clearQualitySamples();
        if (select.value) state.filters[key] = select.value;
        else delete state.filters[key];
        state.page = 1;
        loadAnalysis();
        if (state.view === 'data') loadTable();
      };
      label.append(select);
      container.append(label);
    }
    container.hidden =
      !Object.keys(options).length ||
      !['home', 'overview', 'data', 'quality-check'].includes(state.view);
  }

  function queryScope() {
    const start = $('startDate').value,
      end = $('endDate').value;
    if (!start || !end || start > end) {
      $('qualityScopeSummary').textContent = '请检查起止日期';
      throw new Error('请填写有效的开始和结束日期。');
    }
    $('qualityScopeSummary').textContent =
      `${currentDataset()?.label || '尚无检验数据集'}　${start} 至 ${end}`;
    return { start, end, datasetId: state.datasetId, filters: { ...state.filters } };
  }

  const reasonLabels = {
    NO_FACTS: '当前范围没有检验数据',
    MISSING_NUMERATOR: '部分数据缺少不良件数',
    MISSING_DENOMINATOR: '部分数据缺少检验件数',
    ZERO_DENOMINATOR: '部分数据的检验件数为零',
    NUMERATOR_EXCEEDS_DENOMINATOR: '不良件数大于检验件数',
    MIXED_UNITS: '单位不一致',
    UNSUPPORTED_UNIT: '单位暂不支持',
    MIXED_GRAINS: '统计粒度不一致',
    DUPLICATE_GRAIN: '存在重复的日期与统计维度',
    UNSUPPORTED_FILTER: '此来源无法应用当前筛选',
    INVALID_MEASURE: '数量数据无效',
    TOTAL_OVERFLOW: '汇总数量超过支持范围',
  };

  async function loadAnalysis() {
    if (state.view === 'home' && state.status.unlocked) dashboard.load();
    if (state.view === 'quality-check') qualityUI.load();
    const request = ++state.request;
    if (!state.datasetId) {
      $('overviewEmpty').hidden = false;
      $('analysisContent').hidden = true;
      state.report = null;
      return;
    }
    try {
      const report = await api('overview', queryScope());
      if (request !== state.request || !state.status.unlocked) return;
      state.report = report;
      renderAnalysis(report);
    } catch (error) {
      if (request === state.request) toast(error.message, true);
    }
  }

  function renderAnalysis(report) {
    $('overviewEmpty').hidden = true;
    $('analysisContent').hidden = false;
    const quality = report.quality,
      totals = quality.totals || {},
      observations = report.observations || {};
    $('metricRate').textContent = percent(quality.rate?.value);
    $('metricInspected').textContent = number(totals.inspectedUnits);
    $('metricDefective').textContent = number(totals.defectiveUnits);
    $('metricRecords').textContent = number(observations.recordCount);
    $('metricSerials').textContent =
      observations.status === 'unavailable'
        ? '此来源无法应用当前筛选'
        : `涉及 ${number(observations.uniqueSerialCount)} 个 SN`;
    const change = report.insights?.comparisonAvailable
      ? report.comparison?.defectRatePercentagePoints
      : null;
    $('quantityInsights').replaceChildren(
      window.InsightSummary.create(report.insights, {
        onAction: (action) => {
          if (action.kind === 'quality') showView('quality-check');
          else if (action.kind === 'quantity-date') chartDate(action.date);
          else if (
            action.kind === 'quantity-group' &&
            currentDataset()?.grainFields.includes(action.dimension)
          ) {
            clearQualitySamples();
            state.filters[action.dimension] = action.value;
            state.page = 1;
            renderFilters();
            loadAnalysis();
            showView('data');
          }
        },
      }),
    );
    $('metricRateChange').className = '';
    if (change !== null && change !== undefined) {
      const word = change < 0 ? '下降' : change > 0 ? '上升' : '持平';
      $('metricRateChange').textContent =
        change === 0 ? '较前期持平' : `较前期${word} ${Math.abs(change).toFixed(2)} 个百分点`;
      if (change !== 0) $('metricRateChange').classList.add(change < 0 ? 'improved' : 'worsened');
    } else $('metricRateChange').textContent = '前期口径不完整，暂不比较';
    const source = $('qualityStatus');
    source.replaceChildren();
    const available = quality.rate?.status === 'available';
    source.classList.toggle('unavailable', !available);
    source.append(element('strong', '', available ? '当前口径可计算' : '不良率暂不可计算'));
    source.append(
      element(
        'span',
        '',
        available
          ? '使用相同数据集、单位与统计粒度。'
          : [
              ...new Set(
                (quality.rate?.reasons || []).map(
                  (code) => reasonLabels[code] || '数据口径需要核对',
                ),
              ),
            ].join('；'),
      ),
    );
    const scope = queryScope();
    const dataset = currentDataset();
    $('scopeDetails').replaceChildren();
    const details = [
      ['数据集', dataset?.label || scope.datasetId],
      ['当前范围', `${scope.start} 至 ${scope.end}`],
      [
        '比较前期',
        report.comparison?.previous
          ? `${report.comparison.previous.start} 至 ${report.comparison.previous.end}`
          : '—',
      ],
      [
        '统计粒度',
        dataset?.grainFields?.length
          ? dataset.grainFields.map((key) => dimensionNames[key] || key).join('、')
          : '按日期汇总',
      ],
      ['有效数据', `${number(quality.factCount)} 行`],
    ];
    for (const [label, value] of details)
      $('scopeDetails').append(element('dt', '', label), element('dd', '', value));
    $('rowStatus').textContent =
      `${scope.start} 至 ${scope.end}　${number(quality.factCount)} 行检验数据`;
    const issues = observations.issues || [];
    $('observationSummary').hidden = !issues.length;
    $('issueDistribution').replaceChildren();
    const max = Math.max(...issues.map((item) => item.count), 1);
    for (const item of issues.slice(0, 5)) {
      const row = element('div', 'issue-row');
      const title = element('span', '', item.issue || '未填写异常');
      title.title = item.issue || '未填写异常';
      const track = element('div', 'issue-track'),
        fill = svgElement('svg', {
          viewBox: '0 0 100 6',
          preserveAspectRatio: 'none',
          'aria-hidden': 'true',
        });
      fill.append(
        svgElement('rect', { x: 0, y: 0, width: (item.count / max) * 100, height: 6, rx: 3 }),
      );
      track.append(fill);
      row.append(title, track, element('strong', '', number(item.count)));
      $('issueDistribution').append(row);
    }
    drawChart();
  }

  function svgElement(tag, attributes = {}, text) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function chartDate(date) {
    clearQualitySamples();
    $('startDate').value = date;
    $('endDate').value = date;
    state.page = 1;
    state.source = 'quality';
    state.sort = { field: 'businessDate', direction: 'desc' };
    document.querySelectorAll('[data-source]').forEach((button) => {
      const selected = button.dataset.source === state.source;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    loadAnalysis();
    showView('data');
  }

  function drawChart() {
    const report = state.report;
    if (!report) return;
    const trend = report.quality?.trend || [],
      isRate = state.chart === 'rate';
    const container = $('trendChart');
    $('chartKey').replaceChildren();
    const definitions = isRate
      ? [{ name: '不良率', key: 'rate' }]
      : [
          { name: '检验件数', key: 'inspectedUnits' },
          { name: '不良件数', key: 'defectiveUnits' },
        ];
    const series = definitions.map((item) => ({
      name: item.name,
      values: trend.map((day) => (item.key === 'rate' ? day.rate?.value : day.totals?.[item.key])),
    }));
    if (
      !series.some((line) =>
        line.values.some((value) => typeof value === 'number' && Number.isFinite(value)),
      )
    ) {
      const empty = element('div', 'chart-no-data');
      empty.append(
        element('strong', '', '当前范围没有可绘制的数据'),
        element('span', '', '请调整日期，或检查检验数与不良数的列映射。'),
      );
      container.replaceChildren(empty);
      $('chartDetail').textContent = '缺失数据不补零；当前没有可选择的日期。';
      return;
    }
    container.replaceChildren(
      window.ChartSurface.create({
        title: isRate ? '每日不良率' : '每日检验与不良件数',
        minimumWidth: Math.max(480, container.clientWidth),
        unit: isRate ? '%' : '件',
        percent: isRate,
        labels: trend.map((day) => day.date.slice(5).replace('-', '/')),
        fullLabels: trend.map((day) => day.date),
        series,
        onPoint: (_line, index) => chartDate(trend[index].date),
        onReadout: (message) => {
          $('chartDetail').textContent = message + '；点击查看该日期明细。';
        },
      }),
    );
    $('chartDetail').textContent =
      '各点直接标数，横线对应左侧刻度；缺失数据日断开。点击数据点可查看对应日期明细。';
  }

  let tableRequest = 0;
  async function loadTable() {
    const request = ++tableRequest;
    if (!state.datasetId) {
      renderTable({ columns: [], rows: [], total: 0, page: 1, pageSize: state.pageSize });
      return;
    }
    try {
      const result = await api('listData', {
        ...queryScope(),
        source: state.source,
        search: $('dataSearch').value.trim(),
        sort: state.sort,
        page: state.page,
        pageSize: state.pageSize,
        rowIds: state.rowIds,
      });
      if (request !== tableRequest || !state.status.unlocked) return;
      state.table = result;
      state.page = result.page;
      renderTable(result);
    } catch (error) {
      if (request === tableRequest) toast(error.message, true);
    }
  }

  function renderTable(result) {
    const { columns = [], rows = [], total = 0, page = 1, pageSize = state.pageSize } = result;
    $('dataTableHead').replaceChildren();
    $('dataTableBody').replaceChildren();
    const heading = element('tr');
    const sequence = element('th', 'number-column', '序号');
    sequence.scope = 'col';
    heading.append(sequence);
    for (const column of columns) {
      const th = element('th');
      th.scope = 'col';
      const active = state.sort.field === column.key;
      th.setAttribute(
        'aria-sort',
        active ? (state.sort.direction === 'asc' ? 'ascending' : 'descending') : 'none',
      );
      const button = element('button', `sort-button${active ? ' sort-active' : ''}`);
      button.type = 'button';
      button.append(
        element('span', '', column.label),
        element('span', 'sort-arrow', active ? (state.sort.direction === 'asc' ? '↑' : '↓') : '↕'),
      );
      button.onclick = () => {
        state.sort = {
          field: column.key,
          direction: active && state.sort.direction === 'asc' ? 'desc' : 'asc',
        };
        state.page = 1;
        loadTable();
      };
      th.append(button);
      heading.append(th);
    }
    $('dataTableHead').append(heading);
    rows.forEach((row, index) => {
      const tr = element('tr');
      tr.append(element('td', 'number-column', (page - 1) * pageSize + index + 1));
      for (const column of columns) {
        const raw = row[column.key];
        const value =
          raw === null || raw === undefined
            ? '—'
            : column.type === 'number'
              ? number(raw)
              : String(raw);
        const td = element('td', column.type === 'number' ? 'number-cell' : '', value);
        td.title = value;
        tr.append(td);
      }
      $('dataTableBody').append(tr);
    });
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    $('tableEmpty').hidden = rows.length > 0;
    $('dataTableScroll').hidden = rows.length === 0;
    $('tableCount').textContent =
      `${state.source === 'quality' ? '检验数据' : '异常记录'}　${number(total)} 行`;
    const sortColumn = columns.find((item) => item.key === state.sort.field);
    $('sortStatus').textContent = sortColumn
      ? `按${sortColumn.label}${state.sort.direction === 'asc' ? '升序' : '降序'}，序号随当前顺序更新。`
      : '点击表头排序，序号随当前显示顺序更新。';
    $('pageDescription').textContent = total
      ? `显示 ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} 行，共 ${number(total)} 行`
      : '暂无符合条件的数据';
    $('pageNumber').textContent = `${page} / ${pageCount}`;
    $('previousPage').disabled = page <= 1;
    $('nextPage').disabled = page >= pageCount;
    if (restoredScroll !== null && state.view === 'data') {
      const y = restoredScroll;
      restoredScroll = null;
      requestAnimationFrame(() => ($('mainContent').scrollTop = y));
    }
    if (state.view === 'data')
      $('rowStatus').textContent = state.rowIds.length
        ? '当前仅显示核对样本，可返回核对结果或查看全部数据。'
        : `${state.source === 'quality' ? '检验数量' : '异常记录'}明细，共 ${number(total)} 行，按当前日期与筛选显示。`;
  }

  function renderBatches() {
    const batches = [...(state.catalog.batches || [])].sort(
      (a, b) => b.committedAt - a.committedAt,
    );
    $('batchCount').textContent = `${batches.length} 个批次`;
    $('batchList').replaceChildren();
    if (!batches.length) {
      $('batchList').append(
        element('p', 'batch-empty', '尚未导入文件。每次确认导入后会在这里保留来源记录。'),
      );
      return;
    }
    for (const batch of batches) {
      const row = element('div', 'batch-row'),
        text = element('div');
      const dataset = state.catalog.datasets.find((item) => item.id === batch.datasetId);
      text.append(
        element('strong', '', dataset?.label || batch.datasetId),
        element(
          'small',
          '',
          `工作表：${batch.provenance?.sheetName || '—'}　导入时间：${new Date(batch.committedAt).toLocaleString('zh-CN')}`,
        ),
      );
      row.append(text, element('span', '', `${number(batch.factCount)} 行`));
      $('batchList').append(row);
    }
  }

  function renderSecurity() {
    const fileMode = state.status.mode === 'file';
    $('securityWorkspace').textContent = state.status.workspaceName || '本地工作区';
    $('storageDescription').textContent = fileMode
      ? '已打开独立加密文件，确认导入后保存至本机。'
      : '当前为示例内存模式，退出后清空，不写入业务文件。';
    if (state.status.managedId)
      $('storageDescription').textContent =
        '本机工作区由Windows账户保护，无需另设密码。备份请使用本机工作区备份。';
    $('storageBadge').textContent = fileMode ? '已加密保存' : '示例内存';
    $('backupButton').disabled = !fileMode;
    $('originalRecordsButton').disabled = !fileMode;
    $('originalRecordHelp').textContent = fileMode
      ? '读取原异常记录台的表头、记录与跟进，原文件只读保留，数量分析数据不变。'
      : '请先打开或新建加密工作区，再读取原软件数据。';
    $('copyBIData').disabled = !fileMode;
    $('backupBIData').disabled = !fileMode;
    $('copyBIData').closest('article').hidden = state.status.dataSourceMode !== 'bi';
    if (state.status.dataSourceMode === 'bi')
      api('biInfo')
        .then((info) => {
          if (state.status.unlocked)
            $('biEngineStatus').textContent = info.available
              ? `离线引擎已就绪，保留原 BI 的 ${info.pages} 个页面。`
              : '离线分析引擎不完整，请使用完整程序目录。';
        })
        .catch(() => {});
  }

  function closeOriginalRecords() {
    state.originalReplaceRequired = false;
    $('originalPasswordInput').value = '';
    $('originalReplaceConfirmed').checked = false;
    $('originalReplaceWarning').hidden = true;
    $('submitOriginalRecords').textContent = '读取并导入';
    $('originalSourceStatus').textContent = '';
    $('originalSourceDescription').textContent = '';
    if ($('originalRecordsDialog').open) $('originalRecordsDialog').close();
  }

  async function openOriginalRecords() {
    await hideLegacy();
    const info = await api('originalRecordInfo');
    const bytes = Number.isFinite(info.size) && info.size >= 0 ? info.size : 0;
    const size =
      bytes >= 1048576
        ? `${(bytes / 1048576).toFixed(1)} MB`
        : bytes >= 1024
          ? `${(bytes / 1024).toFixed(1)} KB`
          : `${bytes} 字节`;
    closeOriginalRecords();
    $('originalSourceStatus').textContent = info.exists
      ? `已找到原软件加密数据（${size}）。`
      : '未找到可读取的原软件数据。';
    $('originalSourceDescription').textContent =
      info.description || '原文件只作为读取来源，不会被改写。';
    $('originalPasswordInput').disabled = !info.exists;
    $('submitOriginalRecords').disabled = !info.exists;
    $('originalRecordsDialog').showModal();
    if (info.exists) $('originalPasswordInput').focus();
    else $('cancelOriginalRecords').focus();
  }

  async function submitOriginalRecords() {
    if (state.originalReplaceRequired && !$('originalReplaceConfirmed').checked)
      throw new Error('请先明确确认是否替换当前异常记录。');
    const password = $('originalPasswordInput').value;
    if (!password) throw new Error('请输入原软件密码。');
    try {
      const result = await api('importOriginalRecords', {
        password,
        replaceConfirmed: state.originalReplaceRequired && $('originalReplaceConfirmed').checked,
      });
      closeOriginalRecords();
      const count = result.importedCount ?? result.recordCount ?? result.count;
      toast(
        Number.isSafeInteger(count)
          ? `已导入 ${number(count)} 条异常记录，数量分析数据保持不变。`
          : '原软件数据已导入当前工作区，数量分析数据保持不变。',
      );
      await refreshCatalog(false);
    } catch (error) {
      if (error.code !== 'LEGACY_REPLACE_CONFIRMATION_REQUIRED') throw error;
      state.originalReplaceRequired = true;
      $('originalReplaceWarning').hidden = false;
      $('originalReplaceConfirmed').checked = false;
      $('submitOriginalRecords').textContent = '确认替换并导入';
      $('originalReplaceConfirmed').focus();
    }
  }

  async function openRestoreNotice() {
    await hideLegacy();
    const fileMode = state.status.mode === 'file';
    $('restoreNoticeText').textContent = fileMode
      ? '请先保存当前工作区的加密备份。继续后会锁定当前工作区，再选择备份并恢复到新文件。'
      : '当前是示例内存模式，继续后会关闭示例且不保存其修改，再选择加密备份。';
    $('restoreBackupStatus').textContent = '';
    $('backupBeforeRestore').hidden = !fileMode;
    $('confirmRestore').textContent = fileMode ? '已备份，继续恢复' : '关闭示例并继续';
    $('restoreNoticeDialog').showModal();
  }

  async function startRestore() {
    if ($('restoreNoticeDialog').open) $('restoreNoticeDialog').close();
    await api('lock');
    resetWorkspace();
    const result = await api('restoreWorkspace');
    if (result.cancelled) return;
    state.selection = result;
    $('selectedWorkspace').textContent = result.workspaceName || '待恢复的工作区';
    $('passwordInput').minLength = 1;
    $('passwordInput').autocomplete = 'current-password';
    $('confirmPasswordWrap').hidden = true;
    $('confirmPasswordInput').required = false;
    $('passwordLabel').textContent = '备份密码';
    $('passwordHelp').textContent = '验证密码后恢复到新文件，不覆盖原工作区。';
    $('unlockButton').textContent = '验证并恢复';
    $('unlockForm').hidden = false;
    $('passwordInput').focus();
  }

  function setImportStep(step) {
    state.import.step = step;
    document.querySelectorAll('[data-import-step]').forEach((node) => {
      node.hidden = Number(node.dataset.importStep) !== step;
    });
    document.querySelectorAll('[data-step-label]').forEach((node) => {
      const value = Number(node.dataset.stepLabel);
      node.classList.toggle('current', value === step);
      node.classList.toggle('complete', value < step);
      if (value === step) node.setAttribute('aria-current', 'step');
      else node.removeAttribute('aria-current');
    });
    $('dialogSubtitle').textContent = [
      '',
      '选择文件，不修改原工作簿。',
      '选中列名称所在行，核对样本。',
      '确认日期、数量与统计维度。',
      '核对校验结果后再整批保存。',
    ][step];
    $('dialogStatus').textContent = step > 1 ? state.import.workbook?.fileName || '' : '';
    updateImportButtons();
  }

  function updateImportButtons() {
    const step = state.import.step;
    $('importBack').hidden = step <= 1;
    $('importNext').hidden = step === 4;
    $('commitImport').hidden = step !== 4;
    $('importNext').textContent = step === 3 ? '检查并预览' : '下一步';
    $('importNext').disabled =
      !!state.busy ||
      (step === 1 && !state.import.workbook) ||
      (step === 2 && !state.import.columns.length);
    const preview = state.import.preview;
    $('commitImport').disabled =
      !!state.busy ||
      !preview ||
      preview.stats?.errorCount > 0 ||
      !preview.stats?.validRowCount ||
      (preview.requiresAcknowledgement && !$('acknowledgeWarnings').checked);
    $('pickWorkbook').disabled = !!state.busy;
  }

  async function openImport() {
    if (!state.status.unlocked) return;
    try {
      await hideLegacy();
    } catch (error) {
      toast(error.message, true);
      return;
    }
    if (!state.status.unlocked) return;
    state.import = { step: 1, workbook: null, preview: null, columns: [] };
    $('pickedFileName').hidden = true;
    $('sheetSample').replaceChildren();
    $('previewProblems').replaceChildren();
    $('acknowledgeWarnings').checked = false;
    $('datasetName').value = '';
    $('datasetId').value = '';
    $('dateFormat').value = 'iso';
    setImportStep(1);
    $('importDialog').showModal();
    $('pickWorkbook').focus();
  }

  function closeImport(cancel = true) {
    const preview = state.import.preview;
    state.import.preview = null;
    if (cancel && preview) api('cancelImport', { previewId: preview.previewId }).catch(() => {});
    if ($('importDialog').open) $('importDialog').close();
    scheduleLegacyLayout();
  }

  function selectedSheet() {
    return state.import.workbook?.sheets?.find((item) => item.name === $('sheetSelect').value);
  }

  function chooseHeaderRows() {
    const sheet = selectedSheet();
    $('headerRowSelect').replaceChildren();
    if (!sheet || sheet.previewError) {
      state.import.columns = [];
      $('sheetHelp').textContent = sheet?.previewError?.message || '工作表无法预览。';
      renderSample();
      updateImportButtons();
      return;
    }
    const samples = sheet.sample || [];
    const candidates = sheet.candidateHeaderRows?.length
      ? sheet.candidateHeaderRows
      : samples.map((row) => row.rowNumber);
    for (const rowNumber of candidates)
      $('headerRowSelect').append(new Option(`第 ${rowNumber} 行`, String(rowNumber)));
    const preferred = samples.find(
      (row) =>
        candidates.includes(row.rowNumber) &&
        row.cells.some((cell) => /业务日|发现日期|检验数|检验件数|不良件数|日期/.test(cell.value)),
    );
    if (preferred) $('headerRowSelect').value = String(preferred.rowNumber);
    $('sheetHelp').textContent = '请选中真正的列名称所在行，不要把标题或数据当作表头。';
    renderSample();
    updateImportButtons();
  }

  function renderSample() {
    const sheet = selectedSheet(),
      sample = sheet?.sample || [],
      selected = Number($('headerRowSelect').value);
    const header = sample.find((row) => row.rowNumber === selected);
    state.import.columns = (header?.cells || []).map((cell) => cell.value.trim()).filter(Boolean);
    $('sheetSample').replaceChildren();
    if (!sample.length) return;
    const letters = [...new Set(sample.flatMap((row) => row.cells.map((cell) => cell.column)))];
    const head = element('thead'),
      heading = element('tr');
    heading.append(element('th', '', '行'));
    for (const letter of letters) heading.append(element('th', '', letter));
    head.append(heading);
    $('sheetSample').append(head);
    const body = element('tbody');
    for (const row of sample) {
      const tr = element('tr', row.rowNumber === selected ? 'selected-header' : '');
      tr.append(element('td', '', row.rowNumber));
      for (const letter of letters) {
        const value = row.cells.find((cell) => cell.column === letter)?.value || '';
        const td = element('td', '', value);
        td.title = value;
        tr.append(td);
      }
      body.append(tr);
    }
    $('sheetSample').append(body);
  }

  const mappingFields = [
    {
      key: 'date',
      label: '业务日期',
      required: true,
      aliases: ['业务日', '业务日期', '日期', '发现日期', 'date', 'businessDate'],
    },
    {
      key: 'inspectedUnits',
      label: '检验件数',
      group: 'measures',
      aliases: ['检验数', '检验件数', '检验数量', '检查数量', 'inspectedUnits'],
    },
    {
      key: 'defectiveUnits',
      label: '不良件数',
      group: 'measures',
      aliases: ['不良件数', '不良数', '不良数量', 'defectiveUnits'],
    },
    {
      key: 'productionUnits',
      label: '产量',
      group: 'measures',
      aliases: ['产量', '生产数', '生产数量', 'productionUnits'],
    },
    {
      key: 'defectEvents',
      label: '缺陷次数',
      group: 'measures',
      aliases: ['缺陷次数', '缺陷数', 'defectEvents'],
    },
    { key: 'process', label: '工序', group: 'dimensions', aliases: ['工序', '制程', 'process'] },
    {
      key: 'model',
      label: '型号',
      group: 'dimensions',
      aliases: ['型号', '原料型号', '产品型号', 'model'],
    },
    {
      key: 'materialLot',
      label: '批次',
      group: 'dimensions',
      aliases: ['批次', '物料lot', '物料批次', 'materialLot'],
    },
    {
      key: 'operator',
      label: '人员',
      group: 'dimensions',
      aliases: ['人员', '员工', '操作员', 'operator'],
    },
  ];

  function prepareMapping() {
    $('importDatasetSelect').replaceChildren(new Option('建立新数据集', ''));
    for (const dataset of state.catalog.datasets || [])
      $('importDatasetSelect').append(new Option(dataset.label || dataset.id, dataset.id));
    if (state.datasetId) $('importDatasetSelect').value = state.datasetId;
    $('mappingGrid').replaceChildren();
    for (const field of mappingFields) {
      const label = element('label', 'mapping-field');
      const caption = element('span', '', field.label);
      if (field.required) caption.append(element('span', 'required-mark', '*'));
      const select = document.createElement('select');
      select.id = `map_${field.key}`;
      select.append(new Option(field.required ? '请选择来源列' : '不导入此项', ''));
      for (const column of state.import.columns) select.append(new Option(column, column));
      const match = state.import.columns.find((column) =>
        field.aliases.some((alias) => alias.toLowerCase() === column.toLowerCase()),
      );
      if (match) select.value = match;
      label.append(caption, select);
      $('mappingGrid').append(label);
    }
    applyDatasetChoice();
  }

  function applyDatasetChoice() {
    const dataset = state.catalog.datasets.find(
      (item) => item.id === $('importDatasetSelect').value,
    );
    $('datasetName').readOnly = !!dataset;
    $('datasetId').readOnly = !!dataset;
    if (dataset) {
      $('datasetName').value = dataset.label;
      $('datasetId').value = dataset.id;
    } else {
      $('datasetName').value ||= (state.import.workbook?.fileName || '').replace(/\.xlsx$/i, '');
      if (
        $('datasetId').readOnly === false &&
        state.catalog.datasets.some((item) => item.id === $('datasetId').value)
      )
        $('datasetId').value = '';
      $('datasetId').value ||= `quality${Date.now().toString(36)}`;
    }
  }

  function importConfiguration() {
    const columns = state.import.columns;
    const dateColumn = $('map_date').value;
    if (!dateColumn) throw new Error('请指定业务日期的来源列。');
    const dimensions = {},
      measures = {};
    for (const field of mappingFields)
      if (field.group && $(`map_${field.key}`).value)
        (field.group === 'dimensions' ? dimensions : measures)[field.key] = $(
          `map_${field.key}`,
        ).value;
    if (!Object.keys(measures).length)
      throw new Error('请至少选择一项数量指标，建议同时指定检验件数和不良件数。');
    const selected = [dateColumn, ...Object.values(dimensions), ...Object.values(measures)];
    if (new Set(selected).size !== selected.length)
      throw new Error('同一来源列不能同时用于两个不同字段。');
    if (selected.some((value) => !columns.includes(value)))
      throw new Error('来源列已变化，请重新核对表头。');
    const existing = state.catalog.datasets.find(
      (item) => item.id === $('importDatasetSelect').value,
    );
    const id = $('datasetId').value.trim(),
      label = $('datasetName').value.trim();
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(id))
      throw new Error('内部名称应以英文字母开头，只使用英文、数字和下划线。');
    if (!label) throw new Error('请填写数据集名称。');
    const grainFields = existing ? existing.grainFields : Object.keys(dimensions);
    if (grainFields.some((field) => !dimensions[field]))
      throw new Error('请为现有数据集的所有统计维度指定来源列。');
    return {
      workbookToken: state.import.workbook.workbookToken,
      source: { sheetName: $('sheetSelect').value, headerRow: Number($('headerRowSelect').value) },
      dataset: existing || { id, label, version: '1', grainFields, unit: 'piece' },
      mapping: { dateColumn, dateFormat: $('dateFormat').value, dimensions, measures },
    };
  }

  function renderPreview(preview) {
    state.import.preview = preview;
    $('previewSummary').replaceChildren();
    $('previewProblems').replaceChildren();
    $('acknowledgeWarnings').checked = false;
    for (const [label, value, invalid] of [
      ['读取行数', preview.stats?.rowCount, false],
      ['有效行数', preview.stats?.validRowCount, false],
      ['需修正', preview.stats?.errorCount, true],
    ]) {
      const stat = element('div', `preview-stat${invalid && value > 0 ? ' invalid' : ''}`);
      stat.append(element('span', '', label), element('strong', '', number(value)));
      $('previewSummary').append(stat);
    }
    if (preview.errors?.length) {
      $('previewProblems').append(
        element('h3', '', `发现 ${number(preview.stats.errorCount)} 处错误，整批暂不保存`),
      );
      const list = element('ul');
      for (const error of preview.errors)
        list.append(
          element(
            'li',
            'error-item',
            `第 ${error.rowNumber} 行　${dimensionNames[error.field] || error.field}：${error.message}`,
          ),
        );
      $('previewProblems').append(list);
      if (preview.stats.truncatedErrors)
        $('previewProblems').append(
          element('p', 'field-help', '这里只展示前 50 条，请先修正源文件后重新选择。'),
        );
    }
    if (preview.warnings?.length) {
      $('previewProblems').append(
        element(
          'h3',
          '',
          `需要核对 ${number(preview.warningCount ?? preview.warnings.length)} 条提示`,
        ),
      );
      const list = element('ul');
      for (const warning of preview.warnings)
        list.append(
          element(
            'li',
            '',
            `${warning.rowNumber ? `第 ${warning.rowNumber} 行${warning.column ? ` ${warning.column} 列` : ''}　` : ''}${warning.message}`,
          ),
        );
      $('previewProblems').append(list);
      if (preview.warningsTruncated)
        $('previewProblems').append(
          element('p', 'field-help', '提示较多，仅展示前 100 条。请核对完整源文件。'),
        );
    }
    if (!preview.stats.errorCount && !preview.warnings?.length) {
      const ready = element('div', 'preview-ready');
      ready.append(icon('check', 18), document.createTextNode('格式检查通过，可以确认导入。'));
      $('previewProblems').append(ready);
    }
    $('acknowledgeWrap').hidden = !preview.requiresAcknowledgement;
  }

  async function importNext() {
    const step = state.import.step;
    if (step === 1) {
      setImportStep(2);
      chooseHeaderRows();
      return;
    }
    if (step === 2) {
      if (!state.import.columns.length) throw new Error('请选择可用的表头行。');
      prepareMapping();
      setImportStep(3);
      return;
    }
    if (step === 3) {
      const configuration = importConfiguration();
      const preview = await api('previewImport', configuration);
      renderPreview(preview);
      setImportStep(4);
    }
  }

  function bindEvents() {
    $('themeSelect').onchange = () => setTheme($('themeSelect').value);
    $('toggleSidebar').onclick = () => {
      const collapsed = document.body.classList.toggle('sidebar-collapsed');
      $('toggleSidebar').setAttribute('aria-label', collapsed ? '展开侧栏' : '收起侧栏');
      $('toggleSidebar').textContent = collapsed ? '展开侧栏' : '收起侧栏';
      scheduleLegacyLayout();
    };
    $('openWorkspace').onclick = () => run(() => selectWorkspace(false));
    $('createWorkspace').onclick = () => manager.open().then(() => manager.create());
    $('cancelSelection').onclick = () => {
      state.selection = null;
      $('passwordInput').value = '';
      $('confirmPasswordInput').value = '';
      $('unlockForm').hidden = true;
    };
    $('togglePassword').onclick = () => {
      const show = $('passwordInput').type === 'password';
      $('passwordInput').type = show ? 'text' : 'password';
      $('togglePassword').textContent = show ? '隐藏' : '显示';
      $('togglePassword').setAttribute('aria-label', show ? '隐藏密码' : '显示密码');
      $('togglePassword').title = show ? '隐藏密码' : '显示密码';
      $('passwordInput').focus();
    };
    $('unlockForm').onsubmit = (event) => {
      event.preventDefault();
      run(async () => {
        if (!state.selection) throw new Error('请先选择工作区。');
        const password = $('passwordInput').value;
        if (state.selection.create && password.length < 12)
          throw new Error('新工作区密码至少需要 12 个字符。');
        if (state.selection.create && password !== $('confirmPasswordInput').value)
          throw new Error('两次输入的密码不一致，请重新核对。');
        const status = await api('unlock', {
          selectionToken: state.selection.selectionToken,
          password,
        });
        $('passwordInput').value = '';
        $('confirmPasswordInput').value = '';
        await applyStatus(status);
      });
    };
    $('openDemo').onclick = () => run(async () => applyStatus(await api('openDemo')));
    $('copyBIData').onclick = () =>
      run(async () => {
        const result = await api('importBIData');
        if (!result.cancelled)
          toast(
            result.remapped
              ? 'BI资料已复制。外部历史/输出路径已改为工作副本内目录，请核对原资料位置。'
              : 'BI资料已复制，原资料保持不变。',
          );
      });
    $('backupBIData').onclick = () =>
      run(async () => {
        const result = await api('backupBI');
        if (!result.cancelled) toast('BI完整目录备份已保存：' + result.name + '（原格式、明文）。');
      });
    $('demoNewWorkspace').onclick = () =>
      run(async () => {
        await memory.flush();
        await api('lock');
        resetWorkspace();
        await manager.open();
        manager.create();
      });
    $('lockButton').onclick = () =>
      run(async () => {
        await memory.flush();
        await labelUI.flush();
        await api('lock');
        resetWorkspace();
      });

    document
      .querySelectorAll('[data-start-import]')
      .forEach((button) => (button.onclick = openImport));
    $('datasetSelect').onchange = () => {
      clearQualitySamples();
      state.datasetId = $('datasetSelect').value;
      state.filters = {};
      state.page = 1;
      renderFilters();
      loadAnalysis();
      if (state.view === 'data') loadTable();
    };
    const dateChanged = () => {
      clearQualitySamples();
      state.page = 1;
      loadAnalysis();
      if (state.view === 'data') loadTable();
    };
    $('startDate').onchange = dateChanged;
    $('endDate').onchange = dateChanged;
    document.querySelectorAll('[data-days]').forEach(
      (button) =>
        (button.onclick = () => {
          const range = state.catalog.dateRange;
          if (button.dataset.days === 'all') {
            $('startDate').value = range?.start || today();
            $('endDate').value = range?.end || today();
          } else {
            const end = range?.end || today();
            $('endDate').value = end;
            $('startDate').value = shiftDate(end, 1 - Number(button.dataset.days));
          }
          dateChanged();
        }),
    );
    $('refreshButton').onclick = () => run(() => refreshCatalog(false));
    document.querySelectorAll('[data-chart]').forEach(
      (button) =>
        (button.onclick = () => {
          state.chart = button.dataset.chart;
          document.querySelectorAll('[data-chart]').forEach((item) => {
            const selected = item === button;
            item.classList.toggle('selected', selected);
            item.setAttribute('aria-pressed', String(selected));
          });
          drawChart();
        }),
    );
    $('showDataButton').onclick = () => showView('data');
    $('clearQualitySamples').onclick = () => {
      clearQualitySamples();
      state.page = 1;
      loadTable();
    };
    $('returnQualityCheck').onclick = () => {
      const scope = state.qualityReturn;
      clearQualitySamples();
      if (scope) {
        state.datasetId = scope.datasetId;
        state.filters = { ...scope.filters };
        $('datasetSelect').value = scope.datasetId;
        $('startDate').value = scope.start;
        $('endDate').value = scope.end;
        renderFilters();
      }
      showView('quality-check');
    };
    document.querySelectorAll('[data-source]').forEach(
      (button) =>
        (button.onclick = () => {
          state.source = button.dataset.source;
          clearQualitySamples();
          state.page = 1;
          state.sort = {
            field: state.source === 'quality' ? 'businessDate' : 'observedOn',
            direction: 'desc',
          };
          document.querySelectorAll('[data-source]').forEach((item) => {
            const selected = item === button;
            item.classList.toggle('selected', selected);
            item.setAttribute('aria-pressed', String(selected));
          });
          loadTable();
        }),
    );
    let searchTimer;
    $('dataSearch').oninput = () => {
      clearQualitySamples();
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        state.page = 1;
        loadTable();
      }, 220);
    };
    $('pageSize').onchange = () => {
      state.pageSize = Number($('pageSize').value);
      state.page = 1;
      loadTable();
    };
    $('previousPage').onclick = () => {
      if (state.page > 1) {
        state.page--;
        loadTable();
      }
    };
    $('nextPage').onclick = () => {
      state.page++;
      loadTable();
    };
    $('compactRows').onchange = () => {
      document.body.classList.toggle('compact-rows', $('compactRows').checked);
      try {
        queueMicrotask(() => rememberModuleUI('global'));
      } catch {}
    };
    $('backupButton').onclick = () =>
      run(async () => {
        const result = await api('backup');
        if (!result.cancelled) toast('加密备份已保存，请妥善保管。');
      });
    $('restoreButton').onclick = () => run(openRestoreNotice);
    $('cancelRestore').onclick = () => {
      if (!state.busy) {
        $('restoreNoticeDialog').close();
        scheduleLegacyLayout();
      }
    };
    $('restoreNoticeDialog').addEventListener('cancel', (event) => {
      event.preventDefault();
      if (!state.busy) {
        $('restoreNoticeDialog').close();
        scheduleLegacyLayout();
      }
    });
    $('backupBeforeRestore').onclick = () =>
      run(async () => {
        const result = await api('backup');
        if (!result.cancelled) {
          $('restoreBackupStatus').textContent = '加密备份已保存，可以继续恢复。';
          toast('加密备份已保存。');
        }
      });
    $('confirmRestore').onclick = () => run(startRestore);
    $('originalRecordsButton').onclick = () => run(openOriginalRecords);
    $('cancelOriginalRecords').onclick = () => {
      if (!state.busy) {
        closeOriginalRecords();
        scheduleLegacyLayout();
      }
    };
    $('originalRecordsDialog').addEventListener('cancel', (event) => {
      event.preventDefault();
      if (!state.busy) {
        closeOriginalRecords();
        scheduleLegacyLayout();
      }
    });
    $('originalRecordsForm').onsubmit = (event) => {
      event.preventDefault();
      run(submitOriginalRecords);
    };
    $('closeImport').onclick = () => {
      if (!state.busy) closeImport();
    };
    $('importDialog').addEventListener('cancel', (event) => {
      event.preventDefault();
      if (!state.busy) closeImport();
    });
    $('pickWorkbook').onclick = () =>
      run(async () => {
        const workbook = await api('pickWorkbook');
        if (workbook.cancelled) return;
        state.import.workbook = workbook;
        $('pickedFileName').hidden = false;
        $('pickedFileName').textContent = workbook.fileName;
        $('sheetSelect').replaceChildren();
        for (const sheet of workbook.sheets || [])
          $('sheetSelect').append(
            new Option(`${sheet.name}${sheet.state !== 'visible' ? '（隐藏）' : ''}`, sheet.name),
          );
        const visible = workbook.sheets.find(
          (sheet) => sheet.state === 'visible' && !sheet.previewError,
        );
        if (visible) $('sheetSelect').value = visible.name;
        setImportStep(2);
        chooseHeaderRows();
      });
    $('sheetSelect').onchange = chooseHeaderRows;
    $('headerRowSelect').onchange = () => {
      renderSample();
      updateImportButtons();
    };
    $('importDatasetSelect').onchange = applyDatasetChoice;
    $('importNext').onclick = () => run(importNext);
    $('importBack').onclick = () =>
      run(async () => {
        if (state.import.preview) {
          const preview = state.import.preview;
          state.import.preview = null;
          await api('cancelImport', { previewId: preview.previewId });
        }
        setImportStep(Math.max(1, state.import.step - 1));
      });
    $('acknowledgeWarnings').onchange = updateImportButtons;
    $('commitImport').onclick = () =>
      run(async () => {
        const preview = state.import.preview;
        if (!preview) return;
        const result = await api('commitImport', {
          previewId: preview.previewId,
          acknowledgeWarnings: $('acknowledgeWarnings').checked,
        });
        state.import.preview = null;
        closeImport(false);
        toast(
          result.status === 'duplicate'
            ? '此文件已导入，本次没有重复保存。'
            : `已导入 ${number(result.batch?.factCount ?? preview.stats.validRowCount)} 行数据。`,
        );
        await refreshCatalog(true);
        showView('overview');
      });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft' && event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey &&
          !event.defaultPrevented && !event.repeat && !event.isComposing && trail.peek() &&
          !event.target.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])') &&
          !document.querySelector('dialog[open]') && !document.body.classList.contains('workspace-management')) {
        event.preventDefault();
        goBack();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        navigationUI.openSearch();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') {
        event.preventDefault();
        if (state.status.unlocked) $('lockButton').click();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        if (state.status.unlocked && !$('importDialog').open) {
          if (state.status.dataSourceMode === 'bi')
            showView('analysis-studio', { analysisTab: 'sources' });
          else if (state.status.dataSourceMode === 'records')
            void executeCommon('import-record-xlsx');
        }
      }
    });
    window.addEventListener('resize', () => {
      if (state.report) drawChart();
      scheduleLegacyLayout();
    });
    document.addEventListener('change', (event) => {
      const scope = event.target.closest('#dataScope,#dimensionFilters')
        ? 'analysis'
        : event.target.id === 'pageSize'
          ? 'query'
          : ['themeSelect', 'compactRows', 'memorySidebarWidth'].includes(event.target.id)
            ? 'global'
            : null;
      if (scope) queueMicrotask(() => rememberModuleUI(scope));
    });
    document.addEventListener('click', (event) => {
      const target = event.target;
      const scope = target.closest('[data-chart],[data-days]')
        ? 'analysis'
        : target.closest('[data-source],.sort-button')
          ? 'query'
          : target.closest('#previousPage,#nextPage')
            ? 'page'
            : target.closest('#toggleSidebar')
              ? 'global'
              : null;
      if (scope) queueMicrotask(() => rememberModuleUI(scope));
    });
    $('dataSearch').addEventListener('input', () => queueMicrotask(() => rememberModuleUI('page')));
    $('memorySidebarWidth').addEventListener('input', () => {
      document.documentElement.style.setProperty(
        '--saved-sidebar-width',
        $('memorySidebarWidth').value + 'px',
      );
      rememberModuleUI('global');
      scheduleLegacyLayout();
    });
    let scrollMemoryTimer;
    $('mainContent').addEventListener(
      'scroll',
      () => {
        if (state.view === 'data') {
          clearTimeout(scrollMemoryTimer);
          scrollMemoryTimer = setTimeout(() => rememberModuleUI('page'), 200);
        }
      },
      { passive: true },
    );
    new ResizeObserver(scheduleLegacyLayout).observe($('legacyMount'));
    new ResizeObserver(scheduleLegacyLayout).observe($('biMount'));
  }

  async function init() {
    navigationUI.init();
    populateIcons();
    bindEvents();
    try {
      const row = await memory.open(memoryAddresses.shell);
      let settings = row.data;
      if (row.revision === 0 && !row.corrupt) {
        const theme = localStorage.getItem('qa-workbench-theme');
        const compact = localStorage.getItem('qa-workbench-compact');
        if (['silver', 'glass', 'graphite', 'contrast'].includes(theme))
          settings = { ...settings, theme };
        if (compact !== null) settings = { ...settings, compact: compact === 'true' };
      }
      await applyRemembered(memoryAddresses.shell, settings);
      if (!row.corrupt) memory.change(memoryAddresses.shell, settings);
    } catch (error) {
      $('moduleSaveStatus').textContent = '全局配置未恢复';
      toast(error.message, true);
      setTheme('silver', false);
    }
    if (window.workbench?.onLocked) window.workbench.onLocked(() => resetWorkspace());
    if (window.workbench?.onAppearance)
      window.workbench.onAppearance((value) => setTheme(value.theme, !value.preview));
    if (window.workbench?.onFunctionSearch)
      window.workbench.onFunctionSearch(navigationUI.openSearch);
    window.workbench?.onNavigateRequest?.((input) => {
      if (
        state.status.unlocked &&
        input?.route !== state.view &&
        Object.hasOwn(biSections, state.view) &&
        (input?.route === 'bi-center' || Object.hasOwn(biSections, input?.route))
      )
        showView(input.route);
    });
    try {
      await applyStatus(await api('status'));
    } catch (error) {
      toast(error.message, true);
    }
  }
  init();
})();
