'use strict';
// Exercise the creation dialog with a minimal DOM; this is not visible UI acceptance.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const code = fs.readFileSync(path.join(__dirname, '../desktop/app/workspace-manager.js'), 'utf8');
function creation(mode = 'blank', selected = null) {
  const nodes = [],
    calls = [],
    selects = [];
  const el = (tag, cls, text) => {
    const e = {
      tag,
      cls,
      textContent: text,
      children: [],
      value: '',
      append(...n) {
        this.children.push(...n);
      },
      setAttribute() {},
      showModal() {},
      focus() {},
      close() {
        this.closed = true;
      },
      remove() {},
    };
    nodes.push(e);
    return e;
  };
  const root = el('section');
  vm.runInNewContext(
    code.slice(
      code.indexOf('  function createDialog('),
      code.indexOf('  async function quantityDialog('),
    ) + '\ncreateDialog(mode, {name:"装管异常",process:"装管"});',
    {
      mode,
      selected,
      items: selected ? [selected] : [],
      root,
      el,
      input(label, value) {
        const wrap = el('label'),
          input = el('input');
        input.value = value;
        wrap.append(input);
        return [wrap, input];
      },
      select(options, value) {
        const e = el('select');
        e.value = value;
        e.options = options;
        selects.push(e);
        return e;
      },
      btn: (label, fn) => Object.assign(el('button', '', label), { onclick: fn }),
      api: async (action, input) => {
        calls.push({ action, input });
        return { id: 'made' };
      },
      layout: {},
      open: async () => {},
    },
  );
  return { nodes, calls, selects, form: nodes.find((n) => n.tag === 'form') };
}
test('workspace creation requires an explicit source and passes the selected mode without copying records', async () => {
  const r = creation();
  assert.equal(r.selects[0].required, true);
  assert.equal(r.selects[0].value, '');
  await r.form.onsubmit({ preventDefault() {} });
  assert.equal(r.calls.length, 0);
  assert.ok(r.nodes.some((n) => /请选择手动录入不良/.test(n.textContent || '')));
  for (const source of ['bi', 'records']) {
    const x = creation();
    x.selects[0].value = source;
    await x.form.onsubmit({ preventDefault() {} });
    assert.equal(x.calls.length, 1);
    assert.equal(x.calls[0].input.dataSourceMode, source);
    assert.equal(x.calls[0].input.copyFrom, undefined);
    assert.equal(x.calls[0].input.process, '装管');
  }
});
test('copying workspace settings inherits the explicit source, while legacy auto needs confirmation', () => {
  assert.equal(
    creation('copy', { id: 'old', name: '旧', dataSourceMode: 'bi' }).selects[0].value,
    'bi',
  );
  assert.equal(creation('copy', { id: 'old', name: '旧' }).selects[0].value, '');
});
