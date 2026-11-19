/* One-pass evaluation: never overwrite values or cascade into another rule. */
window.FillRules = Object.freeze({
  evaluate(rules, values, sourceId) {
    const candidates = new Map(), updates = {}, conflicts = [];
    for (const rule of rules || []) {
      if (rule.enabled === false || rule.source !== sourceId || String(values[rule.source] ?? '').trim() !== rule.match.trim()) continue;
      if (!candidates.has(rule.target)) candidates.set(rule.target, new Set());
      candidates.get(rule.target).add(rule.value);
    }
    for (const [target, options] of candidates) {
      const current = String(values[target] ?? '').trim();
      if (options.size !== 1) { conflicts.push(target); continue; }
      const value = [...options][0];
      if (!current) updates[target] = value;
      else if (current !== value) conflicts.push(target);
    }
    return {updates, conflicts};
  }
});
