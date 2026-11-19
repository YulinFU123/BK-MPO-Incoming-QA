'use strict';
window.createLabelDesigner = ({ getConfig, setConfig, getSource, onChange }) => {
  const $ = (id) => document.getElementById(id),
    model = window.LabelLayout,
    templates = window.LabelTemplate,
    geometry = window.LabelGeometry,
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
    propertyTimer;
  const clone = (v) => structuredClone(v),
    round = (n) => Math.round(n * 1000) / 1000,
    clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const names = {
    qr: '二维码',
    code: '编号',
    name: '名称',
    creator: '制作人',
    fixed: '固定文字',
    line: '横线',
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
        { code: 'DESIGN-001', name: input.name || '', creator: input.creator || '' },
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
  }
  function fit() {
    if (!working || $('labelDesignView').hidden) return;
    const w = working.c.width,
      h = working.c.height,
      availableW = Math.max(120, stage.clientWidth - 48),
      availableH = Math.max(120, stage.clientHeight - 48),
      scale = Math.min(availableW / w, availableH / h);
    canvas.style.width = w * scale + 'px';
    canvas.style.height = h * scale + 'px';
  }
  function outline() {
    const svg = canvas.querySelector('svg');
    if (!svg || !working) return;
    for (const node of svg.querySelectorAll('[data-design-overlay]')) node.remove();
    const template = drag?.draft || working.template,
      ids = selectionIds();
    for (const e of template.elements) {
      const r = document.createElementNS(ns, 'rect');
      r.dataset.designOverlay = 'true';
      r.dataset.designId = e.id;
      r.setAttribute('x', e.x);
      r.setAttribute('y', e.y);
      r.setAttribute('width', e.width);
      r.setAttribute('height', Math.max(e.height, 0.8));
      r.setAttribute('fill', 'transparent');
      r.setAttribute('class', ids.includes(e.id) ? 'design-element selected' : 'design-element');
      if (!templates.visible(e, working.c)) r.classList.add('design-element-hidden');
      const title = document.createElementNS(ns, 'title');
      title.textContent = names[e.binding || e.type] || '元素';
      r.append(title);
      svg.append(r);
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
      }
    }
    if (ids.length > 1) {
      const b = geometry.bounds(geometry.chosen(template, ids)),
        r = document.createElementNS(ns, 'rect');
      r.dataset.designOverlay = 'true';
      for (const [key, value] of Object.entries(b)) r.setAttribute(key, value);
      r.setAttribute('class', 'design-selection-outline');
      svg.append(r);
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
    if (selected === 'border') {
      const b = surface.borderBox(working.c, {
          x: 0,
          y: 0,
          width: working.c.width,
          height: working.c.height,
        }),
        r = document.createElementNS(ns, 'rect');
      r.dataset.designOverlay = 'true';
      r.setAttribute('x', b.x);
      r.setAttribute('y', b.y);
      r.setAttribute('width', b.width);
      r.setAttribute('height', b.height);
      r.setAttribute('class', 'design-border-selected');
      svg.append(r);
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
      selected = working.template.elements.find((e) => e.type === 'qr').id;
    $('designElement').value = selected;
    $('designMode').value = c.composition;
    $('designBorderPanel').hidden = selected !== 'border';
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
    $('designDelete').disabled = !ids.length || selectedItems.some((e) => e.type === 'qr');
    $('designSelectionInfo').textContent = ids.length
      ? `已选${ids.length}个元素${selectedItems.every((e) => e.group && e.group === selectedItems[0].group) ? '（组合）' : ''}；Shift多选，Ctrl+A全选。`
      : '点击选择；Shift多选，Ctrl+A全选。';
    $('designGroup').disabled = ids.length < 2;
    $('designUngroup').disabled = !selectedItems.some((e) => e.group);
    $('designFit').disabled = !ids.length;
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
        $(id).value = e[key];
      $('designHeight').disabled = !multi && e.type !== 'text';
      $('designTextPanel').hidden = e.type !== 'text';
      $('designLinePanel').hidden = e.type !== 'line';
      if (e.type === 'text') {
        $('designBinding').value = e.binding;
        $('designText').value = e.text;
        $('designFont').value = e.fontSize;
        $('designAlign').value = e.align;
        $('designValign').value = e.valign;
        $('designFontFamily').value = e.fontFamily;
        $('designTextColor').value = e.color;
        $('designBold').checked = e.bold;
      }
      if (e.type === 'line') {
        $('designLineWidth').value = e.strokeWidth;
        $('designLineColor').value = e.color;
      }
    }
    historyButtons();
  }
  function refresh() {
    try {
      working = source();
      if (selected !== 'border' && !working.template.elements.some((e) => e.id === selected))
        choose([working.template.elements.find((e) => e.type === 'qr').id]);
      if (working.c.composition === 'auto' && working.c.qrMode === 'auto')
        $('labelQrSize').value = working.plan.qrSize;
      lastConfig = clone(working.c);
      canvas.innerHTML = surface.labelSvg(working.plan, index);
      fit();
      outline();
      properties();
      $('labelDesignDimensions').textContent = `${working.c.width} × ${working.c.height} mm`;
      $('designRecordCount').textContent = working.example
        ? '设计用示例'
        : `第${index + 1} / ${working.plan.positions.length}条`;
      $('designPrevious').disabled = working.example || index === 0;
      $('designNext').disabled = working.example || index === working.plan.positions.length - 1;
      $('labelDesignHint').classList.remove('error');
      $('labelDesignHint').textContent =
        working.c.composition === 'custom'
          ? '自定义模板将用于所有编号；可逐条查看内容适配。'
          : '自动适配。拖动元素或修改位置后会转为自定义模板。';
    } catch (error) {
      working = null;
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
    bold: 'designBold',
    color: 'designTextColor',
  }))
    bindProperty(id, key);
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
    const e =
      type === 'text'
        ? {
            id,
            type,
            x: Math.min(2, c.width / 10),
            y: Math.max(0, c.height - 10),
            width: Math.max(2, c.width - 4),
            height: Math.min(8, c.height - 2),
            binding: 'fixed',
            text: '自定义文字',
            fontSize: 9,
            bold: false,
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
    choose([id]);
    commit({ ...c, composition: 'custom', template: t });
  }
  $('designAddText').onclick = () => add('text');
  $('designAddLine').onclick = () => add('line');
  $('designDelete').onclick = () => {
    flushPending();
    if (!working || $('designDelete').disabled) return;
    const t = clone(working.template);
    const ids = selectionIds();
    t.elements = t.elements.filter((e) => !ids.includes(e.id));
    choose(['qr']);
    commit({ ...working.c, composition: 'custom', template: t });
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
  $('designFit').onclick = () =>
    changeTemplate((t, ids) =>
      geometry.fit(t, ids, working.c.padding, $('designScaleText').checked),
    );
  $('designDistributeX').onclick = () =>
    changeTemplate((t, ids) => geometry.distribute(t, ids, 'x'));
  $('designDistributeY').onclick = () =>
    changeTemplate((t, ids) => geometry.distribute(t, ids, 'y'));
  canvas.addEventListener('pointerdown', (event) => {
    const node = event.target.closest('[data-design-id]'),
      hitId = node?.dataset.designId,
      resize = !!node?.dataset.designHandle,
      groupHandle = !!node?.dataset.designGroupHandle;
    flushPending();
    if (!working) return;
    if (!hitId) {
      choose([]);
      properties();
      outline();
      return;
    }
    const ids = geometry.expand(working.template, hitId);
    if (event.shiftKey && !resize) {
      const previous = selectionIds();
      choose(
        ids.every((id) => previous.includes(id))
          ? previous.filter((id) => !ids.includes(id))
          : [...previous, ...ids],
      );
      properties();
      outline();
      event.preventDefault();
      return;
    }
    if (!groupHandle && !selectionIds().includes(hitId)) choose(ids);
    properties();
    outline();
    canvas.focus({ preventScroll: true });
    const selectedIds = selectionIds();
    if (!selectedIds.length) return;
    drag = {
      pointer: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      rect: canvas.getBoundingClientRect(),
      ids: [...selectedIds],
      bounds: geometry.bounds(geometry.chosen(working.template, selectedIds)),
      c: clone(working.c),
      template: clone(working.template),
      draft: clone(working.template),
      resize,
      moved: false,
      guides: [],
    };
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!drag || drag.pointer !== event.pointerId) return;
    const dx = ((event.clientX - drag.startX) / drag.rect.width) * drag.c.width,
      dy = ((event.clientY - drag.startY) / drag.rect.height) * drag.c.height,
      b = drag.bounds;
    const grid = (v) =>
      $('designSnap').checked && !event.altKey ? Math.round(v * 2) / 2 : round(v);
    try {
      drag.guides = [];
      if (drag.resize) {
        let w = Math.max(2, grid(b.width + dx)),
          h = Math.max(2, grid(b.height + dy));
        const elements = geometry.chosen(drag.template, drag.ids);
        if (elements.length === 1 && elements[0].type === 'qr') {
          w = Math.max(2, grid(b.width + (Math.abs(dy) > Math.abs(dx) ? dy : dx)));
          h = w;
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
      outline();
      for (const guide of drag.guides) {
        const line = document.createElementNS(ns, 'line');
        line.dataset.designOverlay = 'true';
        line.setAttribute('class', 'design-guide');
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
    } catch (error) {
      $('labelDesignHint').textContent = error.message;
    }
  });
  const finish = (event) => {
    if (!drag || drag.pointer !== event.pointerId) return;
    const action = drag;
    drag = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (action.moved)
      commit({ ...action.c, composition: 'custom', template: action.draft }, action.c);
    else refresh();
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', () => {
    drag = null;
    refresh();
  });
  canvas.addEventListener('keydown', (event) => {
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
  new ResizeObserver(() => {
    fit();
    outline();
  }).observe(stage);
  return Object.freeze({
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
      working = null;
      lastConfig = null;
      past = [];
      future = [];
      drag = null;
      index = 0;
      selected = 'qr';
      selection = ['qr'];
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
