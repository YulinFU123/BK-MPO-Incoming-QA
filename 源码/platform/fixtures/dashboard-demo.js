'use strict';
const fixture = require('./synthetic.json');
const { shiftISODate } = require('../domain/validation');

function dashboardDemo(today) {
  const result = structuredClone(fixture);
  result.dataset.label = '示例 · 制程检验';
  result.rows = [];
  result.legacyState.records = [];
  const processes = ['装管', '研磨', '组装'];
  const issues = ['底座断裂', '外观异常', '尺寸偏差'];
  for (let day = 0; day < 60; day++) {
    const date = shiftISODate(today, day - 59);
    processes.forEach((process, index) => {
      const inspected = 740 + ((day * 37 + index * 83) % 460);
      const defective = Math.max(1, Math.round(inspected * (0.035 - day * 0.0003 + index * 0.003 + (day % 5) * 0.001)));
      result.rows.push({ '业务日': date, '工序': process, '检验数': inspected, '不良件数': defective, '产量': inspected + 60 });
      if ((day + index) % 2 === 0) result.legacyState.records.push({ id: `synthetic_${day}_${index}`, templateId: 'incoming', createdAt: `${date}T01:00:00.000Z`, createdLocalDate: date,
        values: { no: String(result.legacyState.records.length+1),found_date: date, sn: `DEMO${String(day * 3 + index).padStart(5, '0')}`, issue: issues[(day + index) % issues.length], silk: index === 1 ? 'AB12' : '0012', process,area:'BK5F',color:'黑色' } });
    });
  }
  return result;
}
module.exports = { dashboardDemo };
