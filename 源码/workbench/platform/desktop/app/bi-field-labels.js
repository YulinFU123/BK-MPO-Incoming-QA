'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BIFieldLabels = api;
})(typeof window === 'object' ? window : null, () => {
  const process = (info) => (info?.grouping?.kind === 'productType' ? '产品类型' : '工序');
  const field = (info, key, fallback) => (key === 'process' ? process(info) : fallback);
  const columns = (specs, info) => specs.map(([key, label]) => [key, field(info, key, label)]);
  const filters = (specs, report) =>
    report?.primary?.source === 'bi' ? columns(specs, report.biSource) : specs;
  return Object.freeze({ process, field, columns, filters });
});
