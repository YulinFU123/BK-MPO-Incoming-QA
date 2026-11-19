'use strict';
(function (root, factory) {
  if (typeof module === 'object' && module.exports)
    module.exports = factory(require('./code128-patterns'));
  else root.Code128 = factory(root.Code128Patterns);
})(typeof window === 'object' ? window : null, (patterns) => {
  function encode(value) {
    if (
      typeof value !== 'string' ||
      !value.length ||
      value.length > 128 ||
      /[^\x20-\x7e]/.test(value)
    )
      throw Error('Code 128条形码需要1至128个英文字母、数字或半角符号；中文编号请使用二维码。');
    const memo = new Map(),
      pair = (i) => /^\d{2}$/.test(value.slice(i, i + 2));
    function solve(i, set) {
      if (i === value.length) return [];
      const key = i + set;
      if (memo.has(key)) return memo.get(key);
      const options = [];
      if (set === 'B') options.push([value.charCodeAt(i) - 32, ...solve(i + 1, 'B')]);
      else options.push([100, value.charCodeAt(i) - 32, ...solve(i + 1, 'B')]);
      if (pair(i))
        options.push([
          ...(set === 'B' ? [99] : []),
          Number(value.slice(i, i + 2)),
          ...solve(i + 2, 'C'),
        ]);
      const best = options.reduce((a, b) => (b.length < a.length ? b : a));
      memo.set(key, best);
      return best;
    }
    let codes = [104, ...solve(0, 'B')];
    if (pair(0)) {
      const c = [105, ...solve(0, 'C')];
      if (c.length < codes.length) codes = c;
    }
    const checksum = codes.reduce((sum, code, index) => sum + code * (index || 1), 0) % 103;
    const symbols = [...codes, checksum, 106],
      bits = '0'.repeat(10) + symbols.map((i) => patterns[i]).join('') + '0'.repeat(10);
    return { symbols, bits, checksum, quiet: 10, modules: bits.length };
  }
  return Object.freeze({ encode });
});
