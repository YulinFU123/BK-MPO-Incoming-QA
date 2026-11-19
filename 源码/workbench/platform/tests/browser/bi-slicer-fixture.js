'use strict';
(() => {
  const combo = document.querySelector('[role=combobox]'),
    outlet = document.getElementById('outlet');
  let mode = 'normal',
    selected = new Set(['Patch']),
    index = 0,
    round = 0;
  const options = ['全选', 'Patch', 'Trunk', 'MMC_MPO', 'MMC-MPO', '0012', '12'];
  const check = (e, value) => e.setAttribute('aria-checked', String(value));
  function render() {
    const popup = document.getElementById(combo.getAttribute('aria-controls'));
    if (!popup) return;
    const content = popup.querySelector('.scroll-content');
    let pane = content.querySelector('.fixture-pane');
    if (!pane) {
      pane = document.createElement('div');
      pane.className = 'fixture-pane';
      pane.style.minHeight = '600px';
      content.append(pane);
    }
    pane.replaceChildren();
    const start = mode === 'partial' ? 2 : index;
    for (let i = start; i < Math.min(options.length, start + 3); i++) {
      const item = document.createElement('div');
      item.className = 'slicerItemContainer';
      item.setAttribute('role', 'option');
      const value = mode === 'conflict' && round >= 2 && i === 2 ? 'conflicting-value' : options[i];
      item.title = value;
      item.textContent = value;
      item.setAttribute('aria-posinset', i + 1);
      item.setAttribute('aria-setsize', options.length);
      item.tabIndex = 0;
      check(item, value === '全选' ? selected.size === 6 : selected.has(value));
      item.onclick = () => {
        if (value === '全选')
          selected = selected.size === 6 ? new Set() : new Set(options.slice(1));
        else if (selected.has(value)) selected.delete(value);
        else selected.add(value);
        render();
      };
      pane.append(item);
    }
  }
  function close() {
    outlet.replaceChildren();
    combo.setAttribute('aria-expanded', 'false');
  }
  function open() {
    if (combo.getAttribute('aria-expanded') === 'true') {
      close();
      return;
    }
    const popup = document.createElement('div');
    popup.id = 'dynamic-' + Math.random().toString(36).slice(2);
    popup.className = 'slicerBody';
    popup.setAttribute('role', 'listbox');
    const content = document.createElement('div');
    content.className = 'scroll-content';
    content.tabIndex = 0;
    Object.defineProperty(content, 'scrollHeight', { get: () => 600 });
    content.onkeydown = (e) => {
      if (e.key === 'Home') {
        index = 0;
        render();
      }
    };
    content.onscroll = () => {
      index = Math.min(4, Math.floor(content.scrollTop / 80));
      round++;
      render();
    };
    popup.append(content);
    outlet.append(popup);
    combo.setAttribute('aria-controls', popup.id);
    combo.setAttribute('aria-expanded', 'true');
    render();
  }
  combo.onclick = open;
  combo.onkeydown = (e) => {
    if (e.key === 'Enter') open();
  };
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
  for (const name of ['白班', '晚班']) {
    const item = document.createElement('div');
    item.className = 'slicerItemContainer';
    item.role = 'checkbox';
    item.title = name;
    item.textContent = name;
    check(item, name === '白班');
    item.onclick = () => check(item, item.getAttribute('aria-checked') !== 'true');
    document.getElementById('shift').append(item);
  }
  const tree = document.getElementById('tree');
  function tr(value, level, pos, total) {
    const x = document.createElement('div');
    x.className = 'slicerItemContainer';
    x.setAttribute('role', 'treeitem');
    x.title = value;
    x.textContent = value;
    x.tabIndex = 0;
    if (level) x.setAttribute('aria-level', level);
    x.setAttribute('aria-posinset', pos);
    x.setAttribute('aria-setsize', total);
    x.setAttribute('aria-selected', 'true');
    x.onclick = () =>
      x.setAttribute('aria-selected', String(x.getAttribute('aria-selected') !== 'true'));
    tree.append(x);
  }
  tr('全选', 0, 1, 5);
  tr('(空白)', 1, 2, 5);
  tr('(空白)', 2, 1, 1);
  tr('BK', 1, 3, 5);
  ['BK_1F', 'BK_3F', 'BK_4F', 'BK_5F', 'BK_6F', 'BK_7F', 'BK_8F', 'BK_9F'].forEach((x, i) =>
    tr(x, 2, i + 1, 8),
  );
  tr('GL', 1, 4, 5);
  tr('GL', 2, 1, 2);
  tr('GL_5F', 2, 2, 2);
  tr('HW', 1, 5, 5);
  ['HW', 'HW_1F', 'HW_3F', 'HW_4F', 'HW_5F', 'HW_6F', 'HW_7F', 'HW_8F'].forEach((x, i) =>
    tr(x, 2, i + 1, 8),
  );
  window.slicerFixture = {
    setMode(value) {
      mode = value;
      index = 0;
      round = 0;
      close();
    },
    selected: () => [...selected],
  };
})();

(() => {
  const outlet = document.getElementById('export-outlet');
  window.syntheticExport = { clicks: 0, marker: null };
  document.getElementById('test-more').onclick = () => {
    outlet.innerHTML =
      '<div role="menu"><button id="test-export-menu" role="menuitem">导出数据</button></div>';
    document.getElementById('test-export-menu').onclick = () => {
      outlet.innerHTML =
        '<div role="dialog"><h3>想要导出哪些数据</h3><label><input type="radio">汇总数据</label><button data-testid="pbi-dropdown" disabled>.xlsx</button><button data-testid="export-btn">导出</button></div>';
      outlet.querySelector('[data-testid=export-btn]').onclick = () => {
        window.syntheticExport.clicks++;
        outlet.replaceChildren();
      };
    };
  };
  // Prevent this TEST document from making OS downloads; capture the generated
  // local JSON marker exactly as produced by the real runner for assertions.
  HTMLAnchorElement.prototype.click = function () {
    if (this.download.startsWith('NCDetails_job_'))
      fetch(this.href)
        .then((x) => x.json())
        .then((x) => (window.syntheticExport.marker = x));
  };
  window.runSyntheticGeneratedScript = (code) => {
    window.syntheticExport.marker = null;
    new Function(code)();
  };
})();
