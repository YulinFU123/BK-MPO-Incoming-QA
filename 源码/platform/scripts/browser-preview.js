'use strict';
// Development only: actual renderers with synthetic, memory-only record data.
// This loopback preview is not part of the desktop startup or production storage.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { prepareLegacy } = require('./prepare-legacy');
const { prepareBI } = require('./prepare-bi');
const { createWorkspaceController } = require('../desktop/workspace-controller');
const { startBIWorker } = require('../desktop/bi-client');
const { biQualityReport } = require('../adapters/bi/quality-report');
const { dateRange } = require('../domain/validation');
const { createLabelMemory } = require('../desktop/label-memory');

const platform = path.resolve(__dirname, '..');
const source = path.dirname(platform);
const qa = path.resolve(process.env.PLATFORM_QA_ROOT || path.join(source, '../构建/当前作业/测试'));
const directory = path.join(qa, 'browser-preview-' + crypto.randomUUID());
fs.mkdirSync(directory, { recursive: true });
prepareLegacy(source, path.join(directory, 'legacy'));
prepareBI(path.join(source, 'bi'), path.join(directory, 'bi'));
const controller = createWorkspaceController({
  dialogs: {},
  legacyEnabled: true,
  onLocked: () => labelMemory.clearSession(),
  ...(process.env.PLATFORM_PREVIEW_QUALITY === '1'
    ? { demoFactory: require('../fixtures/quality-demo').qualityDemo }
    : {}),
});
const token = crypto.randomBytes(20).toString('hex');
const labelMemory = createLabelMemory({
  controller,
  directory: path.join(directory, 'label-memory'),
  encryption: null,
});
let worker;
let origin;
const allowed = new Set([
  'status',
  'openDemo',
  'lock',
  'catalog',
  'overview',
  'qualityReport',
  'listData',
  'legacyBootstrap',
  'legacySave',
]);
const wrapped = (value) => ({ ok: true, value });

function syncReply(name, input) {
  if (name === 'readLabelMemory') return labelMemory.read();
  if (name === 'saveLabelMemory') return labelMemory.save(input);
  if (!allowed.has(name)) throw Error('浏览器预览只允许示例数据操作。');
  return controller[name](input);
}

async function requestBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 2 * 1024 * 1024) throw Error('预览请求过大。');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

const previewErrors = `window.addEventListener('error',event=>console.error('[UI preview] '+(event.error?.stack||event.message)));`;

