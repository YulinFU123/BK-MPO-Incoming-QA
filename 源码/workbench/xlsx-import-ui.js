/* Import wizard owns temporary file data; application owns validated records. */
window.XlsxImportUI = Object.freeze({
  install(api) {
    const $ = id => document.getElementById(id);
    let book=null, rows=[], template=null, mapping=[], checked=null, revision=0;
    const dialog=$('xlsxDialog');
    const element=(tag,text)=>{const node=document.createElement(tag);node.textContent=text;return node;};
    function invalidate(){checked=null;$('xlsxCommit').disabled=true;$('xlsxSummary').textContent='请先检查数据。';$('xlsxErrors').textContent='';}
    function headerIndex(){return Number($('xlsxHeader').value)-1;}
    function drawMapping(){
      invalidate();$('xlsxMapping').replaceChildren();$('xlsxPreview').replaceChildren();
      const index=headerIndex();
      if (!Number.isInteger(index)||index<0||index>=rows.length) {$('xlsxSummary').textContent='表头行不在工作表范围内。';return;}
      const header=rows[index]||[], width=Math.min(256,Math.max(header.length,...rows.slice(index+1,index+21).map(row=>row?.length||0)));
      mapping=[];
      template.columns.forEach(column=>{
        if(column.auto==='sequence')return;
        const label=element('label',column.label+(column.required?' *':'')), select=document.createElement('select');
        select.setAttribute('aria-label','Excel映射：'+column.label);
        const skip=element('option','不导入此列');skip.value='-1';select.append(skip);
        for(let i=0;i<width;i++){const option=element('option','第 '+(i+1)+' 列 · '+(header[i]?.value||'无表头'));option.value=String(i);select.append(option);}
        const matches=header.map((cell,i)=>cell?.value.trim()===column.label.trim()?i:-1).filter(i=>i>=0);
        select.value=matches.length===1?String(matches[0]):'-1';
        const item={column,select};mapping.push(item);select.onchange=invalidate;label.append(select);$('xlsxMapping').append(label);
      });
      const table=document.createElement('table'), head=document.createElement('tr');head.append(element('th','Excel 行'));
      for(let i=0;i<width;i++)head.append(element('th',header[i]?.value||'第 '+(i+1)+' 列'));table.append(head);
      for(let i=index+1;i<Math.min(rows.length,index+6);i++){const tr=document.createElement('tr');tr.append(element('td',String(i+1)));for(let j=0;j<width;j++)tr.append(element('td',rows[i]?.[j]?.value||''));table.append(tr);}
      $('xlsxPreview').append(table);
    }
    async function loadSheet(){
      const token=++revision;invalidate();$('xlsxCheck').disabled=true;$('xlsxSummary').textContent='正在读取工作表…';
      try {const result=await book.sheet(Number($('xlsxSheet').value));if(token!==revision||!dialog.open)return;rows=result;$('xlsxHeader').value='1';drawMapping();}
      catch(error){if(token!==revision||!dialog.open)return;rows=[];$('xlsxMapping').replaceChildren();$('xlsxPreview').replaceChildren();$('xlsxSummary').textContent=error.message;}
      finally{if(token===revision)$('xlsxCheck').disabled=!rows.length;}
    }
    $('importExcel').onclick=()=>$('xlsxFile').click();
    $('xlsxFile').onchange=async event=>{
      const file=event.target.files[0];event.target.value='';if(!file)return;
      $('importExcel').disabled=true;
      try {
        if(!/\.xlsx$/i.test(file.name))throw Error('请选择 .xlsx 文件；旧版 .xls 请先另存为 .xlsx。');
        const parsed=await XlsxReader.open(file);if(!api.isUnlocked())return;
        book=parsed;template=api.template();$('xlsxFilename').textContent=file.name+' → '+template.name;
        $('xlsxSheet').replaceChildren();book.sheets.forEach((sheet,index)=>{const option=element('option',sheet.name);option.value=String(index);$('xlsxSheet').append(option);});
        if(!book.sheets.length)throw Error('没有可导入的工作表。');
        dialog.showModal();await loadSheet();
      } catch(error){api.notice('Excel 读取失败：'+error.message,true);}
      finally{$('importExcel').disabled=false;}
    };
    $('xlsxSheet').onchange=loadSheet;
    $('xlsxHeader').oninput=drawMapping;
    $('xlsxCancel').onclick=()=>dialog.close();
    dialog.addEventListener('close',()=>{revision++;book=null;rows=[];checked=null;mapping=[];template=null;$('xlsxPreview').replaceChildren();$('xlsxMapping').replaceChildren();});
    $('xlsxCheck').onclick=()=>{
      invalidate();if(!rows.length||!$('xlsxHeader').checkValidity())return;
      const header=headerIndex();if(!Number.isInteger(header)||header<0||header>=rows.length)return;
      const missing=mapping.filter(item=>item.column.required&&Number(item.select.value)<0);
      if(missing.length){$('xlsxSummary').textContent='请匹配必填字段：'+missing.map(item=>item.column.label).join('、');return;}
      const selected=mapping.filter(item=>Number(item.select.value)>=0);
      if(!selected.length){$('xlsxSummary').textContent='至少匹配一个字段。';return;}
      if(new Set(selected.map(item=>item.select.value)).size!==selected.length){$('xlsxSummary').textContent='同一 Excel 列不能映射到多个字段，请检查对应关系。';return;}
      const records=[], rejected=[];
      for(let i=header+1;i<rows.length;i++){
        const row=rows[i];if(!row||!row.some(cell=>cell&&(cell.value.trim()||cell.error)))continue;
        const values={};let error='';
        for(const {column,select} of mapping){
          const cell=row[Number(select.value)];let value=cell?.value.trim()||'';
          if(cell?.error)error=column.label+'：'+cell.error;
          if(column.type==='date'&&value){const normalized=api.normalizeDate(value)||(cell.numeric?XlsxReader.serialDate(cell.raw,book.date1904):'');if(!normalized)error=column.label+'：日期无法识别';else value=normalized;}
          values[column.id]=value;
        }
        if(error){rejected.push({row:i+1,reason:error});continue;}
        records.push(api.record(values,i+1));
      }
      const result=api.inspect(records,template);
      result.rejected.forEach(item=>rejected.push({row:records[item.row-2].sourceRow,reason:item.reason}));
      checked={records:result.accepted,templateId:template.id};
      $('xlsxSummary').textContent='检查完成：可导入 '+result.accepted.length+' 行，跳过 '+rejected.length+' 行。确认后只导入通过的记录。';
      $('xlsxErrors').textContent=rejected.slice(0,100).map(item=>'Excel 第 '+item.row+' 行：'+item.reason).join('\n')+(rejected.length>100?'\n仅显示前 100 项，请分批修正后重试。':'');
      $('xlsxCommit').disabled=!result.accepted.length;
    };
    $('xlsxCommit').onclick=()=>{
      if(!checked?.records.length)return;
      if(!confirm('确认向当前异常类型导入 '+checked.records.length+' 条通过检查的记录？'))return;
      $('xlsxCommit').disabled=true;
      if(api.commit(checked.records,checked.templateId))dialog.close();else invalidate();
    };
  }
});
