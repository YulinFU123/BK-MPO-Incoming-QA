/* History selection and preview only. The renderer owns validated form updates. */
window.FillHistoryUI = Object.freeze({
  install(api) {
    'use strict';
    const modal = document.createElement('dialog');
    modal.id = 'historyFillDialog';
    modal.className = 'history-fill-dialog';
    modal.setAttribute('aria-labelledby', 'historyFillTitle');
    modal.innerHTML = `<div class="modal-head"><div><h2 id="historyFillTitle">历史常用组合</h2><p id="historyFillScope"></p></div><button type="button" class="close-x" id="historyFillClose" aria-label="关闭常用组合">×</button></div>
      <div class="history-fill-body"><label class="history-search-label" for="historyFillSearch">搜索组合<input id="historyFillSearch" type="search" maxlength="100" placeholder="搜索区域、工序、批次或异常内容"></label><p class="config-help">从历史记录中汇总勾选“连续沿用”的共同字段；只补空白。SN、日期、序号、唯一值和关联编号不参与，不会保存成新记录。</p><p id="historyFillCount" class="history-fill-count"></p><div class="history-fill-layout"><ul id="historyFillList" class="history-fill-list" aria-label="可用的历史组合"></ul><section class="history-fill-detail" aria-labelledby="historyFillPreviewTitle"><h3 id="historyFillPreviewTitle">补入预览</h3><div id="historyFillPreview"></div></section></div><p id="historyFillStatus" role="status"></p></div>
      <div class="config-foot"><button type="button" class="btn" id="historyFillCancel">取消</button><button type="button" class="btn btn-primary" id="historyFillApply">补入空白字段</button></div>`;
    document.body.append(modal);
    const byId = id => document.getElementById(id);
    const openButton = byId('historyFill'), undoButton = byId('undoHistoryFill');
    let data, expected, selected, undoSnapshot;
    const node = (tag, text, className) => {
      const element = document.createElement(tag);
      if (text !== undefined) element.textContent = text;
      if (className) element.className = className;
      return element;
    };
    const sameContext = context => expected && context.template.id === expected.templateId && context.revision === expected.revision && !context.editing;
    function preview() {
      const box = byId('historyFillPreview'), apply = byId('historyFillApply');
      box.replaceChildren();
      const context = api.context();
      if (!selected || !sameContext(context)) {
        box.append(node('p', '没有可预览的组合。', 'config-help'));
        byId('historyFillStatus').textContent = '';
        apply.disabled = true;
        return;
      }
      const plan = FillHistoryCore.plan(context.template, selected.values, context.values, InputRules.validate);
      const table = node('table', undefined, 'history-preview-table');
      const tbody = document.createElement('tbody');
      for (const column of data.columns) {
        const value = selected.values[column.id];
        if (!value) continue;
        const row = document.createElement('tr');
        const heading = node('th', column.label), cell = node('td');
        heading.scope = 'row';
        cell.append(node('div', value, 'history-preview-value'));
        const invalid = plan.invalid.find(item => item.label === column.label);
        const status = plan.updates[column.id] !== undefined ? '待补入' : invalid ? '跳过：' + invalid.error : '保留当前：' + context.values[column.id];
        cell.append(node('small', status, invalid ? 'history-invalid' : plan.updates[column.id] !== undefined ? 'history-ready' : 'history-preserved'));
        row.append(heading, cell); tbody.append(row);
      }
      table.append(tbody); box.append(table);
      const count = Object.keys(plan.updates).length;
      byId('historyFillStatus').textContent = `可补入 ${count} 项；保留已有 ${plan.skipped.length} 项` + (plan.invalid.length ? `；${plan.invalid.length} 项不符合当前规则，将跳过。` : '。');
      apply.disabled = count === 0;
    }
    function renderList() {
      const query = byId('historyFillSearch').value.trim().toLocaleLowerCase();
      const matches = data.groups.filter(group => Object.values(group.values).some(value => value.toLocaleLowerCase().includes(query)));
      const shown = matches.slice(0, 30), list = byId('historyFillList');
      list.replaceChildren();
      selected = shown.find(group => group.key === selected?.key) || shown[0];
      byId('historyFillCount').textContent = `共 ${matches.length} 组` + (matches.length > 30 ? '，显示最常用的前 30 组；可搜索其余组合。' : '，按使用次数和最近记录时间排序。');
      if (!shown.length) {
        const message = !data.columns.length ? '当前表头没有可沿用的共同字段，可在“表头与规则”中勾选“连续沿用”。' : query ? '没有匹配的组合，请更换关键词。' : '尚无历史共同信息。先保存记录，之后可在这里选择复用。';
        list.append(node('li', message, 'history-fill-empty'));
      }
      for (const group of shown) {
        const item = document.createElement('li'), button = node('button', undefined, 'history-option');
        button.type = 'button';
        button.setAttribute('aria-pressed', String(selected === group));
        button.tabIndex = selected === group ? 0 : -1;
        const values = Object.values(group.values).filter(Boolean);
        const title = values.slice(0, 3).join(' · ');
        button.append(node('strong', title));
        const time = new Date(group.lastAt);
        const date = Number.isNaN(time.getTime()) ? '时间未记录' : time.toLocaleDateString('zh-CN');
        button.append(node('small', `${group.count} 次使用 · 最近 ${date}`));
        button.addEventListener('click', () => { selected = group; renderList(); [...list.querySelectorAll('button')].find(element => element.getAttribute('aria-pressed') === 'true')?.focus(); });
        item.append(button); list.append(item);
      }
      preview();
    }
    function open() {
      const context = api.context();
      if (!context.unlocked) return;
      if (context.editing) { api.status('请先完成或取消当前修改，再选择历史组合。', true); return; }
      expected = {templateId: context.template.id, revision: context.revision};
      data = FillHistoryCore.collect(context.template, context.records);
      selected = null;
      byId('historyFillSearch').value = '';
      byId('historyFillScope').textContent = '当前异常类型：' + context.template.name;
      byId('historyFillStatus').textContent = '';
      renderList();
      api.closeSuggestions();
      modal.showModal();
      byId('historyFillSearch').focus();
    }
    function reset() {
      undoSnapshot = null;
      undoButton.disabled = true;
      if (modal.open) modal.close();
    }
    openButton.addEventListener('click', open);
    byId('historyFillSearch').addEventListener('input', renderList);
    byId('historyFillList').addEventListener('keydown', event => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const buttons = [...byId('historyFillList').querySelectorAll('button')];
      if (!buttons.length) return;
      event.preventDefault();
      const index = buttons.indexOf(document.activeElement);
      buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length].click();
    });
    for (const id of ['historyFillClose', 'historyFillCancel']) byId(id).addEventListener('click', () => modal.close());
    byId('historyFillApply').addEventListener('click', () => {
      if (!selected) return;
      const result = api.apply(expected, selected.values);
      if (!result.ok) { byId('historyFillStatus').textContent = result.error; preview(); return; }
      undoSnapshot = {expected, before: result.before, applied: result.updates};
      undoButton.disabled = false;
      modal.close();
      api.focus();
      api.status(`已补入 ${Object.keys(result.updates).length} 项共同信息，已有内容已保留；请核对后保存。`);
    });
    undoButton.addEventListener('click', () => {
      if (!undoSnapshot) return;
      const result = api.undo(undoSnapshot);
      reset();
      api.status(result.ok ? `已撤销 ${result.count} 项补入，之后手动修改的内容已保留。` : result.error, !result.ok);
    });
    reset();
    return Object.freeze({reset});
  }
});
