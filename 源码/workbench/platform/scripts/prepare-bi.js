'use strict';
const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto');
function prepareBI(source, target) {
  const uiSource = path.join(source, 'ui');
  fs.mkdirSync(target, { recursive: true });
  const files = [];
  const retired = ['bi_export_original.js', 'bi_runner_template.js', 'bi-filter-script.js', 'bi-filter-ui.js', 'bi-filter-model.js'];
  for (const name of retired) fs.rmSync(path.join(target, name), { force: true });
  for (const name of fs.readdirSync(uiSource)) {
    if (retired.includes(name)) continue;
    const full = path.join(uiSource, name);
    if (!fs.statSync(full).isFile()) continue;
    let bytes = fs.readFileSync(full);
    const originalSHA256 = crypto.createHash('sha256').update(bytes).digest('hex');
    if (name === 'index.html') {
      let html = bytes
        .toString('utf8')
        .replace(/<title>[^<]*<\/title>/, '<title></title>')
        .replace('<html', '<html data-theme-surface="bi"')
        .replaceAll('href="/', 'href="')
        .replaceAll('src="/', 'src="');
      html = html.replace(
        '<script>boot()</script>',
        '<script src="bi-workflow-model.js"></script><script src="navigation-model.js"></script><script src="selection-controls.js"></script><script src="field-controls.js"></script><script src="chart-surface.js"></script><script src="analysis-insights.js"></script><script src="insight-summary.js"></script><script src="fusion.js"></script><script src="bi-inbox-ui.js"></script><script src="defect-selection.js"></script><script src="bi-defect-ui.js"></script><script src="bi-workflow-ui.js"></script>',
      );
      html = html.replace(
        '</head>',
        `<meta http-equiv="Content-Security-Policy" content="default-src 'none';script-src 'self';style-src 'self' 'unsafe-inline';img-src 'self' data: blob:;connect-src 'none';font-src 'self';object-src 'none';base-uri 'none';form-action 'none'">\n<link rel="stylesheet" href="bi-filter.css"><link rel="stylesheet" href="fusion.css"><link rel="stylesheet" href="shared-controls.css"><link rel="stylesheet" href="field-controls.css"><link rel="stylesheet" href="chart-surface.css"><link rel="stylesheet" href="insight-summary.css"><link rel="stylesheet" href="theme-surfaces.css"><link rel="stylesheet" href="bi-workflow.css"><script src="theme-contract.js" defer></script><script src="theme-runtime.js" defer></script></head>`,
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
    if (name === 'bi_bridge.js') bytes = fs.readFileSync(path.join(__dirname, '../desktop/bi-receipt-section.js'));
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
  fs.copyFileSync(
    path.join(__dirname, '../domain/defect-selection.js'),
    path.join(target, 'defect-selection.js'),
  );
  fs.copyFileSync(
    path.join(__dirname, '../domain/bi-workflow.js'),
    path.join(target, 'bi-workflow-model.js'),
  );
  for (const name of [
    'bi-workflow-ui.js',
    'bi-workflow.css',
    'bi-inbox-ui.js',
    'theme-contract.js',
    'theme-runtime.js',
    'theme-surfaces.css',
    'bi-defect-ui.js',
    'bi-filter.css',
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
