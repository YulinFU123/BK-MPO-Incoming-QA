'use strict';
// Optional, local-only coverage checklist. The rows describe packaged teaching material,
// never workspace state or business records. Usage: node scripts/audit-guide-pictures.js [out.csv]
const fs = require('node:fs');
const path = require('node:path');
const guides = require('../domain/guides').all;
const pictures = require('../desktop/app/guide-pictures');
const crops = require('../desktop/app/guide-crops');
const rows = [['功能','分组','步骤','本步操作','图像类型','看图核对的位置','引导内容','原图素材','局部预览素材']];
const stats = { guides: guides.length, steps: 0, capture: 0, diagram: 0, detail: 0 }, files = new Set();
for (const g of guides) {
  if (pictures.count(g.id) !== g.steps.length) throw Error('图数不等于步骤数：' + g.id);
  for (const [i, step] of g.steps.entries()) {
    const p = pictures.get(g.id, i), c = crops[g.id + ':' + i];
    if (!p) throw Error('缺少步骤配图：' + g.id + ':' + i);
    for (const name of [p.file, c?.file].filter(Boolean)) {
      if (!fs.existsSync(path.resolve(__dirname, '../desktop/app', name))) throw Error('文件不存在：' + name);
    }
    stats.steps++; stats[p.kind]++; if (c) stats.detail++; files.add(p.file);
    rows.push([g.title, g.group, `${i+1}/${g.steps.length}`, step.title, p.kind === 'capture' ? '示例实拍' : '操作示意（非截图）', p.label, step.body, p.file, c?.file || '']);
  }
}
if (process.argv[2]) {
  const q = cell => '"' + String(cell).replace(/^[=+@-]/, "'$&").replace(/"/g, '""') + '"';
  fs.writeFileSync(process.argv[2], '\uFEFF' + rows.map(row => row.map(q).join(',')).join('\r\n') + '\r\n');
}
console.log(JSON.stringify({ ...stats, distinctOriginals: files.size }));
