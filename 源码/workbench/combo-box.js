/* Editable suggestions. Business data is supplied by the caller. */
window.SuggestionBox = (() => {
  'use strict';
  let closeActive = () => {};

  function node(tag, className, text) {
    const item = document.createElement(tag);
    item.className = className;
    if (text) item.textContent = text;
    return item;
  }

  function attach(input, column, wrap, getRecords) {
    input.removeAttribute('list');
    input.autocomplete = 'off';
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    wrap.classList.add('has-suggestions');
    const toggle = node('button', 'combo-toggle');
    toggle.append(UISymbol.create('down'));
    toggle.type = 'button';
    toggle.setAttribute('aria-label', '展开' + column.label + '的全部选项');
    wrap.append(toggle);
    let menu = null;
    let options = [];
    let cursor = -1;

    function candidates() {
      const presets = String(column.options || '').split(/[,，\n]/).map(v => v.trim()).filter(Boolean);
      const counts = new Map();
      getRecords().forEach(record => {
        const value = String(record.values[column.id] ?? '').trim();
        if (value) counts.set(value, (counts.get(value) || 0) + 1);
      });
      const values = column.validation?.optionsOnly ? presets : [...presets, ...[...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a))];
      return [...new Set(values)].map(value => ({value, count: counts.get(value) || 0, preset: presets.includes(value)}));
    }

    function hide() {
      menu?.remove();
      menu = null;
      cursor = -1;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      input.removeAttribute('aria-controls');
      toggle.setAttribute('aria-expanded', 'false');
      window.removeEventListener('resize', hide);
      document.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('pointerdown', onOutside, true);
    }

    function onOutside(event) {
      if (!wrap.contains(event.target) && !menu?.contains(event.target)) hide();
    }
    function onScroll(event) {
      if (!menu?.contains(event.target)) hide();
    }
    function choose(value) {
      input.value = value;
      hide();
      input.focus();
      input.dispatchEvent(new Event('input', {bubbles: true}));
      hide(); // input filtering must not reopen after selecting an item
      input.dispatchEvent(new Event('change', {bubbles: true}));
    }
    function highlight() {
      menu?.querySelectorAll('[role=option]').forEach((option, index) => {
        option.classList.toggle('selected', index === cursor);
        if (index === cursor) {
          input.setAttribute('aria-activedescendant', option.id);
          option.scrollIntoView({block: 'nearest'});
        }
      });
    }
    function show(all) {
      closeActive();
      closeActive = hide;
      menu = node('div', 'combo-menu');
      menu.id = 'combo_' + column.id;
      menu.setAttribute('role', 'listbox');
      menu.setAttribute('aria-label', column.label + '候选');
      const query = all ? '' : input.value.trim().toLocaleLowerCase();
      const matches = candidates().filter(item => !query || item.value.toLocaleLowerCase().includes(query));
      options = matches.slice(0, 60);
      cursor = -1;
      menu.append(node('div', 'combo-caption', column.validation?.optionsOnly ? '请选择预设项' : '选择候选，或直接输入'));
      options.forEach((item, index) => {
        const option = node('button', 'combo-option');
        const checked = input.value.trim() === item.value;
        option.type = 'button';
        option.id = menu.id + '_' + index;
        option.setAttribute('role', 'option');
        option.setAttribute('aria-selected', String(checked));
        option.append(node('span', 'option-check', checked ? '✓' : ''), node('span', 'option-label', item.value), node('small', 'option-meta', item.preset ? '预设' : '最近使用'));
        option.addEventListener('pointerdown', event => event.preventDefault());
        option.addEventListener('click', () => choose(item.value));
        menu.append(option);
      });
      if (!options.length) menu.append(node('div', 'combo-empty', column.validation?.optionsOnly ? '没有匹配的预设项，请清除输入后重新选择。' : '暂无匹配项，可继续输入新内容。'));
      if (matches.length > 60) menu.append(node('div', 'combo-caption', '显示前 60 项，请输入关键词缩小范围'));
      document.body.append(menu);
      const rect = input.getBoundingClientRect();
      const width = Math.min(Math.max(260, rect.width), innerWidth - 24);
      const below = innerHeight - rect.bottom - 16;
      menu.style.width = width + 'px';
      menu.style.left = Math.max(12, Math.min(rect.left, innerWidth - width - 12)) + 'px';
      menu.style.maxHeight = Math.min(300, Math.max(80, below >= 170 ? below : rect.top - 16)) + 'px';
      if (below >= 170) menu.style.top = rect.bottom + 6 + 'px';
      else menu.style.bottom = innerHeight - rect.top + 6 + 'px';
      input.setAttribute('aria-controls', menu.id);
      input.setAttribute('aria-expanded', 'true');
      toggle.setAttribute('aria-expanded', 'true');
      window.addEventListener('resize', hide);
      document.addEventListener('scroll', onScroll, true);
      document.addEventListener('pointerdown', onOutside, true);
    }
    toggle.addEventListener('click', () => { if (menu) hide(); else { input.focus(); show(true); } });
    input.addEventListener('input', event => { if (!event.isComposing) show(false); });
    input.addEventListener('compositionend', () => show(false));
    input.addEventListener('keydown', event => {
      if (event.isComposing || event.ctrlKey) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        if (!menu) show(true);
        cursor = options.length ? (cursor < 0 ? (event.key === 'ArrowDown' ? 0 : options.length - 1) : (cursor + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length) : -1;
        highlight();
      } else if (event.key === 'Enter' && menu) {
        event.preventDefault();
        event.stopPropagation();
        if (cursor >= 0) choose(options[cursor].value); else hide();
      } else if (event.key === 'Escape' && menu) {
        event.preventDefault();
        event.stopPropagation();
        hide();
      } else if (event.key === 'Tab') hide();
    });
  }
  return Object.freeze({attach, close: () => closeActive()});
})();
