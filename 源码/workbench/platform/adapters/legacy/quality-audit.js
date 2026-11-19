'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { legacyRoot, normalizeLegacyDate } = require('./full-state');
let rules;
function originalRules() {
  if (!rules) {
    const context = vm.createContext({ window: {} });
    for (const name of ['input-rules.js', 'record-rules.js'])
      vm.runInContext(fs.readFileSync(path.join(legacyRoot(), name), 'utf8'), context, {
        timeout: 1000,
        filename: name,
      });
    rules = context.window.RecordRules;
  }
  return rules;
}

/** Original business rules run on an isolated normalized copy, in record order.
 * A repeated value's first accepted row stays accepted, exactly as on import.
 * Never change stored text/IDs or treat an unchecked unique field as a conflict.
 */
function auditLegacy(state, observations, { start, end }) {
  if (!state) return { count: 0, checked: 0, samples: [] };
  const projected = new Map(observations.map((row) => [row.id, row]));
  const positions = new Map(state.records.map((row, index) => [row.id, index + 1]));
  let count = 0,
    checked = 0;
  const samples = [];
  for (const template of state.templates) {
    const selected = state.records.filter(
      (row) =>
        row.templateId === template.id &&
        projected.has(row.id) &&
        projected.get(row.id).observedOn >= start &&
        projected.get(row.id).observedOn <= end,
    );
    const records = selected.map((row) => {
      const copy = structuredClone(row);
      for (const column of template.columns)
        if (column.type === 'date' && String(copy.values[column.id] ?? '').trim()) {
          const normalized = normalizeLegacyDate(copy.values[column.id]);
          if (normalized) copy.values[column.id] = normalized;
        }
      return copy;
    });
    const dateId = records.length ? projected.get(records[0].id).source.dateField : '';
    const result = originalRules().inspect(
      records,
      [],
      template.columns,
      dateId === 'createdLocalDate' ? '' : dateId,
    );
    checked += records.length;
    count += result.rejected.length;
    for (const rejected of result.rejected) {
      if (samples.length >= 20) break;
      const row = records[rejected.row - 2];
      samples.push({
        recordId: row.id,
        rowNumber: positions.get(row.id),
        date: projected.get(row.id).observedOn,
        template: template.name || template.id,
        message: rejected.reason,
      });
    }
  }
  return { count, checked, samples };
}
module.exports = { auditLegacy };
