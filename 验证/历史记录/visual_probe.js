const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),app=path.join(root,'构建','异常记录台_4.1.1_Windows_x64','异常记录台.exe');
const runId=Date.now(),profile=path.join(__dirname,'desktop-qa-'+runId),downloadDir=path.join(profile,'downloads');fs.mkdirSync(downloadDir,{recursive:true});
const pause=ms=>new Promise(r=>setTimeout(r,ms));let child,ws,send,errors=[];
const p1='Quality-QA-password-1',p2='Quality-QA-password-2';
async function connect(){
child=spawn(app,['--quality-qa','--qa-data='+profile,'--qa-idle-ms=4500','--remote-debugging-port=9292'],{stdio:['ignore','ignore','pipe'],windowsHide:true});
let stderr='';child.stderr.on('data',b=>stderr+=b.toString());
let page;for(let i=0;i<150;i++){try{const pages=await(await fetch('http://127.0.0.1:9292/json/list')).json();page=pages.find(p=>p.type==='page'&&p.url.includes('index.html'));if(page)break}catch{}await pause(100)}if(!page)throw Error('Desktop startup failed '+stderr);
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
await connect();
await run(`document.querySelector('#authPassword').value=${JSON.stringify(p1)};document.querySelector('#authConfirm').value=${JSON.stringify(p1)};document.querySelector('#authForm').requestSubmit()`);
await waitFor(`document.querySelector('#authGate')?.hidden`);
await send('DOM.enable');await send('CSS.enable');const doc=await send('DOM.getDocument');
for(const selector of ['.field label','#field_sn','.nav-item span']) {const n=await send('DOM.querySelector',{nodeId:doc.root.nodeId,selector});console.log(selector,JSON.stringify(await send('CSS.getPlatformFontsForNode',{nodeId:n.nodeId})));}
console.log('ICONS',await run(`({all:document.querySelectorAll('.ui-symbol').length,save:document.querySelector('#saveRecord .ui-symbol')!==null,brand:document.querySelector('.side-brand .part-mark').textContent})`));
await screenshot('新版界面4.1.1.png');await run(`window.desktop.closeReady()`);ws.close();
})().catch(e=>{console.error(e);if(ws)ws.close();if(child)child.kill();process.exitCode=1});