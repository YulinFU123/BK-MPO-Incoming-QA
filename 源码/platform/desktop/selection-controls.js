'use strict';
(() => {
  if (window.SelectionControls) return;
  let sequence = 0;
  let closeActive = () => {};
  let activeInput = null;
  const bound = new WeakSet();

  function node(tag, className, text) {
    const item = document.createElement(tag);
    item.className = className;
    if (text !== undefined) item.textContent = text;
    return item;
  }

  function topLayer(menu) {
    if (typeof menu.showPopover !== 'function') return;
    menu.setAttribute('popover', 'manual');
    try {
      if (!menu.matches(':popover-open')) menu.showPopover();
    } catch {
      // A disconnected or closing modal keeps its original fixed-layer fallback.
    }
  }

  function attachDatalist(input) {
    if (bound.has(input) || input.disabled || input.readOnly) return;
    const listId = input.getAttribute('list');
    if (!listId || !document.getElementById(listId)?.matches('datalist')) return;
    bound.add(input);
    input.removeAttribute('list');
    input.dataset.choiceInput = '';
    input.autocomplete = 'off';
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-haspopup', 'listbox');
    input.setAttribute('aria-expanded', 'false');
    if (!input.getAttribute('aria-label') && !input.labels?.length)
      input.setAttribute('aria-label', input.placeholder || '输入或选择');
    const id = `choice-${++sequence}`;
    let menu = null;
    let options = [];
    let cursor = -1;

    function hide() {
      menu?.remove();
      menu = null;
      cursor = -1;
      if (activeInput === input) activeInput = null;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      input.removeAttribute('aria-controls');
      window.removeEventListener('resize', hide);
      document.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('pointerdown', outside, true);
    }
    function outside(event) {
      if (event.target !== input && !menu?.contains(event.target)) hide();
    }
    function onScroll(event) {
      if (!menu?.contains(event.target)) hide();
    }
    function choose(value) {
      input.value = value;
      hide();
      input.focus();
      input.dispatchEvent(new Event('input', { bubbles: true }));
      hide();
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    function highlight() {
      menu?.querySelectorAll('[role="option"]').forEach((option, index) => {
        option.classList.toggle('selected', index === cursor);
        if (index === cursor) {
          input.setAttribute('aria-activedescendant', option.id);
          option.scrollIntoView({ block: 'nearest' });
        }
      });
    }
    function show(all = false) {
      closeActive();
      window.SuggestionBox?.close();
      closeActive = hide;
      if (!input.isConnected || input.disabled || input.readOnly) return;
      activeInput = input;
      const query = all ? '' : input.value.trim().toLocaleLowerCase();
      const values = [
        ...new Set(
          [...(document.getElementById(listId)?.options || [])]
            .filter((option) => !option.disabled)
            .map((option) => option.value)
            .filter(Boolean),
        ),
      ];
      const matches = values.filter((value) => !query || value.toLocaleLowerCase().includes(query));
      options = matches.slice(0, 60);
      cursor = -1;
      menu = node('div', 'choice-menu');
      menu.id = id;
      menu.setAttribute('role', 'listbox');
      menu.setAttribute('aria-label', `${input.getAttribute('aria-label') || '输入'}候选`);
      for (const [index, value] of options.entries()) {
        const option = node('button', 'choice-option');
        option.type = 'button';
        option.tabIndex = -1;
        option.id = `${id}-${index}`;
        option.setAttribute('role', 'option');
        option.setAttribute('aria-selected', String(input.value === value));
        option.append(node('span', 'choice-check'), node('span', 'choice-label', value));
        option.addEventListener('pointerdown', (event) => event.preventDefault());
        option.addEventListener('click', () => choose(value));
        menu.append(option);
      }
      if (!options.length) menu.append(node('div', 'choice-empty', '暂无匹配项，可继续输入。'));
      if (matches.length > options.length)
        menu.append(node('div', 'choice-caption', '显示前60项，请输入关键词缩小范围'));
      (input.closest('dialog[open]') || document.body).append(menu);
      topLayer(menu);
      const rect = input.getBoundingClientRect();
      const gutter = 12,
        gap = 5;
      const below = innerHeight - rect.bottom - gutter - gap;
      const above = rect.top - gutter - gap;
      const openBelow = below >= 180 || below >= above;
      const available = Math.max(1, Math.min(320, openBelow ? below : above));
      const width = Math.max(1, Math.min(rect.width, innerWidth - 2 * gutter));
      menu.style.width = `${width}px`;
      menu.style.maxHeight = `${available}px`;
      menu.style.left = `${Math.max(gutter, Math.min(rect.left, innerWidth - width - gutter))}px`;
      if (openBelow) menu.style.top = `${rect.bottom + gap}px`;
      else menu.style.bottom = `${innerHeight - rect.top + gap}px`;
      input.setAttribute('aria-expanded', 'true');
      input.setAttribute('aria-controls', id);
      window.addEventListener('resize', hide);
      document.addEventListener('scroll', onScroll, true);
      document.addEventListener('pointerdown', outside, true);
    }
    input.addEventListener('click', () => show(true));
    input.addEventListener('input', (event) => {
      if (!event.isComposing) show();
    });
    input.addEventListener('compositionend', () => show());
    input.addEventListener('blur', () => hide());
    input.addEventListener(
      'keydown',
      (event) => {
        if (event.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          event.stopImmediatePropagation();
          if (!menu) show(true);
          cursor = options.length
            ? cursor < 0
              ? event.key === 'ArrowDown'
                ? 0
                : options.length - 1
              : (cursor + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
            : -1;
          highlight();
        } else if (event.key === 'Enter' && menu && cursor >= 0) {
          event.preventDefault();
          event.stopImmediatePropagation();
          choose(options[cursor]);
        } else if (event.key === 'Escape' && menu) {
          event.preventDefault();
          event.stopImmediatePropagation();
          hide();
        } else if (event.key === 'Tab' || event.key === 'Enter') hide();
      },
      true,
    );
  }

  function scan() {
    if (activeInput && !activeInput.isConnected) closeActive();
    for (const input of document.querySelectorAll('input[list]')) attachDatalist(input);
    for (const menu of document.querySelectorAll('.combo-menu')) topLayer(menu);
  }
  function start() {
    scan();
    new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  }
  window.SelectionControls = Object.freeze({ scan, close: () => closeActive() });
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
