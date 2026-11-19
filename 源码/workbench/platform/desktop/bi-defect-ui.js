'use strict';
// One exact selection drives analysis, row details, workbook and PNG exports.
(() => {
  const model = window.DefectSelection;
  DAILY_DEFAULT_QUERY.items = [];
  const M = {
    loaded: false,
    attempted: false,
    loading: false,
    revision: 0,
    data: { items: [] },
    dirty: 0,
    saved: 0,
    saving: null,
    timer: null,
    error: '',
  };
  async function memory(action, extra = {}) {
    const response = await window.bi.request({
      route: '/fusion/defect-memory',
      body: { action, ...extra },
    });
    if (!response.ok)
      throw Error(
        typeof response.error === 'string'
          ? response.error
          : response.error?.message || '不良项配置未保存。',
      );
    return response.value;
  }
  function status() {
    const target = document.getElementById('daily-defect-status');
    if (target)
      target.textContent =
        M.error ||
        (!M.loaded
          ? '正在恢复当前工作区的不良项选择…'
          : M.saved !== M.dirty
            ? '正在保存选择…'
            : '不良项选择已独立记忆；清空表示不限。');
  }
  async function save() {
    clearTimeout(M.timer);
    if (!M.loaded) throw Error('不良项配置尚未读取，请先重试读取或重置。');
    if (M.saving) return M.saving;
    M.saving = (async () => {
      while (M.saved !== M.dirty) {
        const seq = M.dirty,
          data = model.state(M.data);
        try {
          const row = await memory('save', { data, expectedRevision: M.revision });
          M.revision = row.revision;
          M.saved = seq;
          M.error = '';
        } catch (error) {
          M.error = '选择未保存：' + error.message;
          throw error;
        }
      }
    })().finally(() => {
      M.saving = null;
      status();
    });
    return M.saving;
  }
  function changed() {
    M.dirty++;
    M.error = '';
    clearTimeout(M.timer);
    M.timer = setTimeout(() => save().catch(() => {}), 350);
    status();
  }
  async function load() {
    if (M.loading) return M.loadingPromise;
    M.attempted = true;
    M.loading = true;
    M.loadingPromise = (async () => {
      try {
        const row = await memory('read');
        M.revision = row.revision;
        if (row.corrupt) throw Error('配置损坏，请重置本模块或从配置备份恢复。');
        const oldItems = model.normalize(D.q.items || []);
        M.data = model.state(row.data);
        M.loaded = true;
        M.error = '';
        if (row.revision === 0 && oldItems.length) {
          M.data.items = oldItems;
          changed();
        }
        D.q.items = [...M.data.items];
        ddirty();
      } catch (error) {
        M.error = error.message;
      } finally {
        M.loading = false;
        if (S.page === 'daily') render();
      }
    })();
    return M.loadingPromise;
  }
  function sync() {
    D.q.items = model.normalize(D.q.items || []);
    if (M.loaded && JSON.stringify(D.q.items) !== JSON.stringify(M.data.items)) {
      M.data = { items: [...D.q.items] };
      changed();
    }
  }
  const originalFilters = dailyFilters;
  dailyFilters = function () {
    const box = originalFilters();
    if (!M.attempted) queueMicrotask(load);
    const panel = h(
      'section',
      { class: 'daily-defect-filter', 'aria-label': '指定不良项分析与导出' },
      h('h3', {}, '指定不良项'),
      h(
        'p',
        { class: 'hint' },
        '可只选“装管反”，或多选几个不良项。选项取并集，再与工序、日期等条件取交集；仅影响本地分析和导出。',
      ),
    );
    if (M.loaded) {
      sync();
      panel.append(
        field(
          '不良项（搜索、勾选或输入完整名称）',
          searchChoices(
            D.result?.options?.item || [],
            D.q.items,
            () => {
              sync();
              ddirty();
              status();
              const selected = document.getElementById('daily-defect-selected');
              if (selected)
                selected.textContent =
                  '当前选择：' + (D.q.items.join('、') || '不限（全部不良项）');
            },
            '搜索不良项，例如装管反',
          ),
        ),
      );
      panel.append(
        h(
          'p',
          { id: 'daily-defect-selected' },
          '当前选择：' + (D.q.items.join('、') || '不限（全部不良项）'),
        ),
        dbtn('应用不良项并更新图表', () => dailyAnalyze()),
        dbtn('清空不良项限制', () => {
          D.q.items = [];
          sync();
          ddirty();
          render();
        }),
      );
    } else panel.append(dbtn('重新读取不良项选择', load));
    panel.append(
      h(
        'p',
        { id: 'daily-defect-status', class: 'hint', role: 'status' },
        M.error || '正在恢复选择…',
      ),
      dbtn('重置本模块不良项选择', async () => {
        if (!confirm('清空当前工作区的不良项限制？原始记录、其他筛选和模板保留。')) return;
        clearTimeout(M.timer);
        if (M.saving) await M.saving;
        const row = await memory('reset', { expectedRevision: M.revision });
        M.data = model.state(row.data);
        M.revision = row.revision;
        M.loaded = true;
        M.dirty = M.saved = 0;
        M.error = '';
        D.q.items = [];
        ddirty();
        render();
      }),
    );
    box.append(panel);
    queueMicrotask(status);
    return box;
  };
  const originalAnalyze = dailyAnalyze;
  dailyAnalyze = async function (query = null) {
    if (!M.loaded) await load();
    if (!M.loaded) {
      toast('请先重试读取不良项选择。', 'bad');
      return null;
    }
    if (query) {
      query = {
        ...query,
        items: model.normalize(Object.hasOwn(query, 'items') ? query.items : D.q.items || []),
      };
      D.q.items = [...query.items];
    }
    sync();
    await save();
    return originalAnalyze(query);
  };
  const originalExport = dailyExport;
  dailyExport = async function () {
    if (!M.loaded) {
      toast('不良项选择尚未恢复，未导出。', 'bad');
      return { ok: false };
    }
    sync();
    await save();
    return originalExport();
  };
  const originalSvg = dailyChartSvg;
  dailyChartSvg = function (title, rows, result, query, maximum, trend) {
    const svg = originalSvg(title, rows, result, query, maximum, trend);
    const names = model.normalize(query.items || []),
      full = '不良项：' + (names.join('、') || '不限（全部不良项）');
    const brief =
      full.length > 78 ? full.slice(0, 60) + `…（共${names.length}项，完整条件见Excel）` : full;
    svg.append(
      svgEl(
        'text',
        { x: 30, y: Number(svg.getAttribute('height')) - 65, 'font-size': 13, fill: '#243c50' },
        brief,
      ),
    );
    svg.append(svgEl('title', {}, full));
    return svg;
  };
  // Existing trend engine already supports items: make its hidden filter visible.
  const originalTrends = PAGES.trends;
  PAGES.trends = (element) => {
    originalTrends(element);
    const q = trendQuery();
    const panel = h(
      'section',
      { class: 'daily-defect-filter', 'aria-label': '趋势不良项筛选' },
      h('h3', {}, '指定不良项分析'),
      field(
        '不良项（清空表示不限）',
        searchChoices(S.scan?.items || [], q.items, dirtyTrend, '搜索不良项，例如装管反'),
      ),
      dbtn('按所选不良项更新趋势', loadTrend),
    );
    const card = [...element.querySelectorAll('.card')].find(
      (node) => node.querySelector('h3')?.textContent === '分析范围',
    );
    if (card) {
      for (const label of card.querySelectorAll('label')) {
        if (label.textContent === '不良项目') label.parentElement?.setAttribute('hidden', '');
      }
      card.append(panel);
    }
  };
  window.DailyDefectMemory = {
    flush: async () => {
      if (M.loading) await M.loadingPromise;
      if (M.loaded) {
        sync();
        await save();
      }
    },
  };
  window.addEventListener('pagehide', () => clearTimeout(M.timer));
})();
