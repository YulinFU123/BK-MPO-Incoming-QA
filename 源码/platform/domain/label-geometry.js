'use strict';
(function (root, factory) {
  const t =
    typeof module === 'object' && module.exports ? require('./label-template') : root.LabelTemplate;
  if (typeof module === 'object' && module.exports) module.exports = factory(t);
  else root.LabelGeometry = factory(t);
})(typeof window === 'object' ? window : null, (templates) => {
  const round = (n) => Math.round(n * 1000) / 1000;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function bounds(elements) {
    if (!elements.length) return null;
    const x = Math.min(...elements.map((e) => e.x)),
      y = Math.min(...elements.map((e) => e.y));
    return {
      x,
      y,
      width: round(Math.max(...elements.map((e) => e.x + e.width)) - x),
      height: round(Math.max(...elements.map((e) => e.y + e.height)) - y),
    };
  }
  const chosen = (t, ids) => t.elements.filter((e) => ids.includes(e.id));
  function units(t, ids) {
    const map = new Map();
    for (const e of chosen(t, ids)) {
      const key = e.group || e.id;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(e);
    }
    return [...map.values()];
  }
  function expand(t, id) {
    const e = t.elements.find((e) => e.id === id);
    return e?.group
      ? t.elements.filter((n) => n.group === e.group).map((n) => n.id)
      : e
        ? [id]
        : [];
  }
  function move(t, ids, dx, dy) {
    const b = bounds(chosen(t, ids));
    if (!b) return t;
    dx = clamp(dx, -b.x, t.width - b.x - b.width);
    dy = clamp(dy, -b.y, t.height - b.y - b.height);
    return templates.validate({
      ...t,
      elements: t.elements.map((e) =>
        ids.includes(e.id) ? { ...e, x: round(e.x + dx), y: round(e.y + dy) } : e,
      ),
    });
  }
  function resize(t, ids, width, height, scaleText = true) {
    const selected = chosen(t, ids),
      b = bounds(selected);
    if (!b) return t;
    let sx = Math.max(0.001, width / b.width),
      sy = b.height ? Math.max(0.001, height / b.height) : 1;
    if (selected.some((e) => e.type === 'qr') || selected.length > 1) sx = sy = Math.min(sx, sy);
    const min = Math.max(...selected.filter((e) => e.type === 'qr').map((e) => 2 / e.width), 0.001);
    sx = Math.max(min, Math.min(sx, (t.width - b.x) / b.width));
    sy = Math.max(min, Math.min(sy, b.height ? (t.height - b.y) / b.height : sy));
    if (selected.some((e) => e.type === 'qr') || selected.length > 1) sx = sy = Math.min(sx, sy);
    return templates.validate({
      ...t,
      elements: t.elements.map((e) => {
        if (!ids.includes(e.id)) return e;
        return {
          ...e,
          x: round(b.x + (e.x - b.x) * sx),
          y: round(b.y + (e.y - b.y) * sy),
          width: round(e.width * sx),
          height: round(e.height * sy),
          ...(e.type === 'text' && scaleText
            ? { fontSize: round(clamp(e.fontSize * Math.min(sx, sy), 3, 96)) }
            : {}),
        };
      }),
    });
  }
  function align(t, ids, action, target = 'label') {
    const all = chosen(t, ids),
      reference =
        target === 'selection' ? bounds(all) : { x: 0, y: 0, width: t.width, height: t.height };
    if (!reference) return t;
    let next = t;
    for (const members of units(t, ids)) {
      const b = bounds(members),
        r = reference;
      const dx =
        action === 'left'
          ? r.x - b.x
          : action === 'center'
            ? r.x + (r.width - b.width) / 2 - b.x
            : action === 'right'
              ? r.x + r.width - b.width - b.x
              : 0;
      const dy =
        action === 'top'
          ? r.y - b.y
          : action === 'middle'
            ? r.y + (r.height - b.height) / 2 - b.y
            : action === 'bottom'
              ? r.y + r.height - b.height - b.y
              : 0;
      next = move(
        next,
        members.map((e) => e.id),
        dx,
        dy,
      );
    }
    return next;
  }
  function distribute(t, ids, axis) {
    const list = units(t, ids)
      .map((es) => ({ es, b: bounds(es) }))
      .sort((a, b) => a.b[axis] - b.b[axis]);
    if (list.length < 3) throw Error('均分间距需要选择至少三个对象或组合。');
    const size = axis === 'x' ? 'width' : 'height',
      first = list[0].b,
      last = list.at(-1).b;
    const gap =
      (last[axis] + last[size] - first[axis] - list.reduce((sum, u) => sum + u.b[size], 0)) /
      (list.length - 1);
    if (gap < 0) throw Error('所选对象没有足够空间，请先移开或缩小，再均分间距。');
    let cursor = first[axis],
      next = t;
    for (const { es, b } of list) {
      next = move(
        next,
        es.map((e) => e.id),
        axis === 'x' ? cursor - b.x : 0,
        axis === 'y' ? cursor - b.y : 0,
      );
      cursor += b[size] + gap;
    }
    return next;
  }
  function fit(t, ids, padding = 0, scaleText = true) {
    const b = bounds(chosen(t, ids));
    if (!b) return t;
    const ratio = Math.min(
      (t.width - 2 * padding) / b.width,
      (t.height - 2 * padding) / Math.max(2, b.height),
    );
    if (ratio <= 0) throw Error('内边距占满标签，请减小内边距。');
    const origin = move(t, ids, -b.x, -b.y),
      scaled = resize(origin, ids, b.width * ratio, b.height * ratio, scaleText),
      n = bounds(chosen(scaled, ids));
    return move(scaled, ids, (t.width - n.width) / 2 - n.x, (t.height - n.height) / 2 - n.y);
  }
  function snap(t, ids, dx, dy, tolerance = 0.6) {
    const b = bounds(chosen(t, ids));
    if (!b) return { dx, dy, guides: [] };
    const others = t.elements.filter((e) => !ids.includes(e.id)),
      guides = [];
    for (const [axis, size, total] of [
      ['x', 'width', t.width],
      ['y', 'height', t.height],
    ]) {
      const targets = [
        0,
        total / 2,
        total,
        ...others.flatMap((e) => [e[axis], e[axis] + e[size] / 2, e[axis] + e[size]]),
      ];
      let adjustment = Infinity,
        target;
      for (const edge of [0, 0.5, 1])
        for (const value of targets) {
          const delta = value - (b[axis] + (axis === 'x' ? dx : dy) + b[size] * edge);
          if (Math.abs(delta) < Math.abs(adjustment)) {
            adjustment = delta;
            target = value;
          }
        }
      if (Math.abs(adjustment) <= tolerance) {
        if (axis === 'x') dx += adjustment;
        else dy += adjustment;
        guides.push({ axis, value: target });
      }
    }
    return { dx: round(dx), dy: round(dy), guides };
  }
  return Object.freeze({
    bounds,
    chosen,
    units,
    expand,
    move,
    resize,
    align,
    distribute,
    fit,
    snap,
  });
});
