/* Derived from existing records only; no new storage format or automatic submission. */
(() => {
  'use strict';
  const text = value => String(value ?? '').trim();
  function columns(template) {
    return template.columns.filter(column => column.keep === true && column.auto === 'none' && column.type !== 'date' && column.id !== 'sn' && !/^SN$/i.test(column.label.trim()) && (column.uniqueScope ?? 'off') === 'off' && column.id !== template.analysis?.code);
  }
  function collect(template, records) {
    const eligible = columns(template), groups = new Map();
    for (const record of records) {
      if (record.templateId !== template.id) continue;
      const entries = eligible.map(column => [column.id, text(record.values[column.id])]);
      if (!entries.some(([, value]) => value)) continue;
      const key = JSON.stringify(entries);
      if (!groups.has(key)) groups.set(key, {key, values: Object.fromEntries(entries), count: 0, lastAt: ''});
      const group = groups.get(key);
      group.count++;
      if (String(record.createdAt ?? '') > group.lastAt) group.lastAt = record.createdAt;
    }
    return {columns: eligible, groups: [...groups.values()].sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt) || a.key.localeCompare(b.key))};
  }
  function plan(template, proposed, current, validate) {
    const updates = {}, skipped = [], invalid = [];
    for (const column of columns(template)) {
      const value = text(proposed[column.id]);
      if (!value) continue;
      if (text(current[column.id])) { skipped.push(column.label); continue; }
      const error = validate(column, value);
      if (error) invalid.push({label: column.label, error});
      else updates[column.id] = value;
    }
    return {updates, skipped, invalid};
  }
  function undo(before, applied, current) {
    return Object.fromEntries(Object.keys(applied).filter(id => String(current[id] ?? '') === applied[id]).map(id => [id, before[id] ?? '']));
  }
  const api = Object.freeze({columns, collect, plan, undo});
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.FillHistoryCore = api;
})();
