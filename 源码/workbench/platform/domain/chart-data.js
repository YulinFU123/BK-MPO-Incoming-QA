'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChartData = api;
})(typeof window === 'object' ? window : this, () => {
  function donut(items, total, { quantity = false } = {}) {
    const valid = quantity ? Number.isFinite : Number.isSafeInteger;
    if (!Array.isArray(items) || !valid(total) || total < 0)
      throw Error('环图需要有效的分类数组与非负整数总数。');
    let sum = 0;
    const rows = items.map((r) => {
      if (!r || typeof r.value !== 'string' || !valid(r.count) || r.count < 0)
        throw Error('环图分类数据无效。');
      sum += r.count;
      return { ...r, share: total ? r.count / total : 0 };
    });
    if (quantity ? Math.abs(sum - total) > Math.max(1, total) * 1e-9 : sum !== total)
      throw Error('分类合计与总数不一致，请重新读取数据。');
    return { items: rows, total };
  }
  function countAxis(maximum) {
    if (!Number.isFinite(maximum) || maximum < 0) throw Error('图表数值无效。');
    const max = Math.max(1, Math.ceil(maximum));
    let step = Math.max(1, Math.ceil(max / 4));
    const power = 10 ** Math.floor(Math.log10(step));
    step = [1, 2, 5, 10].find((n) => n * power >= step) * power;
    const top = Math.ceil(max / step) * step;
    return { top, step, ticks: Array.from({ length: top / step + 1 }, (_, i) => i * step) };
  }
  return { donut, countAxis };
});
