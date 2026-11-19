'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict');
const template = require('../domain/label-template'),
  editing = require('../domain/label-editing');
function sample() {
  return template.validate({
    version: 1,
    width: 50,
    height: 50,
    elements: [
      { id: 'qr', type: 'qr', x: 2, y: 2, width: 20, height: 20 },
      {
        id: 'a',
        type: 'text',
        x: 4,
        y: 30,
        width: 15,
        height: 5,
        binding: 'code',
        text: '编号：',
        fontSize: 10,
        bold: false,
        align: 'center',
        color: '#123456',
        group: 'g',
      },
      {
        id: 'b',
        type: 'text',
        x: 22,
        y: 30,
        width: 20,
        height: 5,
        binding: 'fixed',
        text: '审核',
        fontSize: 9,
        bold: true,
        align: 'left',
        color: '#111111',
        group: 'g',
      },
      {
        id: 'line',
        type: 'line',
        x: 4,
        y: 38,
        width: 30,
        height: 0,
        strokeWidth: 0.2,
        color: '#444444',
      },
    ],
  });
}
test('group clipboard duplicates geometry/content/bindings with distinct identities and group ownership', () => {
  const source = sample(),
    original = structuredClone(source),
    clip = editing.copy(source, ['a', 'b']);
  const result = editing.paste(source, clip, { x: 5, y: 40 });
  assert.deepEqual(source, original);
  assert.equal(result.template.elements.length, 6);
  const [a, b] = result.template.elements.slice(-2);
  assert.equal(a.x, 5);
  assert.equal(a.y, 40);
  assert.equal(b.x - a.x, 18);
  assert.equal(a.binding, 'code');
  assert.equal(a.text, '编号：');
  assert.notEqual(a.id, 'a');
  assert.notEqual(a.group, 'g');
  assert.equal(a.group, b.group);
  assert.equal(result.template.elements.filter((e) => e.type === 'qr').length, 1);
  clip.elements[0].text = 'changed';
  assert.equal(a.text, '编号：');
});
test('paste stays on paper and copy does not silently omit an included QR', () => {
  const t = sample(),
    clip = editing.copy(t, ['line']);
  const result = editing.paste(t, clip, { x: 100, y: 100 });
  assert.equal(result.template.elements.at(-1).x, 20);
  assert.equal(result.template.elements.at(-1).y, 50);
  assert.throws(() => editing.copy(t, ['qr', 'a']), /二维码/);
  assert.throws(() =>
    editing.paste(t, { version: 1, elements: [{ ...t.elements[1], color: 'javascript:bad' }] }),
  );
});
test('marquee expands groups, selects zero-height lines, respects hidden objects and both drag directions', () => {
  const t = sample();
  assert.deepEqual(editing.marquee(t, { x: 3, y: 29 }, { x: 7, y: 32 }), ['a', 'b']);
  assert.deepEqual(editing.marquee(t, { x: 7, y: 39 }, { x: 3, y: 37 }), ['line']);
  assert.deepEqual(editing.marquee(t, { x: 0, y: 0 }, { x: 50, y: 50 }, ['line']), ['line']);
  assert.deepEqual(editing.marquee(t, { x: NaN, y: 0 }, { x: 1, y: 1 }), []);
});
test('batch style changes preserve bound values, QR geometry and the unselected line', () => {
  const t = sample(),
    styled = editing.format(t, ['qr', 'a', 'b'], { fontSize: 12, bold: true, color: '#0000ff' });
  assert.deepEqual(styled.elements[0], t.elements[0]);
  assert.deepEqual(styled.elements[3], t.elements[3]);
  assert.equal(styled.elements[1].text, '编号：');
  assert.equal(styled.elements[1].fontSize, 12);
  assert.equal(styled.elements[2].fontSize, 12);
  assert.throws(() => editing.format(t, ['a', 'b'], { text: 'will-not-overwrite' }), /只修改/);
});
test('clipboard paste enforces a complete atomic capacity check and rejects identity collisions', () => {
  const t = sample(),
    clip = editing.copy(t, ['a']);
  while (t.elements.length < 30)
    t.elements.push({ ...t.elements[3], id: 'line-' + t.elements.length });
  const before = structuredClone(t);
  assert.throws(() => editing.paste(t, clip), /30/);
  assert.deepEqual(t, before);
  assert.throws(
    () => editing.paste(sample(), editing.copy(sample(), ['a', 'b']), { id: () => 'same' }),
    /冲突/,
  );
});
