'use strict';
(function (root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  else root.LabelData = value;
})(typeof window === 'object' ? window : null, () => {
  const fields = Object.freeze(['code', 'name', 'spec', 'creator']);
  const limits = { code: 128, name: 100, spec: 100, creator: 60 };
  const titles = { code: '编号', name: '名称', spec: '规格', creator: '制作人' };
  function rows(value) {
    if (!Array.isArray(value) || value.length > 2000) throw Error('每批最多2000行。');
    return value.map((row, i) => {
      if (
        !row ||
        typeof row !== 'object' ||
        Array.isArray(row) ||
        Object.keys(row).some((k) => !fields.includes(k))
      )
        throw Error('标签行数据格式无效。');
      return Object.fromEntries(
        fields.map((key) => {
          const v = row[key] ?? '';
          if (typeof v !== 'string' || v.length > limits[key] || /[\u0000-\u001f\u007f]/.test(v))
            throw Error(`第${i + 1}行${titles[key]}过长或包含控制字符。`);
          return [key, v];
        }),
      );
    });
  }
  function parse(text) {
    if (typeof text !== 'string' || text.length > 900000) throw Error('粘贴内容过长。');
    const matrix = [[]];
    let value = '',
      quoted = false,
      ended = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') {
          value += '"';
          i++;
        } else if (c === '"') {
          quoted = false;
          ended = true;
        } else value += c;
      } else if (c === '"' && !value && !ended) quoted = true;
      else if (c === '\t' || c === '\n' || c === '\r') {
        matrix.at(-1).push(value);
        value = '';
        ended = false;
        if (c !== '\t') {
          if (c === '\r' && text[i + 1] === '\n') i++;
          matrix.push([]);
        }
      } else {
        if (ended) throw Error('引号后的内容无效，请从Excel重新复制。');
        value += c;
      }
      if (matrix.length > 2002 || matrix.at(-1).length > 4)
        throw Error('请粘贴最多2000行、4列：编号、名称、规格、制作人。');
    }
    if (quoted) throw Error('粘贴内容的引号未闭合。');
    matrix.at(-1).push(value);
    while (matrix.length && matrix.at(-1).every((x) => x === '')) matrix.pop();
    if (matrix.some((row) => row.length > 4)) throw Error('最多支持4列，请检查复制范围。');
    return matrix;
  }
  function header(matrix) {
    const aliases = {
      编号: 'code',
      完整编号: 'code',
      夹具编号: 'code',
      SN: 'code',
      序列号: 'code',
      名称: 'name',
      标签名称: 'name',
      夹具名称: 'name',
      规格: 'spec',
      型号规格: 'spec',
      型号: 'spec',
      制作人: 'creator',
    };
    const keys =
      matrix[0]?.map((x) =>
        Object.hasOwn(aliases, x.trim())
          ? aliases[x.trim()]
          : fields.includes(x.trim())
            ? x.trim()
            : '',
      ) || [];
    return keys.includes('code') && keys.every(Boolean) && new Set(keys).size === keys.length
      ? keys
      : null;
  }
  function paste(
    input,
    text,
    { row = 0, column = 0, replace = false, recognizeHeader = false } = {},
  ) {
    const current = rows(input),
      matrix = parse(text);
    if (!Number.isInteger(row) || row < 0 || !Number.isInteger(column) || column < 0 || column > 3)
      throw Error('粘贴起点无效。');
    const mapping = recognizeHeader ? header(matrix) : null;
    if (mapping) matrix.shift();
    if (!matrix.length) throw Error('没有可粘贴的数据行。');
    const out = replace ? [] : current;
    if (replace) row = 0;
    if (row + matrix.length > 2000) throw Error('粘贴后超过2000行。');
    for (let i = 0; i < matrix.length; i++) {
      if (column + matrix[i].length > 4 && !mapping)
        throw Error('粘贴超出最后一列，请从更靠左的列开始。');
      while (out.length <= row + i) out.push({ code: '', name: '', spec: '', creator: '' });
      matrix[i].forEach((value, j) => {
        out[row + i][mapping ? mapping[j] : fields[column + j]] = value;
      });
    }
    return rows(out);
  }
  function edit(input, { field, find = '', replacement = '', selected = null, fill = false }) {
    const result = rows(input);
    if (
      !fields.includes(field) ||
      typeof find !== 'string' ||
      typeof replacement !== 'string' ||
      (!fill && !find)
    )
      throw Error('请选择列并填写查找内容。');
    if (
      selected !== null &&
      (!Array.isArray(selected) ||
        selected.some((i) => !Number.isInteger(i) || i < 0 || i >= result.length))
    )
      throw Error('选中行范围无效。');
    let changed = 0;
    result.forEach((r, i) => {
      if (selected !== null && !selected.includes(i)) return;
      const value = fill ? replacement : r[field].split(find).join(replacement);
      if (r[field] !== value) {
        r[field] = value;
        changed++;
      }
    });
    return { rows: rows(result), changed };
  }
  return Object.freeze({ fields, limits, titles, rows, parse, paste, edit });
});
