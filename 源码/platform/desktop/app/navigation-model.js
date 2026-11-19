'use strict';
(function (root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  else root.WorkbenchNavigation = value;
})(typeof window === 'object' ? window : null, () => {
  const routes = [
    ['home', '工作台', 'home', '常用入口', '录入、查询与处理按日常顺序进入。', '工作台 常用 开始'],
    [
      'legacy-entry',
      '快捷录入',
      'records',
      '日常记录',
      '扫描SN，填写并核对本次异常。',
      '新增 登记 扫码 SN',
    ],
    [
      'legacy-records',
      '记录查询',
      'records',
      '日常记录',
      '搜索、排序、编辑、导入及导出异常记录。',
      '明细 编辑 排序 Excel CSV 回收',
    ],
    [
      'legacy-followup',
      '待办跟进',
      'records',
      '日常记录',
      '按负责人、状态与期限持续跟进。',
      '待办 任务 处理 超期 负责人',
    ],
    [
      'analysis-hub',
      '分析与报表',
      'analysis',
      '分析目录',
      '按记录条数、检验数量与BI历史选择分析。',
      '分析 报表 趋势',
    ],
    [
      'legacy-analysis',
      '异常记录趋势',
      'analysis',
      '异常记录',
      '按记录条数、异常分类及处理进度分析。',
      '异常 条数 帕累托 重复 日龄',
    ],
    [
      'overview',
      '检验数量与不良率',
      'analysis',
      '检验数量',
      '检验件数、不良件数及前期比较；保留分母口径。',
      '检验 数量 不良率 对比 分母',
    ],
    [
      'bi-trends',
      'BI期间对比',
      'analysis',
      'BI分析',
      '查看BI日、周、月趋势、排名和日期缺口。',
      'BI 趋势 日 周 月 环比',
    ],
    [
      'bi-daily',
      '日报与邮件素材',
      'analysis',
      'BI分析',
      '导入原日报、核对并生成日报与邮件素材。',
      '日报 导入 邮件 PNG',
    ],
    [
      'bi-home',
      '完整分析报表',
      'analysis',
      'BI分析',
      '沿用原BI引擎配置并生成完整工作簿。',
      '导出 报表 Excel 完整',
    ],
    [
      'bi-charts',
      '图表中心',
      'analysis',
      'BI分析',
      '设置和生成原BI的各类图表。',
      '图表 柱状 饼图 12',
    ],
    [
      'bi-improve',
      '改善前后对比',
      'analysis',
      'BI分析',
      '记录改善项目并查看前后变化。',
      '改善 项目 前后',
    ],
    [
      'data-center',
      '数据管理',
      'data',
      '数据目录',
      '集中进入导入、明细、字段与统计规则。',
      '数据 导入 字段 规则',
    ],
    [
      'import',
      '检验导入与批次',
      'data',
      '导入与明细',
      '检查工作表、列映射与批次，确认后保存。',
      '数量 导入 Excel XLSX 产量 批次',
    ],
    [
      'data',
      '检验数量明细',
      'data',
      '导入与明细',
      '查看来源行、检验件数和数量事实。',
      '数量 明细 查询 来源',
    ],
    [
      'quality-check',
      '数据质量核对',
      'data',
      '核对与追溯',
      '核对日期缺口、检验分母、原输入规则及BI历史，定位来源。',
      '核对 质量 检查 缺数 分母 重复 来源',
    ],
    [
      'label-studio',
      '二维码排版',
      'data',
      '标签与工具',
      '调整标签、二维码与间距，按编号对齐并导出Excel或PDF。',
      '二维码 标签 夹具 热剥钳 打印 排版 间距',
    ],
    [
      'legacy-settings',
      '异常表头与校验',
      'data',
      '字段与校验',
      '配置异常类型、字段顺序、唯一值及联动填写。',
      '表头 配置 必填 唯一 去重 校验 联动',
    ],
    [
      'bi-data',
      'BI数据与字段',
      'data',
      '字段与校验',
      '配置BI数据路径、列映射、日切与全局筛选。',
      'BI 字段 映射 数据源 去重',
    ],
    [
      'bi-schemes',
      'BI筛选方案',
      'data',
      '字段与校验',
      '保存多工序、人员组和不良组筛选。',
      '方案 筛选 条件',
    ],
    [
      'bi-groups',
      '人员与工序分组',
      'data',
      '人员与分类',
      '维护人员和工序分组，保留原组合规则。',
      '员工 工序 组 分组',
    ],
    [
      'bi-people',
      '人员名单',
      'data',
      '人员与分类',
      '维护或导入原BI人员名单。',
      '人员 名单 员工 导入',
    ],
    [
      'bi-defects',
      '不良分类与项目',
      'data',
      '人员与分类',
      '维护不良代码、标准项目、分组及统计开关。',
      '不良 分类 标准 项目',
    ],
    ['bi-chk', '每日检查量', 'data', '统计规则', '配置检查量与统计分母。', '检查 检验 分母 数量'],
    [
      'bi-dash',
      '驾驶舱设置',
      'data',
      '统计规则',
      '维护目标、窗口、专项与趋势参数。',
      '驾驶舱 仪表盘 目标',
    ],
    [
      'bi-alerts',
      '预警规则',
      'data',
      '统计规则',
      '配置阈值、最低数量和预警颜色。',
      '预警 阈值 红 橙',
    ],
    [
      'settings-hub',
      '设置与备份',
      'settings',
      '设置目录',
      '显示、访问、完整备份和兼容恢复入口。',
      '设置 备份 安全',
    ],
    [
      'legacy-appearance',
      '外观与布局',
      'settings',
      '显示与访问',
      '四种主题、多选增强、信息密度和字号。',
      '主题 外观 界面 字体 字号 布局',
    ],
    [
      'legacy-security',
      '密码与自动锁定',
      'settings',
      '显示与访问',
      '管理工作区密码和未操作锁定时间。',
      '密码 锁定 安全',
    ],
    [
      'security',
      '备份、恢复与迁移',
      'settings',
      '备份与恢复',
      '分别管理加密工作区和独立BI目录。',
      '备份 恢复 迁移 加密 EAP BI',
    ],
    [
      'bi-tools',
      'BI配置与工具',
      'settings',
      '备份与恢复',
      '保留原Excel控制台导入及BI配置JSON备份。',
      '工具 配置 备份 JSON 控制台',
    ],
  ].map(([id, title, group, section, description, keywords]) =>
    Object.freeze({ id, title, group, section, description, keywords }),
  );
  const routeById = new Map(routes.map((route) => [route.id, route]));
  const primary = [
    'home',
    'legacy-entry',
    'legacy-records',
    'legacy-followup',
    'analysis-hub',
    'data-center',
    'settings-hub',
  ];
  const legacySections = Object.freeze(
    Object.fromEntries(
      routes
        .filter((route) => route.id.startsWith('legacy-'))
        .map((route) => [route.id, route.id.slice(7)]),
    ),
  );
  const biSections = Object.freeze(
    Object.fromEntries(
      routes
        .filter((route) => route.id.startsWith('bi-'))
        .map((route) => [route.id, route.id.slice(3)]),
    ),
  );
  const actions = [
    [
      'import-record-xlsx',
      '导入异常 Excel',
      'legacy-records',
      'import-xlsx',
      '按原异常表头映射导入，保留编号文本。',
      '异常 导入 Excel XLSX',
    ],
    [
      'import-record-csv',
      '导入异常 CSV / TSV',
      'legacy-records',
      'import-csv',
      '使用原异常分隔文件导入校验。',
      '异常 导入 CSV TSV',
    ],
    [
      'import-quantity',
      '导入检验数量',
      'import',
      'quantity-import',
      '显式映射日期、检验数和不良数。',
      '检验 数量 导入 Excel XLSX',
    ],
    [
      'batch-scan',
      '批量扫码',
      'legacy-entry',
      'batch-scan',
      '沿用当前共同字段，核对后整批保存。',
      '批量 扫码 SN 暂存',
    ],
    [
      'export-records',
      '导出异常记录',
      'legacy-records',
      'export-xlsx',
      '按原记录导出，保留六张工作表。',
      '记录 导出 Excel XLSX',
    ],
    [
      'export-record-csv',
      '导出异常 CSV',
      'legacy-records',
      'export-csv',
      '沿用原CSV导出与当前记录条件。',
      '记录 导出 CSV',
    ],
    [
      'export-analysis',
      '导出异常分析',
      'legacy-analysis',
      'analysis-export',
      '保留原十六表分析与当前分析范围。',
      '分析 导出 Excel 报表',
    ],
    [
      'export-followup',
      '导出当前待办',
      'legacy-followup',
      'followup-export',
      '仅导出当前待办条件的结果。',
      '待办 导出 任务',
    ],
    [
      'backup-records',
      '原异常兼容备份',
      'legacy-records',
      'record-backup',
      '供原异常记录台恢复，仅含异常模块。',
      '异常 原软件 兼容 备份 JSON',
    ],
  ].map(([id, title, route, action, description, keywords]) =>
    Object.freeze({ id, title, route, action, description, keywords }),
  );
  const actionById = new Map(actions.map((action) => [action.id, action]));
  const groupHome = Object.freeze({
    home: 'home',
    records: 'legacy-records',
    analysis: 'analysis-hub',
    data: 'data-center',
    settings: 'settings-hub',
  });
  function getRoute(id) {
    return routeById.get(id) || null;
  }
  function getAction(id) {
    return actionById.get(id) || null;
  }
  function primaryFor(id) {
    if (primary.includes(id)) return id;
    return groupHome[getRoute(id)?.group] || 'home';
  }
  function peers(id) {
    const route = getRoute(id);
    if (!route || primary.includes(id)) return [];
    return routes.filter(
      (item) =>
        item.group === route.group &&
        item.section === route.section &&
        item.id !== groupHome[item.group],
    );
  }
  function search(query) {
    const words = String(query || '')
      .trim()
      .toLocaleLowerCase()
      .slice(0, 120)
      .split(/\s+/)
      .filter(Boolean);
    return [
      ...routes.map((route) => ({ ...route, kind: 'route' })),
      ...actions.map((action) => ({
        ...action,
        kind: 'action',
        group: getRoute(action.route).group,
        section: '常用操作',
      })),
    ]
      .map((item, index) => ({
        item,
        index,
        score: words.reduce(
          (score, word) => score + (item.title.toLocaleLowerCase().includes(word) ? 5 : 0),
          0,
        ),
      }))
      .filter(({ item }) =>
        words.every((word) =>
          (item.title + ' ' + item.description + ' ' + item.keywords)
            .toLocaleLowerCase()
            .includes(word),
        ),
      )
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map(({ item }) => item)
      .slice(0, 50);
  }
  function contextActions(view) {
    if (view === 'legacy-entry') return ['batch-scan', 'route:legacy-settings'];
    if (view === 'legacy-records') return ['import-record-xlsx', 'export-records'];
    if (view === 'legacy-followup') return ['export-followup'];
    if (view === 'legacy-analysis') return ['export-analysis'];
    if (view === 'overview') return ['import-quantity', 'route:data'];
    if (view === 'data') return ['import-quantity', 'route:overview'];
    if (view === 'import') return ['import-quantity'];
    if (view === 'quality-check') return ['route:data', 'route:legacy-records'];
    if (view === 'home') return ['route:legacy-entry'];
    return [];
  }
  return Object.freeze({
    routes: Object.freeze(routes),
    actions: Object.freeze(actions),
    primary: Object.freeze(primary),
    legacySections,
    biSections,
    getRoute,
    getAction,
    primaryFor,
    peers,
    search,
    contextActions,
  });
});
