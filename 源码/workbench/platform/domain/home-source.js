'use strict';
const { PlatformError } = require('./errors');
const defaults = () => ({ mode: 'auto', channel: 'auto', dailyScope: '', employee: '' });
const homeColumnsDefaults = () => ({ sources: {} });
const homeColumnRoles = ['process', 'issue', 'employee', 'reporter', 'shift'];
function homeColumns(value) {
  const object = (v) => v && typeof v === 'object' && !Array.isArray(v);
  const valid = object(value) && Object.keys(value).every((k) => k === 'sources') &&
    object(value.sources) && Object.keys(value.sources).length <= 12 &&
    Object.entries(value.sources).every(([source, mapping]) =>
      /^[a-zA-Z0-9-]{1,64}$/.test(source) && object(mapping) &&
      Object.entries(mapping).every(([role, column]) =>
        homeColumnRoles.includes(role) && typeof column === 'string' && /^h_[a-f0-9]{16}$/.test(column)));
  if (!valid) throw new PlatformError('INVALID_SOURCE', '首页分析表头配置无效。');
  return structuredClone(value);
}
function preferences(value = {}) {
  const v = { ...defaults(), ...value };
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !Object.hasOwn(defaults(), k)) ||
    !['auto', 'bi', 'records'].includes(v.mode) ||
    !['auto', 'studio', 'daily', 'history'].includes(v.channel) ||
    ['dailyScope', 'employee'].some(
      (k) => typeof v[k] !== 'string' || v[k].length > 512 || /[\x00-\x1f]/.test(v[k]),
    )
  )
    throw new PlatformError('INVALID_SOURCE', '首页数据源设置无效。');
  return v;
}
function choose(records, bi, value) {
  const pref = preferences(value);
  const useBI =
    pref.mode === 'bi' || (pref.mode === 'auto' && (bi?.state === 'available' || bi?.hasData));
  return {
    source: useBI ? 'bi' : 'records',
    available: useBI ? bi?.state === 'available' : true,
    label: useBI ? 'BI不良数量' : '人工异常记录',
    notice:
      pref.mode === 'records'
        ? '按本工作区的手动录入记录统计，条数与检验件数分别计算。'
        : pref.mode === 'bi'
          ? bi?.state === 'available'
            ? '按本工作区BI报表的已确认数量统计。'
            : bi?.message || '当前范围没有可用BI数据，请核对来源和日期。'
          : bi?.state === 'available'
            ? 'BI数量与人工记录条数分开统计，不相加；BI责任员工与人工跟进负责人分别筛选。'
            : bi?.message || '当前范围无可用BI，显示人工异常记录。',
    manualCount: records.recordCount,
  };
}
function changesData(route, value) {
  if (!value || value.ok === false) return false;
  if (route === '/api/fusion/inbox')
    return Array.isArray(value.results) && value.results.some((r) => r.state === 'done');
  if (route === '/api/daily/import')
    return (
      Array.isArray(value.results) &&
      value.results.some((r) => ['新增', '替换并保留旧版'].includes(r.state))
    );
  return ['/api/scan', '/api/legacy'].includes(route);
}
function workspaceMode(value = 'auto') {
  if (!['auto', 'records', 'bi'].includes(value))
    throw new PlatformError('WORKSPACE_INVALID', '请选择手动录入不良或BI导入不良。');
  return value;
}
function effectivePreference(value, mode = 'auto') {
  const pref = preferences(value);
  mode = workspaceMode(mode);
  return mode === 'auto' ? pref : { ...pref, mode };
}
module.exports = { defaults, preferences, choose, changesData, workspaceMode, effectivePreference, homeColumnsDefaults, homeColumns };
