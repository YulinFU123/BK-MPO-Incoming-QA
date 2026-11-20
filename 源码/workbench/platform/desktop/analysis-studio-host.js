'use strict';
const path = require('node:path'),
  fs = require('node:fs/promises'),
  { randomUUID } = require('node:crypto');
const { startBIWorker } = require('./bi-client');
const model = require('../domain/analysis-studio');
const calendarModel = require('../domain/analysis-calendar');
const a4Report = require('../domain/a4-report');
const { PlatformError } = require('../domain/errors');
const { createAnalysisPanelsHost } = require('./analysis-panels-host');
const ADDRESS = Object.freeze({ scope: 'module', module: 'analysis-studio' });
const CALENDAR = Object.freeze({ scope: 'module', module: 'analysis-calendar' });
const HOME_COLUMNS = Object.freeze({ scope: 'module', module: 'home-bi-columns' });
const { homeColumns } = require('../domain/home-source');
function createAnalysisStudioHost({
  controller,
  memory,
  profile,
  python,
  script,
  pickFolder,
  saveFile,
  pickBackup,
  pickScheme = async () => null,
  pickOriginalTemplate = async () => null,
  workerFactory = startBIWorker,
}) {
  let worker = null,
    owner = '',
    pending = false,
    demo = null;
  let chosenTemplate = null;
  const importBatchHandles = new Map();
  const context = () => {
    const c = controller.hostContext();
    if (!c.unlocked) throw new PlatformError('WORKSPACE_LOCKED', '请先打开工作区。');
    return c;
  };
  const check = (c) => {
    const now = context();
    if (now.sessionId !== c.sessionId || now.file !== c.file)
      throw new PlatformError('SESSION_CHANGED', '工作区已变化，本次分析结果未应用。');
  };
  const root = (c) => {
    if (c.mode === 'file') {
      if (/^\\\\|^\/\//.test(c.file))
        throw new PlatformError(
          'ANALYSIS_LOCAL_WORKSPACE',
          '分析数据库需要本机工作区。下载来源可为共享目录，请把工作区放在本机可写目录。',
        );
      return c.file + '.analysis-data';
    }
    return (demo ||= path.join(profile, 'analysis-demo-' + randomUUID()));
  };
  async function readCalendar(c) {
    const row = await memory.readModuleState(CALENDAR);
    check(c);
    if (row.corrupt)
      throw new PlatformError('STATE_CORRUPT', '班次规则损坏，请恢复规则，未用默认班次替代。');
    return calendarModel.validate(row.data);
  }
  const panels = createAnalysisPanelsHost({
    context,
    check,
    root,
    saveFile,
    pickScheme,
    readConfig: async () => {
      const row = await memory.readModuleState(ADDRESS);
      if (row.corrupt) throw Error('自由分析原配置损坏，请先恢复原配置。');
      return model.validate(row.data);
    },
  });
  async function engine(c) {
    const key = String(c.sessionId) + '|' + root(c);
    if (!worker || owner !== key) {
      worker?.abort();
      worker = workerFactory({ python, script, source: path.dirname(script), data: root(c) });
      owner = key;
    }
    await worker.ready;
    check(c);
    return worker;
  }
  async function inspectTemplate(e, c, template) {
    const info = await e.request({ body: { action: 'inspectOriginalTemplate', template } });
    check(c);
    return info;
  }
  async function request(input) {
    if (
      input &&
      ['panelsLoad', 'panelsSave', 'panelsImport', 'panelsExport'].includes(input.action)
    )
      return panels.request(input);
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).some(
        (k) =>
          ![
            'action',
            'sourceId',
            'draft',
            'name',
            'names',
            'query',
            'period',
            'page',
            'productionId',
            'field',
            'search',
            'matchOp',
            'caseSensitive',
            'offset',
            'format',
            'snapshot',
            'pages',
            'revision',
            'templateMap',
            'templateToken',
            'layout',
            'batchId',
            'enabled',
          ].includes(k),
      )
    )
      throw new PlatformError('INVALID_ARGUMENT', '自由分析操作参数无效。');
    const actions = [
      'pick',
      'scan',
      'inspect',
      'import',
      'importHistory',
      'setImportBatch',
      'status',
      'analyze',
      'facets',
      'reportData',
      'export',
      'exportOriginalReport',
      'previewDailyRate',
      'dailyProductionCohorts',
      'chooseOriginalTemplate',
      'exportQuickReport',
      'templateHeaders',
      'backup',
      'restore',
      'cancel',
    ];
    if (!actions.includes(input.action))
      throw new PlatformError('INVALID_ARGUMENT', '未找到自由分析操作。');
    if (input.action === 'cancel') {
      chosenTemplate = null;
      importBatchHandles.clear();
      worker?.abort();
      worker = null;
      owner = '';
      return { cancelled: true };
    }
    const c = context();
    if (input.action === 'pick') {
      const folder = await pickFolder();
      check(c);
      return folder ? { folder } : { cancelled: true };
    }
    if (pending) throw new PlatformError('ANALYSIS_BUSY', '正在处理分析任务，请等待完成或取消。');
    pending = true;
    try {
      const row = await memory.readModuleState(ADDRESS);
      check(c);
      if (row.corrupt)
        throw new PlatformError(
          'STATE_CORRUPT',
          '自由分析配置损坏，请从配置备份恢复，业务资料未改变。',
        );
      const config = model.validate(row.data),
        body = { ...input, config, calendar: await readCalendar(c) };
      if (input.draft) {
        if (!['scan', 'inspect'].includes(input.action))
          throw new PlatformError('INVALID_ARGUMENT', '未确认的来源仅可扫描和预览。');
        const draft = model.source({ ...input.draft, confirmed: false });
        if (draft.id !== input.sourceId)
          throw new PlatformError('INVALID_ARGUMENT', '预览来源不匹配。');
        config.sources = config.sources.filter((s) => s.id !== draft.id).concat(draft);
        delete body.draft;
      }
      if (
        ['scan', 'inspect', 'import', 'importHistory', 'setImportBatch', 'analyze', 'facets', 'exportOriginalReport', 'exportQuickReport',
          'previewDailyRate', 'dailyProductionCohorts'].includes(input.action) &&
        !config.sources.some((s) => s.id === input.sourceId)
      )
        throw new PlatformError('INVALID_SOURCE', '请选择有效数据源。');
      if (input.action === 'setImportBatch') {
        const handle = importBatchHandles.get(input.batchId);
        if (!handle || handle.sourceId !== input.sourceId || handle.sessionId !== c.sessionId || handle.file !== c.file || handle.mode !== c.mode)
          throw new PlatformError('IMPORT_BATCH_EXPIRED', '批次选择已失效，请刷新当前来源的导入历史。');
        if (typeof input.enabled !== 'boolean' || !Number.isSafeInteger(input.revision) || input.revision < 0)
          throw new PlatformError('INVALID_ARGUMENT', '批次操作状态或版本无效。');
        body.batchId = handle.key;
      } else if (input.batchId !== undefined || input.enabled !== undefined) {
        throw new PlatformError('INVALID_ARGUMENT', '当前操作不接受批次参数。');
      }
      if (input.query) body.query = model.query(input.query);
      if (input.period && !model.periods.includes(input.period))
        throw new PlatformError('INVALID_ARGUMENT', '分析周期无效。');
      if (
        input.names &&
        (!Array.isArray(input.names) ||
          input.names.length > 500 ||
          input.names.some((x) => typeof x !== 'string' || x.length > 256))
      )
        throw new PlatformError('INVALID_ARGUMENT', '文件列表无效。');
      if (input.name !== undefined && (typeof input.name !== 'string' || input.name.length > 256))
        throw new PlatformError('INVALID_ARGUMENT', '文件名无效。');
      if (
        input.search !== undefined &&
        (typeof input.search !== 'string' || input.search.length > 512)
      )
        throw new PlatformError('INVALID_ARGUMENT', '筛选搜索过长。');
      if (
        input.matchOp !== undefined &&
        (input.action !== 'facets' || !['contains', 'notContains', 'startsWith', 'endsWith'].includes(input.matchOp))
      )
        throw new PlatformError('INVALID_ARGUMENT', '文字预览规则无效。');
      if (input.caseSensitive !== undefined && typeof input.caseSensitive !== 'boolean')
        throw new PlatformError('INVALID_ARGUMENT', '筛选大小写选项无效。');
      if (input.field !== undefined && (typeof input.field !== 'string' || input.field.length > 80))
        throw new PlatformError('INVALID_ARGUMENT', '筛选字段无效。');
      if (input.templateMap !== undefined) {
        const invalid = !input.templateMap || typeof input.templateMap !== 'object' ||
          Array.isArray(input.templateMap) || Object.keys(input.templateMap).length > 32 ||
          Object.entries(input.templateMap).some(([key, value]) =>
            typeof key !== 'string' || key.length > 32 ||
            typeof value !== 'string' || (value !== '' && !/^h_[a-f0-9]{16}$/.test(value)));
        if (invalid)
          throw new PlatformError('INVALID_ARGUMENT', '导出列映射格式无效。');
      }
      if (
        input.page !== undefined &&
        (!Number.isInteger(input.page) || input.page < 1 || input.page > 100000)
      )
        throw new PlatformError('INVALID_ARGUMENT', '页码无效。');
      if (
        input.offset !== undefined &&
        (!Number.isInteger(input.offset) || input.offset < 0 || input.offset > 500000)
      )
        throw new PlatformError('INVALID_ARGUMENT', '选项位置无效。');
      const e = await engine(c);
      if (input.action === 'chooseOriginalTemplate') {
        const template = await pickOriginalTemplate();
        check(c);
        if (!template) return { cancelled: true };
        const info = await inspectTemplate(e, c, template);
        chosenTemplate = {
          template, layoutOnly: info.layoutOnly === true, token: randomUUID(), sessionId: c.sessionId, file: c.file,
        };
        return { ...info, templateToken: chosenTemplate.token, templatePath: template };
      }
      let daily;
      const isDailyReport = ['previewDailyRate', 'dailyProductionCohorts', 'exportOriginalReport'].includes(input.action);
      if (input.reportReasons !== undefined) {
        const reasons = input.reportReasons;
        if (!isDailyReport || !Array.isArray(reasons) || reasons.length < 1 || reasons.length > 200 ||
            reasons.some((value) => typeof value !== 'string' || !value.trim() || value.length > 512) ||
            new Set(reasons).size !== reasons.length)
          throw new PlatformError('INVALID_ARGUMENT', '请选择有效的导出判定原因（最多 200 项）。');
      }
      if (isDailyReport) {
        if (!Number.isInteger(input.revision) || input.revision < 0 || !input.query)
          throw new PlatformError('INVALID_ARGUMENT', '请先查询当前筛选结果。');
        if (!config.sources.some((source) => source.id === input.sourceId && source.kind === 'defects'))
          throw new PlatformError('INVALID_SOURCE', '请选择有效的不良数据源。');
        daily = model.dailyReport(config, input.sourceId);
        body.config = { ...config, dailyReports: { ...config.dailyReports, [input.sourceId]: daily } };
      }
      if (input.action === 'export') {
        if (
          !['pdf', 'png', 'xlsx'].includes(input.format) ||
          !Array.isArray(input.pages) ||
          input.pages.length < 1 ||
          input.pages.length > 24 ||
          !input.snapshot ||
          typeof input.snapshot.signature !== 'string' ||
          !Number.isInteger(input.snapshot.revision)
        )
          throw new PlatformError('INVALID_ARGUMENT', '请先预览有效的A4报告。');
        const current = await e.request({
          body: { action: 'reportData', config, calendar: body.calendar },
        });
        check(c);
        if (
          current.revision !== input.snapshot.revision ||
          current.signature !== input.snapshot.signature
        )
          throw new PlatformError('STALE_REPORT', '数据或设置已更新，请重新预览报告。');
        // Rebuild from verified data and the same shared layout engine. Client
        // vector commands never become an independent source of report values.
        body.pages = a4Report.compose(current.charts, config.report, {
          title: current.title,
          subtitle: '不良数量与筛选范围以各图配置为准',
        }).pages;
        const extension = input.format === 'png' && input.pages.length > 1 ? 'zip' : input.format;
        const output = await saveFile(extension, '报告');
        check(c);
        if (!output) return { cancelled: true };
        body.output = output;
      } else if (input.action === 'exportQuickReport') {
        if (!Number.isInteger(input.revision) || input.revision < 0 || !input.query)
          throw new PlatformError('INVALID_ARGUMENT', '请先查询当前筛选结果。');
        body.layout = model.exportLayout(input.layout, config.sources.find((s) => s.id === input.sourceId));
        const output = await saveFile('xlsx', '不良分析目标表');
        check(c);
        if (!output) return { cancelled: true };
        body.output = output;
      } else if (input.action === 'exportOriginalReport') {
        let template, layoutOnly;
        if (input.templateToken !== undefined) {
          if (typeof input.templateToken !== 'string' || !chosenTemplate ||
              chosenTemplate.token !== input.templateToken ||
              chosenTemplate.sessionId !== c.sessionId || chosenTemplate.file !== c.file)
            throw new PlatformError('TEMPLATE_EXPIRED', '模板选择已失效，请返回重新选择目标模板。');
          ({ template, layoutOnly } = chosenTemplate);
        } else if (daily.templatePath) {
          // Only a saved source-scoped setting may supply a reusable path. The
          // renderer still cannot pass an arbitrary template path per request.
          template = daily.templatePath;
          layoutOnly = (await inspectTemplate(e, c, template)).layoutOnly === true;
        } else {
          template = await pickOriginalTemplate();
          check(c);
          if (!template) return { cancelled: true };
          layoutOnly = (await inspectTemplate(e, c, template)).layoutOnly === true;
        }
        if (layoutOnly)
          body.config.dailyReports[input.sourceId] = { ...daily, chartLayout: 'reason-columns' };
        if (!layoutOnly && daily.chartLayout !== 'reason-columns' && daily.includeRate) {
          if (daily.productionMode === 'manual' && !daily.manualProduction.length)
            throw new PlatformError('PRODUCTION_REQUIRED', '请先在每日导表配置中填写并保存实际产量，或取消附加不良率表。');
          if (daily.productionMode === 'bound' && !config.sources.some((s) =>
            s.id === daily.productionId && s.kind === 'production' && s.confirmed))
            throw new PlatformError('PRODUCTION_REQUIRED', '请在每日导表配置中绑定已确认的产量来源，或取消附加不良率表。');
        }
        const output = await saveFile('xlsx', '异常品分析表');
        check(c);
        if (!output) return { cancelled: true };
        body.template = template;
        body.output = output;
      } else if (input.action === 'backup') {
        const output = await saveFile('labpack', '分析资料备份（明文）');
        check(c);
        if (!output) return { cancelled: true };
        body.output = output;
      } else if (input.action === 'restore') {
        if (config.sources.length)
          throw new PlatformError(
            'RESTORE_REQUIRES_EMPTY',
            '请在新建的空工作区恢复分析资料，原资料不会覆盖。',
          );
        const backup = await pickBackup();
        check(c);
        if (!backup) return { cancelled: true };
        body.input = backup;
        const peek = await e.request({ body: { ...body, action: 'inspectBackup' } });
        check(c);
        body.approvedConfig = JSON.stringify(model.validate(peek.config));
        body.approvedCalendar = JSON.stringify(
          calendarModel.validate(peek.calendar || calendarModel.defaults()),
        );
      }
      const result = await e.request({ body });
      check(c);
      if (input.action === 'importHistory') {
        for (const [token, handle] of importBatchHandles) {
          if (handle.sourceId === input.sourceId || handle.sessionId !== c.sessionId || handle.file !== c.file)
            importBatchHandles.delete(token);
        }
        return { ...result, batches: result.batches.map((batch) => {
          const token = randomUUID();
          importBatchHandles.set(token, { key: batch.batchId, sourceId: input.sourceId, sessionId: c.sessionId, file: c.file, mode: c.mode });
          return { ...batch, batchId: token };
        }) };
      }
      if (input.action === 'restore') {
        const restored = model.validate(result.config);
        try {
          const calendarRow = await memory.readModuleState(CALENDAR);
          check(c);
          if (calendarRow.corrupt) throw Error('班次配置损坏，未确认恢复。');
          await memory.saveModuleState({
            address: CALENDAR,
            data: calendarModel.validate(result.calendar || calendarModel.defaults()),
            expectedRevision: calendarRow.revision,
          });
          check(c);
          await memory.saveModuleState({
            address: ADDRESS,
            data: restored,
            expectedRevision: row.revision,
          });
          check(c);
        } catch (error) {
          // This DB was verified empty before restore. Compensate only the exact
          // restored revision; never erase later imports or another workspace.
          try {
            await e.request({ body: { action: 'rollbackRestore', revision: result.revision } });
          } catch {}
          throw new PlatformError(
            'ANALYSIS_RESTORE_CONFIG',
            '恢复配置未可靠保存，未确认恢复成功。原备份保留；请重新打开工作区后检查并重试。',
          );
        }
      }
      return result;
    } finally {
      pending = false;
    }
  }
  async function close() {
    chosenTemplate = null;
    importBatchHandles.clear();
    panels.clear();
    worker?.abort();
    worker = null;
    owner = '';
    if (demo) {
      const target = path.resolve(demo);
      demo = null;
      if (
        path.dirname(target) !== path.resolve(profile) ||
        !path.basename(target).startsWith('analysis-demo-')
      )
        throw Error('示例分析目录越界');
      await fs.rm(target, { recursive: true, force: true });
    }
  }
  return Object.freeze({
    async home(input) {
      const c = context();
      if (c.mode !== 'file')
        return { state: 'empty', channel: 'studio', message: '示例工作区未导入BI文件。' };
      try {
        await fs.access(path.join(root(c), 'analysis-v1.sqlite'));
      } catch (e) {
        if (e.code === 'ENOENT')
          return { state: 'empty', channel: 'studio', message: '此工作区尚未导入BI自由分析数据。' };
        throw e;
      }
      const row = await memory.readModuleState(ADDRESS);
      check(c);
      if (row.corrupt) throw Error('BI来源配置损坏，未按零数据处理。');
      const columns = await memory.readModuleState(HOME_COLUMNS);
      check(c);
      if (columns.corrupt) throw Error('首页分析表头配置损坏，请从备份恢复。');
      const config = model.validate(row.data),
        e = await engine(c);
      const result = await e.request({
        body: { ...input, action: 'home', config, calendar: await readCalendar(c),
          homeColumns: homeColumns(columns.data).sources },
      });
      check(c);
      return result;
    },
    request,
    abort: () => {
      chosenTemplate = null;
      importBatchHandles.clear();
      worker?.abort();
      worker = null;
      owner = '';
    },
    close,
  });
}
module.exports = { createAnalysisStudioHost, ADDRESS };
