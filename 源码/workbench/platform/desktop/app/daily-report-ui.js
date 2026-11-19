'use strict';
const dailyProductionLimit = 366;
const dailyProductionKey = (row) => JSON.stringify([row.date, row.process.trim(), row.shift.trim()]);
const dailyProductionHasQuantity = (row) => String(row.quantity).trim() !== '';
const dailyProductionControls = [
  ['date', '业务日期', 'date'],
  ['process', '工序', 'text'],
  ['shift', '班次', 'text'],
  ['quantity', '实际产量', 'number'],
];

window.createDailyProductionDraft = (saved, range) => {
  const fromSaved = (rows) => rows.map((row) => ({ ...row, quantity: String(row.quantity) }));
  let baseline = fromSaved(saved);
  const state = {
    rows: fromSaved(saved),
    suggestions: new Map(),
    showAll: false,
    range,
    dirty() {
      return JSON.stringify(state.rows.filter(dailyProductionHasQuantity)) !== JSON.stringify(baseline);
    },
    reset() { state.rows = fromSaved(baseline); },
    saved(rows) {
      baseline = fromSaved(rows);
      state.reset();
    },
  };
  return state;
};

function renderDailyProductionEditor(root, options) {
  const { el, btn, productionDraft: draft, loadCohorts, saveManual, draftChanged } = options;
  const editor = el('div', undefined, 'lab-daily-production');
  editor.append(el('p', '按业务日期、工序和班次填写。建议行里的不良数量仅供核对。请填对应班次的实际产量，没发生不良的班次也可手动加一行。', 'lab-muted'));
  const tools = el('div', undefined, 'lab-config-actions');
  const feedback = el('p', '', 'lab-muted');
  feedback.setAttribute('role', 'status');
  const table = el('table');
  const head = el('thead'), header = el('tr'), body = el('tbody');
  ['业务日期', '工序', '班次', '实际产量', '不良数量参考', '操作'].forEach((label) => {
    const th = el('th', label);
    th.scope = 'col';
    header.append(th);
  });
  head.append(header);
  table.append(head, body);
  const scroll = el('div', undefined, 'lab-table-scroll lab-daily-production-scroll');
  scroll.append(table);
  const empty = el('p', '当前日期没有手填产量。可以带出筛选范围内的组合，或手动添加一行。', 'lab-muted');
  const status = el('p', '', 'lab-muted');
  status.setAttribute('role', 'status');
  const inRange = (row) => !draft.range || !row.date ||
    (row.date >= draft.range.start && row.date <= draft.range.end);
  const say = (message, isError = false) => {
    feedback.textContent = message;
    feedback.classList.toggle('lab-error', isError);
  };
  function editorStatus() {
    const outside = draft.rows.filter((row) => !inRange(row)).length;
    status.textContent = (draft.dirty() ? '手填产量有改动，尚未保存。' : '已记录 ' +
      draft.rows.filter(dailyProductionHasQuantity).length + ' 行手填产量。') +
      (outside && !draft.showAll ? ' 另有 ' + outside + ' 行不在当前范围。' : '');
    restore.disabled = !draft.dirty();
    showAll.hidden = outside === 0;
    showAll.textContent = draft.showAll ? '仅显示当前日期' : '显示其他日期';
  }
  function drawRows() {
    const visible = draft.rows.filter((row) => draft.showAll || inRange(row));
    scroll.hidden = visible.length === 0;
    empty.hidden = visible.length !== 0;
    body.replaceChildren();
    visible.forEach((row, index) => {
      const tr = el('tr');
      const reference = el('td', draft.suggestions.get(dailyProductionKey(row)) ?? '—');
      for (const [key, label, type] of dailyProductionControls) {
        const td = el('td');
        const input = el('input');
        input.type = type === 'number' ? 'text' : type;
        input.value = row[key];
        input.setAttribute('aria-label', `${label}（第 ${index + 1} 行）`);
        if (type === 'number') {
          input.inputMode = 'numeric';
          input.placeholder = '未填写';
        }
        input.oninput = () => {
          row[key] = input.value;
          reference.textContent = String(draft.suggestions.get(dailyProductionKey(row)) ?? '—');
          say('');
          editorStatus();
          draftChanged();
        };
        td.append(input);
        tr.append(td);
      }
      const remove = btn('移除', () => {
        draft.rows = draft.rows.filter((item) => item !== row);
        drawRows();
        draftChanged();
      });
      remove.setAttribute('aria-label', `移除第 ${index + 1} 行手填产量`);
      const actions = el('td');
      actions.append(remove);
      tr.append(reference, actions);
      body.append(tr);
    });
    editorStatus();
  }
  const suggest = btn('按当前筛选带出日期和班次', async () => {
    suggest.disabled = true;
    try {
      const result = await loadCohorts();
      if (!result) return;
      const { cohorts, unassignedRows = 0 } = result;
      const existing = new Set(draft.rows.map(dailyProductionKey));
      const missing = cohorts.filter((cohort) => !existing.has(dailyProductionKey(cohort)));
      if (draft.rows.length + missing.length > dailyProductionLimit)
        return say('手填产量最多保留 366 行，请缩短日期范围或移除不再需要的行。', true);
      cohorts.forEach((cohort) => draft.suggestions.set(dailyProductionKey(cohort), cohort.quantity));
      missing.forEach(({ date, process, shift }) => draft.rows.push({ date, process, shift, quantity: '' }));
      drawRows();
      const message = !cohorts.length ? '当前筛选没有可以带出的日期、工序和班次组合。可点「添加一行」手动录入。' :
        missing.length ? `已添加 ${missing.length} 行，请按实际情况填写产量。` : '当前组合已带出，可以继续填数。';
      say(message + (unassignedRows ? ` 另有 ${unassignedRows} 条不良缺少工序或班次，请核对后再算不良率。` : ''));
    } finally {
      suggest.disabled = false;
    }
  });
  const add = btn('添加一行', () => {
    if (draft.rows.length >= dailyProductionLimit) return say('手填产量最多保留 366 行。请先移除不再需要的行。', true);
    draft.rows.push({ date: draft.range?.end || '', process: '', shift: '', quantity: '' });
    drawRows();
    say('');
  });
  const showAll = btn('显示其他日期', () => {
    draft.showAll = !draft.showAll;
    drawRows();
  });
  const restore = btn('撤销未保存更改', () => {
    draft.reset();
    drawRows();
    say('已恢复上次保存的手填产量。');
    draftChanged();
  });
  const save = btn('保存手填产量', async () => {
    const rows = [], keys = new Set();
    for (const row of draft.rows.filter(dailyProductionHasQuantity)) {
      const clean = { date: row.date, process: row.process.trim(), shift: row.shift.trim(), quantity: Number(row.quantity) };
      const key = dailyProductionKey(clean);
      if (!clean.date || !clean.process || !clean.shift)
        return say('有产量的行请填写业务日期、工序和班次。', true);
      if (!/^[0-9]+$/.test(String(row.quantity).trim()) || !Number.isSafeInteger(clean.quantity))
        return say('实际产量请输入非负整数。', true);
      if (keys.has(key)) return say(`「${clean.date} / ${clean.process} / ${clean.shift}」重复，请合并为一行。`, true);
      keys.add(key);
      rows.push(clean);
    }
    editor.inert = true;
    try {
      await saveManual(rows);
    } finally {
      editor.inert = false;
    }
  }, true);
  tools.append(suggest, add, showAll);
  const actions = el('div', undefined, 'lab-config-actions');
  actions.append(save, restore);
  editor.append(tools, feedback, scroll, empty, status, actions);
  root.append(editor);
  drawRows();
}


