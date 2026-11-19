/* BI NC Exporter - 报表页面上的面板 + 切片器自动操作 + 导出（每日 / 月度两种模式） */
(() => {
  if (window !== window.top || window.__ncxLoaded) return;
  window.__ncxLoaded = true;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) =>
    String(s || '')
      .replace(/\s+/g, ' ')
      .trim();
  let S = null;
  let MODE = 'daily';
  const MODE_NAME = { daily: '每日', monthly: '月度' };
  const MORE_TRIES = 3; // "…" 按钮最多尝试次数
  const st = {
    running: false,
    stop: false,
    manual: null,
    dlResult: null,
    dlStarted: false,
    dlDone: false,
    connPreview: null,
  };

  /* ====================== DOM 工具 ====================== */
  function visible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
  }
  function center(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + Math.min(r.height / 2, 12) };
  }
  function fire(el, type, extra) {
    const c = center(el);
    const init = Object.assign(
      {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        clientX: c.x,
        clientY: c.y,
        button: 0,
      },
      extra || {},
    );
    const Ctor = type.startsWith('pointer') ? PointerEvent : MouseEvent;
    el.dispatchEvent(new Ctor(type, init));
  }
  function hover(el) {
    if (!el) return;
    ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'pointermove', 'mousemove'].forEach(
      (t) => {
        try {
          fire(el, t);
        } catch (e) {}
      },
    );
  }
  function realClick(el, extra) {
    if (!el) throw new Error('要点击的元素不存在');
    try {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    } catch (e) {}
    hover(el);
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((t) =>
      fire(el, t, extra),
    );
  }
  function key(el, k) {
    const init = {
      key: k,
      code: k,
      keyCode: k === 'Enter' ? 13 : 27,
      which: k === 'Enter' ? 13 : 27,
      bubbles: true,
      cancelable: true,
      composed: true,
    };
    ['keydown', 'keypress', 'keyup'].forEach((t) => el.dispatchEvent(new KeyboardEvent(t, init)));
  }
  async function waitFor(fn, timeout = 10000, every = 250) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (st.stop) throw new Error('已停止');
      let v = null;
      try {
        v = fn();
      } catch (e) {}
      if (v) return v;
      await sleep(every);
    }
    return null;
  }
  const delay = () => sleep(S ? +S.stepDelay || 1500 : 1500);

  /* ====================== 视觉对象 ====================== */
  function visualRoots() {
    const set = new Set();
    document
      .querySelectorAll(
        'visual-modern, .visualContainer, visual-container, visual-container-modern, [data-testid="visual-container"]',
      )
      .forEach((el) => {
        const cands = [
          el.closest('transform'),
          el.closest('visual-container-modern'),
          el.closest('.visualContainer'),
          el.closest('visual-container'),
          el,
        ];
        const root = cands.find((c) => c && visible(c));
        if (root && !root.closest('#ncx-host')) set.add(root);
      });
    const arr = [...set];
    return arr.filter(
      (r) =>
        !arr.some((o) => o !== r && r.contains(o) && o.querySelector('visual-modern, .visual')),
    );
  }
  function titleOf(root) {
    const parts = [];
    root
      .querySelectorAll(
        'h3.slicer-header-text, .slicer-header-text, .slicer-header, .visualTitle, [class*="visualTitle"], h3, h4',
      )
      .forEach((e) => {
        parts.push(e.getAttribute('title') || '', e.textContent || '');
      });
    const al =
      root.getAttribute('aria-label') ||
      (root.querySelector('[aria-label]') || { getAttribute: () => '' }).getAttribute(
        'aria-label',
      ) ||
      '';
    parts.push(al);
    return norm(parts.join(' | '));
  }
  const isGrid = (r) =>
    !!r.querySelector('[role="grid"], [role="treegrid"], .tableEx, .pivotTable, .tableExContainer');
  const isSlicer = (root) =>
    !!root.querySelector('.visual-slicer, .slicer-container, .slicerContainer, .date-slicer');
  function findSlicer(name) {
    const n = name.toLowerCase();
    const cands = visualRoots().filter(
      (r) => isSlicer(r) && !isGrid(r) && titleOf(r).toLowerCase().includes(n),
    );
    const area = (r) => {
      const b = r.getBoundingClientRect();
      return b.width * b.height;
    };
    cands.sort((a, b) => area(a) - area(b));
    return cands[0] || null;
  }
  function tableText(r) {
    const parts = [r.textContent || ''];
    r.querySelectorAll('[aria-label], [title]').forEach((e) =>
      parts.push(e.getAttribute('aria-label') || '', e.getAttribute('title') || ''),
    );
    return parts.join('|').toLowerCase();
  }
  function findTable() {
    const k = (S.tableKey || 'Serial Number').toLowerCase();
    const area = (r) => {
      const b = r.getBoundingClientRect();
      return b.width * b.height;
    };
    const grids = visualRoots().filter(isGrid);
    const hit = grids.filter((r) => tableText(r).includes(k)).sort((a, b) => area(b) - area(a));
    if (hit.length) return hit[0];
    grids.sort((a, b) => area(b) - area(a));
    return grids[0] || null;
  }

  /* 模拟鼠标真正移到某个点上 */
  function hoverPoint(x, y) {
    const t = document.elementFromPoint(x, y);
    if (!t || t.closest('#ncx-host')) return false;
    const base = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX: x,
      clientY: y,
      button: 0,
      buttons: 0,
    };
    const chain = [];
    for (let e = t; e && e !== document.documentElement; e = e.parentElement) chain.push(e);
    try {
      t.dispatchEvent(new PointerEvent('pointerover', base));
      t.dispatchEvent(new MouseEvent('mouseover', base));
      chain
        .slice()
        .reverse()
        .forEach((e) => {
          e.dispatchEvent(
            new PointerEvent('pointerenter', Object.assign({}, base, { bubbles: false })),
          );
          e.dispatchEvent(
            new MouseEvent('mouseenter', Object.assign({}, base, { bubbles: false })),
          );
        });
      for (let i = 0; i < 3; i++) {
        const m = Object.assign({}, base, { clientX: x + i, clientY: y + i });
        t.dispatchEvent(new PointerEvent('pointermove', m));
        t.dispatchEvent(new MouseEvent('mousemove', m));
      }
    } catch (e) {}
    return true;
  }
  /* 在视觉对象内部取几个点悬停；attempt 不同，取点位置也不同 */
  function hoverInside(root, attempt) {
    try {
      root.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    } catch (e) {}
    const body =
      root.querySelector('[role="grid"], [role="treegrid"], .slicer-container, .visual') || root;
    const r = body.getBoundingClientRect();
    const sets = [
      [
        [0.5, 0.4],
        [0.6, 0.3],
        [0.85, 0.15],
      ],
      [
        [0.3, 0.6],
        [0.5, 0.8],
        [0.15, 0.2],
      ],
      [
        [0.7, 0.5],
        [0.4, 0.25],
        [0.9, 0.3],
        [0.5, 0.5],
      ],
    ];
    const pts = attempt == null ? [].concat(...sets) : sets[attempt % sets.length];
    let n = 0;
    for (const [fx, fy] of pts) {
      const x = r.left + r.width * fx,
        y = r.top + r.height * fy;
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
      if (hoverPoint(x, y)) n++;
    }
    return n;
  }
  function focusVisual(root) {
    const f = [root, ...root.querySelectorAll('.visualContainer, [tabindex]')].find(
      (e) => e.getAttribute && e.getAttribute('tabindex') != null,
    );
    try {
      (f || root).focus({ preventScroll: true });
      (f || root).dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    } catch (e) {}
  }
  const btnLabel = (b) =>
    (b.getAttribute('aria-label') || '') +
    ' ' +
    (b.getAttribute('title') || '') +
    ' ' +
    (b.getAttribute('data-testid') || '');
  function pickHeaderButton(root, re, insideOnly) {
    const rr = root.getBoundingClientRect();
    const btns = [
      ...document.querySelectorAll('button, [role="button"], [role="menuitem"]'),
    ].filter((b) => {
      if (!re.test(btnLabel(b)) || !visible(b) || b.closest('#ncx-host')) return false;
      const r = b.getBoundingClientRect();
      return (
        r.left >= rr.left - 40 &&
        r.right <= rr.right + 40 &&
        r.top >= rr.top - 50 &&
        r.bottom <= rr.bottom + 10
      );
    });
    btns.sort(
      (a, b) =>
        Math.abs(a.getBoundingClientRect().top - rr.top) -
        Math.abs(b.getBoundingClientRect().top - rr.top),
    );
    return btns.find((b) => root.contains(b)) || (insideOnly ? null : btns[0]);
  }
  /* 切片器标题栏上的按钮（清除选择） */
  async function headerButton(root, re, insideOnly) {
    for (let i = 0; i < 2; i++) {
      hoverInside(root, i);
      const b = await waitFor(() => pickHeaderButton(root, re, insideOnly), 1200, 150);
      if (b) return b;
    }
    return null;
  }

  /* ====================== 切片器列表项 ====================== */
  const ITEM_SEL = '.slicerItemContainer, [role="option"], [role="treeitem"]';
  function ownQuery(item, sel) {
    return [...item.querySelectorAll(sel)].find((e) => e.closest(ITEM_SEL) === item) || null;
  }
  function itemText(item) {
    const t = ownQuery(item, '.slicerText, [class*="slicerText"]');
    return norm(
      (t && (t.getAttribute('title') || t.textContent)) ||
        item.getAttribute('title') ||
        item.getAttribute('aria-label') ||
        item.textContent,
    );
  }
  function itemState(item) {
    const cb = ownQuery(item, '.slicerCheckbox, [role="checkbox"], input[type="checkbox"]');
    const a = [
      item.getAttribute('aria-selected'),
      item.getAttribute('aria-checked'),
      cb && cb.getAttribute('aria-checked'),
    ];
    if (a.includes('mixed') || (cb && /partial/i.test(cb.className))) return 'partial';
    if (a.includes('true') || (cb && (cb.classList.contains('selected') || cb.checked)))
      return 'on';
    return 'off';
  }
  function clickTarget(item) {
    return (
      ownQuery(item, '.slicerCheckbox, [role="checkbox"], input[type="checkbox"]') ||
      ownQuery(item, '.slicerText') ||
      item
    );
  }
  const isSelectAll = (t) => /^\(?\s*(全选|select all)\s*\)?$/i.test(t);
  const rawItems = (box) => [...box.querySelectorAll(ITEM_SEL)].filter(visible);
  function scroller(box) {
    let best = null;
    [box, ...box.querySelectorAll('*')].forEach((e) => {
      if (e.scrollHeight > e.clientHeight + 4) {
        const oy = getComputedStyle(e).overflowY;
        if ((oy === 'auto' || oy === 'scroll') && (!best || e.clientHeight > best.clientHeight))
          best = e;
      }
    });
    return best;
  }
  function levelOf(item, lefts) {
    const lvEl = item.getAttribute('aria-level') ? item : item.closest('[aria-level]');
    if (lvEl) return Math.max(0, +lvEl.getAttribute('aria-level') - 1);
    const t = ownQuery(item, '.slicerText') || item;
    const x = Math.round(t.getBoundingClientRect().left / 6) * 6;
    if (!lefts.includes(x)) {
      lefts.push(x);
      lefts.sort((a, b) => a - b);
    }
    return lefts.indexOf(x);
  }
  async function scan(box, visit) {
    const sc = scroller(box);
    if (sc) {
      sc.scrollTop = 0;
      await sleep(300);
    }
    const lefts = [],
      stack = [],
      seen = new Set();
    for (let round = 0; round < 200; round++) {
      for (const it of rawItems(box)) {
        const text = itemText(it);
        const lv = levelOf(it, lefts);
        stack[lv] = text;
        stack.length = lv + 1;
        const path = stack.join('>');
        if (seen.has(path)) continue;
        seen.add(path);
        if (await visit(it, text, lv, [...stack])) return true;
      }
      if (!sc || sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 2) break;
      sc.scrollTop += Math.max(40, sc.clientHeight * 0.7);
      await sleep(300);
    }
    return false;
  }
  async function findRow(box, path) {
    let found = null;
    await scan(box, (it, text, lv, p) => {
      if (
        p.length === path.length &&
        p.every((x, i) => x.toUpperCase() === path[i].toUpperCase())
      ) {
        found = it;
        return true;
      }
      return false;
    });
    return found;
  }
  async function openSlicer(root) {
    if (rawItems(root).length) return { box: root, close: async () => {} };
    const head = root.querySelector(
      '.slicer-dropdown-menu, [role="combobox"], .slicer-restatement, [class*="dropdown"]',
    );
    if (!head) throw new Error('找不到切片器的下拉框');
    realClick(head);
    const hr = head.getBoundingClientRect();
    const box = await waitFor(() => {
      const ps = [
        ...document.querySelectorAll(
          '.slicer-dropdown-popup, .slicer-dropdown-content, [role="listbox"], [role="tree"]',
        ),
      ].filter(
        (p) => visible(p) && rawItems(p).length && !root.contains(p) && !p.closest('#ncx-host'),
      );
      ps.sort(
        (a, b) =>
          Math.abs(a.getBoundingClientRect().left - hr.left) +
          Math.abs(a.getBoundingClientRect().top - hr.bottom) -
          Math.abs(b.getBoundingClientRect().left - hr.left) -
          Math.abs(b.getBoundingClientRect().top - hr.bottom),
      );
      return ps[0];
    }, 8000);
    if (!box) throw new Error('下拉框没有展开');
    await sleep(400);
    return {
      box,
      close: async () => {
        key(document.activeElement || document.body, 'Escape');
        await sleep(300);
        if (visible(box) && rawItems(box).length) {
          realClick(head);
          await sleep(300);
        }
      },
    };
  }
  async function clearSlicer(root, box) {
    if (!box) {
      const er = await headerButton(root, /清除选择|clear selection/i, true);
      if (er && !er.disabled && er.getAttribute('aria-disabled') !== 'true') {
        realClick(er);
        await delay();
      }
      return;
    }
    for (let i = 0; i < 3; i++) {
      const all = rawItems(box).find((it) => isSelectAll(itemText(it)));
      if (!all || itemState(all) === 'off') break;
      realClick(clickTarget(all), { ctrlKey: true });
      await sleep(800);
    }
  }
  async function applyIfNeeded(root) {
    const scope = root || document;
    const btn = [...scope.querySelectorAll('button')].find(
      (b) =>
        visible(b) &&
        !b.disabled &&
        /^(应用|apply)$/i.test(norm(b.textContent || b.getAttribute('aria-label'))),
    );
    if (btn) {
      realClick(btn);
      await delay();
      return true;
    }
    return false;
  }

  /* ====================== 各步骤 ====================== */
  function fmtLike(sample, d) {
    const y = d.getFullYear(),
      m = d.getMonth() + 1,
      day = d.getDate();
    const padIt = /(^|\D)0\d/.test(sample || '');
    const M = padIt ? NCX.pad(m) : m,
      D = padIt ? NCX.pad(day) : day;
    let mm;
    if ((mm = String(sample || '').match(/^\d{4}(\D+)\d{1,2}\D+\d{1,2}/)))
      return y + mm[1] + M + mm[1] + D;
    if ((mm = String(sample || '').match(/^\d{1,2}(\D+)\d{1,2}\D+\d{4}/)))
      return M + mm[1] + D + mm[1] + y;
    return y + '/' + M + '/' + D;
  }
  function parseLoose(s) {
    let m = String(s || '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
    if (m) return NCX.ymd(new Date(+m[1], +m[2] - 1, +m[3]));
    m = String(s || '').match(/(\d{1,2})\D+(\d{1,2})\D+(\d{4})/);
    if (m) return NCX.ymd(new Date(+m[3], +m[1] - 1, +m[2]));
    return '';
  }
  function setInputValue(el, v) {
    el.focus();
    el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, '');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    key(el, 'Enter');
    el.blur();
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  }
  /* Work Date 的两个日期框，按屏幕位置从左到右排序 */
  const dateInputs = (root) =>
    [...root.querySelectorAll('input')]
      .filter((i) => visible(i) && /^(text|date|)$/.test(i.type || ''))
      .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);

  /* 固定顺序：先填左边（开始日期），再填右边（结束日期） */
  async function stepDate(start, end) {
    const root = findSlicer(S.slicerDate);
    if (!root) throw new Error('找不到 "' + S.slicerDate + '" 切片器');
    const ins = dateInputs(root);
    if (ins.length < 2) throw new Error('Work Date 切片器上没找到开始/结束两个日期框');
    const [left, right] = ins;
    const sample = left.value || right.value;
    const fmt = (el, v) => (el.type === 'date' ? v : fmtLike(sample, NCX.parseYmd(v)));
    for (let n = 0; n < 3; n++) {
      setInputValue(left, fmt(left, start));
      await delay();
      setInputValue(right, fmt(right, end));
      await delay();
      await applyIfNeeded(root);
      // 报表可能因为"开始晚于结束"把左边的日期改掉，下一轮再按 左→右 填一次就会对上
      if (parseLoose(left.value) === start && parseLoose(right.value) === end)
        return '已设为 ' + left.value + ' ~ ' + right.value;
    }
    throw new Error(
      '日期框显示 ' +
        left.value +
        ' ~ ' +
        right.value +
        '，和目标 ' +
        start +
        ' ~ ' +
        end +
        ' 不一致',
    );
  }
  async function stepOthers() {
    if (!S.clearOthers) return '已跳过';
    const done = [];
    for (const name of NCX.splitList(S.keepAllSlicers)) {
      const root = findSlicer(name);
      if (!root) continue;
      const er = await headerButton(root, /清除选择|clear selection/i, true);
      if (er && !er.disabled && er.getAttribute('aria-disabled') !== 'true') {
        realClick(er);
        await delay();
        done.push(name);
      }
    }
    return done.length ? '已清除：' + done.join('、') : '无需处理';
  }
  async function stepSite() {
    const paths = NCX.parseSitePaths(S.sitePaths);
    if (!paths.length) throw new Error('设置里没有填 Site');
    const root = findSlicer(S.slicerSite);
    if (!root) throw new Error('找不到 "' + S.slicerSite + '" 切片器');
    await clearSlicer(root, null);
    const { box, close } = await openSlicer(root);
    try {
      await clearSlicer(root, box);
      for (const path of paths) {
        for (let i = 0; i < path.length - 1; i++) {
          const row = await findRow(box, path.slice(0, i + 1));
          if (!row) throw new Error('列表里找不到 ' + path.slice(0, i + 1).join(' > '));
          if (await findRow(box, path.slice(0, i + 2))) continue;
          const ex = ownQuery(row, '.expandButton, [class*="expand"], [aria-expanded]');
          if (!ex) throw new Error(path.slice(0, i + 1).join(' > ') + ' 找不到展开按钮');
          realClick(ex);
          await sleep(800);
        }
        let leaf = await findRow(box, path);
        if (!leaf) throw new Error('列表里找不到 ' + path.join(' > '));
        if (itemState(leaf) !== 'on') {
          realClick(clickTarget(leaf), { ctrlKey: true });
          await delay();
        }
        leaf = await findRow(box, path);
        if (!leaf || itemState(leaf) !== 'on') throw new Error(path.join(' > ') + ' 没有勾选成功');
      }
      await applyIfNeeded(box);
    } finally {
      await close();
    }
    await applyIfNeeded(root);
    await delay();
    return '已选择 ' + paths.map((p) => p.join('>')).join('、');
  }
  async function readConnector(box) {
    const vals = [];
    await scan(box, (it, text) => {
      if (!isSelectAll(text) && text) vals.push({ text, state: itemState(it) });
      return false;
    });
    return vals;
  }
  async function stepConnector() {
    const root = findSlicer(S.slicerConnector);
    if (!root) throw new Error('找不到 "' + S.slicerConnector + '" 切片器');
    await clearSlicer(root, null);
    const { box, close } = await openSlicer(root);
    let keep = [],
      drop = [];
    try {
      await clearSlicer(root, box);
      const vals = await readConnector(box);
      if (!vals.length) throw new Error('Connector Type 列表是空的');
      vals.forEach((v) => (NCX.judgeConnector(v.text, S).keep ? keep : drop).push(v.text));
      if (!keep.length) throw new Error('按规则全部被排除了，请检查排除关键词');
      for (let round = 0; round < 3; round++) {
        let wrong = 0;
        await scan(box, async (it, text) => {
          if (isSelectAll(text) || !text) return false;
          if (keep.includes(text) !== (itemState(it) === 'on')) {
            wrong++;
            realClick(clickTarget(it), { ctrlKey: true });
            await sleep(600);
          }
          return false;
        });
        if (!wrong) break;
        await delay();
      }
      const bad = (await readConnector(box)).filter(
        (v) => keep.includes(v.text) !== (v.state === 'on'),
      );
      if (bad.length) throw new Error('这些项勾选状态不对：' + bad.map((v) => v.text).join('、'));
      st.connPreview = vals.map((v) => ({ text: v.text, keep: keep.includes(v.text) }));
      renderPreview();
      await applyIfNeeded(box);
    } finally {
      await close();
    }
    await applyIfNeeded(root);
    await delay();
    return (
      '保留 ' +
      keep.length +
      ' 项，排除 ' +
      drop.length +
      ' 项（' +
      (drop.join('、') || '无') +
      '）'
    );
  }
  async function stepVerify(start, end) {
    const root = findSlicer(S.slicerDate);
    const ins = root ? dateInputs(root) : [];
    if (
      ins.length >= 2 &&
      (parseLoose(ins[0].value) !== start || parseLoose(ins[1].value) !== end)
    ) {
      throw new Error('Work Date 被改动了：' + ins[0].value + ' ~ ' + ins[1].value);
    }
    const table = findTable();
    if (!table) throw new Error('找不到明细表');
    const rows = table.querySelectorAll('[role="row"]').length;
    if (rows && rows <= 1) throw new Error('明细表没有数据（这段时间可能没有 NC 记录）');
    return '日期正确，明细表' + (rows ? '有数据' : '已找到');
  }

  /* ---------- 导出：鼠标移到表格 → "…" 出现 → 点击 → 出现菜单，最多尝试 3 次 ---------- */
  function findExportMenuItem() {
    const els = [...document.querySelectorAll('[role="menuitem"], button, li, span, div')].filter(
      (e) =>
        visible(e) &&
        !e.closest('#ncx-host') &&
        /^(导出数据|export data)$/i.test(norm(e.textContent)),
    );
    els.sort((a, b) => b.querySelectorAll('*').length - a.querySelectorAll('*').length);
    const e = els[els.length - 1];
    return e ? e.closest('[role="menuitem"], button') || e : null;
  }
  async function closeMenus() {
    key(document.activeElement || document.body, 'Escape');
    await sleep(400);
  }
  /* 收集"…"按钮失败时的现场信息，作为报告 */
  function moreButtonReport(table, attempts) {
    const r = table.getBoundingClientRect();
    const out = ['已尝试 ' + attempts.length + ' 次：' + attempts.join('；')];
    out.push('表格位置 ' + [r.left, r.top, r.width, r.height].map(Math.round).join(','));
    const inBtns = [...table.querySelectorAll('button, [role="button"]')]
      .slice(0, 10)
      .map((x) => (btnLabel(x).trim() || x.className) + (visible(x) ? '' : '(隐)'));
    out.push('表内按钮：' + (inBtns.join(' / ') || '无'));
    const near = [...document.querySelectorAll('button, [role="button"]')]
      .filter((x) => {
        const q = x.getBoundingClientRect();
        return (
          visible(x) &&
          !x.closest('#ncx-host') &&
          q.top >= r.top - 60 &&
          q.top <= r.top + 40 &&
          q.left >= r.left - 20 &&
          q.right <= r.right + 60
        );
      })
      .slice(0, 10)
      .map((x) => btnLabel(x).trim() || x.className);
    out.push('表格上方按钮：' + (near.join(' / ') || '无'));
    const pt = document.elementFromPoint(r.left + r.width / 2, r.top + r.height * 0.4);
    out.push(
      '表格中心元素：' +
        (pt
          ? pt.tagName +
            '.' +
            String(pt.className).slice(0, 40) +
            (pt.closest('#ncx-host') ? '（被插件面板挡住）' : '')
          : '无'),
    );
    return out.join('\n');
  }
  async function openExportMenu(table) {
    const attempts = [];
    for (let i = 0; i < MORE_TRIES; i++) {
      if (st.stop) throw new Error('已停止');
      if (i > 0) {
        setStepNote('export', '"…" 第 ' + (i + 1) + '/' + MORE_TRIES + ' 次尝试…');
        await closeMenus();
        await sleep(800);
      }
      // 1) 鼠标移到表格数据区，等 "…" 出现
      hoverInside(table, i);
      if (i >= 1) focusVisual(table);
      let more = await waitFor(
        () => pickHeaderButton(table, /更多选项|more options|visual-more-options/i),
        2000,
        150,
      );
      if (!more && i === MORE_TRIES - 1) {
        // 最后一次：按钮已在页面里只是隐藏着，也直接点
        more = [...table.querySelectorAll('button, [role="button"]')].find((b) =>
          /更多选项|more options|visual-more-options/i.test(btnLabel(b)),
        );
      }
      if (!more) {
        attempts.push('第' + (i + 1) + '次 "…" 没出现');
        continue;
      }
      // 2) 点击 "…"，等菜单出现
      realClick(more);
      const mi = await waitFor(findExportMenuItem, 3000, 150);
      if (!mi) {
        attempts.push('第' + (i + 1) + '次 点了 "…" 但菜单没出现');
        continue;
      }
      if (i > 0) log('"…" 第 ' + (i + 1) + ' 次尝试成功');
      return mi;
    }
    const report = moreButtonReport(table, attempts);
    log('"…" 按钮失败报告：\n' + report, 'err');
    ui.q('#log').insertAdjacentHTML('beforeend', '<pre class="diag"></pre>');
    ui.q('#log').lastElementChild.textContent = report;
    try {
      await navigator.clipboard.writeText(
        'BI NC Exporter v' + NCX.VERSION + ' "…" 按钮失败报告\n' + report,
      );
    } catch (e) {}
    throw new Error('连续 ' + MORE_TRIES + ' 次没能打开明细表的 "…" 菜单（报告已复制到剪贴板）');
  }
  async function stepExport() {
    const table = findTable();
    if (!table) throw new Error('找不到明细表');
    st.dlResult = null;
    st.dlStarted = false;
    st.dlDone = false;
    const armed = await send({
      type: 'arm',
      mode: MODE,
      platform: {
        start: dates()[0],
        end: dates()[1],
        filterVerified: st.platformVerified === true,
        source: location.href,
        filters: {
          floors: NCX.parseSitePaths(S.sitePaths).map((path) => path.at(-1)),
          connectors: st.connPreview.filter((row) => row.keep).map((row) => row.text),
        },
      },
    });
    if (!armed.ok) throw Error(armed.message || '下载任务未准备好');
    const mi = await openExportMenu(table);
    realClick(mi);
    const dlg = await waitFor(
      () =>
        [
          ...document.querySelectorAll(
            '[role="dialog"], mat-dialog-container, .mat-mdc-dialog-container, .pbi-modal, .modal-dialog',
          ),
        ].find((d) => visible(d) && /汇总数据|summarized data/i.test(d.textContent)),
      10000,
    );
    if (!dlg) throw new Error('没有弹出 "想要导出哪些数据?" 窗口');
    const label = [...dlg.querySelectorAll('*')]
      .filter((e) => /^(汇总数据|summarized data)$/i.test(norm(e.textContent)))
      .sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length)[0];
    if (!label) throw new Error('窗口里找不到 "汇总数据"');
    const card =
      label.closest('[role="radio"], label, button, [class*="card"], [class*="option"]') || label;
    realClick(card);
    await sleep(500);
    const radio = card.querySelector('input[type="radio"]');
    if (radio && !radio.checked) {
      realClick(radio);
      await sleep(400);
    }
    const sel = dlg.querySelector('select');
    if (sel) {
      const op = [...sel.options].find((o) => /xlsx/i.test(o.textContent));
      if (op && !op.selected) {
        sel.value = op.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    } else {
      const dd = [
        ...dlg.querySelectorAll(
          '[role="combobox"], [role="listbox"], mat-select, [class*="dropdown"], [class*="select"]',
        ),
      ].find((e) => visible(e) && /\.(xlsx|csv)/i.test(e.textContent));
      if (dd && !/xlsx/i.test(dd.textContent)) {
        realClick(dd);
        const op = await waitFor(
          () =>
            [...document.querySelectorAll('[role="option"], mat-option, li')].find(
              (o) => visible(o) && /xlsx/i.test(o.textContent),
            ),
          4000,
        );
        if (!op) throw new Error('文件格式里找不到 .xlsx');
        realClick(op);
        await sleep(500);
      }
    }
    if (!/xlsx/i.test(dlg.textContent)) throw new Error('文件格式不是 .xlsx');
    const btn = [...dlg.querySelectorAll('button')].find(
      (b) => visible(b) && /^(导出|export)$/i.test(norm(b.textContent)),
    );
    if (!btn) throw new Error('窗口里找不到 "导出" 按钮');
    if (btn.disabled) throw new Error('"导出" 按钮是灰的，可能没有导出权限');
    realClick(btn);
    return '已点击导出，等待下载';
  }
  async function stepWait() {
    const sec = (+S.downloadTimeout || 180) * (MODE === 'monthly' ? 2 : 1);
    const t0 = Date.now();
    while (!st.dlResult) {
      if (st.stop) throw new Error('已停止');
      if (Date.now() - t0 > sec * 1000)
        throw new Error(
          '等了 ' + sec + ' 秒还没收到下载（如已手动导出，请确认文件名是 data.xlsx）',
        );
      setStepNote(
        'wait',
        st.dlDone
          ? '下载完成，正在转移文件…'
          : st.dlStarted
            ? '正在下载…'
            : '等待 Power BI 生成文件…',
      );
      await sleep(500);
    }
    const r = st.dlResult;
    if (!r.ok) {
      if (r.nativeError)
        throw new Error(
          '连不上本地小程序：' +
            r.message +
            '。文件在：' +
            (r.path || '下载目录') +
            '。请运行 test_connection.bat 检查',
        );
      throw new Error((r.message || '处理失败') + (r.path ? '。原文件：' + r.path : ''));
    }
    if (r.stage === 'watcher') return r.message;
    if (MODE === 'monthly' && !/(^|[\\/])data\.xlsx$/i.test(r.dest || '')) {
      throw new Error(
        '文件没有改名为 data.xlsx（现在是 ' + r.dest + '），请更新本地小程序（host 文件夹）后重试',
      );
    }
    const batName = (NCX.batFor(S, MODE) || '').split(/[\\/]/).pop() || '分析程序';
    let msg =
      (S.transferMode === 'copy' ? '已复制到 ' : '已剪切到 ') +
      r.dest +
      (MODE === 'monthly' ? '（已改名）' : '');
    if (r.backup) msg += '；原来的 data.xlsx 已备份到 ' + r.backup;
    if (r.pendingBefore && r.pendingBefore.length)
      msg += '；注意：文件夹里原来还有未处理的 ' + r.pendingBefore.join('、');
    msg += r.launched ? '；已启动 ' + batName : '；' + (r.launchNote || '没有启动分析程序');
    return msg;
  }

  /* ====================== 流程控制 ====================== */
  const STEPS = [
    { id: 'load', name: '等待报表加载' },
    { id: 'others', name: '其他切片器保持"所有"' },
    { id: 'date', name: '设置 Work Date' },
    { id: 'site', name: '设置 Site / Resource Category' },
    { id: 'conn', name: '设置 Connector Type' },
    { id: 'verify', name: '回读校验' },
    { id: 'export', name: '导出汇总数据 (.xlsx)' },
    { id: 'wait', name: '下载 → 转移 → 启动分析程序' },
  ];
  const pageId = (u) => {
    const m = String(u || '').match(/reports\/([0-9a-f-]{36})\/([^/?#]+)/i);
    return m ? (m[1] + '/' + m[2]).toLowerCase() : '';
  };
  const reportId = (u) => {
    const m = String(u || '').match(/reports\/([0-9a-f-]{36})/i);
    return m ? m[1].toLowerCase() : '';
  };
  function dates() {
    if (MODE === 'monthly') return NCX.monthRange(ui.q('#mm').value) || ['', ''];
    const a = ui.q('#ds').value,
      b = ui.q('#de').value || a;
    return a <= b ? [a, b] : [b, a];
  }
  function checkBat(scope) {
    if (scope === 'filter') return '';
    if (S.workMode === 'B')
      return MODE === 'monthly' && !S.platformBridge
        ? '月度模式需要 A 模式（本地小程序直连），请在设置里把工作模式改为 A'
        : '';
    const bat = NCX.batFor(S, MODE);
    if (!bat) return '请先在设置里填写' + MODE_NAME[MODE] + '分析程序的位置';
    if (NCX.samePath(S.batPath, S.batPathMonthly))
      return '每日和月度的分析程序不能是同一个文件，请在设置里分开设置';
    return '';
  }
  async function run(scope) {
    if (st.running) return;
    S = await NCX.loadSettings();
    const [start, end] = dates();
    if (!start) {
      log(MODE === 'monthly' ? '请先选择月份' : '请先选择 Work Date', 'err');
      return;
    }
    const bad = checkBat(scope);
    if (bad) {
      log(bad, 'err');
      ui.status('✖ ' + bad, 'err');
      return;
    }
    const pageTarget = pageId(S.reportUrl);
    if (pageTarget && pageId(location.href) !== pageTarget) {
      await chrome.storage.local.set({
        pendingRun: { at: Date.now(), scope, mode: MODE, start, end, month: ui.q('#mm').value },
      });
      log('正在打开 NC Details 页面…');
      location.href = S.reportUrl;
      return;
    }
    let ids = STEPS.map((s) => s.id);
    if (scope === 'filter') ids = ['load', 'others', 'date', 'site', 'conn', 'verify'];
    if (scope === 'export') ids = ['load', 'export', 'wait'];
    st.running = true;
    st.stop = false;
    st.platformVerified = false;
    ui.setRunning(true);
    renderSteps(ids);
    log('【' + MODE_NAME[MODE] + '】' + start + ' ~ ' + end);
    ui.enterRunMode();
    await sleep(300);
    const fns = {
      load: async () => {
        const ok = await waitFor(
          () => findSlicer(S.slicerDate) && findSlicer(S.slicerConnector) && findTable(),
          60000,
          500,
        );
        if (!ok) {
          const miss = [
            !findSlicer(S.slicerDate) && 'Work Date',
            !findSlicer(S.slicerConnector) && 'Connector Type',
            !findTable() && '明细表',
          ]
            .filter(Boolean)
            .join('、');
          throw new Error('60 秒内没找到：' + miss + '（请点"诊断"把信息发出来）');
        }
        await sleep(1000);
        return '已加载';
      },
      others: stepOthers,
      date: () => stepDate(start, end),
      site: stepSite,
      conn: stepConnector,
      verify: async () => {
        const value = await stepVerify(start, end);
        st.platformVerified = true;
        return value;
      },
      export: stepExport,
      wait: stepWait,
    };
    let ok = false,
      lastMsg = '';
    try {
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        if (st.stop) throw new Error('已停止');
        setStep(id, 'run');
        try {
          setStep(id, 'ok', await fns[id]());
        } catch (e) {
          if (st.stop || st.scheduled) throw e;
          setStep(id, 'err', e.message);
          ui.expandForAttention();
          const act = await askManual(id, e.message);
          ui.collapseAgain();
          if (act === 'retry') {
            i--;
            continue;
          }
          if (act === 'continue') {
            setStep(id, 'ok', '已手动完成');
            if (id === 'export') await send({ type: 'arm', mode: MODE }).catch(() => {});
            continue;
          }
          throw new Error('已停止');
        }
      }
      ok = true;
      log('全部完成', 'ok');
    } catch (e) {
      lastMsg = e.message;
      log(e.message, 'err');
      await send({ type: 'disarm' }).catch(() => {});
    } finally {
      st.running = false;
      st.scheduled = false;
      ui.setRunning(false);
      ui.q('#manual').hidden = true;
      ui.exitRunMode();
      ui.status(
        ok ? '✔ ' + MODE_NAME[MODE] + '完成' : '✖ ' + (lastMsg || '未完成'),
        ok ? 'ok' : 'err',
      );
    }
  }
  function askManual(id, msg) {
    return new Promise((res) => {
      const box = ui.q('#manual');
      box.hidden = false;
      const name = STEPS.find((s) => s.id === id).name;
      ui.q('#mmsg').textContent =
        '「' +
        name +
        '」自动操作失败：' +
        msg +
        (id === 'export'
          ? '。可以手动点 "…" → 导出数据 → 汇总数据 → .xlsx → 导出，然后点【我已手动完成】，后面的转移和启动照常进行。'
          : '。可以手动完成这一步后点【我已手动完成】。');
      st.manual = (v) => {
        box.hidden = true;
        st.manual = null;
        res(v);
      };
    });
  }
  function send(msg) {
    return chrome.runtime.sendMessage(msg);
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'toggle') {
      ui.toggle();
      return;
    }
    if (msg.type === 'dl-started') {
      st.dlStarted = true;
      log('开始下载 ' + msg.name);
    }
    if (msg.type === 'dl-done') {
      st.dlDone = true;
      log('下载完成：' + msg.path);
    }
    if (msg.type === 'dl-result') {
      st.dlResult = msg;
      if (!st.running)
        log(
          (msg.ok ? '处理完成：' : '处理失败：') + (msg.dest || msg.message || ''),
          msg.ok ? 'ok' : 'err',
        );
    }
  });

  /* ====================== 诊断 / 预览 / 读取 ====================== */
  async function diagnose() {
    S = await NCX.loadSettings();
    log('正在收集诊断信息…');
    const out = [
      'URL: ' + location.href,
      '版本: ' + NCX.VERSION,
      '模式: ' + MODE_NAME[MODE],
      '时间: ' + new Date().toLocaleString(),
    ];
    const roots = visualRoots();
    out.push('视觉对象数量: ' + roots.length);
    roots.forEach((r, i) => {
      const ins = dateInputs(r).map((x) => x.value);
      out.push(
        `#${i} [${isGrid(r) ? '表格' : isSlicer(r) ? '切片器' : '其他'}] ${titleOf(r).slice(0, 60)} | inputs=${ins.length > 4 ? ins.length + '个' : JSON.stringify(ins)} | rows=${r.querySelectorAll('[role=row]').length}`,
      );
    });
    for (const n of [S.slicerDate, S.slicerSite, S.slicerConnector])
      out.push('查找 "' + n + '": ' + (findSlicer(n) ? '找到' : '没找到'));
    const tb = findTable();
    out.push(
      '明细表: ' +
        (tb
          ? '找到（含"' +
            S.tableKey +
            '"=' +
            tableText(tb).includes(S.tableKey.toLowerCase()) +
            '）'
          : '没找到'),
    );
    if (tb) {
      hoverInside(tb);
      const b = await waitFor(
        () => pickHeaderButton(tb, /更多选项|more options|visual-more-options/i),
        2500,
        150,
      );
      out.push('"…"按钮: ' + (b ? b.getAttribute('aria-label') || b.className : '没找到'));
      if (!b) out.push(moreButtonReport(tb, ['诊断时 1 次']));
    }
    const sr = findSlicer(S.slicerSite);
    if (sr) {
      try {
        const { box, close } = await openSlicer(sr);
        const its = rawItems(box);
        out.push(
          'Site 弹出框项数=' +
            its.length +
            ' | ' +
            its
              .slice(0, 6)
              .map(
                (it) =>
                  itemText(it) +
                  '(' +
                  itemState(it) +
                  ',L' +
                  (it.getAttribute('aria-level') || '?') +
                  ')',
              )
              .join(' ; '),
        );
        await close();
      } catch (e) {
        out.push('Site 弹出框: ' + e.message);
      }
    }
    const cr = findSlicer(S.slicerConnector);
    if (cr) {
      try {
        const { box, close } = await openSlicer(cr);
        out.push(
          'Connector 项: ' +
            rawItems(box)
              .map((it) => itemText(it) + '(' + itemState(it) + ')')
              .join(' ; '),
        );
        await close();
      } catch (e) {
        out.push('Connector 弹出框: ' + e.message);
      }
    }
    const txt = out.join('\n');
    try {
      await navigator.clipboard.writeText(txt);
      log('诊断信息已复制到剪贴板，可以直接粘贴发出来', 'ok');
    } catch (e) {
      log('诊断信息（复制失败，请手动选中复制）：');
    }
    ui.q('#log').insertAdjacentHTML('beforeend', '<pre class="diag"></pre>');
    ui.q('#log').lastElementChild.textContent = txt;
  }
  async function previewConnector() {
    S = await NCX.loadSettings();
    const root = findSlicer(S.slicerConnector);
    if (!root) {
      log('找不到 Connector Type 切片器', 'err');
      return;
    }
    try {
      const { box, close } = await openSlicer(root);
      const vals = await readConnector(box);
      await close();
      st.connPreview = vals.map((v) => ({
        text: v.text,
        keep: NCX.judgeConnector(v.text, S).keep,
      }));
      renderPreview();
    } catch (e) {
      log('读取失败：' + e.message, 'err');
    }
  }
  async function readSites() {
    S = await NCX.loadSettings();
    const root = findSlicer(S.slicerSite);
    if (!root) {
      log('找不到 Site 切片器', 'err');
      return;
    }
    let leaves;
    try {
      const { box, close } = await openSlicer(root);
      try {
        const parents = [];
        await scan(box, (it, text, lv, p) => {
          if (lv === 0 && !isSelectAll(text)) parents.push(p);
          return false;
        });
        for (const p of parents) {
          const row = await findRow(box, p);
          const ex = row && ownQuery(row, '.expandButton, [class*="expand"], [aria-expanded]');
          if (
            ex &&
            !/true/.test(
              ex.getAttribute('aria-expanded') || row.getAttribute('aria-expanded') || '',
            )
          ) {
            realClick(ex);
            await sleep(700);
          }
        }
        const paths = [];
        await scan(box, (it, text, lv, p) => {
          if (!isSelectAll(text)) paths.push(p);
          return false;
        });
        leaves = paths.filter(
          (p) =>
            !paths.some(
              (q) => q.length > p.length && q.slice(0, p.length).join('>') === p.join('>'),
            ),
        );
      } finally {
        await close();
      }
    } catch (e) {
      log('读取失败：' + e.message, 'err');
      return;
    }
    const cur = NCX.parseSitePaths(S.sitePaths).map((p) => p.join('>'));
    const wrap = ui.q('#sitelist');
    wrap.innerHTML = '';
    leaves.forEach((p) => {
      const k = p.join('>');
      const lab = document.createElement('label');
      lab.innerHTML = '<input type="checkbox"> <span></span>';
      lab.querySelector('span').textContent = k;
      lab.querySelector('input').checked = cur.includes(k);
      lab.querySelector('input').onchange = async () => {
        S = await NCX.loadSettings();
        const sel = [...wrap.querySelectorAll('input')]
          .map((c, i) => (c.checked ? leaves[i].join('>') : null))
          .filter(Boolean);
        S.sitePaths = sel.join('\n');
        await NCX.saveSettings(S);
        ui.q('#siteval').textContent =
          sel.map((x) => x.split('>').pop()).join('、') || '（未选择）';
      };
      wrap.appendChild(lab);
    });
    wrap.hidden = false;
  }

  /* ====================== 面板 ====================== */
  const CSS = `
  :host{all:initial}
  .p{position:fixed;z-index:2147483646;width:360px;background:#fff;border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.28);
     font:12px/1.5 "Microsoft YaHei","Segoe UI",sans-serif;color:#222;overflow:hidden;border:1px solid #d0d7de;transition:width .25s ease}
  .hd{background:linear-gradient(135deg,#0f7b6c,#1aa38f);color:#fff;padding:7px 10px;display:flex;align-items:center;gap:6px;cursor:move;user-select:none}
  .p.monthly .hd{background:linear-gradient(135deg,#3949ab,#5c6bc0)}
  .hd b{flex:none;font-size:13px}.hd small{opacity:.8;margin-left:6px;font-weight:normal}
  #hs{flex:1;min-width:0;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.95}
  #hs.err{color:#ffe0e0;font-weight:bold}#hs.ok{color:#e6fff4;font-weight:bold}
  .hd button{background:rgba(255,255,255,.2);border:0;color:#fff;border-radius:4px;cursor:pointer;width:22px;height:20px;flex:none}
  .bd{padding:8px 10px;max-height:72vh;overflow:auto}
  .tabs{display:flex;margin-bottom:6px;border:1px solid #0f7b6c;border-radius:6px;overflow:hidden}
  .tabs button{flex:1;font:inherit;border:0;background:#fff;color:#0f7b6c;padding:4px 0;cursor:pointer}
  .tabs button.on{background:#0f7b6c;color:#fff;font-weight:bold}
  .p.monthly .tabs{border-color:#3949ab}.p.monthly .tabs button{color:#3949ab}.p.monthly .tabs button.on{background:#3949ab;color:#fff}
  .row{display:flex;align-items:center;gap:6px;margin:5px 0}.row>label{width:76px;color:#555;flex:none}
  input[type=date],input[type=month]{font:inherit;font-size:11px;padding:2px 4px;border:1px solid #bbb;border-radius:4px;width:118px;box-sizing:border-box}
  input[type=month]{width:130px}
  .btn{font:inherit;border:1px solid #0f7b6c;background:#fff;color:#0f7b6c;border-radius:5px;padding:3px 8px;cursor:pointer}
  .btn:hover{background:#e8f5f2}.btn.main{background:#0f7b6c;color:#fff;font-weight:bold;padding:6px 10px;width:100%;margin-top:4px}
  .btn.main:hover{background:#0c6457}.btn:disabled{opacity:.5;cursor:default}
  .p.monthly .btn{border-color:#3949ab;color:#3949ab}.p.monthly .btn:hover{background:#eceffa}
  .p.monthly .btn.main{background:#3949ab;color:#fff}.p.monthly .btn.main:hover{background:#303f9f}
  .btns{display:flex;gap:6px;margin-top:6px;flex-wrap:wrap}.btns .btn{flex:1}
  .val{flex:1;color:#0f7b6c;font-weight:bold;word-break:break-all}.p.monthly .val{color:#3949ab}
  .val.warn{color:#c62828!important}
  .tag{font-size:11px;color:#888}
  .chips{display:flex;flex-wrap:wrap;gap:4px;margin:4px 0 2px 82px}
  .chip{padding:1px 6px;border-radius:10px;cursor:pointer;border:1px solid}
  .chip.k{background:#e6f6ec;border-color:#5cb87a;color:#1d6b38}.chip.x{background:#fdecea;border-color:#e57373;color:#b3261e;text-decoration:line-through}
  #sitelist{margin:2px 0 4px 82px;display:flex;flex-direction:column}
  .steps{margin-top:8px;border-top:1px dashed #ccc;padding-top:6px}
  .st{display:flex;gap:6px;padding:1px 0}.st i{font-style:normal;width:14px;flex:none}.st .n{flex:none}.st .note{color:#666;word-break:break-all}
  .st.ok i{color:#2e7d32}.st.err i{color:#c62828}.st.run i{color:#ef6c00}
  #manual{background:#fff8e1;border:1px solid #ffcc80;border-radius:6px;padding:6px;margin-top:6px}
  #log{margin-top:6px;max-height:140px;overflow:auto;background:#f6f8fa;border-radius:6px;padding:4px 6px;font-size:11px;white-space:pre-wrap}
  #log div.err{color:#c62828}#log div.ok{color:#2e7d32}
  pre.diag{white-space:pre-wrap;font-size:10px;max-height:160px;overflow:auto;background:#fff;border:1px solid #ddd;padding:4px}
  .mini .bd{display:none}.mini{width:260px}
  .p.runmode{width:330px;opacity:.95}
  .p.runmode .hd small{display:none}
  .p.runmode .bd{display:none}
  .p.runmode.attn{width:360px;opacity:1}
  .p.runmode.attn .bd{display:block;max-height:60vh}
  .p.runmode.attn .bd > :not(#manual):not(.steps):not(#log){display:none}
  [hidden]{display:none!important}`;

  const ui = (() => {
    const host = document.createElement('div');
    host.id = 'ncx-host';
    const sh = host.attachShadow({ mode: 'open' });
    sh.innerHTML = `<style>${CSS}</style>
    <div class="p" id="p">
      <div class="hd" id="hd"><b id="ttl">BI NC Exporter<small>v${NCX.VERSION}</small></b><span id="hs"></span><button id="min" title="最小化 / 展开">–</button><button id="cls" title="隐藏（点工具栏图标可再显示）">×</button></div>
      <div class="bd">
        <div class="tabs"><button id="tDaily">每日分析</button><button id="tMonthly">月度分析</button></div>
        <div id="dayBox">
          <div class="row"><label>Work Date</label><input type="date" id="ds">~<input type="date" id="de"></div>
          <div class="row"><label></label><span class="tag" id="dmode"></span><button class="btn" id="dauto">恢复自动</button></div>
        </div>
        <div id="monBox" hidden>
          <div class="row"><label>月份</label><input type="month" id="mm"><button class="btn" id="mauto">恢复上月</button></div>
          <div class="row"><label>Work Date</label><span class="tag" id="mrange"></span></div>
        </div>
        <div class="row"><label>Site</label><span class="val" id="siteval"></span><button class="btn" id="siteread">读取</button></div>
        <div id="sitelist" hidden></div>
        <div class="row"><label>Connector</label><span class="tag" id="connrule"></span><button class="btn" id="connread">预览</button></div>
        <div class="chips" id="chips"></div>
        <div class="row"><label>分析程序</label><span class="val" id="batval"></span></div>
        <button class="btn main" id="go">一键导出 + 分析</button>
        <div class="btns"><button class="btn" id="filter">只设置筛选</button><button class="btn" id="exp">只导出</button><button class="btn" id="stop" disabled>停止</button></div>
        <div class="btns"><button class="btn" id="diag">诊断</button><button class="btn" id="opt">设置</button></div>
        <div id="manual" hidden><div id="mmsg"></div>
          <div class="btns"><button class="btn" id="mretry">重试</button><button class="btn" id="mcont">我已手动完成</button><button class="btn" id="mstop">停止</button></div></div>
        <div class="steps" id="steps"></div>
        <div id="log"></div>
      </div>
    </div>`;
    const q = (s) => sh.querySelector(s);
    const p = q('#p');
    let shown = false,
      saved = null;
    async function mount() {
      if (!host.isConnected) document.documentElement.appendChild(host);
      const pos = (await chrome.storage.local.get('panelPos')).panelPos || { right: 16, top: 70 };
      p.style.bottom = 'auto';
      p.style.top = Math.min(pos.top, innerHeight - 60) + 'px';
      if (pos.left != null) {
        p.style.left = Math.min(pos.left, innerWidth - 120) + 'px';
        p.style.right = 'auto';
      } else {
        p.style.right = pos.right + 'px';
        p.style.left = 'auto';
      }
      shown = true;
    }
    function hide() {
      host.remove();
      shown = false;
    }
    function toBottomLeft() {
      p.style.left = '12px';
      p.style.bottom = '12px';
      p.style.top = 'auto';
      p.style.right = 'auto';
    }
    let drag = null;
    q('#hd').addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      const r = p.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      e.preventDefault();
    });
    addEventListener('mousemove', (e) => {
      if (!drag) return;
      p.style.right = 'auto';
      p.style.bottom = 'auto';
      p.style.left = Math.max(0, Math.min(innerWidth - 100, e.clientX - drag.dx)) + 'px';
      p.style.top = Math.max(0, Math.min(innerHeight - 40, e.clientY - drag.dy)) + 'px';
    });
    addEventListener('mouseup', () => {
      if (!drag) return;
      drag = null;
      if (p.classList.contains('runmode')) return;
      const r = p.getBoundingClientRect();
      chrome.storage.local.set({ panelPos: { left: Math.round(r.left), top: Math.round(r.top) } });
    });
    q('#min').onclick = () => {
      if (p.classList.contains('runmode')) p.classList.toggle('attn');
      else p.classList.toggle('mini');
    };
    q('#cls').onclick = hide;
    return {
      q,
      p,
      mount,
      hide,
      toggle: () => (shown ? hide() : (refresh(), mount())),
      setRunning: (on) => {
        ['#go', '#filter', '#exp', '#tDaily', '#tMonthly'].forEach((s) => (q(s).disabled = on));
        q('#stop').disabled = !on;
      },
      status: (t, cls) => {
        const h = q('#hs');
        h.textContent = t || '';
        h.className = cls || '';
        h.title = t || '';
      },
      enterRunMode: () => {
        if (!host.isConnected) document.documentElement.appendChild(host);
        saved = {
          left: p.style.left,
          top: p.style.top,
          right: p.style.right,
          bottom: p.style.bottom,
          mini: p.classList.contains('mini'),
        };
        p.classList.remove('mini', 'attn');
        p.classList.add('runmode');
        toBottomLeft();
      },
      expandForAttention: () => {
        if (p.classList.contains('runmode')) {
          p.classList.add('attn');
          toBottomLeft();
        }
      },
      collapseAgain: () => {
        p.classList.remove('attn');
      },
      exitRunMode: () => {
        p.classList.remove('runmode', 'attn');
        if (saved) {
          p.style.left = saved.left;
          p.style.top = saved.top;
          p.style.right = saved.right;
          p.style.bottom = saved.bottom;
          if (saved.mini) p.classList.add('mini');
          saved = null;
        }
      },
    };
  })();

  function log(t, cls) {
    const d = document.createElement('div');
    d.className = cls || '';
    d.textContent = new Date().toLocaleTimeString() + ' ' + t;
    const L = ui.q('#log');
    L.appendChild(d);
    L.scrollTop = L.scrollHeight;
  }
  function renderSteps(ids) {
    ui.q('#steps').innerHTML = '';
    ids.forEach((id) => {
      const d = document.createElement('div');
      d.className = 'st';
      d.dataset.id = id;
      d.innerHTML = '<i>○</i><span class="n"></span><span class="note"></span>';
      d.querySelector('.n').textContent = STEPS.find((x) => x.id === id).name;
      ui.q('#steps').appendChild(d);
    });
  }
  function setStep(id, state, note) {
    const d = ui.q('#steps').querySelector(`[data-id="${id}"]`);
    if (!d) return;
    d.className = 'st ' + state;
    d.querySelector('i').textContent = { run: '▶', ok: '✔', err: '✖' }[state] || '○';
    d.querySelector('.note').textContent = note ? '：' + note : '';
    const all = [...ui.q('#steps').querySelectorAll('.st')];
    const idx = all.indexOf(d) + 1;
    const name = STEPS.find((x) => x.id === id).name;
    if (state === 'run')
      ui.status('▶ ' + MODE_NAME[MODE] + ' ' + idx + '/' + all.length + ' ' + name);
    if (state === 'err') ui.status('✖ ' + name, 'err');
  }
  function setStepNote(id, note) {
    const d = ui.q('#steps').querySelector(`[data-id="${id}"] .note`);
    if (d) d.textContent = '：' + note;
    if (ui.p.classList.contains('runmode')) {
      const all = [...ui.q('#steps').querySelectorAll('.st')];
      const el = ui.q('#steps').querySelector(`[data-id="${id}"]`);
      if (el)
        ui.status(
          '▶ ' + MODE_NAME[MODE] + ' ' + (all.indexOf(el) + 1) + '/' + all.length + ' ' + note,
        );
    }
  }
  function renderPreview() {
    const c = ui.q('#chips');
    c.innerHTML = '';
    (st.connPreview || []).forEach((v) => {
      const s = document.createElement('span');
      s.className = 'chip ' + (v.keep ? 'k' : 'x');
      s.textContent = v.text;
      s.title = '点击切换 保留/排除（写入"手动设置"）';
      s.onclick = async () => {
        S = await NCX.loadSettings();
        const lines = String(S.overrides || '')
          .split(/\r?\n/)
          .filter(
            (l) => l.trim() && l.split(/[=＝]/)[0].trim().toUpperCase() !== v.text.toUpperCase(),
          );
        const auto = NCX.judgeConnector(
          v.text,
          Object.assign({}, S, { overrides: lines.join('\n') }),
        ).keep;
        const want = !v.keep;
        if (want !== auto) lines.push(v.text + '=' + (want ? '保留' : '排除'));
        S.overrides = lines.join('\n');
        await NCX.saveSettings(S);
        v.keep = want;
        renderPreview();
      };
      c.appendChild(s);
    });
  }

  /* ---------- 模式切换 ---------- */
  async function setMode(m, silent) {
    MODE = m === 'monthly' ? 'monthly' : 'daily';
    ui.p.classList.toggle('monthly', MODE === 'monthly');
    ui.q('#tDaily').classList.toggle('on', MODE === 'daily');
    ui.q('#tMonthly').classList.toggle('on', MODE === 'monthly');
    ui.q('#dayBox').hidden = MODE !== 'daily';
    ui.q('#monBox').hidden = MODE !== 'monthly';
    ui.q('#go').textContent = (MODE === 'monthly' ? '月度' : '每日') + '：一键导出 + 分析';
    if (!silent) await chrome.storage.local.set({ panelMode: MODE });
    showBat();
  }
  function showBat() {
    if (!S) return;
    const el = ui.q('#batval');
    if (S.workMode === 'B') {
      el.textContent =
        MODE === 'monthly'
          ? '月度模式需要 A 模式'
          : '[监视模式] ' + (S.transferMode === 'copy' ? '复制' : '剪切');
      el.classList.toggle('warn', MODE === 'monthly');
      return;
    }
    const bat = NCX.batFor(S, MODE);
    const same = NCX.samePath(S.batPath, S.batPathMonthly);
    el.textContent = !bat
      ? '未设置（请到设置里填写）'
      : (same ? '⚠ 和' + (MODE === 'monthly' ? '每日' : '月度') + '的是同一个文件 ' : '') +
        bat.split(/[\\/]/).slice(-2).join('\\') +
        '（' +
        (S.transferMode === 'copy' ? '复制' : '剪切') +
        (MODE === 'monthly' ? '，改名 data.xlsx' : '') +
        '）';
    el.classList.toggle('warn', !bat || same);
    el.title = bat || '';
  }
  async function refresh() {
    S = await NCX.loadSettings();
    ui.q('#siteval').textContent =
      NCX.parseSitePaths(S.sitePaths)
        .map((p) => p[p.length - 1])
        .join('、') || '（未设置）';
    ui.q('#connrule').textContent =
      '排除含 ' +
      NCX.splitList(S.excludeKeywords).join('/') +
      '（例外 ' +
      (NCX.splitList(S.exceptionWords).join('/') || '无') +
      '）';
    showBat();
    if (!ui.q('#ds').dataset.manual) setAutoDate();
    if (!ui.q('#mm').dataset.manual) setAutoMonth();
  }
  function setAutoDate() {
    const d = NCX.previousWorkday(S);
    ui.q('#ds').value = ui.q('#de').value = d ? NCX.ymd(d) : '';
    ui.q('#ds').dataset.manual = '';
    ui.q('#dmode').textContent =
      '自动：前一个工作日' + (d ? '（周' + '日一二三四五六'[d.getDay()] + '）' : '');
  }
  function showMonthRange() {
    const r = NCX.monthRange(ui.q('#mm').value);
    ui.q('#mrange').textContent = r
      ? r[0] + ' ~ ' + r[1] + (ui.q('#mm').dataset.manual ? '（手动选择）' : '（自动：上一个月）')
      : '请选择月份';
  }
  function setAutoMonth() {
    ui.q('#mm').value = NCX.previousMonth();
    ui.q('#mm').dataset.manual = '';
    showMonthRange();
  }
  ['#ds', '#de'].forEach((id) =>
    ui.q(id).addEventListener('change', () => {
      ui.q('#ds').dataset.manual = '1';
      if (id === '#ds') ui.q('#de').value = ui.q('#ds').value;
      ui.q('#dmode').textContent = '手动选择';
    }),
  );
  ui.q('#mm').addEventListener('change', () => {
    ui.q('#mm').dataset.manual = '1';
    showMonthRange();
  });
  ui.q('#dauto').onclick = setAutoDate;
  ui.q('#mauto').onclick = setAutoMonth;
  ui.q('#tDaily').onclick = () => setMode('daily');
  ui.q('#tMonthly').onclick = () => setMode('monthly');
  ui.q('#go').onclick = () => run('all');
  ui.q('#filter').onclick = () => run('filter');
  ui.q('#exp').onclick = () => run('export');
  ui.q('#stop').onclick = () => {
    st.stop = true;
    if (st.manual) st.manual('stop');
    log('正在停止…');
  };
  ui.q('#diag').onclick = diagnose;
  ui.q('#opt').onclick = () => send({ type: 'openOptions' });
  ui.q('#connread').onclick = previewConnector;
  ui.q('#siteread').onclick = readSites;
  ui.q('#mretry').onclick = () => st.manual && st.manual('retry');
  ui.q('#mcont').onclick = () => st.manual && st.manual('continue');
  ui.q('#mstop').onclick = () => st.manual && st.manual('stop');
  chrome.storage.onChanged.addListener((c, area) => {
    if (area === 'local' && c.settings && !st.running) refresh();
  });

  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message.type !== 'ncx-scheduled-run') return;
    if (st.running) {
      reply({ ok: false, message: '页面已有运行任务' });
      return;
    }
    (async () => {
      st.scheduled = true;
      await setMode('daily', true);
      setAutoDate();
      await ui.mount();
      reply({ ok: true });
      await run('all');
    })().catch((error) => {
      reply({ ok: false, message: error.message });
    });
    return true;
  });
  /* ====================== 启动 ====================== */
  (async () => {
    S = await NCX.loadSettings();
    const saved = await chrome.storage.local.get(['pendingRun', 'panelMode']);
    const pend = saved.pendingRun;
    await setMode((pend && pend.mode) || saved.panelMode || 'daily', true);
    const onReport = reportId(location.href) && reportId(location.href) === reportId(S.reportUrl);
    if (onReport || pend) {
      await refresh();
      await ui.mount();
    }
    if (pend) {
      await chrome.storage.local.remove('pendingRun');
      if (Date.now() - pend.at < 180000) {
        if (pend.mode === 'monthly') {
          ui.q('#mm').value = pend.month;
          ui.q('#mm').dataset.manual = '1';
          showMonthRange();
        } else {
          ui.q('#ds').value = pend.start;
          ui.q('#de').value = pend.end;
          ui.q('#ds').dataset.manual = '1';
          ui.q('#dmode').textContent = '本次运行日期';
        }
        setTimeout(() => run(pend.scope), 1500);
      }
    }
  })();
})();
