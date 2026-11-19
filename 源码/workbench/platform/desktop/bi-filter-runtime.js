'use strict';
(function (root) {
  // Runs only in the report page at the user's explicit handoff. No network,
  // credentials, cookies, storage, fixed IDs, or screen-coordinate clicks.
  function create(
    doc,
    { pause = (ms) => new Promise((r) => setTimeout(r, ms)), maxRounds = 160 } = {},
  ) {
    const view = doc.defaultView;
    const visible = (e) => {
      if (!e) return false;
      const r = e.getBoundingClientRect(),
        s = view.getComputedStyle(e);
      return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
    };
    const all = (sel, base = doc) => [...base.querySelectorAll(sel)].filter(visible);
    const exact = (xs, label) => {
      if (xs.length !== 1) throw Error(label + '无法唯一定位（' + xs.length + '个）。');
      return xs[0];
    };
    const text = (e) => e.getAttribute('title') ?? e.textContent.trim();
    const key = (e, name) =>
      e.dispatchEvent(new view.KeyboardEvent('keydown', { key: name, bubbles: true }));
    const click = (e, multi = false) => {
      if (e.getAttribute('aria-disabled') === 'true' || e.disabled) throw Error('控件不可用。');
      e.dispatchEvent(new view.MouseEvent('click', { bubbles: true, ctrlKey: multi }));
    };
    async function wait(fn, label) {
      for (let i = 0; i < 35; i++) {
        const v = fn();
        if (v) return v;
        await pause(100);
      }
      throw Error(label + '等待超时。');
    }
    const combo = (id) =>
      exact(
        all('[role="combobox"][aria-label]').filter((x) => x.getAttribute('aria-label') === id),
        id,
      );
    function popup(id) {
      const c = combo(id),
        p = doc.getElementById(c.getAttribute('aria-controls'));
      return c.getAttribute('aria-expanded') === 'true' && visible(p) ? p : null;
    }
    function escape() {
      key(doc.activeElement || doc.body, 'Escape');
    }
    async function open(id) {
      if (popup(id)) return popup(id);
      escape();
      await pause(100);
      for (let attempt = 0; attempt < 3; attempt++) {
        const c = combo(id);
        c.scrollIntoView({ block: 'center' });
        if (attempt === 0) click(c);
        else if (attempt === 1) {
          c.focus();
          key(c, 'Enter');
        } else {
          for (const type of ['mousedown', 'mouseup'])
            c.dispatchEvent(new view.MouseEvent(type, { bubbles: true }));
          c.click();
        }
        try {
          return await wait(() => popup(id), id + '下拉');
        } catch (e) {
          if (attempt === 2) throw e;
          escape();
          await pause(150);
        }
      }
    }
    function branch(value) {
      if (value === '(空白)') return value;
      for (const x of ['BK', 'GL', 'HW']) if (value === x || value.startsWith(x + '_')) return x;
      return null;
    }
    function group(id) {
      if (id === 'Shift')
        return exact(
          all('.slicerBody').filter(
            (e) =>
              e.querySelector('.slicerItemContainer[role="checkbox"][title="白班"]') &&
              e.querySelector('.slicerItemContainer[role="checkbox"][title="晚班"]'),
          ),
          'Shift切片器',
        );
      return exact(
        all('.slicerBody[role="tree"][aria-label="Site、Resource Category"]'),
        '站点与楼层树',
      );
    }
    async function scan(field) {
      const isList = field.kind === 'list',
        isTree = field.kind === 'tree';
      if (isList) await open(field.id);
      const base = () => (isList ? popup(field.id) : group(field.id));
      const root = base();
      if (!root) throw Error(field.id + '浮层丢失。');
      const search = all('input.searchInput,input[aria-label="搜索"]', root);
      for (const input of search)
        if (input.value) {
          const setter = Object.getOwnPropertyDescriptor(
            view.HTMLInputElement.prototype,
            'value',
          ).set;
          setter.call(input, '');
          input.dispatchEvent(new view.Event('input', { bubbles: true }));
          await pause(150);
        }
      const scroll = () =>
        base()?.querySelector('.scroll-content') ||
        base()?.querySelector('.scrollRegion') ||
        base();
      if (isTree) {
        for (let pass = 0; pass < 8; pass++) {
          const collapsed = all(
            '.slicerItemContainer[role="treeitem"][aria-expanded="false"]',
            base(),
          );
          if (!collapsed.length) break;
          for (const item of collapsed) {
            item.focus();
            key(item, 'ArrowRight');
            await pause(100);
          }
          if (pass === 7) throw Error('层级树无法全部展开，请手动展开后重试。');
        }
      }
      const sc = scroll();
      sc.focus();
      key(sc, 'Home');
      sc.scrollTop = 0;
      sc.dispatchEvent(new view.Event('scroll', { bubbles: true }));
      await pause(150);
      const positions = new Map(),
        totals = new Map(),
        rows = new Map();
      let unchanged = 0,
        priorSize = 0;
      for (let round = 0; round < maxRounds; round++) {
        const current = base();
        if (!current) throw Error('采集时浮层被替换。');
        let parent = null;
        const nodes = all(
          '.slicerItemContainer[role="' +
            (isTree ? 'treeitem' : isList ? 'option' : 'checkbox') +
            '"]',
          current,
        );
        for (const e of nodes) {
          const value = text(e),
            isAll = /^(全选|Select all)$/i.test(value);
          const level = Number(e.getAttribute('aria-level'));
          if (isTree && level === 1 && !isAll) parent = value;
          const p = isTree && level === 2 ? branch(value) || parent : '';
          if (isTree && level === 2 && !p) throw Error('无法确认层级父级：' + value);
          const id = isTree && level === 2 ? p + '\t' + value : value;
          let pos = Number(e.getAttribute('aria-posinset')),
            total = Number(e.getAttribute('aria-setsize'));
          if (!isList && !isTree) {
            pos = nodes.indexOf(e) + 1;
            total = nodes.length;
          }
          if (!pos || !total || pos > total) throw Error('选项缺少可靠位置或数量。');
          const scope = isTree ? (level === 2 ? 'child:' + p : 'top') : 'list';
          const k = scope + ':' + pos;
          if (positions.has(k) && positions.get(k) !== id)
            throw Error('同一位置出现不同值，采集无效。');
          if (totals.has(scope) && totals.get(scope) !== total)
            throw Error('声明数量发生变化，请重试采集。');
          positions.set(k, id);
          totals.set(scope, total);
          const attr = isTree ? 'aria-selected' : 'aria-checked',
            checked = e.getAttribute(attr);
          if (!['true', 'false', 'mixed'].includes(checked)) throw Error('选中状态无法读取。');
          if (rows.has(id) && rows.get(id).position !== k) throw Error('重复值或层级归属冲突。');
          rows.set(id, {
            value: id,
            selected: checked,
            all: isAll,
            parent: isTree && level === 1,
            position: k,
          });
        }
        let complete = [...totals].every(([scope, total]) =>
          Array.from({ length: total }, (_, i) => scope + ':' + (i + 1)).every((k) =>
            positions.has(k),
          ),
        );
        if (isTree)
          complete =
            complete &&
            [...rows.values()]
              .filter((r) => r.parent && !r.all)
              .every((r) => totals.has('child:' + r.value));
        if (complete && rows.size) return { rows: [...rows.values()], complete: true };
        unchanged = rows.size === priorSize ? unchanged + 1 : 0;
        priorSize = rows.size;
        if (unchanged >= 4) throw Error('选项采集不完整，未修改选择。');
        const node = scroll();
        if (!node || node.clientHeight <= 0 || node.scrollHeight <= 0)
          throw Error('滚动容器已重建，不能判定到底。');
        if (
          round === 1 &&
          Math.min(...[...positions.keys()].map((x) => Number(x.split(':').at(-1)))) > 1
        ) {
          key(node, 'Home');
          node.scrollTop = 0;
        } else node.scrollTop += Math.max(24, node.clientHeight * 0.7);
        node.dispatchEvent(new view.Event('scroll', { bubbles: true }));
        await pause(150);
      }
      throw Error('采集达到安全上限，未证明完整。');
    }
    async function locate(field, value) {
      // Re-find DOM after every mutation/scroll; never reuse a cached popup ID.
      const base = () => (field.kind === 'list' ? popup(field.id) : group(field.id));
      if (field.kind === 'list' && !base()) await open(field.id);
      const selector =
        '.slicerItemContainer[role="' +
        (field.kind === 'tree' ? 'treeitem' : field.kind === 'list' ? 'option' : 'checkbox') +
        '"]';
      const targetValue = value.split('\t').at(-1);
      for (let n = 0; n < maxRounds; n++) {
        const hits = all(selector, base()).filter(
          (e) =>
            text(e) === targetValue &&
            (field.kind !== 'tree' ||
              /^(全选|Select all)$/i.test(targetValue) ||
              (Number(e.getAttribute('aria-level')) === 2 &&
                branch(targetValue) === value.split('\t')[0])),
        );
        if (hits.length === 1) return hits[0];
        if (hits.length > 1) throw Error('选项重复，不能可靠定位。');
        const s = base()?.querySelector('.scroll-content') || base();
        if (!s) throw Error('浮层丢失。');
        if (n === 0) {
          key(s, 'Home');
          s.scrollTop = 0;
        } else s.scrollTop += Math.max(24, s.clientHeight * 0.7);
        s.dispatchEvent(new view.Event('scroll', { bubbles: true }));
        await pause(100);
      }
      throw Error('无法重新定位选项：' + value);
    }
    async function selection(field, request) {
      let snapshot = await scan(field);
      let business = snapshot.rows.filter((r) => !r.all && !r.parent);
      if (request.mode === 'all') {
        const control = snapshot.rows.find((r) => r.all);
        if (control) {
          if (control.selected !== 'true') {
            click(await locate(field, control.value));
            await pause(250);
          }
        } else if (field.kind !== 'checkbox')
          throw Error('没有可靠全选控件，不能声明取消该字段限制。');
      } else {
        for (const value of request.values)
          if (!business.some((r) => r.value === value))
            throw Error(field.id + '没有精确匹配值：' + value);
      }
      const wanted = request.mode === 'all' ? business.map((r) => r.value) : request.values;
      for (let attempts = 0; attempts < Math.max(4, business.length * 2); attempts++) {
        snapshot = await scan(field);
        business = snapshot.rows.filter((r) => !r.all && !r.parent);
        if (request.values.some((v) => !business.some((r) => r.value === v)))
          throw Error('筛选联动后目标选项不再可用。');
        const difference = business.find(
          (r) => r.selected !== (wanted.includes(r.value) ? 'true' : 'false'),
        );
        if (!difference) {
          const allControl = snapshot.rows.find((r) => r.all);
          if (
            request.mode === 'all' &&
            field.kind !== 'checkbox' &&
            allControl?.selected !== 'true'
          )
            throw Error('未确认全选控件已选中。');
          return {
            field: field.id,
            mode: request.mode,
            requested: request.values.slice(),
            selected: business.filter((r) => r.selected === 'true').map((r) => r.value),
            allVerified: request.mode === 'all',
            complete: true,
            status: 'verified',
          };
        }
        click(await locate(field, difference.value), field.kind !== 'checkbox');
        await pause(250);
      }
      throw Error(field.id + '选择未稳定，已停止导出。');
    }
    function dates(job) {
      const read = (kind) =>
        exact(
          all('input.date-slicer-datepicker').filter((x) =>
            (x.getAttribute('aria-label') || '').startsWith(
              kind === 'start' ? '开始日期' : '结束日期',
            ),
          ),
          'Work Date日期',
        ).value;
      const iso = (x) => {
        const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(x);
        return m ? m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0') : '';
      };
      for (const [kind, handle] of [
        ['start', '0'],
        ['end', '1'],
      ]) {
        const input = iso(read(kind)),
          slider = exact(
            all('[role="slider"][aria-label="Work Date"]').filter(
              (x) => x.getAttribute('data-handle') === handle,
            ),
            'Work Date滑杆',
          );
        if (input !== job[kind] || iso(slider.getAttribute('aria-valuetext') || '') !== job[kind])
          throw Error('日期输入与滑杆尚未一致，未导出。');
      }
      return { start: job.start, end: job.end, status: 'verified' };
    }
    return {
      async inspect(fields) {
        const output = { format: 'BK-MPO-PBI-OPTIONS', version: 1, fields: {} };
        for (const field of fields) {
          try {
            const s = await scan(field);
            output.fields[field.id] = {
              status: 'success',
              complete: true,
              values: s.rows.filter((r) => !r.all && !r.parent).map((r) => r.value),
            };
          } catch (error) {
            output.fields[field.id] = { status: 'failed', complete: false, error: String(error) };
          } finally {
            escape();
          }
        }
        return output;
      },
      async apply(job, model) {
        const filters = model.normalize(job.exportFilters || {}),
          proof = { version: 1, fields: [], dates: null };
        for (const field of model.fields) {
          const request = filters[field.id];
          if (request.mode === 'keep') continue;
          try {
            proof.fields.push(await selection(field, request));
          } finally {
            escape();
          }
        }
        // ARIA busy is only observable UI evidence, not a model-refresh API.
        // Downloaded raw columns still have to match before automatic ingestion.
        let quiet = 0;
        for (let round = 0; round < 80 && quiet < 3; round++) {
          if (all('[aria-busy="true"]').length) quiet = 0;
          else quiet++;
          await pause(250);
        }
        if (quiet < 3) throw Error('报表仍在忙碌，未请求导出。');
        // Cross-slicer changes can invalidate earlier selections: read all again.
        for (const field of model.fields) {
          const request = filters[field.id];
          if (request.mode === 'keep') continue;
          const s = await scan(field),
            selected = s.rows
              .filter((r) => !r.all && !r.parent && r.selected === 'true')
              .map((r) => r.value);
          const expected = proof.fields.find((r) => r.field === field.id).selected;
          if (
            JSON.stringify(selected.slice().sort()) !== JSON.stringify(expected.slice().sort()) ||
            (request.mode === 'all' &&
              field.kind !== 'checkbox' &&
              !s.rows.some((r) => r.all && r.selected === 'true'))
          )
            throw Error(field.id + '被其他筛选改变，未导出。');
          escape();
        }
        proof.dates = dates(job);
        return proof;
      },
    };
  }
  root.BIFilterRuntime = { create };
})(typeof window !== 'undefined' ? window : globalThis);