function renderDailyReasonGroups(root, options) {
  const maxGroups = 32;
  const maxReasons = 16;
  const { el, btn, check, settings, reasonGroupState: state, loadReasonOptions, saveReasonGroups } = options;
  const groups = settings.reasonGroups || [];
  const detail = el('details', undefined, 'lab-daily-reason-groups');
  detail.open = state.open;
  detail.ontoggle = () => { state.open = detail.open; };
  const heading = groups.length ? '合并判定原因 · 已保存 ' + groups.length + ' 组' : '合并判定原因';
  detail.append(el('summary', heading));
  const content = el('div', undefined, 'lab-daily-reason-content');
  detail.append(content);
  root.append(detail);

  const groupLabel = (group, index) => group.name || '自动命名组 ' + (index + 1);
  function edit(index) {
    const group = groups[index];
    state.draft = { index, name: group?.name || '', reasons: new Set(group?.reasons || []) };
    return draw();
  }

  function draw() {
    content.replaceChildren();
    content.append(el('p', '勾选多个判定原因可合到一张工作表。名称留空时自动命名，其余原因仍各用一张表。', 'lab-muted'));
    const draft = state.draft;
    if (!draft) {
      groups.forEach((group, index) => {
        const row = el('div', undefined, 'lab-daily-reason-group');
        const description = el('div');
        description.append(el('strong', groupLabel(group, index)),
          el('p', group.reasons.join('、'), 'lab-muted'));
        const actions = el('div', undefined, 'lab-config-actions');
        const editButton = btn('编辑', () => edit(index));
        editButton.setAttribute('aria-label', '编辑' + groupLabel(group, index));
        const removeButton = btn('移除', () => saveReasonGroups(groups.filter((_, candidate) => candidate !== index)));
        removeButton.setAttribute('aria-label', '移除' + groupLabel(group, index));
        actions.append(editButton, removeButton);
        row.append(description, actions);
        content.append(row);
      });
      const add = btn('添加分组', () => edit(groups.length));
      add.disabled = !loadReasonOptions || groups.length >= maxGroups;
      content.append(add);
      if (!loadReasonOptions) content.append(el('p', options.reasonOptionsUnavailable, 'lab-muted'));
      else if (groups.length >= maxGroups) content.append(el('p', '已达到 32 组上限。', 'lab-muted'));
      return;
    }

    const editor = el('fieldset', undefined, 'lab-daily-reason-editor');
    editor.append(el('legend', draft.index === groups.length ? '新分组' : '编辑分组'));
    const name = el('input');
    name.type = 'text';
    name.value = draft.name;
    name.maxLength = 31;
    name.placeholder = '例如 纤缩缺陷，留空自动命名';
    name.oninput = () => { draft.name = name.value; };
    const label = el('label', '工作表名称', 'lab-field');
    label.append(name);
    editor.append(label);
    const search = el('input');
    search.type = 'search';
    search.maxLength = 512;
    search.placeholder = '搜索当前筛选内的判定原因';
    search.setAttribute('aria-label', '搜索可分组的判定原因');
    if (loadReasonOptions) editor.append(search);
    const summary = el('p', undefined, 'lab-muted');
    summary.setAttribute('role', 'status');
    const choices = el('div', undefined, 'lab-facet-list lab-daily-reason-choices');
    editor.append(summary, choices);
    const actions = el('div', undefined, 'lab-config-actions');
    const save = btn('保存分组', async () => {
      editor.disabled = true;
      try {
        const next = [...groups];
        next[draft.index] = { name: draft.name.trim(), reasons: [...draft.reasons] };
        await saveReasonGroups(next);
      } finally {
        editor.disabled = false;
      }
    }, true);
    const cancel = btn('取消编辑', () => { state.draft = null; draw(); });
    actions.append(save, cancel);
    editor.append(actions);
    content.append(editor);

    const used = new Map();
    groups.forEach((group, index) => {
      if (index !== draft.index) group.reasons.forEach((reason) => used.set(reason, groupLabel(group, index)));
    });
    let offset = 0, requested = 0, timer, page = null, pageMessage = '', selectionMessage = '';
    const updateSummary = () => {
      save.disabled = draft.reasons.size === 0;
      summary.textContent = [pageMessage, '本组已选 ' + draft.reasons.size + ' 项', selectionMessage].filter(Boolean).join(' · ');
    };
    function option(reason, labelText) {
      const owner = used.get(reason);
      const unavailable = owner ? '已在' + owner : reason.length > 512 ? '原值超过 512 字符' : '';
      const node = check(unavailable ? labelText + '（' + unavailable + '）' : labelText, draft.reasons.has(reason), (yes) => {
        selectionMessage = '';
        if (yes && draft.reasons.size >= maxReasons) {
          node.children[0].checked = false;
          selectionMessage = '每组最多选 16 项。';
        } else if (yes) draft.reasons.add(reason);
        else draft.reasons.delete(reason);
        updateSummary();
      });
      node.children[0].disabled = Boolean(unavailable);
      return node;
    }
    function drawChoices() {
      choices.replaceChildren();
      const available = new Set(page?.values.map(({ value }) => value) || []);
      const saved = [...draft.reasons].filter((reason) => !available.has(reason));
      if (saved.length) {
        choices.append(el('p', '已选中、未列在当前候选页', 'lab-muted'));
        saved.forEach((reason) => choices.append(option(reason, reason)));
      }
      page?.values.forEach((value) => choices.append(option(value.value, value.label)));
      if (offset || page?.more) {
        const pager = el('div', undefined, 'lab-facet-tools');
        if (offset) pager.append(btn('上一页', () => { offset = Math.max(0, offset - 200); return load(); }));
        if (page?.more) pager.append(btn('下一页', () => { offset += 200; return load(); }));
        choices.append(pager);
      }
      updateSummary();
    }
    async function load() {
      if (!loadReasonOptions || !editor.isConnected) return;
      clearTimeout(timer);
      const token = ++requested;
      page = null;
      pageMessage = '正在读取判定原因…';
      drawChoices();
      try {
        const response = await loadReasonOptions(search.value.trim(), offset);
        if (token !== requested || !editor.isConnected) return;
        page = { ...response, values: response.values.filter(({ value }) => value !== '') };
        pageMessage = page.values.length || page.more ? '' : '当前筛选范围没有可选判定原因。';
        drawChoices();
      } catch (e) {
        if (token !== requested || !editor.isConnected) return;
        pageMessage = '无法读取判定原因：' + e.message;
        drawChoices();
        choices.append(btn('重试', load));
      }
    }
    search.oninput = (event) => {
      if (event?.isComposing) return;
      offset = 0;
      requested++;
      clearTimeout(timer);
      timer = setTimeout(load, 180);
    };
    if (!loadReasonOptions) {
      pageMessage = options.reasonOptionsUnavailable;
      drawChoices();
      return;
    }
    drawChoices();
    return load();
  }
  draw();
}

