'use strict';
(() => {
  const $ = (id) => document.getElementById(id),
    frame = $('testWorkspace'),
    doc = () => frame.contentDocument;
  const model = window.WorkbenchNavigation,
    results = [];
  const wait = async (predicate, label) => {
    const end = performance.now() + 20000;
    while (performance.now() < end) {
      if (predicate()) return;
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    throw Error(label + '未就绪');
  };
  const assert = (value, message) => {
    if (!value) throw Error(message);
  };
  async function check(label, work) {
    const row = document.createElement('tr'),
      name = document.createElement('td'),
      status = document.createElement('td');
    name.textContent = label;
    try {
      await work();
      status.textContent = '已通过';
      status.className = 'pass';
      results.push({ label, status: 'passed' });
    } catch (error) {
      status.textContent = '失败：' + error.message;
      status.className = 'fail';
      results.push({ label, status: 'failed', message: error.message });
    }
    row.append(name, status);
    $('featureResults').append(row);
    $('featureSummary').textContent =
      `${results.filter((row) => row.status === 'passed').length}通过，${results.filter((row) => row.status === 'failed').length}失败`;
  }
  async function go(id) {
    doc().getElementById('openFunctions').click();
    await wait(() => doc().getElementById('functionDialog').open, '功能查找');
    const input = doc().getElementById('functionQuery');
    input.value = model.getRoute(id).title;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const option = [...doc().querySelectorAll('.function-result')].find(
      (node) =>
        node.querySelector('strong')?.textContent === model.getRoute(id).title &&
        node.querySelector('.function-tag')?.textContent !== '操作',
    );
    assert(option, '查找缺少目的地');
    option.click();
    if (id.startsWith('legacy-'))
      await wait(() => {
        const mount = doc().getElementById('legacyMount'),
          child = mount.querySelector('iframe')?.contentDocument;
        return (
          !mount.hidden &&
          child?.getElementById(id === 'legacy-analysis' ? 'analysis' : 'recordsPanel')?.hidden ===
            false
        );
      }, '原异常页面');
    else if (id.startsWith('bi-'))
      await wait(
        () =>
          doc()
            .getElementById('biMount')
            .querySelector('iframe')
            ?.contentDocument?.getElementById('page')?.dataset.biPage === id.slice(3),
        'BI页面',
      );
    else
      await wait(() => doc().querySelector(`[data-page="${id}"]`)?.hidden === false, '工作区页面');
  }
  const coreCheck = (id) => doc().querySelector(`[data-quality-check="${id}"]`);
  const readyQuality = () =>
    wait(
      () => coreCheck('quantity-denominator') && !doc().getElementById('qualityRefresh').disabled,
      '核对结果',
    );
  const change = (id, value) => {
    const node = doc().getElementById(id);
    node.value = value;
    node.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const scope = () => ({
    start: doc().getElementById('startDate').value,
    end: doc().getElementById('endDate').value,
    datasetId: doc().getElementById('datasetSelect').value,
  });
  $('runFeatureChecks').onclick = async () => {
    $('runFeatureChecks').disabled = true;
    let expected, originalScope;
    await check('实际示例与七主入口就绪', async () => {
      await wait(() => doc()?.getElementById('openDemo'), '应用');
      if (!doc().getElementById('lockView').hidden) doc().getElementById('openDemo').click();
      await wait(() => !doc().getElementById('openFunctions').disabled, '已打开工作区');
      assert(doc().getElementById('versionLabel').textContent === '0.8.0-dev.1', '版本不符');
      assert(doc().querySelectorAll('#primaryNavigation>[data-view]').length === 7, '主入口变化');
    });
    await check('数据核对显示真实服务计数，问题优先、正常项折叠', async () => {
      await go('quality-check');
      await readyQuality();
      originalScope = scope();
      const reply = await doc().defaultView.workbench.qualityReport(originalScope);
      assert(reply.ok, '核对服务失败');
      expected = reply.value;
      for (const item of expected.checks) {
        const row = coreCheck(item.id);
        assert(row, '缺少检查项目');
        if (item.count)
          assert(
            row.querySelector('.quality-count').textContent.startsWith(String(item.count) + ' '),
            '影响计数不符',
          );
      }
      assert(
        coreCheck('quantity-denominator').querySelector('.quality-count').textContent === '1 项',
        '缺分母未显示',
      );
      assert(
        [...doc().querySelectorAll('.quality-passed')].every((node) => !node.open),
        '正常项未折叠',
      );
      assert(
        doc().querySelector('.quality-result-summary').textContent.includes('项需核对'),
        '没有汇总',
      );
    });
    await check('范围默认收起仍显示来源和日期，可展开修改', () => {
      const disclosure = doc().getElementById('qualityScopeDisclosure');
      assert(!disclosure.open, '范围未默认收起');
      assert(
        doc().getElementById('qualityScopeSummary').textContent.includes(originalScope.start),
        '范围摘要没有日期',
      );
      disclosure.querySelector('summary').click();
      assert(doc().getElementById('startDate').getClientRects().length > 0, '范围字段不能展开');
      disclosure.querySelector('summary').click();
    });
    await check('位置展示保留原表行与来源批次', () => {
      const row = coreCheck('quantity-denominator');
      row.querySelector('summary').click();
      const sample = expected.checks.find((row) => row.id === 'quantity-denominator').samples[0];
      assert(
        row.querySelector('li').textContent.includes('原表第 ' + sample.rowNumber + ' 行'),
        '没有来源行',
      );
      assert(row.querySelector('li').textContent.includes(sample.batchId), '批次未保留');
    });
    await check('问题样本只打开对应事实，显示序号从1开始', async () => {
      coreCheck('quantity-denominator').querySelector(':scope>.button').click();
      await wait(() => doc().getElementById('tableCount').textContent.includes('1 行'), '样本明细');
      assert(!doc().getElementById('qualitySampleScope').hidden, '样本范围没有提示');
      const cells = doc().querySelector('#dataTableBody tr').children;
      assert(cells[0].textContent === '1', '序号错误');
      assert(cells[3].textContent === '—', '缺少分母被改成数字');
    });
    await check('返回核对恢复范围，清除样本后恢复完整结果', async () => {
      doc().getElementById('returnQualityCheck').click();
      await readyQuality();
      assert(JSON.stringify(scope()) === JSON.stringify(originalScope), '返回时范围变化');
      coreCheck('quantity-denominator').querySelector(':scope>.button').click();
      await wait(() => !doc().getElementById('qualitySampleScope').hidden, '样本');
      doc().getElementById('clearQualitySamples').click();
      await wait(
        () =>
          doc()
            .getElementById('tableCount')
            .textContent.includes(String(expected.checked.facts) + ' 行'),
        '完整明细',
      );
      assert(doc().getElementById('qualitySampleScope').hidden, '样本标记未清除');
    });
    await check('核对没有修改或删除原数据', async () => {
      await go('quality-check');
      await readyQuality();
      const again = await doc().defaultView.workbench.qualityReport(originalScope);
      assert(JSON.stringify(again.value) === JSON.stringify(expected), '只读核对结果发生变化');
      assert(
        coreCheck('legacy-projection').querySelector('.quality-count').textContent === '1 项',
        '全工作区排除项遗漏',
      );
    });
    await check('原记录核对入口可达，原90条记录仍保留', async () => {
      coreCheck('legacy-rules').querySelector(':scope>.button').click();
      await wait(() => !doc().getElementById('legacyMount').hidden, '原记录宿主');
      const child = () =>
        doc().getElementById('legacyMount').querySelector('iframe')?.contentDocument;
      await wait(() => child()?.getElementById('recordsPanel')?.hidden === false, '原记录查询');
      const all = child().querySelector('[data-filter="all"]');
      all.click();
      await wait(
        () => child().getElementById('dataTable').querySelectorAll('tbody tr').length === 90,
        '全部原记录',
      );
    });
    await check('数量页缺数据时暂停比较，解读和原数据均有依据', async () => {
      await go('overview');
      await wait(() => doc().querySelector('#quantityInsights .insight-summary'), '数量解读');
      assert(
        doc().getElementById('quantityInsights').textContent.includes('暂不比较'),
        '缺日期仍给出比较结论',
      );
      assert(
        doc().getElementById('metricRateChange').textContent.includes('暂不比较'),
        '旧指标与新解读冲突',
      );
      const evidence = doc().querySelector('#quantityInsights .insight-evidence');
      evidence.querySelector('summary').click();
      assert(evidence.textContent.includes(originalScope.start), '未显示比较范围');
    });
    await check('峰值按钮进入该日明细，原图仍逐点标数', async () => {
      const root = doc().getElementById('quantityInsights');
      const button =
        root.querySelector('.insight-summary-row:nth-of-type(3) button') ||
        [...root.querySelectorAll('.insight-summary-row')][1]?.querySelector('button');
      assert(doc().querySelectorAll('#trendChart .cs-value').length > 0, '图形标数丢失');
      if (button) {
        button.click();
        await wait(() => !doc().getElementById('dataView').hidden, '峰值来源');
        assert(
          doc().getElementById('startDate').value === doc().getElementById('endDate').value,
          '峰值没有限定日期',
        );
      } else assert(root.textContent.includes('最高'), '峰值说明缺失');
    });
    await check('原异常首次进入即有新图和解读，无需再次点应用', async () => {
      await go('legacy-analysis');
      const child = doc().getElementById('legacyMount').querySelector('iframe').contentDocument;
      await wait(
        () =>
          child.querySelector('#fusionAnalysisInsights .insight-summary') &&
          child.querySelector('#trendPlot .chart-surface'),
        '原异常初次呈现',
      );
      assert(
        child.getElementById('fusionAnalysisInsights').textContent.includes('已登记记录变化'),
        '解读单位混用',
      );
      assert(child.querySelectorAll('#trendPlot .cs-value').length > 0, '原异常折点无数值');
    });
    await check('BI解读按最新周期判断缺口，主要来源沿用原排行', async () => {
      await go('bi-trends');
      const child = () => doc().getElementById('biMount').querySelector('iframe')?.contentDocument;
      await wait(
        () =>
          child()?.querySelector('.period-table tbody tr') &&
          child().querySelector('.insight-summary'),
        'BI解读',
      );
      const lines = [...child().querySelectorAll('.insight-summary-copy p')].map(
        (node) => node.textContent,
      );
      assert(
        lines.some((text) => text.includes('暂不比较')),
        'BI日期缺口未体现',
      );
      assert(
        lines.some((text) => text.includes('21-配料')),
        '主要来源与原排行不符',
      );
    });
    await check('BI解读来源按钮调用原钻取，条件变化后不会沿用旧结论', async () => {
      const child = doc().getElementById('biMount').querySelector('iframe').contentDocument;
      const old = child.querySelector('.rank-row .rank-name').textContent;
      child.querySelector('.insight-summary .insight-action').click();
      await wait(
        () =>
          child.querySelectorAll('.rank-row').length === 1 &&
          child.querySelector('.insight-summary'),
        'BI来源钻取',
      );
      assert(child.querySelector('.rank-row .rank-name').textContent === old, '原钻取目标变化');
      assert(
        child.querySelector('.insight-summary').textContent.includes('100.0%'),
        '解读没有同步筛选',
      );
    });
    await check('BI历史核对有来源范围且不把未核对显示为正常', async () => {
      await go('quality-check');
      await readyQuality();
      const root = doc().getElementById('biQualityResults');
      assert(root.textContent.includes('尚未核对'), '初始状态混淆');
      doc().getElementById('biQualityRefresh').click();
      await wait(
        () =>
          !doc().getElementById('biQualityRefresh').disabled &&
          !root.textContent.includes('正在核对'),
        'BI核对完成',
      );
      assert(root.textContent.includes('沿用已保存BI全局规则'), 'BI统计范围缺失');
      assert(root.querySelector('[data-quality-check="bi-gaps"]'), 'BI核对结果缺失');
    });
    for (const theme of ['silver', 'glass', 'graphite', 'contrast'])
      await check(theme + '主题下解读和核对文本可见', async () => {
        change('themeSelect', theme);
        await wait(() => doc().documentElement.dataset.theme === theme, '主题');
        const row = doc().querySelector('.quality-check-copy');
        const color = doc().defaultView.getComputedStyle(row).color;
        assert(
          color !== 'rgba(0, 0, 0, 0)' && row.getBoundingClientRect().width > 80,
          '文字或空间不可读',
        );
        assert(
          doc().querySelector('.quality-result-summary').textContent.includes('需核对'),
          '主题切换后内容丢失',
        );
      });
    for (const width of [640, 1000, 1440])
      await check(width + 'px核对布局与按钮无横向溢出', async () => {
        frame.style.border = '0';
        frame.style.width = width + 'px';
        await wait(() => doc().defaultView.innerWidth === width, '布局');
        assert(doc().documentElement.scrollWidth <= width + 1, '页面横向溢出');
        for (const button of doc().querySelectorAll('#qualityView button'))
          if (button.getClientRects().length) {
            const rect = button.getBoundingClientRect();
            assert(rect.left >= -1 && rect.right <= width + 1, '按钮超出窗口');
          }
      });
    await check('无效范围明确报未完成，清除旧结果后可重新核对', async () => {
      doc().getElementById('qualityScopeDisclosure').querySelector('summary').click();
      const start = doc().getElementById('startDate').value;
      change('startDate', '');
      await wait(
        () => doc().getElementById('qualityResults').querySelector('[role="alert"]'),
        '错误状态',
      );
      assert(
        !doc().getElementById('qualityResults').querySelector('.quality-check'),
        '错误后仍显示上次结果',
      );
      assert(
        doc().getElementById('qualityScope').textContent.includes('核对未完成'),
        '错误仍沿用已完成范围',
      );
      change('startDate', start);
      await readyQuality();
    });
    await check('锁定后清除解读和核对内容', async () => {
      doc().getElementById('lockButton').click();
      await wait(() => !doc().getElementById('lockView').hidden, '锁定');
      assert(!doc().getElementById('qualityResults').textContent, '核对信息未清除');
      assert(!doc().getElementById('quantityInsights').textContent, '解读信息未清除');
    });
    const report = {
      passed: results.filter((row) => row.status === 'passed').length,
      failed: results.filter((row) => row.status === 'failed').length,
      total: results.length,
      checks: results,
      mode: 'actual-renderers-synthetic-data-issues',
      productionAccepted: false,
    };
    $('featureResultJSON').textContent = JSON.stringify(report);
  };
})();
