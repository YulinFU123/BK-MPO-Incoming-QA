/* Run once in Console on the logged-in NC Details page.
   Requests one summarized XLSX export with current filters.
   No credentials, cookies, network interception, or security bypass.
   Browser download completion cannot be verified by this script. */
(async()=>{
 if(window.PBI_EXPORT_TEST_RUNNING){console.warn('已有导出测试在运行');return;}
 window.PBI_EXPORT_TEST_RUNNING=true;
 const log={startedAt:new Date().toISOString(),steps:[],status:'started',downloadVerified:false};
 window.PBI_EXPORT_TEST_RESULT=log;
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 const text=e=>(e.innerText||e.textContent||'').trim().replace(/\s+/g,' ');
 const visible=e=>{const r=e.getBoundingClientRect(),w=e.ownerDocument.defaultView;return r.width>0&&r.height>0&&w.getComputedStyle(e).visibility!=='hidden'&&w.getComputedStyle(e).display!=='none';};
 const note=(step,detail)=>{log.steps.push({step,detail,time:new Date().toISOString()});console.log('[导出测试]',step,detail||'');};
 const docs=[];
 function walk(d){if(docs.includes(d))return;docs.push(d);for(const f of d.querySelectorAll('iframe')){try{if(f.contentDocument)walk(f.contentDocument);}catch(_){}}}
 walk(document);
 const all=(sel,root)=>root?[...root.querySelectorAll(sel)]:docs.flatMap(d=>[...d.querySelectorAll(sel)]);
 const enabled=e=>!e.disabled&&e.getAttribute('aria-disabled')!=='true'&&!e.closest('[aria-disabled="true"]');
 function unique(es,label){es=[...new Set(es)].filter(visible);if(es.length!==1)throw Error(label+'：找到 '+es.length+' 个候选，已停止以免误点');return es[0];}
 async function wait(fn,label){for(let i=0;i<40;i++){const x=fn();if(x)return x;await pause(250);}throw Error(label+'未出现');}
 function clickable(e){return e.closest('button,[role="button"],[role="menuitem"],label,[role="radio"]')||e;}
 function exact(root,label){return all('button,[role="button"],[role="menuitem"],span,label,div',root).filter(e=>visible(e)&&text(e)===label).sort((a,b)=>a.querySelectorAll('*').length-b.querySelectorAll('*').length);}
 function clickLabel(root,label){const es=exact(root,label);if(!es.length)throw Error('未找到 '+label);const targets=[...new Set(es.map(clickable))].filter(enabled);unique(targets,label).click();}
 try{
  if(window.PBI_SCAN_RUNNING)throw Error('筛选采集仍在运行，请先停止采集');
  const candidates=all('.visual-container,.visualContainer').filter(e=>visible(e)&&/Serial Number|SERIAL_NUMBER/.test(text(e))&&/Failure Code|FAIL_CODE/.test(text(e)));
  const leaves=candidates.filter(e=>!candidates.some(x=>x!==e&&e.contains(x)));
  const v=unique(leaves,'NC Details 明细表');note('找到明细表');
  const w=v.ownerDocument.defaultView,r=v.getBoundingClientRect();
  for(const name of ['pointerover','pointerenter','mouseover','mouseenter','mousemove']){
   const C=name.startsWith('pointer')?w.PointerEvent:w.MouseEvent;
   v.dispatchEvent(new C(name,{bubbles:true,clientX:r.right-30,clientY:r.top+10,pointerType:'mouse'}));
  }
  await pause(600);
  const more=await wait(()=>{
   const es=all('button,[role="button"],.visualHeaderItem',v).filter(e=>visible(e)&&enabled(e)&&/更多选项|更多操作|More options|More actions/i.test([e.getAttribute('aria-label'),e.getAttribute('title'),e.getAttribute('data-testid')].filter(Boolean).join(' ')));
   return es.length?unique(es,'明细表更多选项'):null;
  },'更多选项按钮（可手动将鼠标移到明细表右上角）');
  more.click();note('点击更多选项');
  const menu=await wait(()=>{const es=exact(null,'导出数据').concat(exact(null,'Export data'));return es.length?unique([...new Set(es.map(clickable))].filter(enabled),'导出数据菜单'):null;},'导出数据菜单');
  menu.click();note('点击导出数据');
  const dialog=await wait(()=>{
   const es=all('[role="dialog"],mat-dialog-container,.cdk-dialog-container').filter(e=>visible(e)&&/想要导出哪些数据|Which data|What data/i.test(text(e)));
   return es.length?unique(es.filter(e=>!es.some(x=>x!==e&&e.contains(x))),'导出窗口'):null;
  },'导出窗口');
  note('找到导出窗口');
  const summary=exact(dialog,'汇总数据').concat(exact(dialog,'Summarized data'));
  if(!summary.length)throw Error('未找到汇总数据选项');
  let e=summary[0],card=null;
  while(e&&e!==dialog){if(e.matches('[role="radio"],label')||e.querySelector('input[type="radio"],[role="radio"]')){card=e;break;}e=e.parentElement;}
  if(!card)throw Error('无法可靠定位汇总数据单选控件');
  const radio=card.matches('[role="radio"]')?card:card.querySelector('input[type="radio"],[role="radio"]');
  if(!radio||!enabled(radio))throw Error('汇总数据选项不可用');
  if(!(radio.checked||radio.getAttribute('aria-checked')==='true')){if(visible(radio))radio.click();else card.click();await pause(400);}
  if(!(radio.checked||radio.getAttribute('aria-checked')==='true'))throw Error('未确认汇总数据已选中，停止');
  note('确认汇总数据已选中');
  const selects=all('select',dialog).filter(visible);
  let formatConfirmed=false;
  for(const select of selects){const opts=[...select.options].filter(o=>/\.xlsx\b/i.test(o.text+' '+o.value));if(opts.length===1){select.value=opts[0].value;select.dispatchEvent(new w.Event('change',{bubbles:true}));formatConfirmed=/\.xlsx\b/i.test(select.selectedOptions[0].text+' '+select.value);break;}}
  if(!formatConfirmed){
   const combos=all('[role="combobox"],mat-select,.mat-mdc-select-value,.mat-select-value',dialog).filter(visible);
   formatConfirmed=combos.some(e=>/\.xlsx\b/i.test(text(e)+' '+(e.getAttribute('aria-valuetext')||'')));
  }
  if(!formatConfirmed)throw Error('未能确认当前文件格式为 .xlsx；请手动选好格式后重试，不会盲点导出');
  note('确认 .xlsx 格式');
  const buttons=all('button,[role="button"]',dialog).filter(e=>visible(e)&&enabled(e)&&/^(导出|Export)$/.test(text(e)));
  unique(buttons,'最终导出按钮').click();
  log.status='export_clicked_download_unverified';note('已点击导出','请在浏览器下载列表确认 data.xlsx 或 data (数字).xlsx 是否下载完成');
 }catch(e){log.status='failed';log.error=String(e);note('停止',String(e));}
 finally{window.PBI_EXPORT_TEST_RUNNING=false;console.log('测试结果',log);}
})();
