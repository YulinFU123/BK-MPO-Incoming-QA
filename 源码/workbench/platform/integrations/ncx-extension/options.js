const $ = (id) => document.getElementById(id);
const KEYS = Object.keys(NCX.DEFAULTS);
const WD = '日一二三四五六';
const BATS = ['batPath', 'batPathMonthly'];

function fill(s) {
  KEYS.forEach((k) => {
    const el = $(k);
    if (!el) return;
    if (el.type === 'checkbox') el.checked = !!s[k];
    else el.value = s[k];
  });
  datePreview();
}
function collect() {
  const s = {};
  KEYS.forEach((k) => {
    const el = $(k);
    s[k] = !el
      ? NCX.DEFAULTS[k]
      : el.type === 'checkbox'
        ? el.checked
        : el.type === 'number'
          ? +el.value
          : el.value.trim();
  });
  BATS.forEach((k) => (s[k] = s[k].replace(/^"+|"+$/g, '')));
  return s;
}
function msg(t, cls) {
  $('msg').textContent = t;
  $('msg').className = cls || '';
}
function datePreview() {
  const s = collect(),
    rows = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const p = NCX.previousWorkday(s, d);
    rows.push(
      `<tr><td>${NCX.ymd(d)}（周${WD[d.getDay()]}）运行</td><td>→ 导出 ${p ? NCX.ymd(p) + '（周' + WD[p.getDay()] + '）' : '—'}</td></tr>`,
    );
  }
  const mr = NCX.monthRange(NCX.previousMonth());
  rows.push(`<tr><td>今天运行月度模式</td><td>→ 导出 ${mr[0]} ~ ${mr[1]}</td></tr>`);
  $('datePreview').innerHTML = '<table>' + rows.join('') + '</table>';
}
function testRule() {
  const s = collect();
  const vals = $('testVals')
    .value.split(/[,，]/)
    .map((x) => x.trim())
    .filter(Boolean);
  $('testOut').innerHTML =
    '<table>' +
    vals
      .map((v) => {
        const r = NCX.judgeConnector(v, s);
        return `<tr><td>${v.replace(/</g, '&lt;')}</td><td class="${r.keep ? 'k' : 'x'}">${r.keep ? '保留' : '排除（' + r.reason + '）'}</td></tr>`;
      })
      .join('') +
    '</table>';
}
function native(payload) {
  return new Promise((res) =>
    chrome.runtime.sendNativeMessage(NCX.HOST_NAME, payload, (r) => {
      if (chrome.runtime.lastError)
        res({ ok: false, nativeError: true, message: chrome.runtime.lastError.message });
      else res(r || { ok: false, message: '无返回' });
    }),
  );
}
const folderOf = (p) =>
  String(p || '')
    .replace(/[\\/][^\\/]*$/, '')
    .toLowerCase();
async function checkPath(k) {
  const box = $('info_' + k);
  const p = $(k)
    .value.trim()
    .replace(/^"+|"+$/g, '');
  if (!p) {
    box.textContent = '';
    return;
  }
  const other = $(BATS.find((x) => x !== k))
    .value.trim()
    .replace(/^"+|"+$/g, '');
  let warn = '';
  if (NCX.samePath(p, other))
    warn =
      '<br><span class="err">✖ 和' +
      (k === 'batPath' ? '月度' : '每日') +
      '分析程序是同一个文件，不能保存</span>';
  else if (other && folderOf(p) === folderOf(other))
    warn =
      '<br><span class="err">⚠ 和' +
      (k === 'batPath' ? '月度' : '每日') +
      '分析程序在同一个文件夹，两个程序可能读到对方的 data 文件，建议分开</span>';
  const r = await native({ action: 'checkPath', batPath: p });
  if (r.nativeError) {
    box.innerHTML = '<span class="err">无法检查路径（本地小程序未连通）</span>' + warn;
    return;
  }
  box.innerHTML =
    (r.ok
      ? `<span class="ok">✔ 找到 bat，目标文件夹：${r.folder}</span>` +
        (r.pending && r.pending.length
          ? `<br><span class="err">文件夹里有未处理的：${r.pending.join('、')}</span>`
          : '')
      : `<span class="err">✖ ${r.message}</span>`) + warn;
}
(async () => {
  $('ver').textContent = 'v' + NCX.VERSION;
  fill(await NCX.loadSettings());
  const lr = (await chrome.storage.local.get('lastResult')).lastResult;
  if (lr)
    $('last').textContent =
      new Date(lr.at).toLocaleString() +
      '  ' +
      (lr.mode === 'monthly' ? '[月度] ' : '[每日] ') +
      (lr.ok ? '成功：' : '失败：') +
      (lr.dest || lr.message || '');
  ['holidays', 'makeupDays'].forEach((k) => $(k).addEventListener('input', datePreview));
  $('saturdayWorkday').addEventListener('change', datePreview);
  $('testBtn').onclick = testRule;
  ['excludeKeywords', 'exceptionWords', 'overrides'].forEach((k) =>
    $(k).addEventListener('input', testRule),
  );
  testRule();
  BATS.forEach((k) => {
    $(k).addEventListener('change', () => BATS.forEach(checkPath));
    checkPath(k);
  });
  $('save').onclick = async () => {
    const s = collect();
    for (const k of BATS)
      if (s[k] && !/\.(bat|cmd)$/i.test(s[k])) {
        msg((k === 'batPath' ? '每日' : '月度') + '分析程序要以 .bat 结尾', 'err');
        return;
      }
    if (NCX.samePath(s.batPath, s.batPathMonthly)) {
      msg('每日和月度的分析程序不能是同一个文件', 'err');
      return;
    }
    await NCX.saveSettings(s);
    msg('已保存 ' + new Date().toLocaleTimeString(), 'ok');
    BATS.forEach(checkPath);
  };
  $('reset').onclick = async () => {
    if (!confirm('恢复全部默认设置？（两个分析程序路径也会清空）')) return;
    fill(NCX.DEFAULTS);
    await NCX.saveSettings(Object.assign({}, NCX.DEFAULTS));
    msg('已恢复默认', 'ok');
  };
  document.querySelectorAll('[data-browse]').forEach(
    (b) =>
      (b.onclick = async () => {
        const k = b.dataset.browse;
        msg('正在打开选择窗口（可能在浏览器后面）…');
        const r = await native({ action: 'browseBat', initial: $(k).value });
        if (r.ok && r.path) {
          $(k).value = r.path;
          msg('已选择，记得点保存');
          BATS.forEach(checkPath);
        } else if (r.nativeError) msg('本地小程序未连通，请直接粘贴路径：' + r.message, 'err');
        else msg('未选择');
      }),
  );
  $('ping').onclick = async () => {
    $('pingOut').textContent = '测试中…';
    const r = await native({ action: 'ping' });
    $('pingOut').innerHTML = r.ok
      ? `<span class="ok">✔ 已连通（小程序 v${r.version}，PowerShell ${r.ps}）</span>`
      : `<span class="err">✖ ${r.message}。请先运行 install.bat；还不行就运行 test_connection.bat</span>`;
  };
})();
