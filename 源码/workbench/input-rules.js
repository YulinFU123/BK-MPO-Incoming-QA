/* One validation policy shared by forms, scanning and import. Never truncates data. */
window.InputRules = (() => {
  'use strict';
  const kinds = {
    any: {label:'不限字符'},
    code: {label:'英文、数字及 . _ -',pattern:/^[A-Za-z0-9._-]+$/},
    alnum: {label:'仅英文和数字',pattern:/^[A-Za-z0-9]+$/},
    digits: {label:'仅数字字符',pattern:/^[0-9]+$/},
    letters: {label:'仅英文字母',pattern:/^[A-Za-z]+$/}
  };
  const serial = c => c.id==='sn'||/^SN$/i.test(c.label.trim());
  function settings(column) {
    return {minLength:0,maxLength:column.type==='multiline'?2000:serial(column)?128:255,kind:serial(column)?'code':'any',prefix:'',optionsOnly:false,min:'',max:'',integer:false,...column.validation};
  }
  function validate(column,raw) {
    if(column.auto==='sequence')return '';
    const value=String(raw??'').trim(),rule=settings(column);
    if(!value)return column.required?'请填写'+column.label:'';
    if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)||column.type!=='multiline'&&/[\r\n\t]/.test(value))return '含有不可用的控制字符，请重新扫描或检查源数据';
    if(column.type==='date') {
      if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)return '请输入有效日期';
      return '';
    }
    if(column.type==='number') {
      const number=Number(value);if(!Number.isFinite(number))return '请输入有效数字';
      if(rule.integer&&!Number.isInteger(number))return '只允许整数';
      if(rule.min!==''&&number<Number(rule.min))return '不能小于 '+rule.min;
      if(rule.max!==''&&number>Number(rule.max))return '不能大于 '+rule.max;
      return '';
    }
    const length=Array.from(value).length;
    if(length<Number(rule.minLength))return '至少需要 '+rule.minLength+' 个字符，当前 '+length+' 个';
    if(length>Number(rule.maxLength))return '最多允许 '+rule.maxLength+' 个字符，当前 '+length+' 个（未截断）';
    if(kinds[rule.kind]?.pattern&&!kinds[rule.kind].pattern.test(value))return kinds[rule.kind].label;
    if(rule.prefix&&!value.startsWith(rule.prefix))return '必须以 '+rule.prefix+' 开头（区分大小写）';
    if(rule.optionsOnly&&!String(column.options||'').split(/[,，\n]/).map(v=>v.trim()).filter(Boolean).includes(value))return '只能选择已配置的预设选项';
    return '';
  }
  function describe(column) {
    const r=settings(column),parts=[];
    if(column.type==='date')return '有效日期';
    if(column.type==='number') {if(r.integer)parts.push('整数');if(r.min!=='')parts.push('最小 '+r.min);if(r.max!=='')parts.push('最大 '+r.max);return parts.join(' · ')||'数字';}
    parts.push(r.minLength?r.minLength+'–'+r.maxLength+' 字符':'最多 '+r.maxLength+' 字符');
    if(r.kind!=='any')parts.push(kinds[r.kind]?.label||'');if(r.prefix)parts.push('开头 '+r.prefix);if(r.optionsOnly)parts.push('仅预设项');
    return parts.join(' · ');
  }
  function configurationError(column,rule) {
    if(!kinds[rule.kind])return '请选择有效的字符规则';
    if(!Number.isInteger(Number(rule.minLength))||!Number.isInteger(Number(rule.maxLength))||Number(rule.minLength)<0||Number(rule.maxLength)<1||Number(rule.maxLength)>10000||Number(rule.minLength)>Number(rule.maxLength))return '字符长度应为 0–10000 的整数，最大长度不能小于最小长度且至少为 1';
    if([rule.min,rule.max].some(v=>v!==''&&!Number.isFinite(Number(v))))return '数字上下限必须是有效数字';
    if(rule.min!==''&&rule.max!==''&&Number(rule.min)>Number(rule.max))return '数字下限不能大于上限';
    if(rule.optionsOnly&&!String(column.options||'').split(/[,，\n]/).some(v=>v.trim()))return '请先为该字段配置至少一个预设选项';
    if(rule.prefix&&Array.from(rule.prefix).length>rule.maxLength)return '固定开头不能超过最大字符长度';
    return '';
  }
  return Object.freeze({settings,validate,describe,configurationError,kinds});
})();
