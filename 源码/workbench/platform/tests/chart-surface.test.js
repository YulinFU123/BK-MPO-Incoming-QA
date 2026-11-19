'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const chart = require('../desktop/chart-surface');

test('quantity scale keeps integer ticks, includes zero, and bounds every finite original value', () => {
  for (const values of [[0, 0], [1], [3, 9], [8, 10], [9999, 120000], [-3, 5]]) {
    const scale = chart.scale(values, true);
    assert.ok(scale.ticks.every(Number.isInteger));
    assert.ok(scale.ticks.every(Number.isFinite));
    assert.ok(scale.min <= Math.min(0, ...values));
    assert.ok(scale.max >= Math.max(...values));
    assert.ok(scale.max > scale.min);
    assert.ok(scale.ticks.length <= 8);
  }
});
test('chart formatting keeps missing distinct from zero and formats rates once as percentages', () => {
  assert.equal(chart.format(null), '缺少数据');
  assert.equal(chart.format(undefined), '缺少数据');
  assert.equal(chart.format(NaN), '缺少数据');
  assert.equal(chart.format(0), '0');
  assert.equal(chart.format(0.0267, true), '2.67%');
  assert.equal(chart.format(0.00001, true), '0.001%');
  assert.equal(chart.format(1, true), '100%');
  const domain = chart.scale([0, 0.0267]);
  assert.ok(domain.max >= 0.0267 && domain.max < 0.1);
});
test('dense charts allocate room for every original point and reject mismatched periods', () => {
  const labels = Array.from({ length: 121 }, (_, i) => String(i));
  const series = [{ name: '构造检验数', values: labels.map((_, i) => (i % 7 ? 12345678 : null)) }];
  const copy = structuredClone(series);
  const geometry = chart.layout(labels, series);
  assert.ok(geometry.width >= 120 * geometry.gap);
  assert.ok(geometry.gap > 70);
  assert.deepEqual(series, copy);
  assert.throws(() => chart.layout(labels, [{ values: [1] }]), /长度不一致/);
});

test('reference home compact charts reduce height while preserving full point width and the original default', () => {
  const labels = ['10-01', '10-02', '10-03'];
  const series = [{ values: [1, 2, 1] }];
  const normal = chart.layout(labels, series),
    compact = chart.layout(labels, series, { compact: true });
  assert.equal(normal.height, 320);
  assert.equal(compact.height, 200);
  assert.ok(compact.width <= normal.width);
  assert.deepEqual(normal.domain, compact.domain);
  assert.ok(compact.height - compact.top - compact.bottom > 100);
});
test('logo assets contain complete PNG and seven independently sized ICO frames without external references', () => {
  const directory = path.join(__dirname, '../desktop/app/assets');
  const svg = fs.readFileSync(path.join(directory, 'logo.svg'), 'utf8');
  assert.doesNotMatch(svg, /https?:\/\/(?!www\.w3\.org)|<script|<foreignObject|href=/i);
  const png = fs.readFileSync(path.join(directory, 'logo.png'));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), 256);
  const ico = fs.readFileSync(path.join(directory, 'logo.ico'));
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 7);
  [16, 24, 32, 48, 64, 128, 256].forEach((size, i) => {
    const at = 6 + i * 16,
      length = ico.readUInt32LE(at + 8),
      offset = ico.readUInt32LE(at + 12);
    assert.equal(ico[at] || 256, size);
    assert.equal(ico.subarray(offset + 1, offset + 4).toString(), 'PNG');
    assert.equal(ico.readUInt32BE(offset + 16), size);
    assert.ok(offset + length <= ico.length);
  });
});
