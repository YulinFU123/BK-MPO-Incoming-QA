'use strict';
(() => {
  const frame = document.getElementById('testWorkspace'),
    doc = () => frame.contentDocument,
    $ = (id) => doc().getElementById(id),
    win = () => frame.contentWindow;
  const results = [];
  const assert = (x, m) => {
    if (!x) throw Error(m);
  };
  async function wait(fn, name) {
    const end = performance.now() + 12000;
    while (performance.now() < end) {
      try {
        if (fn()) return;
      } catch {}
      await new Promise((r) => requestAnimationFrame(r));
    }
    throw Error(name + '超时；' + $('toastRegion')?.textContent);
  }
  async function check(name, fn) {
    try {
      await fn();
      results.push({ name, status: 'passed' });
    } catch (e) {
      results.push({ name, status: 'failed', message: e.message });
    }
    document.getElementById('stateSummary').textContent = results.length + '项已执行';
  }
  async function api(name, input) {
    const r = await win().workbench[name](input);
    if (!r.ok) throw Error(r.error.message);
    return r.value;
  }
  const A = { scope: 'module', module: 'analysis' },
    Q = { scope: 'module', module: 'query' },
    G = { scope: 'global', module: 'shell' };
  async function change(id, value) {
    $(id).value = value;
    $(id).dispatchEvent(new (win().Event)('input', { bubbles: true }));
    $(id).dispatchEvent(new (win().Event)('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    await win().flushModuleState();
  }
  async function click(selector) {
    const b = doc().querySelector(selector);
    assert(b, selector + '不存在');
    b.click();
    await new Promise((r) => setTimeout(r, 60));
  }
  async function route(id) {
    if (['home', 'data-center', 'analysis-hub'].includes(id)) await click(`[data-view="${id}"]`);
    else {
      await route(id === 'overview' ? 'analysis-hub' : 'data-center');
      await click(`[data-destination="${id}"]`);
    }
    await wait(() => doc().querySelector(`[data-page="${id}"]`)?.hidden === false, id);
  }
  async function memory() {
    if (!$('memoryDialog').open) $('openMemory').click();
    await wait(
      () =>
        $('memoryDialog').open &&
        $('memoryRevision').textContent.length &&
        !$('memoryDialog').hasAttribute('aria-busy'),
      '配置面板',
    );
  }
  async function closeMemory() {
    $('memoryClose').click();
    await wait(() => !$('memoryDialog').open, '关闭面板');
  }
  async function reloaded() {
    const loaded = new Promise((r) => frame.addEventListener('load', r, { once: true }));
    win().location.reload();
    await loaded;
    await wait(
      () =>
        !$('workspaceView').hidden &&
        !$('openFunctions').disabled &&
        $('moduleSaveStatus').textContent === '配置已同步',
      '重新加载恢复',
    );
  }
  document.getElementById('runState').onclick = async () => {
    results.length = 0;
    document.getElementById('runState').disabled = true;
    await wait(() => $('openDemo') && $('moduleSaveStatus').textContent !== '正在读取配置', '启动');
    if (!$('workspaceView').hidden) {
      await wait(() => !$('lockButton').disabled, '示例锁定入口');
      $('lockButton').click();
      await wait(() => $('workspaceView').hidden, '关闭上一轮示例');
    }
    if ($('workspaceView').hidden) {
      $('openDemo').click();
      await wait(() => !$('workspaceView').hidden, '示例打开');
    }
    await wait(
      () => !$('openFunctions').disabled && !doc().body.hasAttribute('aria-busy'),
      '配置恢复及页面初始化完成',
    );
    await check('真实页面已连接统一配置接口', async () => {
      assert((await api('checkModuleState')).integrity === 'ok', '数据库检查失败');
    });
    await check('查询设置自动保存，序号与排序继续可用', async () => {
      await route('data');
      await change('pageSize', '25');
      await click('[data-source="observations"]');
      await win().flushModuleState();
      const v = await api('readModuleState', Q);
      assert(v.data.pageSize === 25 && v.data.source === 'observations', '查询未保存');
    });
    await check('临时搜索独立记忆，切换模块不清空', async () => {
      $('dataSearch').value = 'QA';
      $('dataSearch').dispatchEvent(new (win().Event)('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 300));
      await win().flushModuleState();
      await route('home');
      await route('data');
      assert($('dataSearch').value === 'QA', '搜索丢失');
    });
    await check('重新载入恢复查询来源、页容量与搜索', async () => {
      await win().flushModuleState();
      await reloaded();
      assert($('pageSize').value === '25' && $('dataSearch').value === 'QA', '重新载入未恢复');
      assert((await api('readModuleState', Q)).data.source === 'observations', '来源错误');
    });
    await check('数量图表、日期和筛选按模块保存', async () => {
      await route('overview');
      await change('startDate', '2026-10-01');
      await change('endDate', '2026-10-29');
      await click('[data-chart="quantity"]');
      await win().flushModuleState();
      const v = await api('readModuleState', A);
      assert(v.data.chart === 'quantity' && v.data.start === '2026-10-01', '分析配置错误');
    });
    await check('命名方案从已保存配置建立', async () => {
      await memory();
      await change('memoryModule', 'analysis');
      $('memoryPlanName').value = '合成夜班方案';
      $('memorySavePlan').click();
      await wait(() => $('memoryFeedback').textContent === '已保存命名方案。', '命名方案');
      assert($('memoryProfiles').options.length === 2, '方案未列出');
    });
    await check('未确认的重置被阻止', async () => {
      $('memoryReset').click();
      await wait(() => $('memoryFeedback').textContent.includes('请先勾选'), '防误重置');
      assert((await api('readModuleState', A)).data.chart === 'quantity', '未确认却重置');
    });
    await check('单独重置分析模块，不覆盖查询设置', async () => {
      $('memoryConfirmReset').checked = true;
      $('memoryReset').click();
      await wait(() => $('memoryFeedback').textContent.includes('当前模块已恢复默认值'), '重置');
      assert((await api('readModuleState', A)).data.chart === 'rate', '分析未重置');
      assert((await api('readModuleState', Q)).data.pageSize === 25, '查询被覆盖');
    });
    await check('应用命名方案恢复日期与图表', async () => {
      $('memoryProfiles').value = $('memoryProfiles').options[1].value;
      $('memoryApplyPlan').click();
      await wait(() => $('memoryFeedback').textContent === '方案已应用并保存。', '应用');
      assert(
        $('startDate').value === '2026-10-01' &&
          doc().querySelector('[data-chart="quantity"]').getAttribute('aria-pressed') === 'true',
        '方案未应用',
      );
    });
    await check('历史版本可恢复并生成新修订', async () => {
      const before = (await api('readModuleState', A)).revision;
      assert($('memoryHistory').options.length > 1, '没有历史');
      $('memoryHistory').value = $('memoryHistory').options[1].value;
      $('memoryRestore').click();
      await wait(() => $('memoryFeedback').textContent.includes('已从历史配置恢复'), '历史恢复');
      assert((await api('readModuleState', A)).revision === before + 1, '未生成新版本');
    });
    await check('配置备份与完整性检查为真实操作', async () => {
      doc().querySelector('#memoryDialog details.memory-block').open = true;
      $('memoryBackup').click();
      await wait(() => $('memoryFeedback').textContent.includes('已生成独立配置备份'), '备份');
      $('memoryCheck').click();
      await wait(() => $('memoryFeedback').textContent.includes('完整性检查通过'), '完整性');
    });
    await check('侧栏宽度独立保存，页面切换不自动收缩', async () => {
      await change('memorySidebarWidth', '260');
      await closeMemory();
      await route('home');
      const q = (await api('readModuleState', Q)).revision;
      if (doc().body.classList.contains('sidebar-collapsed')) $('toggleSidebar').click();
      await win().flushModuleState();
      await route('data');
      assert(!doc().body.classList.contains('sidebar-collapsed'), '自动收缩');
      assert(
        Math.round(doc().querySelector('.sidebar').getBoundingClientRect().width) === 260,
        '宽度未生效',
      );
      assert((await api('readModuleState', Q)).revision === q, '全局设置覆盖查询');
    });
    await check('主动收起侧栏后重新加载仍保留', async () => {
      $('toggleSidebar').click();
      await new Promise((r) => setTimeout(r, 30));
      await win().flushModuleState();
      await reloaded();
      assert(doc().body.classList.contains('sidebar-collapsed'), '收起状态未恢复');
    });
    await check('主题设置保存且不改动模块配置', async () => {
      const before = (await api('readModuleState', Q)).revision;
      await change('themeSelect', 'graphite');
      await reloaded();
      assert(doc().documentElement.dataset.theme === 'graphite', '主题未恢复');
      assert((await api('readModuleState', Q)).revision === before, '主题修改了查询');
    });
    await check('夹具标签制作与排版与原设计器仍可进入', async () => {
      await route('label-studio');
      await wait(() => $('labelCanvas'), '二维码入口');
      assert($('labelCodes') && $('labelWidth'), '原排版控件缺失');
    });
    await check('恢复全局默认界面不影响分析方案', async () => {
      await memory();
      await change('memoryModule', 'shell');
      $('memoryConfirmReset').checked = true;
      $('memoryReset').click();
      await wait(
        () => $('memoryFeedback').textContent.includes('当前模块已恢复默认值'),
        '重置界面',
      );
      assert(doc().documentElement.dataset.theme === 'silver', '默认主题不符');
      assert(!doc().body.classList.contains('sidebar-collapsed'), '默认侧栏不符');
      await closeMemory();
    });
    await check('配置冲突后可明确放弃未保存修改并重新读取',async()=>{
      await route('overview');await win().flushModuleState();
      const current=await api('readModuleState',A),next=current.data.chart==='rate'?'quantity':'rate';
      await api('saveModuleState',{address:A,data:{...current.data,chart:next},expectedRevision:current.revision});
      await click(`[data-chart="${next}"]`);
      let rejected=false;try{await win().flushModuleState();}catch{rejected=true;}assert(rejected,'没有检测到旧修订冲突');
      $('openMemory').click();await wait(()=>$('memoryDialog').open&&!$('memoryDialog').hasAttribute('aria-busy'),'冲突面板');
      doc().querySelector('#memoryDialog details.memory-block').open=true;
      $('memoryDiscardPending').checked=true;$('memoryReloadAll').click();
      await wait(()=>$('memoryFeedback').textContent.includes('已重新读取界面配置'),'重新读取');
      assert(doc().querySelector(`[data-chart="${next}"]`).getAttribute('aria-pressed')==='true','未恢复最新配置');
    });
    await check('锁定会关闭配置面板并清空其中的工作区内容',async()=>{
      doc().dispatchEvent(new (win().KeyboardEvent)('keydown',{key:'l',ctrlKey:true,bubbles:true}));
      await wait(()=>$('workspaceView').hidden,'锁定');
      assert(!$('memoryDialog').open&&!$('memoryValue').textContent&&!$('memoryPlanName').value,'锁定仍显示配置内容');
    });
    const summary = {
      passed: results.filter((x) => x.status === 'passed').length,
      failed: results.filter((x) => x.status === 'failed').length,
      total: results.length,
      checks: results,
      mode: 'actual-UI-synthetic-local-SQLite',
      formalDataAccessed: false,
      nativeWindowsDPAPITest: false,
    };
    document.getElementById('stateJSON').textContent = JSON.stringify(summary, null, 2);
    document.getElementById('stateSummary').textContent =
      `${summary.passed}通过，${summary.failed}失败`;
  };
})();
