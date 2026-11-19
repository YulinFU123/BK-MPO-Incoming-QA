'use strict';
const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto');
function prepareBI(source, target) {
  const uiSource = path.join(source, 'ui');
  fs.mkdirSync(target, { recursive: true });
  const files = [];
  for (const name of fs.readdirSync(uiSource)) {
    const full = path.join(uiSource, name);
    if (!fs.statSync(full).isFile()) continue;
    let bytes = fs.readFileSync(full);
    const originalSHA256 = crypto.createHash('sha256').update(bytes).digest('hex');
    if (name === 'index.html') {
      let html = bytes
        .toString('utf8')
        .replace(/<title>[^<]*<\/title>/, '<title></title>')
        .replaceAll('href="/', 'href="')
        .replaceAll('src="/', 'src="');
      html = html.replace(
        '<script>boot()</script>',
        '<script src="navigation-model.js"></script><script src="selection-controls.js"></script><script src="field-controls.js"></script><script src="chart-surface.js"></script><script src="analysis-insights.js"></script><script src="insight-summary.js"></script><script src="fusion.js"></script>',
      );
      html = html.replace(
        '</head>',
        `<meta http-equiv="Content-Security-Policy" content="default-src 'none';script-src 'self';style-src 'self' 'unsafe-inline';img-src 'self' data: blob:;connect-src 'none';font-src 'self';object-src 'none';base-uri 'none';form-action 'none'">\n<link rel="stylesheet" href="fusion.css"><link rel="stylesheet" href="shared-controls.css"><link rel="stylesheet" href="field-controls.css"><link rel="stylesheet" href="chart-surface.css"><link rel="stylesheet" href="insight-summary.css"></head>`,
      );
      bytes = Buffer.from(html);
    }
    if (name === 'core.js') {
      let code = bytes.toString('utf8');
      const ping =
        "fetch('/api/ping').catch(() => { }); setInterval(() => fetch('/api/ping').catch(() => { }), 4000);";
      const bye =
        "window.addEventListener('pagehide', () => navigator.sendBeacon && navigator.sendBeacon('/api/bye', '{}'));";
      if (!code.includes(ping) || !code.includes(bye))
        throw Error('BI启动片段已变化，需要重新审查。');
      code = code.replace(ping, '').replace(bye, '');
      bytes = Buffer.from(code);
    }
    if (name === 'bi_bridge.js') {
      let code = bytes.toString('utf8');
      code = code.replace(
        "const responses = await Promise.all([fetch('/bi_export_original.js'), fetch('/bi_runner_template.js')]);",
        "const responses = await Promise.all(['/bi_export_original.js','/bi_runner_template.js'].map(async route => { const result=await window.bi.request({route:'/fusion/resource',body:{name:route.slice(1)}});if(!result.ok)throw Error('BI脚本资源读取失败');return{ok:true,text:async()=>result.value};}));",
      );
      bytes = Buffer.from(code);
    }
    if (name === 'pages1.js')
      bytes = Buffer.from(
        bytes
          .toString('utf8')
          .replace(
            '相对路径以本程序所在文件夹为基准',
            '相对路径以当前BI工作副本为基准，原软件目录保持不变',
          ),
      );
    if (name === 'pages3.js') {
      const code = bytes.toString('utf8').replace("'程序文件夹'", "'BI工作副本'");
      // Native close may be refused while a report is being saved. Keep the
      // working page intact until the parent has actually closed the window.
      bytes = Buffer.from(
        code.replace(
          /document\.body\.innerHTML = '<div style="padding:60px;text-align:center;color:#6b7a90">面板已退出，可以关闭此窗口。<\/div>';/,
          '',
        ),
      );
    }
    fs.writeFileSync(path.join(target, name), bytes);
    files.push({
      name,
      originalSHA256,
      packagedSHA256: crypto.createHash('sha256').update(bytes).digest('hex'),
    });
  }
  fs.copyFileSync(path.join(__dirname, '../desktop/bi-fusion.js'), path.join(target, 'fusion.js'));
  for (const name of [
    'shared-controls.css',
    'selection-controls.js',
    'field-controls.css',
    'field-controls.js',
    'chart-surface.css',
    'chart-surface.js',
    'insight-summary.js',
    'insight-summary.css',
  ])
    fs.copyFileSync(path.join(__dirname, '../desktop', name), path.join(target, name));
  fs.copyFileSync(
    path.join(__dirname, '../domain/insights.js'),
    path.join(target, 'analysis-insights.js'),
  );
  fs.copyFileSync(
    path.join(__dirname, '../desktop/app/navigation-model.js'),
    path.join(target, 'navigation-model.js'),
  );
  fs.copyFileSync(
    path.join(__dirname, '../desktop/bi-surface.css'),
    path.join(target, 'fusion.css'),
  );
  fs.writeFileSync(
    path.join(target, 'fusion-manifest.json'),
    JSON.stringify({ source: 'protected BI V10.2', files }, null, 2) + '\n',
  );
  return files;
}
if (require.main === module) {
  prepareBI(path.resolve(process.argv[2]), path.resolve(process.argv[3]));
  process.stdout.write('BI UI handoff prepared\n');
}
module.exports = { prepareBI };
