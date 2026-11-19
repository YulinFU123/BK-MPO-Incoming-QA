const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const root="D:\\\u9879\u76ee\\BK_MPO\u6765\u6599\u5f02\u5e38\u8ddf\u8fdb",app="D:\\\u9879\u76ee\\BK_MPO\u6765\u6599\u5f02\u5e38\u8ddf\u8fdb\\\u9a8c\u8bc1\\\u57fa\u7ebf\u5ba1\u8ba1_4.2.0\\\u8fd0\u884c\u526f\u672c\\\u5f02\u5e38\u8bb0\u5f55\u53f0_4.2.0_Windows_x64\\\u5f02\u5e38\u8bb0\u5f55\u53f0.exe";
const runId=Date.now(),profile=path.join(__dirname,'desktop-qa-'+runId),downloadDir=path.join(profile,'downloads');fs.mkdirSync(downloadDir,{recursive:true});
const pause=ms=>new Promise(r=>setTimeout(r,ms));let child,ws,send,errors=[];
const p1='Quality-QA-password-1',p2='Quality-QA-password-2';
async function connect(){
const server=require('node:net').createServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});const debugPort=server.address().port;await new Promise(resolve=>server.close(resolve));
child=spawn(app,['--quality-qa','--qa-data='+profile,'--qa-idle-ms=600000','--remote-debugging-port='+debugPort],{stdio:['ignore','ignore','pipe'],windowsHide:true});
let stderr='';child.stderr.on('data',b=>stderr+=b.toString());
let page;for(let i=0;i<150;i++){try{const pages=await(await fetch('http://127.0.0.1:'+debugPort+'/json/list')).json();page=pages.find(p=>p.type==='page'&&p.url.includes('index.html'));if(page)break}catch{}await pause(100)}if(!page)throw Error('Desktop startup failed '+stderr);
ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((ok,no)=>{ws.onopen=ok;ws.onerror=no});let id=0;const waiting=new Map();
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text+' '+(m.params.exceptionDetails.exception?.description||''));if(!m.id)return;const q=waiting.get(m.id);if(!q)return;waiting.delete(m.id);m.error?q.reject(Error(m.error.message)):q.resolve(m.result)};
send=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;const timer=setTimeout(()=>{waiting.delete(key);reject(Error('CDP timeout: '+method))},15000);waiting.set(key,{resolve:value=>{clearTimeout(timer);resolve(value)},reject:error=>{clearTimeout(timer);reject(error)}});ws.send(JSON.stringify({id:key,method,params}))});
await send('Runtime.enable');await send('Network.enable');await send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});await send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloadDir});
await waitFor(`document.querySelector('#authSubmit')&&!document.querySelector('#authSubmit').disabled&&document.querySelector('#authTitle')?.textContent!=='打开工作台'`);
}
async function run(expression,ping=true){if(ping)await send('Runtime.evaluate',{expression:'window.desktop?.activity()'});const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value}
async function waitFor(expression){for(let i=0;i<100;i++){if(await run(expression))return;await pause(80)}throw Error('Timeout: '+expression)}
function check(name,value){assert(value,name);console.log('PASS '+name)}
async function screenshot(name){const r=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(__dirname,name),Buffer.from(r.data,'base64'))}
async function unlock(pass){await run(`document.querySelector('#authPassword').value=${JSON.stringify(pass)};document.querySelector('#authForm').requestSubmit()`);await waitFor(`document.querySelector('#authGate')?.hidden`)}
async function setFile(selector,file){const doc=await send('DOM.getDocument');const n=await send('DOM.querySelector',{nodeId:doc.root.nodeId,selector});await send('DOM.setFileInputFiles',{files:[file],nodeId:n.nodeId})}
async function promptPassword(pass){await waitFor(`document.querySelector('#textPrompt').open`);await run(`document.querySelector('#promptValue').value=${JSON.stringify(pass)};document.querySelector('#textPrompt').close('ok')`)}
(async()=>{
const evidence={mode:'isolated QA EXE; synthetic data only',cases:[],runtime:{},performance:{},layouts:[]};
const add=(name,pass,actual)=>evidence.cases.push({name,status:pass?'PASS':'FAIL',actual});
await connect(); evidence.runtime=await send('Browser.getVersion');
await run(`document.querySelector('#authPassword').value=${JSON.stringify(p1)};document.querySelector('#authConfirm').value=${JSON.stringify(p1)};document.querySelector('#authForm').requestSubmit()`);
await waitFor(`document.querySelector('#authGate')?.hidden`);
evidence.runtime.viewport=await run(`({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,screenWidth:screen.width,screenHeight:screen.height})`);
await run(`document.querySelector('#field_sn').value='AUDIT-SN-01';document.querySelector('#field_issue').value='审计专用测试';document.querySelector('#field_silk').value='0007';document.querySelector('#saveRecord').focus()`);
await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
const keyboard=await run(`({count:document.querySelector('#allCount').textContent,focus:document.activeElement.id,status:document.querySelector('#saveStatus').textContent})`);
add('Enter activates focused Save button',keyboard.count==='1',keyboard);
if(keyboard.count!=='1') await run(`document.querySelector('#saveRecord').click()`);
await run(`window.__auditComboClick=false;const b=document.querySelector('#field_area').parentElement.querySelector('.combo-toggle');b.addEventListener('click',()=>window.__auditComboClick=true,{once:true});b.focus()`);
await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
add('Enter activates focused dropdown button',await run(`window.__auditComboClick`),await run(`({focus:document.activeElement.id,expanded:document.querySelector('#field_area').getAttribute('aria-expanded')})`));
const color=await run(`(()=>{const style=getComputedStyle(document.querySelector('#saveRecord'));return {foreground:style.color,background:style.backgroundColor,fontSize:style.fontSize,fontWeight:style.fontWeight}})()`);
function lum(color){const c=color.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return .2126*c[0]+.7152*c[1]+.0722*c[2]}
const l=[lum(color.foreground),lum(color.background)].sort((a,b)=>a-b);color.contrast=(l[1]+.05)/(l[0]+.05);add('Primary button normal text contrast >=4.5',color.contrast>=4.5,color);
await screenshot('audit-entry.png');
for(const [width,height,dpr] of [[1440,960,1],[1024,720,1],[1280,720,1.5],[960,540,2]]) {
  await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:dpr,mobile:false});
  for(const view of ['entry','records','analysis','followup']) {
    await run(`document.querySelector('[data-nav="${view}"]').click()`);
    const metrics=await run(`({viewport:innerWidth,page:document.documentElement.scrollWidth,body:document.body.scrollWidth,active:document.activeElement.id})`);
    evidence.layouts.push({view,width,height,dpr,...metrics,rootFits:metrics.page<=width});
    if(width===1024||width===960)await screenshot(`audit-${view}-${width}-${dpr}.png`);
  }
  await run(`document.querySelector('#openSettings').click()`);
  const settings=await run(`(()=>{const d=document.querySelector('#settingsDialog'),r=d.getBoundingClientRect(),b=d.querySelector('.modal-body');return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,scrollWidth:b.scrollWidth,clientWidth:b.clientWidth}})()`);
  evidence.layouts.push({view:'settings',width,height,dpr,...settings,rootFits:settings.left>=0&&settings.right<=width&&settings.bottom<=height,bodyFits:settings.scrollWidth<=settings.clientWidth});
  if(width===960) await screenshot('audit-settings-960-2.png');
  await run(`document.querySelector('#closeSettings').click()`);
}
await send('Emulation.clearDeviceMetricsOverride');
await run(`document.querySelector('[data-nav="records"]').click();document.querySelector('#search').value='绝对无匹配';document.querySelector('#search').dispatchEvent(new Event('input'))`);
add('No search results provides visible empty state',await run(`!document.querySelector('#emptyState').hidden`),await run(`document.querySelector('#emptyState').textContent`));
await screenshot('audit-empty-search.png');
await run(`document.querySelector('#search').value='';document.querySelector('#search').dispatchEvent(new Event('input'));document.querySelector('#dataTable tbody .icon-btn').click()`);
await screenshot('audit-workflow.png');await run(`document.querySelector('#workflowCancel').click()`);
await run(`document.querySelector('#openSecurity').click()`);await screenshot('audit-security.png');await run(`document.querySelector('#closeSecurity').click()`);
await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'dark'}]});
evidence.darkMode=await run(`({requested:matchMedia('(prefers-color-scheme:dark)').matches,panel:getComputedStyle(document.querySelector('.panel')).backgroundColor,scheme:document.querySelector('meta[name="color-scheme"]').content})`);
await screenshot('audit-dark-request.png');
await send('Emulation.setEmulatedMedia',{features:[{name:'forced-colors',value:'active'}]});
await screenshot('audit-high-contrast-emulation.png');
evidence.forcedColors=await run(`({requested:matchMedia('(forced-colors:active)').matches,glass:getComputedStyle(document.querySelector('.sidebar')).backdropFilter})`);
await send('Emulation.setEmulatedMedia',{features:[]});
// Controlled workload. No private business records are accessed.
const data=(await run(`window.desktop.unlock(${JSON.stringify(p1)})`)).value;
const date=await run(`document.querySelector('#field_found_date').value`);
data.records=Array.from({length:1000},(_,i)=>({id:'AUDIT-'+i,templateId:data.activeTemplateId,createdAt:new Date().toISOString(),createdLocalDate:date,values:{no:String(i+1),found_date:date,sn:'AUDIT-'+i,area:'BK5F',process:'组装',model:'MODEL',lot:'TEST-LOT',issue:i===0?'长文本与字符审计： <>& " 引号\n第二行 '+('中文'.repeat(250)):'审计专用测试',silk:String(i).padStart(4,'0'),color:'黑色',oven:'TEST'}}));
delete data.pendingUI;
const fixturePath=path.join(profile,'audit-1000.json');fs.writeFileSync(fixturePath,JSON.stringify({data}));
await run(`window.confirm=()=>true;document.querySelector('#openSettings').click()`);
const importStart=Date.now();await setFile('#backupFile',fixturePath);await waitFor(`document.querySelector('#allCount').textContent==='1000'&&!document.querySelector('#settingsDialog').open`);
evidence.performance.restoreAndRender1000ms=Date.now()-importStart;
evidence.performance.save1000=await run(`(()=>{const start=performance.now();const result=window.desktop.save(${JSON.stringify(data)});return {ms:performance.now()-start,ok:result.ok}})()`);
await send('Page.reload');await waitFor(`document.querySelector('#authSubmit')&&!document.querySelector('#authSubmit').disabled`);
const started=Date.now();await unlock(p1);evidence.performance.unlockAndRender1000ms=Date.now()-started;
await run(`document.querySelector('[data-nav="records"]').click()`);
evidence.performance.grid=await run(`({rows:document.querySelectorAll('#dataTable tbody tr').length,cells:document.querySelectorAll('#dataTable tbody td').length,focusStops:document.querySelector('#dataTable').querySelectorAll('button,[tabindex="0"]').length,totalNodes:document.getElementsByTagName('*').length})`);
evidence.performance.search=await run(`(()=>{const a=[];for(const text of ['AUDIT-9','AUDIT-99','']){const s=performance.now();document.querySelector('#search').value=text;document.querySelector('#search').dispatchEvent(new Event('input'));a.push({query:text,ms:performance.now()-s,rows:document.querySelectorAll('#dataTable tbody tr').length})}return a})()`);
await screenshot('audit-records-1000.png');
evidence.performance.sort=await run(`(()=>{const s=performance.now();document.querySelector('#dataTable th .column-sort').click();return {ms:performance.now()-s,rows:document.querySelectorAll('#dataTable tbody tr').length}})()`);
await run(`document.querySelector('#search').value='AUDIT-0';document.querySelector('#search').dispatchEvent(new Event('input'))`);
add('Special characters and long Chinese text survive save and reload',await run(`document.querySelector('#dataTable tbody').textContent.includes('长文本与字符审计： <>& " 引号')`),await run(`document.querySelector('#dataTable tbody').textContent.length`));
await screenshot('audit-long-text.png');
const oldProcess=child;await run(`window.desktop.closeReady()`);ws.close();
if(oldProcess.exitCode===null)await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Close timeout')),5000);oldProcess.once('exit',()=>{clearTimeout(timer);resolve()})});
await connect();await unlock(p1);
const restartCount=await run(`document.querySelector('#allCount').textContent`);
add('Actual process close and restart restores 1000 audit records',restartCount==='1000',{count:restartCount,newPid:child.pid});
evidence.rendererErrors=errors;
fs.writeFileSync(path.join(__dirname,'ui-audit.json'),JSON.stringify(evidence,null,2));
console.log(JSON.stringify(evidence,null,2));
await run(`window.desktop.closeReady()`);ws.close();
})().catch(e=>{console.error(e);if(ws)ws.close();if(child)child.kill();process.exitCode=1});
