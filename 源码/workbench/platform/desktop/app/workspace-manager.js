'use strict';
window.createWorkspaceManager = ({
  api,
  onOpen,
  onOldFile,
  onDemo,
  beforeLeave,
  onGuide = () => {},
}) => {
  const Q = window.WorkspaceQuery;
  const G = window.HomeGraphics,
    $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const btn = (text, fn, cls = '') => {
    const b = el('button', 'wm-button ' + cls, text);
    b.type = 'button';
    b.onclick = () => work(fn);
    return b;
  };
  const input = (label, value, type = 'text') => {
    const l = el('label', 'wm-field', label),
      i = el('input');
    i.type = type;
    i.value = value;
    l.append(i);
    return [l, i];
  };
  const select = (options, value) => {
    const s = el('select');
    for (const [v, t] of options) s.add(new Option(t, v));
    s.value = value;
    return s;
  };
  const root = el('section', 'workspace-manager');
  root.id = 'workspaceManager';
  root.hidden = true;
  root.setAttribute('aria-label', '工作区管理');
  document.body.append(root);
  let items = [],
    deletedItems = [],
    layout = { view: 'cards', sort: 'recent', selectedId: '' },
    selected = null,
    report = null,
    tab = 'analysis',
    search = '',
    includeArchived = false,
    showDeleted = false,
    loading = false,
    epoch = 0,
    activeId = '';
  const sortState = () => Q.sort(selected?.analysis?.sort);
  let working = false;
  let message = '',
    transition = false;
  const fmt = G.fmt,
    date = (t) => (t ? new Date(t).toLocaleString('zh-CN', { hour12: false }) : '尚未打开');
  let messageKind = 'error';
  const notify = (text, kind = 'success') => {
    message = text;
    messageKind = kind;
    const n = $('wmMessage');
    if (n) {
      n.textContent = text;
      n.dataset.kind = kind;
      n.setAttribute('role', kind === 'error' ? 'alert' : 'status');
      n.hidden = !text;
    }
  };
  const safeError = (e) => {
    messageKind = 'error';
    message = e.message || '操作未完成，请重试。';
    const n = $('wmMessage');
    if (n) {
      n.textContent = message;
      n.dataset.kind = 'error';
      n.setAttribute('role', 'alert');
      n.hidden = false;
    }
  };
  const disabledControls = new Map();
  function lockControls() {
    for (const e of root.querySelectorAll('button,input,select,textarea')) {
      if (!disabledControls.has(e)) disabledControls.set(e, e.disabled);
      e.disabled = true;
    }
  }
  new MutationObserver(() => {
    if (working) lockControls();
  }).observe(root, { childList: true, subtree: true });
  async function work(fn) {
    if (loading || working) return;
    working = true;
    lockControls();
    root.setAttribute('aria-busy', 'true');
    try {
      await fn();
    } catch (e) {
      safeError(e);
    } finally {
      working = false;
      for (const [e, disabled] of disabledControls) if (e.isConnected) e.disabled = disabled;
      disabledControls.clear();
      root.removeAttribute('aria-busy');
    }
  }
  async function remember() {
    await api('managedLayout', layout);
  }
  function show() {
    root.hidden = false;
    document.querySelector('.app-shell').hidden = true;
    document.body.classList.add('workspace-management');
    document.body.classList.remove('workbench-home');
  }
  function hide() {
    epoch++;
    root.hidden = true;
    document.querySelector('.app-shell').hidden = false;
    document.body.classList.remove('workspace-management');
  }
  async function open() {
    const ticket = ++epoch;
    show();
    renderShell();
    loading = true;
    root.inert = true;
    root.setAttribute('aria-busy', 'true');
    try {
      const r = await api('managedList');
      if (ticket !== epoch) return;
      items = r.items;
      deletedItems = r.deletedItems || [];
      layout = { ...layout, ...r.layout };
      activeId = r.activeId;
      selected = showDeleted ? deletedItems.find((x) => x.id === selected?.id) || deletedItems[0] || null :
        items.find((x) => x.id === layout.selectedId && !x.archived) ||
        items.find((x) => !x.archived) || null;
      loading = false;
      root.inert = false;
      root.removeAttribute('aria-busy');
      renderShell();
      if (selected) await choose(selected, false);
    } catch (e) {
      loading = false;
      root.inert = false;
      root.removeAttribute('aria-busy');
      safeError(e);
    }
  }
  async function choose(item, persist = true) {
    const ticket = ++epoch;
    selected = item;
    report = null;
    tab = 'analysis';
    renderCards();
    renderDetail();
    if (item.deletedAt) return;
    layout.selectedId = item.id;
    try {
      if (persist) await remember();
      const r = await api('managedReport', {
        id: item.id,
        sort: sortState(),
      });
      if (ticket !== epoch || root.hidden) return;
      applyReport(r);
      renderDetail();
    } catch (e) {
      if (ticket === epoch) safeError(e);
    }
  }
  async function enter(item, route = 'home', options) {
    transition = true;
    try {
      if (!['records', 'bi'].includes(item.dataSourceMode)) {
        const mode = await window.chooseWorkspaceSource({ name: item.name });
        if (!mode) return;
        const saved = await api('managedUpdate', { id: item.id, dataSourceMode: mode });
        Object.assign(item, saved);
      }
      await beforeLeave();
      const status = await api('managedOpen', { id: item.id });
      hide();
      await onOpen(status, route, options);
    } finally {
      transition = false;
    }
  }
  async function patch(p) {
    const saved = await api('managedUpdate', { id: selected.id, ...p });
    items = items.map((x) => (x.id === saved.id ? { ...x, ...saved } : x));
    selected = items.find((x) => x.id === saved.id);
    if (p.name)
      window.dispatchEvent(
        new CustomEvent('workbench:workspace-renamed', {
          detail: { id: saved.id, name: saved.name },
        }),
      );
    if (p.analysis || Object.hasOwn(p, 'dataSourceMode')) {
      applyReport(await api('managedReport', { id: selected.id }));
    }
    renderCards();
    renderDetail();
    return saved;
  }
  async function deleteWorkspace(item) {
    if (!window.confirm('删除工作区「' + item.name + '」？\n将移入工作区回收站，记录、BI数据及配置会保留，可随时恢复。'))
      return;
    if (item.id === activeId) await beforeLeave();
    await api('managedDelete', { id: item.id });
    await open();
    notify('已删除「' + item.name + '」。需要时可在「回收站」恢复。');
  }
  async function recoverWorkspace(item) {
    const restored = await api('managedRecover', { id: item.id });
    showDeleted = false;
    await open();
    notify('已恢复「' + restored.name + '」。');
  }
  function deleteButton(item, label = '删除工作区') {
    const button = btn(label, () => deleteWorkspace(item), 'danger');
    button.setAttribute('aria-label', '删除工作区：' + item.name);
    return button;
  }
  function applyReport(r) {
    report = r;
    if (selected) {
      selected.summary = Q.summary(r);
      items = items.map((x) => (x.id === selected.id ? selected : x));
    }
    renderCards();
  }
  function renderShell() {
    root.replaceChildren();
    const head = el('header', 'wm-header'),
      title = el('div');
    title.append(
      el('h1', '', '工作区管理'),
      el('p', '', '创建和管理不同工序的异常记录工作区，每个工作区独立保存数据、分析与配置。'),
    );
    const headerActions = el('div', 'wm-header-actions');
    headerActions.append(
      btn('新手引导', onGuide),
      btn('＋ 新建工作区', () => createDialog(), 'primary'),
    );
    head.append(title, headerActions);
    root.append(head);
    const feedback = el('p', 'wm-message', message);
    feedback.id = 'wmMessage';
    feedback.hidden = !message;
    feedback.dataset.kind = messageKind;
    feedback.setAttribute('role', messageKind === 'error' ? 'alert' : 'status');
    root.append(feedback);
    const split = el('div', 'wm-split'),
      left = el('section', 'wm-library');
    left.setAttribute('aria-label', '全部工作区');
    const tools = el('div', 'wm-tools');
    const find = el('input', 'wm-search');
    find.type = 'search';
    find.placeholder = '搜索工作区名称、工序、描述…';
    find.value = search;
    find.setAttribute('aria-label', '搜索工作区');
    find.oninput = () => {
      search = find.value;
      renderCards();
    };
    const order = select(
      [
        ['recent', '最近使用'],
        ['name', '名称顺序'],
        ['created', '创建时间'],
      ],
      layout.sort,
    );
    order.setAttribute('aria-label', '工作区排序');
    order.onchange = () =>
      work(async () => {
        layout.sort = order.value;
        await remember();
        renderCards();
      });
    const modes = el('div', 'wm-modes');
    for (const [mode, label] of [
      ['cards', '▦ 卡片视图'],
      ['list', '☷ 列表视图'],
    ]) {
      const b = btn(
        label,
        async () => {
          layout.view = mode;
          await remember();
          renderShell();
          renderDetail();
        },
        layout.view === mode ? 'chosen' : '',
      );
      b.setAttribute('aria-pressed', String(layout.view === mode));
      modes.append(b);
    }
    tools.append(find, order, modes);
    left.append(tools);
    const cards = el('div', 'wm-cards');
    cards.id = 'wmCards';
    left.append(cards);
    const foot = el('footer', 'wm-library-footer');
    foot.append(
      btn('打开旧密码文件', () => {
        hide();
        onOldFile();
      }),
      btn('恢复本机工作区备份', async () => {
        await api('managedRestore');
        await open();
      }),
      btn(includeArchived ? '隐藏归档' : '查看归档', async () => {
        showDeleted = false;
        includeArchived = !includeArchived;
        await open();
      }),
      btn(showDeleted ? '返回工作区列表' : '回收站（' + deletedItems.length + '）', async () => {
        showDeleted = !showDeleted;
        search = '';
        await open();
      }),
      btn('查看示例数据', () => {
        hide();
        onDemo();
      }),
    );
    foot.append(el('small', '', showDeleted
      ? '回收站中的工作区保留原数据与配置，恢复后即可继续使用。'
      : '工作区自动保存在本机用户目录；无需单独设置密码。'));
    left.append(foot);
    const detail = el('aside', 'wm-detail');
    detail.id = 'wmDetail';
    detail.setAttribute('aria-label', '所选工作区详情');
    split.append(left, detail);
    root.append(split);
    renderCards();
    renderDetail();
  }
  function spark(series, color, unit = '条') {
    const ns = 'http://www.w3.org/2000/svg',
      svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 250 60');
    svg.setAttribute('aria-label', '近期不良趋势，单位' + unit);
    svg.setAttribute('role', 'img');
    const points = series.length ? series : [{ count: 0 }],
      max = Math.max(1, ...points.filter((x) => Number.isFinite(x.count)).map((x) => x.count));
    let d = '',
      connected = false;
    points.forEach((x, i) => {
      if (!Number.isFinite(x.count)) {
        connected = false;
        return;
      }
      const px = 8 + (i * 234) / Math.max(1, points.length - 1),
        py = 50 - (x.count / max) * 40;
      d += (connected ? ' L' : ' M') + px + ' ' + py;
      connected = true;
    });
    const line = document.createElementNS(ns, 'path');
    line.setAttribute('d', d);
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', 'var(--wm-accent)');
    line.setAttribute('stroke-width', '2');
    svg.append(line);
    points.forEach((x, i) => {
      if (!Number.isFinite(x.count)) return;
      const c = document.createElementNS(ns, 'circle');
      c.setAttribute('cx', 8 + (i * 234) / Math.max(1, points.length - 1));
      c.setAttribute('cy', 50 - (x.count / max) * 40);
      c.setAttribute('r', 3);
      c.setAttribute('fill', 'var(--wm-accent)');
      const t = document.createElementNS(ns, 'title');
      t.textContent = (x.date || '') + ' ' + x.count + unit;
      c.append(t);
      svg.append(c);
    });
    return svg;
  }
  function mark(item) {
    const e = el('span', 'wm-mark'),
      ns = 'http://www.w3.org/2000/svg',
      svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '23');
    svg.setAttribute('height', '23');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.6');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    const process = item.process || item.name || '';
    const paths = process.includes('剪')
      ? 'M8 8 20 20M8 16 20 4M4 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm0 8a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z'
      : process.includes('测')
        ? 'M3 12h4l3-7 4 14 3-7h4'
        : process.includes('包装') || process.includes('装')
          ? 'm3 7 9-4 9 4-9 5Zm0 0v11l9 4 9-4V7M12 12v10M7 5l10 5'
          : process.includes('来料')
            ? 'M16 16l5 5M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z'
            : 'M6 3h12v18H6ZM9 7h6M9 11h6M9 15h4';
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', paths);
    svg.append(p);
    e.append(svg);
    e.setAttribute('aria-hidden', 'true');
    return e;
  }
  function renderCards() {
    const mount = $('wmCards');
    if (!mount) return;
    mount.className = 'wm-cards ' + (layout.view === 'list' ? 'is-list' : '');
    mount.replaceChildren();
    const visible = (showDeleted ? deletedItems : items)
      .filter(
        (x) =>
          (showDeleted || includeArchived || !x.archived) &&
          [x.name, x.process, x.description].some((v) =>
            v.toLowerCase().includes(search.toLowerCase()),
          ),
      )
      .sort(
        (a, b) =>
          Number(b.favorite) - Number(a.favorite) ||
          (layout.sort === 'name'
            ? a.name.localeCompare(b.name, 'zh-CN')
            : layout.sort === 'created'
              ? b.createdAt - a.createdAt
              : b.lastUsed - a.lastUsed),
      );
    for (const item of visible) {
      const card = el('article', 'wm-card ' + (item.id === selected?.id ? 'selected' : ''));
      card.dataset.color = item.color;
      card.dataset.workspaceId = item.id;
      const heading = el('div', 'wm-card-heading'),
        name = btn(item.name, () => choose(item), 'wm-card-name');
      name.prepend(mark(item));
      const star = btn(item.favorite ? '★' : '☆', async () => {
        await api('managedUpdate', { id: item.id, favorite: !item.favorite });
        item.favorite = !item.favorite;
        renderCards();
        renderDetail();
      });
      star.setAttribute('aria-label', (item.favorite ? '取消收藏' : '收藏') + item.name);
      heading.append(name);
      if (!item.deletedAt) heading.append(star);
      card.append(heading);
      card.append(
        el(
          'p',
          'wm-card-meta',
          '工序：' +
            (item.process || '未指定') +
            '　创建：' +
            new Date(item.createdAt).toLocaleDateString('zh-CN'),
        ),
      );
      if (item.deletedAt) {
        card.append(el('p', 'wm-note', '已删除：' + date(item.deletedAt)),
          btn('恢复工作区', () => recoverWorkspace(item), 'open'),
          btn('查看保留信息', () => choose(item)));
        mount.append(card);
        continue;
      }
      card.append(
        el(
          'p',
          'wm-note',
          item.summary?.source === 'bi'
            ? '来源：BI自由分析' + (item.dataSourceMode === 'auto' ? '（旧工作区自动识别）' : '')
            : item.dataSourceMode === 'bi'
              ? '来源：BI导入不良'
              : item.dataSourceMode === 'records'
                ? '来源：手动录入不良'
                : '来源：旧工作区待确认',
        ),
      );
      if (item.unavailable) card.append(el('p', 'wm-card-warning', item.message));
      else if (item.summary?.source === 'bi') {
        const s = item.summary,
          nums = el('div', 'wm-card-metrics');
        for (const [value, label] of [
          [s.quantity, '不良数量（' + s.unit + '）'],
          [s.rows, 'BI明细行数'],
          [s.previousQuantity, '上期不良数量'],
          [s.coverageDays, '有数据天数'],
        ]) {
          const box = el('div');
          box.append(el('strong', '', fmt(value)), el('small', '', label));
          nums.append(box);
        }
        card.append(nums);
        if (s.available) card.append(spark(s.trend || [], item.color, s.unit));
        else card.append(el('p', 'wm-card-warning', s.message || '当前范围没有可用BI，未当作零。'));
        if (s.period)
          card.append(el('small', 'wm-card-period', s.period.start + ' 至 ' + s.period.end));
        if (s.availableRange)
          card.append(
            el(
              'small',
              'wm-card-period',
              '已有日期：' + s.availableRange.start + ' 至 ' + s.availableRange.end,
            ),
          );
      } else {
        const nums = el('div', 'wm-card-metrics');
        const s = item.summary || {};
        for (const [n, label, cls] of [
          [s.records, '人工记录', ''],
          [s.pending, '待处理', 'red'],
          [s.overdue, '超期', ''],
          [s.closedRate === null ? '—' : (s.closedRate * 100).toFixed(1) + '%', '关闭率', 'green'],
        ]) {
          const k = el('div', cls);
          k.append(el('strong', '', typeof n === 'string' ? n : fmt(n)), el('small', '', label));
          nums.append(k);
        }
        card.append(nums, spark(s.trend || [], item.color));
        if (s.period)
          card.append(el('small', 'wm-card-period', s.period.start + ' 至 ' + s.period.end));
      }
      card.append(el('p', 'wm-card-meta', '最近使用：' + date(item.lastUsed)));
      const actions = el('div', 'wm-card-actions');
      actions.append(
        btn(item.id === activeId ? '继续工作' : '打开工作区', () => enter(item), 'open'),
        btn('详情', () => choose(item)),
        deleteButton(item, '删除'),
      );
      card.append(actions);
      if (item.archived) card.append(el('small', 'wm-archived', '已归档'));
      mount.append(card);
    }
    if (!visible.length && search)
      mount.append(el('p', 'wm-empty', '没有匹配的工作区，请调整搜索内容。'));
    if (showDeleted) {
      if (!visible.length && !search) mount.append(el('p', 'wm-empty', '回收站为空。误删的工作区可以在这里恢复。'));
      return;
    }
    const create = el('article', 'wm-create-card');
    const plus = btn('＋', () => createDialog(), 'wm-big-plus');
    plus.setAttribute('aria-label', '新建工作区');
    create.append(plus, el('h2', '', '新建工作区'), el('p', '', '按工序或异常场景建立独立工作区'));
    create.append(
      btn('空白工作区', () => createDialog()),
      btn('使用模板创建', () => createDialog('template')),
      btn('复制现有工作区配置', () => createDialog('copy')),
    );
    if (items.filter((x) => !x.archived).length < 5) {
      const quick = el('div', 'wm-quick');
      quick.append(el('small', '', '常用工序，选择数据来源后创建'));
      for (const name of ['剪线', '装管', '来料', '测试', '包装'])
        if (!items.some((x) => x.name === name + '异常'))
          quick.append(
            btn(name, () => createDialog('blank', { name: name + '异常', process: name })),
          );
      create.append(quick);
    }
    mount.append(create);
  }
  function panel(title, content, cls = '') {
    const p = el('section', 'wm-chart ' + cls);
    p.append(el('h3', '', title), content);
    return p;
  }
  function renderDetail() {
    const d = $('wmDetail');
    if (!d) return;
    d.replaceChildren();
    if (!selected) {
      d.append(el('div', 'wm-detail-empty', '选择一个工作区，在这里查看独立分析和设置。'));
      return;
    }
    const head = el('div', 'wm-detail-head'),
      name = el('div');
    name.append(
      el('h2', '', selected.name + (selected.favorite ? ' ★' : '')),
      el(
        'p',
        '',
        '工序：' +
          (selected.process || '未指定') +
          '　创建时间：' +
          new Date(selected.createdAt).toLocaleDateString('zh-CN'),
      ),
    );
    head.append(
      mark(selected),
      name,
      selected.deletedAt
        ? btn('恢复工作区', () => recoverWorkspace(selected), 'primary')
        : btn('打开', () => enter(selected), 'primary'),
    );
    d.dataset.color = selected.color;
    d.append(head);
    if (selected.deletedAt) {
      d.append(el('h3', '', '此工作区已移入回收站'),
        el('p', 'wm-note', '删除时间：' + date(selected.deletedAt)),
        el('p', 'wm-note', '业务记录、BI数据与独立配置仍然保留。恢复后可打开并继续使用；不会与其他工作区合并。'));
      return;
    }
    const tabs = el('div', 'wm-tabs');
    tabs.setAttribute('role', 'tablist');
    const biWorkspace =
      selected.dataSourceMode === 'bi' ||
      (selected.dataSourceMode === 'auto' &&
        (report?.primary?.source || selected.summary?.source) === 'bi');
    const tabList = biWorkspace
      ? [
          ['analysis', '数据分析预览'],
          ['basic', '基本信息'],
          ['bi-source', '数据源与字段'],
          ['other', '其他设置'],
        ]
      : [
          ['analysis', '数据分析预览'],
          ['basic', '基本信息'],
          ['fields', '字段配置'],
          ['defaults', '默认设置'],
          ['scan', '扫码规则'],
          ['other', '其他设置'],
        ];
    if (!tabList.some(([id]) => id === tab)) tab = 'analysis';
    for (const [id, label] of tabList) {
      const b = btn(
        label,
        () => {
          tab = id;
          renderDetail();
        },
        tab === id ? 'active' : '',
      );
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(tab === id));
      tabs.append(b);
    }
    d.append(tabs);
    const body = el('div', 'wm-detail-body');
    body.setAttribute('role', 'tabpanel');
    d.append(body);
    if (tab === 'analysis') renderAnalysis(body);
    else if (tab === 'basic') renderBasic(body);
    else if (tab === 'fields') renderFields(body);
    else if (tab === 'defaults') renderDefaults(body);
    else if (tab === 'scan') renderScan(body);
    else if (tab === 'bi-source') {
      body.append(
        el('h3', '', 'BI数据源与字段'),
        el(
          'p',
          'wm-note',
          '在BI数据源页面设置下载目录、识别表头、确认字段与班次规则，配置按工作区独立保存。',
        ),
        btn(
          '配置BI数据源与导入',
          () => enter(selected, 'analysis-studio', { analysisTab: 'sources' }),
          'primary',
        ),
      );
    } else renderOther(body);
  }
  function renderAnalysis(body) {
    const scope = el('div', 'wm-scope');
    const dates = el('div', 'wm-dates');
    const from = el('input'),
      to = el('input');
    from.type = to.type = 'date';
    from.value = report?.scope.start || selected.analysis.start || '';
    to.value = report?.scope.end || selected.analysis.end || '';
    from.setAttribute('aria-label', '分析开始日期');
    to.setAttribute('aria-label', '分析结束日期');
    const changeDates = () =>
      work(async () => {
        if (!from.value || !to.value || from.value > to.value)
          throw Error('请填写有效的起止日期，开始日期不能晚于结束日期。');
        await patch({
          analysis: { ...selected.analysis, range: 'custom', start: from.value, end: to.value },
        });
        applyReport(await api('managedReport', { id: selected.id }));
        renderDetail();
      });
    from.onchange = to.onchange = changeDates;
    dates.append(from, el('span', '', '至'), to);
    scope.append(dates);
    for (const [v, label] of [
      ['1', '今天'],
      ['7', '近7天'],
      ['30', '近30天'],
      ['month', '本月'],
      ['last-month', '上月'],
      ['90', '近90天'],
      ['all', '全部'],
    ])
      scope.append(
        btn(
          label,
          async () => {
            await patch({ analysis: { ...selected.analysis, range: v } });
            const r = await api('managedReport', { id: selected.id });
            applyReport(r);
            renderDetail();
          },
          selected.analysis.range === v ? 'chosen' : '',
        ),
      );
    const grain = select(
      [
        ['day', '按天'],
        ['week', '按周'],
        ['month', '按月'],
      ],
      selected.analysis.grain,
    );
    grain.setAttribute('aria-label', '趋势周期');
    grain.onchange = () =>
      work(async () => {
        await patch({ analysis: { ...selected.analysis, grain: grain.value } });
        applyReport(await api('managedReport', { id: selected.id }));
        renderDetail();
      });
    scope.append(
      grain,
      btn('刷新', () => choose(selected)),
    );
    body.append(scope);
    if (!report) {
      body.append(el('p', 'wm-empty', '正在读取所选工作区…'));
      return;
    }
    if (report.primary?.source === 'bi') {
      window.WorkspaceBIView.render(body, {
        report,
        button: btn,
        panel,
        onAll: async () => {
          await patch({ analysis: { ...selected.analysis, range: 'all' } });
          renderDetail();
        },
        onOpen: () => enter(selected, 'analysis-studio'),
        onDetails: (title, params) =>
          detailDialog(title, () =>
            api('managedReport', { id: selected.id, pageSize: 50, ...params }),
          ),
      });
      return;
    }
    const r = report,
      metrics = el('div', 'wm-metrics');
    const rate =
      r.workflowAvailable && r.recordCount ? (r.recordCount - r.pending) / r.recordCount : null;
    for (const [label, value, cls, sub] of [
      [
        '人工异常记录数',
        r.recordCount,
        'blue',
        r.recordChange === null
          ? '上期无记录'
          : `较上期 ${r.recordDelta >= 0 ? '+' : ''}${r.recordDelta} 条`,
      ],
      ['不良件数', r.quality?.totals?.defectiveUnits ?? null, 'coral', '按检验数据统计'],
      ['待处理数量', r.pending, 'amber', '包含尚未关闭的记录'],
      [
        '处理关闭率',
        rate === null ? '—' : (rate * 100).toFixed(1) + '%',
        'green',
        r.overdue === null ? '未提供跟进信息' : `超期 ${r.overdue} 条`,
      ],
    ]) {
      const m = el('div', 'wm-metric ' + cls);
      m.append(
        el('small', '', label),
        el('strong', '', typeof value === 'string' ? value : fmt(value)),
        el('span', '', sub),
      );
      metrics.append(m);
    }
    body.append(el('h3', 'wm-section-label', '人工记录与检验预览'), metrics);
    body.append(
      el(
        'p',
        'wm-note',
        '此处为当前工作区的人工记录与检验数据；已导入的BI自由分析来源会单独预览，不相加。',
      ),
    );
    body.append(el('p', 'wm-period', `${r.scope.start} 至 ${r.scope.end}；发现日期统计异常条数。`));
    const grid = el('div', 'wm-chart-grid');
    grid.append(
      panel(
        '异常数量趋势',
        G.combo(r.trend, {
          width: 290,
          onQuantity: (x) => quantityDialog(x),
          onRange: (x) =>
            detailDialog('周期明细', () =>
              api('managedReport', { id: selected.id, start: x.start, end: x.end, pageSize: 50 }),
            ),
        }),
      ),
      panel(
        '不良类型分布（记录条数）',
        G.donut(r.issues, r.recordCount, (value) =>
          detailDialog(value || '未填写异常', () =>
            api('managedReport', { id: selected.id, filters: { issue: value }, pageSize: 50 }),
          ),
        ),
      ),
      panel(
        '工序异常分布（条）',
        G.ranking(r.processes, {
          onSelect: (value) =>
            detailDialog(value || '未填写工序', () =>
              api('managedReport', { id: selected.id, filters: { process: value }, pageSize: 50 }),
            ),
        }),
      ),
      panel(
        '跟进负责人关联条数 Top 5',
        G.ranking(r.owners, {
          limit: 5,
          unmapped: '未分配',
          onSelect: (value) =>
            detailDialog(value || '未分配', () =>
              api('managedReport', { id: selected.id, filters: { owner: value }, pageSize: 50 }),
            ),
        }),
      ),
    );
    body.append(grid);
    const records = el('section', 'wm-recent');
    records.append(
      el('h3', '', '最近异常记录'),
      btn('更多记录', () => enter(selected, 'legacy-records')),
      renderTable(r.rows),
    );
    body.append(
      records,
      el(
        'p',
        'wm-note',
        '没有检验件数来源时显示“—”；图表和负责人排名均为记录关联统计，不代表责任判定。',
      ),
    );
  }
  function renderTable(rows, sortable = true) {
    const wrap = el('div', 'wm-table-wrap'),
      table = el('table'),
      head = el('thead'),
      tr = el('tr');
    for (const [id, label] of [
      ['sn', 'SN / 编号'],
      ['date', '发现日期'],
      ['process', '工序'],
      ['issue', '异常现象'],
      ['owner', '跟进负责人'],
      ['status', '状态'],
    ]) {
      const th = el('th');
      if (sortable)
        th.append(
          btn(
            label +
              (sortState().field === id ? (sortState().direction === 'asc' ? ' ↑' : ' ↓') : ''),
            async () => {
              const previous = sortState();
              await patch({
                analysis: {
                  ...selected.analysis,
                  sort: {
                    field: id,
                    direction:
                      previous.field === id && previous.direction === 'asc' ? 'desc' : 'asc',
                  },
                },
              });
              renderDetail();
            },
          ),
        );
      else th.textContent = label;
      tr.append(th);
    }
    head.append(tr);
    table.append(head);
    const tbody = el('tbody');
    for (const row of rows) {
      const t = el('tr');
      for (const key of ['sn', 'date', 'process', 'issue', 'owner', 'status']) {
        const td = el('td', '', row[key] || '—');
        if (key === 'status') {
          td.replaceChildren(
            el(
              'span',
              'wm-status ' +
                ({ 待处理: 'pending', 处理中: 'working', 待验证: 'verify', 已关闭: 'closed' }[
                  row.status
                ] || ''),
              row.status || '—',
            ),
          );
        }
        t.append(td);
      }
      tbody.append(t);
    }
    if (!rows.length) {
      const td = el('td', 'wm-no-records', '暂无记录，打开工作区即可扫码或快捷录入。');
      td.colSpan = 6;
      const tr = el('tr');
      tr.append(td);
      tbody.append(tr);
    }
    table.append(tbody);
    wrap.append(table);
    return wrap;
  }
  function renderBasic(body) {
    const form = el('form', 'wm-form'),
      [nl, n] = input('工作区名称', selected.name),
      [pl, p] = input('工序', selected.process),
      [dl, desc] = input('说明', selected.description);
    n.maxLength = 48;
    n.required = true;
    p.maxLength = 32;
    desc.maxLength = 240;
    form.append(nl, pl, dl);
    const dataMode = select(
      [
        ['auto', '旧工作区：尚未明确（保留原数据）'],
        ['records', '手动录入不良'],
        ['bi', 'BI导入不良'],
      ],
      selected.dataSourceMode || 'auto',
    );
    dataMode.setAttribute('aria-label', '工作区主要数据来源');
    const modeField = el('label', 'wm-field', '主要数据来源');
    modeField.append(dataMode);
    form.append(
      modeField,
      el(
        'p',
        'wm-note',
        '来源决定本工作区显示的导航、快捷操作、设置和分析；不会搬迁、合并或删除已有数据，重新打开后生效。',
      ),
    );

    const color = select(
        [
          ['blue', '蓝色'],
          ['green', '绿色'],
          ['coral', '珊瑚红'],
          ['purple', '紫色'],
          ['cyan', '青色'],
        ],
        selected.color,
      ),
      l = el('label', 'wm-field', '识别颜色');
    l.append(color);
    form.append(l);
    const save = el('button', 'wm-button primary', '保存信息');
    save.type = 'submit';
    form.append(save);
    form.onsubmit = (e) => {
      e.preventDefault();
      work(async () => {
        await patch({
          name: n.value,
          process: p.value,
          description: desc.value,
          color: color.value,
          dataSourceMode: dataMode.value,
        });
        renderDetail();
      });
    };
    body.append(form);
  }
  async function renderFields(body) {
    const id = selected.id;
    body.append(
      el('p', 'wm-note', '字段与模板只属于当前工作区。修改后历史数据按原模块规则保留。'),
      btn('编辑字段与模板', () => enter(selected, 'legacy-settings'), 'primary'),
    );
    try {
      const r = await api('managedFields', { id });
      if (selected?.id !== id || tab !== 'fields') return;
      for (const t of r.templates) {
        body.append(el('h3', '', t.name));
        const list = el('div', 'wm-field-list');
        for (const c of t.columns)
          list.append(el('span', '', c.label + ' · ' + c.type + (c.required ? ' · 必填' : '')));
        body.append(list);
      }
    } catch (e) {
      safeError(e);
    }
  }
  function renderDefaults(body) {
    body.append(
      el('p', 'wm-note', '日期范围、图表周期与检验数据集为此工作区独立记忆。'),
      btn('管理完整录入默认值', () => enter(selected, 'legacy-settings')),
    );
    const range = select(
        [
          ['1', '今天'],
          ['7', '近7天'],
          ['30', '近30天'],
          ['month', '本月'],
          ['last-month', '上月'],
          ['90', '近90天'],
          ['all', '全部'],
          ['custom', '自定义日期'],
        ],
        selected.analysis.range,
      ),
      grain = select(
        [
          ['day', '按天'],
          ['week', '按周'],
          ['month', '按月'],
        ],
        selected.analysis.grain,
      ),
      dataset = select(
        [['', '自动选择首个数据集'], ...(report?.datasets || []).map((x) => [x.id, x.label])],
        selected.analysis.datasetId,
      );
    for (const [label, s] of [
      ['默认时间范围', range],
      ['趋势汇总周期', grain],
      ['检验数量来源', dataset],
    ]) {
      const l = el('label', 'wm-field', label);
      l.append(s);
      body.append(l);
    }
    body.append(
      btn(
        '保存默认设置',
        async () => {
          await patch({
            analysis: {
              ...selected.analysis,
              range: range.value,
              grain: grain.value,
              datasetId: dataset.value,
            },
          });
          applyReport(await api('managedReport', { id: selected.id }));
          tab = 'analysis';
          renderDetail();
        },
        'primary',
      ),
    );
  }
  function renderScan(body) {
    body.append(
      el('h3', '', '连续扫码与防重复'),
      el(
        'p',
        'wm-note',
        '沿用原录入模块的SN唯一值检查、必填校验、批量扫码和回车防误提交。编号按文本保存，保留英文与前导零。',
      ),
      btn('打开扫码录入', () => enter(selected, 'legacy-entry'), 'primary'),
      btn('配置字段唯一值与联动规则', () => enter(selected, 'legacy-settings')),
    );
  }
  function renderOther(body) {
    body.append(
      el('h3', '', '数据与恢复'),
      el(
        'p',
        'wm-note',
        '数据由当前Windows账户保护，无需另设密码。本机备份需要原账户与完整程序配置恢复；不等于跨电脑迁移包。',
      ),
      btn('备份此工作区', async () => {
        const r = await api('managedBackup', { id: selected.id });
        if (!r.cancelled) {
          message = '已保存本机工作区备份：' + r.name;
          notify(message, 'success');
        }
      }),
      btn('复制配置，不复制记录', () => createDialog('copy')),
      btn(selected.archived ? '取消归档' : '归档工作区', async () => {
        if (
          !window.confirm(
            selected.archived
              ? '将此工作区移回常用列表？'
              : '归档只隐藏工作区，不删除记录，是否继续？',
          )
        )
          return;
        await patch({ archived: !selected.archived });
        await open();
      }),
      deleteButton(selected),
    );
  }
  function createDialog(mode = 'blank', preset = {}) {
    const dialog = el('dialog', 'wm-dialog'),
      form = el('form'),
      title = el('h2', '', mode === 'copy' ? '复制工作区配置' : '新建工作区');
    form.append(title, el('p', '', '无需选文件或设置密码，确认后自动保存在本机。'));
    const [nl, n] = input(
        '工作区名称',
        preset.name || (mode === 'copy' && selected ? selected.name + ' 副本' : ''),
      ),
      [pl, p] = input('工序', preset.process || selected?.process || '');
    n.maxLength = 48;
    n.required = true;
    p.maxLength = 32;
    form.append(nl, pl);
    const dataMode = select(
      [
        ['', '请选择主要数据来源'],
        ['records', '手动录入不良'],
        ['bi', 'BI导入不良'],
      ],
      mode === 'copy' && ['records', 'bi'].includes(selected?.dataSourceMode)
        ? selected.dataSourceMode
        : '',
    );
    dataMode.required = true;
    dataMode.setAttribute('aria-label', '主要数据来源（必选）');
    const modeField = el('label', 'wm-field', '主要数据来源（必选）');
    modeField.append(dataMode);
    form.append(
      modeField,
      el(
        'p',
        'wm-note',
        '选择后只显示对应功能。手动录入提供扫码、查询和跟进；BI报表提供文件读取、筛选、日周月和报告。原数据独立保留。',
      ),
    );

    const source = select(
      [['', '通用异常记录模板'], ...items.map((x) => [x.id, x.name + '（仅复制配置）'])],
      mode === 'copy' ? selected?.id || '' : '',
    );
    source.setAttribute('aria-label', '录入模板来源（不含BI数据和BI配置）');
    const l = el('label', 'wm-field', '录入模板来源（不含BI数据和BI配置）');
    l.append(source);
    form.append(l);
    const updateTemplateChoice = () => {
      l.hidden = dataMode.value !== 'records';
      source.disabled = l.hidden;
      if (l.hidden) source.value = '';
    };
    dataMode.onchange = updateTemplateChoice;
    updateTemplateChoice();
    const help = el('p', 'wm-note', '新工作区从0条记录开始，原工作区保持独立。');
    form.append(help);
    const error = el('p', 'wm-message');
    error.hidden = true;
    error.setAttribute('role', 'alert');
    form.append(error);
    const actions = el('div', 'wm-dialog-actions');
    actions.append(btn('取消', () => dialog.close()));
    const submit = el('button', 'wm-button primary', '创建工作区');
    submit.type = 'submit';
    actions.append(submit);
    form.append(actions);
    dialog.append(form);
    root.append(dialog);
    dialog.showModal();
    n.focus();
    dialog.onclose = () => dialog.remove();
    form.onsubmit = async (e) => {
      e.preventDefault();
      submit.disabled = true;
      try {
        if (!['records', 'bi'].includes(dataMode.value))
          throw Error('请选择手动录入不良或BI导入不良。');
        const made = await api('managedCreate', {
          name: n.value,
          process: p.value,
          dataSourceMode: dataMode.value,
          color: selected?.color || 'blue',
          ...(source.value ? { copyFrom: source.value } : {}),
        });
        dialog.close();
        showDeleted = false;
        layout.selectedId = made.id;
        await open();
      } catch (err) {
        error.hidden = false;
        error.textContent = err.message;
        submit.disabled = false;
      }
    };
  }
  async function quantityDialog(period) {
    const r = await api('managedReport', { id: selected.id, start: period.start, end: period.end });
    const d = el('dialog', 'wm-dialog');
    d.append(
      el('h2', '', '检验数量与来源'),
      el('p', 'wm-note', period.start + ' 至 ' + period.end),
      el('p', '', '检验件数：' + fmt(r.quality?.totals?.inspectedUnits)),
      el('p', '', '不良件数：' + fmt(r.quality?.totals?.defectiveUnits)),
      el('p', 'wm-note', '数量来自当前工作区的检验数据集，不由异常条数推算。'),
      btn('关闭', () => d.close()),
    );
    root.append(d);
    d.showModal();
    d.onclose = () => d.remove();
  }
  async function detailDialog(title, load) {
    const d = el('dialog', 'wm-dialog wm-dialog-wide');
    d.append(
      el('h2', '', title),
      el('p', 'wm-note', '最多显示50条匹配记录；完整查询请打开工作区。'),
      btn('关闭', () => d.close()),
    );
    root.append(d);
    d.showModal();
    d.onclose = () => d.remove();
    try {
      const r = await load();
      d.append(
        r.primary?.source === 'bi'
          ? window.WorkspaceBIView.table(
              r.biSource.rows,
              r.biSource.unitLabel || '未确认',
              r.biSource,
            )
          : renderTable(r.rows, false),
      );
    } catch (e) {
      d.append(el('p', 'wm-message', e.message));
    }
  }
  show();
  renderShell();
  return {
    open,
    hide,
    get transition() {
      return transition;
    },
    clear: () => {
      report = null;
    },
    create: () => createDialog(),
  };
};