const rootBridge = `
'use strict';
${previewErrors}
(() => {
  const call=async(name,input)=>{const r=await fetch('../api/'+name,{method:'POST',headers:{'Content-Type':'application/json','X-QA-Preview':'1'},body:JSON.stringify({input})});return r.json();};
  let theme='silver',legacySection='entry',biSection='daily';
  const appearance=[];const locked=[];const functionSearch=[];
  const frames={};const readiness={};const resolveReady={};const loaded={};const childReady={};
  window.previewFunctionSearch=()=>{for(const callback of functionSearch)callback();};
  function paint(){for(const frame of Object.values(frames)){try{frame.contentWindow.previewTheme?.(theme);}catch{}}}
  function frame(kind,section){
    const mount=document.getElementById(kind==='legacy'?'legacyMount':'biMount');
    if(!frames[kind]){const child=document.createElement('iframe');loaded[kind]=false;childReady[kind]=false;readiness[kind]=new Promise(resolve=>resolveReady[kind]=resolve);child.addEventListener('load',()=>{loaded[kind]=true;if(childReady[kind])resolveReady[kind]?.();});child.title=kind==='legacy'?'异常记录示例':'BI示例';child.src='../'+kind+'/index.html';child.style.cssText='position:absolute;inset:0;width:100%;height:100%;border:0;';mount.replaceChildren(child);mount.style.position='relative';frames[kind]=child;}
    frames[kind].style.display='block';
    frames[kind].contentWindow.previewNavigate?.(section);paint();return {visible:true,section};
  }
  window.previewChildReady=kind=>{childReady[kind]=true;paint();frames[kind]?.contentWindow.previewNavigate?.(kind==='legacy'?legacySection:biSection);if(loaded[kind])resolveReady[kind]?.();};
  window.previewAppearance=value=>{theme=value.theme==='professional'?'silver':value.theme;for(const callback of appearance)callback({...value,theme});paint();};
  window.workbench=new Proxy({
    status:()=>call('status'),openDemo:()=>call('openDemo'),catalog:()=>call('catalog'),overview:input=>call('overview',input),qualityReport:input=>call('qualityReport',input),biQuality:input=>call('biQuality',input),listData:input=>call('listData',input),
    readLabelMemory:()=>call('readLabelMemory'),saveLabelMemory:input=>call('saveLabelMemory',input),
    lock:async()=>{const result=await call('lock');for(const child of Object.values(frames))child.remove();for(const key of Object.keys(frames))delete frames[key];for(const callback of locked)callback();return result;},
    appearance:input=>{theme=input.theme;paint();return Promise.resolve({ok:true,value:{theme}});},
    showLegacy:async input=>{legacySection=input.section;theme=input.theme;const value=frame('legacy',legacySection);await readiness.legacy;return {ok:true,value};},
    legacyAction:async input=>{await readiness.legacy;try{return {ok:true,value:frames.legacy.contentWindow.LegacyCommonActions.activate(frames.legacy.contentDocument,input.action)};}catch(error){return {ok:false,error:{message:error.message}};}},
    showBI:input=>{biSection=input.section;theme=input.theme;return Promise.resolve({ok:true,value:frame('bi',biSection)});},
    hideLegacy:()=>{if(frames.legacy)frames.legacy.style.display='none';return Promise.resolve({ok:true,value:{visible:false}});},
    hideBI:()=>{if(frames.bi)frames.bi.style.display='none';return Promise.resolve({ok:true,value:{visible:false}});},
    onLocked:callback=>{locked.push(callback);return()=>{};},onAppearance:callback=>{appearance.push(callback);return()=>{};},onFunctionSearch:callback=>{functionSearch.push(callback);return()=>{};}
  },{get:(target,name)=>target[name]||(()=>Promise.resolve({ok:false,error:{message:'GPT内置预览仅使用示例内存数据，不执行文件、密码或原生窗口操作。'}}))});
})();`;

const legacyBridge = `
'use strict';
${previewErrors}
(() => {
  const nav=[];
  const call=async(name,input)=>{const r=await fetch('../api/'+name,{method:'POST',headers:{'Content-Type':'application/json','X-QA-Preview':'1'},body:JSON.stringify({input})});return r.json();};
  window.previewNavigate=section=>{for(const callback of nav)callback(section);};
  window.previewTheme=theme=>{document.documentElement.dataset.fusionTheme=theme;window.Appearance?.syncTheme(theme==='silver'?'professional':theme);};
  document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();parent.previewFunctionSearch?.();}},true);
  window.desktop={
    bootstrap:defaults=>call('legacyBootstrap',defaults),status:async()=>({ok:true,value:{exists:true}}),
    save:data=>{const request=new XMLHttpRequest();request.open('POST','../api/legacySave',false);request.setRequestHeader('Content-Type','application/json');request.setRequestHeader('X-QA-Preview','1');request.send(JSON.stringify({input:data}));return JSON.parse(request.responseText);},
    onNavigate:callback=>nav.push(callback),ready:()=>parent.previewChildReady('legacy'),onFlush:()=>{},flushReady:()=>{},
    onLockRequested:()=>{},onCloseRequested:()=>{},onWindowChanged:()=>{},closeReady:()=>{},activity:()=>{},setTimeout:()=>{},
    appearanceChanged:value=>parent.previewAppearance(value),
    windowState:async()=>({ok:true,value:{maximized:false}}),windowMode:async()=>({ok:true,value:{maximized:false}}),
    lock:()=>({ok:false,error:'请使用预览外层的锁定按钮。'}),backup:()=>({ok:false,error:'预览仅含示例数据。'})
  };
})();`;

