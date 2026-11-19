/* BI NC Exporter - 公共逻辑（日期、排除规则、默认设置） */
(function (root) {
  const HOST_NAME = 'com.ncexporter.host';
  const VERSION = '1.4.2';

  const DEFAULTS = {
    reportUrl:
      'https://app.powerbi.com/groups/me/reports/94d40618-eb12-4e5a-82e2-7690d9776e48/060ae9a7a1393c421077?experience=power-bi',
    tableKey: 'Serial Number',
    slicerDate: 'Work Date',
    slicerSite: 'Site',
    slicerConnector: 'Connector Type',
    keepAllSlicers: 'Shift\nProduct Type\nProcess Type',
    clearOthers: true,
    saturdayWorkday: true,
    holidays: '',
    makeupDays: '',
    sitePaths: 'BK>BK_5F',
    excludeKeywords: 'EBO\nLC',
    exceptionWords: 'LCD',
    overrides: '',
    workMode: 'A',
    batPath: '', // 每日分析程序
    batPathMonthly: '', // 月度分析程序（必须和每日的不同）
    transferMode: 'cut',
    preventDuplicate: true,
    launchMethod: 'shell',
    watchSubfolder: 'NC_Exporter',
    stepDelay: 1500,
    downloadTimeout: 180,
  };

  function pad(n) {
    return String(n).padStart(2, '0');
  }
  function ymd(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function parseYmd(s) {
    const m = String(s || '')
      .trim()
      .match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/);
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    return isNaN(d) ? null : d;
  }
  function parseDateList(text) {
    const set = new Set();
    String(text || '')
      .split(/[\r\n,;，；]+/)
      .forEach((line) => {
        line = line.trim();
        if (!line) return;
        const parts = line.split(/\s*[~～至]\s*/);
        const a = parseYmd(parts[0]);
        const b = parts[1] ? parseYmd(parts[1]) : a;
        if (!a || !b) return;
        for (let d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) set.add(ymd(d));
      });
    return set;
  }
  function isWorkday(d, s) {
    const key = ymd(d);
    if (parseDateList(s.makeupDays).has(key)) return true;
    if (parseDateList(s.holidays).has(key)) return false;
    const w = d.getDay();
    if (w === 0) return false;
    if (w === 6 && !s.saturdayWorkday) return false;
    return true;
  }
  function previousWorkday(s, from) {
    const d = from ? new Date(from) : new Date();
    d.setHours(0, 0, 0, 0);
    for (let i = 0; i < 60; i++) {
      d.setDate(d.getDate() - 1);
      if (isWorkday(d, s)) return d;
    }
    return null;
  }
  function previousMonth(from) {
    const d = from ? new Date(from) : new Date();
    const p = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    return p.getFullYear() + '-' + pad(p.getMonth() + 1);
  }
  function monthRange(ym) {
    const m = String(ym || '').match(/^(\d{4})-(\d{1,2})$/);
    if (!m) return null;
    return [ymd(new Date(+m[1], +m[2] - 1, 1)), ymd(new Date(+m[1], +m[2], 0))];
  }

  function splitList(text) {
    return String(text || '')
      .split(/[\r\n,;，；]+/)
      .map((x) => x.trim())
      .filter(Boolean);
  }
  function findAll(hay, needle) {
    const out = [];
    if (!needle) return out;
    let i = hay.indexOf(needle);
    while (i >= 0) {
      out.push(i);
      i = hay.indexOf(needle, i + 1);
    }
    return out;
  }
  function parseOverrides(text) {
    const map = {};
    String(text || '')
      .split(/\r?\n/)
      .forEach((line) => {
        const m = line.match(/^(.+?)\s*[=＝]\s*(保留|排除|keep|exclude)\s*$/i);
        if (m) map[m[1].trim().toUpperCase()] = /保留|keep/i.test(m[2]) ? 'keep' : 'exclude';
      });
    return map;
  }
  /* Connector Type：关键词每出现一次，如果这一处不属于任何例外词（如 LCD 里的 LC），就排除 */
  function judgeConnector(value, s) {
    const up = String(value || '')
      .trim()
      .toUpperCase();
    const ov = parseOverrides(s.overrides)[up];
    if (ov) return { keep: ov === 'keep', reason: '手动设置' };
    const kws = splitList(s.excludeKeywords).map((x) => x.toUpperCase());
    const exc = splitList(s.exceptionWords).map((x) => x.toUpperCase());
    for (const kw of kws) {
      for (const pos of findAll(up, kw)) {
        const excused = exc.some((ew) =>
          findAll(ew, kw).some((o) => pos - o >= 0 && up.substr(pos - o, ew.length) === ew),
        );
        if (!excused) return { keep: false, reason: '含 ' + kw };
      }
    }
    return { keep: true, reason: '' };
  }
  function parseSitePaths(text) {
    return String(text || '')
      .split(/\r?\n/)
      .map((l) =>
        l
          .split('>')
          .map((x) => x.trim())
          .filter(Boolean),
      )
      .filter((p) => p.length);
  }
  const normPath = (p) =>
    String(p || '')
      .trim()
      .replace(/^"+|"+$/g, '')
      .replace(/\//g, '\\')
      .toLowerCase();
  function samePath(a, b) {
    return !!a && !!b && normPath(a) === normPath(b);
  }
  function batFor(s, mode) {
    return mode === 'monthly' ? s.batPathMonthly : s.batPath;
  }

  async function loadSettings() {
    const st = await chrome.storage.local.get('settings');
    return Object.assign({}, DEFAULTS, st.settings || {});
  }
  async function saveSettings(s) {
    await chrome.storage.local.set({ settings: s });
  }

  root.NCX = {
    HOST_NAME,
    VERSION,
    DEFAULTS,
    ymd,
    parseYmd,
    parseDateList,
    isWorkday,
    previousWorkday,
    previousMonth,
    monthRange,
    splitList,
    judgeConnector,
    parseSitePaths,
    samePath,
    batFor,
    loadSettings,
    saveSettings,
    pad,
  };
})(typeof self !== 'undefined' ? self : this);
