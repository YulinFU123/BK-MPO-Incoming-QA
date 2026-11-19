/* Versioned local appearance preferences. Never changes business state. */
(() => {
  'use strict';
  const KEY='qualityDeskUIPreferences', themes=[['professional','深海蓝','深色导航 · 蓝灰工作面'],['glass','液体玻璃','轻盈导航 · 实色内容'],['graphite','石墨深色','深色层次 · 柔和文字'],['contrast','高对比','明确轮廓 · 强化辨认']];
  const defaults=()=>({version:1,theme:'professional',density:'comfortable',font:'standard',stripes:true,headers:true,focus:true,reducedMotion:false});
  const clean=value=>{
    const result=defaults();if(!value||value.version!==1)return result;
    if(themes.some(x=>x[0]===value.theme))result.theme=value.theme;
    if(['comfortable','compact'].includes(value.density))result.density=value.density;
    if(['standard','large'].includes(value.font))result.font=value.font;
    ['stripes','headers','focus','reducedMotion'].forEach(key=>{if(typeof value[key]==='boolean')result[key]=value[key];});return result;
  };
  let current=defaults(),loadError='';
  try{const raw=localStorage.getItem(KEY);if(raw){const parsed=JSON.parse(raw);current=clean(parsed);if(!parsed||parsed.version!==1||!themes.some(x=>x[0]===parsed.theme))loadError='外观配置版本或主题无效，已使用可用默认值。';}else{const old=localStorage.getItem('qualityDeskAppearance');if(old==='glass')current.theme='glass';}}catch{loadError='外观配置无法读取，已使用默认外观。';}
  function apply(value){const root=document.documentElement;root.dataset.theme=value.theme;root.dataset.appearance=value.theme==='glass'?'glass':'plain';root.dataset.density=value.density;root.dataset.font=value.font;['stripes','headers','focus','reducedMotion'].forEach(key=>root.dataset[key]=String(value[key]));document.querySelector('meta[name="color-scheme"]').content=value.theme==='graphite'?'dark':'light';}
  apply(current);
  const dialog=document.createElement('dialog');dialog.id='appearanceDialog';dialog.setAttribute('aria-labelledby','appearanceTitle');
  dialog.innerHTML=`<form method="dialog" id="appearanceForm"><div class="modal-head"><div><h2 id="appearanceTitle">外观与布局</h2><p>选择整套风格，组合适合你的显示方式。</p></div><button type="button" class="close-x" id="appearanceClose" aria-label="取消外观设置">×</button></div><div class="appearance-body"><fieldset class="theme-fieldset"><legend>界面风格</legend><div class="theme-choices" id="themeChoices"></div></fieldset><div class="appearance-options"><fieldset><legend>外观增强 · 可多选</legend>${[['stripes','行间底色'],['headers','加强表头对比'],['focus','强调当前输入'],['reducedMotion','减少动态效果']].map(([key,label])=>`<label class="check-label"><input type="checkbox" name="${key}">${label}</label>`).join('')}</fieldset><fieldset><legend>布局</legend><label>信息密度<select name="density"><option value="comfortable">舒适</option><option value="compact">紧凑</option></select></label><label>字体大小<select name="font"><option value="standard">标准</option><option value="large">较大</option></select></label></fieldset></div><section class="appearance-preview" aria-label="外观组件预览"><p class="preview-caption">组件预览 · 示例数据</p><div class="preview-inputs"><label>SN<input value="DEMO-SN-001" readonly></label><label>异常现象<select><option>底座断裂</option><option>其他异常</option></select></label><button type="button" class="btn btn-primary">保存记录</button></div><table class="matrix-table"><thead><tr><th>发现日期</th><th>关联编号</th><th>处理状态</th></tr></thead><tbody><tr><td>示例日期</td><td>0012</td><td>待处理</td></tr><tr><td>示例日期</td><td>A</td><td>处理中</td></tr></tbody></table><p class="input-error">示例提示：请填写异常现象。</p></section><p id="appearanceStatus" role="status"></p><p class="config-help">选择后实时预览，应用后保存。高对比及系统辅助设置优先；业务数据和 Excel 配色独立。</p></div><div class="config-foot"><button type="button" class="btn" id="appearanceReset">恢复默认</button><span class="appearance-spacer"></span><button type="button" class="btn" id="appearanceCancel">取消</button><button type="submit" class="btn btn-primary">应用</button></div></form>`;
  document.body.append(dialog);const form=document.getElementById('appearanceForm');
  themes.forEach(([id,name,description])=>{const label=document.createElement('label');label.className='theme-card';label.dataset.previewTheme=id;const radio=document.createElement('input');radio.type='radio';radio.name='theme';radio.value=id;const sample=document.createElement('span');sample.className='theme-thumbnail';sample.innerHTML='<span class="mini-rail"><span></span><span></span><span></span></span><span class="mini-work"><span class="mini-heading">SN 录入</span><span class="mini-input">输入或扫描 SN</span><span class="mini-table"><span>0012</span><span>待处理</span></span></span>';const title=document.createElement('strong');title.textContent=name;const detail=document.createElement('small');detail.textContent=description;label.append(radio,sample,title,detail);document.getElementById('themeChoices').append(label);});
  function fill(value){form.elements.theme.value=value.theme;form.elements.density.value=value.density;form.elements.font.value=value.font;['stripes','headers','focus','reducedMotion'].forEach(key=>form.elements[key].checked=value[key]);}
  function read(){return clean({version:1,theme:form.elements.theme.value,density:form.elements.density.value,font:form.elements.font.value,...Object.fromEntries(['stripes','headers','focus','reducedMotion'].map(key=>[key,form.elements[key].checked]))});}
  form.addEventListener('change',()=>apply(read()));
  form.addEventListener('submit',event=>{event.preventDefault();const next=read();try{localStorage.setItem(KEY,JSON.stringify(next));current=next;apply(current);dialog.close('applied');}catch{document.getElementById('appearanceStatus').textContent='外观未保存：本机偏好存储不可用。请取消或重试。';}});
  const cancel=()=>{apply(current);dialog.close('cancel');};
  ['appearanceClose','appearanceCancel'].forEach(id=>document.getElementById(id).onclick=cancel);
  dialog.addEventListener('cancel',()=>apply(current));
  document.getElementById('appearanceReset').onclick=()=>{fill(defaults());apply(defaults());};
  // A queued close event from an earlier session must not overwrite a new preview.
  dialog.addEventListener('close',()=>{if(!dialog.open)apply(current);});
  function open(){fill(current);document.getElementById('appearanceStatus').textContent=loadError;dialog.showModal();}
  window.Appearance=Object.freeze({open});
})();
