'use strict';
window.createLabelStudio = ({ api, unlocked }) => {
  const $ = (id) => document.getElementById(id),
    model = window.LabelLayout,
    surface = window.LabelRender;
  const fields = {
    width: 'labelWidth',
    height: 'labelHeight',
    qrSize: 'labelQrSize',
    fontSize: 'labelFontSize',
    gapX: 'labelGapX',
    gapY: 'labelGapY',
    padding: 'labelPadding',
    margin: 'labelMargin',
    columns: 'labelColumns',
    qrScale: 'labelQrScale',
    paperWidth: 'labelPaperWidth',
    paperHeight: 'labelPaperHeight',
    marginLeft: 'labelMarginLeft',
    marginRight: 'labelMarginRight',
    marginTop: 'labelMarginTop',
    marginBottom: 'labelMarginBottom',
  };
  const selectors = {
    orientation: 'labelOrientation',
    qrMode: 'labelQrMode',
    layout: 'labelLayout',
    paperSize: 'labelPaperSize',
    pageAlignX: 'labelPageAlignX',
    pageAlignY: 'labelPageAlignY',
    lastRowAlign: 'labelLastRowAlign',
  };
  const switches = {
    signatures: 'labelSignatures',
    sort: 'labelSort',
    showName: 'labelShowName',
    showCode: 'labelShowCode',
    border: 'labelBorder',
    allowDuplicates: 'labelAllowDuplicates',
    separateMargins: 'labelSeparateMargins',
  };
  let kind = 'fixture',
    plan = null,
    page = 0,
    timer,
    ticket = 0,
    busy = false,
    imported = null;
  let creators = new Map();
  let designer;
  const extraNames = [
    'composition',
    'template',
    'borderWidth',
    'borderInset',
    'borderRadius',
    'borderStyle',
    'borderColor',
  ];
  let extras = Object.fromEntries(extraNames.map((k) => [k, model.preset('fixture')[k]]));
  const settingsKey = 'qa-label-layout-v3';
  const memory = window.createLabelMemoryUI({
    api,
    unlocked,
    capture: () => {
      designer?.flushPending();
      return {
        config: readConfig(),
        name: $('labelName').value,
        creator: $('labelCreator').value,
        range: {
          prefix: $('labelPrefix').value,
          start: Number($('labelStart').value),
          end: Number($('labelEnd').value),
          digits: Number($('labelDigits').value),
        },
        codes: $('labelCodes').value,
        creators: [...creators],
      };
    },
    apply: (composition) => {
      applyConfig(composition.config);
      $('labelName').value = composition.name;
      $('labelCreator').value = composition.creator;
      if (composition.range) {
        $('labelPrefix').value = composition.range.prefix;
        $('labelStart').value = composition.range.start;
        $('labelEnd').value = composition.range.end;
        $('labelDigits').value = composition.range.digits;
      }
      if (Object.hasOwn(composition, 'codes')) {
        $('labelCodes').value = composition.codes;
        creators = new Map(composition.creators || []);
      }
      page = 0;
      update();
    },
  });
  const message = (text, error = false) => {
    const node = $('labelMessage');
    node.textContent = text;
    node.classList.toggle('error', error);
    node.setAttribute('role', error ? 'alert' : 'status');
  };
  const lockButtons = () =>
    document
      .querySelectorAll('[data-label-export]')
      .forEach((b) => (b.disabled = !plan || busy || !unlocked()));
  function readConfig() {
    const c = { kind, ...extras };
    for (const [key, id] of Object.entries(selectors)) c[key] = $(id).value;
    for (const [key, id] of Object.entries(switches)) c[key] = $(id).checked;
    for (const [key, id] of Object.entries(fields)) c[key] = Number($(id).value);
    return model.config(c);
  }
  function applyConfig(c) {
    designer?.cancelPending();
    c = model.config(c);
    kind = c.kind;
    extras = Object.fromEntries(extraNames.map((k) => [k, structuredClone(c[k])]));
    for (const [key, id] of Object.entries(fields)) $(id).value = c[key];
    for (const [key, id] of Object.entries(selectors)) $(id).value = c[key];
    for (const [key, id] of Object.entries(switches)) $(id).checked = c[key];
    syncComposition();
    document
      .querySelectorAll('[data-label-preset]')
      .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.labelPreset === kind)));
  }
  function syncComposition() {
    $('labelMarginSides').hidden = !$('labelSeparateMargins').checked;
    $('labelMargin').closest('label').hidden = $('labelSeparateMargins').checked;
    $('labelOrientation').disabled = $('labelPaperSize').value === 'custom';
    if ($('labelPaperSize').value !== 'custom') {
      const size = window.LabelSheet.presets[$('labelPaperSize').value];
      if (size) {
        const landscape = $('labelOrientation').value === 'landscape';
        $('labelPaperWidth').value = size[landscape ? 1 : 0];
        $('labelPaperHeight').value = size[landscape ? 0 : 1];
      }
    }
    $('labelPadding').closest('label').hidden = extras.composition === 'custom';
    const auto = $('labelQrMode').value === 'auto';
    $('labelQrSize').disabled = auto;
    $('labelQrSize').title = auto ? '自动贴合后的实际大小' : '输入二维码边长';
    $('labelScaleRow').hidden = !auto;
    $('labelQrScaleSlider').value = $('labelQrScale').value;
    $('labelName').disabled = !$('labelShowName').checked;
  }
  function preference() {
    try {
      const value = localStorage.getItem(settingsKey) || localStorage.getItem('qa-label-layout-v2');
      if (value) applyConfig(model.config(JSON.parse(value)));
      else applyConfig(model.preset('fixture'));
    } catch {
      applyConfig(model.preset('fixture'));
    }
  }
  function draw() {
    $('labelCanvas').replaceChildren();
    if (!plan) return;
    page = Math.max(0, Math.min(page, plan.pages - 1));
    const holder = document.createElement('div');
    holder.className = 'label-paper';
    holder.innerHTML = surface.pageSvg(plan, page);
    if ($('labelShowPrintable').checked && !$('labelSingle').checked) {
      const guide = document.createElementNS('http://www.w3.org/2000/svg', 'rect'),
        p = plan.printable;
      for (const [key, value] of Object.entries({
        ...p,
        fill: 'none',
        stroke: '#2473b8',
        'stroke-width': 0.25,
        'stroke-dasharray': '2 1',
        'data-printable-guide': 'true',
      }))
        guide.setAttribute(key, value);
      guide.setAttribute('pointer-events', 'none');
      holder.firstElementChild.append(guide);
    }
    if ($('labelSingle').checked) {
      const p = plan.positions.find((p) => p.page === page),
        svg = holder.firstElementChild;
      svg.setAttribute('viewBox', `${p.x - 2} ${p.y - 2} ${p.width + 4} ${p.height + 4}`);
      svg.setAttribute('aria-label', `单张放大预览：${p.record.code}`);
      holder.classList.add('single');
    }
    $('labelCanvas').append(holder);
    $('labelPageCount').textContent = `第${page + 1} / ${plan.pages}页`;
    $('labelPrevious').disabled = page === 0;
    $('labelNext').disabled = page === plan.pages - 1;
  }
  function update() {
    clearTimeout(timer);
    if (!unlocked()) return;
    try {
      const c = readConfig(),
        name = $('labelName').value.trim();
      syncComposition();
      const area = window.LabelSheet.measure(c);
      $('labelPrintableSummary').textContent =
        `纸张 ${area.paper.width}×${area.paper.height}mm；可打印 ${area.printable.width}×${area.printable.height}mm。`;
      try {
        if ($('labelAutoRemember').checked)
          localStorage.setItem(
            settingsKey,
            JSON.stringify({ ...c, template: null, composition: 'auto' }),
          );
        else localStorage.removeItem(settingsKey);
      } catch {}
      if (!$('labelCodes').value.trim()) {
        plan = null;
        $('labelSummary').textContent = '填写或导入编号后查看排版。';
        $('labelCanvas').replaceChildren();
        message('当前只设计单张；切换“批量排版”载入编号后，即可按同一模板生成整批。');
        designer?.refresh();
        lockButtons();
        return;
      }
      const map = Object.fromEntries(creators),
        items = model.parse($('labelCodes').value, name, map, c);
      for (const item of items)
        if (!creators.has(item.code)) item.creator = $('labelCreator').value.trim();
      const next = model.plan(c, items);
      surface.pageSvg(next, Math.min(page, next.pages - 1));
      plan = next;
      if (c.qrMode === 'auto' && c.composition === 'auto') $('labelQrSize').value = plan.qrSize;
      $('labelSummary').textContent =
        `${plan.positions.length}张　${c.width}×${c.height}mm　二维码${plan.qrSize}mm　${plan.paper.width}×${plan.paper.height}mm纸张　${plan.columns}列×${plan.rows}排／页`;
      message(
        [...plan.warnings, ...surface.warnings(plan)].join(' ') ||
          '预览已实时更新；导出与打印使用相同坐标。',
      );
      draw();
    } catch (error) {
      plan = null;
      $('labelSummary').textContent = '排版未完成';
      $('labelCanvas').replaceChildren();
      message(error.message, true);
    }
    designer?.refresh();
    lockButtons();
  }
  function schedule() {
    designer?.beforeExternalEdit();
    syncComposition();
    memory.changed();
    plan = null;
    lockButtons();
    clearTimeout(timer);
    timer = setTimeout(update, 140);
  }
  function clear() {
    ticket++;
    clearTimeout(timer);
    plan = null;
    page = 0;
    imported = null;
    creators = new Map();
    memory.clear();
    extras.template = null;
    extras.composition = 'auto';
    designer?.clear();
    $('labelCodes').value = '';
    $('labelCreator').value = '';
    $('labelName').value = '';
    $('labelPrefix').value = 'FIX-';
    $('labelStart').value = 1;
    $('labelEnd').value = 19;
    $('labelDigits').value = 3;
    $('labelCanvas').replaceChildren();
    $('labelImportReview').hidden = true;
    $('labelImportSheets').replaceChildren();
    $('labelImportNotice').textContent = '';
    $('labelSummary').textContent = '填写或导入编号后查看排版。';
    message('编号只在当前会话使用，锁定后清空。');
    lockButtons();
  }
  function showImport() {
    const sheet = imported?.sheets.find((s) => s.name === $('labelImportSheets').value);
    $('labelImportUse').disabled = !sheet?.records.length;
    $('labelImportNotice').textContent = sheet
      ? `${sheet.records.length}个不同编号；${sheet.duplicates.length}处重复文字；${sheet.errorCells}个错误或图片缓存单元格未作为编号读取。请核对类别及编号后使用。`
      : '';
  }
  async function pick() {
    if (busy || !unlocked()) return;
    const token = ++ticket;
    busy = true;
    lockButtons();
    try {
      const result = await api('pickLabelWorkbook');
      if (token !== ticket || !unlocked() || result.cancelled) return;
      imported = result;
      $('labelImportSheets').replaceChildren(
        ...result.sheets.map((s) => new Option(`${s.name}（${s.records.length}个）`, s.name)),
      );
      const candidate =
        result.sheets.find((s) => s.name === '编号清单') ||
        result.sheets.find((s) => s.records.length);
      if (candidate) $('labelImportSheets').value = candidate.name;
      $('labelImportReview').hidden = false;
      designer?.view('batch');
      showImport();
    } catch (error) {
      message(error.message, true);
    } finally {
      busy = false;
      lockButtons();
    }
  }
  async function exportDocument(format) {
    designer?.flushPending();
    if (!plan || busy || !unlocked()) return;
    const snapshot = plan;
    busy = true;
    lockButtons();
    try {
      const result = await api('exportLabels', {
        format,
        config: snapshot.config,
        records: snapshot.positions.map((p) => p.record),
      });
      if (!unlocked()) return;
      if (!result.cancelled)
        message(format === 'print' ? '打印操作已完成。' : `已导出：${result.fileName}`);
    } catch (error) {
      if (unlocked()) message(error.message, true);
    } finally {
      busy = false;
      lockButtons();
    }
  }
  preference();
  designer = window.createLabelDesigner({
    getConfig: readConfig,
    setConfig: applyConfig,
    getSource: () => ({ plan, name: $('labelName').value, creator: $('labelCreator').value }),
    onChange: () => {
      update();
      memory.changed();
    },
  });
  for (const id of Object.values(fields))
    $(id).addEventListener('input', () => {
      if (['labelPaperWidth', 'labelPaperHeight'].includes(id))
        $('labelPaperSize').value = 'custom';
      schedule();
    });
  for (const id of [
    'labelCodes',
    'labelName',
    'labelCreator',
    ...Object.values(selectors),
    ...Object.values(switches),
    'labelPrefix',
    'labelStart',
    'labelEnd',
    'labelDigits',
  ])
    $(id).addEventListener('input', schedule);
  $('labelUpdate').onclick = () => {
    update();
    memory.changed();
  };
  $('labelAutoRemember').addEventListener('change', () => {
    if (!$('labelAutoRemember').checked)
      try {
        localStorage.removeItem(settingsKey);
      } catch {}
  });
  $('labelQrScaleSlider').oninput = () => {
    $('labelQrScale').value = $('labelQrScaleSlider').value;
    schedule();
  };
  $('labelPickWorkbook').onclick = pick;
  $('labelImportSheets').onchange = showImport;
  $('labelImportCancel').onclick = () => {
    $('labelImportReview').hidden = true;
    imported = null;
  };
  $('labelImportUse').onclick = () => {
    const sheet = imported?.sheets.find((s) => s.name === $('labelImportSheets').value);
    if (!sheet?.records.length) return;
    creators = new Map(sheet.records.map((r) => [r.code, r.creator]));
    $('labelCodes').value = sheet.records.map((r) => r.code).join('\n');
    if (!$('labelName').value && $('labelShowName').checked)
      $('labelName').value = sheet.records[0].name;
    $('labelImportReview').hidden = true;
    page = 0;
    update();
    memory.changed();
  };
  document.querySelectorAll('[data-label-preset]').forEach(
    (button) =>
      (button.onclick = () => {
        applyConfig(model.preset(button.dataset.labelPreset));
        $('labelName').value = kind === 'fixture' ? '纵切夹具' : '手持式热剥钳';
        update();
        memory.changed();
      }),
  );
  $('labelDemo').onclick = () => {
    creators = new Map();
    $('labelCodes').value = Array.from(
      { length: 19 },
      (_, i) => `DEMO-FIX-${String(i + 1).padStart(3, '0')}`,
    ).join('\n');
    $('labelName').value = '示例夹具';
    applyConfig(model.preset('fixture'));
    page = 0;
    update();
    memory.changed();
    message('当前为明确构造的示例编号，可替换为自己的编号。');
  };
  $('labelRangeUse').onclick = () => {
    try {
      const codes = model.continuous(
        $('labelPrefix').value,
        Number($('labelStart').value),
        Number($('labelEnd').value),
        Number($('labelDigits').value),
      );
      $('labelCodes').value = codes.join('\n');
      page = 0;
      update();
      memory.changed();
    } catch (error) {
      message(error.message, true);
    }
  };
  $('labelPrevious').onclick = () => {
    page--;
    draw();
  };
  $('labelNext').onclick = () => {
    page++;
    draw();
  };
  $('labelSingle').onchange = draw;
  $('labelShowPrintable').onchange = draw;
  document
    .querySelectorAll('[data-label-export]')
    .forEach((b) => (b.onclick = () => exportDocument(b.dataset.labelExport)));
  return Object.freeze({
    activate: () => {
      update();
      memory.activate();
    },
    clear,
    flush: async () => {
      designer?.flushPending();
      return memory.flush();
    },
  });
};
