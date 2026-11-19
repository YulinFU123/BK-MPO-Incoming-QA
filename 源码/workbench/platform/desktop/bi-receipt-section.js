'use strict';
// The desktop inbox augments this section after the daily page has rendered.
function biPanel() {
  const box = h('details', { class: 'card' });
  box.append(h('summary', {}, '下载文件接收'));
  return box;
}

const originalDailyPage = PAGES.daily;
PAGES.daily = (element) => {
  originalDailyPage(element);
  if (D.ready) element.prepend(biPanel());
};
