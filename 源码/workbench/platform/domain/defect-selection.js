'use strict';
(function (root, factory) {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.DefectSelection = model;
})(typeof window === 'object' ? window : null, () => {
  function normalize(value = []) {
    if (
      !Array.isArray(value) ||
      value.length > 2000 ||
      value.some(
        (item) =>
          typeof item !== 'string' || !item || item.length > 512 || /[\x00-\x1f\x7f]/.test(item),
      )
    )
      throw Error('不良项须为明确名称列表，每项最长512字。');
    return [...new Set(value)];
  }
  function state(value = {}) {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).some((key) => key !== 'items')
    )
      throw Error('不良项配置无效。');
    return { items: normalize(value.items) };
  }
  return Object.freeze({ normalize, state });
});
