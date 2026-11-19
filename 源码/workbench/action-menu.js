/* Shared, measured placement for top-layer menus. No business actions live here. */
(() => {
  'use strict';
  function place(anchor, size, viewport, padding = 12, gap = 6) {
    const width = Math.min(size.width, viewport.width - padding * 2);
    const below = Math.max(0, viewport.height - anchor.bottom - gap - padding);
    const above = Math.max(0, anchor.top - gap - padding);
    const down = size.height <= below || below >= above;
    const height = Math.min(size.height, down ? below : above);
    return {
      left: Math.max(padding, Math.min(anchor.left, viewport.width - width - padding)),
      top: Math.max(padding, down ? anchor.bottom + gap : anchor.top - gap - height),
      width, maxHeight: Math.max(1, down ? below : above), side: down ? 'below' : 'above'
    };
  }
  function attach(button, menu) {
    const items = () => [...menu.querySelectorAll('button')].filter(item => !item.disabled && !item.hidden);
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-controls', menu.id);
    button.setAttribute('aria-expanded', 'false');
    menu.setAttribute('role', 'menu');
    menu.querySelectorAll('button').forEach(item => { item.setAttribute('role', 'menuitem'); item.tabIndex = -1; });
    let initialFocus = 0;
    function position() {
      const anchor = button.getBoundingClientRect();
      menu.style.inset = 'auto';
      menu.style.maxHeight = 'calc(100vh - 24px)';
      const size = menu.getBoundingClientRect();
      const box = place(anchor, size, {width: innerWidth, height: innerHeight});
      Object.assign(menu.style, {left: box.left + 'px', top: box.top + 'px', width: box.width + 'px', maxHeight: box.maxHeight + 'px'});
      menu.dataset.side = box.side;
    }
    function hide(restoreFocus = false) {
      if (menu.matches(':popover-open')) menu.hidePopover();
      if (restoreFocus && button.isConnected && !button.closest('[hidden]')) button.focus();
    }
    menu.addEventListener('beforetoggle', event => {
      if (event.newState !== 'open') return;
      if (!button.checkVisibility()) { event.preventDefault(); return; }
      menu.style.visibility = 'hidden'; menu.style.inset = 'auto';
    });
    menu.addEventListener('toggle', event => {
      const open = event.newState === 'open';
      button.setAttribute('aria-expanded', String(open));
      if (!open) return;
      position();
      menu.style.visibility = 'visible';
      const enabled = items();
      enabled[initialFocus < 0 ? enabled.length - 1 : 0]?.focus();
      initialFocus = 0;
    });
    button.addEventListener('keydown', event => {
      if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
      event.preventDefault();
      initialFocus = event.key === 'ArrowUp' ? -1 : 0;
      if (!menu.matches(':popover-open')) menu.showPopover();
      else items()[initialFocus < 0 ? items().length - 1 : 0]?.focus();
    });
    menu.addEventListener('keydown', event => {
      const enabled = items(), index = enabled.indexOf(document.activeElement);
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : enabled.length - 1)) % enabled.length;
        enabled[next]?.focus();
      } else if (event.key === 'Escape') { event.preventDefault(); hide(true); }
      else if (event.key === 'Tab') hide(true);
    });
    menu.addEventListener('click', event => {
      if (event.target.closest('button:disabled') || !event.target.closest('button')) return;
      // An action may have opened a dialog or moved focus into a field; keep that focus.
      hide(menu.contains(document.activeElement));
    });
    window.addEventListener('resize', () => hide());
    window.addEventListener('scroll', event => { if (!menu.contains(event.target)) hide(); }, true);
  }
  const api = Object.freeze({place, attach});
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.ActionMenu = api;
})();
