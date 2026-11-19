'use strict';
window.createLabelDesigner = ({ getConfig, setConfig, getSource, onChange }) => {
  const $ = (id) => document.getElementById(id),
    model = window.LabelLayout,
    templates = window.LabelTemplate,
    geometry = window.LabelGeometry,
    editing = window.LabelEditing,
    surface = window.LabelRender,
    ns = 'http://www.w3.org/2000/svg';
  const canvas = $('labelDesignCanvas'),
    stage = $('labelDesignStage');
  let selected = 'qr',
    selection = ['qr'],
    index = 0,
    working = null,
    lastConfig = null,
    past = [],
    future = [],
    drag = null,
    pendingProperty = null,
    propertyTimer,
    clipboard = null,
    pasteCount = 0,
    context = null,
    guides = [],
    guideDrag = null,
    guideMove = null,
    marqueeBox = null,
    textLayer = null,
    inlineEditor = null,
    showMeasures = typeof localStorage === 'undefined' || localStorage.getItem('labelShowMeasures') !== '0',
    showOutline = typeof localStorage === 'undefined' || localStorage.getItem('labelShowOutline') !== '0';
  const clone = (v) => structuredClone(v),
    round = (n) => Math.round(n * 1000) / 1000,
    clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const names = {
    qr: '二维码',
    code: '编号',
    name: '名称',
    spec: '规格',
    creator: '制作人',
    fixed: '固定文字',
    line: '横线',
    barcode: '条形码 Code 128',
  };
  function selectionIds() {
    if (!working || selected === 'border') return [];
    selection = selection.filter((id) => working.template.elements.some((e) => e.id === id));
    if (!selection.includes(selected)) selection = [selected];
    if (selection.length === 1 && working.template.elements.find((e) => e.id === selected)?.group)
      selection = geometry.expand(working.template, selected);
    return selection;
  }
  function choose(ids) {
    selection = [...new Set(ids)];
    selected = selection[0] || 'border';
  }
  function changeTemplate(work) {
    flushPending();
    if (!working) return;
    try {
      commit({
        ...working.c,
        composition: 'custom',
        template: work(clone(working.template), selectionIds()),
      });
    } catch (error) {
      $('labelDesignHint').textContent = error.message;
      $('labelDesignHint').classList.add('error');
    }
  }
  function view(mode) {
    flushPending();
    const design = mode === 'design';
    $('labelDesignView').hidden = !design;
    $('labelBatchView').hidden = design;
    $('labelViewDesign').setAttribute('aria-selected', String(design));
    $('labelViewBatch').setAttribute('aria-selected', String(!design));
    if (design) {
      refresh();
      fit();
    }
  }
  $('labelViewDesign').onclick = () => view('design');
  $('labelViewBatch').onclick = () => view('batch');
  for (const id of ['labelViewDesign', 'labelViewBatch'])
    $(id).onkeydown = (e) => {
      if (['ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        const next = e.key === 'ArrowRight' ? 'labelViewBatch' : 'labelViewDesign';
        $(next).click();
        $(next).focus();
      }
    };
  function source() {
    const c = getConfig(),
      input = getSource();
    let plan = input.plan;
    if (!plan)
      plan = model.plan(c, [
        {
          code: 'DESIGN-001',
          name: input.name || '',
          spec: input.spec || '',
          creator: input.creator || '',
        },
      ]);
    index = clamp(index, 0, plan.positions.length - 1);
    const template =
      c.composition === 'custom'
        ? templates.resize(c.template, c.width, c.height)
        : model.toTemplate(plan, index);
    return { c, plan, template, example: !input.plan };
  }
  function remember(c) {
    if (!past.length || JSON.stringify(past.at(-1)) !== JSON.stringify(c)) past.push(clone(c));
    if (past.length > 40) past.shift();
    future = [];
  }
  function commit(c, previous = lastConfig) {
    try {
      c = model.config(c);
      if (working && c.template?.elements.some((e) => e.type === 'barcode'))
        model.plan(
          c,
          working.plan.positions.map((p) => p.record),
        );
      if (previous && JSON.stringify(c) !== JSON.stringify(previous)) remember(previous);
      setConfig(c);
      onChange();
      return true;
    } catch (error) {
      refresh();
      $('labelDesignHint').textContent = error.message;
      $('labelDesignHint').classList.add('error');
      return false;
    }
  }
  function historyButtons() {
    $('designUndo').disabled = !past.length;
    $('designRedo').disabled = !future.length;
    $('designUndo').title = past.length ? `撤销（${past.length}步可撤销）` : '撤销';
    $('designRedo').title = future.length ? `重做（${future.length}步可重做）` : '重做';
  }
  let rulerScale = 1,
    rulerMark = null,
    zoom = 1,
    zoomFit = true,
    pan = { x: 0, y: 0 },
    panDrag = null,
    panSpace = false,
    wheelLastAt = 0;
  function fit() {
    if (!working || $('labelDesignView').hidden) return;
    const w = working.c.width,
      h = working.c.height,
      availableW = Math.max(120, stage.clientWidth - 48),
      availableH = Math.max(120, stage.clientHeight - 48),
      fitScale = Math.min(availableW / w, availableH / h);
    const scale = zoomFit ? fitScale : fitScale * zoom;
    canvas.style.width = w * scale + 'px';
    canvas.style.height = h * scale + 'px';
    canvas.style.transform = `translate(${pan.x}px, ${pan.y}px)`;
    rulerScale = scale;
    // 标尺零点与画布左上角对齐：stage 用 place-items:center 居中画布，
    // 用几何关系精确计算画布偏移（含 pan 平移），避免 getBoundingClientRect 的 reflow 时序问题。
    const cw = w * scale,
      ch = h * scale;
    const offsetX = (stage.clientWidth - cw) / 2 + pan.x;
    const offsetY = (stage.clientHeight - ch) / 2 + pan.y;
    try {
      $('labelRulerH').style.left = offsetX + 'px';
      $('labelRulerH').style.top = offsetY - 18 + 'px';
      $('labelRulerH').style.width = cw + 'px';
      $('labelRulerV').style.top = offsetY + 'px';
      $('labelRulerV').style.left = offsetX - 18 + 'px';
      $('labelRulerV').style.height = ch + 'px';
    } catch {}
    // 网格密度与吸附精度联动：网格像素 = 吸附步进 × 缩放，最小可见 6px
    const snapStep = $('designSnap').value === 'off' ? 1 : Number($('designSnap').value) || 0.5;
    let gridPx = snapStep * scale;
    if (gridPx < 6) gridPx = gridPx < 2 ? 5 * scale : Math.ceil(6 / snapStep) * snapStep * scale;
    try {
      stage.style.setProperty('--label-grid-size', Math.max(6, gridPx) + 'px');
    } catch {}
    renderRulers();
    layoutTextLayer();
    $('labelZoomValue').textContent = `${Math.round(scale * 100)}%`;
  }
  function setZoom(next, absolute = false) {
    if (!working) return;
    const w = working.c.width,
      h = working.c.height,
      availableW = Math.max(120, stage.clientWidth - 48),
      availableH = Math.max(120, stage.clientHeight - 48),
      fitScale = Math.min(availableW / w, availableH / h);
    const value = absolute ? next : zoomFit ? next : zoom * next;
    const clamped = clamp(value, 0.25, 8);
    if (absolute) {
      zoomFit = false;
      zoom = clamp(next / fitScale, 0.25, 8);
    } else {
      zoom = clamped;
      zoomFit = false;
    }
    fit();
  }
  function zoomFitView() {
    zoomFit = true;
    zoom = 1;
    pan = { x: 0, y: 0 };
    fit();
  }
  function renderRulers() {
    const h = $('labelRulerH'),
      v = $('labelRulerV');
    if (!working || !h || !v) return;
    const w = working.c.width,
      ht = working.c.height,
      step = rulerScale >= 6 ? 1 : rulerScale >= 2.4 ? 5 : rulerScale >= 0.9 ? 10 : 20;
    const reuse = rulerMark && rulerMark.w === w && rulerMark.ht === ht && rulerMark.step === step;
    const nodesFor = (total) => {
      let n = 0;
      for (let mm = 0; mm <= Math.ceil(total); mm += step) {
        n++;
        if (mm % (step * 5) === 0) n++;
      }
      return n;
    };
    const mk = (axis, total) => {
      const host = axis === 'h' ? h : v;
      // 刻度结构未变时只更新位置，不重建 DOM（连续滚轮缩放时避免大量节点反复创建）
      if (reuse && host.children.length === nodesFor(total)) {
        let i = 0;
        for (let mm = 0; mm <= Math.ceil(total); mm += step) {
          const pos = mm * rulerScale,
            major = mm % (step * 5) === 0,
            tick = host.children[i++];
          if (!tick) break;
          if (axis === 'h') tick.style.left = pos + 'px';
          else tick.style.top = pos + 'px';
          if (major) {
            const label = host.children[i++];
            if (label) {
              if (axis === 'h') label.style.left = pos + 2 + 'px';
              else label.style.top = pos + 2 + 'px';
            }
          }
        }
        return;
      }
      host.replaceChildren();
      for (let mm = 0; mm <= Math.ceil(total); mm += step) {
        const pos = mm * rulerScale,
          major = mm % (step * 5) === 0;
        const tick = document.createElement('span');
        tick.className = 'label-ruler-tick' + (major ? ' major' : '');
        if (axis === 'h') tick.style.left = pos + 'px';
        else tick.style.top = pos + 'px';
        host.append(tick);
        if (major) {
          const label = document.createElement('span');
          label.className = 'label-ruler-num';
          label.textContent = mm;
          if (axis === 'h') {
            label.style.left = pos + 2 + 'px';
            label.style.top = '1px';
          } else {
            label.style.top = pos + 2 + 'px';
            label.style.left = '2px';
            label.style.transform = 'rotate(-90deg)';
            label.style.transformOrigin = 'left top';
          }
          host.append(label);
        }
      }
    };
    mk('h', w);
    mk('v', ht);
    rulerMark = { w, ht, step };
  }
  function outline() {
    const svg = canvas.querySelector('svg');
    if (!svg || !working) return;
    for (const node of svg.querySelectorAll('[data-design-overlay]')) node.remove();
    const template = drag?.draft || working.template,
      ids = selectionIds();
    // 选中文字时，可见框紧贴真实文字墨迹；元素框仅保留为透明命中区，便于拖动/缩放
    const fitTextRect = (e) => {
      try {
        const nodes = [...svg.querySelectorAll(`[data-element-id="${e.id}"] text`)];
        const boxes = nodes
          .map((n) => (typeof n.getBBox === 'function' ? n.getBBox() : null))
          .filter((b) => b && b.width > 0 && b.height > 0);
        if (boxes.length) {
          const x1 = Math.min(...boxes.map((b) => b.x)),
            y1 = Math.min(...boxes.map((b) => b.y)),
            x2 = Math.max(...boxes.map((b) => b.x + b.width)),
            y2 = Math.max(...boxes.map((b) => b.y + b.height));
          return { x: x1 - 0.3, y: y1 - 0.3, width: x2 - x1 + 0.6, height: y2 - y1 + 0.6 };
        }
      } catch {}
      const lines = String(e.text || '').split('\n'),
        font = e.fontSize || 9,
        w = Math.max(1, ...lines.map((l) => model.textWidth(l, font))),
        h = lines.length * font * model.mmPerPt * 1.3;
      return {
        x:
          e.align === 'center'
            ? e.x + (e.width - w) / 2
            : e.align === 'right'
              ? e.x + e.width - w
              : e.x,
        y:
          e.valign === 'top' ? e.y : e.valign === 'bottom' ? e.y + e.height - h : e.y + (e.height - h) / 2,
        width: w,
        height: h,
      };
    };
    for (const e of template.elements) {
      const r = document.createElementNS(ns, 'rect');
      r.dataset.designOverlay = 'true';
      r.dataset.designId = e.id;
      r.setAttribute('x', e.x);
      r.setAttribute('y', e.y);
      r.setAttribute('width', e.width);
      r.setAttribute('height', Math.max(e.height, 0.8));
      r.setAttribute('fill', 'transparent');
      const isSelected = ids.includes(e.id);
      // 拖动过程中不收紧，避免 getBBox 与 transform 不一致导致框跳动；松手后自动贴合
      const tight =
        showOutline && !drag && isSelected && ids.length === 1 && e.type === 'text'
          ? fitTextRect(e)
          : null;
      r.setAttribute(
        'class',
        tight || !showOutline
          ? 'design-element design-element-hit'
          : isSelected
            ? 'design-element selected'
            : 'design-element',
      );
      if (!templates.visible(e, working.c)) r.classList.add('design-element-hidden');
      const title = document.createElementNS(ns, 'title');
      title.textContent = names[e.binding || e.type] || '元素';
      r.append(title);
      svg.append(r);
      if (tight) {
        const f = document.createElementNS(ns, 'rect');
        f.dataset.designOverlay = 'true';
        f.dataset.designId = e.id;
        for (const [key, value] of Object.entries(tight)) f.setAttribute(key, value);
        f.setAttribute('class', 'design-text-fit-box');
        svg.append(f);
      }
      if (e.id === selected && ids.length === 1) {
        const size = Math.max(0.7, (working.c.width * 7) / Math.max(120, canvas.clientWidth));
        const handle = document.createElementNS(ns, 'rect');
        handle.dataset.designOverlay = 'true';
        handle.dataset.designId = e.id;
        handle.dataset.designHandle = 'true';
        handle.setAttribute('x', e.x + e.width - size / 2);
        handle.setAttribute('y', e.y + e.height - size / 2);
        handle.setAttribute('width', size);
        handle.setAttribute('height', size);
        handle.setAttribute('class', 'design-resize-handle');
        svg.append(handle);
        // 四角标记：让选中框与元素边界精确贴合，一眼看清元素实际大小（含二维码静区）
        if (showOutline) {
          const corners = [
            [e.x, e.y],
            [e.x + e.width, e.y],
            [e.x, e.y + e.height],
            [e.x + e.width, e.y + e.height],
          ];
          const cm = Math.max(1.2, (working.c.width * 12) / Math.max(120, canvas.clientWidth));
          for (const [cx, cy] of corners) {
            const m = document.createElementNS(ns, 'rect');
            m.dataset.designOverlay = 'true';
            m.setAttribute('x', cx - cm / 2);
            m.setAttribute('y', cy - cm / 2);
            m.setAttribute('width', cm);
            m.setAttribute('height', cm);
            m.setAttribute('class', 'design-corner-mark');
            svg.append(m);
          }
        }
      }
    }
    if (ids.length > 1) {
      const b = geometry.bounds(geometry.chosen(template, ids));
      if (showOutline) {
        const r = document.createElementNS(ns, 'rect');
        r.dataset.designOverlay = 'true';
        for (const [key, value] of Object.entries(b)) r.setAttribute(key, value);
        r.setAttribute('class', 'design-selection-outline');
        svg.append(r);
      }
      const handle = document.createElementNS(ns, 'rect'),
        size = Math.max(0.7, (working.c.width * 8) / Math.max(120, canvas.clientWidth));
      for (const [key, value] of Object.entries({
        x: b.x + b.width - size / 2,
        y: b.y + b.height - size / 2,
        width: size,
        height: size,
        class: 'design-resize-handle',
      }))
        handle.setAttribute(key, value);
      handle.dataset.designOverlay = 'true';
      handle.dataset.designId = selected;
      handle.dataset.designHandle = 'true';
      handle.dataset.designGroupHandle = 'true';
      svg.append(handle);
    }
    if (selected === 'border' && showOutline) {
      const b = surface.borderBox(working.c, {
        x: 0,
        y: 0,
        width: working.c.width,
        height: working.c.height,
      });
      // 选中外框只画四角短标记，不再围一整圈大框，避免与标签内容混淆
      const arm = Math.max(2, Math.min(b.width, b.height) * 0.12);
      for (const [x, y, dx, dy] of [
        [b.x, b.y, 1, 1],
        [b.x + b.width, b.y, -1, 1],
        [b.x, b.y + b.height, 1, -1],
        [b.x + b.width, b.y + b.height, -1, -1],
      ]) {
        for (const [ex, ey] of [
          [x + dx * arm, y],
          [x, y + dy * arm],
        ]) {
          const tick = document.createElementNS(ns, 'line');
          tick.dataset.designOverlay = 'true';
          tick.setAttribute('x1', x);
          tick.setAttribute('y1', y);
          tick.setAttribute('x2', ex);
          tick.setAttribute('y2', ey);
          tick.setAttribute('class', 'design-corner-tick');
          svg.append(tick);
        }
      }
    }
    // 尺寸/间距标注：专业尺寸线（双向箭头 + 数值），纯辅助、可整体开关
    if (showMeasures && ids.length && selected !== 'border') {
      const isMulti = ids.length > 1;
      const chosen = geometry.chosen(template, ids);
      const sel = isMulti
        ? geometry.bounds(chosen)
        : working.template.elements.find((e) => e.id === selected);
      if (sel) {
        const font = Math.max(1.5, (working.c.width * 7) / Math.max(120, canvas.clientWidth));
        const arrow = Math.max(1.1, (working.c.width * 8) / Math.max(120, canvas.clientWidth));
        const gap = Math.max(2.2, (working.c.width * 12) / Math.max(120, canvas.clientWidth));
        const mk = (tag, attrs, cls) => {
          const el = document.createElementNS(ns, tag);
          el.dataset.designOverlay = 'true';
          if (cls) el.setAttribute('class', cls);
          for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
          svg.append(el);
          return el;
        };
        const text = (s, x, y, anchor, cls, baseline) => {
          const attrs = { x, y, 'font-size': font, 'font-family': 'Arial, sans-serif', 'text-anchor': anchor };
          if (baseline) attrs['dominant-baseline'] = baseline;
          const t = mk('text', attrs, cls);
          t.textContent = s;
          return t;
        };
        // 水平尺寸线：两端箭头 + 数值嵌在线正中间（线在数值处断开）
        const dimH = (x1, x2, y, label) => {
          const mid = (x1 + x2) / 2,
            half = Math.max(1.2, label.length * font * 0.34);
          mk('line', { x1, y1: y, x2: mid - half, y2: y }, 'design-dim-line');
          mk('line', { x1: mid + half, y1: y, x2, y2: y }, 'design-dim-line');
          mk('polygon', { points: `${x1},${y} ${x1 + arrow},${y - arrow / 2} ${x1 + arrow},${y + arrow / 2}` }, 'design-dim-arrow');
          mk('polygon', { points: `${x2},${y} ${x2 - arrow},${y - arrow / 2} ${x2 - arrow},${y + arrow / 2}` }, 'design-dim-arrow');
          text(label, mid, y, 'middle', 'design-measure design-measure-size', 'central');
        };
        // 竖直尺寸线：两端箭头 + 数值嵌在线正中间（线在数值处断开）
        const dimV = (y1, y2, x, label) => {
          const mid = (y1 + y2) / 2,
            half = Math.max(1.0, font * 0.8);
          mk('line', { x1: x, y1, x2: x, y2: mid - half }, 'design-dim-line');
          mk('line', { x1: x, y1: mid + half, x2: x, y2 }, 'design-dim-line');
          mk('polygon', { points: `${x},${y1} ${x - arrow / 2},${y1 + arrow} ${x + arrow / 2},${y1 + arrow}` }, 'design-dim-arrow');
          mk('polygon', { points: `${x},${y2} ${x - arrow / 2},${y2 - arrow} ${x + arrow / 2},${y2 - arrow}` }, 'design-dim-arrow');
          text(label, x, mid, 'middle', 'design-measure design-measure-size', 'central');
        };
        // 顶部总尺寸：宽 x 高 mm
        const topY = sel.y > 6 ? sel.y - 1.5 : sel.y + Math.max(sel.height, 6) + 2;
        text(`${round(sel.width)} x ${round(sel.height)} mm`, sel.x, topY, 'start', 'design-measure design-measure-size');
        // 宽度尺寸线：默认下方，贴底则上方
        const belowH = sel.y + sel.height + gap + font < working.c.height;
        const wY = belowH
          ? sel.y + sel.height + gap
          : sel.y > gap + font
            ? sel.y - gap
            : sel.y + sel.height + gap;
        dimH(sel.x, sel.x + sel.width, wY, `${round(sel.width)}`);
        // 高度尺寸线：默认左侧，贴左则右侧
        const leftV = sel.x - gap - font * 2 > 0;
        const vX = leftV ? sel.x - gap : sel.x + sel.width + gap;
        dimV(sel.y, sel.y + sel.height, vX, `${round(sel.height)}`);
        // 单个元素：到标签四边的间距
        if (!isMulti) {
          const gy = belowH ? wY + gap + font : topY - gap - 0.5;
          text(
            `左${round(sel.x)} 上${round(sel.y)} 右${round(working.c.width - sel.x - sel.width)} 下${round(working.c.height - sel.y - sel.height)}`,
            sel.x,
            gy,
            'start',
            'design-measure design-measure-gap',
          );
        }
        // 两个元素：显示两者之间的间距
        if (ids.length === 2 && chosen.length === 2) {
          const [a, b] = chosen;
          const hx = a.x + a.width <= b.x ? b.x - (a.x + a.width) : b.x + b.width <= a.x ? a.x - (b.x + b.width) : null;
          const vy = a.y + a.height <= b.y ? b.y - (a.y + a.height) : b.y + b.height <= a.y ? a.y - (b.y + b.height) : null;
          if (hx !== null && hx >= -0.001) {
            const midX = (Math.max(a.x + a.width, b.x + b.width) + Math.min(a.x, b.x)) / 2;
            const midY = (a.y + a.height / 2 + b.y + b.height / 2) / 2;
            dimH(Math.min(a.x + a.width, b.x + b.width), Math.max(a.x, b.x), midY, `${round(hx)}`);
            text(`间距 ${round(hx)}`, midX, midY - arrow - 0.3, 'middle', 'design-measure design-measure-gap');
          } else if (vy !== null && vy >= -0.001) {
            const midX = (a.x + a.width / 2 + b.x + b.width / 2) / 2;
            dimV(Math.min(a.y + a.height, b.y + b.height), Math.max(a.y, b.y), midX, `${round(vy)}`);
            text(`间距 ${round(vy)}`, midX + arrow + 0.3, (a.y + a.height / 2 + b.y + b.height / 2) / 2, 'start', 'design-measure design-measure-gap');
          }
        }
      }
    }
    // 绘制持久参考线（从标尺拖出）
    for (const g of guides) {
      const coords =
        g.axis === 'x'
          ? { x1: g.value, x2: g.value, y1: 0, y2: working.c.height }
          : { x1: 0, x2: working.c.width, y1: g.value, y2: g.value };
      // 透明宽命中层：让单击删除更容易点中细线
      const hit = document.createElementNS(ns, 'line');
      hit.dataset.designOverlay = 'true';
      hit.dataset.designGuide = g.axis;
      hit.setAttribute('class', 'design-guide-hit');
      for (const [key, value] of Object.entries(coords)) hit.setAttribute(key, value);
      svg.append(hit);
      const line = document.createElementNS(ns, 'line');
      line.dataset.designOverlay = 'true';
      line.dataset.designGuide = g.axis;
      line.setAttribute('class', 'design-guide design-guide-persistent');
      for (const [key, value] of Object.entries(coords)) line.setAttribute(key, value);
      svg.append(line);
    }
    // 正在拖出的参考线
    if (guideDrag) {
      const g = guideDrag,
        line = document.createElementNS(ns, 'line');
      line.dataset.designOverlay = 'true';
      line.setAttribute('class', 'design-guide design-guide-active');
      for (const [key, value] of Object.entries(
        g.axis === 'x'
          ? { x1: g.value, x2: g.value, y1: 0, y2: working.c.height }
          : { x1: 0, x2: working.c.width, y1: g.value, y2: g.value },
      ))
        line.setAttribute(key, value);
      svg.append(line);
    }
  }
  function properties() {
    if (!working) return;
    const c = working.c,
      ids = selectionIds(),
      multi = ids.length > 1,
      selectedItems = geometry.chosen(working.template, ids),
      e = multi
        ? geometry.bounds(selectedItems)
        : working.template.elements.find((e) => e.id === selected);
    const options = [
      new Option('外框', 'border'),
      ...working.template.elements.map(
        (e) =>
          new Option(
            (names[e.binding || e.type] || '元素') +
              (e.type === 'text' && e.binding === 'fixed' ? '：' + e.text.slice(0, 12) : '') +
              (!templates.visible(e, c) ? '（未显示）' : ''),
            e.id,
          ),
      ),
    ];
    $('designElement').replaceChildren(...options);
    if (selected !== 'border' && !e)
      selected = working.template.elements.find((e) => e.type === 'qr')?.id || 'border';
    $('designElement').value = selected;
    $('designMode').value = c.composition;
    // 外框参数属于整张标签，常驻显示，不必先选中"外框"才能调线宽
    $('designBorderPanel').hidden = false;
    $('designElementPanel').hidden = selected === 'border';
    $('labelAutoControls').hidden = c.composition === 'custom';
    for (const [key, id] of Object.entries({
      borderWidth: 'designBorderWidth',
      borderInset: 'designBorderInset',
      borderRadius: 'designBorderRadius',
      borderStyle: 'designBorderStyle',
      borderColor: 'designBorderColor',
    }))
      $(id).value = c[key];
    $('designDelete').disabled = !ids.length;
    for (const id of ['designCopy', 'designCut', 'designDuplicate'])
      $(id).disabled = $('designDelete').disabled;
    $('designPaste').disabled = !clipboard;
    $('designObjectList').replaceChildren(
      ...working.template.elements
        .map((item, i, arr) => ({ item, layer: arr.length - i }))
        .map(({ item, layer }) => {
          const row = document.createElement('div');
          row.className = 'design-object-row';
          row.dataset.designId = item.id;
          const selectBtn = document.createElement('button');
          selectBtn.type = 'button';
          selectBtn.className = 'design-object-select';
          selectBtn.setAttribute('aria-pressed', String(ids.includes(item.id)));
          selectBtn.title = item.id;
          const typeIcon = document.createElement('span');
          typeIcon.className = 'design-object-icon';
          typeIcon.textContent =
            item.type === 'qr' ? '▦' : item.type === 'barcode' ? '▤' : item.type === 'line' ? '—' : 'T';
          const label = document.createElement('span');
          label.className = 'design-object-label';
          label.textContent =
            (names[item.binding || item.type] || '对象') +
            (item.type === 'text' && item.binding === 'fixed' ? '：' + item.text.slice(0, 12) : '');
          const sizeTag = document.createElement('span');
          sizeTag.className = 'design-object-size';
          sizeTag.title = `位置 (${round(item.x)}, ${round(item.y)}) mm`;
          sizeTag.textContent =
            item.type === 'line'
              ? `宽${round(item.width)}mm`
              : `${round(item.width)}×${round(item.height)}mm`;
          const layerTag = document.createElement('span');
          layerTag.className = 'design-object-layer';
          layerTag.textContent = `第${layer}层`;
          selectBtn.append(typeIcon, label);
          selectBtn.onclick = (event) => {
            flushPending();
            const expanded = geometry.expand(working.template, item.id),
              previous = selectionIds();
            choose(event.ctrlKey || event.shiftKey ? toggle(previous, expanded) : expanded);
            properties();
            outline();
            canvas.focus({ preventScroll: true });
          };
          const raiseBtn = document.createElement('button');
          raiseBtn.type = 'button';
          raiseBtn.className = 'design-object-action';
          raiseBtn.textContent = '↑';
          raiseBtn.title = '上移一层';
          raiseBtn.disabled = layer >= working.template.elements.length;
          raiseBtn.onclick = (event) => {
            event.stopPropagation();
            flushPending();
            changeTemplate((t) => geometry.reorder(t, geometry.expand(t, item.id), 'forward'));
            properties();
            outline();
          };
          const lowerBtn = document.createElement('button');
          lowerBtn.type = 'button';
          lowerBtn.className = 'design-object-action';
          lowerBtn.textContent = '↓';
          lowerBtn.title = '下移一层';
          lowerBtn.disabled = layer <= 1;
          lowerBtn.onclick = (event) => {
            event.stopPropagation();
            flushPending();
            changeTemplate((t) => geometry.reorder(t, geometry.expand(t, item.id), 'backward'));
            properties();
            outline();
          };
          row.append(selectBtn, sizeTag, layerTag, raiseBtn, lowerBtn);
          return row;
        }),
    );
    $('designSelectionInfo').textContent = ids.length
      ? `已选${ids.length}个元素${selectedItems.every((e) => e.group && e.group === selectedItems[0].group) ? '（组合）' : ''}；Ctrl / Shift多选，空白处拖动框选。`
      : '点击选择；Ctrl / Shift多选，空白处拖动框选。';
    $('designGroup').disabled = ids.length < 2;
    $('designUngroup').disabled = !selectedItems.some((e) => e.group);
    $('designFit').disabled = !ids.length;
    for (const id of ['designBringFront', 'designSendBack', 'designBringForward', 'designSendBackward'])
      $(id).disabled = !ids.length;
    const units = geometry.units(working.template, ids).length;
    $('designDistributeX').disabled = $('designDistributeY').disabled = units < 3;
    document.querySelectorAll('[data-design-align]').forEach((b) => (b.disabled = !ids.length));
    if (e) {
      $('designElementTitle').textContent = multi
        ? '组合 / 多选范围'
        : names[e.binding || e.type] || '元素';
      for (const [key, id] of Object.entries({
        x: 'designX',
        y: 'designY',
        width: 'designWidth',
        height: 'designHeight',
      }))
        $(id).value = Number(e[key]).toFixed(2);
      $('designHeight').disabled = !multi && !['text', 'barcode'].includes(e.type);
      const texts = selectedItems.filter((item) => item.type === 'text');
      $('designTextPanel').hidden = !texts.length;
      $('designBinding').disabled = $('designText').disabled = multi;
      $('designLinePanel').hidden = e.type !== 'line';
      if (texts.length) {
        const e = texts[0];
        $('designBinding').value = e.binding;
        $('designText').value = e.text;
        $('designFont').value = e.fontSize;
        $('designAlign').value = e.align;
        $('designValign').value = e.valign;
        $('designFontFamily').value = e.fontFamily;
        $('designTextColor').value = e.color;
        const weightOf = (item) => item.fontWeight ?? (item.bold ? 700 : 400);
        $('designFontWeight').value = weightOf(e);
        $('designBold').checked = weightOf(e) >= 600;
        $('designBold').indeterminate = texts.some((item) => weightOf(item) >= 600 !== weightOf(e) >= 600);
        for (const [key, id] of Object.entries({
          fontSize: 'designFont',
          fontFamily: 'designFontFamily',
          fontWeight: 'designFontWeight',
          align: 'designAlign',
          valign: 'designValign',
        })) {
          const mixed = texts.some((item) => item[key] !== e[key]);
          $(id).title = mixed ? '多选对象格式不同；修改后统一应用到所选文字' : '';
        }
      }
      if (e.type === 'line') {
        $('designLineWidth').value = e.strokeWidth;
        $('designLineColor').value = e.color;
      }
    }
    // 底部尺寸栏：选中对象时同步显示其位置与尺寸（含方向键/属性微调后的实时值）
    if (e && selected !== 'border') {
      const box = multi ? geometry.bounds(selectedItems) : e;
      $('labelDesignDimensions').textContent =
        `${working.c.width} × ${working.c.height} mm　位置 ${round(box.x)}, ${round(box.y)}　大小 ${round(box.width)} × ${round(box.height)}`;
    }
    historyButtons();
  }
  function refresh() {
    try {
      working = source();
      if (selected !== 'border' && !working.template.elements.some((e) => e.id === selected))
        choose(working.template.elements.find((e) => e.type === 'qr') ? [working.template.elements.find((e) => e.type === 'qr').id] : []);
      if (working.c.composition === 'auto' && working.c.qrMode === 'auto')
        $('labelQrSize').value = working.plan.qrSize;
      lastConfig = clone(working.c);
      canvas.innerHTML = surface.labelSvg(working.plan, index);
      buildTextLayer();
      fit();
      outline();
      properties();
      $('labelDesignDimensions').textContent = `${working.c.width} × ${working.c.height} mm`;
      $('labelDesignDimensions').title =
        '方向键微调 0.1mm，Shift+方向键 1mm；拖动时此处显示实时坐标';
      $('designRecordCount').textContent = working.example
        ? '设计用示例'
        : `第${index + 1} / ${working.plan.positions.length}条`;
      $('designPrevious').disabled = working.example || index === 0;
      $('designNext').disabled = working.example || index === working.plan.positions.length - 1;
      $('labelDesignHint').classList.remove('error');
      $('labelDesignHint').textContent =
        (working.c.composition === 'custom'
          ? '自定义模板将用于所有编号；可逐条查看内容适配。'
          : '自动适配。拖动元素或修改位置后会转为自定义模板。') +
        ' 单击文字即可直接在那行字上打字。';
      if (working.template.elements.some((e) => e.type === 'barcode'))
        $('labelDesignHint').textContent +=
          ' 条形码与当前编号同步，宽度含两侧静区；可分别调整宽高。 ' +
          working.plan.warnings.join(' ');
      syncMeasureToggle();
      syncOutlineToggle();
    } catch (error) {
      working = null;
      inlineEditor = null;
      textLayer = null;
      canvas.replaceChildren();
      $('labelDesignHint').textContent = error.message;
      $('labelDesignHint').classList.add('error');
      historyButtons();
    }
  }
  function editElement(patch, elementId = selected) {
    if (!working) return;
    const c = clone(working.c),
      ids = selectionIds();
    let template = clone(working.template);
    if (ids.length > 1 && ids.includes(elementId)) {
      const styles = Object.fromEntries(
        Object.entries(patch).filter(([key]) =>
          ['fontSize', 'fontFamily', 'fontWeight', 'bold', 'align', 'valign', 'color'].includes(key),
        ),
      );
      if (Object.keys(styles).length) template = editing.format(template, ids, styles);
      let bounds = geometry.bounds(geometry.chosen(template, ids));
      if (Object.hasOwn(patch, 'width') || Object.hasOwn(patch, 'height'))
        template = geometry.resize(
          template,
          ids,
          patch.width ?? bounds.width,
          patch.height ?? bounds.height,
          $('designScaleText').checked,
        );
      bounds = geometry.bounds(geometry.chosen(template, ids));
      template = geometry.move(
        template,
        ids,
        (patch.x ?? bounds.x) - bounds.x,
        (patch.y ?? bounds.y) - bounds.y,
      );
    } else {
      const e = template.elements.find((e) => e.id === elementId);
      if (!e) return;
      Object.assign(e, patch);
      if (e.type === 'qr') e.height = e.width;
      if (patch.binding === 'name') c.showName = true;
      if (patch.binding === 'code') c.showCode = true;
    }
    return commit({ ...c, composition: 'custom', template });
  }
  // 画布内就地编辑文字：单击文字 / 添加文字后直接在画布上打字，无需切到右侧属性栏
  function textFitSize(value, item) {
    const lines = String(value).split('\n'),
      font = item.fontSize || 9,
      longest = lines.reduce((a, line) => Math.max(a, model.textWidth(line, font)), 0);
    return {
      width: round(Math.min(Math.max(4, working.c.width - item.x - 0.2), Math.max(4, longest + 0.8))),
      height: round(
        Math.min(Math.max(3, working.c.height - item.y - 0.2), Math.max(3, lines.length * font * model.mmPerPt * 1.3)),
      ),
    };
  }
  // 常驻文字层：画布渲染时就为每个文字元素放好一个"输入单元"，它本身就是画布上看到的文字。
  // 单击只是把光标放进去，不新建任何元素、不切换任何框——真正的无感就地输入。
  // 字体与画布 SVG 共用同一份映射，避免设计视图和导出的字体不一致
  const fontStack = surface.fontFamily;
  function layoutTextLayer(list) {
    if (!textLayer || !working) return;
    const elements = list || working.template.elements;
    try {
      for (const cell of textLayer.children) {
        const e = elements.find((x) => x.id === cell.dataset.designTextId);
        if (!e) continue;
        // 用排版后的真实字号，避免自动缩字时与画布不一致；拖动草稿按字号变化比例同步缩放
        let fontMm = Number(cell.dataset.fontMm) || (e.fontSize || 9) * model.mmPerPt;
        if (list) {
          const base = working.template.elements.find((x) => x.id === e.id);
          if (base?.fontSize && e.fontSize)
            fontMm = (fontMm * e.fontSize) / base.fontSize;
        }
        const fontPx = Math.max(10, fontMm * rulerScale);
        cell.style.left = e.x * rulerScale + 'px';
        cell.style.top = e.y * rulerScale + 'px';
        cell.style.width = Math.max(1, e.width * rulerScale) + 'px';
        cell.style.height = Math.max(fontPx * 1.7, e.height * rulerScale) + 'px';
        cell.style.fontSize = fontPx + 'px';
        const lineCount = Math.max(1, String(cell.textContent || '').split('\n').length);
        cell.style.lineHeight = Math.max(fontPx * 1.3, (e.height * rulerScale) / lineCount) + 'px';
        cell.style.fontWeight = String(e.fontWeight ?? (e.bold ? 700 : 400));
        cell.style.color = e.color || '#111';
        cell.style.textAlign =
          e.align === 'center' ? 'center' : e.align === 'right' ? 'right' : 'left';
        cell.style.fontFamily = fontStack(e.fontFamily);
      }
    } catch {}
  }
  function buildTextLayer() {
    // 重建画布内容前清掉编辑态引用（保存由 closeInlineTextEditor 负责）
    inlineEditor = null;
    try {
      if (textLayer) textLayer.remove();
    } catch {}
    textLayer = null;
    if (!working) return;
    try {
      const svg = canvas.querySelector('svg');
      if (!svg) return;
      const layer = document.createElement('div');
      layer.className = 'design-text-layer';
      const record = working.plan?.positions?.[index]?.record || {};
      const hidden = [];
      for (const e of working.template.elements) {
        if (e.type !== 'text') continue;
        // 单元常驻：先建好，最后才隐藏 SVG 占位文字，避免中途异常导致文字消失
        const nodes = [...svg.querySelectorAll(`[data-element-id="${e.id}"] text`)];
        for (const n of nodes) hidden.push(n);
        const suffix = e.binding && e.binding !== 'fixed' ? String(record[e.binding] ?? '') : '';
        const cell = document.createElement('div');
        cell.className = 'design-text-cell';
        cell.dataset.designTextId = e.id;
        cell.setAttribute('contenteditable', 'false');
        cell.spellcheck = false;
        cell.textContent = String(e.text || '') + suffix;
        // 记录排版后的真实字号（mm），与画布 SVG 完全一致
        const svgFont = Number(nodes[0]?.getAttribute('font-size'));
        if (Number.isFinite(svgFont) && svgFont > 0) cell.dataset.fontMm = String(svgFont);
        layer.append(cell);
      }
      canvas.append(layer);
      textLayer = layer;
      // 单元本身常驻，事件也只绑一次；点击只是聚焦，不再创建任何元素
      layer.addEventListener('keydown', (ev) => {
        const cell = ev.target.closest?.('.design-text-cell.editing');
        if (!cell) return;
        ev.stopPropagation();
        if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) {
          ev.preventDefault();
          closeInlineTextEditor(true);
        } else if (ev.key === 'Escape') {
          ev.preventDefault();
          closeInlineTextEditor(false);
        }
      });
      layer.addEventListener('input', (ev) => {
        const cell = ev.target.closest?.('.design-text-cell.editing');
        if (cell && String(cell.textContent || '').length > 160) {
          cell.textContent = String(cell.textContent).slice(0, 160);
        }
      });
      layer.addEventListener('focusout', (ev) => {
        if (inlineEditor && inlineEditor.cell === ev.target) closeInlineTextEditor(true);
      });
      layoutTextLayer();
      // 常驻单元就位后才隐藏原 SVG 文字，保证始终只有一个可见文字
      for (const n of hidden) n.style.opacity = '0';
    } catch {
      textLayer = null;
    }
  }
  function closeInlineTextEditor(save) {
    if (!inlineEditor) return;
    const { cell, id, original, suffix } = inlineEditor;
    const raw = String(cell.textContent || '').replace(/\n$/, '');
    // 动态绑定文字只保存固定前缀，数据部分由编号等字段渲染
    const value = suffix && raw.endsWith(suffix) ? raw.slice(0, raw.length - suffix.length) : raw;
    const base = suffix ? original.slice(0, original.length - suffix.length) : original;
    inlineEditor = null;
    try {
      cell.setAttribute('contenteditable', 'false');
      cell.classList.remove('editing');
      cell.blur();
    } catch {}
    if (!save) cell.textContent = original;
    else if (value !== base) {
      const item = working?.template.elements.find((x) => x.id === id);
      const patch = { text: value };
      // 固定文字改完后框自动贴合新内容；动态绑定文字长度不定，保持原框
      if (item?.type === 'text' && (item.binding || 'fixed') === 'fixed')
        Object.assign(patch, textFitSize(value, item));
      editElement(patch, id);
    }
    try {
      canvas.focus({ preventScroll: true });
    } catch {}
  }
  function openInlineTextEditor(id) {
    closeInlineTextEditor(true);
    if (!textLayer || !working) return;
    const cell = [...(textLayer.children || [])].find((c) => c.dataset?.designTextId === id);
    if (!cell) return;
    const element = working.template.elements.find((x) => x.id === id);
    const record = working.plan?.positions?.[index]?.record || {};
    const suffix =
      element?.binding && element.binding !== 'fixed' ? String(record[element.binding] ?? '') : '';
    const original = String(cell.textContent || '');
    cell.setAttribute('contenteditable', 'plaintext-only');
    // 老内核不支持 plaintext-only 时退回普通可编辑，输入仍为纯文本（提交读 textContent）
    if (cell.contentEditable !== 'plaintext-only') cell.setAttribute('contenteditable', 'true');
    cell.classList.add('editing');
    inlineEditor = { cell, id, original, suffix };
    try {
      cell.focus({ preventScroll: true });
    } catch {}
    // 光标放到文字末尾：视觉上文字完全不变，接着打字即可
    try {
      const range = document.createRange();
      range.selectNodeContents(cell);
      range.collapse(false);
      const sel = window.getSelection?.();
      sel?.removeAllRanges();
      sel?.addRange(range);
    } catch {}
  }
  function cancelPending() {
    clearTimeout(propertyTimer);
    pendingProperty = null;
  }
  function flushPending() {
    clearTimeout(propertyTimer);
    const draft = pendingProperty;
    pendingProperty = null;
    if (!draft || !working || !Object.keys(draft.patch).length) return true;
    return draft.target === 'border'
      ? commit({ ...working.c, ...draft.patch })
      : editElement(draft.patch, draft.target);
  }
  function queueProperty(target, patch, immediate = false) {
    if (!working) return;
    if (pendingProperty && pendingProperty.target !== target) flushPending();
    pendingProperty = {
      target,
      patch: { ...pendingProperty?.patch, ...patch },
    };
    clearTimeout(propertyTimer);
    if (immediate) flushPending();
    else propertyTimer = setTimeout(flushPending, 250);
  }
  function bindProperty(id, key, target = 'element', numeric = false) {
    const node = $(id);
    const read = (immediate) => {
      if (numeric && (node.value.trim() === '' || !Number.isFinite(Number(node.value)))) {
        if (pendingProperty) delete pendingProperty.patch[key];
        if (immediate) {
          flushPending();
          refresh();
          $('labelDesignHint').textContent = '请输入有效数值；已保留上次有效设置。';
          $('labelDesignHint').classList.add('error');
        }
        return;
      }
      queueProperty(
        target === 'border' ? 'border' : selected,
        {
          [key]: numeric
            ? Number(node.value)
            : node.type === 'checkbox'
              ? node.checked
              : node.value,
        },
        immediate,
      );
    };
    node.oninput = () => read(false);
    node.onchange = () => read(true);
    node.onkeydown = (event) => {
      if (event.key === 'Enter' && node.tagName !== 'TEXTAREA') {
        event.preventDefault();
        read(true);
      }
    };
  }
  $('designElement').onchange = () => {
    const next = $('designElement').value;
    flushPending();
    choose(next === 'border' ? [] : geometry.expand(working.template, next));
    properties();
    outline();
  };
  $('designMode').onchange = () => {
    const mode = $('designMode').value;
    flushPending();
    if (!working) return;
    commit({ ...working.c, composition: mode, template: clone(working.template) });
  };
  for (const [key, id] of Object.entries({
    x: 'designX',
    y: 'designY',
    width: 'designWidth',
    height: 'designHeight',
  }))
    bindProperty(id, key, 'element', true);
  for (const [key, id] of Object.entries({
    borderWidth: 'designBorderWidth',
    borderInset: 'designBorderInset',
    borderRadius: 'designBorderRadius',
  }))
    bindProperty(id, key, 'border', true);
  for (const [key, id] of Object.entries({
    borderStyle: 'designBorderStyle',
    borderColor: 'designBorderColor',
  }))
    bindProperty(id, key, 'border');
  $('designBinding').onchange = () => {
    const binding = $('designBinding').value;
    const text = binding === 'fixed' ? $('designText').value : '';
    flushPending();
    editElement({
      binding,
      text,
    });
  };
  for (const [key, id] of Object.entries({
    text: 'designText',
    align: 'designAlign',
    valign: 'designValign',
    fontFamily: 'designFontFamily',
    color: 'designTextColor',
  }))
    bindProperty(id, key);
  // 字重可自由填 100–900；"加粗"复选框作为快捷开关，两者保持同步
  const weightValue = () => clamp(Number($('designFontWeight').value) || 400, 100, 900);
  const syncBold = () => {
    $('designBold').checked = weightValue() >= 600;
    $('designBold').indeterminate = false;
  };
  $('designFontWeight').oninput = () => {
    syncBold();
    queueProperty(selected, { fontWeight: weightValue(), bold: weightValue() >= 600 });
  };
  $('designFontWeight').onchange = () => {
    syncBold();
    flushPending();
  };
  $('designFontWeight').onkeydown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      syncBold();
      flushPending();
    }
  };
  $('designBold').onchange = () => {
    const w = $('designBold').checked ? 700 : 400;
    $('designFontWeight').value = w;
    cancelPending();
    editElement({ fontWeight: w, bold: w >= 600 });
  };
  bindProperty('designFont', 'fontSize', 'element', true);
  bindProperty('designLineWidth', 'strokeWidth', 'element', true);
  bindProperty('designLineColor', 'color');
  function add(type) {
    flushPending();
    if (!working) return;
    const c = clone(working.c),
      t = clone(working.template),
      id = 'element-' + crypto.randomUUID();
    if (t.elements.length >= 30) {
      $('labelDesignHint').textContent = '每个模板最多30个元素，可先移除不再使用的内容。';
      return;
    }
    // 新增文字时按内容与字号自动算出刚好贴合的框，不再给接近整张标签宽的大框
    const sampleText = '自定义文字',
      sampleFont = 9,
      fitW = round(Math.min(c.width - 2, Math.max(4, model.textWidth(sampleText, sampleFont) + 0.8))),
      fitH = round(Math.min(c.height - 2, Math.max(3, sampleFont * model.mmPerPt * 1.3)));
    const e =
      type === 'barcode'
        ? {
            id,
            type,
            x: 1,
            y: Math.max(0, c.height - Math.min(8, c.height - 2) - 1),
            width: c.width - 2,
            height: Math.min(8, c.height - 2),
          }
        : type === 'text'
          ? {
              id,
              type,
              x: Math.min(2, c.width / 10),
              y: Math.max(0, round(c.height - fitH - 1)),
              width: fitW,
              height: fitH,
              binding: 'fixed',
              text: sampleText,
              fontSize: sampleFont,
              bold: false,
              fontWeight: 400,
              align: 'left',
              color: '#111111',
            }
          : {
              id,
              type,
              x: 1,
              y: round(c.height * 0.8),
              width: c.width - 2,
              height: 0,
              strokeWidth: 0.2,
              color: '#666666',
            };
    t.elements.push(e);
    if (type === 'barcode') {
      t.version = 2;
      let best = { y: e.y, score: Infinity };
      for (let y = 1; y <= c.height - e.height - 1; y += 1) {
        const score = t.elements
          .filter((o) => o.id !== e.id && templates.visible(o, c))
          .reduce(
            (sum, o) =>
              sum +
              Math.max(0, Math.min(e.x + e.width, o.x + o.width) - Math.max(e.x, o.x)) *
                Math.max(
                  0,
                  Math.min(y + e.height, o.y + Math.max(0.2, o.height)) - Math.max(y, o.y),
                ) *
                (o.type === 'qr' ? 3 : 1),
            0,
          );
        if (score <= best.score) best = { y, score };
      }
      e.y = best.y;
    }
    choose([id]);
    commit({ ...c, composition: 'custom', template: t });
    // 添加文字后立刻进入画布内输入，省去再到右侧属性栏填写
    if (type === 'text') openInlineTextEditor(id);
  }
  $('designAddText').onclick = () => add('text');
  $('designAddLine').onclick = () => add('line');
  $('designAddBarcode').onclick = () => add('barcode');
  $('designDelete').onclick = () => {
    flushPending();
    if (!working || $('designDelete').disabled) return;
    const t = clone(working.template);
    const ids = selectionIds();
    const deletingQr = ids.some((id) => t.elements.find((e) => e.id === id)?.type === 'qr');
    t.elements = t.elements.filter((e) => !ids.includes(e.id));
    choose([]);
    commit({ ...working.c, composition: 'custom', template: t });
    if (deletingQr && !t.elements.some((e) => e.type === 'qr'))
      feedback('二维码已删除；该标签将无法扫码追溯，如需恢复可撤销或重新添加二维码。');
  };
  $('designReset').onclick = () => {
    flushPending();
    if (working) commit({ ...working.c, composition: 'auto' });
  };
  $('designUndo').onclick = () => {
    flushPending();
    if (!past.length) return;
    future.push(clone(getConfig()));
    const c = past.pop();
    setConfig(c);
    onChange();
  };
  $('designRedo').onclick = () => {
    flushPending();
    if (!future.length) return;
    past.push(clone(getConfig()));
    const c = future.pop();
    setConfig(c);
    onChange();
  };
  $('designPrevious').onclick = () => {
    flushPending();
    index--;
    refresh();
  };
  $('designNext').onclick = () => {
    flushPending();
    index++;
    refresh();
  };
  $('labelZoomIn').onclick = () => setZoom(1.25);
  $('labelZoomOut').onclick = () => setZoom(0.8);
  $('labelZoomFit').onclick = () => zoomFitView();
  $('labelZoom100').onclick = () => setZoom(1, true);
  $('labelToggleMeasures').onclick = () => {
    showMeasures = !showMeasures;
    try {
      localStorage.setItem('labelShowMeasures', showMeasures ? '1' : '0');
    } catch {}
    syncMeasureToggle();
    outline();
  };
  $('labelClearGuides').onclick = () => {
    guides = [];
    outline();
    $('labelClearGuides').hidden = true;
    feedback('已清除所有辅助参考线。');
  };
  $('labelToggleOutline').onclick = () => {
    showOutline = !showOutline;
    try {
      localStorage.setItem('labelShowOutline', showOutline ? '1' : '0');
    } catch {}
    syncOutlineToggle();
    outline();
  };
  // 从画布外（stage 空白区）按下并拖动，也可框选贴边对象
  stage.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !working || panSpace || drag) return;
    // 点在画布内 / 标尺上则交给各自处理
    const canvasRect = canvas.getBoundingClientRect();
    const insideCanvas =
      event.clientX >= canvasRect.left &&
      event.clientX <= canvasRect.right &&
      event.clientY >= canvasRect.top &&
      event.clientY <= canvasRect.bottom;
    if (insideCanvas) return;
    if (event.target.closest('[data-design-guide]') || event.target.closest('.label-ruler')) return;
    closeContext();
    flushPending();
    // 框选坐标需基于画布（canvas）rect 换算，与画布内框选一致；用 stage rect 会因画布居中留白导致选框不跟随鼠标
    drag = {
      marquee: true,
      pointer: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      rect: canvasRect,
      c: clone(working.c),
      template: clone(working.template),
      draft: clone(working.template),
      seed: event.ctrlKey || event.shiftKey ? [...selectionIds()] : [],
      initial: [...selectionIds()],
      moved: false,
    };
    stage.setPointerCapture(event.pointerId);
    if (!drag.seed.length) choose([]);
    properties();
    outline();
    event.preventDefault();
  });
  stage.addEventListener('pointermove', (event) => {
    if (drag?.marquee && drag.pointer === event.pointerId) handleMarqueeMove(event);
  });
  stage.addEventListener('pointerup', (event) => {
    if (drag?.marquee && drag.pointer === event.pointerId) {
      if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
      drag = null;
      hideMarqueeBox();
      properties();
      outline();
    }
  });
  stage.addEventListener(
    'wheel',
    (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      // 同步处理、按时间丢弃过密事件：不用 rAF（窗口失焦/隐藏时 rAF 会暂停，标志位不复位会导致永久无响应），
      // 也不累积乘积（累积会因指数爆炸把缩放顶到上限，看起来像卡死）。
      const now = Date.now();
      if (now - wheelLastAt < 16) return;
      wheelLastAt = now;
      const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
      // 只传缩放因子；setZoom 内部会自行乘上当前 zoom
      setZoom(factor);
    },
    { passive: false },
  );
  // 从标尺拖出辅助参考线
  const syncMeasureToggle = () => {
    const btn = $('labelToggleMeasures');
    if (btn) {
      btn.setAttribute('aria-pressed', showMeasures ? 'true' : 'false');
      btn.classList.toggle('active', showMeasures);
      btn.textContent = showMeasures ? '尺寸标注 ✓' : '尺寸标注';
    }
  };
  const syncOutlineToggle = () => {
    const btn = $('labelToggleOutline');
    if (btn) {
      btn.setAttribute('aria-pressed', showOutline ? 'true' : 'false');
      btn.classList.toggle('active', showOutline);
      btn.textContent = showOutline ? '选中框 ✓' : '选中框';
    }
  };
  const syncGuidesButton = () => {
    const btn = $('labelClearGuides');
    if (btn) {
      btn.hidden = !guides.length;
      btn.textContent = guides.length ? `清除参考线（${guides.length}）` : '清除参考线';
    }
  };
  const rulerToMm = (axis, clientX, clientY) => {
    const rect = canvas.getBoundingClientRect();
    return axis === 'x'
      ? clamp(((clientX - rect.left) / rect.width) * working.c.width, 0, working.c.width)
      : clamp(((clientY - rect.top) / rect.height) * working.c.height, 0, working.c.height);
  };
  const snapMm = (v) => {
    const step = $('designSnap').value === 'off' ? 0.1 : Number($('designSnap').value);
    return Math.round(v / step) * step;
  };
  for (const [rulerId, axis] of [
    ['labelRulerH', 'x'],
    ['labelRulerV', 'y'],
  ]) {
    const ruler = $(rulerId);
    ruler.addEventListener('pointerdown', (event) => {
      if (!working || event.button !== 0) return;
      event.preventDefault();
      ruler.setPointerCapture(event.pointerId);
      // 先记为「可能拖动」，移动超过阈值才真正进入拖出参考线状态（避免单纯点击就添加）
      guideDrag = {
        axis,
        value: rulerToMm(axis, event.clientX, event.clientY),
        pointer: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        active: false,
      };
    });
    ruler.addEventListener('pointermove', (event) => {
      if (!guideDrag || guideDrag.pointer !== event.pointerId) return;
      const raw = rulerToMm(axis, event.clientX, event.clientY);
      const dist = Math.abs(event.clientX - guideDrag.startX) + Math.abs(event.clientY - guideDrag.startY);
      if (!guideDrag.active && dist > 3) guideDrag.active = true;
      if (!guideDrag.active) return;
      guideDrag.value = event.altKey ? round(raw) : snapMm(raw);
      outline();
    });
    ruler.addEventListener('pointerup', (event) => {
      if (!guideDrag || guideDrag.pointer !== event.pointerId) return;
      if (ruler.hasPointerCapture(event.pointerId)) ruler.releasePointerCapture(event.pointerId);
      const wasActive = guideDrag.active;
      const value = event.altKey ? round(guideDrag.value) : snapMm(guideDrag.value);
      // 先加入 guides，再清空 guideDrag，最后 outline，保证松手即显示
      if (wasActive && value > 0.01) {
        guides = guides.filter((g) => !(g.axis === axis && Math.abs(g.value - value) < 0.05));
        guides.push({ axis, value });
      }
      guideDrag = null;
      outline();
      syncGuidesButton();
    });
    ruler.addEventListener('pointercancel', () => {
      guideDrag = null;
      outline();
    });
  }
  document
    .querySelectorAll('[data-design-align]')
    .forEach(
      (button) =>
        (button.onclick = () =>
          changeTemplate((t, ids) =>
            geometry.align(t, ids, button.dataset.designAlign, $('designAlignTarget').value),
          )),
    );
  $('designSelectAll').onclick = () => {
    flushPending();
    if (working) {
      choose(
        working.template.elements.filter((e) => templates.visible(e, working.c)).map((e) => e.id),
      );
      properties();
      outline();
    }
  };
  $('designGroup').onclick = () =>
    changeTemplate((t, ids) => {
      const group = 'group-' + crypto.randomUUID();
      t.elements = t.elements.map((e) => (ids.includes(e.id) ? { ...e, group } : e));
      return t;
    });
  $('designUngroup').onclick = () =>
    changeTemplate((t, ids) => {
      t.elements = t.elements.map((e) => {
        if (!ids.includes(e.id)) return e;
        const next = { ...e };
        delete next.group;
        return next;
      });
      return t;
    });
  for (const [id, dir] of [
    ['designBringFront', 'front'],
    ['designSendBack', 'back'],
    ['designBringForward', 'forward'],
    ['designSendBackward', 'backward'],
  ])
    $(id).onclick = () => changeTemplate((t, ids) => geometry.reorder(t, ids, dir));
  $('designFit').onclick = () =>
    changeTemplate((t, ids) =>
      geometry.fit(t, ids, working.c.padding, $('designScaleText').checked),
    );
  $('designDistributeX').onclick = () =>
    changeTemplate((t, ids) => geometry.distribute(t, ids, 'x'));
  $('designDistributeY').onclick = () =>
    changeTemplate((t, ids) => geometry.distribute(t, ids, 'y'));
  function toggle(previous, ids) {
    return ids.every((id) => previous.includes(id))
      ? previous.filter((id) => !ids.includes(id))
      : [...new Set([...previous, ...ids])];
  }
  function feedback(message, error = false) {
    $('labelDesignHint').textContent = message;
    $('labelDesignHint').classList.toggle('error', error);
  }
  function copySelection(cut = false) {
    flushPending();
    if (!working) return;
    try {
      clipboard = editing.copy(working.template, selectionIds());
      pasteCount = 0;
      if (cut) $('designDelete').click();
      properties();
      feedback(`已${cut ? '剪切' : '复制'}${clipboard.elements.length}个对象；可按Ctrl+V粘贴。`);
    } catch (error) {
      feedback(error.message, true);
    }
  }
  function pasteSelection(duplicate = false, position = null) {
    flushPending();
    if (!working) return;
    try {
      const clip = duplicate ? editing.copy(working.template, selectionIds()) : clipboard;
      const result = editing.paste(
        working.template,
        clip,
        position || { offset: 2 * (duplicate ? 1 : pasteCount + 1) },
      );
      const before = [...selectionIds()];
      choose(result.ids);
      if (commit({ ...working.c, composition: 'custom', template: result.template })) {
        if (!duplicate) pasteCount++;
        feedback(`已添加${result.ids.length}个对象，可撤销。`);
      } else {
        choose(before);
        properties();
        outline();
      }
    } catch (error) {
      feedback(error.message, true);
    }
  }
  $('designCopy').onclick = () => copySelection();
  $('designCut').onclick = () => copySelection(true);
  $('designPaste').onclick = () => pasteSelection();
  $('designDuplicate').onclick = () => pasteSelection(true);
  function closeContext() {
    context?.remove();
    context = null;
  }
  // Ctrl + 左键一直按住 + 点右键 = 创建副本。
  // 注意：鼠标按住第一个键后再按第二个键，浏览器不会再触发 pointerdown（Pointer Events 规范），
  // 必须用 mousedown 捕获这个右键，否则组合键永远不生效。
  canvas.addEventListener('mousedown', (event) => {
    if (event.button !== 2 || !event.ctrlKey || !drag || drag.marquee || drag.copy) return;
    event.preventDefault();
    drag.copy = true;
    feedback('已标记复制，松开鼠标后生成副本。');
  });
  canvas.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    if (event.ctrlKey || drag) return;
    closeContext();
    const hit = event.target.closest('[data-design-id]')?.dataset.designId;
    if (hit && !selectionIds().includes(hit)) choose(geometry.expand(working.template, hit));
    properties();
    outline();
    context = document.createElement('div');
    context.className = 'design-context-menu';
    context.setAttribute('role', 'menu');
    const rect = canvas.getBoundingClientRect();
    const position = {
      x: clamp(((event.clientX - rect.left) / rect.width) * working.c.width, 0, working.c.width),
      y: clamp(((event.clientY - rect.top) / rect.height) * working.c.height, 0, working.c.height),
    };
    for (const [label, id, action] of [
      ['复制 Ctrl+C', 'designCopy', () => copySelection()],
      ['剪切 Ctrl+X', 'designCut', () => copySelection(true)],
      ['粘贴到这里 Ctrl+V', 'designPaste', () => pasteSelection(false, position)],
      ['创建副本 Ctrl+D', 'designDuplicate', () => pasteSelection(true)],
      ['删除 Delete', 'designDelete', () => $('designDelete').click()],
    ]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('role', 'menuitem');
      button.textContent = label;
      button.disabled = $(id).disabled;
      button.onclick = () => {
        closeContext();
        action();
        canvas.focus({ preventScroll: true });
      };
      context.append(button);
    }
    document.body.append(context);
    context.style.left =
      Math.max(8, Math.min(event.clientX, innerWidth - context.offsetWidth - 8)) + 'px';
    context.style.top =
      Math.max(8, Math.min(event.clientY, innerHeight - context.offsetHeight - 8)) + 'px';
    context.querySelector('button:not(:disabled)')?.focus();
  });
  document.addEventListener('pointerdown', (event) => {
    if (context && !context.contains(event.target)) closeContext();
  });
  document.addEventListener('keydown', (event) => {
    if (!context) return;
    if (event.key === 'Escape') {
      closeContext();
      canvas.focus();
      event.preventDefault();
    } else if (['ArrowDown', 'ArrowUp', 'Tab'].includes(event.key)) {
      const buttons = [...context.querySelectorAll('button:not(:disabled)')];
      if (!buttons.length) return;
      const at = buttons.indexOf(document.activeElement),
        step = event.key === 'ArrowUp' || event.shiftKey ? -1 : 1;
      buttons[(at + step + buttons.length) % buttons.length].focus();
      event.preventDefault();
    }
  });
  canvas.addEventListener('dblclick', (event) => {
    if (inlineEditor) return; // 编辑中双击由文本单元自己处理（选词）
    const hit = event.target.closest('[data-design-id]')?.dataset.designId;
    if (!working) return;
    if (!hit) {
      // 双击空白取消选中
      choose([]);
      properties();
      outline();
      return;
    }
    const item = working.template.elements.find((e) => e.id === hit);
    if (item?.type === 'text') {
      choose([hit]);
      properties();
      outline();
      openInlineTextEditor(hit);
    }
  });
  canvas.addEventListener('pointerdown', (event) => {
    // 正在编辑的文字单元：把鼠标交给浏览器定位光标，不启动拖动/框选
    if (inlineEditor && event.target.closest?.('.design-text-cell.editing')) return;
    if (inlineEditor) closeInlineTextEditor(true);
    // 中键 或 空格+左键：平移画布
    if (event.button === 1 || (event.button === 0 && panSpace)) {
      event.preventDefault();
      closeContext();
      panDrag = { startX: event.clientX, startY: event.clientY, ox: pan.x, oy: pan.y, pointer: event.pointerId };
      canvas.setPointerCapture(event.pointerId);
      canvas.classList.add('panning');
      return;
    }
    if (event.button !== 0 && !(event.button === 2 && event.ctrlKey)) return;
    if (drag) {
      if (event.ctrlKey && event.button === 2) drag.copy = true;
      event.preventDefault();
      return;
    }
    closeContext();
    flushPending();
    if (!working) return;
    // 点中参考线命中层：启动参考线拖动（松开时若未移动则视为删除）
    const guideNode = event.target.closest('[data-design-guide]');
    if (guideNode) {
      const axis = guideNode.dataset.designGuide;
      const value = axis === 'x' ? guideNode.getAttribute('x1') : guideNode.getAttribute('y1');
      guideMove = {
        axis,
        value: Number(value),
        pointer: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
      };
      canvas.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }
    const node = event.target.closest('[data-design-id]'),
      hitId = node?.dataset.designId,
      resize = !!node?.dataset.designHandle,
      groupHandle = !!node?.dataset.designGroupHandle;
    const rect = canvas.getBoundingClientRect();
    if (!hitId) {
      if (event.button !== 0) return;
      drag = {
        marquee: true,
        pointer: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        rect,
        c: clone(working.c),
        template: clone(working.template),
        draft: clone(working.template),
        seed: event.ctrlKey || event.shiftKey ? [...selectionIds()] : [],
        initial: [...selectionIds()],
        moved: false,
      };
      if (!drag.seed.length) choose([]);
    } else {
      const ids = geometry.expand(working.template, hitId);
      if ((event.shiftKey || event.ctrlKey) && event.button === 0 && !resize && !event.altKey) {
        choose(toggle(selectionIds(), ids));
        properties();
        outline();
        event.preventDefault();
        canvas.focus();
        return;
      }
      if (!groupHandle && !selectionIds().includes(hitId)) choose(ids);
      const selectedIds = selectionIds();
      if (!selectedIds.length) return;
      drag = {
        pointer: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        rect,
        ids: [...selectedIds],
        bounds: geometry.bounds(geometry.chosen(working.template, selectedIds)),
        c: clone(working.c),
        template: clone(working.template),
        draft: clone(working.template),
        resize,
        moved: false,
        guides: [],
        copy: event.ctrlKey && event.button === 2,
      };
      if (drag.copy) {
        try {
          editing.copy(drag.template, drag.ids);
        } catch (error) {
          drag = null;
          feedback(error.message, true);
          return;
        }
      }
    }
    properties();
    outline();
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  // 框选框用 HTML 层（fixed 定位于视口），可自由拖出标签画布外、不被 SVG 裁剪
  const showMarqueeBox = (x1, y1, x2, y2) => {
    if (!marqueeBox) {
      marqueeBox = document.createElement('div');
      marqueeBox.className = 'design-marquee-box';
      document.body.append(marqueeBox);
    }
    marqueeBox.style.left = Math.min(x1, x2) + 'px';
    marqueeBox.style.top = Math.min(y1, y2) + 'px';
    marqueeBox.style.width = Math.abs(x2 - x1) + 'px';
    marqueeBox.style.height = Math.abs(y2 - y1) + 'px';
  };
  const hideMarqueeBox = () => {
    marqueeBox?.remove();
    marqueeBox = null;
  };
  function handleMarqueeMove(event) {
    // 不再 clamp：框选起止点可超出标签边界，框选框完全跟随鼠标
    const toMm = (clientX, clientY) => ({
      x: ((clientX - drag.rect.left) / drag.rect.width) * drag.c.width,
      y: ((clientY - drag.rect.top) / drag.rect.height) * drag.c.height,
    });
    const a = toMm(drag.startX, drag.startY);
    const b = toMm(event.clientX, event.clientY);
    drag.moved =
      Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY) > 3;
    choose([
      ...drag.seed,
      ...(drag.moved
        ? editing.marquee(
            drag.template,
            a,
            b,
            drag.template.elements.filter((e) => templates.visible(e, drag.c)).map((e) => e.id),
          )
        : []),
    ]);
    properties();
    outline();
    showMarqueeBox(drag.startX, drag.startY, event.clientX, event.clientY);
  }
  canvas.addEventListener('pointermove', (event) => {
    if (panDrag && panDrag.pointer === event.pointerId) {
      pan.x = panDrag.ox + (event.clientX - panDrag.startX);
      pan.y = panDrag.oy + (event.clientY - panDrag.startY);
      fit();
      return;
    }
    if (guideMove && guideMove.pointer === event.pointerId) {
      const dist = Math.abs(event.clientX - guideMove.startX) + Math.abs(event.clientY - guideMove.startY);
      if (dist > 3) guideMove.moved = true;
      if (!guideMove.moved) return;
      const raw = rulerToMm(guideMove.axis, event.clientX, event.clientY);
      const value = event.altKey ? round(raw) : snapMm(raw);
      guides = guides.map((g) =>
        g.axis === guideMove.axis && Math.abs(g.value - guideMove.value) < 0.05
          ? { axis: g.axis, value }
          : g,
      );
      guideMove.value = value;
      outline();
      return;
    }
    if (!drag || drag.pointer !== event.pointerId) return;
    if (drag.marquee) {
      handleMarqueeMove(event);
      return;
    }
    const dx = ((event.clientX - drag.startX) / drag.rect.width) * drag.c.width,
      dy = ((event.clientY - drag.startY) / drag.rect.height) * drag.c.height,
      b = drag.bounds;
    const snapStep = () => {
      const v = $('designSnap').value;
      return v === 'off' ? 0 : Number(v);
    };
    const grid = (v) => {
      const step = snapStep();
      return step > 0 && !event.altKey ? Math.round(v / step) * step : round(v);
    };
    try {
      drag.guides = [];
      if (drag.resize) {
        let w = Math.max(2, grid(b.width + dx)),
          h = Math.max(2, grid(b.height + dy));
        const elements = geometry.chosen(drag.template, drag.ids);
        if (elements.length === 1 && elements[0].type === 'qr') {
          w = Math.max(2, grid(b.width + (Math.abs(dy) > Math.abs(dx) ? dy : dx)));
          h = w;
        } else if (event.shiftKey && b.height > 0) {
          // Shift 等比例缩放：以变化幅度更大的维度为准，保持宽高比
          if (Math.abs(dx / b.width) >= Math.abs(dy / b.height)) {
            h = Math.max(2, grid(b.height * (w / b.width)));
          } else {
            w = Math.max(2, grid(b.width * (h / b.height)));
          }
        }
        drag.draft = geometry.resize(drag.template, drag.ids, w, h, $('designScaleText').checked);
      } else {
        let x = grid(b.x + dx) - b.x,
          y = grid(b.y + dy) - b.y;
        if ($('designSmartSnap').checked && !event.altKey) {
          const snapped = geometry.snap(drag.template, drag.ids, x, y);
          x = snapped.dx;
          y = snapped.dy;
          drag.guides = snapped.guides;
        }
        drag.draft = geometry.move(drag.template, drag.ids, x, y);
      }
      drag.moved = Math.abs(dx) + Math.abs(dy) > 0.05;
      const svg = canvas.querySelector('svg');
      for (const id of drag.ids) {
        const old = drag.template.elements.find((e) => e.id === id),
          next = drag.draft.elements.find((e) => e.id === id);
        for (const node of svg.querySelectorAll(`[data-element-id="${id}"]`)) {
          const scale =
            old.type === 'qr'
              ? next.width / old.width
              : old.type === 'text' && $('designScaleText').checked
                ? next.fontSize / old.fontSize
                : 1;
          node.setAttribute(
            'transform',
            `translate(${next.x} ${next.y}) scale(${scale}) translate(${-old.x} ${-old.y})`,
          );
        }
      }
      // 常驻文字层跟随拖动/缩放，避免出现第二份文字
      layoutTextLayer(drag.draft.elements);
      outline();
      for (const guide of drag.guides) {
        const line = document.createElementNS(ns, 'line');
        line.dataset.designOverlay = 'true';
        line.setAttribute('class', 'design-guide design-guide-snap');
        for (const [key, value] of Object.entries(
          guide.axis === 'x'
            ? { x1: guide.value, x2: guide.value, y1: 0, y2: drag.c.height }
            : { x1: 0, x2: drag.c.width, y1: guide.value, y2: guide.value },
        ))
          line.setAttribute(key, value);
        svg.append(line);
      }
      const box = geometry.bounds(geometry.chosen(drag.draft, drag.ids));
      for (const [key, id] of Object.entries({
        x: 'designX',
        y: 'designY',
        width: 'designWidth',
        height: 'designHeight',
      }))
        $(id).value = box[key];
      if (drag.ids.length === 1) {
        const e = drag.draft.elements.find((e) => e.id === drag.ids[0]);
        if (e.type === 'text') $('designFont').value = e.fontSize;
      }
      $('labelDesignDimensions').textContent =
        `${working.c.width} × ${working.c.height} mm　位置 ${round(box.x)}, ${round(box.y)}　大小 ${round(box.width)} × ${round(box.height)}`;
    } catch (error) {
      $('labelDesignHint').textContent = error.message;
    }
  });
  const finish = (event) => {
    if (panDrag && panDrag.pointer === event.pointerId) {
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      panDrag = null;
      canvas.classList.remove('panning');
      return;
    }
    if (guideMove && guideMove.pointer === event.pointerId) {
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      const moved = guideMove.moved;
      const { axis, value } = guideMove;
      guideMove = null;
      if (moved) {
        // 拖动结束：保留移动后的位置（已在 pointermove 里更新 guides）
        syncGuidesButton();
      } else {
        // 未移动 = 单击删除
        guides = guides.filter((g) => !(g.axis === axis && Math.abs(g.value - value) < 0.05));
        outline();
        syncGuidesButton();
        feedback('已删除该辅助参考线。');
      }
      return;
    }
    if (!drag || drag.pointer !== event.pointerId) return;
    const action = drag;
    drag = null;
    hideMarqueeBox();
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (action.marquee) {
      properties();
      outline();
      return;
    }
    if (action.copy) {
      try {
        const b = geometry.bounds(geometry.chosen(action.draft, action.ids));
        const result = editing.paste(
          action.template,
          editing.copy(action.template, action.ids),
          action.moved ? { x: b.x, y: b.y } : { offset: 2 },
        );
        choose(result.ids);
        commit({ ...action.c, composition: 'custom', template: result.template }, action.c);
      } catch (error) {
        refresh();
        feedback(error.message, true);
      }
    } else if (action.moved)
      commit({ ...action.c, composition: 'custom', template: action.draft }, action.c);
    else {
      // 单击文字元素（未拖动、非缩放柄）＝直接在画布上打字，无需再切到右侧属性栏
      const single =
        !action.resize && action.ids?.length === 1
          ? working.template.elements.find((e) => e.id === action.ids[0])
          : null;
      if (single?.type === 'text') {
        choose([single.id]);
        properties();
        outline();
        openInlineTextEditor(single.id);
      } else refresh();
    }
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', (event) => {
    if (panDrag && panDrag.pointer === event.pointerId) {
      panDrag = null;
      canvas.classList.remove('panning');
    }
    if (drag) {
      drag = null;
      hideMarqueeBox();
      refresh();
    }
  });
  canvas.addEventListener('keydown', (event) => {
    if (event.code === 'Space' && !event.repeat) {
      panSpace = true;
      canvas.classList.add('pan-ready');
      event.preventDefault();
      return;
    }
    const shortcut =
      (event.ctrlKey || event.metaKey) && !event.altKey ? event.key.toLowerCase() : '';
    const command = {
      c: () => copySelection(),
      x: () => copySelection(true),
      v: () => pasteSelection(),
      d: () => pasteSelection(true),
      y: () => $('designRedo').click(),
    }[shortcut];
    if (command) {
      event.preventDefault();
      command();
      return;
    }
    if (event.key === 'Escape' && drag) {
      const previous = drag;
      drag = null;
      if (canvas.hasPointerCapture(previous.pointer))
        canvas.releasePointerCapture(previous.pointer);
      if (previous.marquee) choose(previous.initial);
      refresh();
      event.preventDefault();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      $('designSelectAll').click();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'g') {
      event.preventDefault();
      $(event.shiftKey ? 'designUngroup' : 'designGroup').click();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      choose([]);
      properties();
      outline();
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (!$('designDelete').disabled) {
        event.preventDefault();
        $('designDelete').click();
      }
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      $(event.shiftKey ? 'designRedo' : 'designUndo').click();
      return;
    }
    const move = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[
      event.key
    ];
    if (!move || !working) return;
    const ids = selectionIds();
    if (!ids.length) return;
    event.preventDefault();
    const step = event.shiftKey ? 1 : 0.1;
    changeTemplate((t, selectedIds) =>
      geometry.move(t, selectedIds, move[0] * step, move[1] * step),
    );
  });
  document.addEventListener('keyup', (event) => {
    if (event.code === 'Space') {
      panSpace = false;
      canvas.classList.remove('pan-ready');
    }
  });
  new ResizeObserver(() => {
    fit();
    outline();
  }).observe(stage);
  return Object.freeze({
    applyLayout: (c) => {
      flushPending();
      return commit(c);
    },
    refresh,
    view,
    flushPending,
    cancelPending,
    beforeExternalEdit: () => {
      flushPending();
      try {
        const c = getConfig();
        if (lastConfig && JSON.stringify(c) !== JSON.stringify(lastConfig)) remember(lastConfig);
      } catch {}
    },
    clear: () => {
      cancelPending();
      closeContext();
      // 关闭设计器时只解除编辑态，不触发 commit（此时数据集即将清空）
      if (inlineEditor) {
        try {
          inlineEditor.cell.setAttribute('contenteditable', 'false');
          inlineEditor.cell.classList.remove('editing');
        } catch {}
        inlineEditor = null;
      }
      textLayer = null;
      hideMarqueeBox();
      clipboard = null;
      pasteCount = 0;
      guides = [];
      guideDrag = null;
      pan = { x: 0, y: 0 };
      panDrag = null;
      panSpace = false;
      working = null;
      lastConfig = null;
      past = [];
      future = [];
      drag = null;
      index = 0;
      selected = 'qr';
      selection = ['qr'];
      zoom = 1;
      zoomFit = true;
      canvas.replaceChildren();
      $('designText').value = '';
      $('designElement').replaceChildren(new Option('外框', 'border'));
      historyButtons();
      $('labelDesignView').hidden = false;
      $('labelBatchView').hidden = true;
      $('labelViewDesign').setAttribute('aria-selected', 'true');
      $('labelViewBatch').setAttribute('aria-selected', 'false');
    },
  });
};
