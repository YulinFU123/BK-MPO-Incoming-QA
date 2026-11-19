'use strict';
(() => {
  const themeNames = {
    professional: ['雾银', '中性导航 · 清晰内容'],
    glass: ['浅色玻璃', '轻盈浮层 · 实色内容'],
    graphite: ['石墨', '深色层次 · 柔和文字'],
    contrast: ['高对比', '明确轮廓 · 强化辨认'],
  };
  function labelControls() {
    for (const card of document.querySelectorAll('#themeChoices [data-preview-theme]')) {
      const labels = themeNames[card.dataset.previewTheme];
      if (!labels) continue;
      for (const [selector, text] of [
        ['strong', labels[0]],
        ['small', labels[1]],
      ]) {
        const target = card.querySelector(selector);
        if (target && target.textContent !== text) target.textContent = text;
      }
    }
    for (const button of document.querySelectorAll('button')) {
      if (button.classList.contains('combo-toggle')) continue;
      if (button.textContent.trim() || button.querySelector('.icon-word')) continue;
      let text = button.getAttribute('aria-label') || button.title;
      if (!text) continue;
      if (text.startsWith('展开') && text.includes('选项')) text = '选项';
      const label = document.createElement('span');
      label.className = 'icon-word';
      label.textContent = text;
      button.append(label);
    }
    const note = document.querySelector('.footer-note');
    const text =
      '异常记录、跟进与数量核对保存在同一加密文件；BI使用独立原格式目录。Excel/CSV导出不含密码保护。';
    if (note && note.textContent !== text) note.textContent = text;
  }
  labelControls();
  new MutationObserver(labelControls).observe(document.body, { childList: true, subtree: true });
  const root = document.documentElement;
  let lastTheme = root.dataset.theme;
  function reportTheme(preview) {
    const theme = root.dataset.theme;
    if (!['professional', 'glass', 'graphite', 'contrast'].includes(theme)) return;
    window.desktop.appearanceChanged({ theme, preview });
    lastTheme = theme;
  }
  new MutationObserver(() => {
    if (root.dataset.theme !== lastTheme)
      reportTheme(!!document.getElementById('appearanceDialog')?.open);
  }).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  document.getElementById('appearanceDialog')?.addEventListener('close', () => reportTheme(false));
})();
