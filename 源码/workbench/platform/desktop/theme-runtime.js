'use strict';
(() => {
  const root = document.documentElement,
    model = window.WorkbenchTheme;
  const surface = root.dataset.themeSurface || 'shell';
  const forced = typeof matchMedia === 'function' ? matchMedia('(forced-colors: active)') : null;
  function paint() {
    const theme =
      surface === 'legacy'
        ? root.dataset.theme
        : surface === 'bi'
          ? root.dataset.fusionTheme
          : root.dataset.theme;
    model.applyDocument(root, theme, surface, { forcedColors: !!forced?.matches });
  }
  paint();
  new MutationObserver(paint).observe(root, {
    attributes: true,
    attributeFilter: [surface === 'bi' ? 'data-fusion-theme' : 'data-theme'],
  });
  forced?.addEventListener?.('change', paint);
})();
