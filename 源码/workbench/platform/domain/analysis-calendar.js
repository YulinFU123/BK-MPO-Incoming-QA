'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AnalysisCalendar = api;
})(typeof window === 'object' ? window : null, () => {
  const ruleDefaults = () => ({
    mode: 'column',
    timeColumn: '',
    dateBasis: 'start',
    dayStart: '08:00',
    dayEnd: '18:40',
    nightStart: '20:00',
    nightEnd: '06:40',
    dayLabel: '白班',
    nightLabel: '晚班',
  });
  const defaults = () => ({ version: 1, sources: {} });
  const object = (v) => v && typeof v === 'object' && !Array.isArray(v);
  const fail = () => {
    throw Error('班次规则无效，请核对时间区间、时间列和日期归属。');
  };
  function rule(value, partial = false) {
    const v = { ...ruleDefaults(), ...value };
    if (
      !object(value) ||
      Object.keys(value).some((k) => !Object.hasOwn(v, k) || !Object.hasOwn(ruleDefaults(), k)) ||
      !['column', 'check-time'].includes(v.mode) ||
      !['mapped', 'start', 'calendar'].includes(v.dateBasis) ||
      (v.timeColumn !== '' && !/^h_[a-f0-9]{16}$/.test(v.timeColumn)) ||
      ['dayLabel', 'nightLabel'].some(
        (k) => typeof v[k] !== 'string' || v[k].length > 24 || /[\x00-\x1f]/.test(v[k]),
      ) ||
      ['dayStart', 'dayEnd', 'nightStart', 'nightEnd'].some(
        (k) =>
          typeof v[k] !== 'string' ||
          (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v[k]) && !(partial && v[k] === '')),
      )
    )
      fail();
    if (!partial && v.mode === 'check-time') {
      if (
        !v.timeColumn ||
        !v.dayLabel.trim() ||
        !v.nightLabel.trim() ||
        v.dayLabel === v.nightLabel ||
        [v.dayLabel, v.nightLabel].includes('未归班')
      )
        fail();
      const minute = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
      const [a, b, c, d] = [v.dayStart, v.dayEnd, v.nightStart, v.nightEnd].map(minute);
      if (a >= b || c <= d || a <= d || b >= c) fail();
    }
    return structuredClone(v);
  }
  function validate(value) {
    if (
      !object(value) ||
      value.version !== 1 ||
      !object(value.sources) ||
      Object.keys(value).some((k) => !['version', 'sources'].includes(k)) ||
      Object.keys(value.sources).length > 40
    )
      fail();
    const sources = {};
    for (const [id, v] of Object.entries(value.sources)) {
      if (!/^[a-zA-Z0-9][\w.-]{0,79}$/.test(id)) fail();
      sources[id] = rule(v);
    }
    return { version: 1, sources };
  }
  function draft(value) {
    if (
      !object(value) ||
      Object.keys(value).some((k) => !['sourceId', 'rule'].includes(k)) ||
      typeof value.sourceId !== 'string' ||
      value.sourceId.length > 80
    )
      fail();
    return { sourceId: value.sourceId, rule: value.rule === null ? null : rule(value.rule, true) };
  }
  function suggested(source, inspection) {
    const mapping = { ...inspection.mapping };
    const judgment = inspection.columns.find((c) => c.id === inspection.decisionDateColumn && c.id === mapping.date);
    if (judgment) return { mapping, rule: judgmentRule(ruleDefaults(), judgment.id) };
    const clock = inspection.columns.find((c) => c.label.trim().toLowerCase() === 'check date');
    return {
      mapping,
      rule: clock
        ? {
            ...ruleDefaults(),
            mode: 'check-time',
            timeColumn: clock.id,
            dateBasis: inspection.dateFallback ? 'mapped' : 'start',
          }
        : ruleDefaults(),
    };
  }
  function judgmentRule(previous, id) {
    return { ...previous, mode: 'check-time', timeColumn: id, dateBasis: 'start' };
  }
  return Object.freeze({ ruleDefaults, defaults, rule, validate, draft, suggested, judgmentRule });
});
