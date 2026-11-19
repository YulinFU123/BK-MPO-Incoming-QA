'use strict';
const layout = require('./label-layout');
const data = require('./label-data');

const empty = () => ({
  schemaVersion: 3,
  revision: 0,
  autoRemember: true,
  rememberCodes: false,
  current: null,
  profiles: [],
});
function text(value, length, title) {
  if (typeof value !== 'string' || value.length > length || /[\u0000-\u001f\u007f]/.test(value))
    throw Error(`${title}过长或包含不支持的控制字符。`);
  return value;
}
function keys(value, allowed) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !allowed.includes(k))
  )
    throw Error('排版记忆格式无效。');
}
function composition(value, includeCodes) {
  keys(value, [
    'config',
    'name',
    'spec',
    'creator',
    'range',
    'codes',
    'creators',
    'dataMode',
    'records',
    'fit',
  ]);
  const result = {
    config: layout.config(value.config),
    name: text(value.name, 100, '名称'),
    creator: text(value.creator, 60, '制作人'),
    spec: text(value.spec ?? '', 100, '规格'),
    dataMode: value.dataMode ?? 'codes',
  };
  if (!['codes', 'table'].includes(result.dataMode)) throw Error('标签输入方式无效。');
  if (value.fit !== undefined) {
    keys(value.fit, ['mode', 'width', 'height']);
    if (
      !['scale', 'reflow'].includes(value.fit.mode) ||
      ![value.fit.width, value.fit.height].every((v) => Number.isFinite(v) && v >= 8 && v <= 1000)
    )
      throw Error('尺寸适配设置无效。');
    result.fit = { ...value.fit };
  }
  const range = value.range;
  keys(range, ['prefix', 'start', 'end', 'digits']);
  text(range.prefix, 115, '前缀');
  if (
    ![range.start, range.end, range.digits].every(Number.isSafeInteger) ||
    range.start < 0 ||
    range.end < range.start ||
    range.end > 999999999 ||
    range.end - range.start >= 2000 ||
    range.digits < 1 ||
    range.digits > 12
  )
    throw Error('连续编号范围无效。');
  result.range = { ...range };
  if (includeCodes) {
    const codes = value.codes ?? (result.dataMode === 'table' ? '' : undefined);
    const creators = value.creators ?? (result.dataMode === 'table' ? [] : undefined);
    if (
      typeof codes !== 'string' ||
      codes.length > 300000 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(codes)
    )
      throw Error('记忆编号内容过长或无效。');
    if (!Array.isArray(creators) || creators.length > 2000) throw Error('制作人对应表过长。');
    result.codes = codes;
    if (value.records !== undefined) result.records = data.rows(value.records);
    result.creators = creators.map((pair) => {
      if (!Array.isArray(pair) || pair.length !== 2) throw Error('制作人对应表无效。');
      return [text(pair[0], 128, '编号'), text(pair[1], 60, '制作人')];
    });
  }
  return result;
}
function validate(value) {
  keys(value, [
    'schemaVersion',
    'revision',
    'autoRemember',
    'rememberCodes',
    'current',
    'profiles',
  ]);
  if (
    ![1, 2, 3].includes(value.schemaVersion) ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    typeof value.autoRemember !== 'boolean' ||
    typeof value.rememberCodes !== 'boolean' ||
    !Array.isArray(value.profiles) ||
    value.profiles.length > 30
  )
    throw Error('排版记忆设置无效。');
  const ids = new Set();
  const profiles = value.profiles.map((p) => {
    keys(p, ['id', 'title', 'composition']);
    if (typeof p.id !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(p.id) || ids.has(p.id))
      throw Error('排版方案编号无效或重复。');
    ids.add(p.id);
    const title = text(p.title, 40, '方案名称').trim();
    if (!title) throw Error('请填写方案名称。');
    return { id: p.id, title, composition: composition(p.composition, false) };
  });
  const current =
    value.autoRemember && value.current !== null
      ? composition(value.current, value.rememberCodes)
      : null;
  return {
    schemaVersion: 3,
    revision: value.revision,
    autoRemember: value.autoRemember,
    rememberCodes: value.rememberCodes,
    current,
    profiles,
  };
}
module.exports = { empty, validate, composition };
