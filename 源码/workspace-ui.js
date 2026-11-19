/* Presentation composition only: no persistence or record mutations. */
(() => {
  'use strict';
  const byId = id => document.getElementById(id);

  function actionMenu(label, ids, host, key = ids[0]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn menu-trigger';
    button.textContent = label;
    button.append(UISymbol.create('down'));
    button.classList.add('with-symbol');
    const menu = document.createElement('div');
    menu.className = 'action-menu';
    menu.id = 'actions_' + key;
    menu.setAttribute('popover', 'auto');
    button.setAttribute('popovertarget', menu.id);
    menu.setAttribute('aria-label', label);
    ids.forEach(id => menu.append(byId(id)));
    host.append(button, menu);
    ActionMenu.attach(button, menu);
  }

  // Primary tasks stay visible. Occasional actions get a single named entry.
  actionMenu('辅助填写', ['historyFill', 'fillFromSN', 'copyPrevious', 'undoHistoryFill', 'clearForm'], document.querySelector('.entry-actions .left'), 'fillFromSN');
  actionMenu('更多操作', ['importCsv', 'exportCsv', 'copyTable', 'undoDelete'], document.querySelector('.tool-right'));
  const settings = document.createElement('details');
  settings.className = 'nav-settings';
  settings.open = true;
  const summary = document.createElement('summary');
  summary.textContent = '设置与数据';
  settings.append(summary, byId('sideConfig'), byId('sideBackup'), byId('openSecurity'));
  document.querySelector('.side-nav').append(settings);
  const appearance = document.createElement('button');
  appearance.id = 'openAppearance';
  appearance.type = 'button';
  appearance.className = 'nav-item';
  appearance.append(UISymbol.create('glass'));
  const appearanceLabel = document.createElement('span');
  appearanceLabel.textContent = '外观与布局';
  appearance.append(appearanceLabel);
  appearance.addEventListener('click', () => Appearance.open());
  settings.append(appearance);
  byId('openSettings').hidden = true;
  byId('backupBtn').hidden = true;

  // Split a previously long settings sheet into four task-focused panes.
  const body = document.querySelector('#settingsDialog .modal-body');
  const children = [...body.children];
  const groups = ['基本信息', '字段与校验', '自动填写与分析', '数据管理'];
  const tabs = document.createElement('div');
  tabs.className = 'settings-tabs';
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', '配置分类');
  const panels = groups.map((name, index) => {
    const panel = document.createElement('section');
    panel.id = 'settingsPane' + index;
    panel.className = 'settings-pane';
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', 'settingsTab' + index);
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.textContent = name;
    tab.id = 'settingsTab' + index;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', panel.id);
    tab.addEventListener('click', () => select(index));
    tabs.append(tab);
    return panel;
  });
  function select(index) {
    panels.forEach((panel, i) => {
      panel.hidden = i !== index;
      tabs.children[i].setAttribute('aria-selected', String(i === index));
      tabs.children[i].tabIndex = i === index ? 0 : -1;
    });
    body.scrollTop = 0;
  }
  tabs.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = [...tabs.children].indexOf(document.activeElement);
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? 3 : (current + (event.key === 'ArrowRight' ? 1 : 3)) % 4;
    select(index);
    tabs.children[index].focus();
  });
  let group = 0;
  children.forEach(child => {
    const title = child.querySelector('h3')?.textContent;
    if (title === '字段设置') group = 1;
    if (title === '条件联动填写') group = 2;
    if (title === '数据恢复与管理') group = 3;
    if (!child.matches('hr')) panels[group].append(child);
  });
  body.replaceChildren(...panels);
  body.before(tabs);
  select(1);
  // Keep long explanatory copy available without overwhelming the field list.
  const help = panels[1].querySelector('.config-help');
  if (help) {
    const details = document.createElement('details');
    details.className = 'settings-help';
    const label = document.createElement('summary');
    label.textContent = '唯一值、连续沿用与扫码规则说明';
    help.before(details);
    details.append(label, help);
  }
  const visibleCount=byId('visibleCount');
  document.querySelector('.tool-left').append(visibleCount);
  UISymbol.decorate();
  // Native focus scrolling does not account for the sticky save bar.
  byId('fieldsGrid').addEventListener('focusin', event => {
    const input = event.target.closest('input, textarea');
    if (!input) return;
    requestAnimationFrame(() => {
      const field = input.getBoundingClientRect();
      const bar = document.querySelector('.entry-actions').getBoundingClientRect();
      const ceiling = document.querySelector('.topbar').getBoundingClientRect().bottom + 12;
      const floor = Math.min(innerHeight, bar.top) - 12;
      if (field.bottom > floor) window.scrollBy({top: field.bottom - floor, behavior: 'instant'});
      else if (field.top < ceiling) window.scrollBy({top: field.top - ceiling, behavior: 'instant'});
    });
  });
})();
