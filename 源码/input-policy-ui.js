/* Field policy editor and inline validation feedback. */
window.InputPolicyUI = Object.freeze({
  install(api) {
    const $=id=>document.getElementById(id);
    let editing=null;
    function open(column,onSaved) {
      editing={column,onSaved};const rule=InputRules.settings(column);
      $('policyTitle').textContent=column.label+' · 输入规则';
      for(const key of ['minLength','maxLength','kind','prefix','min','max'])$('policy_'+key).value=rule[key];
      for(const key of ['integer','optionsOnly'])$('policy_'+key).checked=!!rule[key];
      $('policyText').hidden=['number','date'].includes(column.type);
      $('policyNumber').hidden=column.type!=='number';
      $('policyDateNote').hidden=column.type!=='date';
      $('policyError').textContent='';$('policyDialog').showModal();
    }
    $('policyCancel').onclick=()=>$('policyDialog').close();
    $('policyForm').onsubmit=event=>{
      event.preventDefault();if(!editing)return;
      const rule={};for(const key of ['minLength','maxLength','kind','prefix','min','max'])rule[key]=$('policy_'+key).value.trim();
      for(const key of ['integer','optionsOnly'])rule[key]=$('policy_'+key).checked;
      rule.minLength=Number(rule.minLength);rule.maxLength=Number(rule.maxLength);
      const error=InputRules.configurationError(editing.column,rule);
      if(error){$('policyError').textContent=error;return;}
      editing.column.validation=rule;editing.onSaved();$('policyDialog').close();
    };
    function message(input,column) {return input.validity?.badInput?'请输入有效数字':InputRules.validate(column,input.value);}
    function mark(input,column,required=true) {
      const error=!required&&!input.value.trim()?'':message(input,column),box=$('error_'+column.id);
      input.setAttribute('aria-invalid',String(!!error));if(box)box.textContent=error;
      return error;
    }
    function refresh() {
      let missing=0,invalid=0;
      for(const column of api.columns()) {
        const input=$('field_'+column.id);if(!input)continue;
        if(column.required&&!input.value.trim())missing++;else if(message(input,column))invalid++;
      }
      $('entryReadiness').textContent=invalid?'有 '+invalid+' 项格式需要修正':missing?'还需填写 '+missing+' 项必填信息':'信息已齐，请核对后保存';
      $('entryReadiness').dataset.state=invalid?'invalid':missing?'pending':'ready';
    }
    function decorate(input,column,wrap) {
      const hint=document.createElement('div');hint.className='input-hint';hint.id='hint_'+column.id;hint.textContent=InputRules.describe(column);
      hint.hidden=!column.validation&&column.id!=='sn'&&!/^SN$/i.test(column.label.trim());
      input.title=hint.textContent;
      const error=document.createElement('div');error.className='input-error';error.id='error_'+column.id;
      input.setAttribute('aria-describedby',hint.id+' '+error.id);input.setAttribute('aria-invalid','false');
      wrap.append(hint,error);
      // Initial blank fields use readiness guidance. Preserve errors from an attempted
      // save; do not insert a new required-error row between pointer-down and click.
      input.addEventListener('blur',()=>{mark(input,column,input.getAttribute('aria-invalid')==='true');refresh()});
      input.addEventListener('input',()=>{if(input.getAttribute('aria-invalid')==='true')mark(input,column);refresh()});
    }
    function validateForm() {
      let first=null;
      for(const column of api.columns()) {const input=$('field_'+column.id);if(input&&mark(input,column)&&!first)first=input;}
      refresh();if(first){first.focus();api.status('请修正标红的字段，当前内容已保留。',true);return false;}return true;
    }
    $('fieldsGrid').addEventListener('change',()=>queueMicrotask(refresh));
    return Object.freeze({open,decorate,refresh,validateForm});
  }
});
