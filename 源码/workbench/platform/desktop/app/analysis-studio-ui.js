'use strict';
window.createAnalysisStudioUI = ({ api, unlocked, renderTools = null, onTabChange = () => {} }) => {
  const M = window.AnalysisStudio,
    C = window.AnalysisCalendar,
    A = window.A4Report;
  const ADDRESS = { scope: 'module', module: 'analysis-studio' },
    DRAFT = { scope: 'draft', module: 'analysis-source' },
    CALENDAR = { scope: 'module', module: 'analysis-calendar' },
    CALENDAR_DRAFT = { scope: 'draft', module: 'analysis-calendar' };
  const root = () => document.getElementById('analysisStudioRoot');
  const el = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = String(text);
    if (cls) n.className = cls;
    return n;
  };
  const btn = (text, fn, primary = false) => {
    const n = el('button', text, 'button ' + (primary ? 'primary' : 'secondary'));
    n.type = 'button';
    n.onclick = () => Promise.resolve().then(fn).catch(fail);
    return n;
  };
  const field = (label, value, fn, type = 'text') => {
    const n = el('label', label, 'lab-field'),
      input = el('input');
    input.type = type;
    input.value = value;
    input.onchange = () =>
      Promise.resolve(fn(type === 'number' ? Number(input.value) : input.value)).catch(fail);
    n.append(input);
    return n;
  };
  const select = (label, options, value, fn) => {
    const n = el('label', label, 'lab-field'),
      input = el('select');
    options.forEach(([id, text]) => input.add(new Option(text, id)));
    input.value = value;
    input.onchange = () => Promise.resolve(fn(input.value)).catch(fail);
    n.append(input);
    return n;
  };
  const check = (label, value, fn) => {
    const n = el('label', undefined, 'lab-check'),
      input = el('input');
    input.type = 'checkbox';
    input.checked = value;
    input.onchange = () => Promise.resolve(fn(input.checked)).catch(fail);
    n.append(input, el('span', label));
    return n;
  };
  const fmt = (v) =>
    v === null || v === undefined
      ? '—'
      : Number(v).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  const pct = (v) => (v === null || v === undefined ? '—' : (v * 100).toFixed(2) + '%');
  const types = [
    ['bar', '条形图'],
    ['column', '柱形图'],
    ['pie', '饼图'],
    ['line', '折线图'],
  ];
  const periods = { day: '每日', week: '每周', month: '每月' };
  const operatorLabels = {
    in: '属于所选值',
    notIn: '排除所选值',
    equals: '等于',
    notEquals: '不等于',
    contains: '包含文字',
    notContains: '不包含文字',
    startsWith: '开头是',
    endsWith: '结尾是',
    gte: '大于或等于',
    lte: '小于或等于',
    between: '介于两者之间',
    empty: '为空',
    notEmpty: '不为空',
  };
  const textOperators = ['contains', 'notContains', 'startsWith', 'endsWith'];
  const listOperators = ['in', 'notIn'];
  const importGuide = {
    source: ['选择不良数据源', '点「添加BI文件夹」，或选左侧已经配置的不良数据源。'],
    folder: ['选择文件夹', '选择存放 Excel 或 CSV 的文件夹，也可粘贴文件夹路径。'],
    inspect: ['识别表头', '点「识别最新文件表头」。若要选其他文件，先扫描，再点文件行的「查看表头」。'],
    columns: ['勾选导入列', '在高亮区域勾选要导入的列，取消不需要的列，然后核对字段。'],
    mapping: ['确认字段映射', '核对日期、数量和不良项对应的列，勾选核对项，再点「确认映射并保存来源」。'],
    scan: ['扫描文件', '点「扫描文件」，找到文件后进入下一步。'],
    import: ['导入文件', '点导入按钮。文件有问题时，在结果行处理并重试。'],
    analysis: ['查看导入结果', '进入「分析与筛选」，确认来源和日期，查看查询结果。'],
    filter: ['筛选不良', '点「添加筛选」，选择字段和值，再点「应用筛选」。'],
    export: ['选择导出方式', '点「加入当前图表到报告」，或用可用的「按原表导出 Excel」。'],
    report: ['打开横向A4报告', '点顶部的「横向A4报告」，查看加入的图表。'],
    preview: ['预览报告', '点「预览横向A4」，核对图表、筛选条件和页数。'],
    saveReport: ['保存报告', '选择 Excel、PDF 或图片，并在保存窗口选择文件位置。'],
    complete: ['已完成', '导出文件已保存。'],
    filterRange: ['第 1 步 / 4 · 确定日期', '选择日期后点「查询」。要查整份文件，可以点「用全部日期查询」。'],
    filterOpen: ['第 2 步 / 4 · 打开筛选', '点箭头指向的按钮，在弹窗里搜索要找的不良。'],
    filterReview: ['第 4 步 / 4 · 核对并导出', '核对命中的条数，然后保存 Excel。'],
    templateSource: ['第 1 步 / 5 · 确认分析来源', '选择已导入的异常品数据，再点「继续核对日期」。'],
    templateRange: ['第 2 步 / 5 · 查询日期', '设定时间范围后点「查询」。练习时可点「用全部日期查询」。'],
    templateFilter: ['第 3 步 / 5 · 筛选不良', '跟着光标打开列筛选，搜索并勾选要导出的项目。'],
    templatePick: ['第 4 步 / 5 · 选择并校验模板', '选择「异常品查询 (11) 1_055311.xlsx」。模板应包含 container、总表和五张分类表。'],
    templateSave: ['第 5 步 / 5 · 保存目标报表', '模板已通过校验。点击「保存目标 Excel」，另存到新的文件名。'],
    templateDone: ['教程完成', '已生成目标报表。'],
  };
  let guideStep = null;
  let templateGuide = null;
  let guideTargets = [];
  let revealGuideTarget = false;
  function setGuideStep(step) {
    if (!step) templateGuide = null;
    if (guideStep === step) return;
    guideStep = step;
    revealGuideTarget = Boolean(step);
  }
  function advanceGuide(from, to) {
    if (guideStep === from) setGuideStep(to);
  }
  function guideSourceStep() {
    if (draft?.kind !== 'defects') return 'source';
    return draft.folder.trim() ? 'inspect' : 'folder';
  }
  function markGuide(node, step) {
    if (guideStep === step) {
      node.setAttribute('data-import-guide-target', step);
      if (templateGuide) node.setAttribute('data-template-guide-cursor', '');
      else if (step.startsWith('filter') && step !== 'filter')
        node.setAttribute('data-analysis-guide-pointer', '');
      guideTargets.push(node);
    }
    return node;
  }
  function filterGuideColumn() {
    const current = source();
    if (current?.sheet?.trim().toLowerCase() !== 'container') return null;
    return current.columns.find((column) => column.label === '判定原因') || null;
  }
  function startFilterGuide() {
    if (!ready || busy || !unlocked() || !source()) return;
    templateGuide = null;
    setGuideStep('filterRange');
    render();
  }
  function startTemplateGuide() {
    if (!ready || busy || !unlocked()) return;
    templateGuide = { selected: null, exported: null };
    if (!source()) {
      setGuideStep(guideSourceStep());
      if (config.tab !== 'sources') return switchTab('sources');
    } else {
      setGuideStep('templateSource');
      if (!M.periods.includes(config.tab)) return switchTab(lastAnalysisPeriod);
    }
    render();
  }
  async function rememberReportTemplate(sourceId, picked) {
    if (!picked.templatePath) throw Error('模板路径未返回，请重新选择。');
    config.dailyReports[sourceId] = {
      ...M.dailyReport(config, sourceId),
      templatePath: picked.templatePath,
      ...(picked.layoutOnly === true ? { chartLayout: 'reason-columns' } : {}),
    };
    save();
    await flush();
  }
  function chooseGuideTemplate() {
    return run(async (token) => {
      const selected = await call('chooseOriginalTemplate');
      if (token !== epoch || guideStep !== 'templatePick') return;
      if (selected.cancelled) {
        notice('已取消选择，仍可重新选择目标模板。');
        return;
      }
      if (selected.layoutOnly === true) {
        await rememberReportTemplate(result.sourceId, selected);
        if (token !== epoch || guideStep !== 'templatePick') return;
      }
      templateGuide.selected = selected;
      setGuideStep('templateSave');
      render();
      notice(selected.layoutOnly === true ? '已保存参考报表，启用按判定原因分表。' : '目标模板已校验。');
    }, '正在校验模板…');
  }
  function locateGuide() {
    guideTargets[0]?.scrollIntoView?.({ block: 'center', behavior: 'instant' });
  }
  function renderImportGuide() {
    const [title, instruction] = importGuide[guideStep];
    const panel = el('aside', undefined, 'lab-live-guide');
    const filtering = ['filterRange', 'filterOpen', 'filterReview'].includes(guideStep);
    panel.setAttribute('aria-label', templateGuide ? '异常品模板导出教程' : filtering ? '筛选导出引导' : '导入实操引导');
    const text = el('div');
    const status = el('p', guideStep === 'filterReview'
      ? '命中 ' + fmt(result?.recordCount || 0) + ' 条。点击箭头所指的按钮，保存当前筛选。'
      : instruction);
    status.setAttribute('role', 'status');
    text.append(el('strong', title), status);
    const tools = el('div', undefined, 'lab-live-guide-actions');
    if (guideStep === 'templateSource') {
      tools.append(btn('继续核对日期', () => {
        setGuideStep('templateRange');
        render();
      }, true));
    }
    if (guideStep === 'templatePick') {
      text.append(el('p', '当前命中 ' + fmt(result?.recordCount || 0) + ' 条。'));
      if (result?.recordCount > 0 && result.canExportOriginalReport)
        tools.append(markGuide(btn('选择目标模板', chooseGuideTemplate, true), 'templatePick'));
      else if (result?.recordCount > 0) {
        text.append(el('p', '此来源缺少模板字段。请补导原表的 25 列，或配置导出列映射。'));
        tools.append(markGuide(btn('配置模板列映射', templateMapDialog), 'templatePick'));
      } else
        tools.append(btn('返回查询', () => {
          setGuideStep('templateRange');
          render();
        }));
      tools.append(btn('返回修改筛选', () => {
        setGuideStep('templateFilter');
        render();
      }));
    }
    if (guideStep === 'templateSave' && templateGuide.selected) {
      const selected = templateGuide.selected;
      const output = selected.layoutOnly === true ? '按当前筛选生成分类页与图表' : '输出 ' + selected.sheets.length + ' 张表';
      text.append(el('p', selected.fileName + ' · ' + output));
      tools.append(markGuide(btn('保存目标 Excel', () => exportOriginal(templateGuide.selected.templateToken), true), 'templateSave'),
        btn('重新选模板', () => {
          setGuideStep('templatePick');
          render();
        }));
    }
    if (guideStep === 'templateDone') {
      const output = templateGuide.exported;
      const counts = Object.entries(output.groups).filter(([, count]) => count)
        .map(([name, count]) => name + ' ' + fmt(count) + ' 条');
      text.append(el('p', output.fileName + ' · 总表 ' + fmt(output.recordCount) + ' 条' +
        (counts.length ? ' · ' + counts.join(' · ') : '')),
        el('p', '打开保存的文件，核对：' + output.sheets.join('、') + '。'));
    }
    if (guideStep === 'templateRange' && result?.empty) {
      text.append(el('p', '这个来源还没有可查询的记录，请先导入异常品数据。'));
      tools.append(btn('去导入异常品数据', () => {
        setGuideStep(guideSourceStep());
        return switchTab('sources');
      }));
    }
    if (guideStep === 'filterRange' || guideStep === 'templateRange') {
      tools.append(btn('用全部日期查询', () => run(async () => {
        updateView({ range: 'all' });
        await analyze();
      }), true));
      if (view().filters.length) {
        tools.append(btn('清除现有筛选并查询全部日期', () => run(async () => {
          updateView({ range: 'all', filters: [] });
          await analyze();
        })));
      }
    }
    if (guideStep === 'filterReview') {
      tools.append(btn('返回修改筛选', () => {
        setGuideStep('filterOpen');
        render();
      }));
    }
    if (guideStep === 'columns') {
      tools.append(btn('列已勾好，去核对字段', () => {
        setGuideStep('mapping');
        render();
      }, true));
    }
    if (guideStep === 'filter' && result?.recordCount > 0) {
      tools.append(btn('直接去导出', () => {
        setGuideStep('export');
        render();
      }));
    }
    const finished = ['complete', 'templateDone'].includes(guideStep);
    if (!finished) tools.append(btn('定位这一步', locateGuide));
    tools.append(btn(finished ? '关闭引导' : '退出实操引导', () => {
      setGuideStep(null);
      render();
    }));
    panel.append(text, tools);
    return panel;
  }
  function startImportGuide() {
    if (!ready || busy || !unlocked()) return;
    templateGuide = null;
    setGuideStep(guideSourceStep());
    if (config.tab !== 'sources') return switchTab('sources');
    render();
  }
  let config = M.defaults(),
    calendar = C.defaults(),
    draftCalendar = C.ruleDefaults(),
    lastValid = M.defaults(),
    draft = null,
    inspection = null,
    files = [],
    importHistoryState = null,
    result = null,
    snapshot = null,
    plan = null;
  let ready = false,
    active = false,
    busy = false,
    epoch = 0,
    page = 1,
    timer = null,
    panelTimer = null,
    transport = Promise.resolve(),
    message = '',
    error = false,
    saveState = 'saved',
    dailyProductionOwner = null;
  const client = window.createModuleStateClient({
    api,
    onStatus: (value) => {
      saveState = value;
      status();
    },
    onError: (e) => fail(e),
  });
  const panels = window.createAnalysisPanelsUI({
    call,
    getConfig: () => config,
    getSource: source,
    getGrouping: () => result?.grouping,
    getPeriod: period,
    el,
    btn,
    field,
    select,
    check,
    drawChart: chart,
    openFilter,
    notice,
    fail,
    report: (panel, query, data) => {
      if (config.report.charts.length >= 24) throw Error('报告最多24张图，请先移除不需要的图表。');
      const dimension =
        panel.kind === 'trend'
          ? { day: 'date', week: 'week', month: 'month' }[period()]
          : query.dimension;
      config.report.charts.push({
        id: crypto.randomUUID(),
        sourceId: config.activeSource,
        productionId: config.productionSource,
        period: period(),
        title: panel.title,
        type: panel.kind === 'trend' ? 'line' : query.chartType,
        dimension,
        metric: 'quantity',
        defect: '',
        query: M.query({
          ...query,
          dimension,
          range: 'custom',
          start: data.range.start,
          end: data.range.end,
        }),
      });
      save();
      notice('已将本板块的具体范围加入横向A4报告。');
    },
    invalidate: () => {
      snapshot = null;
      plan = null;
    },
    refresh: async (requery) => {
      panels.invalidate();
      if (requery) result = null;
      render();
      if (requery && M.periods.includes(config.tab)) await run(analyze);
    },
  });
  function status() {
    const node = document.getElementById('labMessage');
    if (node) {
      node.textContent = message;
      node.classList.toggle('lab-error', error);
    }
    const retry = document.getElementById('labRetrySave');
    const dailyMessage = document.getElementById('labDailyMessage');
    if (dailyMessage) {
      dailyMessage.textContent = error ? message : busy ? '正在核对…' : {
        saved: '配置已保存', pending: '配置待保存', saving: '正在保存配置', failed: '配置未保存，请关闭面板后重试保存',
      }[saveState];
      dailyMessage.classList.toggle('lab-error', error || saveState === 'failed');
    }
    if (retry) retry.hidden = saveState !== 'failed';
    const feedback = document.getElementById('labFeedback');
    if (feedback) {
      feedback.hidden = !message && !busy && saveState === 'saved';
      feedback.classList.toggle('lab-feedback-problem', error || saveState === 'failed');
    }
    const saveFeedback = document.getElementById('labSaveFeedback');
    if (saveFeedback) saveFeedback.hidden = saveState === 'saved';
    const saved = document.getElementById('labSaved');
    if (saved)
      saved.textContent = {
        saved: '配置已保存',
        pending: '配置待保存',
        saving: '正在保存配置',
        failed: '配置未保存，请重试',
      }[saveState];
  }
  function fail(e) {
    message = e?.message || '操作未完成，请重试。';
    error = true;
    status();
  }
  function notice(text) {
    message = text;
    error = false;
    status();
  }
  function save() {
    try {
      lastValid = M.validate(config);
    } catch (e) {
      config = structuredClone(lastValid);
      render();
      throw e;
    }
    snapshot = null;
    plan = null;
    document.getElementById('labReportPreview')?.remove();
    document.getElementById('labReportExports')?.remove();
    if (!client.change(ADDRESS, config)) throw Error('配置尚未就绪。');
  }
  function rememberDraft() {
    client.change(DRAFT, { source: draft });
    client.change(CALENDAR_DRAFT, {
      sourceId: draft?.id || '',
      rule: draft ? draftCalendar : null,
    });
  }
  async function flush() {
    if (draft) {
      rememberDraft();
    }
    await panels.flush();
    return client.flush();
  }
  async function call(action, body = {}) {
    const payload = { action, ...structuredClone(body) };
    if (action === 'cancel' || action.startsWith('panels')) return api('analysisStudio', payload);
    const task = transport.catch(() => {}).then(() => api('analysisStudio', payload));
    transport = task.catch(() => {});
    return task;
  }
  async function run(fn, label = '正在处理…') {
    if (busy) return;
    busy = true;
    const token = epoch;
    if (label) notice(label);
    setBusy();
    try {
      await fn(token);
    } catch (e) {
      if (token === epoch) fail(e);
    } finally {
      if (token === epoch) {
        busy = false;
        setBusy();
      }
    }
  }
  function setBusy() {
    const body = document.getElementById('labBody');
    if (body) body.inert = busy;
    const b = document.getElementById('labCancel');
    if (b) b.hidden = !busy;
    status();
    root()?.setAttribute('aria-busy', String(busy));
  }
  function source() {
    return config.sources.find((s) => s.id === config.activeSource);
  }
  // The currently selected export-column mapping, scoped to the active source.
  function activeTemplateMap() {
    return (config.templateMaps || []).find(
      (m) => m.id === config.activeTemplateMap && m.sourceId === config.activeSource,
    ) || null;
  }
  function period() {
    return M.periods.includes(config.tab) ? config.tab : 'day';
  }
  function view() {
    return panels.query();
  }
  function updateView(patch) {
    if (['templatePick', 'templateSave'].includes(guideStep)) {
      templateGuide.selected = null;
      setGuideStep('templateRange');
    }
    const next = M.query({ ...view(), ...patch });
    if (!panels.setQuery(next)) {
      config.views[config.activeSource] ??= {};
      config.views[config.activeSource][period()] = next;
      save();
    }
    page = 1;
    panels.invalidate();
    snapshot = null;
    plan = null;
  }
  async function analyze({ publish = true } = {}) {
    if (!source()) {
      result = null;
      render();
      return;
    }
    panels.invalidate();
    result = null;
    render();
    panels.assertValid();
    await flush();
    const token = epoch;
    const data = await call('analyze', {
      sourceId: config.activeSource,
      productionId: config.productionSource,
      period: period(),
      query: view(),
      page,
      ...(activeTemplateMap() ? { templateMap: activeTemplateMap().columns } : {}),
    });
    if (token !== epoch) return;
    if (guideStep === 'templateSave') {
      templateGuide.selected = null;
      setGuideStep('templatePick');
    }
    if (publish && data.range) {
      const shared = {
        sourceId: config.activeSource,
        period: period(),
        query: M.query({ ...(data.query || view()), range: 'custom', ...data.range }),
      };
      if (JSON.stringify(shared) !== JSON.stringify(config.sharedAnalysis)) {
        config.sharedAnalysis = shared;
        save();
        await client.flush();
        if (token !== epoch) return;
      }
    }
    result = data;
    page = data.page || 1;
    if (data.recordCount > 0) {
      advanceGuide('analysis', templateGuide ? 'templateSource' : 'filter');
      advanceGuide('filterRange', 'filterOpen');
      advanceGuide('templateRange', 'templateFilter');
    }
    render();
    const selected = source();
    const dateRule = calendar.sources[selected?.id];
    const dateId = dateRule?.mode === 'check-time' && dateRule.dateBasis !== 'mapped'
      ? dateRule.timeColumn : selected?.mapping.date;
    const dateLabel = selected?.columns.find((c) => c.id === dateId)?.label || '统计日期';
    notice(
      data.empty
        ? data.message
        : `${dateLabel} · ${data.range.start} 至 ${data.range.end} · ${fmt(data.recordCount)}条记录`,
    );
  }
  function chart(target, data) {
    if (!data.data.length) {
      target.append(el('p', '当前条件没有数据。', 'lab-empty'));
      return;
    }
    if (data.data.every((p) => p.value === null)) {
      target.append(
        el(
          'p',
          data.metric === 'rate'
            ? '该范围没有可计算的不良率，请核对产量和统计口径。'
            : '该范围没有已导入的数据。',
          'lab-empty',
        ),
      );
      return;
    }
    const scroll = el('div', undefined, 'lab-chart-scroll');
    try {
      scroll.innerHTML = A.chartSvg(data);
    } catch (e) {
      scroll.textContent = e.message;
    }
    target.append(scroll);
  }
  const openSections = new Set();
  let lastAnalysisPeriod = 'day';
  function disclosure(title, className = 'lab-options') {
    const section = el('details', undefined, className);
    section.open = openSections.has(title);
    section.ontoggle = () => {
      if (!section.isConnected) return;
      if (section.open) openSections.add(title);
      else openSections.delete(title);
    };
    section.append(el('summary', title));
    return section;
  }
  function configurationGroup(title, description, ...controls) {
    const group = el('section', undefined, 'lab-config-group');
    group.append(el('h4', title), el('p', description, 'lab-muted'), ...controls);
    return group;
  }
  function switchTab(id) {
    return run(async () => {
      if (config.tab === id) return;
      if (id !== 'sources') dailyProductionOwner = null;
      onTabChange(config.tab, id);
      config.tab = id;
      if (id === 'report') {
        if (templateGuide) setGuideStep(null);
        else advanceGuide('report', 'preview');
      }
      page = 1;
      save();
      result = snapshot = plan = null;
      notice('');
      render();
      if (M.periods.includes(id)) await analyze();
    }, null);
  }
  function render() {
    if (!root() || !ready) return;
    guideTargets = [];
    if (M.periods.includes(config.tab)) lastAnalysisPeriod = config.tab;
    root().replaceChildren();
    const header = el('div', undefined, 'lab-workbench-bar');
    const actions = el('div', undefined, 'lab-toolbar');
    actions.id = 'labSaveFeedback';
    const retry = btn('重试保存', () => run(flush));
    retry.id = 'labRetrySave';
    actions.append(retry, el('span', undefined, 'lab-muted'));
    actions.lastChild.id = 'labSaved';
    const tabs = el('nav', undefined, 'lab-tabs lab-workbench-tabs');
    tabs.setAttribute('aria-label', 'BI 工作流程');
    for (const [id, label] of [
      ['sources', '数据源与导入'],
      [lastAnalysisPeriod, '分析与筛选'],
      ['report', '横向A4报告'],
    ]) {
      const b = btn(label, () => switchTab(id));
      b.setAttribute('aria-current', String(config.tab === id));
      if (id === 'report') markGuide(b, 'report');
      if (M.periods.includes(id) && !M.periods.includes(config.tab)) markGuide(b, 'analysis');
      tabs.append(b);
    }
    header.append(tabs);
    if (renderTools) header.append(renderTools());
    const guides = disclosure('操作引导', 'lab-workbench-guides');
    guides.append(btn('筛选导出引导', startFilterGuide), btn('模板导出教程', startTemplateGuide));
    header.append(guides);
    const feedback = el('div', undefined, 'lab-feedback');
    feedback.id = 'labFeedback';
    feedback.setAttribute('role', 'status');
    feedback.setAttribute('aria-atomic', 'true');
    const msg = el('span');
    msg.id = 'labMessage';
    const cancel = btn('取消任务', async () => {
      epoch++;
      busy = false;
      await call('cancel');
      render();
      notice('任务已取消；已完成导入的文件保留。');
    });
    cancel.id = 'labCancel';
    feedback.append(msg, cancel, actions);
    const body = el('div');
    body.id = 'labBody';
    root().append(header);
    if (guideStep) root().append(renderImportGuide());
    root().append(feedback, body);
    if (config.tab === 'sources') renderSources(body);
    else if (config.tab === 'report') renderReport(body);
    else renderAnalysis(body);
    if (config.tab === 'sources')
      body.append(
        el(
          'p',
          '本机分析库和导出文件为明文。可在「备份与恢复」中单独备份分析资料。',
          'lab-footnote',
        ),
      );
    setBusy();
    if (revealGuideTarget && guideTargets.length) {
      revealGuideTarget = false;
      locateGuide();
    }
  }
  function renderSources(body) {
    const sourceArea = el('div');
    body.append(sourceArea);
    window.renderAnalysisSources(sourceArea, {
      config,
      draft,
      inspection,
      files,
      importHistory: importHistoryState?.sourceId === draft?.id ? importHistoryState : null,
      loadImportHistory: (offset = 0) => run((token) => loadImportHistory(draft.id, offset, token)),
      changeImportBatch: (batch) => confirmImportBatchChange(draft.id, batch),
      onImportGuide: startImportGuide,
      markGuide,
      calendarRule: draftCalendar,
      updateCalendar: (key, value) => {
        draftCalendar = { ...draftCalendar, [key]: value };
        draft = { ...draft, confirmed: false };
        rememberDraft();
        if (key === 'mode') render();
      },
      useJudgmentDate: (column) => {
        const columns = draft.columns.some((c) => c.id === column.id)
          ? draft.columns : [...draft.columns, { id: column.id, label: column.label, type: column.type }];
        const mapping = Object.fromEntries(Object.entries(draft.mapping).filter(([, id]) => id !== column.id));
        draft = { ...draft, columns, mapping: { ...mapping, date: column.id },
          cutoff: 0, dateFromFilename: false, confirmed: false };
        draftCalendar = C.judgmentRule(draftCalendar, column.id);
        rememberDraft();
        render();
        notice('已选判定时间。请核对并保存来源，再重新导入原文件。');
      },
      recommend: () => {
        if (!inspection) return fail(Error('请先识别当前文件表头。'));
        const selected = new Set(draft.columns.map((column) => column.id));
        const available = {
          ...inspection,
          columns: inspection.columns.filter((column) => selected.has(column.id)),
          mapping: Object.fromEntries(Object.entries(inspection.mapping).filter(([, id]) => selected.has(id))),
        };
        const proposed = C.suggested(draft, available);
        const mapping = M.reconcileMapping({ ...draft, mapping: proposed.mapping },
          { ...available, mapping: draft.mapping });
        draft = { ...draft, mapping, confirmed: false };
        draftCalendar = proposed.rule;
        rememberDraft();
        render();
        notice(inspection.dateFallback && mapping.date === inspection.mapping.date && proposed.rule.mode === 'check-time'
          ? '已将统计日期设为 Work Date，班次按 Check Date 划分。请核对后保存。'
          : '已应用所选列的推荐设置。请核对后保存并重新导入。');
      },
      updateColumns: (ids, focusId) => {
        const kept = new Set(ids);
        const columns = inspection.columns.filter((column) => kept.has(column.id))
          .map(({ id, label, type }) => ({ id, label, type }));
        const mapping = Object.fromEntries(Object.entries(draft.mapping).filter(([, id]) => kept.has(id)));
        draft = { ...draft, columns, mapping, confirmed: false };
        rememberDraft();
        render();
        document.getElementById(focusId)?.focus({ preventScroll: true });
      },
      update: (key, value) => {
        draft = { ...draft, [key]: value, confirmed: false };
        rememberDraft();
        if (['folder', 'sheet', 'headerRow'].includes(key)) {
          if (key === 'folder' && guideStep) setGuideStep(guideSourceStep());
          inspection = null;
          draft.columns = [];
          draft.mapping = {};
          draft.schema = '';
          rememberDraft();
          render();
        }
      },
      newSource: (kind) =>
        run(async () => {
          await flush();
          dailyProductionOwner = null;
          draft = M.freshSource(kind, 's-' + crypto.randomUUID());
          draftCalendar = C.ruleDefaults();
          if (guideStep) setGuideStep(guideSourceStep());
          inspection = null;
          files = [];
          rememberDraft();
          render();
        }),
      select: (id) =>
        run(async () => {
          await flush();
          dailyProductionOwner = null;
          draft = structuredClone(config.sources.find((s) => s.id === id));
          draftCalendar = structuredClone(calendar.sources[id] || C.ruleDefaults());
          if (guideStep) setGuideStep(guideSourceStep());
          inspection = null;
          files = [];
          rememberDraft();
          render();
        }),
      pick: () =>
        run(async (token) => {
          const response = await call('pick');
          if (token !== epoch || response.cancelled) return;
          draft.folder = response.folder;
          if (guideStep) setGuideStep(guideSourceStep());
          draft.confirmed = false;
          draft.columns = [];
          draft.mapping = {};
          draft.schema = '';
          inspection = null;
          files = [];
          rememberDraft();
          render();
        }),
      scan: () =>
        run(async (token) => {
          await flush();
          const data = await call('scan', { sourceId: draft.id, draft });
          if (token !== epoch) return;
          files = data.files;
          if (files.length) advanceGuide('scan', 'import');
          render();
          notice(`找到${files.length}个文件；先核对表头。`);
        }),
      inspect: (name) =>
        run(async (token) => {
          await flush();
          const data = await call('inspect', { sourceId: draft.id, draft, name });
          if (token !== epoch) return;
          inspection = data;
          const previousColumns = new Set(draft.columns.map((column) => column.id));
          const retained = data.columns.filter((column) => previousColumns.has(column.id));
          const recognized = draft.schema && retained.length ? retained : data.columns;
          if (!config.sources.some((s) => s.id === draft.id))
            draftCalendar = C.suggested(draft, { ...data, columns: recognized }).rule;
          draft = {
            ...draft,
            sheet: data.sheet,
            headerRow: data.headerRow,
            columns: recognized.map(({ id, label, type }) => ({ id, label, type })),
            schema: data.schema,
            mapping: M.reconcileMapping(draft, { ...data, columns: recognized }),
            uniqueColumns: draft.uniqueColumns.filter((id) => recognized.some((column) => column.id === id)),
            confirmed: false,
          };
          rememberDraft();
          if (guideStep && draft.kind === 'defects') setGuideStep('columns');
          render();
          notice('已识别表头；请核对日期、数量、责任员工及报检人，再确认保存。');
        }),
      save: (confirmed) =>
        run(async (token) => {
          if (!confirmed) throw Error('请先勾选已核对表头与数量口径。');
          const s = M.source({ ...draft, confirmed: true });
          const rule = C.rule(draftCalendar);
          if (s.kind === 'defects' && s.columns.some((c) => c.id === s.mapping.date && c.label.trim() === '判定时间') &&
              rule.mode === 'check-time' && rule.dateBasis !== 'mapped' && rule.timeColumn !== s.mapping.date)
            throw Error('请点击「改用判定时间」统一统计日期和班次时间，再保存来源。');
          if (rule.mode === 'check-time' && !s.columns.some((c) => c.id === rule.timeColumn))
            throw Error('请选择当前文件中的Check Date时间列。');
          calendar = C.validate({ ...calendar, sources: { ...calendar.sources, [s.id]: rule } });
          if (!client.change(CALENDAR, calendar)) throw Error('班次规则尚未就绪，未保存来源。');
          config.sources = config.sources.filter((x) => x.id !== s.id).concat(s);
          if (config.sharedAnalysis?.sourceId === s.id) config.sharedAnalysis = null;
          if (config.quickExports[s.id]) {
            try {
              M.exportLayout(config.quickExports[s.id], s);
            } catch {
              delete config.quickExports[s.id];
            }
          }
          if (s.kind === 'defects') {
            const prior = config.dailyReports[s.id];
            if (prior?.reasonColumn && !s.columns.some((column) => column.id === prior.reasonColumn)) {
              config.dailyReports[s.id] = { ...prior, reasonColumn: '', sheetReasons: null, reasonGroups: [] };
            }
            config.activeSource = s.id;
          }
          else {
            if (dailyProductionOwner?.draftId === s.id) {
              const owner = dailyProductionOwner.sourceId;
              config.dailyReports[owner] = {
                ...M.dailyReport(config, owner), productionId: s.id,
              };
            } else config.productionSource = s.id;
          }
          dailyProductionOwner = null;
          draft = s;
          save();
          rememberDraft();
          await flush();
          if (token !== epoch) return;
          if (guideStep === 'mapping' || guideStep === 'columns') {
            setGuideStep(files.length ? 'import' : 'scan');
          }
          render();
          notice('来源配置已保存。请扫描并导入原文件，更新已导入的统计日期。');
        }),
      importFiles: (name) =>
        run(async (token) => {
          await importSource(draft.id, token, name);
        }),
      backup: () =>
        run(async () => {
          await flush();
          const r = await call('backup');
          if (!r.cancelled) notice('分析资料备份已生成。此备份为明文，请妥善保管。');
        }),
      restore: () =>
        run(async (token) => {
          await flush();
          const r = await call('restore');
          if (r.cancelled || token !== epoch) return;
          const row = await client.open(ADDRESS);
          config = M.validate(row.data);
          lastValid = structuredClone(config);
          const calendarRow = await client.open(CALENDAR);
          if (calendarRow.corrupt) throw Error(calendarRow.warning);
          calendar = C.validate(calendarRow.data);
          draftCalendar = C.ruleDefaults();
          draft = null;
          rememberDraft();
          files = [];
          inspection = null;
          render();
          notice('分析资料已恢复，自动读取暂时关闭，请核对来源路径。');
        }),
    });
  }
  async function importSource(id, token = epoch, name) {
    const saved = config.sources.find((s) => s.id === id);
    if (!saved?.confirmed) throw Error('请先核对并保存当前来源。');
    if (draft?.id === id && JSON.stringify(draft) !== JSON.stringify(saved))
      throw Error('来源还有修改，请核对并保存后再导入。');
    await flush();
    const r = await call('import', {
      sourceId: id,
      ...(name ? { names: [name] } : {}),
    });
    if (token !== epoch) return;
    const batch = r.files || r.results || [];
    files = name ? files.map((file) => batch.find((item) => item.name === file.name) || file) : batch;
    importHistoryState = null;
    result = null;
    panels.invalidate();
    snapshot = null;
    plan = null;
    const imported = r.importedRows ?? r.rows ?? r.total ?? 0;
    const failed = batch.filter((file) => file.error).length;
    if (!files.some((file) => file.error) && (imported > 0 || batch.some((file) => file.status === '跳过重复文件')))
      advanceGuide('import', 'analysis');
    render();
    if (failed) {
      fail(Error(`本次导入 ${imported} 行，${failed} 个文件未导入。请查看下方的文件提示和可用操作。`));
    } else {
      const unassigned = batch.reduce((n, f) => n + (f.unassignedRows || 0), 0);
      const blanks = batch.reduce((n, f) => n + (f.blankDefectRows || 0), 0);
      notice(`本次导入 ${imported} 行。${unassigned ? `${unassigned} 行未归班。` : ''}${
        blanks ? `保留 ${blanks} 条不良项为空的记录。` : ''
      }逐文件结果见下方。`);
    }
  }
  async function loadImportHistory(sourceId, offset, token) {
    const saved = config.sources.find((item) => item.id === sourceId);
    if (!saved?.confirmed) throw Error('请先保存并确认当前来源，再查看已导入批次。');
    if (draft?.id === sourceId && JSON.stringify(draft) !== JSON.stringify(saved))
      throw Error('来源还有修改，请先保存或重新选择已保存的来源，再处理导入批次。');
    await flush();
    const data = await call('importHistory', { sourceId, offset });
    if (token !== epoch || draft?.id !== sourceId) return;
    importHistoryState = { ...data, sourceId };
    render();
  }
  function confirmImportBatchChange(sourceId, batch) {
    const state = importHistoryState;
    if (!state || state.sourceId !== sourceId || !batch.canChange) return;
    const enabled = batch.withdrawn;
    const dialog = el('dialog', undefined, 'lab-dialog');
    const verb = enabled ? '恢复' : '撤销';
    dialog.append(el('h3', verb + '导入批次'));
    dialog.append(el('p', `${config.sources.find((item) => item.id === sourceId)?.name || '当前来源'} · ${batch.name}`));
    dialog.append(el('p', `本批次 ${batch.rowCount} 行，导入于 ${new Date(batch.created).toLocaleString('zh-CN')}。`));
    dialog.append(el('p', enabled
      ? '恢复后会按仍有效的修订关系参与分析。'
      : '撤销后本批次退出分析，可从导入历史中恢复。原 Excel 文件保留。'));
    if (batch.legacy && !enabled)
      dialog.append(el('p', '旧批次缺少覆盖历史，不自动还原更早记录。需要的正确数据可从原档重新导入。'));
    const actions = el('div', undefined, 'lab-chart-actions');
    actions.append(btn('取消', () => dialog.close()), btn(verb + '此批次', () => {
      dialog.close();
      return run(async (token) => {
        if (draft?.id !== sourceId || importHistoryState !== state)
          throw Error('来源或批次列表已变化，请重新核对。');
        await flush();
        const changed = await call('setImportBatch', {
          sourceId, batchId: batch.batchId, enabled, revision: state.revision,
        });
        if (token !== epoch) return;
        result = null;
        snapshot = null;
        plan = null;
        panels.invalidate();
        page = 1;
        files = [];
        await loadImportHistory(sourceId, state.offset, token);
        notice(changed.message);
      });
    }, true));
    dialog.append(actions);
    dialog.onclose = () => dialog.remove();
    root().append(dialog);
    dialog.showModal();
  }
  // Map the current source's columns onto the fixed 25-column 异常品 template.
  // Maps are named and saved in config so they can be reused/switched later.
  function templateMapDialog() {
    const src = source();
    if (!src) throw Error('请先选择不良数据源。');
    const headers = M.templateHeaders || [];
    const sourceColumns = src.columns || [];
    const columnOptions = [['', '（留空）'], ...sourceColumns.map((c) => [c.id, c.label])];
    let maps = structuredClone(config.templateMaps || []);
    let current = maps.find((m) => m.id === config.activeTemplateMap && m.sourceId === src.id) || null;

    const dialog = el('dialog', undefined, 'lab-dialog'),
      title = el('h3', '配置导出列映射'),
      intro = el('p',
        '把当前数据源的列一一指到异常品模板的 25 列。对不上的列留空即可；容器号/SN 必须指定，导出时会跳过该列为空的记录。匹配方案会保存，以后可在下拉里切换。',
        'lab-muted'),
      content = el('div');
    dialog.append(title, intro, content);

    const redraw = () => {
      content.replaceChildren();
      const draftColumns = current ? { ...current.columns } : {};
      const bar = el('div', undefined, 'lab-chart-actions');
      const mapSelect = el('select');
      mapSelect.add(new Option('（新建方案）', ''));
      for (const m of maps.filter((m) => m.sourceId === src.id)) mapSelect.add(new Option(m.name, m.id));
      mapSelect.value = current ? current.id : '';
      mapSelect.onchange = () => {
        current = maps.find((m) => m.id === mapSelect.value) || null;
        redraw();
      };
      bar.append(el('label', '匹配方案 ', 'lab-field'), mapSelect);
      const nameInput = el('input');
      nameInput.type = 'text';
      nameInput.placeholder = current ? current.name : '方案名称，如「BI表导出」';
      nameInput.value = current ? current.name : '';
      nameInput.setAttribute('style', 'max-width:220px');
      bar.append(nameInput);
      bar.append(btn('保存', () => {
        const name = nameInput.value.trim();
        if (!name) throw Error('请先填写方案名称。');
        const columns = structuredClone(draftColumns);
        if (!columns['容器号']) throw Error('「容器号/SN」必须指定一列，导出才能生成有效记录。');
        if (!current) {
          current = { id: 'tm_' + Math.random().toString(36).slice(2, 10), name, sourceId: src.id, columns };
          maps.push(current);
        } else {
          current.name = name;
          current.columns = columns;
        }
        config.templateMaps = maps;
        config.activeTemplateMap = current.id;
        save();
        dialog.close();
        analyze();
        notice(`已保存导出列映射「${name}」，可直接按原表导出。`);
      }, true));
      if (current) {
        bar.append(btn('删除此方案', () => {
          maps = maps.filter((m) => m.id !== current.id);
          config.templateMaps = maps;
          config.activeTemplateMap = '';
          save();
          current = null;
          redraw();
          analyze();
        }));
      }
      bar.append(btn('取消', () => dialog.close()));
      content.append(bar);

      const table = el('table', undefined, 't');
      const thead = el('thead');
      const headRow = el('tr');
      ['异常品模板列', '对应当前数据源列'].forEach((x) => headRow.append(el('th', x)));
      thead.append(headRow);
      const tbody = el('tbody');
      for (const header of headers) {
        const row = el('tr');
        row.append(el('td', header));
        const sel = el('select');
        for (const [id, text] of columnOptions) sel.add(new Option(text, id));
        sel.value = draftColumns[header] || '';
        if (header === '容器号') sel.setAttribute('aria-label', '容器号/SN 对应列（必填）');
        sel.onchange = () => {
          draftColumns[header] = sel.value;
          if (!sel.value) delete draftColumns[header];
        };
        const cell = el('td');
        cell.append(sel);
        if (header === '容器号') cell.append(el('span', ' 必填', 'lab-muted'));
        row.append(cell);
        tbody.append(row);
      }
      table.append(thead, tbody);
      const scroll = el('div', undefined, 'scroll');
      scroll.setAttribute('style', 'max-height:60vh');
      scroll.append(table);
      content.append(scroll);
    };
    redraw();
    root().append(dialog);
    dialog.onclose = () => dialog.remove();
    dialog.showModal();
  }
  function quickFields(current) {
    return [
      { id: 'date', label: '业务日期' },
      { id: 'quantity', label: '不良数量' },
      ...current.columns,
    ];
  }
  function quickLayout(current) {
    if (config.quickExports[current.id]) return structuredClone(config.quickExports[current.id]);
    const issue = filterGuideColumn()?.id || current.mapping.defect;
    const preferred = ['date', current.mapping.process, issue, 'quantity', current.mapping.employee,
      current.mapping.shift, current.mapping.serial].filter(Boolean);
    const fields = quickFields(current);
    const used = new Set();
    const columns = [...new Set(preferred)].flatMap((id) => {
      const match = fields.find((c) => c.id === id);
      if (!match || used.has(match.label.toLowerCase())) return [];
      used.add(match.label.toLowerCase());
      return [{ field: id, title: match.label }];
    });
    return { columns, groupBy: fields.some((c) => c.id === issue) ? issue : 'date' };
  }
  function exportQuick(layout) {
    return run(async (token) => {
      const current = result;
      if (!current?.recordCount) throw Error('请先查询有结果的筛选范围。');
      await flush();
      const response = await call('exportQuickReport', {
        sourceId: current.sourceId,
        query: { ...current.query, range: 'custom', ...current.range },
        revision: current.revision,
        layout,
      });
      if (token !== epoch) return;
      if (response.cancelled) return notice('已取消导出。');
      if (guideStep === 'filterReview') {
        setGuideStep('complete');
        render();
      }
      notice('已导出 ' + fmt(response.recordCount) + ' 条，文件为 ' + response.fileName + '。');
    }, '正在生成 Excel 目标表…');
  }
  function editQuickLayout() {
    const current = source(), layout = quickLayout(current);
    const fields = quickFields(current);
    const dialog = el('dialog', undefined, 'lab-dialog lab-export-layout');
    const columns = el('div', undefined, 'lab-export-columns');
    const feedback = el('p', undefined, 'lab-muted');
    feedback.setAttribute('role', 'status');
    const renderColumns = () => {
      columns.replaceChildren();
      const ids = new Set(layout.columns.map((c) => c.field));
      for (const id of [...ids, ...fields.filter((c) => !ids.has(c.id)).map((c) => c.id)]) {
        const info = fields.find((c) => c.id === id);
        const index = layout.columns.findIndex((c) => c.field === id);
        const active = layout.columns[index];
        const row = el('div', undefined, 'lab-export-column');
        row.append(check(info.label, Boolean(active), (checked) => {
          if (checked) layout.columns.push({ field: id, title: info.label });
          else layout.columns.splice(index, 1);
          renderColumns();
        }));
        if (active) {
          const title = el('input');
          title.value = active.title;
          title.maxLength = 120;
          title.setAttribute('aria-label', '导出表头 ' + info.label);
          title.oninput = () => { active.title = title.value; };
          row.append(title);
          for (const [label, offset] of [['上移', -1], ['下移', 1]]) {
            const dest = index + offset;
            const move = btn(label, () => {
              [layout.columns[dest], layout.columns[index]] = [layout.columns[index], layout.columns[dest]];
              renderColumns();
            });
            move.disabled = dest < 0 || dest >= layout.columns.length;
            move.setAttribute('aria-label', label + ' ' + info.label);
            row.append(move);
          }
        }
        columns.append(row);
      }
    };
    const saveLayout = (exportNow) => {
      try {
        const valid = M.exportLayout(layout, current);
        config.quickExports[current.id] = valid;
        save();
        dialog.close();
        if (exportNow) return exportQuick(valid);
        notice('已为此来源保存导出表头。');
      } catch (e) {
        feedback.textContent = e.message;
      }
    };
    const actions = el('div', undefined, 'lab-toolbar');
    actions.append(btn('取消', () => dialog.close()), btn('保存表头', () => saveLayout(false)),
      btn('保存并导出', () => saveLayout(true), true));
    dialog.append(el('h3', '导出表头'), select('汇总分组', fields.map((c) => [c.id, c.label]), layout.groupBy,
      (id) => { layout.groupBy = id; }), columns, feedback, actions);
    dialog.onclose = () => dialog.remove();
    renderColumns();
    root().append(dialog);
    dialog.showModal();
  }
  function renderAnalysis(body) {
    if (!source()) {
      body.append(
        el('h3', '先导入 BI 数据'),
        el('p', '添加下载文件夹并确认字段后，就能按日、周、月查看结果。', 'lab-empty'),
        btn('添加数据源', () => switchTab('sources'), true),
      );
      return;
    }
    const top = el('div', undefined, 'lab-analysis-top');
    const periodTabs = el('nav', undefined, 'lab-tabs lab-periods');
    periodTabs.setAttribute('aria-label', '汇总周期');
    for (const [id, label] of Object.entries(periods)) {
      const b = btn(label, () => switchTab(id));
      b.setAttribute('aria-current', String(period() === id));
      periodTabs.append(b);
    }
    const sourceBar = el('div', undefined, 'lab-source-context');
    sourceBar.append(markGuide(select(
      '分析来源',
      config.sources.filter((s) => s.kind === 'defects').map((s) => [s.id, s.name]),
      config.activeSource,
      (id) => run(async () => {
        config.activeSource = id;
        if (templateGuide && guideStep.startsWith('template')) {
          templateGuide.selected = null;
          setGuideStep('templateSource');
        }
        save();
        await analyze();
      }),
    ), 'templateSource'));
    top.append(periodTabs, sourceBar);
    body.append(top);
    const advanced = disclosure('详细配置', 'lab-advanced');
    const toolbar = el('div', undefined, 'lab-filterbar');
    toolbar.append(
      select(
        '产量数据源',
        [
          ['', '不计算不良率'],
          ...config.sources.filter((s) => s.kind === 'production').map((s) => [s.id, s.name]),
        ],
        config.productionSource,
        (id) =>
          run(async () => {
            config.productionSource = id;
            save();
            await analyze();
          }),
      ),
    );
    const sourceTools = el('div', undefined, 'lab-config-actions');
    sourceTools.append(
      btn(
        '读取下载目录',
        () =>
          run(async (token) => {
            for (const id of [config.activeSource, config.productionSource].filter(Boolean)) {
              const r = await call('import', { sourceId: id });
              if (token !== epoch) return;
              if (r.files?.some((f) => f.error))
                return showImportErrors(id, r.files, '部分文件未导入，请核对下方逐文件结果。');
            }
            snapshot = null;
            await analyze();
          }),
        true,
      ),
    );
    const q = view(),
      filters = el('section', undefined, 'lab-analysis-filters'),
      range = el('div', undefined, 'lab-filterbar');
    const changeRange = (patch) => {
      updateView(patch);
      result = null;
      notice('日期条件已修改，点击查询更新结果。');
      render();
    };
    filters.setAttribute('aria-label', '日期与筛选');
    range.append(
      select(
        '时间范围',
        [
          ['latest', '最新一天'],
          ['recent7', '近7天'],
          ['recent14', '近14天'],
          ['recent30', '近30天'],
          ['recent8w', '近8周'],
          ['recent6m', '近6月'],
          ['week', '最新数据所在周'],
          ['month', '最新数据所在月'],
          ['all', '全部'],
          ['custom', '自定义'],
        ],
        q.range,
        (value) => changeRange({ range: value }),
      ),
      ...(q.range === 'custom'
        ? [
            field('开始日期', q.start, (value) => changeRange({ start: value }), 'date'),
            field('结束日期', q.end, (value) => changeRange({ end: value }), 'date'),
          ]
        : []),
      markGuide(btn('查询', () => run(analyze), true),
        ['filterRange', 'templateRange'].includes(guideStep) ? guideStep : 'analysis'),
    );
    filters.append(range);
    const quick = el('div', undefined, 'lab-quick-filters');
    quick.setAttribute('aria-label', '常用列筛选');
    const reset = btn('重置本面板', () =>
      run(async () => {
        updateView(M.viewDefaults(period()));
        await analyze();
      }),
    );
    const reason = filterGuideColumn();
    for (const field of ['process', reason?.id || 'defect']) {
      if (field !== reason?.id && !source().mapping[field]) continue;
      const label = field === reason?.id ? reason.label : window.BIFieldLabels.field(result, field, M.labels[field]);
      const filters = q.filters.filter((f) => f.field === field);
      const count =
        filters.length === 1 && filters[0].op === 'in' ? filters[0].values.length : null;
      quick.append(
        btn(`${label} · ${count ? `已选 ${count} 项` : filters.length ? '有条件' : '全部'} ▾`, () =>
          run(() => openFilter({ field })),
        ),
      );
    }
    if (['filterOpen', 'templateFilter'].includes(guideStep)) {
      const column = filterGuideColumn();
      quick.append(markGuide(btn(column ? '筛选判定原因' : '筛选不良项', () =>
        run(() => openFilter({ field: column?.id || 'defect', guided: true })), true), guideStep));
    }
    quick.append(
      markGuide(btn('添加筛选', () => run(openFilter)), 'filter'),
    );
    sourceTools.append(reset);
    if (source().sheet?.trim().toLowerCase() === 'container') {
      sourceTools.append(check('忽略未判定且原因空白', q.ignorePendingDecisions !== false,
        (enabled) => run(async () => {
          updateView({ ignorePendingDecisions: enabled });
          await analyze();
        })));
    }
    filters.append(quick);
    const chips = el('div', undefined, 'lab-filter-chips');
    q.filters.forEach((f, index) => {
      const label = window.BIFieldLabels.field(
        result,
        f.field,
        M.labels[f.field] || source().columns.find((c) => c.id === f.field)?.label || f.field,
      );
      const chip = el('span', undefined, 'lab-filter-chip');
      const values = f.values.map((value) => value || '空白');
      const edit = btn([label, operatorLabels[f.op], values.slice(0, 4).join('、') +
        (values.length > 4 ? ' 等 ' + values.length + ' 项' : '')].filter(Boolean).join(' · '),
        () => run(() => openFilter({ field: f.field, editIndex: index })));
      const remove = btn('×', () => run(async () => {
        updateView({ filters: view().filters.filter((_, i) => i !== index) });
        await analyze();
      }));
      remove.setAttribute('aria-label', '移除筛选 ' + label + ' ' + operatorLabels[f.op]);
      chip.append(edit, remove);
      chips.append(chip);
    });
    if (q.filters.length) filters.append(chips);
    body.append(filters);
    const scheme = el('div');
    panels.toolbar(scheme);
    advanced.append(
      configurationGroup('数据与统计口径', '选择产量来源、重新读取文件或重置本周期的筛选和图表设置。', toolbar, sourceTools),
      configurationGroup('分析方案与板块', '切换、分享方案，或添加独立的分析板块。', scheme),
    );
    advanced.children[0].append(el('small', '数据口径、分析方案、图表设置', 'lab-muted'));
    const reportActions = el('div', undefined, 'lab-result-actions');
    const exports = disclosure('报表与导出', 'lab-export-actions');
    const exportButtons = el('div', undefined, 'lab-config-actions');
    exports.append(exportButtons);
    if (result?.recordCount > 0) {
      const summary = el('strong', fmt(result.recordCount) + ' 条命中', 'lab-result-total');
      if (result.ignoredPending) summary.append(el('small', '已忽略未判定 ' + fmt(result.ignoredPending) + ' 条'));
      reportActions.append(summary, btn('每日导表配置', dailyReportDialog), markGuide(btn('快捷导出 Excel', () => exportQuick(quickLayout(source())), true),
        guideStep === 'filterReview' && !result.canExportOriginalReport ? 'filterReview' : 'quickExport'), exports);
      exportButtons.append(btn('编辑导出表头', editQuickLayout));
      body.append(reportActions);
    }
    body.append(advanced);
    const settings = el('div', undefined, 'lab-filterbar');
    settings.append(
      select(
        '分析维度',
        [
          ...M.dimensions.map((k) => [k, window.BIFieldLabels.field(result, k, M.labels[k])]),
          ...source().columns.map((c) => [c.id, c.label]),
        ],
        q.dimension,
        (value) =>
          run(async () => {
            updateView({ dimension: value });
            await analyze();
          }),
      ),
      select(
        '图表',
        types.filter(([id]) => q.metric !== 'rate' || id !== 'pie'),
        q.chartType,
        (value) => {
          updateView({ chartType: value });
          render();
        },
      ),
      select(
        '指标',
        [
          ['quantity', result?.metricLabel || '不良数量'],
          ['rate', '不良率'],
        ],
        q.metric,
        (value) => {
          updateView({
            metric: value,
            chartType: value === 'rate' && view().chartType === 'pie' ? 'bar' : view().chartType,
          });
          render();
        },
      ),
      select(
        '分类显示',
        [
          ['5', 'Top 5＋其他'],
          ['10', 'Top 10＋其他'],
          ['20', 'Top 20＋其他'],
          ['50', 'Top 50＋其他'],
          ['0', '全部分类'],
        ],
        String(q.topN),
        (value) =>
          run(async () => {
            updateView({ topN: Number(value) });
            await analyze();
          }),
      ),
    );
    advanced.append(configurationGroup('图表设置', '用于当前分析页。报告中的每张图表可以单独调整。', settings));
    if (!result) {
      body.append(el('p', '选择条件后点击查询。', 'lab-empty'));
      return;
    }
    if (result.empty) {
      body.append(el('p', result.message, 'lab-empty'));
      panels.mount(body, result);
      return;
    }
    const cards = el('div', undefined, 'lab-metrics');
    for (const [name, value, help] of [
      ['记录条数', fmt(result.recordCount), '同一条记录可包含多个不良数量'],
      [
        result.metricLabel,
        fmt(result.quantity),
        result.comparison.change === null
          ? '当前或前等长区间覆盖不足'
          : `比前等长区间 ${result.comparison.change >= 0 ? '+' : ''}${fmt(result.comparison.change)}`,
      ],
      ['匹配产量', fmt(result.production), '日期＋工序＋班次'],
      ['不良率', pct(result.rate.value), result.rate.reason || '不良件数合计 ÷ 对应产量合计'],
    ]) {
      const c = el('section', undefined, 'lab-metric');
      c.append(el('span', name), el('strong', value), el('small', help));
      cards.append(c);
    }
    if (panels.showSummary()) body.append(cards);
    renderBreakdown(body, result);
    if (result.warnings.length) {
      const warning = disclosure('统计口径与数据覆盖', 'lab-warning');
      warning.children[0].textContent = `统计口径与数据覆盖（${result.warnings.length} 条）`;
      result.warnings.forEach((x) => warning.append(el('p', x)));
      body.append(warning);
    }
    const chartActions = el('div', undefined, 'lab-chart-actions');
    chartActions.append(
      markGuide(btn('加入当前图表到报告', () => addChart()), 'export'),
      btn('按不良项拆分加入报告', () => chooseDefects()),
    );
    if (!result.recordCount) {
      reportActions.append(exports);
      body.append(reportActions);
    }
    if (guideStep === 'export' || guideStep === 'filterReview') exports.open = true;
    if (result.recordCount > 0 && result.canExportOriginalReport) {
      exportButtons.append(markGuide(btn('按原表导出 Excel', () => exportOriginal()),
        guideStep === 'filterReview' ? 'filterReview' : 'export'));
    }
    exportButtons.append(chartActions);
    const currentMap = activeTemplateMap();
    exportButtons.append(btn(currentMap ? `更改导出列映射（${currentMap.name}）` : '配置导出列映射',
      () => templateMapDialog()));

    panels.mount(body, result);
    const summary = el('details', undefined, 'lab-panel'),
      summaryScroll = el('div', undefined, 'lab-table-scroll'),
      summaryTable = el('table'),
      summaryHead = el('thead'),
      summaryHeader = el('tr');
    summary.append(el('summary', `查看${periods[period()]}汇总数据：数量、产量、不良率与覆盖天数`));
    ['周期', result.metricLabel, '匹配产量', '不良率', '已导入天数/区间天数', '说明'].forEach((x) =>
      summaryHeader.append(el('th', x)),
    );
    summaryHead.append(summaryHeader);
    summaryTable.append(summaryHead);
    const summaryRows = el('tbody');
    result.trend.forEach((p) => {
      const tr = el('tr');
      [
        p.label,
        fmt(p.quantity),
        fmt(p.production),
        pct(p.rate),
        p.coverage === undefined ? '—' : `${p.coverage}/${p.days}`,
        p.rateReason || (p.partial ? '部分日期尚未导入' : ''),
      ].forEach((x, index) => {
        const cell = el('td', x);
        if (index === 1 && p.start && p.quantity != null) {
          cell.replaceChildren(btn(x, () => openRows(result, p.label, [], p)));
        }
        tr.append(cell);
      });
      summaryRows.append(tr);
    });
    summaryTable.append(summaryRows);
    summaryScroll.append(summaryTable);
    summary.append(summaryScroll);
    body.append(summary);
    const detail = disclosure('当前筛选明细', 'lab-panel lab-detail'),
      tools = el('div', undefined, 'lab-toolbar');
    tools.append(
      select(
        '每页',
        [
          ['25', '25行'],
          ['50', '50行'],
          ['100', '100行'],
        ],
        String(q.pageSize),
        (v) =>
          run(async () => {
            updateView({ pageSize: Number(v) });
            await analyze();
          }),
      ),
    );
    detail.append(tools);
    const scroll = el('div', undefined, 'lab-table-scroll'),
      table = el('table'),
      thead = el('thead'),
      row = el('tr');
    for (const c of result.columns) {
      const th = el('th');
      th.append(
        btn(
          c.label + (q.sort.field === c.id ? (q.sort.direction === 'asc' ? ' ↑' : ' ↓') : ''),
          () =>
            run(async () => {
              updateView({
                sort: {
                  field: c.id,
                  direction: q.sort.field === c.id && q.sort.direction === 'asc' ? 'desc' : 'asc',
                },
              });
              await analyze();
            }),
        ),
      );
      th.append(btn('筛选', () => run(() => openFilter({ field: c.id }))));
      row.append(th);
    }
    row.append(el('th', '来源文件/行'), el('th', '详情'));
    thead.append(row);
    table.append(thead);
    const tb = el('tbody');
    result.details.forEach((r) => {
      const tr = el('tr');
      result.columns.forEach((c) => tr.append(el('td', r.values[c.id])));
      tr.append(el('td', `${r.file} / ${r.row}`));
      const action = el('td');
      action.append(btn('查看', () => openRows(result, '来源记录', [], result.range, r)));
      tr.append(action);
      tb.append(tr);
    });
    table.append(tb);
    scroll.append(table);
    detail.append(scroll);
    const pager = el('div', undefined, 'lab-toolbar');
    pager.append(
      btn('上一页', () =>
        run(async () => {
          page = Math.max(1, page - 1);
          await analyze();
        }),
      ),
      el('span', `第${page}/${result.pages}页 · ${fmt(result.recordCount)}条`),
      btn('下一页', () =>
        run(async () => {
          page = Math.min(result.pages, page + 1);
          await analyze();
        }),
      ),
    );
    detail.append(pager);
    body.append(detail);
  }
  async function openDailySource(kind, id, owner = '') {
    await flush();
    const saved = config.sources.find((item) => item.id === id && item.kind === kind);
    draft = saved ? structuredClone(saved) : M.freshSource(kind, 's-' + crypto.randomUUID());
    dailyProductionOwner = kind === 'production' && owner ? { sourceId: owner, draftId: draft.id } : null;
    draftCalendar = structuredClone(calendar.sources[draft.id] || C.ruleDefaults());
    inspection = null;
    files = [];
    rememberDraft();
    config.tab = 'sources';
    page = 1;
    save();
    result = snapshot = plan = null;
    notice('核对表头与数值后确认保存；日常导表配置会记住对应来源。');
    render();
  }
  function dailyReportDialog() {
    const src = source();
    if (!src) throw Error('请先选择不良数据源。');
    const applied = result;
    const productionDraft = window.createDailyProductionDraft(M.dailyReport(config, src.id).manualProduction || [], applied?.range);
    const reasonGroupState = { open: false, draft: null };
    const sheetReasonState = { open: false, dirty: false };
    const reportReasonState = { open: false, selected: new Set() };
    const reportReasonRequest = () => reportReasonState.selected.size
      ? { reportReasons: [...reportReasonState.selected] } : {};
    const rateKeywordState = { open: false, draft: null };
    const templateMap = activeTemplateMap();
    const automaticReason = templateMap ? templateMap.columns['判定原因'] :
      src.columns.find((column) => column.label.trim() === '判定原因')?.id;
    const dialog = el('dialog', undefined, 'lab-dialog lab-daily-dialog');
    const heading = el('div', undefined, 'lab-daily-heading');
    const requireSavedProduction = () => {
      if (productionDraft.dirty())
        throw Error('请先保存手填产量，或撤销未保存更改。');
    };
    const requireSavedSettings = () => {
      requireSavedProduction();
      if (reasonGroupState.draft) throw Error('请先保存分组或取消编辑。');
      if (sheetReasonState.dirty) throw Error('请先保存分表选择，或取消编辑。');
      if (rateKeywordState.draft) throw Error('请先保存日报标题与关键词，或取消关键词编辑。');
    };
    heading.append(el('h3', '每日导表配置'), btn('完成配置', () => {
      requireSavedSettings();
      dialog.close();
    }));
    const dateSpan = applied?.range ? ` · ${applied.range.start} 至 ${applied.range.end}` : '';
    const statusLine = el('p', src.name + dateSpan, 'lab-muted');
    const dailyMessage = el('p', '', 'lab-muted');
    dailyMessage.id = 'labDailyMessage';
    dailyMessage.setAttribute('role', 'status');
    const content = el('div');
    dialog.append(heading, statusLine, dailyMessage, content);
    const leave = (action) => {
      requireSavedSettings();
      dialog.close();
      return action();
    };
    function changeSetting(key, value) {
      const next = { ...M.dailyReport(config, src.id), [key]: value };
      const trial = { ...config, dailyReports: { ...config.dailyReports, [src.id]: next } };
      M.validate(trial);
      config.dailyReports = trial.dailyReports;
      save();
    }
    function appliedReportRequest() {
      if (!applied?.recordCount) throw Error('请先应用日期和筛选，再核对日报。');
      return {
        sourceId: src.id, query: { ...applied.query, range: 'custom', ...applied.range }, revision: applied.revision,
        ...(activeTemplateMap() ? { templateMap: activeTemplateMap().columns } : {}),
        ...reportReasonRequest(),
      };
    }
    const renderSettings = () => {
      const settings = M.dailyReport(config, src.id);
      const reasonField = settings.reasonColumn || automaticReason;
      const reasonOptionsUnavailable = reasonField ? '请先应用日期和筛选。' : '请先绑定「判定原因列」。';
      content.replaceChildren();
      window.renderDailyReportSettings(content, {
        el, btn, field, select, check,
        source: src, settings: M.dailyReport(config, src.id), productionDraft,
        reasonGroupState, reasonOptionsUnavailable, sheetReasonState, reportReasonState, automaticReason,
        loadReportReasonOptions: reasonField && applied?.recordCount ? (search, offset) => {
          const { query } = appliedReportRequest();
          const replaced = new Set([reasonField]);
          if (src.mapping.defect === reasonField) replaced.add('defect');
          const scope = { ...query, filters: query.filters.filter(({ field }) => !replaced.has(field)) };
          return call('facets', { sourceId: src.id, query: scope, field: reasonField, search, offset, matchOp: 'contains' });
        } : null,
        saveSheetReasons: (selected) => persistReasonSetting({ sheetReasons: selected }),
        bindReasonColumn: (column) => persistReasonSetting({ reasonColumn: column,
          sheetReasons: null, reasonGroups: [] }),
        rateKeywordState, defaultRateKeywords: M.defaultRateKeywords?.() || [],
        loadReasonOptions: reasonField && applied?.recordCount ? (search, offset) => {
          const { query } = appliedReportRequest();
          // Supplying a match operator keeps the applied filter for this same column.
          return call('facets', { sourceId: src.id, query, field: reasonField, search, offset, matchOp: 'contains' });
        } : null,
        saveReasonGroups: (groups) => run(async (token) => {
          const previous = M.dailyReport(config, src.id).reasonGroups || [];
          changeSetting('reasonGroups', groups);
          try {
            await flush();
          } catch (e) {
            if (token === epoch) changeSetting('reasonGroups', previous);
            throw e;
          }
          if (token !== epoch || !dialog.isConnected) return;
          reasonGroupState.draft = null;
          renderSettings();
          notice('已保存判定原因分组。');
        }, '正在保存判定原因分组…'),
        saveRateKeywords: (changes) => run(async (token) => {
          const previous = config.dailyReports[src.id];
          const applySettings = (settings) => {
            const trial = { ...config, dailyReports: { ...config.dailyReports } };
            if (settings) trial.dailyReports[src.id] = settings;
            else delete trial.dailyReports[src.id];
            config.dailyReports = M.validate(trial).dailyReports;
            save();
          };
          applySettings({ ...M.dailyReport(config, src.id), ...changes });
          try {
            await flush();
          } catch (e) {
            if (token === epoch) applySettings(previous);
            throw e;
          }
          if (token !== epoch || !dialog.isConnected) return;
          rateKeywordState.draft = null;
          renderSettings();
          notice('已保存日报标题与项目关键词。');
        }, '正在保存日报标题与关键词…'),
        productions: config.sources.filter((item) => item.kind === 'production'),
        update: (key, value) => {
          try {
            if (key === 'productionMode') requireSavedProduction();
            if (key === 'chartLayout' && (reasonGroupState.draft || sheetReasonState.dirty))
              throw Error('请先保存分组或分表选择，或取消编辑。');
            if (key === 'chartLayout' && rateKeywordState.draft)
              throw Error('请先保存日报标题与关键词，或取消关键词编辑。');
            changeSetting(key, value);
          } catch (e) {
            fail(e);
          } finally {
            renderSettings();
          }
        },
        loadCohorts: async () => {
          let response;
          await run(async (token) => {
            const request = appliedReportRequest();
            await flush();
            if (token !== epoch || !dialog.isConnected) return;
            const data = await call('dailyProductionCohorts', request);
            if (token === epoch && dialog.isConnected) {
              response = data;
              notice('');
            }
          });
          return response;
        },
        saveManual: (rows) => run(async (token) => {
          const previous = M.dailyReport(config, src.id).manualProduction || [];
          changeSetting('manualProduction', rows);
          try {
            await flush();
          } catch (e) {
            if (token === epoch) changeSetting('manualProduction', previous);
            throw e;
          }
          if (token !== epoch || !dialog.isConnected) return;
          productionDraft.saved(rows);
          renderSettings();
          notice('已保存手填实际产量。');
        }, '正在保存手填产量…'),
        draftChanged: () => document.getElementById('labDailyRatePreview')?.replaceChildren(),
        editSource: () => leave(() => run(() => openDailySource('defects', src.id))),
        editQuick: () => leave(editQuickLayout),
        editTemplate: () => leave(templateMapDialog),
        editProduction: () => leave(() => run(() =>
          openDailySource('production', M.dailyReport(config, src.id).productionId, src.id))),
        chooseTemplate: () => run(async (token) => {
          const picked = await call('chooseOriginalTemplate');
          if (token !== epoch || picked.cancelled || !dialog.isConnected) return;
          await rememberReportTemplate(src.id, picked);
          if (token !== epoch || !dialog.isConnected) return;
          renderSettings();
          notice(picked.layoutOnly === true ? '已保存参考报表，启用按判定原因分表。' : '已记住目标模板。');
        }),
        previewRate: () => run(async (token) => {
          requireSavedSettings();
          const request = appliedReportRequest();
          const signature = () => JSON.stringify([M.dailyReport(config, src.id), reportReasonRequest()]);
          const snapshot = signature();
          await flush();
          const data = await call('previewDailyRate', request);
          if (token !== epoch || !dialog.isConnected) return;
          if (productionDraft.dirty() || rateKeywordState.draft || snapshot !== signature()) {
            notice('配置已改变，请重新核对不良率。');
            return;
          }
          const target = document.getElementById('labDailyRatePreview');
          if (!target) return;
          target.replaceChildren(el('p', data.scope, 'lab-muted'));
          if (M.dailyReport(config, src.id).chartLayout === 'reason-columns' &&
              data.trend.length && data.trend.every((point) => point.rate === null)) {
            target.append(el('p', '当前尚无可计算的不良率。先核对下方不良数和产量说明，补齐产量后再计算。', 'lab-empty'));
          } else {
            chart(target, { title: data.title, type: 'line', metric: 'rate',
              data: data.trend.map((point) => ({ label: point.label, value: point.rate })) });
          }
          const table = el('table'), head = el('thead'), row = el('tr'), body = el('tbody');
          ['日期／周期', '不良数量', '匹配产量', '不良率', '说明'].forEach((label) => row.append(el('th', label)));
          head.append(row);
          data.trend.forEach((point) => {
            const row = el('tr');
            [point.label, fmt(point.quantity), fmt(point.production), pct(point.rate), point.rateReason || '口径一致'].forEach((value) => row.append(el('td', value)));
            body.append(row);
          });
          table.append(head, body);
          const scroll = el('div', undefined, 'lab-table-scroll');
          scroll.append(table);
          target.append(scroll);
          notice('已核对不良率数据；缺失产量的日期保留说明，不填为零。');
        }),
        export: () => leave(() => exportOriginal(undefined, reportReasonRequest())),
      });
    };
    function persistReasonSetting(changes) {
      return run(async (token) => {
        if ('reasonColumn' in changes) requireSavedSettings();
        if (reasonGroupState.draft || rateKeywordState.draft || productionDraft.dirty())
          throw Error('请先完成当前分组、关键词或产量编辑。');
        const previous = config.dailyReports;
        const next = { ...M.dailyReport(config, src.id), ...changes };
        config.dailyReports = M.validate({ ...config,
          dailyReports: { ...previous, [src.id]: next } }).dailyReports;
        save();
        try {
          await flush();
        } catch (error) {
          if (token === epoch) { config.dailyReports = previous; save(); }
          throw error;
        }
        if (token !== epoch || !dialog.isConnected) return;
        sheetReasonState.open = sheetReasonState.dirty = false;
        if ('reasonColumn' in changes) reportReasonState.selected.clear();
        renderSettings();
        notice('已保存当前数据源的判定原因设置。');
      }, '正在保存判定原因设置…');
    }
    renderSettings();
    root().append(dialog);
    dialog.oncancel = (event) => {
      try {
        requireSavedSettings();
      } catch (e) {
        event.preventDefault();
        fail(e);
      }
    };
    dialog.onclose = () => dialog.remove();
    dialog.showModal();
    status();
  }
  function exportOriginal(templateToken, reportScope = {}) {
    return run(async (token) => {
      const current = result;
      if (!current?.recordCount || !current.canExportOriginalReport)
        throw Error('请先查询可按模板导出的筛选结果。');
      await flush();
      if (token !== epoch) return;
      const response = await call('exportOriginalReport', {
        sourceId: current.sourceId,
        query: { ...current.query, range: 'custom', ...current.range },
        revision: current.revision,
        ...(activeTemplateMap() ? { templateMap: activeTemplateMap().columns } : {}),
        ...(templateToken ? { templateToken } : {}),
        ...reportScope,
      });
      if (token !== epoch) return;
      if (response.cancelled) {
        notice('已取消导出。');
        return;
      }
      if (templateToken && guideStep === 'templateSave') {
        templateGuide.exported = response;
        setGuideStep('templateDone');
        render();
      } else if (guideStep === 'export' || guideStep === 'filterReview') {
        setGuideStep('complete');
        render();
      }
      const counts = Object.entries(response.groups || {}).map(([name, count]) => name + ' ' + fmt(count) + ' 条').join(' · ');
      const byReason = response.chartLayout === 'reason-columns';
      const hasReasonSummary = response.chartLayout === 'readable' || response.chartLayout === 'hidden';
      let extra = '';
      if (response.uncategorized) {
        const label = byReason ? ' 条无分类记录' : ' 条模板外记录';
        const location = hasReasonSummary ? '，可在「判定原因汇总」查看。' : '，可在总表查看。';
        extra = ' 另有 ' + fmt(response.uncategorized) + label + location;
      }
      const skipped = response.skippedBlankSn ? ' 跳过 ' + fmt(response.skippedBlankSn) + ' 条容器号/SN为空的记录。' : '';
      if (response.notSelectedForSheet) extra += ` ${fmt(response.notSelectedForSheet)} 条仅保留在总表（未选分表）。`;
      const rateNote = response.rateReport ? ` 已附加不良率趋势：${response.rateReport.validPoints}/${response.rateReport.points} 个点可计算，其余点附原因。` : '';
      const layoutNote = {
        'reason-columns': ' 已按判定原因分表，总表使用姓名竖排柱形图。',
        readable: ` 总表图表已分 ${fmt(response.totalChartPages)} 页。`,
        hidden: ' 已隐藏总表图表，分类页可单独查看。',
      }[response.chartLayout] || '';
      notice('已导出总表 ' + fmt(response.recordCount) + ' 条。' +
        (counts ? ' ' + counts + '。' : '') + extra + skipped + rateNote + layoutNote);
    }, '正在准备原表导出…');
  }
  function renderBreakdown(body, report) {
    const data = report.breakdown;
    if (!data?.groups.length) return;
    const label = window.BIFieldLabels.process(report);
    const panel = el('section', undefined, 'lab-panel lab-breakdown');
    panel.append(
      el('h3', `${label}与不良项对比`),
      el(
        'p',
        data.comparable
          ? `上期 ${report.comparison.start} 至 ${report.comparison.end}`
          : '当前或上期日期覆盖不足，暂不显示同期变化。',
        'lab-muted',
      ),
    );
    const rule = (field, value) => ({ field, op: 'in', values: [value], caseSensitive: true });
    const addTable = (parent, entries, process) => {
      const table = el('table'),
        head = el('thead'),
        titles = el('tr'),
        rows = el('tbody');
      for (const title of ['不良项', report.metricLabel, '记录条数', '上期', '变化', '占本组数量'])
        titles.append(el('th', title));
      head.append(titles);
      for (const issue of entries) {
        const row = el('tr'),
          count = el('td');
        const name = issue.key || '（空白）';
        count.append(
          issue.rows
            ? btn(fmt(issue.quantity), () =>
                openRows(report, `${process || '（空白）'} / ${name}`, [
                  rule('process', process),
                  rule('defect', issue.key),
                ]),
              )
            : el('span', fmt(issue.quantity)),
        );
        row.append(
          el('td', name),
          count,
          el('td', fmt(issue.rows)),
          el('td', fmt(issue.previous)),
          el('td', issue.change > 0 ? '+' + fmt(issue.change) : fmt(issue.change)),
          el('td', pct(issue.share)),
        );
        rows.append(row);
      }
      table.append(head, rows);
      const scroll = el('div', undefined, 'lab-table-scroll');
      scroll.append(table);
      parent.append(scroll);
    };
    for (const group of data.groups) {
      const name = group.key || '（空白）',
        row = el('div', undefined, 'lab-breakdown-row');
      const details = el('details');
      details.append(el('summary', `${name} · ${group.issueCount} 类不良`));
      addTable(details, group.issues, group.key);
      if (group.issueCount > group.issues.length)
        details.append(
          el('p', `展开表显示前 ${data.limit} 项。可缩小筛选范围查看其他项。`, 'lab-muted'),
        );
      row.append(
        details,
        group.rows
          ? btn(`${fmt(group.quantity)} · 查明细`, () =>
              openRows(report, name, [rule('process', group.key)]),
            )
          : el('span', fmt(group.quantity)),
        el(
          'small',
          `上期 ${fmt(group.previous)}　变化 ${group.change > 0 ? '+' : ''}${fmt(group.change)}`,
        ),
      );
      panel.append(row);
    }
    if (data.totalGroups > data.groups.length)
      panel.append(
        el(
          'p',
          `显示 ${data.groups.length} / ${data.totalGroups} 组，可用筛选缩小范围。`,
          'lab-muted',
        ),
      );
    body.append(panel);
  }

  async function openRows(report, title, extra, range = report.range, single = null) {
    const dialog = el('dialog', undefined, 'lab-dialog lab-row-drawer'),
      content = el('div');
    dialog.setAttribute('aria-label', '来源明细');
    dialog.append(
      el('h3', title),
      el('p', `${range.start} 至 ${range.end}`, 'lab-muted'),
      btn('关闭明细', () => dialog.close()),
      content,
    );
    root().append(dialog);
    dialog.onclose = () => dialog.remove();
    dialog.showModal();
    const showRow = (record) => {
      const fields = el('dl');
      fields.append(el('dt', '来源文件 / 行'), el('dd', `${record.file} / ${record.row}`));
      for (const column of report.columns)
        fields.append(el('dt', column.label), el('dd', record.values[column.id] || '—'));
      return fields;
    };
    if (single) return content.append(showRow(single));
    async function load(target) {
      content.replaceChildren(el('p', '正在读取来源行…'));
      try {
        const query = M.query({
          ...report.query,
          range: 'custom',
          start: range.start,
          end: range.end,
          filters: [...report.query.filters, ...extra],
          pageSize: 25,
        });
        const data = await call('analyze', {
          sourceId: report.sourceId,
          period: report.period,
          query,
          page: target,
        });
        if (!dialog.isConnected) return;
        if (data.revision !== report.revision) throw Error('数据已更新。请关闭明细并重新查询。');
        content.replaceChildren(
          el('p', `${fmt(data.recordCount)} 条记录 · ${fmt(data.quantity)} 不良数量`),
        );
        for (const record of data.details) {
          const item = el('details');
          item.append(
            el(
              'summary',
              `${record.date} · ${fmt(record.quantity)} · ${record.file} / ${record.row}`,
            ),
            showRow(record),
          );
          content.append(item);
        }
        if (data.page > 1) content.append(btn('明细上一页', () => load(data.page - 1)));
        if (data.page < data.pages) content.append(btn('明细下一页', () => load(data.page + 1)));
      } catch (error) {
        if (dialog.isConnected) content.replaceChildren(el('p', error.message, 'lab-empty'));
      }
    }
    await load(1);
  }
  async function openFilter(options = {}) {
    if (!options || typeof options !== 'object') options = {};
    const filterQuery = () => (options.query ? options.query() : view());
    if (!source()) throw Error('请先选择数据源。');
    await flush();
    const invoker = document.activeElement;
    const dialog = el('dialog', undefined, 'lab-dialog lab-filter-dialog'),
      title = el('h3', '按字段筛选'),
      content = el('div');
    title.id = 'labFilterTitle';
    dialog.setAttribute('aria-labelledby', title.id);
    dialog.append(title, content);
    root().append(dialog);
    const fixedField = typeof options.field === 'string' ? options.field : '';
    const guided = options.guided === true;
    const templateStep = guideStep === 'templateFilter';
    const pointerAttribute = templateStep ? 'data-template-guide-cursor' : 'data-analysis-guide-pointer';
    const guideHint = guided ? el('p', undefined, 'lab-filter-guide-hint') : null;
    if (guideHint) {
      guideHint.setAttribute('role', 'status');
      content.append(guideHint);
    }
    const editingCondition = Number.isInteger(options.editIndex);
    const existing = editingCondition
      ? [filterQuery().filters[options.editIndex]]
      : filterQuery().filters.filter((f) => f.field === fixedField);
    const saved = !guided && !options.onApply && existing.length === 1 ? existing[0] : null;
    const removeEdited = (filters) => filters.filter((f, index) => editingCondition
      ? index !== options.editIndex
      : !fixedField || f.field !== fixedField);
    let key = fixedField || 'defect',
      op = saved?.op || 'in',
      search = '',
      offset = 0,
      selected = new Set(
        saved && listOperators.includes(saved.op) ? saved.values : [],
      ),
      values = saved && !listOperators.includes(saved.op) ? [...saved.values] : [],
      token = 0,
      facetTask = Promise.resolve(),
      visibleValues = [];
    const searchBox = el('div', undefined, 'lab-filter-guide-search');
    const optionTools = el('div', undefined, 'lab-facet-tools');
    const ruleHelp = el('p', undefined, 'lab-filter-rule-help');
    const list = el('div', undefined, 'lab-facet-list'),
      description = el('p', undefined, 'lab-muted'),
      searchInput = el('input');
    description.setAttribute('role', 'status');
    searchInput.type = 'search';
    searchInput.placeholder = '搜索选项，留空显示全部';
    searchInput.setAttribute('aria-label', '搜索筛选值');
    searchBox.append(searchInput);
    function guideFilterDialog(step, text) {
      if (!guideHint) return;
      guideHint.textContent = (templateStep ? '第 3 步 / 5 · ' : '第 3 步 / 4 · ') + text;
      for (const target of [searchBox, list, applyFilter]) {
        if (target === step) target.setAttribute(pointerAttribute, '');
        else target.removeAttribute(pointerAttribute);
      }
    }
    function pendingOptions() {
      visibleValues = [];
      list.replaceChildren();
      selectPage.disabled = true;
      description.textContent = textOperators.includes(op) ? '正在核对命中记录…' : '正在读取选项…';
    }
    function load() {
      clearTimeout(searchTimer);
      const own = ++token;
      const isText = textOperators.includes(op);
      const keyword = isText ? (values[0] || '').trim() : search;
      if (!listOperators.includes(op) && (!isText || !keyword)) {
        list.replaceChildren();
        description.textContent = isText ? '输入文字后显示命中预览。' : '';
        return Promise.resolve();
      }
      pendingOptions();
      const query = filterQuery();
      const params = {
        sourceId: config.activeSource,
        query: isText ? { ...query, filters: options.onApply ? query.filters : removeEdited(query.filters) } : query,
        field: key,
        search: keyword,
        offset,
        ...(isText ? { matchOp: op, caseSensitive: saved?.caseSensitive === true } : {}),
      };
      facetTask = facetTask
        .catch(() => {})
        .then(async () => {
          if (own !== token || !dialog.isConnected) return;
          try {
            const r = await call('facets', params);
            if (own !== token || !dialog.isConnected) return;
            visibleValues = r.values.map((v) => v.value);
            selectPage.disabled = !visibleValues.length;
            list.replaceChildren();
            description.textContent = isText
              ? `命中 ${fmt(r.rowCount)} 条记录 · ${fmt(r.total)} 个不同值`
              : `${fmt(r.total)} 个可选值 · 已选 ${selected.size} 个`;
            if (!r.total) {
              list.append(
                el(
                  'p',
                  isText
                    ? '当前日期和已有条件下没有命中。可以缩短文字，或核对所选字段。'
                    : search
                    ? '没有匹配此关键词的选项。可点“清除搜索”查看当前范围内的全部选项。'
                    : '当前日期和其他筛选条件下没有可选值。请核对来源、日期或已有筛选。',
                  'lab-empty',
                ),
              );
            }
            const guideSelection = () => {
              if (!search) guideFilterDialog(searchBox, '输入要找的不良，例如「装管反」。');
              else if (!r.total) guideFilterDialog(searchBox, '没有匹配项。试试缩短关键词，或返回核对日期和已有筛选。');
              else if (!visibleValues.some((value) => selected.has(value)))
                guideFilterDialog(list, '勾选所需的值。同一个不良可能有多个带前缀的选项。');
              else guideFilterDialog(applyFilter, '勾齐所需选项，再点「应用筛选」。括号内是各选项的记录条数。');
            };
            r.values.forEach((v) =>
              list.append(
                isText ? el('div', v.label + ' · ' + fmt(v.count) + ' 条', 'lab-facet-match') : check(`${v.label} (${v.count})`, selected.has(v.value), (yes) => {
                  if (yes) selected.add(v.value);
                  else selected.delete(v.value);
                  description.textContent = `${r.total}个可选值 · 已选${selected.size}个`;
                  guideSelection();
                }),
              ),
            );
            guideSelection();
            if (offset)
              list.append(
                btn('上一组', () => {
                  offset = Math.max(0, offset - 200);
                  return load();
                }),
              );
            if (r.more)
              list.append(
                btn('下一组', () => {
                  offset += 200;
                  return load();
                }),
              );
          } catch (e) {
            if (own !== token || !dialog.isConnected) return;
            description.textContent = '选项读取失败：' + e.message;
            list.replaceChildren(btn('重新读取选项', load));
          }
        });
      return facetTask;
    }
    let searchTimer;
    searchInput.oninput = (event) => {
      if (event?.isComposing) return;
      search = searchInput.value.trim();
      offset = 0;
      token++;
      pendingOptions();
      clearTimeout(searchTimer);
      searchTimer = setTimeout(load, 250);
    };
    searchInput.oncompositionend = () => searchInput.oninput();
    searchInput.onkeydown = (event) => {
      if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      search = searchInput.value.trim();
      offset = 0;
      return load();
    };
    const clearSearch = btn('清除搜索', () => {
      searchInput.value = search = '';
      offset = 0;
      return load();
    });
    const selectPage = btn('全选当前页', () => {
      visibleValues.forEach((v) => selected.add(v));
      return load();
    });
    const clearSelection = btn('清空选择', () => {
      selected.clear();
      return load();
    });
    optionTools.append(clearSearch, selectPage, clearSelection);
    const manual = field('规则内容', values[0] || '', (v) => {
        values[0] = v;
      }),
      second = field('区间上限', values[1] || '', (v) => {
        values[1] = v;
      });
    const keywordInput = manual.lastChild;
    keywordInput.maxLength = 512;
    searchInput.maxLength = 512;
    function previewKeyword(debounce) {
      values[0] = keywordInput.value;
      offset = 0;
      clearTimeout(searchTimer);
      if (!textOperators.includes(op)) return;
      if (!debounce) return load();
      token++;
      pendingOptions();
      searchTimer = setTimeout(load, 250);
    }
    keywordInput.oninput = (event) => {
      if (!event?.isComposing) previewKeyword(true);
    };
    keywordInput.oncompositionend = () => previewKeyword(true);
    keywordInput.onkeydown = (event) => {
      if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      return previewKeyword(false);
    };
    function showRule() {
      const listMode = listOperators.includes(op);
      const textMode = textOperators.includes(op);
      searchBox.hidden = optionTools.hidden = !listMode;
      list.hidden = !listMode && !textMode;
      manual.hidden = listMode || ['empty', 'notEmpty'].includes(op);
      second.hidden = op !== 'between';
      keywordInput.placeholder = textMode ? '例如 装管反' : '';
      ruleHelp.textContent = listMode
        ? '搜索用于查找选项，勾选后再应用。'
        : textMode ? '按文字匹配该列，查询时自动包含符合条件的新值。' : '';
      ruleHelp.hidden = !ruleHelp.textContent;
      return load();
    }
    content.append(
      fixedField
        ? el(
            'p',
            `筛选 ${window.BIFieldLabels.field(result, key, M.labels[key] || source().columns.find((c) => c.id === key)?.label || key)}`,
          )
        : select(
            '字段',
            [
              ...M.roles.map((k) => [k, window.BIFieldLabels.field(result, k, M.labels[k])]),
              ...source().columns.map((c) => [c.id, c.label]),
            ],
            key,
            (v) => {
              key = v;
              selected.clear();
              searchInput.value = search = '';
              offset = 0;
              return load();
            },
          ),
      select(
        '规则',
        M.operators.map((k) => [k, operatorLabels[k]]),
        op,
        (v) => {
          op = v;
          offset = 0;
          return showRule();
        },
      ),
      ruleHelp,
      searchBox,
      optionTools,
      manual,
      second,
      description,
      list,
    );
    const foot = el('div', undefined, 'lab-toolbar lab-filter-footer');
    const applyFilter = markGuide(btn(
        '应用筛选',
        async () => {
          const input = ['in', 'notIn'].includes(op)
            ? [...selected]
            : ['empty', 'notEmpty'].includes(op)
              ? []
              : op === 'between'
                ? [values[0], values[1]]
                : [textOperators.includes(op) ? (keywordInput.value || '').trim() : values[0]];
          if (
            !['empty', 'notEmpty'].includes(op) &&
            (!input.length ||
              (input.some((v) => v === undefined || v === '') && !['in', 'notIn'].includes(op)))
          ) {
            description.textContent = '请填写规则内容或选择至少一个值。';
            return;
          }
          try {
            M.query({
              ...filterQuery(),
              filters: [
                ...(options.onApply ? filterQuery().filters : removeEdited(filterQuery().filters)),
                { field: key, op, values: input, caseSensitive: saved?.caseSensitive === true },
              ],
            });
          } catch (e) {
            description.textContent = e.message;
            return;
          }
          const nextFilter = { field: key, op, values: input, caseSensitive: saved?.caseSensitive === true };
          if (options.onApply) await options.onApply(nextFilter);
          else
            updateView({
              filters: [
                ...removeEdited(filterQuery().filters),
                nextFilter,
              ],
            });
          dialog.close();
          if (!options.onApply) {
            await run(analyze);
            if (result?.recordCount > 0) {
              if (templateStep) advanceGuide('templateFilter', 'templatePick');
              else if (guided) advanceGuide('filterOpen', 'filterReview');
              else advanceGuide('filter', 'export');
              render();
            }
          }
        },
        true,
      ), 'filter');
    if (existing.length && !options.onApply)
      foot.append(
        btn(editingCondition ? '移除此条件' : '清除此列筛选', async () => {
          updateView({ filters: removeEdited(view().filters) });
          dialog.close();
          await run(analyze);
        }),
      );
    foot.append(btn('取消', () => dialog.close()), applyFilter);
    dialog.append(foot);
    const previousPointer = guided ? guideTargets[0] : null;
    if (previousPointer) previousPointer.removeAttribute(pointerAttribute);
    dialog.onclose = () => {
      if (previousPointer?.isConnected && ['filterOpen', 'templateFilter'].includes(guideStep))
        previousPointer.setAttribute(pointerAttribute, '');
      clearTimeout(searchTimer);
      token++;
      dialog.remove();
      if (invoker?.isConnected) invoker.focus();
    };
    dialog.showModal();
    guideFilterDialog(searchBox, '输入要找的不良，例如「装管反」。');
    const loading = showRule();
    if (listOperators.includes(op)) searchInput.focus();
    else if (!manual.hidden) keywordInput.focus();
    await loading;
  }
  function addChart(defect = null) {
    if (!result || result.empty) throw Error('先查询有效数据。');
    if (config.report.charts.length >= 24)
      throw Error('一份报告最多24张图，请先移除不需要的图表。');
    const q = { ...view(), range: 'custom', start: result.range.start, end: result.range.end };
    if (defect === '')
      q.filters = [...q.filters, { field: 'defect', op: 'empty', values: [], caseSensitive: false }];
    config.report.charts.push({
      id: 'c-' + crypto.randomUUID(),
      sourceId: config.activeSource,
      productionId: config.productionSource,
      period: period(),
      query: q,
      title: defect === '' ? '{日期}不良项空白{维度}' : '{日期}{不良项}{维度}',
      type: q.chartType,
      dimension: q.dimension,
      metric: 'quantity',
      defect: defect || '',
    });
    save();
    if (guideStep === 'export' || guideStep === 'filterReview') {
      setGuideStep('report');
      render();
    }
    notice('图表已加入横向A4报告，日期与筛选已固定，可继续加入其他图表。');
  }
  function chooseDefects() {
    if (!result || result.empty) throw Error('先查询有效数据。');
    const dialog = el('dialog', undefined, 'lab-dialog'),
      picked = new Set();
    dialog.append(el('h3', '每个所选不良项生成一张图表'));
    const list = el('div', undefined, 'lab-facet-list');
    result.defects.forEach((d) =>
      list.append(
        check(`${d.label || '（空白）'} · ${fmt(d.quantity)}`, false, (yes) => {
          if (yes) picked.add(d.label);
          else picked.delete(d.label);
        }),
      ),
    );
    dialog.append(
      list,
      btn('取消', () => dialog.close()),
      btn(
        '加入报告',
        () => {
          if (!picked.size) throw Error('请选择不良项。');
          if (picked.size + config.report.charts.length > 24)
            throw Error('图表合计超过24张，请减少选择。');
          picked.forEach(addChart);
          dialog.close();
        },
        true,
      ),
    );
    dialog.onclose = () => dialog.remove();
    root().append(dialog);
    dialog.showModal();
  }
  function renderReport(body) {
    const settings = el('div', undefined, 'lab-filterbar');
    const title = field('报告标题', config.report.title, (v) => {
      config.report.title = v;
      save();
    });
    const display = disclosure('页面设置', 'lab-options lab-report-options');
    display.append(el('p', '可在报告标题中使用 {日期} {工序} {不良项} {维度} {周期}。', 'lab-muted'));
    settings.append(

      field(
        '页边距 mm',
        config.report.margin,
        (v) => {
          config.report.margin = v;
          save();
        },
        'number',
      ),
      field(
        '图表间距 mm',
        config.report.gap,
        (v) => {
          config.report.gap = v;
          save();
        },
        'number',
      ),
      field(
        '标题字号 pt',
        config.report.titleSize,
        (v) => {
          config.report.titleSize = v;
          save();
        },
        'number',
      ),
      check('所有图表放一张横向A4（放不下会明确提示）', config.report.singlePage, (v) => {
        config.report.singlePage = v;
        save();
      }),
    );
    display.append(settings);
    const reportHeader = el('div', undefined, 'lab-report-header');
    reportHeader.append(title, display);
    body.append(reportHeader);
    if (!config.report.charts.length) {
      body.append(
        el(
          'p',
          '在分析与筛选中查询数据，再从「报表与导出」加入图表。',
          'lab-empty',
        ),
      );
      body.append(btn('前往分析与筛选', () => switchTab(lastAnalysisPeriod), true));
      return;
    }
    const list = el('div', undefined, 'lab-report-list');
    if (config.report.charts.some((chart) => chart.metric === 'rate'))
      display.append(
        btn('将报告中的不良率图改为数量图', () => {
          for (const chart of config.report.charts)
            if (chart.metric === 'rate') chart.metric = 'quantity';
          save();
          render();
        }),
      );
    config.report.charts.forEach((c, index) => {
      const chartSource = config.sources.find((item) => item.id === c.sourceId);
      const columns = chartSource?.columns || [];
      const classification =
        c.sourceId === result?.sourceId
          ? window.BIFieldLabels.process(result)
          : '分类字段（工序／产品类型）';
      const editor = disclosure('report-chart-' + c.id, 'lab-report-chart');
      const displayTitle = () => c.title.includes('{') ? (c.defect || c.title) : c.title;
      const caption = el('strong', snapshot?.charts?.find((chart) => chart.id === c.id)?.title || displayTitle());
      const chartType = () => types.find(([id]) => id === c.type)?.[1] || c.type;
      const metricName = { quantity: '不良数量', rows: '记录条数', rate: '不良率' }[c.metric];
      const meta = el('span', chartType() + ' · ' + metricName, 'lab-muted');
      editor.children[0].replaceChildren(el('span', String(index + 1).padStart(2, '0'), 'lab-report-index'),
        caption, meta);
      const row = el('div', undefined, 'lab-report-row');
      const up = btn('上移', () => move(index, -1));
      const down = btn('下移', () => move(index, 1));
      up.disabled = index === 0;
      down.disabled = index === config.report.charts.length - 1;
      row.append(
        field('图表标题', c.title, (v) => {
          c.title = v;
          save();
          caption.textContent = displayTitle();
        }),
        select(
          '图表类型',
          types.filter(([id]) => id !== 'pie' || c.metric !== 'rate'),
          c.type,
          (v) => {
            c.type = v;
            save();
            meta.textContent = chartType() + ' · ' + metricName;
          },
        ),
        select(
          '图表指标',
          [
            ['quantity', '不良数量'],
            ['rows', '记录条数'],
            ['rate', '不良率'],
          ],
          c.metric,
          (v) => {
            c.metric = v;
            if (v === 'rate' && c.type === 'pie') c.type = 'bar';
            save();
            render();
          },
        ),
        select(
          '图表维度',
          [
            ...M.dimensions.map((id) => [
              id,
              id === 'process' ? classification : M.labels[id] || id,
            ]),
            ...columns.map((column) => [column.id, column.label]),
          ],
          c.dimension,
          (v) => {
            c.dimension = v;
            save();
          },
        ),
        btn('复制图表', () => {
          if (config.report.charts.length >= 24) throw Error('报告最多24张图。');
          config.report.charts.splice(index + 1, 0, {
            ...structuredClone(c),
            id: 'c-' + crypto.randomUUID(),
          });
          save();
          render();
        }),
        up, down,
        btn('移除', () => {
          config.report.charts.splice(index, 1);
          save();
          render();
        }),
      );
      editor.append(row);
      list.append(editor);
    });
    const tools = el('div', undefined, 'lab-toolbar lab-report-actions');
    tools.append(el('strong', `已加入 ${config.report.charts.length} 张图`));
    tools.append(
      markGuide(btn(
        '预览横向A4',
        () =>
          run(async (token) => {
            await flush();
            const data = await call('reportData');
            if (token !== epoch) return;
            snapshot = data;
            plan = A.compose(data.charts, config.report, {
              title: data.title,
              subtitle: '指标与筛选范围以各图配置为准',
            });
            advanceGuide('preview', 'saveReport');
            render();
            notice(`已排版${data.charts.length}张图表，共${plan.pages.length}页。`);
          }),
        true,
      ), 'preview'),
    );
    const reportExports = disclosure('导出报告', 'lab-export-actions');
    reportExports.id = 'labReportExports';
    const reportFormats = el('div', undefined, 'lab-config-actions');
    reportExports.append(reportFormats);
    if (guideStep === 'saveReport') reportExports.open = true;
    for (const [format, label] of [
      ['pdf', '导出PDF'],
      ['xlsx', '导出Excel'],
      ['png', '导出图片'],
    ])
      reportFormats.append(
        markGuide(btn(label, () =>
          run(async (token) => {
            if (!plan || !snapshot) throw Error('请先预览报告；修改条件后需重新预览。');
            await flush();
            const r = await call('export', {
              format,
              snapshot: { revision: snapshot.revision, signature: snapshot.signature },
              pages: plan.pages,
            });
            if (token === epoch && !r.cancelled) {
              if (guideStep === 'saveReport') {
                setGuideStep('complete');
                render();
              }
              notice('报告已导出。Excel包含打印版、可编辑图表、统计和筛选依据。');
            }
          }),
        ), 'saveReport'),
      );
    if (plan && snapshot) tools.append(reportExports);
    body.append(tools, list);
    if (plan) {
      const preview = el('div', undefined, 'lab-a4-preview');
      preview.id = 'labReportPreview';
      plan.pages.forEach((p) => {
        const sheet = el('div', undefined, 'lab-a4-sheet');
        sheet.innerHTML = A.svg(p);
        preview.append(sheet);
      });
      body.append(preview);
    }
  }
  function move(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= config.report.charts.length) return;
    [config.report.charts[index], config.report.charts[target]] = [
      config.report.charts[target],
      config.report.charts[index],
    ];
    save();
    render();
  }
  async function activate({ analyzeOnOpen = true } = {}) {
    active = true;
    await run(async (token) => {
      if (!ready) {
        const row = await client.open(ADDRESS);
        if (token !== epoch) return;
        if (row.corrupt) throw Error(row.warning);
        config = M.validate(row.data);
        lastValid = structuredClone(config);
        const d = await client.open(DRAFT);
        if (token !== epoch) return;
        draft = d.corrupt ? null : d.data.source;
        const calendarRow = await client.open(CALENDAR);
        if (token !== epoch) return;
        if (calendarRow.corrupt) throw Error(calendarRow.warning);
        calendar = C.validate(calendarRow.data);
        const calendarDraft = await client.open(CALENDAR_DRAFT);
        if (token !== epoch) return;
        draftCalendar =
          draft &&
          !calendarDraft.corrupt &&
          calendarDraft.data.sourceId === draft.id &&
          calendarDraft.data.rule
            ? calendarDraft.data.rule
            : structuredClone(calendar.sources[draft?.id] || C.ruleDefaults());
        ready = true;
        render();
        await panels.load();
      }
      render();
      if (analyzeOnOpen && M.periods.includes(config.tab)) await analyze();
    });
    schedule();
    clearInterval(panelTimer);
    panelTimer = setInterval(() => {
      if (
        active &&
        ready &&
        !guideStep &&
        !busy &&
        unlocked() &&
        !document.querySelector?.('dialog[open]') &&
        !['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)
      )
        panels.poll().catch(fail);
    }, 2000);
  }
  function schedule() {
    clearTimeout(timer);
    if (!active) return;
    timer = setTimeout(async () => {
      if (
        active &&
        !busy &&
        ready &&
        unlocked() &&
        config.sources.some((s) => s.confirmed && s.auto) &&
        !document.querySelector?.('dialog[open]') &&
        !['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)
      ) {
        await run(async (token) => {
          let changed = false;
          for (const s of config.sources.filter((s) => s.confirmed && s.auto)) {
            await flush();
            const scan = await call('scan', { sourceId: s.id });
            if (token !== epoch) return;
            if (scan.files.some((f) => f.status !== '未变化')) {
              const imported = await call('import', { sourceId: s.id });
              if (token !== epoch) return;
              files = imported.files || [];
              changed = true;
              if (files.some((f) => f.error))
                return showImportErrors(
                  s.id,
                  files,
                  '自动读取遇到结构或数据问题，请核对下方结果。',
                );
            }
          }
          if (changed) {
            snapshot = null;
            plan = null;
            if (M.periods.includes(config.tab)) await analyze();
            else render();
          }
        }, null);
      }
      schedule();
    }, 15000);
  }
  function showImportErrors(id, errors, text) {
    config.tab = 'sources';
    draft = structuredClone(config.sources.find((s) => s.id === id));
    draftCalendar = structuredClone(calendar.sources[id] || C.ruleDefaults());
    inspection = null;
    files = errors;
    save();
    rememberDraft();
    render();
    fail(Error(text));
  }
  return Object.freeze({
    activate,
    startImportGuide,
    currentTab: () => active && ready ? config.tab : null,
    analysisPeriod: () => lastAnalysisPeriod,
    async openTab(tab, requested = null) {
      if (!['sources', 'analysis', 'report', ...M.periods].includes(tab))
        throw Error('未找到BI页面。');
      await activate({ analyzeOnOpen: false });
      if (!active || !ready || !unlocked()) return;
      const tabId = tab === 'analysis' ? lastAnalysisPeriod : tab;
      let requestedQuery = null;
      if (requested && M.periods.includes(tabId)) {
        if (!config.sources.some((s) => s.id === requested.sourceId && s.kind === 'defects'))
          throw Error('首页使用的数据源已变化，请刷新首页。');
        requestedQuery = M.query(requested.query);
        config.activeSource = requested.sourceId;
      }
      config.tab = tabId;
      if (requestedQuery) updateView(requestedQuery);
      page = 1;
      result = snapshot = plan = null;
      save();
      notice('');
      render();
      if (M.periods.includes(config.tab)) await run(() => analyze({ publish: !requested?.drill }));
    },
    flush,
    async reload() {
      await flush();
      epoch++;
      busy = false;
      ready = false;
      client.detach();
      panels.clear();
      result = null;
      snapshot = null;
      plan = null;
      importHistoryState = null;
      if (active) await activate();
    },
    deactivate() {
      setGuideStep(null);
      panels.invalidate();
      clearInterval(panelTimer);
      active = false;
      clearTimeout(timer);
    },
    clear() {
      setGuideStep(null);
      panels.clear();
      clearInterval(panelTimer);
      epoch++;
      active = false;
      busy = false;
      ready = false;
      clearTimeout(timer);
      client.detach();
      config = M.defaults();
      calendar = C.defaults();
      draftCalendar = C.ruleDefaults();
      draft = null;
      inspection = null;
      files = [];
      importHistoryState = null;
      result = null;
      snapshot = null;
      plan = null;
      message = '';
      openSections.clear();
      lastAnalysisPeriod = 'day';
      root()?.replaceChildren();
    },
  });
};