const dailyKeywordLimit = 100;
const writeDailyKeywords = (keywords) => keywords.map((word) =>
  /[\s"]/.test(word) ? '"' + word.replace(/["\\]/g, '\\$&') + '"' : word).join(' ');

function readDailyKeywords(raw) {
  const words = [];
  const token = /"((?:[^"\\]|\\["\\])*)"|([^\s"]+)|(")/gu;
  for (const match of raw.matchAll(token)) {
    if (match[3]) throw Error('请为带空格的关键词配对使用双引号。');
    const word = (match[1] === undefined ? match[2] : match[1].replace(/\\(["\\])/g, '$1')).trim();
    if (!word) throw Error('关键词不能为空。');
    if (word.length > 80) throw Error('每个关键词最多 80 个字符。');
    words.push(word);
  }
  if (!words.length || words.length > 8) throw Error('每行需要 1 至 8 个关键词。');
  return words;
}

function renderDailyRateKeywords(root, options) {
  const { el, btn, settings, rateKeywordState: state, defaultRateKeywords, saveRateKeywords } = options;
  const stored = settings.rateKeywords || [];
  const defaultTitle = '装管失效人员';
  const details = el('details', undefined, 'lab-daily-keywords');
  details.open = state.open;
  details.ontoggle = () => { state.open = details.open; };
  details.append(el('summary', '不良率 · 项目关键词'));
  const content = el('div', undefined, 'lab-daily-keywords-content');
  details.append(content);
  root.append(details);
  const newRows = (rules) => rules.map(({ label, keywords }) => ({ label, terms: writeDailyKeywords(keywords) }));

  function draw() {
    content.replaceChildren(
      el('p', '人员日报按判定时间 07:00 划分业务日，取当前范围最新有记录的一天；指定某天时先筛选该日。不良率表保留所选范围内的每日数据，产量可在 Excel 中填写。', 'lab-muted'),
    );
    if (!state.draft) {
      const description = el('p', undefined, 'lab-daily-keywords-status');
      description.append(el('strong', '日报标题：'), el('span', '日期＋' + (settings.dailyTitle || defaultTitle)),
        el('span', stored.length ? `自定义 ${stored.length} 条规则` : '使用示例报表的默认项目'));
      content.append(description, btn('编辑日报标题与关键词', () => {
        state.draft = { title: settings.dailyTitle || '', rows: newRows(stored) };
        draw();
        content.querySelector?.('input')?.focus();
      }));
      return;
    }
    const draft = state.draft;
    const title = el('input');
    title.type = 'text';
    title.value = draft.title;
    title.maxLength = 80;
    title.placeholder = defaultTitle;
    title.oninput = () => { draft.title = title.value; };
    const titleField = el('label', '日报标题后缀', 'lab-field');
    titleField.append(title);
    const editor = el('div', undefined, 'lab-daily-keywords-editor');
    editor.append(titleField,
      el('p', '举例：名称填「MPO并纤反」，关键词填「MPO 并纤反」。同一行须包含全部关键词，不区分大小写；同名多行满足任意一行即可。带空格的词用英文双引号括起。', 'lab-muted'));
    const header = el('div', undefined, 'lab-daily-keyword-row lab-daily-keyword-header');
    header.append(el('span', '项目名称'), el('span', '关键词（空格分开）'));
    const rows = el('div', undefined, 'lab-daily-keyword-rows');
    const tools = el('div', undefined, 'lab-config-actions');
    const feedback = el('p', '', 'lab-muted');
    feedback.setAttribute('role', 'status');
    const say = (message, error = false) => {
      feedback.textContent = message;
      feedback.classList.toggle('lab-error', error);
    };
    const add = btn('添加项目规则', () => {
      if (draft.rows.length >= dailyKeywordLimit) return;
      draft.rows.push({ label: '', terms: '' });
      drawRows();
      rows.children[rows.children.length - 1]?.children[0]?.focus();
    });
    const defaults = btn('载入示例项目', () => {
      draft.rows = newRows(defaultRateKeywords);
      drawRows();
      say('已载入示例，可修改后保存。');
    });
    const restore = btn('改用默认项目', () => {
      draft.rows = [];
      drawRows();
    });
    const save = btn('保存日报标题与关键词', async () => {
      const dailyTitle = draft.title.trim(), rateKeywords = [];
      for (const [index, row] of draft.rows.entries()) {
        const label = row.label.trim();
        try {
          if (!label || label.length > 36) throw Error('请填写不超过 36 个字符的项目名称。');
          rateKeywords.push({ label, keywords: readDailyKeywords(row.terms) });
        } catch (e) {
          rows.children[index]?.children[label ? 1 : 0]?.focus();
          say(`第 ${index + 1} 行：${e.message}`, true);
          return;
        }
      }
      editor.inert = true;
      try {
        await saveRateKeywords({ dailyTitle, rateKeywords });
      } finally {
        editor.inert = false;
      }
    }, true);
    const cancel = btn('取消关键词编辑', () => { state.draft = null; draw(); });
    const actions = el('div', undefined, 'lab-config-actions');
    actions.append(save, cancel);
    tools.append(add, defaults, restore);
    editor.append(tools, header, rows, feedback, actions);
    content.append(editor);
    function drawRows() {
      rows.replaceChildren();
      header.hidden = draft.rows.length === 0;
      add.disabled = draft.rows.length >= dailyKeywordLimit;
      defaults.hidden = !defaultRateKeywords.length;
      defaults.disabled = draft.rows.length > 0;
      restore.disabled = !draft.rows.length;
      if (!draft.rows.length) rows.append(el('p', '没有自定义规则时，继续使用默认项目。', 'lab-muted'));
      draft.rows.forEach((row, index) => {
        const line = el('div', undefined, 'lab-daily-keyword-row');
        for (const [key, label, placeholder] of [['label', '项目名称', '例如 MPO并纤反'], ['terms', '关键词', '例如 MPO 并纤反']]) {
          const control = el('input');
          control.type = 'text';
          control.value = row[key];
          control.maxLength = key === 'label' ? 36 : 1312;
          control.placeholder = placeholder;
          control.setAttribute('aria-label', `${label}（规则 ${index + 1}）`);
          control.oninput = () => { row[key] = control.value; say(''); };
          line.append(control);
        }
        const remove = btn('移除', () => {
          draft.rows.splice(index, 1);
          drawRows();
          if (draft.rows.length) rows.children[Math.min(index, draft.rows.length - 1)]?.children[2]?.focus();
          else add.focus();
        });
        remove.setAttribute('aria-label', `移除第 ${index + 1} 条项目规则`);
        line.append(remove);
        rows.append(line);
      });
      say('');
    }
    drawRows();
  }
  draw();
}

// A task-specific view. Persistence and file operations remain with the host.
function renderSheetReasons(root, options) {
  const { el, btn, check, select, settings, source, sheetReasonState: state } = options;
  if (!state) return;
  const section = el('section', undefined, 'lab-daily-section');
  section.append(el('h4', '判定原因与分表'));
  const autoLabel = source.columns.find((column) => column.id === options.automaticReason)?.label;
  const target = settings.reasonColumn || '';
  const column = select('判定原因列', [['', autoLabel ? '自动：' + autoLabel : '自动：未识别'],
    ...source.columns.map(({ id, label }) => [id, label])], target, (value) => {
    pending = value;
    saveColumn.disabled = value === target;
  });
  let pending = target;
  const saveColumn = btn('保存判定原因列', () => options.bindReasonColumn(pending));
  saveColumn.disabled = true;
  const binding = el('div', undefined, 'lab-fields');
  binding.append(column, saveColumn);
  section.append(binding, el('p', '确认更换绑定时，将清除旧列的分表选择和合并分组。绑定按数据源记忆。', 'lab-muted'));
  const entry = el('div', undefined, 'lab-config-actions');
  const chosen = settings.sheetReasons;
  entry.append(el('span', chosen ? `已指定 ${chosen.length} 项分表` : '默认：所有非空原因各自分表'),
    btn('选择要分表的原因', () => { state.open = true; entry.hidden = true; drawEditor(); }));
  section.append(entry);
  root.append(section);
  const drawEditor = () => {
    if (!options.loadReasonOptions) {
      entry.hidden = false;
      const prior = section.querySelector('[data-reason-empty]');
      if (!prior) {
        const hint = el('p', options.reasonOptionsUnavailable, 'lab-muted');
        hint.setAttribute('data-reason-empty', '');
        section.append(hint);
      }
      state.open = false;
      return;
    }
    const selected = new Set(chosen || []);
    const editor = el('div');
    const search = el('input');
    search.type = 'search';
    search.placeholder = '输入关键词查找判定原因';
    const status = el('p', '', 'lab-muted');
    status.setAttribute('aria-live', 'polite');
    const list = el('div', undefined, 'lab-facet-values');
    const pager = el('div', undefined, 'lab-facet-tools');
    const row = el('div', undefined, 'lab-config-actions');
    const cancel = () => { state.open = state.dirty = false; editor.remove(); entry.hidden = false; };
    const commit = btn('保存分表选择', () => options.saveSheetReasons([...selected]), true);
    row.append(commit, btn('恢复全部原因分表', () => options.saveSheetReasons(null)), btn('取消', cancel));
    const searchLabel = el('label', '查找原因');
    searchLabel.append(search);
    editor.append(searchLabel, status, list, pager, row);
    section.append(editor);
    let offset = 0, revision = 0, timer;
    const progress = (message) => {
      status.textContent = `${message} · 已选 ${selected.size} 项`;
      commit.disabled = selected.size === 0;
    };
    const load = async () => {
      const id = ++revision;
      progress('正在读取');
      list.replaceChildren();
      pager.replaceChildren();
      try {
        const response = await options.loadReasonOptions(search.value.trim(), offset);
        if (id !== revision || !editor.isConnected) return;
        const candidates = response.values.filter(({ value }) => value && value.length <= 512);
        const visible = new Set(candidates.map(({ value }) => value));
        const rows = [...[...selected].filter((value) => !visible.has(value)).map((value) => ({ value })), ...candidates];
        const message = candidates.length ? '勾选要单独建表的原因；已合并的分组继续生效' : '当前没有匹配的非空原因';
        for (const { value, count } of rows) {
          const item = check(count === undefined ? value : `${value}（${count} 条）`, selected.has(value), (yes) => {
            if (yes && selected.size >= 200) { item.children[0].checked = false; progress('最多选 200 项'); return; }
            if (yes) selected.add(value); else selected.delete(value);
            state.dirty = true;
            progress(message);
          });
          list.append(item);
        }
        if (offset) pager.append(btn('上一页', () => { offset -= 200; return load(); }));
        if (response.more) pager.append(btn('下一页', () => { offset += 200; return load(); }));
        progress(message);
      } catch (error) {
        if (id === revision && editor.isConnected) {
          progress('无法读取：' + error.message);
          pager.append(btn('重试', load));
        }
      }
    };
    search.oninput = (event) => {
      if (event?.isComposing) return;
      offset = 0; revision++; clearTimeout(timer); timer = setTimeout(load, 180);
    };
    queueMicrotask(() => { if (editor.isConnected) { search.focus(); void load(); } });
  };
  if (state.open) { entry.hidden = true; drawEditor(); }
}

window.renderDailyReportSettings = (root, options) => {
  const { el, btn, field, select, check, settings, source, productions, update } = options;
  const dailyByReason = settings.chartLayout === 'reason-columns';
  const section = (title, note) => {
    const node = el('section', undefined, 'lab-daily-section');
    node.append(el('h4', title), el('p', note, 'lab-muted'));
    root.append(node);
    return node;
  };
  const columns = section('1 · 表头与目标模板',
    '选择异常品查询原表或已导出的异常品分析表。选用已导出的分析表时，自动启用按判定原因分表。');
  const headers = el('details');
  headers.append(el('summary', '修改表头与对应列'));
  const sourceNames = ['date', 'process', 'defect', 'quantity', 'employee', 'shift'];
  const labels = { date: '日期', process: '工序', defect: '不良项', quantity: '不良数量', employee: '责任员工', shift: '班次' };
  const mapping = el('dl', undefined, 'lab-daily-mapping');
  sourceNames.forEach((role) => mapping.append(el('dt', labels[role]),
    el('dd', source.columns.find((c) => c.id === source.mapping[role])?.label || '未绑定')));
  headers.append(mapping);
  const actions = el('div', undefined, 'lab-config-actions');
  actions.append(btn('修改分析表头', options.editSource), btn('选择明细导出列', options.editQuick),
    btn('配置原表对应列', options.editTemplate));
  headers.append(actions);
  columns.append(headers);
  const template = el('div', undefined, 'lab-daily-template');
  template.append(el('span', settings.templatePath ? '已记住模板：' + settings.templatePath.split(/[\\/]/).at(-1) : '未绑定模板；首次导出时选择'),
    btn(settings.templatePath ? '更换模板文件' : '选择目标模板', options.chooseTemplate));
  columns.append(template);
  const layout = el('div', undefined, 'lab-fields');
  layout.append(select('总表图表排版', [
    ['readable', '清晰分页'],
    ['reason-columns', '按判定原因分表 · 竖排柱形'],
    ['original', '沿用模板排版'],
    ['hidden', '隐藏总表图表'],
  ], settings.chartLayout || 'readable', (value) => update('chartLayout', value)));
  columns.append(layout);
  const layoutTip = {
    readable: '人员过多时拆成多张图，每页一张。新增判定原因进入汇总及总表图。',
    'reason-columns': '可把指定原因合到一张分类表。每张分类表在总表对应一张完整簇状柱形图，包含全部姓名和独立系列。人员日报每组一图。总表含不良率折线，图表按横向 A4 排版。',
    original: '沿用原来的总表图表网格，图表多时打印可能缩小。',
    hidden: '总表保留明细，判定原因汇总和各分类工作表仍可查看。',
  };
  columns.append(el('p', layoutTip[settings.chartLayout || 'readable'], 'lab-muted'));
  if (dailyByReason) {
    renderSheetReasons(columns, options);
    renderDailyReasonGroups(columns, options);
  }

  const rates = section('2 · 实际产量与不良率',
    dailyByReason
      ? '日报按判定时间 07:00 划分业务日。未绑定产量也可先核对不良数，导出后填写产量；缺项或零产量不计算不良率。'
      : '按业务日期＋工序＋班次匹配。缺项时保留说明，零产量也不计算不良率。');
  const mode = settings.productionMode || 'bound';
  const modes = el('div', undefined, 'lab-fields');
  modes.append(select('产量录入方式', [
    ['bound', '从已绑定产量表读取'],
    ['manual', '手填实际产量'],
  ], mode, (value) => update('productionMode', value)));
  rates.append(check(dailyByReason ? '用已确认的产量自动填入不良率表' : '在目标 Excel 中附加不良率数据表和折线图', settings.includeRate,
    (value) => update('includeRate', value)), modes);
  if (mode === 'manual') renderDailyProductionEditor(rates, options);
  const rateFields = el('div', undefined, 'lab-fields');
  if (mode === 'bound') {
    rateFields.append(select('已配置的产量来源', [['', '请选择产量来源'], ...productions.map((s) => [s.id, s.name])],
      settings.productionId, (value) => update('productionId', value)));
    rates.append(rateFields);
    const selected = productions.find((s) => s.id === settings.productionId);
    if (selected) {
      const text = ['date', 'process', 'shift', 'quantity'].map((role) =>
        (role === 'quantity' ? '实际产量' : labels[role]) + '：' +
        (selected.columns.find((c) => c.id === selected.mapping[role])?.label || '未绑定')).join('　');
      rates.append(el('p', text, 'lab-daily-binding'));
    }
    rates.append(btn(selected ? '核对产量表头与数值' : '添加并绑定产量表', options.editProduction));
  }
  if (settings.includeRate) {
    const controls = el('div', undefined, 'lab-fields');
    if (!dailyByReason) controls.append(
      select('折线图汇总周期', [['day', '按日'], ['week', '按周'], ['month', '按月']],
        settings.period, (value) => update('period', value)));
    controls.append(select(dailyByReason ? '自动产量匹配口径' : '不良率口径', [
      ['same-scope', '相同统计范围（分子与分母条件一致）'],
      ['selected-defects', '所选不良件数 ÷ 对应工序班次总产量'],
    ], settings.rateBasis || 'same-scope', (value) => update('rateBasis', value)));
    if (!dailyByReason) controls.append(field('折线图标题', settings.rateTitle, (value) => update('rateTitle', value)));
    rates.append(controls);
    if (!dailyByReason && source.unit !== 'units') rates.append(el('p',
      '计算不良率前，请在分析表头中核对数量为已按件去重的不良数量。', 'lab-warning'));
  }
  if (dailyByReason) renderDailyRateKeywords(rates, options);

  const output = section('3 · 核对后导出',
    dailyByReason
      ? '导出沿用当前日期和筛选。不良率表与总表折线共用同一组值。判定业务日从 07:00 开始，缺产量时可在 Excel 填写。'
      : '导出会使用当前已应用的日期和筛选。勾选附加不良率时，折线图放在单独工作表。');
  const tools = el('div', undefined, 'lab-config-actions');
  if (settings.includeRate || dailyByReason) tools.append(btn('核对不良率数据与折线图', options.previewRate));
  tools.append(btn('导出每日目标 Excel', options.export, true));
  output.append(tools);
  const preview = el('section', undefined, 'lab-daily-rate-preview');
  preview.id = 'labDailyRatePreview';
  preview.setAttribute('aria-live', 'polite');
  output.append(preview);
};
