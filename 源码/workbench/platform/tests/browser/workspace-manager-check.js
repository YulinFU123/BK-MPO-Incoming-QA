'use strict';
(async () => {
  const frame = document.getElementById('surface'),
    out = document.getElementById('results'),
    results = [];
  const wait = async (fn) => {
    const limit = Date.now() + 15000;
    while (Date.now() < limit) {
      if (fn()) return;
      await new Promise((r) => setTimeout(r, 70));
    }
    throw Error('界面等待超时');
  };
  const assert = (v, msg) => {
    if (!v) throw Error(msg);
  };
  const check = async (name, fn) => {
    const li = document.createElement('li');
    try {
      await fn();
      li.textContent = '通过：' + name;
      results.push({ name, passed: true });
    } catch (e) {
      li.textContent = '失败：' + name + '：' + e.message;
      results.push({ name, passed: false, error: e.message });
    }
    out.append(li);
  };
  await wait(
    () =>
      frame.contentDocument?.getElementById('workspaceManager') &&
      !frame.contentDocument.getElementById('workspaceManager').hidden,
  );
  const w = frame.contentWindow,
    d = frame.contentDocument,
    api = async (n, v) => {
      const r = await w.workbench[n](v);
      if (!r.ok) throw Error(r.error.message);
      return r.value;
    };
  await check('启动直接进入工作区管理，没有密码或文件创建前置页', () => {
    assert(!d.getElementById('workspaceManager').hidden, '管理首页不可见');
    assert(d.querySelector('.app-shell').hidden, '旧前置页仍可见');
  });
  await check('左侧卡片列表、右侧详情与新建入口完整', () => {
    assert(d.querySelector('.wm-library'), '缺左栏');
    assert(d.getElementById('wmDetail'), '缺右栏');
    assert(d.querySelector('.wm-header button'), '缺新建');
  });
  await check('新建窗口仅填写业务信息', () => {
    d.querySelector('.wm-header .primary').click();
    assert(d.querySelector('.wm-dialog[open]'), '对话框未打开');
    assert(!d.querySelector('.wm-dialog input[type=password]'), '不应出现密码');
  });
  const name = '界面合成测试-' + Date.now();
  let a, b;
  await check('实际新建工作区并显示卡片', async () => {
    const f = d.querySelector('.wm-dialog form');
    f.querySelector('input').value = name;
    const source = f.querySelector('[aria-label="主要数据来源（必选）"]');
    source.value = 'records'; source.dispatchEvent(new w.Event('change'));
    f.requestSubmit();
    await wait(
      () =>
        !d.querySelector('.wm-dialog[open]') &&
        [...d.querySelectorAll('.wm-card-name')].some((e) => e.textContent.includes(name)),
    );
    a = (await api('managedList')).items.find((x) => x.name === name);
    assert(a, '工作区未持久化');
  });
  await check('同名工作区拒绝且不产生多余记录', async () => {
    const r = await w.workbench.managedCreate({ name });
    assert(!r.ok, '重复名称被接受');
  });
  await check('不同工作区数据文件与分析相互独立', async () => {
    b = await api('managedCreate', { name: name + '乙' });
    assert(a.id !== b.id, 'ID重复');
    assert((await api('managedReport', { id: b.id })).recordCount === 0, '新工作区应为空');
  });
  await check('图表周期与日期偏好分别记忆', async () => {
    await api('managedUpdate', { id: a.id, analysis: { range: '7', grain: 'day', datasetId: '' } });
    const list = await api('managedList');
    assert(list.items.find((x) => x.id === a.id).analysis.range === '7', '偏好丢失');
    assert(list.items.find((x) => x.id === b.id).analysis.range === '30', '配置串用');
  });
  await check('卡片与列表视图切换有反馈', async () => {
    const button = [...d.querySelectorAll('.wm-modes button')].find((x) =>
      x.textContent.includes('列表'),
    );
    button.click();
    await wait(() => d.getElementById('wmCards').classList.contains('is-list'));
  });
  await check('搜索不匹配内容显示明确空状态', () => {
    const i = d.querySelector('.wm-search');
    i.value = '不存在的工作区-UNMATCHED';
    i.dispatchEvent(new w.Event('input', { bubbles: true }));
    assert(d.querySelector('.wm-empty'), '无搜索空状态');
    i.value = '';
    i.dispatchEvent(new w.Event('input', { bubbles: true }));
  });
  await check('选择工作区后详情有真实指标、趋势与明细', async () => {
    const card = d.querySelector('[data-workspace-id="' + a.id + '"]');
    card.querySelector('.wm-card-name').click();
    await wait(() => d.querySelectorAll('.wm-metric').length === 4);
    assert(d.querySelector('.wm-preview-empty'), '空工作区应显示范围提示');
    assert(!d.querySelector('.wm-chart-grid') && !d.querySelector('.wm-recent table'), '空工作区不应渲染空图表');
  });
  await check('日期输入、字段、默认值和扫码入口均可发现', () => {
    assert(d.querySelectorAll('.wm-dates input[type=date]').length === 2, '日期输入缺失');
    assert(d.querySelectorAll('.wm-tabs [role=tab]').length === 6, '设置标签缺失');
  });
  await check('打开工作区不再要求密码，旧功能工作台可见', async () => {
    d.querySelector('.wm-detail-head .primary').click();
    await wait(
      () =>
        d.getElementById('workspaceManager').hidden && !d.getElementById('workspaceView').hidden,
    );
    const status = await api('status');
    assert(status.managedId === a.id, '打开错误工作区');
    assert(!d.getElementById('unlockForm').offsetWidth, '出现密码前置页');
  });
  const raw = async (name, input) => {
    const res = await fetch('../api/' + name, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-QA-Preview': '1' },
      body: JSON.stringify({ input }),
    });
    const r = await res.json();
    if (!r.ok) throw Error(r.error.message);
    return r.value;
  };
  await check('合成记录用于非空图表核对，正式数据从未访问', async () => {
    const range = await api('managedReport', { id: a.id }),
      day = range.scope.end,
      shift = (n) => {
        const d = new Date(day + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() + n);
        return d.toISOString().slice(0, 10);
      };
    const state = await raw('legacyBootstrap');
    state.records = [-29, -3, -1].map((offset, i) => ({
      id: 'ui-audit-' + i,
      templateId: state.activeTemplateId,
      createdAt: shift(offset) + 'T01:00:00Z',
      values: {
        sn: ['A001', 'B002', 'C003'][i],
        found_date: shift(offset),
        issue: '界面合成异常',
        process: '测试',
      },
    }));
    await raw('legacySave', state);
  });
  await check('管理页范围变化同时刷新卡片和右侧统计', async () => {
    d.getElementById('manageWorkspaces').click();
    await wait(
      () =>
        !d.getElementById('workspaceManager').hidden &&
        !d.getElementById('workspaceManager').hasAttribute('aria-busy'),
    );
    const range = d.querySelector('.wm-scope select[aria-label="快捷日期范围"]');
    range.value = '7'; range.dispatchEvent(new w.Event('change', { bubbles: true }));
    await wait(() => d.querySelector('.wm-metric strong')?.textContent === '2');
    assert(
      d.querySelector('[data-workspace-id="' + a.id + '"] .wm-card-metrics strong').textContent ===
        '2',
      '卡片仍是旧统计',
    );
    assert(d.querySelector('.wm-card-period'), '缺周期标注');
  });
  await check('非空环图总数和比例有效，无NaN', async () => {
    assert(d.querySelector('.wm-detail .home-donut-number')?.textContent === '2', '环图总数错误');
    for (const x of d.querySelectorAll('.wm-detail svg [stroke-dasharray]'))
      assert(!x.getAttribute('stroke-dasharray').includes('NaN'), '比例NaN');
  });
  await check('环图分类可查看对应记录', async () => {
    d.querySelector('.wm-detail .home-legend-item').click();
    await wait(() => d.querySelector('.wm-dialog[open] table'));
    assert(d.querySelectorAll('.wm-dialog[open] tbody tr').length === 2, '分类明细错误');
    d.querySelector('.wm-dialog[open] button').click();
  });
  await check('表头排序在周期刷新后保持方向与数据一致', async () => {
    d.querySelector('.wm-recent th button').click();
    await wait(() => !d.getElementById('workspaceManager').hasAttribute('aria-busy'));
    const grain = d.querySelector('.wm-scope select');
    grain.value = 'week';
    grain.dispatchEvent(new w.Event('change', { bubbles: true }));
    await wait(() => !d.getElementById('workspaceManager').hasAttribute('aria-busy'));
    assert(d.querySelector('.wm-recent th button').textContent.includes('↑'), '升序箭头丢失');
    assert(d.querySelector('.wm-recent tbody tr td').textContent === 'B002', '刷新后排序变了');
  });
  await check('重命名同步活动工作区标题', async () => {
    [...d.querySelectorAll('.wm-tabs button')].find((x) => x.textContent === '基本信息').click();
    const form = d.querySelector('.wm-form');
    form.querySelector('input').value = name + '已更名';
    form.requestSubmit();
    await wait(() => d.querySelector('.wm-detail-head h2').textContent.includes('已更名'));
    assert((await api('status')).workspaceName === name + '已更名', '活动标题未同步');
  });
  await check('从预览进入分析，范围和条数继承且保留原分析方案', async () => {
    d.querySelector('.wm-detail-head .primary').click();
    await wait(
      () =>
        d.getElementById('workspaceManager').hidden &&
        d.querySelector('[data-home-metric=records] strong')?.textContent === '2',
    );
    assert(d.querySelectorAll('[data-home-tab]').length >= 2, '原分析方案被覆盖');
  });
  await check('打开原记录模块时分组导航保持不变', async () => {
    const nav = d.getElementById('hsNavigation');
    [...nav.querySelectorAll('button')].find((x) => x.textContent.includes('记录查询')).click();
    await wait(() => !d.getElementById('legacyMount').hidden);
    assert(w.getComputedStyle(nav).display !== 'none', '导航切换后消失');
    assert(
      nav.querySelector('[aria-current=page]')?.textContent.includes('记录查询'),
      '当前导航未标记',
    );
  });
  window.workspaceManagerCheckResults = {
    results,
    passed: results.filter((x) => x.passed).length,
    total: results.length,
  };
})();
