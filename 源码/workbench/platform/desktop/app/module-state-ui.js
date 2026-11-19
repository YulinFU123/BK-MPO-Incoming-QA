'use strict';
window.createModuleStateUI = ({
  api,
  client,
  apply,
  reload,
  beforeOpen,
  afterClose,
  isUnlocked,
  sourceMode = () => 'all',
}) => {
  const $ = (id) => document.getElementById(id);
  const addresses = {
    studio: { scope: 'module', module: 'analysis-studio' },
    analysis: { scope: 'module', module: 'analysis' },
    home: { scope: 'module', module: 'home-workspaces-v2' },
    homeSource: { scope: 'module', module: 'home-data-source' },
    homeNav: { scope: 'global', module: 'home-navigation' },
    query: { scope: 'module', module: 'query' },
    shell: { scope: 'global', module: 'shell' },
  };
  let busy = false,
    profiles = null,
    current = null;
  const address = () => addresses[$('memoryModule').value];
  function showValues(values) {
    if (values.version === 1 && Array.isArray(values.sources) && values.report) {
      const terms = [
        [
          '数据源',
          values.sources
            .map((s) => s.name + '（' + (s.kind === 'production' ? '产量' : '不良') + '）')
            .join('、') || '未设置',
        ],
        [
          '当前面板',
          { day: '每日', week: '每周', month: '每月', report: 'A4报告', sources: '来源与导入' }[
            values.tab
          ],
        ],
        ['独立分析条件', Object.keys(values.views).length + '个来源；每日、每周、每月分别保存'],
        ['报告图表', values.report.charts.length + '张'],
      ];
      const nodes = [];
      for (const [name, value] of terms) {
        const dt = document.createElement('dt'),
          dd = document.createElement('dd');
        dt.textContent = name;
        dd.textContent = value;
        nodes.push(dt, dd);
      }
      $('memoryValue').replaceChildren(...nodes);
      return;
    }
    const names = {
      theme: '界面风格',
      compact: '紧凑行高',
      sidebarWidth: '侧栏宽度',
      sidebarCollapsed: '侧栏状态',
      datasetId: '数据集',
      start: '开始日期',
      end: '结束日期',
      filters: '筛选条件',
      chart: '趋势图',
      source: '数据来源',
      mode: '首页主要来源',
      channel: 'BI来源类型',
      dailyScope: '日报来源范围',
      employee: 'BI责任员工',
      pageSize: '每页行数',
      sort: '排序方式',
    };
    const terms = {
      silver: '雾银',
      glass: '浅色玻璃',
      graphite: '石墨',
      contrast: '高对比',
      rate: '不良率',
      quantity: '数量',
      quality: '检验数据',
      observations: '异常记录',
      auto: '自动选择',
      bi: 'BI主要统计',
      records: '人工异常记录',
      daily: 'BI日报导入',
      history: 'BI历史分析',
    };
    const fields = {
      businessDate: '业务日期',
      observedOn: '发现日期',
      process: '工序',
      area: '区域',
      model: '型号',
      operator: '人员',
      materialLot: '批次',
      relatedCode: '关联编号',
    };
    const nodes = [];
    for (const [key, value] of Object.entries(values)) {
      const term = document.createElement('dt'),
        detail = document.createElement('dd');
      term.textContent = names[key] || key;
      detail.textContent =
        key === 'datasetId'
          ? [...$('datasetSelect').options].find((option) => option.value === value)?.textContent ||
            (value ? '已保存数据集暂不可用' : '默认数据集')
          : key === 'sort'
            ? `${fields[value.field] || '自定义字段'} · ${value.direction === 'asc' ? '升序' : '降序'}`
            : key === 'filters'
              ? Object.entries(value)
                  .map(([k, v]) => `${fields[k] || '自定义条件'}：${v}`)
                  .join('；') || '全部'
              : key === 'sidebarCollapsed'
                ? value
                  ? '收起'
                  : '展开'
                : key === 'sidebarWidth'
                  ? `${value} px`
                  : typeof value === 'boolean'
                    ? value
                      ? '开启'
                      : '关闭'
                    : terms[value] || String(value || '自动选择');
      nodes.push(term, detail);
    }
    $('memoryValue').replaceChildren(...nodes);
  }
  function feedback(message, error = false) {
    $('memoryFeedback').textContent = message;
    $('memoryFeedback').classList.toggle('error-text', error);
  }
  async function load() {
    const a = address();
    current = await api('readModuleState', a);
    client.adopt(a, current);
    showValues(current.data);
    $('memoryScope').textContent =
      a.scope === 'global'
        ? '当前Windows用户 · 全局界面'
        : ($('modeBadge').hidden ? '当前工作区' : '示例工作区（关闭后清空）') +
          ' · ' +
          $('memoryModule').selectedOptions[0].textContent;
    $('memoryRevision').textContent = current.corrupt
      ? '配置损坏，正在使用默认值'
      : current.revision
        ? '已保存版本 ' + current.revision
        : '尚无个人配置，使用默认值';
    $('memoryHistory').replaceChildren(new Option('选择历史版本', ''));
    const history = await api('moduleStateHistory', a);
    for (const row of history.filter((x) => x.revision !== current.revision))
      $('memoryHistory').append(
        new Option(
          `版本 ${row.revision} · ${new Date(row.updated).toLocaleString('zh-CN')}`,
          row.revision,
        ),
      );
    $('memoryProfiles').replaceChildren(new Option('选择已保存方案', ''));
    profiles = null;
    $('memoryPlanControls').hidden = a.scope !== 'module';
    if (a.scope === 'module') {
      profiles = await api('moduleStateProfiles', a);
      for (const p of profiles.data.profiles) $('memoryProfiles').append(new Option(p.name, p.id));
    }
    $('memoryReset').disabled = current.corrupt;
    $('memorySavePlan').disabled = profiles?.corrupt === true;
    $('memoryApplyPlan').disabled = profiles?.corrupt === true;
    feedback(
      current.warning ||
        (profiles?.corrupt
          ? '命名方案无法读取，原文件保留。请保留用户配置目录并使用完整配置备份恢复。'
          : '修改后自动保存；重置与恢复只影响选中的模块。'),
      current.corrupt || profiles?.corrupt === true,
    );
  }
  async function run(work) {
    if (busy) return;
    busy = true;
    $('memoryDialog').setAttribute('aria-busy', 'true');
    try {
      await client.flush();
      await work();
    } catch (error) {
      feedback(error.message, true);
    } finally {
      busy = false;
      $('memoryDialog').removeAttribute('aria-busy');
    }
  }
  async function open() {
    if (document.querySelector('dialog[open]')) return;
    await beforeOpen();
    const mode = sourceMode();
    $('memoryModule').value = isUnlocked() ? (mode === 'bi' ? 'studio' : 'analysis') : 'shell';
    for (const option of $('memoryModule').options) {
      option.hidden =
        (mode === 'bi' && ['analysis', 'query'].includes(option.value)) ||
        (mode === 'records' && option.value === 'studio');
      option.disabled = option.value !== 'shell' && !isUnlocked();
    }
    $('memoryDialog').showModal();
    await run(load);
  }
  $('openMemory').onclick = () => open().catch((error) => feedback(error.message, true));
  $('retryMemory').onclick = () =>
    run(async () => {
      await client.flush();
      feedback('配置已保存。');
    });
  $('memoryClose').onclick = () => {
    if (!busy) $('memoryDialog').close();
  };
  $('memoryDialog').addEventListener('cancel', (e) => {
    if (busy) e.preventDefault();
  });
  $('memoryDialog').addEventListener('close', afterClose);
  $('memoryModule').onchange = () => run(load);
  $('memoryReset').onclick = () =>
    run(async () => {
      if (!$('memoryConfirmReset').checked) throw Error('请先勾选“确认仅重置当前模块”。');
      const a = address(),
        row = await api('resetModuleState', { address: a, expectedRevision: current.revision });
      client.adopt(a, row);
      await apply(a, row.data);
      $('memoryConfirmReset').checked = false;
      await load();
      feedback('当前模块已恢复默认值，其他模块和业务记录未改动。');
    });
  $('memoryRestore').onclick = () =>
    run(async () => {
      const revision = Number($('memoryHistory').value);
      if (!revision) throw Error('请选择历史版本。');
      const a = address(),
        row = await api('restoreModuleState', {
          address: a,
          revision,
          expectedRevision: current.revision,
        });
      client.adopt(a, row);
      await apply(a, row.data);
      await load();
      feedback('已从历史配置恢复，新版本已保存。');
    });
  $('memorySavePlan').onclick = () =>
    run(async () => {
      const name = $('memoryPlanName').value.trim();
      if (!name) throw Error('请填写方案名称。');
      profiles = await api('saveModuleStateProfile', {
        address: address(),
        name,
        expectedRevision: profiles.revision,
      });
      $('memoryPlanName').value = '';
      await load();
      feedback('已保存命名方案。');
    });
  $('memoryApplyPlan').onclick = () =>
    run(async () => {
      const id = $('memoryProfiles').value;
      if (!id) throw Error('请选择方案。');
      const a = address();
      const row = await api('applyModuleStateProfile', {
        address: a,
        id,
        expectedRevision: current.revision,
      });
      client.adopt(a, row);
      await apply(a, row.data);
      await load();
      feedback('方案已应用并保存。');
    });
  $('memoryBackup').onclick = () =>
    run(async () => {
      const b = await api('backupModuleState');
      feedback(
        `已生成独立配置备份 ${b.fileName}。需保留当前Windows账户及原用户配置目录，不包含业务记录。${b.demoOmitted ? '示例方案仅在内存，本次备份只包含长期配置。' : ''}`,
      );
    });
  $('memoryImportBackup').onclick = () =>
    run(async () => {
      if (!$('memoryConfirmReset').checked) throw Error('请先确认仅恢复当前模块配置。');
      const a = address();
      const row = await api('importModuleStateBackup', {
        address: a,
        expectedRevision: current.revision,
        confirmed: true,
      });
      if (row.cancelled) return;
      client.adopt(a, row);
      await apply(a, row.data);
      $('memoryConfirmReset').checked = false;
      await load();
      feedback('已从完整配置备份恢复当前模块，其他模块与业务记录未改动。');
    });
  $('memoryCheck').onclick = () =>
    run(async () => {
      const v = await api('checkModuleState');
      feedback(
        v.integrity === 'ok' ? '配置库完整性检查通过。' : '配置库检查未通过。',
        v.integrity !== 'ok',
      );
    });
  $('memoryReloadAll').onclick = async () => {
    if (busy) return;
    if (!$('memoryDiscardPending').checked) {
      feedback('请先确认放弃未保存的界面配置；正式记录和录入草稿不会改动。', true);
      return;
    }
    busy = true;
    $('memoryClose').disabled = true;
    try {
      await client.rereadAll();
      await reload();
      await load();
      $('memoryDiscardPending').checked = false;
      feedback('已重新读取界面配置；正式记录和录入草稿未改动。');
    } catch (error) {
      feedback(error.message, true);
    } finally {
      busy = false;
      $('memoryClose').disabled = false;
    }
  };
  return {
    open,
    clear() {
      if ($('memoryDialog').open) $('memoryDialog').close();
      $('memoryValue').replaceChildren();
      $('memoryProfiles').replaceChildren();
      $('memoryHistory').replaceChildren();
      $('memoryPlanName').value = '';
      $('memoryFeedback').textContent = '';
      $('memoryRevision').textContent = '';
      current = null;
      profiles = null;
    },
  };
};
