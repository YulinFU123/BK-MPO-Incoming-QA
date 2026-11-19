'use strict';
// The unified workspace uses text controls. Keep a no-op factory only for
// renderer compatibility; chart SVG remains functional data, not decoration.
window.WorkbenchIcons = Object.freeze({
  create() {
    const placeholder = document.createElement('span');
    placeholder.className = 'decorative-icon';
    placeholder.hidden = true;
    placeholder.setAttribute('aria-hidden', 'true');
    return placeholder;
  },
});
