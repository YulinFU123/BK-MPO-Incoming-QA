'use strict';
(() => {
  const frame = document.getElementById('testWorkspace'),
    doc = () => frame.contentDocument,
    win = () => frame.contentWindow,
    $ = (id) => doc().getElementById(id);
  const results = [];
  const assert = (value, message) => {
    if (!value) throw Error(message);
  };
  async function wait(fn, label) {
    const end = performance.now() + 15000;
    while (performance.now() < end) {
      try {
        if (fn()) return;
      } catch {}
      await new Promise((r) => requestAnimationFrame(r));
    }
    throw Error(label + '超时');
  }
  async function check(name, fn) {
    try {
      await fn();
      results.push({ name, status: 'passed' });
    } catch (e) {
      results.push({ name, status: 'failed', message: e.message });
    }
    document.getElementById('dashboardSummary').textContent = results.length + '项已执行';
  }
  async function api(name, input) {
    const r = await win().workbench[name](input);
    if (!r.ok) throw Error(r.error.message);
    return r.value;
  }
  const scope = () => ({
    datasetId: $('datasetSelect').value,
    start: $('startDate').value,
    end: $('endDate').value,
    filters: {},
  });
  const card = (id) => doc().querySelector(`[data-dashboard-metric="${id}"]`);
  async function ready() {
    await wait(
      () =>
        $('dashboardFeedback').textContent.startsWith('已刷新') &&
        card('rate') &&
        $('busyLine').hidden &&
        !doc().querySelector('[data-page="home"]').hidden,
      '工作台刷新',
    );
  }
  async function detailReady() {
    await wait(
      () => $('dashboardDetail').open && $('dashboardDetailPage').textContent.startsWith('共 '),
      '明细',
    );
  }
  async function close() {
    $('dashboardDetailClose').click();
    await wait(() => !$('dashboardDetail').open, '关闭');
  }
  async function change(id, value) {
    $(id).value = value;
    $(id).dispatchEvent(new (win().Event)('change', { bubbles: true }));
    await ready();
  }
  document.getElementById('runDashboard').onclick = async () => {
    document.getElementById('runDashboard').disabled = true;
    await check('示例首页加载，四个指标可访问', async () => {
      await wait(() => $('openDemo') && !$('openDemo').disabled, '入口');
      if (!$('lockView').hidden) $('openDemo').click();
      else {
        await wait(() => !doc().querySelector('[data-view="home"]').disabled, '导航准备');
        doc().querySelector('[data-view="home"]').click();
      }
      await ready();
      doc().querySelector('[data-days="30"]').click();
      await ready();
      assert(doc().querySelectorAll('[data-dashboard-metric]').length === 4, '指标数量');
      assert(!$('dataScope').hidden, '日期范围不可见');
    });
    let report;
    await check('四个数值逐项与业务汇总接口一致', async () => {
      report = await api('overview', scope());
      const values = [
        report.observations.recordCount,
        report.quality.totals.inspectedUnits,
        report.quality.totals.defectiveUnits,
      ];
      ['records', 'inspected', 'defective'].forEach((id, i) =>
        assert(
          card(id).querySelector('strong').textContent === values[i].toLocaleString('zh-CN'),
          id,
        ),
      );
      assert(
        card('rate').querySelector('strong').textContent ===
          (report.quality.rate.value * 100).toFixed(2) + '%',
        '率不符',
      );
    });
    await check('异常条数卡打开来源表，并可分页', async () => {
      card('records').click();
      await detailReady();
      assert(
        $('dashboardDetailPage').textContent.includes(String(report.observations.recordCount)),
        '总数不符',
      );
      assert($('dashboardDetailBody').querySelectorAll('tbody tr').length === 25, '第一页容量');
      $('dashboardNext').click();
      await wait(() => $('dashboardDetailPage').textContent.includes('第 2 页'), '第二页');
      assert(
        $('dashboardDetailBody').querySelectorAll('tbody tr').length ===
          report.observations.recordCount - 25,
        '第二页数量',
      );
      await close();
    });
    for (const id of ['inspected', 'defective', 'rate'])
      await check(id + ' 卡片显示口径和检验来源行', async () => {
        card(id).click();
        await detailReady();
        const text = $('dashboardDetailBody').textContent;
        assert(
          text.includes('检验件数') && text.includes('不良件数') && text.includes('来源行'),
          '缺少数据列',
        );
        if (id === 'rate')
          assert($('dashboardDetailExplanation').textContent.includes('不是逐行'), '缺少计算口径');
        await close();
      });
    await check('分类数量与占比对应，点击后精确分类筛选', async () => {
      const issue = report.observations.issues[0];
      doc().querySelector('.dashboard-issue').click();
      await detailReady();
      assert($('dashboardDetailPage').textContent.includes(String(issue.count)), '分类计数');
      for (const row of $('dashboardDetailBody').querySelectorAll('tbody tr'))
        assert(row.children[3].textContent === issue.issue, '混入其他类别');
      assert($('dashboardDetailExplanation').textContent.includes('不是不良率'), '口径说明');
      await close();
    });
    await check('分类图例显示实际数量和构成占比', async () => {
      const items = doc().querySelectorAll('.home-donut-legend .dashboard-issue');
      items.forEach((item, i) => {
        const issue = report.observations.issues[i];
        assert(
          item.textContent.includes(
            `${issue.count} 条 · ${((issue.count / report.observations.recordCount) * 100).toFixed(1)}%`,
          ),
          '图例数值不符',
        );
      });
    });
    await check('环形图每段角度与实际分类占比一致', async () => {
      const rings = doc().querySelectorAll('.home-donut circle');
      assert(rings.length === report.observations.issues.length, '环形分段数不符');
      rings.forEach((circle, index) => {
        const [segment, total] = circle.getAttribute('stroke-dasharray').split(' ').map(Number);
        assert(
          Math.abs(
            segment / total -
              report.observations.issues[index].count / report.observations.recordCount,
          ) < 1e-8,
          '扇区占比不符',
        );
      });
      assert(
        doc().querySelector('.home-donut-value').textContent ===
          String(report.observations.recordCount),
        '中心总数不符',
      );
    });
    await check('环形分类支持键盘打开详细数据', async () => {
      const issue = report.observations.issues[0];
      doc()
        .querySelector('.home-donut circle')
        .dispatchEvent(new (win().KeyboardEvent)('keydown', { key: 'Enter', bubbles: true }));
      await detailReady();
      for (const row of $('dashboardDetailBody').querySelectorAll('tbody tr'))
        assert(row.children[3].textContent === issue.issue, '环形钻取混入其他分类');
      await close();
    });
    await check('桌面首页趋势、环形分类和最近记录三栏同行', async () => {
      assert(win().innerWidth >= 1150, '此检查需桌面宽度');
      const panels = [...doc().querySelectorAll('.dashboard-grid > .dashboard-panel')];
      assert(panels.length === 3, '三栏结构不完整');
      const tops = panels.map((n) => n.getBoundingClientRect().top);
      assert(Math.max(...tops) - Math.min(...tops) < 2, '没有横向同屏排列');
    });
    await check('趋势每点标数，有纵轴和水平网格', async () => {
      assert(
        $('dashboardTrend').querySelectorAll('[role="button"]').length ===
          report.observations.trend.length,
        '点数不符',
      );
      assert($('dashboardTrend').querySelector('.cs-y-label'), '没有纵轴刻度');
      assert($('dashboardTrend').querySelectorAll('svg line').length > 1, '没有参考线');
    });
    await check('点击趋势点只显示当天记录', async () => {
      const first = report.observations.trend[0];
      $('dashboardTrend')
        .querySelector('[role="button"]')
        .dispatchEvent(new (win().MouseEvent)('click', { bubbles: true }));
      await detailReady();
      for (const row of $('dashboardDetailBody').querySelectorAll('tbody tr'))
        assert(row.children[1].textContent === first.date, '混入其他日期');
      await close();
    });
    await check('完整图表数据表包含全部周期和精确条数', async () => {
      const rows = $('dashboardTrend').querySelectorAll('.cs-data tbody tr');
      assert(rows.length === report.observations.trend.length, '完整表缺行');
      rows.forEach((row, i) =>
        assert(
          Number(row.children[1].textContent) === report.observations.trend[i].recordCount,
          '表值不符',
        ),
      );
    });
    await check('最近记录可按稳定 ID 打开单行', async () => {
      const row = $('dashboardRecent').querySelector('tbody tr'),
        sn = row.children[1].textContent;
      row.querySelector('button').click();
      await detailReady();
      assert($('dashboardDetailBody').querySelectorAll('tbody tr').length === 1, '不是单行');
      assert($('dashboardDetailBody').textContent.includes(sn), 'SN不符');
      await close();
    });
    await check('快速关闭重开不会被旧 close 事件清空', async () => {
      card('records').click();
      await detailReady();
      $('dashboardDetailClose').click();
      card('rate').click();
      await detailReady();
      assert($('dashboardDetailTitle').textContent.includes('不良率'), '旧事件覆盖新弹窗');
      await close();
    });
    await check('缺少检验数据时不良率为横杠，不误显示零', async () => {
      $('startDate').value = '2090-01-01';
      await change('endDate', '2090-01-01');
      assert(card('rate').querySelector('strong').textContent === '—', '无分母仍给率');
      assert(card('records').querySelector('strong').textContent === '0', '无记录不为零');
    });
    await check('返回近七天后指标与趋势同步刷新', async () => {
      doc().querySelector('[data-days="7"]').click();
      await ready();
      const r = await api('overview', scope());
      assert($('dashboardTrend').querySelectorAll('[role="button"]').length === 7, '不是7天');
      assert(
        card('records').querySelector('strong').textContent === String(r.observations.recordCount),
        '未刷新',
      );
    });
    await check('工序筛选会应用到概览与明细，不覆盖主查询配置', async () => {
      const select = doc().querySelector('#dimensionFilters select');
      select.value = '装管';
      select.dispatchEvent(new (win().Event)('change', { bubbles: true }));
      await ready();
      const r = await api('overview', { ...scope(), filters: { process: '装管' } });
      assert(
        card('records').querySelector('strong').textContent === String(r.observations.recordCount),
        '工序计数不符',
      );
      card('records').click();
      await detailReady();
      assert($('dashboardDetailExplanation').textContent.includes('装管'), '筛选说明丢失');
      await close();
      select.value = '';
      select.dispatchEvent(new (win().Event)('change', { bubbles: true }));
      await ready();
    });
    await check('汇总读取失败清空旧指标，明确提示重试', async () => {
      const original = win().workbench.overview;
      win().workbench.overview = () =>
        Promise.resolve({ ok: false, error: { message: '构造读取失败' } });
      try {
        $('dashboardRefresh').click();
        await wait(() => $('dashboardFeedback').textContent.includes('汇总未读取'), '错误提示');
        assert(!card('rate'), '仍显示旧值');
      } finally {
        win().workbench.overview = original;
      }
      $('dashboardRefresh').click();
      await ready();
    });
    await check('深色主题沿用主题系统，文本与面板不固定白色', async () => {
      $('themeSelect').value = 'graphite';
      $('themeSelect').dispatchEvent(new (win().Event)('change', { bubbles: true }));
      await wait(() => doc().documentElement.dataset.theme === 'graphite', '深色');
      assert(
        win().getComputedStyle(card('records').querySelector('strong')).color ===
          'rgb(237, 244, 255)',
        '深色数值颜色未切换',
      );
      $('themeSelect').value = 'silver';
      $('themeSelect').dispatchEvent(new (win().Event)('change', { bubbles: true }));
    });
    await check('高对比风格继续有效，数据数值不因换肤变化', async () => {
      const value = card('records').querySelector('strong').textContent;
      $('themeSelect').value = 'contrast';
      $('themeSelect').dispatchEvent(new (win().Event)('change', { bubbles: true }));
      await wait(() => doc().documentElement.dataset.theme === 'contrast', '高对比');
      assert(win().getComputedStyle(card('records')).borderTopWidth === '2px', '高对比边框未生效');
      assert(
        win().getComputedStyle(card('records').querySelector('.dashboard-metric-note')).color ===
          'rgb(52, 69, 85)',
        '说明文字对比未切换',
      );
      assert(card('records').querySelector('strong').textContent === value, '换肤改变数据');
      $('themeSelect').value = 'silver';
      $('themeSelect').dispatchEvent(new (win().Event)('change', { bubbles: true }));
    });
    await check('浅色玻璃风格仍可选择，并保持原有统计', async () => {
      const value = card('rate').querySelector('strong').textContent;
      $('themeSelect').value = 'glass';
      $('themeSelect').dispatchEvent(new (win().Event)('change', { bubbles: true }));
      await wait(() => doc().documentElement.dataset.theme === 'glass', '玻璃风格');
      assert(
        win().getComputedStyle(doc().querySelector('.sidebar')).backdropFilter.includes('24px'),
        '原有风格未接入新首页',
      );
      assert(card('rate').querySelector('strong').textContent === value, '换肤改变口径');
      $('themeSelect').value = 'silver';
      $('themeSelect').dispatchEvent(new (win().Event)('change', { bubbles: true }));
    });
    await check('旧导航入口可达，返回首页保留范围', async () => {
      const before = $('startDate').value;
      doc().querySelector('[data-view="analysis-hub"]').click();
      await wait(() => !doc().querySelector('[data-page="analysis-hub"]').hidden, '分析目录');
      doc().querySelector('[data-view="home"]').click();
      await ready();
      assert($('startDate').value === before, '范围丢失');
    });
    await check('没有检验数据集仍能看异常记录，不强迫导入数量', async () => {
      const original = win().workbench.catalog;
      win().workbench.catalog = async () => {
        const result = await original();
        return { ...result, value: { ...result.value, datasets: [], dimensionOptions: {} } };
      };
      try {
        $('refreshButton').click();
        await wait(() => $('datasetSelect').value === '', '空检验来源');
        await ready();
        assert(card('records').querySelector('strong').textContent !== '—', '记录条数丢失');
        assert(
          card('rate').disabled && card('rate').querySelector('strong').textContent === '—',
          '编造不良率',
        );
        assert($('dashboardTrend').textContent.includes('不需要先导入检验数量'), '强迫无关导入');
        assert(
          $('dashboardTrend').querySelector('button').textContent === '打开异常记录趋势',
          '旧趋势入口缺失',
        );
      } finally {
        win().workbench.catalog = original;
        $('refreshButton').click();
        await wait(() => $('datasetSelect').value !== '', '恢复检验来源');
        await ready();
      }
    });
    await check('来源刷新进行中清空旧指标，完成后再显示新数值', async () => {
      const original = win().workbench.catalog;
      let release;
      win().workbench.catalog = () =>
        new Promise((resolve) => {
          release = async () => resolve(await original());
        });
      try {
        $('refreshButton').click();
        await wait(() => !!release, '来源请求');
        assert(!card('rate'), '刷新来源时仍显示上次指标');
        assert($('dashboardFeedback').textContent.includes('正在刷新'), '没有加载状态');
      } finally {
        win().workbench.catalog = original;
        await release?.();
      }
      await ready();
    });
    await check('锁定清空首页和明细中的业务文本', async () => {
      card('records').click();
      await detailReady();
      await close();
      $('lockButton').click();
      await wait(() => !$('lockView').hidden, '锁定');
      assert(!$('dashboardCards').textContent && !$('dashboardRecent').textContent, '锁定残留');
      assert(
        !$('dashboardDetailBody').textContent && !$('dashboardDetailScope').textContent,
        '弹窗残留',
      );
    });
    const reportResult = {
      pass: results.filter((r) => r.status === 'passed').length,
      fail: results.filter((r) => r.status === 'failed').length,
      results,
    };
    document.getElementById('dashboardJSON').textContent = JSON.stringify(reportResult, null, 2);
    document.getElementById('dashboardSummary').textContent =
      `通过 ${reportResult.pass} / 失败 ${reportResult.fail}`;
    document.getElementById('runDashboard').disabled = false;
  };
})();
