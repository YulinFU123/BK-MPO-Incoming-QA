'use strict';
window.renderAnalysisSources = (
  root,
  {
    config,
    draft,
    inspection,
    files,
    importHistory = null,
    loadImportHistory,
    changeImportBatch,
    onImportGuide,
    markGuide,
    calendarRule = window.AnalysisCalendar.ruleDefaults(),
    updateCalendar,
    recommend,
    useJudgmentDate,
    updateColumns,
    update: notifyUpdate,
    select,
    newSource,
    pick,
    scan,
    inspect,
    save,
    importFiles,
    backup,
    restore,
  },
) => {
  let dateHint = null,
    processHint = null,
    defectHint = null,
    calendarHint = null,
    refreshColumnLocks = () => {};
  const ruleText = () =>
    `${calendarRule.dayLabel} ${calendarRule.dayStart}–${calendarRule.dayEnd}；${calendarRule.nightLabel} ${calendarRule.nightStart}–次日${calendarRule.nightEnd}。包含结束分钟；其他时间或缺少时分的行标为“未归班”。`;
  const changeCalendar = (key, value) => {
    calendarRule = { ...calendarRule, [key]: value };
    updateCalendar(key, value);
    updateDateHint();
    refreshColumnLocks();
    if (calendarHint) calendarHint.textContent = ruleText();
  };
  const example = (id) =>
    inspection?.columns
      .find((c) => c.id === id)
      ?.examples?.slice(0, 3)
      .join('、') || '';
  function updateDateHint() {
    if (!dateHint) return;
    const column = draft.columns.find((c) => c.id === draft.mapping.date),
      sample = inspection?.columns
        .find((c) => c.id === draft.mapping.date)
        ?.examples?.slice(0, 2)
        .join('、');
    dateHint.textContent = column
      ? `统计日期使用：${column.label}${sample ? '；样例：' + sample : ''}。导入按这一列归属日期，不使用电脑当天。`
      : draft.dateFromFilename
        ? '统计日期使用文件名中的完整年月日，请核对文件名。'
        : '尚未指定统计日期列，请选择原表中的日期字段。';
    if (calendarRule.mode === 'check-time' && calendarRule.dateBasis !== 'mapped') {
      const clockColumn = draft.columns.find((c) => c.id === calendarRule.timeColumn);
      dateHint.textContent = `统计日期按${clockColumn?.label || '所选时间列'}${calendarRule.dateBasis === 'start' ? '的归班日期（零点后晚班归前一天）' : '的自然日期'}。有日期但无时分的行标为未归班。`;
    }
    if (processHint) {
      const c = draft.columns.find((c) => c.id === draft.mapping.process),
        samples = example(c?.id);
      const family = /^(?:report process type|process type in charge)$/i.test(c?.label || '');
      processHint.textContent = c
        ? `分类字段：${c.label}${samples ? '；样例：' + samples : ''}。${family ? '这类BI列可能是MPO/MMC等产品类型；若要按真实工序统计，请选择Workflow Step。' : /workflow step in charge/i.test(c.label) ? '当前为责任工序。' : /workflow step name/i.test(c.label) ? '当前为报检工序，与责任工序不同。' : ''}`
        : '尚未指定分类字段，可选择真实工序或产品类型。';
    }
    if (defectHint) {
      const chosen = inspection?.columns.find((c) => c.id === draft.mapping.defect);
      const reportCode = inspection?.columns.find((c) => c.label === '报告异常代码');
      defectHint.hidden = !chosen?.blankRows;
      defectHint.textContent = chosen?.blankRows
        ? `「${chosen.label}」有 ${chosen.blankRows} 行为空。` +
          (chosen.id === inspection.mlightReasonColumn
            ? '空白判定原因（未判、待判、已判放行等）会直接导入。'
            : reportCode && reportCode.id !== chosen.id && reportCode.blankRows === 0
            ? '如需用报告代码作主分类，可选「报告异常代码」，「判定原因」仍可单独筛选。'
            : '确认列选对后，空白会直接导入，可在分析中筛选「空白」。')
        : '';
    }
  }
  const update = (key, value) => {
    draft = { ...draft, [key]: value };
    notifyUpdate(key, value);
    updateDateHint();
    refreshColumnLocks();
  };
  const model = window.AnalysisStudio;
  const columnName = (column) => {
    const original = inspection?.columns.find((c) => c.id === column.id);
    if (Number.isInteger(original?.index)) {
      let index = original.index + 1, name = '';
      while (index) { index--; name = String.fromCharCode(65 + index % 26) + name; index = Math.floor(index / 26); }
      return `${column.label} · ${name}列`;
    }
    const matching = draft.columns.filter((c) => c.label === column.label);
    return column.label + (matching.length > 1 ? `（同名第${matching.findIndex((c) => c.id === column.id) + 1}列）` : '');
  };
  const el = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  const btn = (text, fn, primary = false) => {
    const n = el('button', text, 'button ' + (primary ? 'primary' : 'secondary'));
    n.type = 'button';
    n.onclick = fn;
    return n;
  };
  const input = (label, value, fn, type = 'text') => {
    const wrap = el('label', label, 'lab-field'),
      n = el('input');
    n.type = type;
    n.value = value;
    n.onchange = () => fn(type === 'number' ? Number(n.value) : n.value);
    wrap.append(n);
    return wrap;
  };
  const choice = (label, values, value, fn) => {
    const wrap = el('label', label, 'lab-field'),
      n = el('select');
    for (const [id, text] of values) n.add(new Option(text, id));
    n.value = value;
    n.onchange = () => fn(n.value);
    wrap.append(n);
    return wrap;
  };
  const checkbox = (label, value, fn) => {
    const wrap = el('label', undefined, 'lab-check'),
      n = el('input');
    n.type = 'checkbox';
    n.checked = value;
    n.onchange = () => fn(n.checked);
    wrap.append(n, el('span', label));
    return wrap;
  };
  root.replaceChildren();
  const layout = el('div', undefined, 'lab-source-layout'),
    library = el('aside', undefined, 'lab-source-list'),
    body = el('section', undefined, 'lab-source-editor');
  library.append(
    el('h3', '数据源'),
    markGuide(btn('添加BI文件夹', () => newSource('defects'), true), 'source'),
    btn('导入实操引导', onImportGuide),
    btn('添加产量文件夹', () => newSource('production')),
  );
  for (const source of config.sources) {
    const b = btn(source.name + ' · ' + (source.kind === 'production' ? '产量' : '不良'), () =>
      select(source.id),
    );
    b.setAttribute('aria-current', String(source.id === draft?.id));
    library.append(source.kind === 'defects' ? markGuide(b, 'source') : b);
  }
  library.append(
    el('p', '扩展负责下载。平台只读取你指定目录的XLSX/CSV，不操作公司网页。', 'lab-muted'),
  );
  const maintenance = el('details', undefined, 'lab-options');
  maintenance.append(
    el('summary', '备份与恢复'),
    btn('备份分析资料', backup),
    btn('恢复到空分析库', restore),
  );
  library.append(maintenance);
  layout.append(library, body);
  root.append(layout);
  if (!draft) {
    body.append(
      el('h3', '先添加一个下载文件夹'),
      el(
        'p',
        '添加BI文件夹后识别表头，确认字段，再导入。产量文件夹按日期＋工序＋班次匹配。',
        'lab-muted',
      ),
    );
    return;
  }
  body.append(el('h3', draft.kind === 'production' ? '产量数据源' : 'BI不良数据源'));
  const basics = el('div', undefined, 'lab-fields');
  basics.append(
    input('名称', draft.name, (v) => update('name', v)),
    markGuide(input('文件夹路径（可直接粘贴）', draft.folder, (v) => update('folder', v)), 'folder'),
    markGuide(btn('选择文件夹', pick), 'folder'),
    markGuide(btn('扫描文件', scan), 'scan'),
  );
  body.append(basics);
  const structure = el('div', undefined, 'lab-fields');
  structure.append(
    choice(
      '工作表',
      [
        ['', '自动选择最匹配表'],
        ...[...new Set([draft.sheet, ...(inspection?.sheets || [])].filter(Boolean))].map(
          (name) => [name, name],
        ),
      ],
      draft.sheet,
      (v) => update('sheet', v),
    ),
    input('表头行，0自动', draft.headerRow, (v) => update('headerRow', v), 'number'),
    choice(
      '日期解释',
      [
        ['auto', '自动（有歧义时需确认）'],
        ['ymd', '年/月/日'],
        ['mdy', '月/日/年'],
        ['dmy', '日/月/年'],
        ['excel', 'Excel日期序号'],
      ],
      draft.dateFormat,
      (v) => update('dateFormat', v),
    ),
    ...(calendarRule.mode === 'column'
      ? [input('业务日切时点（小时）', draft.cutoff, (v) => update('cutoff', v), 'number')]
      : []),
  );
  body.append(
    structure,
    markGuide(btn('识别最新文件表头', () => inspect(''), true), 'inspect'),
  );
  if (inspection) {
    body.append(
      el(
        'p',
        `${inspection.name} · ${inspection.sheet} · 第${inspection.headerRow}行表头 · ${inspection.rowCount}行待核对`,
        'lab-muted',
      ),
    );
    const sample = el('div', undefined, 'lab-table-scroll'),
      table = el('table'),
      head = el('thead'),
      tr = el('tr');
    inspection.columns.forEach((c) => tr.append(el('th', c.label)));
    head.append(tr);
    table.append(head);
    const tb = el('tbody');
    inspection.preview.forEach((row) => {
      const tr = el('tr');
      row.forEach((value) => tr.append(el('td', value)));
      tb.append(tr);
    });
    table.append(tb);
    sample.append(table);
    body.append(sample);
    const selected = new Set(draft.columns.map((column) => column.id));
    const requiredRoles = draft.kind === 'defects'
      ? ['date', 'defect', 'quantity']
      : ['date', 'quantity', 'process', 'shift'];
    const requiredColumns = () => new Set([
      ...requiredRoles.map((role) => draft.mapping[role]).filter(Boolean),
      ...draft.uniqueColumns,
      ...(calendarRule.mode === 'check-time' && calendarRule.timeColumn ? [calendarRule.timeColumn] : []),
    ]);
    const columnPicker = markGuide(el('fieldset', undefined, 'lab-column-picker'), 'columns');
    columnPicker.append(el('legend', `导入列 · 已选 ${selected.size} / ${inspection.columns.length}`));
    const toolbar = el('div', undefined, 'lab-toolbar');
    const all = btn('全选列', () => updateColumns(inspection.columns.map((column) => column.id), all.id));
    all.id = 'labSelectAllColumns';
    const requiredOnly = btn('仅保留必需列', () => updateColumns([...requiredColumns()], requiredOnly.id));
    requiredOnly.id = 'labSelectRequiredColumns';
    toolbar.append(all, requiredOnly);
    columnPicker.append(toolbar, el('p',
      '勾选的列可用于分析、筛选和导出。更换映射、数量口径、班次时间列或唯一字段设置后，可取消旧列。',
      'lab-muted',
    ));
    if (inspection.sheet === 'container')
      columnPicker.append(el('p', '按 mLight 原表导出需要勾选原表的 25 列。', 'lab-muted'));
    const columnList = el('div', undefined, 'lab-column-list');
    const controls = [];
    for (const column of inspection.columns) {
      const focusId = `lab-import-${column.id}`;
      const box = checkbox(column.label, selected.has(column.id), (checked) => {
        const ids = [...selected].filter((id) => id !== column.id);
        if (checked) ids.push(column.id);
        updateColumns(ids, focusId);
      });
      const [control, label] = box.children;
      control.id = focusId;
      controls.push({ column, control, label });
      columnList.append(box);
    }
    refreshColumnLocks = () => {
      const required = requiredColumns();
      requiredOnly.disabled = !required.size;
      for (const { column, control, label } of controls) {
        control.disabled = required.has(column.id);
        label.textContent = column.label + (control.disabled ? '（必需）' : '');
      }
    };
    refreshColumnLocks();
    columnPicker.append(columnList);
    body.append(columnPicker);
  }
  if (draft.columns.length) {
    body.append(el('h4', draft.kind === 'production' ? '产量绑定 · 选择实际数值所在列' : '字段对应（责任员工与报检人独立）'));
    dateHint = el('p', undefined, 'lab-date-mapping-note');
    dateHint.setAttribute('role', 'status');
    processHint = el('p', undefined, 'lab-date-mapping-note');
    processHint.setAttribute('role', 'status');
    if (draft.kind === 'defects') {
      defectHint = el('p', undefined, 'lab-date-mapping-note');
      defectHint.setAttribute('role', 'status');
    }
    body.append(dateHint, processHint);
    if (defectHint) body.append(defectHint);
    const judgment = draft.kind === 'defects' &&
      (inspection?.columns.find((c) => c.id === inspection.decisionDateColumn) ||
        draft.columns.find((c) => c.label.trim() === '判定时间'));
    if (judgment) {
      body.append(el('p', '按判定时间统计时，空白行会在导入结果中列出数量。变更日期后请保存并重新导入原文件。', 'lab-date-mapping-note'));
      if (useJudgmentDate) body.append(btn('改用判定时间', () => useJudgmentDate(judgment)));
    }
    if (inspection?.dateFallback) {
      body.append(el('p',
        `Check Date 有 ${inspection.dateFallback.missingCheckDates} 行为空。建议用 Work Date 统计日期，按 Check Date 划分班次，缺少时间的行标为未归班。`,
        'lab-date-mapping-note',
      ));
    }
    if (inspection && recommend && !judgment) body.append(btn(
      inspection.dateFallback ? '应用 Work Date 与班次设置' : '应用推荐字段与Check Date班次口径',
      recommend,
    ));
    updateDateHint();
    const fields = markGuide(el('div', undefined, 'lab-fields'), 'mapping');
    for (const role of (draft.kind === 'production' ? ['date', 'process', 'shift', 'quantity', 'product', 'floor'] : model.roles)) {
      const required =
        role === 'date' ||
        (draft.kind === 'defects' && role === 'defect') ||
        (draft.kind === 'production' && ['quantity', 'process', 'shift'].includes(role));
      const currentExample = el('small', example(draft.mapping[role]) ? '样例：' + example(draft.mapping[role]) : '可从任意已选表头绑定', 'lab-mapping-example');
      const control = choice(
          (role === 'process' && draft.kind === 'defects'
            ? '分类字段（工序／产品类型）'
            : role === 'quantity' && draft.kind === 'production' ? '实际产量数值' : model.labels[role]) + (required ? ' *' : ''),
          [
            ['', '不指定'],
            ...draft.columns.map((c) => [
              c.id,
              columnName(c) +
                (inspection?.confidence?.[role] === 'review' && draft.mapping[role] === c.id
                  ? '（需复核）'
                  : ''),
            ]),
          ],
          draft.mapping[role] || '',
          (v) => {
            update('mapping', { ...draft.mapping, [role]: v });
            currentExample.textContent = example(v) ? '样例：' + example(v) : '未指定或暂无样例';
          },
        );
      control.append(currentExample);
      fields.append(control);
    }
    body.append(fields);
    if (draft.kind === 'production') {
      body.append(el('p', inspection?.productionHints?.quantityNote || '实际产量用于不良率分母。请不要选择目标产量、差异、良率或金额。', 'lab-date-mapping-note'));
      const binding = el('details', undefined, 'lab-production-aliases');
      binding.append(el('summary', '名称对应与分组空白（仅两表写法不同时设置）'),
        el('p', '同名日期、工序优先选每行有值的列。原表名称保留不变，对应规则仅用于产量匹配。', 'lab-muted'));
      const currentBinding = () => draft.productionBinding || { layout: 'rows', fillDown: [], processAliases: {}, shiftAliases: {} };
      body.append(choice('实际产量未填写时', [['reject', '提示补充后再导入'], ['pending', '保留为待补充，涉及范围暂不计算不良率']],
        currentBinding().missingQuantity || 'reject', (value) => update('productionBinding', { ...currentBinding(), missingQuantity: value })));
      for (const [role, title] of [['date', '日期空白时沿用上方分组'], ['process', '工序空白时沿用上方分组']])
        binding.append(checkbox(title, currentBinding().fillDown.includes(role), (enabled) => {
          const value = currentBinding();
          update('productionBinding', { ...value, fillDown: enabled ? [...new Set([...value.fillDown, role])] : value.fillDown.filter((item) => item !== role) });
        }));
      for (const [key, title, sample] of [['processAliases', '工序名称对应', '产量表工序=不良表工序'], ['shiftAliases', '班次名称对应', '例如：晚班=夜班（仅当两表确实使用这些名称）']]) {
        const wrapper = el('label', title, 'lab-field'), input = el('textarea');
        input.value = Object.entries(currentBinding()[key]).map(([a, b]) => a + '=' + b).join('\n');
        input.placeholder = sample;
        wrapper.append(input, el('small', '每行一项：原名称=分析中使用的名称', 'lab-muted'));
        const state = el('p', '', 'lab-muted');
        const apply = btn('应用' + title, () => {
          try {
            const values = {};
            for (const line of input.value.split(/\r?\n/).filter((text) => text.trim())) {
              const at = line.indexOf('=');
              const from = line.slice(0, at).trim(), to = line.slice(at + 1).trim();
              if (at < 1 || !to || ['__proto__', 'constructor', 'prototype'].includes(from) || Object.hasOwn(values, from))
                throw Error('请按每行“原名称=对应名称”填写，原名称不能重复。');
              values[from] = to;
            }
            const next = { ...currentBinding(), [key]: values };
            model.source({ ...draft, productionBinding: next, confirmed: false });
            update('productionBinding', next);
            state.textContent = '已应用到当前草稿；核对后保存来源并重新导入。';
          } catch (error) { state.textContent = error.message; }
        });
        binding.append(wrapper, apply, state);
      }
      body.append(binding);
    }
    const mappedIds = new Set(Object.values(draft.mapping).filter(Boolean));
    const extraColumns = draft.columns.filter((c) => !mappedIds.has(c.id));
    if (extraColumns.length) {
      const extra = el('details', undefined, 'lab-extra-columns');
      const extraSummary = el('summary', `其他已识别列（${extraColumns.length} 列，可用于筛选与分析）`);
      extra.append(extraSummary);
      const help = el(
        'p',
        '下面这些列已随表头自动识别，无需在此处映射；在「分析维度」「筛选」「明细导出」里都能直接选用。',
        'lab-muted',
      );
      extra.append(help);
      const chips = el('div', undefined, 'lab-extra-chips');
      for (const c of extraColumns)
        chips.append(el('span', c.label, 'lab-extra-chip'));
      extra.append(chips);
      body.append(extra);
    }
    if (updateCalendar) {
      const section = el('section', undefined, 'lab-calendar');
      section.append(el('h4', '时间与班次'));
      const controls = el('div', undefined, 'lab-fields');
      controls.append(
        choice(
          '班次来源',
          [
            ['column', '读取原班次列'],
            ['check-time', '按Check Date等时间列计算'],
          ],
          calendarRule.mode,
          (v) => changeCalendar('mode', v),
        ),
      );
      if (calendarRule.mode === 'check-time') {
        controls.append(
          choice(
            '班次时间列',
            [['', '请选择'], ...draft.columns.map((c) => [c.id, c.label])],
            calendarRule.timeColumn,
            (v) => changeCalendar('timeColumn', v),
          ),
          choice(
            '统计日期归属',
            [
              ['start', '晚班跨零点归开班日'],
              ['calendar', '按时间列自然日期'],
              ['mapped', '沿用上方日期列／文件名'],
            ],
            calendarRule.dateBasis,
            (v) => changeCalendar('dateBasis', v),
          ),
        );
      }
      section.append(controls);
      if (calendarRule.mode === 'check-time') {
        const note = el(
          'p',
          `${calendarRule.dayLabel} ${calendarRule.dayStart}–${calendarRule.dayEnd}；${calendarRule.nightLabel} ${calendarRule.nightStart}–次日${calendarRule.nightEnd}。包含结束分钟；其他时间或缺少时分的行标为“未归班”。`,
          'lab-muted',
        );
        calendarHint = note;
        section.append(note);
        const details = el('details');
        details.append(el('summary', '调整班次时间与名称'));
        const times = el('div', undefined, 'lab-fields');
        for (const [key, label] of [
          ['dayStart', '白班开始'],
          ['dayEnd', '白班结束'],
          ['nightStart', '晚班开始'],
          ['nightEnd', '晚班结束'],
        ])
          times.append(input(label, calendarRule[key], (v) => changeCalendar(key, v), 'time'));
        for (const [key, label] of [
          ['dayLabel', '白班名称'],
          ['nightLabel', '晚班名称'],
        ])
          times.append(input(label, calendarRule[key], (v) => changeCalendar(key, v)));
        details.append(
          times,
          el(
            'p',
            '班次名称必须与产量表一致；时间规则单独记忆，修改后需确认并重新导入。',
            'lab-muted',
          ),
        );
        section.append(details);
      }
      body.append(section);
    }
    if (draft.kind === 'defects') {
      body.append(
        choice(
          '数量含义',
          [
            ['events', '不良数量/次数（不计算真实不良率）'],
            ['units', '已按件去重的不良件数（允许匹配产量）'],
          ],
          draft.unit,
          (v) => update('unit', v),
        ),
        choice(
          '每日数据覆盖',
          [
            ['rows', '仅确认实际记录，不推定缺失工序为零'],
            ['daily_complete', '确认每日文件完整，无记录工序/班次可视为零'],
          ],
          draft.coverage,
          (v) => update('coverage', v),
        ),
      );
    }
    const advanced = el('details');
    advanced.append(el('summary', '去重、文件修订与自动读取'));
    advanced.append(
      choice(
        '同名文件更新方式',
        [
          ['replace_dates', '同名同日期视为修订，其他日期保留'],
          ['append', '只追加，按唯一字段或精确行去重'],
        ],
        draft.updateMode,
        (v) => update('updateMode', v),
      ),
      checkbox('缺少日期列时，确认使用文件名的完整年月日', draft.dateFromFilename, (v) =>
        update('dateFromFilename', v),
      ),
      checkbox('本页打开时每15秒自动读取已确认结构的新文件', draft.auto, (v) => update('auto', v)),
      el(
        'p',
        '同一文件指纹不重复导入。未设置唯一字段时按完整行精确去重；不同导出存在修改时，建议配置业务唯一字段。产量默认每日期＋工序＋班次唯一。',
        'lab-muted',
      ),
    );
    const unique = el('div', undefined, 'lab-check-list');
    draft.columns.forEach((c) =>
      unique.append(
        checkbox(c.label, draft.uniqueColumns.includes(c.id), (value) =>
          update(
            'uniqueColumns',
            value
              ? [...draft.uniqueColumns, c.id]
              : draft.uniqueColumns.filter((id) => id !== c.id),
          ),
        ),
      ),
    );
    advanced.append(el('strong', '业务唯一字段（可选，最多8列）'), unique);
    body.append(advanced);
    let confirmed = false;
    const confirm = checkbox('已核对字段、日期、班次与数量口径，允许导入', false, (v) => {
      confirmed = v;
    });
    body.append(
      markGuide(confirm, 'mapping'),
      markGuide(btn('确认映射并保存来源', () => save(confirmed), true), 'mapping'),
    );
  }
  if (files.length) {
    const importButton = btn('导入目录内符合映射的文件', () => importFiles(), true);
    body.append(
      el('h4', '目录文件与导入结果'),
      files.some((file) => file.error) ? importButton : markGuide(importButton, 'import'),
    );
    const table = el('table'),
      head = el('thead'),
      tr = el('tr');
    ['文件', '状态', '信息', '操作'].forEach((v) => tr.append(el('th', v)));
    head.append(tr);
    table.append(head);
    const rows = el('tbody');
    files.forEach((file) => {
      const tr = el('tr');
      tr.append(
        el('td', file.name),
        el('td', file.status),
        el(
          'td',
          file.error ||
            (file.rows !== undefined
              ? `${file.rows} 行。${file.warning || ''}`
              : file.size !== undefined
                ? `${Math.round(file.size / 1024)} KB`
                : ''),
        ),
      );
      const td = el('td');
      td.append(btn('查看表头', () => inspect(file.name)));
      if (file.error && draft.confirmed) {
        td.append(markGuide(btn('重试此文件', () => importFiles(file.name)), 'import'));
      }
      tr.append(td);
      rows.append(tr);
    });
    table.append(rows);
    const scroll = el('div', undefined, 'lab-table-scroll');
    scroll.append(table);
    body.append(scroll);
  }
  if (draft.confirmed && config.sources.some((source) => source.id === draft.id) && loadImportHistory) {
    const history = el('section', undefined, 'lab-import-history');
    history.append(el('h4', '已导入批次'),
      btn(importHistory ? '刷新导入历史' : '查看导入历史', () => loadImportHistory(importHistory?.offset || 0)));
    if (importHistory) {
      if (!importHistory.batches.length) history.append(el('p', '当前来源没有导入批次。', 'lab-muted'));
      else {
        const table = el('table');
        const header = el('tr');
        ['原文件', '导入时间', '记录数', '状态', '操作'].forEach((label) => header.append(el('th', label)));
        const head = el('thead');
        head.append(header);
        const rows = el('tbody');
        for (const batch of importHistory.batches) {
          const row = el('tr');
          row.append(el('td', batch.name), el('td', new Date(batch.created).toLocaleString('zh-CN')),
            el('td', `${batch.rowCount} 行，当前参与 ${batch.visibleRows} 行`), el('td', batch.status));
          const operation = el('td');
          const toggle = btn(batch.withdrawn ? '恢复此批次' : '撤销此批次', () => changeImportBatch(batch));
          toggle.disabled = !batch.canChange;
          operation.append(toggle);
          if (batch.note) operation.append(el('small', batch.note, 'lab-muted'));
          row.append(operation);
          rows.append(row);
        }
        table.append(head, rows);
        const scroll = el('div', undefined, 'lab-table-scroll');
        scroll.append(table);
        history.append(scroll);
      }
      const pagination = el('div', undefined, 'lab-chart-actions');
      const previous = btn('前50批次', () => loadImportHistory(Math.max(0, importHistory.offset - 50)));
      previous.disabled = !importHistory.offset;
      const next = btn('后50批次', () => loadImportHistory(importHistory.offset + 50));
      next.disabled = !importHistory.more;
      pagination.append(previous, el('span', `共 ${importHistory.total} 批次`), next);
      history.append(pagination);
    }
    body.append(history);
  }
};
