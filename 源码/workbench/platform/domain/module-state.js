'use strict';
const { PlatformError } = require('./errors');
const biFilters = require('./bi-export-filters');
const defectSelection = require('./defect-selection');
const homeWorkspaces = require('./home-workspaces');
const homeSource = require('./home-source');
const biWorkflow = require('./bi-workflow');
const guides = require('./guides');
const analysisStudio = require('./analysis-studio');
const analysisCalendar = require('./analysis-calendar');
const bad = () => {
  throw new PlatformError('STATE_INVALID', '配置内容或作用范围无效，请检查后重试。');
};
const text = (v, max = 128) =>
  typeof v === 'string' && v.length <= max && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v);
const object = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const number = (v, min, max) => Number.isFinite(v) && v >= min && v <= max;
const date = (v) =>
  v === '' ||
  (typeof v === 'string' &&
    /^\d{4}-\d\d-\d\d$/.test(v) &&
    Number.isFinite(Date.parse(v + 'T00:00:00Z')) &&
    new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v);
const fields = (v, allowed) => object(v) && Object.keys(v).every((k) => allowed.includes(k));
const dimensions = (v) =>
  object(v) &&
  Object.entries(v).length <= 32 &&
  Object.entries(v).every(([k, x]) => /^[a-zA-Z][\w.-]{0,63}$/.test(k) && text(x, 512));
const defaults = Object.freeze({
  'global:shell': { theme: 'silver', compact: false, sidebarWidth: 194, sidebarCollapsed: false },
  'workspace:session': { lastRoute: 'home', currentTemplateId: '' },
  'global:home-navigation': { expanded: ['records', 'analysis', 'data', 'system'] },
  'global:guides': guides.defaults(),
  'global:guides-v2': guides.defaults(),
  'global:guides-v3': guides.defaults(),
  'module:home-workspaces': homeWorkspaces.legacyDefaults(),
  'module:home-workspaces-v2': homeWorkspaces.defaults(),
  'module:home-data-source': homeSource.defaults(),
  'module:home-bi-columns': homeSource.homeColumnsDefaults(),
  'module:bi-export': { filters: {}, dictionary: {} },
  'module:daily-defects': { items: [] },
  'module:bi-inbox': { folder: '', scope: '', floor: '', enabled: false, replace: false },
  'module:bi-workflow': biWorkflow.defaults(),
  'module:analysis-studio': analysisStudio.defaults(),
  'module:analysis-calendar': analysisCalendar.defaults(),
  'draft:analysis-calendar': { sourceId: '', rule: null },
  'draft:analysis-source': { source: null },
  'module:analysis': { datasetId: '', start: '', end: '', filters: {}, chart: 'rate' },
  'module:query': {
    source: 'quality',
    pageSize: 50,
    sort: { field: 'businessDate', direction: 'desc' },
  },
  'page:query': { search: '', page: 1, scroll: 0 },
  'draft:records': { templateId: '', recordId: '', values: {} },
});
function address(input) {
  if (
    !fields(input, ['scope', 'module', 'page', 'templateId']) ||
    !Object.hasOwn(defaults, `${input.scope}:${input.module}`)
  )
    bad();
  if (input.scope === 'page' && !text(input.page, 64)) bad();
  if (input.page && input.scope !== 'page' && input.scope !== 'draft') bad();
  if (input.templateId !== undefined && !text(input.templateId, 128)) bad();
  return {
    scope: input.scope,
    module: input.module,
    page: input.page || '',
    templateId: input.templateId || '',
  };
}
function defaultData(a) {
  return structuredClone(defaults[`${a.scope}:${a.module}`]);
}
function validate(a, v) {
  const d = defaultData(a),
    value = { ...d, ...v };
  if (!fields(v, Object.keys(d))) bad();
  switch (`${a.scope}:${a.module}`) {
    case 'module:analysis-studio':
      return analysisStudio.validate(value);
    case 'module:analysis-calendar':
      return analysisCalendar.validate(value);
    case 'draft:analysis-calendar':
      return analysisCalendar.draft(value);
    case 'draft:analysis-source':
      if (value.source !== null)
        analysisStudio.source({
          ...value.source,
          name: value.source.name || '未命名来源',
          confirmed: false,
        });
      return structuredClone(value);
    case 'global:guides':
    case 'global:guides-v2':
    case 'global:guides-v3':
      try {
        return guides.validate(value);
      } catch {
        bad();
      }
      break;
    case 'module:bi-workflow':
      try {
        return biWorkflow.preferences(value);
      } catch {
        bad();
      }
      break;
    case 'module:home-data-source':
      return homeSource.preferences(value);
    case 'module:home-bi-columns':
      return homeSource.homeColumns(value);
    case 'global:shell':
      if (
        !['silver', 'glass', 'graphite', 'contrast'].includes(value.theme) ||
        typeof value.compact !== 'boolean' ||
        typeof value.sidebarCollapsed !== 'boolean' ||
        !number(value.sidebarWidth, 174, 360)
      )
        bad();
      break;
    case 'workspace:session':
      if (!text(value.lastRoute, 64) || !text(value.currentTemplateId)) bad();
      break;
    case 'global:home-navigation':
      if (
        !Array.isArray(value.expanded) ||
        value.expanded.some((k) => !['records', 'analysis', 'data', 'system'].includes(k))
      )
        bad();
      break;
    case 'module:home-workspaces':
      try {
        return homeWorkspaces.legacy(value);
      } catch {
        bad();
      }
      break;
    case 'module:home-workspaces-v2':
      try {
        return homeWorkspaces.validate(value);
      } catch {
        bad();
      }
      break;
    case 'module:bi-inbox':
      if (
        !text(value.folder, 4096) ||
        !text(value.scope, 128) ||
        !text(value.floor, 128) ||
        typeof value.enabled !== 'boolean' ||
        typeof value.replace !== 'boolean' ||
        (value.enabled && (!value.folder || !value.scope.trim()))
      )
        bad();
      break;
    case 'module:daily-defects':
      try {
        return defectSelection.state(value);
      } catch {
        bad();
      }
      break;
    case 'module:bi-export':
      try {
        return biFilters.state(value);
      } catch {
        bad();
      }
      break;
    case 'module:analysis':
      if (
        !text(value.datasetId) ||
        !date(value.start) ||
        !date(value.end) ||
        (value.start && value.end && value.start > value.end) ||
        !dimensions(value.filters) ||
        !['rate', 'quantity'].includes(value.chart)
      )
        bad();
      break;
    case 'module:query':
      if (
        !['quality', 'observations'].includes(value.source) ||
        ![25, 50, 100].includes(value.pageSize) ||
        !fields(value.sort, ['field', 'direction']) ||
        !text(value.sort.field) ||
        !['asc', 'desc'].includes(value.sort.direction)
      )
        bad();
      break;
    case 'page:query':
      if (
        !text(value.search, 500) ||
        !Number.isInteger(value.page) ||
        !number(value.page, 1, 1000000) ||
        !number(value.scroll, 0, 100000000)
      )
        bad();
      break;
    case 'draft:records':
      if (
        !text(value.templateId) ||
        !text(value.recordId) ||
        !object(value.values) ||
        Object.keys(value.values).length > 256 ||
        Object.entries(value.values).some(([k, x]) => !text(k, 128) || !text(x, 10000))
      )
        bad();
      break;
    default:
      bad();
  }
  return structuredClone(value);
}
function merge(a, ...layers) {
  let value = defaultData(a);
  for (const layer of layers) if (layer) value = { ...value, ...layer };
  return validate(a, value);
}
module.exports = { address, defaultData, validate, merge, definitions: defaults };
