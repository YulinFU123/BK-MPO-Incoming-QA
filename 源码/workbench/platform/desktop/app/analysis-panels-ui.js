'use strict';
window.createAnalysisPanelsUI = ({
  call,
  getConfig,
  getSource,
  getGrouping = () => null,
  getPeriod,
  refresh,
  invalidate,
  report,
  openFilter,
  drawChart,
  el,
  btn,
  field,
  select,
  check,
  notice,
  fail,
}) => {
  const P = window.AnalysisPanels,
    M = window.AnalysisStudio;
  let state = null,
    signature = '',
    file = null,
    writable = true,
    persisted = false;
  let generation = 0,
    saved = 0,
    lifecycle = 0,
    mounting = 0,
    writing = null,
    timer = null,
    warning = '',
    bindingError = '';
  const fmt = (v) =>
    v == null ? '—' : Number(v).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  const pct = (v) => (v == null ? '—' : (v * 100).toFixed(2) + '%');
  const uuid = () => crypto.randomUUID();
  const source = () => getSource();
  function status() {
    const n = document.getElementById('labPanelsSaved');
    if (n)
      n.textContent =
        bindingError ||
        warning ||
        (generation !== saved
          ? '板块与筛选尚未同步'
          : persisted
            ? '板块与筛选已自动保存'
            : '示例设置：仅本次会话记忆');
  }
  function ensure() {
    if (!state || !source()) return;
    if (!Object.hasOwn(state.sources, source().id)) {
      P.ensure(state, source(), getConfig());
      changed();
    }
    return P.active(state, source().id);
  }
  function current() {
    return ensure()?.periods[getPeriod()];
  }
  function changed() {
    P.validate(state);
    generation++;
    warning = '';
    invalidate();
    status();
    clearTimeout(timer);
    timer = setTimeout(() => flush().catch(fail), 400);
  }
  function mutate(fn) {
    const before = structuredClone(state);
    try {
      fn();
      changed();
    } catch (e) {
      state = before;
      throw e;
    }
  }
  function apply(r) {
    state = P.validate(r.state);
    signature = r.signature;
    file = r.file;
    writable = r.writable;
    persisted = r.persisted;
    warning = r.warning || '';
    generation = saved = 0;
    status();
  }
  async function load() {
    const token = lifecycle;
    const r = await call('panelsLoad');
    if (token === lifecycle) apply(r);
  }
  async function flush() {
    clearTimeout(timer);
    if (writing) return writing;
    const token = lifecycle;
    writing = (async () => {
      while (state && generation !== saved && token === lifecycle) {
        if (!writable) throw Error(warning || '配置文件无法写入。');
        const own = generation;
        const r = await call('panelsSave', { panelState: structuredClone(state), signature });
        if (token !== lifecycle) return;
        signature = r.signature;
        state.revision = r.state.revision;
        persisted = r.persisted;
        saved = own;
        warning = '';
        status();
      }
    })()
      .catch((e) => {
        if (token === lifecycle) {
          warning = e.message;
          status();
        }
        throw e;
      })
      .finally(() => {
        if (token === lifecycle) writing = null;
      });
    return writing;
  }
  function query() {
    const q = current();
    try {
      const result = q ? P.bindQuery(q.query, source()) : M.currentView(getConfig(), getPeriod());
      bindingError = '';
      return result;
    } catch (e) {
      bindingError = e.message + ' 请修复方案字段或重置本面板；当前默认条件仅用于修复，尚未分析。';
      status();
      return M.viewDefaults(getPeriod());
    }
  }
  function setQuery(q) {
    if (!current()) return false;
    mutate(() => {
      current().query = P.portableQuery(q, source());
    });
    bindingError = '';
    return true;
  }
  function dialog(title) {
    const d = el('dialog', undefined, 'lab-dialog lab-panel-dialog');
    d.append(el('h3', title));
    document.getElementById('analysisStudioRoot').append(d);
    d.onclose = () => d.remove();
    d.showModal();
    return d;
  }
  function edit(panelId) {
    const c = current();
    if (!c) throw Error('请先选择数据源。');
    const s = source(),
      period = getPeriod(),
      schemeId = ensure().id;
    const old = c.panels.find((p) => p.id === panelId);
    const draft = structuredClone(
      old || { ...P.seedPanel('chart', uuid(), query(), s), title: '新分析板块', scope: 'filters' },
    );
    let q = P.bindQuery(draft.query, s);
    if (!old) q.filters = [];
    const d = dialog(old ? '编辑板块' : '新增分析板块'),
      error = el('p', undefined, 'lab-error');
    const form = el('div', undefined, 'lab-panel-form'),
      chips = el('div', undefined, 'lab-filter-chips');
    const ranges = [
      ['recent7', '近7天'],
      ['recent14', '近14天'],
      ['recent30', '近30天'],
      ['recent8w', '近8周'],
      ['recent6m', '近6月'],
      ['latest', '最新一天'],
      ['all', '全部'],
      ['custom', '自定义日期'],
    ];
    const scopeInfo = el('p', undefined, 'lab-muted');
    const explain = () => {
      scopeInfo.textContent = {
        page: '全部跟随页面设置。',
        filters: '跟随页面日期与筛选，并叠加本板块条件；图种、维度独立。',
        independent: '使用本板块的日期和条件，页面筛选不会改动它。',
      }[draft.scope];
    };
    form.append(
      field('板块标题', draft.title, (v) => (draft.title = v)),
      select(
        '内容',
        [
          ['trend', '时间趋势'],
          ['chart', '分类图表'],
          ['table', '分类数据表'],
          ['metric', '指标数字'],
        ],
        draft.kind,
        (v) => (draft.kind = v),
      ),
      select(
        '数据范围',
        [
          ['filters', '跟随页面筛选，独立分析维度'],
          ['page', '全部跟随页面'],
          ['independent', '独立日期与筛选'],
        ],
        draft.scope,
        (v) => {
          draft.scope = v;
          explain();
        },
      ),
      select(
        '分析维度',
        [
          ...M.dimensions.map((k) => [
            k,
            window.BIFieldLabels.field({ grouping: getGrouping() }, k, M.labels[k]),
          ]),
          ...s.columns.map((c) => [c.id, c.label]),
        ],
        q.dimension,
        (v) => (q.dimension = v),
      ),
      select(
        '图表',
        [
          ['bar', '条形图'],
          ['column', '柱形图'],
          ['line', '折线图'],
          ['pie', '饼图'],
        ],
        q.chartType,
        (v) => (q.chartType = v),
      ),
      select(
        '图表指标',
        [
          ['quantity', '不良/不良数量'],
          ['rate', '有有效分母时的不良率'],
        ],
        q.metric,
        (v) => (q.metric = v),
      ),
      select(
        '数字板块指标',
        [
          ['records', '记录条数'],
          ['quantity', '不良/不良数量'],
          ['production', '匹配产量'],
          ['rate', '不良率'],
        ],
        draft.statMetric,
        (v) => (draft.statMetric = v),
      ),
      select(
        '分类显示',
        [
          ['5', 'Top 5＋其他'],
          ['10', 'Top 10＋其他'],
          ['20', 'Top 20＋其他'],
          ['50', 'Top 50＋其他'],
          ['0', '全部'],
        ],
        String(q.topN),
        (v) => (q.topN = Number(v)),
      ),
      select(
        '宽度',
        [
          ['1', '半宽'],
          ['2', '整行'],
        ],
        String(draft.width),
        (v) => (draft.width = Number(v)),
      ),
      field('内容区最大高度（px，200–900）', draft.height, (v) => (draft.height = v), 'number'),
      select('独立范围的时间', ranges, q.range, (v) => (q.range = v)),
      field(
        '独立开始日期',
        q.start,
        (v) => {
          q.start = v;
          q.range = 'custom';
        },
        'date',
      ),
      field(
        '独立结束日期',
        q.end,
        (v) => {
          q.end = v;
          q.range = 'custom';
        },
        'date',
      ),
      check('显示本板块', draft.enabled, (v) => (draft.enabled = v)),
    );
    function showFilters() {
      chips.replaceChildren();
      q.filters.forEach((f, i) =>
        chips.append(
          btn(
            window.BIFieldLabels.field(
              { grouping: getGrouping() },
              f.field,
              M.labels[f.field] || s.columns.find((c) => c.id === f.field)?.label,
            ) +
              ' ' +
              f.values.join('、') +
              ' ×',
            () => {
              q.filters.splice(i, 1);
              showFilters();
            },
          ),
        ),
      );
    }
    const tools = el('div', undefined, 'lab-toolbar');
    tools.append(
      btn('添加本板块筛选', () =>
        openFilter({
          query: () => q,
          onApply: (f) => {
            q.filters.push(f);
            showFilters();
          },
        }),
      ),
      btn('取消', () => d.close()),
      btn(
        '完成并自动保存',
        async () => {
          try {
            if (source()?.id !== s.id || getPeriod() !== period || ensure().id !== schemeId)
              throw Error('分析范围已经变化，请重新打开编辑。');
            draft.query = P.portableQuery(q, s);
            P.panel(draft);
            mutate(() => {
              const target = current(),
                index = target.panels.findIndex((p) => p.id === panelId);
              if (index < 0) target.panels.push(draft);
              else target.panels[index] = draft;
            });
            d.close();
            await refresh(false);
          } catch (e) {
            error.textContent = e.message;
          }
        },
        true,
      ),
    );
    explain();
    showFilters();
    d.append(scopeInfo, form, chips, error, tools);
  }
  function move(id, delta) {
    const list = current().panels,
      index = list.findIndex((p) => p.id === id),
      target = index + delta;
    if (target < 0 || target >= list.length) return;
    mutate(() => {
      [list[index], list[target]] = [list[target], list[index]];
    });
    return refresh(false);
  }
  function remove(id) {
    const d = dialog('删除这个板块？');
    d.append(
      el('p', '只移除当前方案的板块，原始明细不会删除。'),
      btn('取消', () => d.close()),
      btn('删除板块', async () => {
        mutate(() => {
          current().panels = current().panels.filter((p) => p.id !== id);
        });
        d.close();
        await refresh(false);
      }),
    );
  }
  function duplicate(id) {
    mutate(() => {
      const list = current().panels,
        i = list.findIndex((p) => p.id === id),
        p = structuredClone(list[i]);
      p.id = uuid();
      p.title = p.title.slice(0, 112) + ' 副本';
      list.splice(i + 1, 0, p);
    });
    return refresh(false);
  }
  async function share() {
    const selected = ensure();
    const r = await call('panelsExport', {
      sourceId: source().id,
      schemeId: selected.id,
      panelState: state,
    });
    if (!r.cancelled)
      notice('方案已导出：' + r.file + '。包含配置和筛选，不含业务明细、下载路径或密钥。');
  }
  async function importScheme() {
    await flush();
    const token = lifecycle;
    const r = await call('panelsImport', { sourceId: source().id, signature });
    if (r.cancelled || token !== lifecycle) return;
    apply(r);
    await refresh(true);
    notice('已读取方案“' + r.imported + '”，原方案仍保留。');
  }
  function manage() {
    const active = ensure();
    if (!active) throw Error('请先选择数据源。');
    const d = dialog('管理分析方案'),
      error = el('p', undefined, 'lab-error');
    let name = active.name;
    const tools = el('div', undefined, 'lab-toolbar');
    tools.append(
      btn('更改名称', async () => {
        try {
          mutate(() => (ensure().name = name));
          d.close();
          await refresh(false);
        } catch (e) {
          error.textContent = e.message;
        }
      }),
      btn('复制当前方案', async () => {
        try {
          mutate(() => {
            const slot = state.sources[source().id],
              s = structuredClone(ensure());
            s.id = uuid();
            s.name = name.trim().slice(0, 70) + ' 副本';
            slot.schemes.push(s);
            slot.active = s.id;
          });
          d.close();
          await refresh(false);
        } catch (e) {
          error.textContent = e.message;
        }
      }),
      btn('新建空白方案', async () => {
        try {
          mutate(() => {
            const slot = state.sources[source().id],
              s = structuredClone(ensure());
            s.id = uuid();
            s.name = name.trim() || '新方案';
            Object.values(s.periods).forEach((v) => (v.panels = []));
            slot.schemes.push(s);
            slot.active = s.id;
          });
          d.close();
          await refresh(false);
        } catch (e) {
          error.textContent = e.message;
        }
      }),
      btn('分享当前方案', share),
      btn('读取方案文件', async () => {
        await importScheme();
        d.close();
      }),
    );
    tools.append(
      btn('删除当前方案', () => {
        if (state.sources[source().id].schemes.length === 1) {
          error.textContent = '至少保留一个方案；可新建空白方案后删除。';
          return;
        }
        const confirm = dialog('删除当前分析方案？');
        confirm.append(
          el('p', '会移除这个方案的配置，业务明细不变。'),
          btn('取消', () => confirm.close()),
          btn('确认删除', async () => {
            mutate(() => {
              const slot = state.sources[source().id];
              slot.schemes = slot.schemes.filter((s) => s.id !== slot.active);
              slot.active = slot.schemes[0].id;
            });
            confirm.close();
            d.close();
            await refresh(true);
          }),
        );
      }),
    );
    d.append(
      field('方案名称', name, (v) => (name = v)),
      check('显示页面四项汇总指标', active.showSummary, (v) => {
        mutate(() => (ensure().showSummary = v));
      }),
      tools,
      el('p', '配置位置：' + (file || '示例模式仅会话记忆'), 'lab-config-path'),
      el(
        'p',
        '可以替换该设置JSON，页面会自动重新读取；上次有效版本保存在同名 .last-good 文件。分享文件包含筛选值，请按内部资料管理。',
        'lab-muted',
      ),
      btn('重新读取配置', async () => {
        await load();
        d.close();
        await refresh(true);
      }),
      error,
      btn('完成', async () => {
        d.close();
        await refresh(false);
      }),
    );
  }
  function toolbar(body) {
    const s = ensure();
    if (!s) return;
    const bar = el('div', undefined, 'lab-panel-toolbar');
    bar.append(
      select(
        '分析方案',
        state.sources[source().id].schemes.map((s) => [s.id, s.name]),
        s.id,
        async (id) => {
          mutate(() => (state.sources[source().id].active = id));
          await refresh(true);
        },
      ),
      btn('新增板块', () => edit(), true),
      btn('管理与分享', manage),
    );
    const hint = el('span', undefined, 'lab-muted');
    hint.id = 'labPanelsSaved';
    bar.append(hint);
    body.append(bar);
    status();
  }
  function draw(node, tools, p, data, q) {
    if (data.empty) {
      node.append(el('p', data.message || '当前条件没有数据。', 'lab-empty'));
      return;
    }
    node.append(
      el(
        'p',
        `${data.range.start} 至 ${data.range.end} · ${data.recordCount}条 · ${p.scope === 'independent' ? '独立范围' : p.scope === 'filters' ? '页面条件＋本板块条件' : '跟随页面'}`,
        'lab-muted',
      ),
    );
    const content = el('div', undefined, 'lab-panel-content');
    content.setAttribute('style', `max-height:${p.height}px;overflow:auto`);
    if (p.kind === 'metric') {
      const value = {
        records: data.recordCount,
        quantity: data.quantity,
        production: data.production,
        rate: data.rate.value,
      }[p.statMetric];
      content.append(
        el('strong', p.statMetric === 'rate' ? pct(value) : fmt(value), 'lab-panel-number'),
      );
      content.append(
        el(
          'p',
          p.statMetric === 'rate'
            ? data.rate.reason || '对应范围不良件数 ÷ 匹配产量'
            : p.statMetric === 'quantity'
              ? data.metricLabel
              : p.statMetric === 'production'
                ? '匹配产量'
                : '记录条数',
          'lab-muted',
        ),
      );
    } else if (p.kind === 'table') {
      const table = el('table'),
        head = el('tr');
      ['分类', data.metricLabel, '不良率', '记录条数'].forEach((v) => head.append(el('th', v)));
      table.append(head);
      data.points.forEach((point) => {
        const row = el('tr');
        [point.label, fmt(point.quantity), pct(point.rate), fmt(point.rows)].forEach((v) =>
          row.append(el('td', v)),
        );
        table.append(row);
      });
      content.append(table);
    } else
      drawChart(content, {
        title: p.title || '分析',
        type: p.kind === 'trend' ? 'line' : q.chartType,
        metric: q.metric,
        data: (p.kind === 'trend' ? data.trend : data.points).map((point) => ({
          label: point.label,
          value: point[q.metric],
        })),
      });
    node.append(content);
    if (['trend', 'chart'].includes(p.kind) && report)
      tools.append(btn('将本板块加入报告', () => report(p, q, data)));
  }
  function mount(body, base) {
    const view = current();
    if (!view) return;
    const own = ++mounting,
      sourceId = source().id,
      s = source(),
      period = getPeriod(),
      baseQuery = query();
    const grid = el('div', undefined, 'lab-custom-panels');
    body.append(grid);
    if (!view.panels.length)
      grid.append(el('p', '在「详细配置 → 分析方案与板块」中新增板块，可添加图表、数据表或指标。', 'lab-empty'));
    const work = [];
    for (const p of view.panels) {
      const node = el('section', undefined, 'lab-panel lab-custom-panel');
      node.setAttribute('data-panel-id', p.id);
      node.setAttribute('data-width', String(p.width));
      const head = el('div', undefined, 'lab-custom-panel-head');
      head.append(el('h3', p.title || '分析板块'));
      const menu = el('details', undefined, 'lab-options lab-panel-menu');
      const tools = el('div', undefined, 'lab-panel-actions');
      for (const [label, fn] of [
        ['编辑', () => edit(p.id)],
        ['复制', () => duplicate(p.id)],
        ['前移', () => move(p.id, -1)],
        ['后移', () => move(p.id, 1)],
        ['删除', () => remove(p.id)],
      ])
        tools.append(btn(label, fn));
      menu.append(el('summary', '板块操作'), tools);
      head.append(menu);
      node.append(head);
      grid.append(node);
      if (!p.enabled) {
        node.append(el('p', '此板块已隐藏，编辑后可重新显示。', 'lab-muted'));
        continue;
      }
      try {
        const q = P.effective(p, baseQuery, s);
        if (JSON.stringify(q) === JSON.stringify(baseQuery)) draw(node, tools, p, base, q);
        else {
          const loading = el('p', '正在计算本板块…', 'lab-muted');
          node.append(loading);
          work.push({ p, node, tools, q, loading });
        }
      } catch (e) {
        node.append(el('p', e.message, 'lab-error'));
      }
    }
    (async () => {
      for (const task of work) {
        if (own !== mounting || !task.node.isConnected) return;
        try {
          const data = await call('analyze', {
            sourceId,
            productionId: getConfig().productionSource,
            period,
            query: task.q,
            page: 1,
          });
          if (own !== mounting || !task.node.isConnected) return;
          task.loading.remove();
          draw(task.node, task.tools, task.p, data, task.q);
        } catch (e) {
          if (own === mounting && task.node.isConnected) task.loading.textContent = e.message;
        }
      }
    })();
  }
  async function poll() {
    if (!state || generation !== saved || writing) return;
    const token = lifecycle,
      r = await call('panelsLoad');
    if (token !== lifecycle || generation !== saved || writing) return;
    if (r.warning) {
      warning = r.warning;
      writable = false;
      status();
      return;
    }
    if (r.signature !== signature) {
      apply(r);
      await refresh(true);
      notice('已应用外部替换的分析配置。');
    } else {
      writable = r.writable;
      warning = '';
      status();
    }
  }
  return Object.freeze({
    load,
    flush,
    query,
    setQuery,
    toolbar,
    mount,
    poll,
    assertValid() {
      query();
      if (bindingError) throw Error(bindingError);
    },
    showSummary: () => ensure()?.showSummary !== false,
    invalidate: () => {
      mounting++;
    },
    clear() {
      lifecycle++;
      mounting++;
      clearTimeout(timer);
      state = null;
      signature = '';
      generation = saved = 0;
      writing = null;
      warning = '';
      bindingError = '';
    },
  });
};
