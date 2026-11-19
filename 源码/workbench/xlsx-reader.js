/* Offline OOXML reader. Reads cell values only; never evaluates formulas. */
window.XlsxReader = (() => {
  'use strict';
  const MAX_XML = 32 * 1024 * 1024;
  const decoder = new TextDecoder('utf-8');
  const nodes = (parent, name) => [...parent.getElementsByTagNameNS('*', name)];
  function xml(bytes) {
    const doc = new DOMParser().parseFromString(decoder.decode(bytes), 'application/xml');
    if (nodes(doc, 'parsererror').length) throw Error('Excel 内部数据损坏，无法读取。');
    return doc;
  }
  function resolve(base, target) {
    const parts = (target.startsWith('/') ? target.slice(1) : base + target).split('/');
    const result = [];
    for (const part of parts) {
      if (part === '..') result.pop(); else if (part && part !== '.') result.push(part);
    }
    return result.join('/');
  }
  async function archive(file) {
    if (file.size > 20 * 1024 * 1024) throw Error('请将文件拆分为不超过 20 MB 的工作簿。');
    const bytes = new Uint8Array(await file.arrayBuffer()), view = new DataView(bytes.buffer);
    let end = bytes.length - 22;
    for (; end >= Math.max(0, bytes.length - 65557); end--) if (view.getUint32(end, true) === 0x06054b50) break;
    if (end < 0 || end < bytes.length - 65557) throw Error('仅支持未加密的 .xlsx 文件，请在 Excel 中另存为 .xlsx。');
    const count = view.getUint16(end + 10, true), entries = new Map();
    if (count > 10000) throw Error('工作簿结构过大，请拆分文件。');
    let cursor = view.getUint32(end + 16, true), total = 0;
    for (let i = 0; i < count; i++) {
      if (view.getUint32(cursor, true) !== 0x02014b50) throw Error('Excel 压缩结构无效。');
      const nameLength = view.getUint16(cursor + 28, true), extra = view.getUint16(cursor + 30, true), comment = view.getUint16(cursor + 32, true);
      const item = {flags:view.getUint16(cursor + 8,true), method:view.getUint16(cursor + 10,true), size:view.getUint32(cursor + 24,true), packed:view.getUint32(cursor + 20,true), offset:view.getUint32(cursor + 42,true)};
      const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
      total += item.size;
      if (item.size > MAX_XML || total > 100 * 1024 * 1024) throw Error('解压后的工作簿过大，请拆分文件。');
      entries.set(name, item); cursor += 46 + nameLength + extra + comment;
    }
    return async name => {
      const item = entries.get(name); if (!item) return null;
      if (item.flags & 1) throw Error('不支持加密工作簿，请先在 Excel 中解密。');
      if (view.getUint32(item.offset,true) !== 0x04034b50) throw Error('Excel 文件损坏。');
      const start = item.offset + 30 + view.getUint16(item.offset+26,true) + view.getUint16(item.offset+28,true);
      const packed = bytes.slice(start,start+item.packed);
      if (item.method === 0) return packed;
      if (item.method !== 8) throw Error('不支持此工作簿的压缩格式。');
      const reader = new Blob([packed]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
      const chunks = []; let size = 0;
      while (true) {
        const {done,value} = await reader.read(); if (done) break;
        size += value.length; if (size > MAX_XML) {await reader.cancel(); throw Error('工作表过大。');}
        chunks.push(value);
      }
      if (size !== item.size) throw Error('Excel 数据长度校验失败。');
      const output = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) {output.set(chunk,offset); offset += chunk.length;}
      return output;
    };
  }
  function serialDate(value, date1904) {
    const serial = Math.floor(Number(value));
    if (!Number.isFinite(serial) || serial < 0 || serial > 2958465 || (!date1904 && serial === 60)) return '';
    const time = Date.UTC(date1904 ? 1904 : 1899, date1904 ? 0 : 11, date1904 ? 1 : 31) + (serial - (!date1904 && serial > 60 ? 1 : 0)) * 86400000;
    return new Date(time).toISOString().slice(0,10);
  }
  async function open(file) {
    const read = await archive(file), workbookBytes = await read('xl/workbook.xml'), relBytes = await read('xl/_rels/workbook.xml.rels');
    if (!workbookBytes || !relBytes) throw Error('找不到 Excel 工作表目录。');
    const workbook = xml(workbookBytes), relations = nodes(xml(relBytes),'Relationship');
    const date1904 = ['1','true'].includes(nodes(workbook,'workbookPr')[0]?.getAttribute('date1904'));
    const sheets = nodes(workbook,'sheet').map(sheet => {
      const id = sheet.getAttribute('r:id') || sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id');
      const relation = relations.find(r=>r.getAttribute('Id')===id);
      return {name:sheet.getAttribute('name'), path:relation && relation.getAttribute('TargetMode')!=='External' ? resolve('xl/',relation.getAttribute('Target')) : ''};
    }).filter(s=>s.path);
    const stringsBytes = await read('xl/sharedStrings.xml');
    const strings = stringsBytes ? nodes(xml(stringsBytes),'si').map(si=>nodes(si,'t').map(t=>t.textContent).join('')) : [];
    const styleBytes = await read('xl/styles.xml'), styles = [], formats = new Map();
    if (styleBytes) {
      const doc = xml(styleBytes);
      nodes(doc,'numFmt').forEach(n=>formats.set(Number(n.getAttribute('numFmtId')),n.getAttribute('formatCode')));
      const xfs = nodes(doc,'cellXfs')[0]; if (xfs) nodes(xfs,'xf').forEach(n=>styles.push(Number(n.getAttribute('numFmtId'))));
    }
    return {sheets,date1904, async sheet(index) {
      const bytes = await read(sheets[index]?.path); if (!bytes) throw Error('工作表无法读取。');
      const doc = xml(bytes), rows = [];
      for (const row of nodes(doc,'row')) {
        const rowNumber = Number(row.getAttribute('r')) || rows.length+1;
        if (rowNumber > 10001) throw Error('本版每个工作表最多支持 10000 条数据，请拆分后导入。');
        const cells = [];
        for (const c of nodes(row,'c')) {
          const ref = c.getAttribute('r') || '', letters = ref.match(/^[A-Z]+/i)?.[0] || '';
          let column = 0; for (const letter of letters.toUpperCase()) column=column*26+letter.charCodeAt(0)-64;
          if (!column) column=cells.length+1;
          if (column > 256) throw Error('工作表超过 256 列，请删除无关列后导入。');
          const type=c.getAttribute('t'), v=nodes(c,'v')[0]?.textContent ?? '', formula=nodes(c,'f').length>0;
          let value=v, error='';
          if (type==='s') value=strings[Number(v)] ?? '';
          if (type==='inlineStr') value=nodes(c,'t').map(t=>t.textContent).join('');
          if (type==='b') value=v==='1'?'TRUE':'FALSE';
          if (type==='e') error='Excel 单元格错误 '+v;
          if (formula && !nodes(c,'v').length) error='公式缺少缓存结果，请用 Excel 重新计算并保存';
          const numeric=(!type||type==='n')&&v!=='';
          const formatId=styles[Number(c.getAttribute('s')||0)]||0, format=formats.get(formatId)||'';
          const cleaned=format.replace(/"[^"]*"|\\.|\[[^\]]*\]/g,'');
          const dateStyle=(formatId>=14&&formatId<=17)||(formatId>=22&&formatId<=22)||(formatId>=27&&formatId<=36)||(formatId>=50&&formatId<=58)||/[yd]/i.test(cleaned);
          if (numeric&&dateStyle) {value=serialDate(v,date1904); if (!value) error='无效 Excel 日期';}
          else if (numeric&&/^0+$/.test(format)&&/^\d+$/.test(v)) value=v.padStart(format.length,'0');
          cells[column-1]={value:String(value),numeric,raw:v,error};
        }
        rows[rowNumber-1]=cells;
      }
      return rows;
    }};
  }
  return Object.freeze({open,serialDate});
})();