const biBridge = `
'use strict';
${previewErrors}
(() => {
  let current='daily';const listeners=[];
  window.previewNavigate=section=>{current=section;for(const callback of listeners)callback(section);};
  window.previewTheme=theme=>{document.documentElement.dataset.fusionTheme=theme;};
  document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();parent.previewFunctionSearch?.();}},true);
  window.bi={request:async input=>{const response=await fetch('../bi-api',{method:'POST',headers:{'Content-Type':'application/json','X-QA-Preview':'1'},body:JSON.stringify(input)});return response.json();},
    onNavigate:callback=>{listeners.push(callback);callback(current);},onFlush:()=>{},flushReady:()=>{},activity:()=>{}};
  window.addEventListener('load',()=>parent.previewChildReady('bi'));
})();`;

function rewriteHTML(html, kind) {
  if (kind === 'app')
    html = html
      .replaceAll('../shared-controls.css', '../desktop/shared-controls.css')
      .replaceAll('../selection-controls.js', '../desktop/selection-controls.js')
      .replaceAll('../field-controls.css', '../desktop/field-controls.css')
      .replaceAll('../field-controls.js', '../desktop/field-controls.js')
      .replaceAll('../chart-surface.css', '../desktop/chart-surface.css')
      .replaceAll('../chart-surface.js', '../desktop/chart-surface.js')
      .replaceAll('../insight-summary.js', '../desktop/insight-summary.js')
      .replaceAll('../insight-summary.css', '../desktop/insight-summary.css');
  if (kind === 'app')
    html = html
      .replaceAll('../../vendor/', '../vendor/')
      .replaceAll('../../domain/', '../domain/')
      .replaceAll('../label-render.js', '../desktop/label-render.js');
  html = html.replace(/<meta\s+http-equiv="Content-Security-Policy"[^>]*>/gi, '');
  // The actual desktop CSP remains unchanged. Preview permits its local bridges.
  const csp = `default-src 'self';script-src 'self';style-src 'self' 'unsafe-inline';img-src 'self' data: blob:;font-src 'self';connect-src 'self';frame-src 'self';object-src 'none';base-uri 'none'`;
  html = html.replace(
    '</head>',
    `<meta http-equiv="Content-Security-Policy" content="${csp}"><script src="../preview-${kind}.js"></script></head>`,
  );
  if (kind === 'legacy')
    html = html
      .replace(
        '</head>',
        '<link rel="stylesheet" href="../desktop/legacy-surface.css"><link rel="stylesheet" href="../desktop/shared-controls.css"><link rel="stylesheet" href="../desktop/field-controls.css"><link rel="stylesheet" href="../desktop/chart-surface.css"><link rel="stylesheet" href="../desktop/insight-summary.css"></head>',
      )
      .replace(
        '</body>',
        '<script src="../desktop/selection-controls.js"></script><script src="../desktop/legacy-common-actions.js"></script><script src="../desktop/field-controls.js"></script><script src="../desktop/chart-surface.js"></script><script src="../domain/insights.js"></script><script src="../desktop/insight-summary.js"></script><script src="../desktop/legacy-charts.js"></script><script src="../desktop/legacy-surface.js"></script></body>',
      );
  return html;
}

