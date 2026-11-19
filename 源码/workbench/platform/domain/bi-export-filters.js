'use strict';
(function (root, factory) {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.BIFilterModel = model;
})(typeof window !== 'undefined' ? window : this, () => {
  const fields = [
    ['Product Type', '产品类型', 'list', ['Patch', 'Trunk']],
    [
      'FG_SPEC_PRODUCT_TYPE2',
      '连接器规格类型',
      'list',
      [
        '(空白)',
        'EBO-EBO',
        'EBO-LCD',
        'EBO-MPO',
        'LCD-LCD',
        'MMC_MPO',
        'MMC-LCD',
        'MMC-MMC',
        'MMC-MPO',
        'MPO-LCD',
        'MPO-MPO',
      ],
    ],
    [
      'Cost Center',
      '成本中心',
      'list',
      ['8141-1642', '8141-1802', '8141-1803', '8141-1812', '8141-1813', '8141-1815'],
    ],
    ['Channel Type', '通道类型', 'list', []],
    ['Mfg Order', '工单', 'list', []],
    ['Report Workflow', '报告工作流程', 'list', []],
    ['FG_Spec', '成品规格', 'list', []],
    ['Part Number', '料号', 'list', []],
    ['Disposition Type', '处置类型', 'list', []],
    ['Process Type', '工艺类型', 'list', ['(空白)', 'EBO', 'LCD', 'MMC', 'MMC24', 'MPO']],
    ['SN', 'SN编号', 'list', []],
    ['Shift', '班次', 'checkbox', ['白班', '晚班']],
    [
      'Site、Resource Category',
      '站点与楼层',
      'tree',
      [
        '(空白)\t(空白)',
        ...['1F', '3F', '4F', '5F', '6F', '7F', '8F', '9F'].map((x) => 'BK\tBK_' + x),
        'GL\tGL',
        'GL\tGL_5F',
        'HW\tHW',
        ...['1F', '3F', '4F', '5F', '6F', '7F', '8F'].map((x) => 'HW\tHW_' + x),
      ],
    ],
  ].map(([id, label, kind, reference]) => ({ id, label, kind, reference }));
  const plain = (x) => x && Object.getPrototypeOf(x) === Object.prototype;
  const fail = (m) => {
    throw Error(m);
  };
  const string = (x) =>
    typeof x === 'string' &&
    x.length > 0 &&
    x.length <= 512 &&
    !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(x);
  function normalize(input = {}) {
    if (!plain(input) || Object.keys(input).some((k) => !fields.some((f) => f.id === k)))
      fail('未知筛选字段。');
    const out = {};
    for (const f of fields) {
      const v = input[f.id] || { mode: 'keep', values: [] };
      if (
        !plain(v) ||
        Object.keys(v).some((k) => !['mode', 'values'].includes(k)) ||
        !['keep', 'all', 'include'].includes(v.mode) ||
        !Array.isArray(v.values) ||
        v.values.length > 2000 ||
        v.values.some((x) => !string(x))
      )
        fail('筛选格式无效：' + f.id);
      const values = [...new Set(v.values)];
      if (v.mode === 'include' && !values.length) fail('指定多选至少选择一个值：' + f.id);
      if (v.mode !== 'include' && values.length) fail('只有指定多选可以携带值：' + f.id);
      if (
        f.kind === 'tree' &&
        values.some((x) => x.split('\t').length !== 2 || x.split('\t').some((y) => !y))
      )
        fail('楼层须填写父级和子级，中间用Tab分隔。');
      out[f.id] = { mode: v.mode, values };
    }
    return out;
  }
  function dictionary(input) {
    if (
      !plain(input) ||
      input.format !== 'BK-MPO-PBI-OPTIONS' ||
      input.version !== 1 ||
      !plain(input.fields)
    )
      fail('请选择本功能采集的选项JSON。');
    const accepted = {},
      diagnostics = {};
    for (const f of fields) {
      const row = input.fields[f.id];
      if (!row) continue;
      diagnostics[f.id] = String(row.status || 'unknown');
      if (row.status !== 'success' || row.complete !== true) continue;
      if (
        !Array.isArray(row.values) ||
        row.values.length > 20000 ||
        row.values.some((x) => !string(x))
      )
        fail('选项内容无效：' + f.id);
      if (new Set(row.values).size !== row.values.length) fail('选项存在重复或层级冲突：' + f.id);
      accepted[f.id] = row.values.slice();
    }
    return { accepted, diagnostics };
  }
  function state(v) {
    if (!plain(v) || Object.keys(v).some((k) => !['filters', 'dictionary'].includes(k)))
      fail('筛选配置无效。');
    const result = { filters: normalize(v.filters || {}), dictionary: {} };
    if (!plain(v.dictionary || {})) fail('选项字典无效。');
    for (const [id, values] of Object.entries(v.dictionary || {})) {
      if (
        !fields.some((f) => f.id === id) ||
        !Array.isArray(values) ||
        values.length > 20000 ||
        values.some((x) => !string(x)) ||
        new Set(values).size !== values.length
      )
        fail('选项字典无效。');
      result.dictionary[id] = values.slice();
    }
    if (JSON.stringify(result).length > 750000) fail('配置过大，请分开管理大型编号字典。');
    return result;
  }
  return { fields, normalize, dictionary, state };
});
