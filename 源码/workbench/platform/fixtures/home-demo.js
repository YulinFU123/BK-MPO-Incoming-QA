'use strict';
const {dashboardDemo}=require('./dashboard-demo');
const {shiftISODate}=require('../domain/validation');
function homeDemo(today){
 const demo=dashboardDemo(today);demo.dataset.label='示例 · 制程检验';
 demo.legacyState.templates[0].columns.push({id:'reporter',label:'报检人',type:'text'},{id:'shift',label:'报检班别',type:'text'});
 demo.legacyState.records.forEach((r,i)=>{r.workflow={status:['待处理','处理中','待验证','已关闭'][i%4],owner:['示例甲','示例乙','示例丙','示例丁'][i%4],dueDate:shiftISODate(r.values.found_date,2),result:i%4===3?'示例处理记录':''};r.values.reporter=['示例报检员A','示例报检员B'][i%2];r.values.shift=i%3===0?'晚班':'白班';});return demo;
}
module.exports={homeDemo};
