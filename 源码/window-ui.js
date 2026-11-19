/* Only the narrow, validated window API is available to this presentation layer. */
(() => {
  'use strict';
  if (!window.desktop) return;
  const update = state => {
    for (const button of document.querySelectorAll('[data-window-action=maximize]')) {
      const label = state.maximized ? '还原窗口' : '最大化';
      button.setAttribute('aria-label', label);
      button.title = label;
      button.dataset.maximized = String(state.maximized);
    }
  };
  for (const button of document.querySelectorAll('[data-window-action]')) {
    button.addEventListener('click', async () => {
      const response = await window.desktop.windowControl(button.dataset.windowAction);
      if (response.ok && response.value) update(response.value);
    });
  }
  window.desktop.onWindowChanged(update);
  window.desktop.windowState().then(response => { if (response.ok) update(response.value); });
})();
