'use strict';
const {dashboardDemo}=require('./dashboard-demo');
const {shiftISODate}=require('../domain/validation');
/** Deliberate data issues for isolated UI QA. Never used to repair business data. */
function qualityDemo(today){
  const source=dashboardDemo(today);
  source.dataset.label='示例 · 含待核对项';
  source.rows=source.rows.filter(row=>row['业务日']!==shiftISODate(today,-2));
  source.rows.at(-1)['检验数']=null;
  source.legacyState.records[0].values.found_date='synthetic-invalid-date';
  const repeated=source.legacyState.records.filter(row=>row.values.found_date===shiftISODate(today,-1));
  for(const row of repeated)row.values.sn='DEMO_DUPLICATE';
  return source;
}
module.exports={qualityDemo};
