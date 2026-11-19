'use strict';
(function (root, factory) {
  if (typeof module === 'object' && module.exports)
    module.exports = factory(require('./label-template'), require('./label-geometry'));
  else root.LabelEditing = factory(root.LabelTemplate, root.LabelGeometry);
})(typeof window === 'object' ? window : null, (templates, geometry) => {
  function copy(template, ids) {
    const t = templates.validate(template),
      elements = geometry.chosen(t, ids);
    if (!elements.length) throw Error('请先选择文字或线条。');
    if (elements.some((e) => e.type === 'qr'))
      throw Error('每张标签保留一个编号二维码；请单独选择需要复制的文字或线条。');
    return { version: 1, elements: structuredClone(elements), bounds: geometry.bounds(elements) };
  }
  function paste(template, clip, { x, y, offset = 2, id = () => crypto.randomUUID() } = {}) {
    const t = templates.validate(template);
    if (!clip || clip.version !== 1 || !Array.isArray(clip.elements) || !clip.elements.length)
      throw Error('请先在设计区复制对象。');
    // Validate clipboard as a complete template before using any geometry/style.
    const probe = templates.validate({
      ...t,
      version: clip.elements.some((e) => e.type === 'barcode') ? 2 : t.version,
      elements: [t.elements.find((e) => e.type === 'qr'), ...clip.elements],
    });
    const elements = probe.elements.slice(1),
      b = geometry.bounds(elements);
    if (t.elements.length + elements.length > 30)
      throw Error('复制后超过30个元素，请减少选区或移除不用的对象。');
    if (b.width > t.width || b.height > t.height)
      throw Error('复制内容大于当前标签，请先调整标签尺寸。');
    const left = Math.max(0, Math.min(x ?? b.x + offset, t.width - b.width));
    const top = Math.max(0, Math.min(y ?? b.y + offset, t.height - b.height));
    if (![left, top].every(Number.isFinite)) throw Error('粘贴位置无效。');
    const groups = new Map(),
      used = new Set(t.elements.map((e) => e.id));
    const fresh = (prefix) => {
      const value = prefix + id();
      if (!/^[a-zA-Z0-9-]{1,64}$/.test(value) || used.has(value))
        throw Error('对象编号冲突，复制未执行。');
      used.add(value);
      return value;
    };
    const added = elements.map((e) => {
      const result = {
        ...e,
        id: fresh('element-'),
        x: Math.round((left + e.x - b.x) * 1000) / 1000,
        y: Math.round((top + e.y - b.y) * 1000) / 1000,
      };
      if (e.group) {
        if (!groups.has(e.group)) groups.set(e.group, fresh('group-'));
        result.group = groups.get(e.group);
      }
      return result;
    });
    return {
      template: templates.validate({
        ...t,
        version: probe.version,
        elements: [...t.elements, ...added],
      }),
      ids: added.map((e) => e.id),
    };
  }
  function marquee(template, a, b, visibleIds = template.elements.map((e) => e.id)) {
    const rect = {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: Math.abs(a.x - b.x),
      height: Math.abs(a.y - b.y),
    };
    if (!Object.values(rect).every(Number.isFinite)) return [];
    const hits = template.elements.filter(
      (e) =>
        visibleIds.includes(e.id) &&
        e.x <= rect.x + rect.width &&
        e.x + e.width >= rect.x &&
        e.y <= rect.y + rect.height &&
        e.y + Math.max(e.height, 0.4) >= rect.y,
    );
    return [...new Set(hits.flatMap((e) => geometry.expand(template, e.id)))];
  }
  function format(template, ids, patch) {
    const allowed = ['fontSize', 'fontFamily', 'fontWeight', 'bold', 'align', 'valign', 'color'];
    if (Object.keys(patch).some((k) => !allowed.includes(k)))
      throw Error('批量格式只修改文字样式，不替换文字内容。');
    return templates.validate({
      ...template,
      elements: template.elements.map((e) =>
        ids.includes(e.id) && e.type === 'text' ? { ...e, ...patch } : e,
      ),
    });
  }
  return Object.freeze({ copy, paste, marquee, format });
});
