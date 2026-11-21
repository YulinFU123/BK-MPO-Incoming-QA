'use strict';
document.getElementById('run').onclick = async () => {
  const frame = document.getElementById('app'),
    doc = () => frame.contentDocument,
    w = () => frame.contentWindow,
    $ = (id) => doc().getElementById(id),
    results = [];
  const assert = (b, m) => {
    if (!b) throw Error(m);
  };
  const wait = async (fn, label) => {
    const end = performance.now() + 15000;
    while (performance.now() < end) {
      try {
        if (fn()) return;
      } catch {}
      await new Promise((r) => setTimeout(r, 40));
    }
    throw Error(label + '超时');
  };
  const ready = () =>
    wait(
      () =>
        doc().querySelectorAll('[data-home-metric]').length === 5 &&
        $('homeStudio').getAttribute('aria-busy') === 'false',
      '首页就绪',
    );
  const clickText = (root, label) => {
    const hits = [...root.querySelectorAll('button')].filter((b) => b.textContent.trim() === label);
    assert(hits.length === 1, label + '按钮数量' + hits.length);
    hits[0].click();
  };
  const option = (label, value) => {
    const e = doc().querySelector('select[aria-label="' + label + '"]');
    assert(e, '未找到' + label);
    e.value = value;
    e.dispatchEvent(new (w().Event)('change', { bubbles: true }));
  };
  const api = async (name, input) => {
    const r = await w().workbench[name](input);
    if (!r.ok) throw Error(r.error.message);
    return r.value;
  };
  const check = async (name, fn) => {
    try {
      await fn();
      results.push({ name, status: 'passed' });
    } catch (e) {
      results.push({ name, status: 'failed', message: String(e) });
    }
    document.getElementById('status').textContent = results.length + '项已执行';
  };
  await check('首页真实加载，固定导航、标签、筛选、五指标、右侧设置齐全', async () => {
    await wait(() => $('openDemo'), '加载');
    const status = await api('status');
    if (!status.unlocked) $('openDemo').click();
    await ready();
    assert($('hsNavigation').querySelector('.hs-nav-utilities:not([open])'), '工具设置应默认折叠');
    assert(!doc().querySelector('[role=tablist]'), '单方案不应重复显示标签栏');
    const menu = $('hsMoreActions'), trigger = $('hsMore').querySelector('[popovertarget]');
    assert(menu && !menu.matches(':popover-open') && menu.querySelector('.hs-new-tab'), '低频功能入口缺失');
    const bounds = () => ['.hs-heading', '.hs-filter-panel', '#hsMetrics', '#hsChartGrid'].map(selector => {
      const { x, y, width, height } = doc().querySelector(selector).getBoundingClientRect();
      return [x, y, width, height];
    });
    const before = JSON.stringify(bounds());
    trigger.click();
    assert(menu.matches(':popover-open') && before === JSON.stringify(bounds()), '打开更多操作挤动页面');
    trigger.click();
    assert(!menu.matches(':popover-open') && before === JSON.stringify(bounds()), '收起更多操作挤动页面');
    assert(!$('hsMetrics').closest('details'), '关键指标不应折叠');
    $('hsFilterToggle').click();
    assert(doc().querySelector('.hs-settings'), '无右侧设置');
  });
  await check('五指标与实际接口一致，不从异常条数推算不良件数', async () => {
    const start = doc().querySelector('[aria-label="首页开始日期"]').value,
      end = doc().querySelector('[aria-label="首页结束日期"]').value,
      catalog = await api('catalog');
    const r = await api('homeReport', {
      start,
      end,
      datasetId: catalog.datasets[0].id,
      grain: 'week',
    });
    for (const [key, value] of [
      ['records', r.recordCount],
      ['defective', r.quality.totals.defectiveUnits],
      ['pending', r.pending],
      ['overdue', r.overdue],
    ])
      assert(
        doc().querySelector('[data-home-metric=' + key + '] strong').textContent ===
          value.toLocaleString('zh-CN'),
        key + '不一致',
      );
  });
  await check('趋势每个数据点标数，包含双轴刻度与水平网格', async () => {
    const p = $('hsPanel-trend');
    assert(p.querySelectorAll('.home-grid-line').length === 5, '网格不足');
    assert(p.querySelectorAll('rect[role=button]').length > 0, '无条数数据');
    assert(p.querySelectorAll('circle[role=button]').length > 0, '无件数数据');
    assert(p.querySelectorAll('.home-value').length > 4, '点值不足');
  });
  await check('趋势整行、放大后仍可打开右侧明细', async () => {
    const panel = doc().querySelector('[data-home-panel=trend]');
    const grid = $('hsChartGrid');
    assert(Math.abs(panel.getBoundingClientRect().width - grid.getBoundingClientRect().width) < 3, '趋势未占整行');
    const height = Number($('hsPanel-trend').querySelector('svg').getAttribute('height'));
    clickText(panel, '放大');
    const zoom = $('hsChartZoom');
    assert(zoom.open && Number(zoom.querySelector('svg').getAttribute('height')) > height, '放大后图表不够高');
    const point = zoom.querySelector('circle[role=button]');
    point.dispatchEvent(new (w().MouseEvent)('click', { bubbles: true }));
    await wait(() => $('hsDetail').open && $('hsDetail').querySelector('tbody tr'), '放大趋势点对应的明细');
    assert($('hsDetail').classList.contains('hs-detail-side'), '明细没有在右侧打开');
    clickText($('hsDetail'), '关闭');
    assert(zoom.open, '关闭明细不应关闭大图');
    clickText(zoom, '关闭大图');
  });
  await check('分类图和条形图可打开精确对应明细', async () => {
    const b = $('hsPanel-issues').querySelector('button');
    const label = b.querySelector('span').textContent;
    b.click();
    await wait(() => $('hsDetail').open && $('hsDetail').querySelector('tbody tr'), '分类明细');
    assert(
      [...$('hsDetail').querySelectorAll('tbody tr')].every((tr) => tr.textContent.includes(label)),
      '分类串入其他值',
    );
    clickText($('hsDetail'), '关闭');
  });
  await check('未关闭卡片在服务端过滤后分页', async () => {
    doc().querySelector('[data-home-metric=pending]').click();
    await wait(() => $('hsDetail').querySelector('tbody tr'), '待办明细');
    assert(
      ![...$('hsDetail').querySelectorAll('tbody tr')].some((tr) =>
        tr.textContent.includes('已关闭'),
      ),
      '含已关闭记录',
    );
    clickText($('hsDetail'), '关闭');
  });
  await check('新建分析工作区只复制配置，源记录数不变', async () => {
    const before = await api('homeReport', {
      start: '2026-09-30',
      end: '2026-10-29',
      grain: 'week',
    });
    $('hsMore').querySelector('[popovertarget]').click();
    clickText($('homeStudio'), '新建分析方案');
    doc().querySelector('[aria-label="新分析方案名称"]').value = '第二分析视图';
    clickText($('hsDetail'), '创建工作区');
    await ready();
    assert(doc().querySelectorAll('[role=tab]').length === 2, '标签未新增');
    const after = await api('homeReport', {
      start: '2026-09-30',
      end: '2026-10-29',
      grain: 'week',
    });
    assert(before.total === after.total, '复制了正式记录');
  });
  await check('不同标签分别保存筛选和图表显示', async () => {
    option('工序', '装管');
    await ready();
    const box = doc().querySelector('[aria-label="显示异常类型分布"]');
    box.checked = false;
    box.dispatchEvent(new (w().Event)('change', { bubbles: true }));
    assert(!doc().querySelector('[data-home-panel=issues]'), '隐藏无效');
    doc().querySelector('[data-home-tab=overview]').click();
    await ready();
    assert(doc().querySelector('select[aria-label="工序"]').value === '', '筛选串到原标签');
    assert(doc().querySelector('[data-home-panel=issues]'), '图表串到原标签');
    [...doc().querySelectorAll('[role=tab]')]
      .find((x) => x.textContent.includes('第二分析视图'))
      .click();
    await ready();
    assert(doc().querySelector('select[aria-label="工序"]').value === '装管', '筛选未恢复');
    assert(!doc().querySelector('[data-home-panel=issues]'), '图表未恢复');
  });
  await check('所有明细表头都有可用排序入口', async () => {
    const headers = $('hsPanel-records').querySelectorAll('th button');
    assert(headers.length === 9, '排序列缺失');
    headers[2].click();
    await ready();
    assert($('hsPanel-records').querySelector('tbody'), '排序后明细丢失');
  });
  await check('关闭标签不删除数据，可从设置重新打开', async () => {
    const close = doc().querySelector('[aria-label="关闭标签 第二分析视图"]');
    close.click();
    await ready();
    assert(doc().querySelectorAll('[role=tab]').length === 0, '单方案仍显示标签栏');
    const settings = doc().querySelector('.hs-settings');
    clickText(settings, '工作区');
    clickText(doc().querySelector('.hs-settings'), '第二分析视图');
    await ready();
    assert(doc().querySelectorAll('[role=tab]').length === 2, '无法重新打开');
  });
  await check('单独保存后重新加载恢复标签与布局', async () => {
    await w().flushModuleState();
    frame.src = '../app/index.html?home-check=reload';
    await wait(() => doc().querySelector('[data-home-metric]'), '重新加载');
    await ready();
    assert(doc().querySelectorAll('[role=tab]').length === 2, '标签丢失');
    assert(!doc().querySelector('[data-home-panel=issues]'), '布局丢失');
  });
  await check('搜索SN时数量口径不适用，不能保留无关总数', async () => {
    const sn = $('hsPanel-records').querySelector('tbody tr td:nth-child(3)').textContent;
    $('hsSearch').value = sn;
    $('hsSearch').dispatchEvent(new (w().Event)('input', { bubbles: true }));
    await wait(
      () => doc().querySelector('[data-home-metric=records] strong').textContent === '1',
      'SN搜索',
    );
    assert(
      doc().querySelector('[data-home-metric=defective] strong').textContent === '—',
      '无关数量未清除',
    );
    $('hsSearch').value = '';
    $('hsSearch').dispatchEvent(new (w().Event)('input', { bubbles: true }));
    await ready();
  });
  await check('锁定清空首页统计、标签和明细', async () => {
    $('lockButton').click();
    await wait(() => $('lockView') && !$('lockView').hidden, '锁定');
    assert(!$('homeStudio').textContent.includes('第二分析视图'), '标签文本未清空');
    assert(!$('hsDetail').open, '明细未关闭');
  });
  const out = {
    pass: results.filter((r) => r.status === 'passed').length,
    fail: results.filter((r) => r.status === 'failed').length,
    results,
  };
  document.getElementById('results').textContent = JSON.stringify(out, null, 2);
  document.getElementById('status').textContent = '通过 ' + out.pass + ' / 失败 ' + out.fail;
};
