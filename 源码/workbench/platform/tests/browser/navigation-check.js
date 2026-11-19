'use strict';
(() => {
  const $ = (id) => document.getElementById(id),
    model = window.WorkbenchNavigation;
  const workspace = $('testWorkspace');
  const wait = async (predicate, label) => {
    const end = performance.now() + 10000;
    while (performance.now() < end) {
      try {
        if (predicate()) return;
      } catch {}
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    const mount = doc()?.getElementById('legacyMount'),
      frame = mount?.querySelector('iframe'),
      child = frame?.contentDocument;
    throw Error(
      label +
        '超时 ' +
        JSON.stringify({
          mountHidden: mount?.hidden,
          mountHeight: mount?.getBoundingClientRect().height,
          frameDisplay: frame?.style.display,
          frameURL: child?.URL,
          workspaceHidden: child?.getElementById('workspace')?.hidden,
          authError: child?.getElementById('authError')?.textContent,
          alerts: doc()?.getElementById('toastRegion')?.textContent,
          viewportWidth: doc()?.defaultView.innerWidth,
          fixtureWidth: workspace.getBoundingClientRect().width,
          fixtureStyle: workspace.style.width,
        }),
    );
  };
  const doc = () => workspace.contentDocument;
  let passed = 0,
    failed = 0;
  const inputAudit = [];
  function captureFields(route, child, context = '页面') {
    child.defaultView.FieldControls?.enhance();
    const visible = (node) =>
      !!node.getClientRects().length &&
      child.defaultView.getComputedStyle(node).visibility !== 'hidden';
    const name = (node) => {
      if (node.getAttribute('aria-label')) return node.getAttribute('aria-label');
      const ids = (node.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
      if (ids.length)
        return ids
          .map((id) => child.getElementById(id)?.textContent || '')
          .join(' ')
          .trim();
      return [...(node.labels || [])]
        .map((label) => {
          const copy = label.cloneNode(true);
          copy.querySelectorAll('input,select,textarea,button').forEach((item) => item.remove());
          return copy.textContent.trim();
        })
        .join(' ');
    };
    [...child.querySelectorAll('input,textarea')]
      .filter(
        (node) =>
          visible(node) &&
          ![
            'checkbox',
            'radio',
            'hidden',
            'file',
            'color',
            'range',
            'button',
            'submit',
            'reset',
          ].includes(node.type),
      )
      .forEach((node, index) => {
        const style = child.defaultView.getComputedStyle(node);
        inputAudit.push({
          route: route.id,
          context,
          id: node.id || 'field-' + index,
          type: node.tagName === 'TEXTAREA' ? 'textarea' : node.type,
          name: name(node),
          labelSource: node.dataset.fieldLabelSource || 'original',
          fontSize: style.fontSize,
          fontFamily: style.fontFamily,
          readOnly: node.readOnly,
          disabled: node.disabled,
          maxLength: node.maxLength,
          min: node.min || null,
          max: node.max || null,
          required: node.required,
        });
      });
  }
  async function check(label, work) {
    const row = document.createElement('tr'),
      a = document.createElement('td'),
      b = document.createElement('td');
    a.textContent = label;
    try {
      await work();
      passed++;
      b.textContent = '已通过';
      b.className = 'pass';
    } catch (error) {
      failed++;
      b.textContent = '失败：' + error.message;
      b.className = 'fail';
    }
    row.append(a, b);
    $('navigationResults').append(row);
    $('navigationSummary').textContent = passed + '通过，' + failed + '失败';
  }
  async function go(route) {
    doc().getElementById('openFunctions').click();
    await wait(() => doc().getElementById('functionDialog').open, '查找功能');
    const input = doc().getElementById('functionQuery');
    input.value = route.title;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const option = [...doc().querySelectorAll('.function-result')].find(
      (node) =>
        node.querySelector('strong')?.textContent === route.title &&
        node.querySelector('.function-tag')?.textContent !== '操作',
    );
    if (!option) throw Error('功能查找中缺少入口');
    option.click();
    await wait(
      () =>
        doc()
          .querySelector(`[data-view="${model.primaryFor(route.id)}"]`)
          ?.getAttribute('aria-current') === 'page',
      '主导航',
    );
    if (model.legacySections[route.id]) {
      await wait(() => {
        const mount = doc().getElementById('legacyMount'),
          frame = mount.querySelector('iframe');
        return (
          !mount.hidden &&
          frame?.contentDocument?.getElementById('workspace')?.hidden === false &&
          frame.style.display !== 'none'
        );
      }, '原异常页面');
      const child = doc().getElementById('legacyMount').querySelector('iframe').contentDocument;
      const modal = {
        settings: ['settingsDialog', 'discardSettings'],
        security: ['securityDialog', 'closeSecurity'],
        appearance: ['appearanceDialog', 'appearanceCancel'],
      }[model.legacySections[route.id]];
      if (modal) {
        await wait(() => child.getElementById(modal[0])?.open, '原设置弹窗');
        if (model.legacySections[route.id] === 'settings') {
          for (let i = 0; i < 4; i++) {
            child.getElementById('settingsTab' + i).click();
            captureFields(route, child, '表头配置第' + (i + 1) + '页签');
          }
          child.getElementById('settingsTab1').click();
          const rules = [
            ...child.querySelectorAll('#columnRows .policy-open:not(:disabled)'),
          ].slice(0, 2);
          for (const rule of rules) {
            rule.click();
            await wait(() => child.getElementById('policyDialog').open, '输入规则');
            captureFields(route, child, '输入规则弹窗');
            child.getElementById('policyCancel').click();
          }
        } else captureFields(route, child, '设置弹窗');
        child.getElementById(modal[1]).click();
        await wait(() => !child.getElementById(modal[0]).open, '关闭弹窗');
      } else {
        const panel = {
          entry: 'entryPanel',
          records: 'recordsPanel',
          analysis: 'analysis',
          followup: 'followupPanel',
        }[model.legacySections[route.id]];
        await wait(() => child.getElementById(panel)?.hidden === false, '原业务面板');
        captureFields(route, child);
      }
    } else if (model.biSections[route.id]) {
      await wait(() => {
        const frame = doc().getElementById('biMount').querySelector('iframe'),
          page = frame?.contentDocument?.querySelector('#page');
        return (
          !doc().getElementById('biMount').hidden &&
          page?.dataset.biPage === model.biSections[route.id] &&
          page.children.length > 0
        );
      }, '原BI页面');
      captureFields(route, doc().getElementById('biMount').querySelector('iframe').contentDocument);
    } else
      await wait(
        () => doc().querySelector(`[data-page="${route.id}"]`)?.hidden === false,
        '工作区页面',
      );
    if (!model.legacySections[route.id] && !model.biSections[route.id]) captureFields(route, doc());
  }
  $('runNavigation').onclick = async () => {
    $('runNavigation').disabled = true;
    await check('工作区与7个主入口', async () => {
      await wait(() => doc()?.getElementById('openDemo'), '实际界面');
      if (!doc().getElementById('lockView').hidden) {
        doc().getElementById('openDemo').click();
        await wait(() => doc().getElementById('lockView').hidden, '示例打开');
      }
      await wait(() => !doc().getElementById('openFunctions').disabled, '工作区完成加载');
      if (doc().querySelectorAll('#primaryNavigation>[data-view]').length !== 7)
        throw Error('主入口数量不符');
    });
    for (const route of model.routes) await check(route.title, () => go(route));
    await check('公共目录完整覆盖原功能，三种导入有明确入口', async () => {
      for (const id of [
        'action:import-record-xlsx',
        'action:import-record-csv',
        'action:import-quantity',
        'bi-daily',
        'action:backup-records',
      ])
        if (!doc().querySelector(`[data-destination="${id}"]`)) throw Error('公共入口缺失：' + id);
    });
    await check('数据工作台显示统计范围，其余目录隐藏无关筛选', async () => {
      await go(model.getRoute('home'));
      if (doc().getElementById('dataScope').hidden) throw Error('工作台缺少统计范围');
      for (const id of ['analysis-hub', 'data-center', 'settings-hub']) {
        await go(model.getRoute(id));
        if (
          !doc().getElementById('dataScope').hidden ||
          !doc().getElementById('dimensionFilters').hidden
        )
          throw Error('目录混入数量筛选');
      }
    });
    await check('查找功能取消后保留原录入内容', async () => {
      await go(model.getRoute('legacy-entry'));
      const child = doc().getElementById('legacyMount').querySelector('iframe').contentDocument;
      const sn = child.getElementById('field_sn');
      sn.value = 'DEMO_LAYOUT_0012';
      sn.dispatchEvent(new Event('input', { bubbles: true }));
      doc().getElementById('openFunctions').click();
      await wait(() => doc().getElementById('functionDialog').open, '查找打开');
      doc().getElementById('functionClose').click();
      await wait(
        () => doc().getElementById('legacyMount').querySelector('iframe').style.display !== 'none',
        '视图恢复',
      );
      if (sn.value !== 'DEMO_LAYOUT_0012') throw Error('输入被清空');
    });
    for (const width of [640, 1000, 1440])
      await check(width + 'px实际界面的分栏、字段与工具栏', async () => {
        const savedWidth = workspace.style.width,
          savedBorder = workspace.style.border;
        try {
          workspace.style.border = '0';
          workspace.style.width = width + 'px';
          await wait(() => doc().defaultView.innerWidth === width, '窗口尺寸');
          await go(model.getRoute('home'));
          const layout = doc().querySelector('[data-page="home"] .directory-layout');
          const columns = doc().defaultView.getComputedStyle(layout).gridTemplateColumns.split(' ');
          if (columns.length !== (width <= 900 ? 1 : 2)) throw Error('目录未按窗口分栏');
          if (doc().documentElement.scrollWidth > width + 1) throw Error('工作区横向溢出');
          await go(model.getRoute('legacy-entry'));
          const mount = doc().getElementById('legacyMount'),
            child = mount.querySelector('iframe').contentDocument;
          await wait(
            () => Math.abs(child.defaultView.innerWidth - mount.getBoundingClientRect().width) < 3,
            '内容区尺寸',
          );
          const context = child.querySelector('.entry-group-context').getBoundingClientRect(),
            issue = child.querySelector('.entry-group-issue').getBoundingClientRect();
          if (child.defaultView.innerWidth > 960) {
            if (Math.abs(context.top - issue.top) > 2) throw Error('宽窗录入未并列');
          } else if (issue.top < context.bottom - 2) throw Error('窄窗录入未顺序堆叠');
          for (const input of child.querySelectorAll('#fieldsGrid input,#fieldsGrid select')) {
            const rect = input.getBoundingClientRect();
            if (rect.width && (rect.left < -1 || rect.right > child.defaultView.innerWidth + 1))
              throw Error('字段超出内容区：' + input.id);
          }
          for (const button of doc().querySelectorAll('.toolbar-actions>button:not([hidden])')) {
            const rect = button.getBoundingClientRect();
            if (rect.right > width + 1) throw Error('工具栏按钮超出窗口');
          }
        } finally {
          workspace.style.width = savedWidth;
          workspace.style.border = savedBorder;
        }
      });
    await check('公共批量扫码复用原校验与暂存窗口，关闭不提交', async () => {
      await go(model.getRoute('legacy-entry'));
      const child = doc().getElementById('legacyMount').querySelector('iframe').contentDocument;
      for (const [id, value] of [
        ['field_sn', 'DEMO_COMMON_0012'],
        ['field_issue', '构造测试异常'],
        ['field_silk', '0012'],
      ]) {
        const input = child.getElementById(id);
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const sequence = child.getElementById('autoStrip').textContent;
      doc().getElementById('toolbarImport').click();
      await wait(() => child.getElementById('batchDialog').open, '原暂存窗口');
      captureFields(model.getRoute('legacy-entry'), child, '批量扫码暂存');
      child.getElementById('batchClose').click();
      await wait(() => !child.getElementById('batchDialog').open, '关闭暂存');
      if (sequence !== child.getElementById('autoStrip').textContent)
        throw Error('打开暂存窗口误提交了记录');
      if (child.getElementById('field_silk').value !== '0012') throw Error('编号原文发生改变');
    });
    await check('实际数量图逐点标数、横线和固定纵轴', async () => {
      await go(model.getRoute('overview'));
      const figure = doc().querySelector('#trendChart .chart-surface');
      if (!figure || figure.querySelectorAll('.cs-point').length === 0) throw Error('数量图未接入');
      if (
        figure.querySelectorAll('.cs-point').length !== figure.querySelectorAll('.cs-value').length
      )
        throw Error('数量点未全部标数');
      if (!figure.querySelector('.cs-fixed-axis') || figure.querySelectorAll('.cs-grid').length < 2)
        throw Error('刻度不完整');
    });
    await check('实际异常趋势和帕累托标数，并保留原记录钻取', async () => {
      await go(model.getRoute('legacy-analysis'));
      const child = doc().getElementById('legacyMount').querySelector('iframe').contentDocument;
      const chart = child.querySelector('#trendPlot .chart-surface');
      if (!chart || !chart.querySelector('.cs-value')) throw Error('异常趋势未接入');
      const bars = child.querySelectorAll('#paretoPlot .pareto-bar');
      if (
        bars.length !== child.querySelectorAll('#paretoPlot [data-count]').length ||
        bars.length !== child.querySelectorAll('#paretoPlot [data-cumulative]').length
      )
        throw Error('帕累托标数不全');
      const label = [...chart.querySelectorAll('.cs-value[data-series="0"]')].find(
        (node) => Number(node.dataset.value) > 0,
      );
      if (!label) throw Error('示例没有可钻取数据');
      chart
        .querySelector('.cs-point[data-series="0"][data-period="' + label.dataset.period + '"]')
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await wait(() => !child.getElementById('recordsPanel').hidden, '原记录钻取');
      const workflow = [...child.querySelectorAll('#recordsPanel button')].find(
        (node) => node.textContent.trim() === '待处理',
      );
      if (workflow) {
        workflow.click();
        await wait(() => child.getElementById('workflowDialog').open, '跟进弹窗');
        captureFields(model.getRoute('legacy-followup'), child, '处理编辑');
        child.getElementById('workflowCancel').click();
      }
      const history = [...child.querySelectorAll('#recordsPanel button')].find(
        (node) => node.textContent.trim() === '历史',
      );
      if (history) {
        history.click();
        await wait(() => child.getElementById('historyDialog').open, '历史明细');
        captureFields(model.getRoute('legacy-records'), child, '只读历史');
        child.getElementById('historyClose').click();
      }
      const filters = [...child.querySelectorAll('#recordsPanel summary')].find((node) =>
        node.textContent.includes('组合筛选'),
      );
      if (filters) {
        filters.click();
        captureFields(model.getRoute('legacy-records'), child, '组合筛选');
      }
    });
    await check('登录和侧栏Logo加载，收起侧栏后仍可识别', async () => {
      await go(model.getRoute('home'));
      const images = [...doc().querySelectorAll('img[src="assets/logo.svg"]')];
      if (images.length !== 2 || images.some((img) => !img.complete || !img.naturalWidth))
        throw Error('Logo资源未加载');
      doc().getElementById('toggleSidebar').click();
      if (
        doc().defaultView.getComputedStyle(doc().querySelector('.sidebar-identity')).display ===
        'none'
      )
        throw Error('收起后标志消失');
      doc().getElementById('toggleSidebar').click();
    });
    let biChartVerification = { status: 'not-tested-no-source' };
    await go(model.getRoute('bi-trends'));
    const biChild = doc().getElementById('biMount').querySelector('iframe').contentDocument;
    await check('BI日报静态图保留数量标数并显示数量刻度', () => {
      const image = biChild.defaultView.dailyChartSvg(
        '构造日报图',
        [
          { name: '示例A', qty: 10, share: 0.25 },
          { name: '示例B', qty: 30, share: 0.75 },
        ],
        { start: '2026-10-13', end: '2026-10-14' },
        { scope: '仅构造测试' },
        30,
        false,
      );
      if (image.querySelectorAll('g[aria-label="数量刻度，单位pcs"] line').length !== 5)
        throw Error('静态图缺少数量刻度线');
      if (!image.textContent.includes('10') || !image.textContent.includes('30'))
        throw Error('静态图未保留数量标数');
    });
    try {
      await wait(
        () =>
          biChild.querySelector('.period-table tbody tr') || biChild.querySelector('.trend-empty'),
        'BI结果状态',
      );
    } catch {}
    if (biChild.querySelector('.period-table tbody tr'))
      await check('BI实际图形与原周期明细的数值和缺数一致', () => {
        const rows = [...biChild.querySelectorAll('.period-table tbody tr')];
        const expected = rows.map((row) => {
          const text = row.children[1].textContent.trim().replaceAll(',', '');
          return /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : null;
        });
        const chart = biChild.querySelector('.chart-surface'),
          values = [...chart.querySelectorAll('.cs-value')].map((node) =>
            Number(node.dataset.value),
          );
        if (JSON.stringify(values) !== JSON.stringify(expected.filter((value) => value !== null)))
          throw Error('BI图形与原明细不一致');
        if (
          chart.querySelectorAll('.cs-missing').length !==
          expected.filter((value) => value === null).length
        )
          throw Error('BI缺数表现不一致');
        biChartVerification = {
          status: 'passed',
          periods: expected.length,
          validPoints: values.length,
          quantity: values.reduce((sum, value) => sum + value, 0),
        };
      });
    await check('各页面文本框有可识别标签，字体统一且未记录业务值', () => {
      if (inputAudit.length < 60) throw Error('文本框覆盖不足');
      const missing = inputAudit.filter((field) => !field.name);
      if (missing.length)
        throw Error('缺少标签：' + missing.map((field) => field.route + '/' + field.id).join(','));
      const fonts = inputAudit.filter((field) => !['13px', '15px'].includes(field.fontSize));
      if (fonts.length)
        throw Error(
          '字号未统一：' +
            fonts.map((field) => field.route + '/' + field.id + ':' + field.fontSize).join(','),
        );
    });
    const result = {
      passed,
      failed,
      total: passed + failed,
      originalDestinations: 25,
      biPages: 14,
      primaryEntries: 7,
      mode: 'actual-renderers-synthetic-demo',
      productionAccepted: false,
      inputControlInstances: inputAudit.length,
      biChartVerification,
    };
    const resultNode = document.createElement('pre');
    resultNode.id = 'navigationResultJSON';
    resultNode.textContent = JSON.stringify(result);
    $('navigationResults').after(resultNode);
    const fieldJSON = document.createElement('pre');
    fieldJSON.id = 'inputAuditJSON';
    fieldJSON.textContent = JSON.stringify(inputAudit);
    resultNode.after(fieldJSON);
  };
})();
