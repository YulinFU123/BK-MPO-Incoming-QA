/* Shared validation for import and recovery. No mutation of source records. */
window.RecordRules = Object.freeze({
  inspect(records, existing, columns, dateId) {
    const accepted = [], rejected = [];
    function dateKey(record) {
      if (!dateId) {
        if (record.createdLocalDate) return record.createdLocalDate;
        const date = new Date(record.createdAt);
        return Number.isNaN(date.getTime()) ? '' : [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
      }
      const value=String(record.values[dateId]??'').trim();
      const iso=value.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/), us=value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      const parts=iso?[iso[1],iso[2],iso[3]]:us?[us[3],us[1],us[2]]:null;
      return parts?parts.map((v,i)=>i?String(v).padStart(2,'0'):v).join('-'):value;
    }
    const unique = columns.map(column=>({column,mode:column.uniqueScope??((column.id==='sn'||/^SN$/i.test(column.label.trim()))?'today':'off'),index:new Map()})).filter(rule=>rule.mode!=='off');
    const keyFor=(rule,record)=>JSON.stringify([String(record.values[rule.column.id]??'').trim(),rule.mode==='today'?dateKey(record):'']);
    function remember(record){for(const rule of unique){if(!String(record.values[rule.column.id]??'').trim())continue;const key=keyFor(rule,record);if(!rule.index.has(key))rule.index.set(key,new Set());rule.index.get(key).add(record.id);}}
    existing.forEach(remember);
    records.forEach((record, index) => {
      const values = record.values;
      let reason = '';
      for (const column of columns) {
        const value = String(values[column.id] ?? '').trim();
        const inputError=window.InputRules?.validate(column,values[column.id]);if(inputError){reason=column.label+'：'+inputError;break;}
        if (column.required && column.auto !== 'sequence' && !value) { reason = column.label + '未填写'; break; }
        if (column.type === 'number' && value && !Number.isFinite(Number(value))) { reason = column.label + '不是有效数字'; break; }
        if (column.type === 'date' && value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value)) { reason = column.label + '日期无效'; break; }
        const rule=unique.find(item=>item.column.id===column.id), ids=rule&&value?rule.index.get(keyFor(rule,record)):null;
        if(ids&&[...ids].some(id=>id!==record.id)){reason=column.label+'重复：'+value;break;}
      }
      if (reason) rejected.push({row:index + 2, reason}); else {accepted.push(record);remember(record);}
    });
    return {accepted, rejected};
  }
});