const server = http.createServer(async (request, response) => {
  const send = (status, type, body) => {
    response.writeHead(status, {
      'Content-Type': type,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(body);
  };
  try {
    if (
      request.headers.host !== new URL(origin).host ||
      (request.headers.origin && request.headers.origin !== origin)
    )
      return send(403, 'text/plain', 'preview origin required');
    const relative = decodeURIComponent(new URL(request.url, origin).pathname);
    if (!relative.startsWith('/' + token + '/')) return send(404, 'text/plain', 'not found');
    const route = relative.slice(token.length + 2);
    if (request.method === 'POST') {
      if (request.headers['x-qa-preview'] !== '1')
        return send(403, 'text/plain', 'preview header required');
      const input = await requestBody(request);
      let value;
      if (route === 'api/biQuality') {
        if (!controller.status().unlocked) throw Error('先打开示例工作区。');
        const sessionId = controller.hostContext().sessionId;
        const { start, end } = input.input;
        dateRange(start, end);
        if (!worker) {
          if (!process.env.PLATFORM_PYTHON) throw Error('预览缺少已验证的随包Python路径。');
          worker = startBIWorker({
            python: process.env.PLATFORM_PYTHON,
            script: path.join(platform, 'desktop/bi-worker.py'),
            source: path.join(source, 'bi'),
            data: path.join(directory, 'bi-data'),
          });
        }
        await worker.ready;
        const biState = await worker.request({ route: '/api/state' });
        const result = await worker.request({
          route: '/api/analytics',
          body: {
            config: biState.config,
            query: { start, end, period: 'day', dimension: 'process', top: 5 },
          },
        });
        if (controller.hostContext().sessionId !== sessionId) throw Error('示例工作区已变化。');
        value = biQualityReport(result, { start, end });
      } else if (route.startsWith('api/')) value = await syncReply(route.slice(4), input.input);
      else if (route === 'bi-api') {
        if (!controller.status().unlocked) throw Error('先打开示例工作区。');
        if (
          typeof input.route !== 'string' ||
          Object.keys(input).some((key) => !['route', 'body'].includes(key))
        )
          throw Error('预览仅接受业务路由，禁止内部控制消息。');
        if (/\/api\/(?:exit|open|pick|folder|bi\/start)/.test(input.route || ''))
          throw Error('此操作需要Windows实机验收，预览不会执行。');
        if (!worker) {
          if (!process.env.PLATFORM_PYTHON) throw Error('预览缺少已验证的随包Python路径。');
          worker = startBIWorker({
            python: process.env.PLATFORM_PYTHON,
            script: path.join(platform, 'desktop/bi-worker.py'),
            source: path.join(source, 'bi'),
            data: path.join(directory, 'bi-data'),
          });
        }
        await worker.ready;
        value = await worker.request({
          route: input.route,
          ...(input.body === undefined ? {} : { body: input.body }),
        });
      } else return send(404, 'text/plain', 'not found');
      return send(200, 'application/json; charset=utf-8', JSON.stringify(wrapped(value)));
    }
    if (request.method !== 'GET') return send(405, 'text/plain', 'method not allowed');
    const bridges = {
      'preview-app.js': rootBridge,
      'preview-legacy.js': legacyBridge,
      'preview-bi.js': biBridge,
    };
    if (Object.hasOwn(bridges, route))
      return send(200, 'text/javascript; charset=utf-8', bridges[route]);
    const [kind, ...parts] = route.split('/');
    const roots = {
      app: path.join(platform, 'desktop/app'),
      desktop: path.join(platform, 'desktop'),
      domain: path.join(platform, 'domain'),
      vendor: path.join(platform, 'vendor'),
      legacy: path.join(directory, 'legacy'),
      bi: path.join(directory, 'bi'),
      checks: path.join(platform, 'tests/browser'),
    };
    if (!Object.hasOwn(roots, kind)) return send(404, 'text/plain', 'not found');
    let file = path.resolve(roots[kind], parts.join('/') || 'index.html');
    if (file !== roots[kind] && !file.startsWith(roots[kind] + path.sep))
      return send(403, 'text/plain', 'not allowed');
    if (!['.html', '.css', '.js', '.png', '.ico', '.svg'].includes(path.extname(file)))
      return send(404, 'text/plain', 'not found');
    // App links to ../shared-controls.css and ../selection-controls.js.
    let bytes = fs.readFileSync(file);
    if (path.extname(file) === '.html' && kind !== 'checks')
      bytes = Buffer.from(rewriteHTML(bytes.toString('utf8'), kind));
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.png': 'image/png',
      '.ico': 'image/x-icon',
      '.svg': 'image/svg+xml',
    };
    send(200, types[path.extname(file)], bytes);
  } catch (error) {
    send(
      400,
      'application/json; charset=utf-8',
      JSON.stringify({ ok: false, error: { message: error.message } }),
    );
  }
});
server.listen(0, '127.0.0.1', () => {
  origin = `http://127.0.0.1:${server.address().port}`;
  const result = {
    url: `${origin}/${token}/app/index.html`,
    source: platform,
    data: 'explicit-synthetic-demo',
    directory,
  };
  fs.writeFileSync(path.join(qa, 'browser-preview.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
});
async function close() {
  await worker?.close();
  await controller.lock();
  server.close();
}
process.on('SIGINT', () => close().finally(() => process.exit(0)));
process.on('SIGTERM', () => close().finally(() => process.exit(0)));
