'use strict';
// Read-only catalog of package-local guide illustrations. No workspace paths or IPC.
(function (root, build) {
  if (typeof module === 'object' && module.exports) module.exports = build(
    require('./guide-manual'), require('./guide-quality'), require('./guide-tools'), require('./guide-bi'));
  else root.WorkbenchGuidePictures = build(root.GuideManual, root.GuideQuality, root.GuideTools, root.GuideBi);
})(globalThis, (...groups) => {
  const catalog = Object.create(null);
  const asset = /^assets\/guide-[a-z0-9-]+\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:png|svg)$/;
  const valid = pic => pic && typeof pic.label === 'string' && pic.label.trim() && asset.test(pic.file) &&
    ['capture','diagram'].includes(pic.kind) && Array.isArray(pic.rect) && pic.rect.length === 4 &&
    pic.rect.every(n => Number.isFinite(n) && n >= 0 && n <= 100) && pic.rect[2] > 0 && pic.rect[3] > 0 &&
    pic.rect[0] + pic.rect[2] <= 100.1 && pic.rect[1] + pic.rect[3] <= 100.1;
  for (const group of groups) for (const [id, rows] of Object.entries(group || {})) {
    if (Object.hasOwn(catalog, id)) throw Error('引导配图重复：' + id);
    catalog[id] = Object.freeze(rows.map(pic => valid(pic) ? Object.freeze({
      file: pic.file, label: pic.label, kind: pic.kind, rect: Object.freeze([...pic.rect]),
    }) : null));
  }
  return Object.freeze({
    ids: Object.freeze(Object.keys(catalog)),
    count: id => catalog[id]?.length || 0,
    get: (id, step) => Number.isInteger(step) && step >= 0 ? catalog[id]?.[step] || null : null,
  });
});
