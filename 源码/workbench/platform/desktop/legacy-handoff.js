'use strict';
const { PlatformError } = require('../domain/errors');

// Preserve the complete original renderer body. Only its startup call is replaced
// in the generated runtime snapshot, never in the canonical 41-file baseline.
function integrateLegacyRenderer(source) {
  const marker = 'startAuth();';
  const at = source.lastIndexOf(marker);
  if (at < 0 || !/^\s*\}\)\(\);\s*$/.test(source.slice(at + marker.length)))
    throw new PlatformError('LEGACY_HANDOFF_MISMATCH', '原录入模块入口已变化，不能生成融合副本。');
  const handoff = `
    if (window.desktop.bootstrap) {
      window.desktop.onNavigate(action => {
        if (['entry','records','analysis','followup'].includes(action)) showView(action);
        else if (action === 'settings') openSettings();
        else if (action === 'security') openSecurity();
        else if (action === 'appearance') window.Appearance?.open();
      });
      window.desktop.onFlush(requestId => {
        let ok = false;
        try { ok = !unlocked || saveSession(); } catch {}
        window.desktop.flushReady(requestId, ok);
      });
      window.desktop.bootstrap(defaults()).then(async result => {
        if (!result.ok) { document.getElementById('authError').textContent = result.error; return; }
        await enterWorkspace(result.value);
        window.desktop.ready();
      }).catch(() => { document.getElementById('authError').textContent = '异常记录模块打开失败，请重新打开工作区。'; });
    } else startAuth();
  `;
  return {
    source: source.slice(0, at) + handoff + source.slice(at + marker.length),
    originalPrefixLength: at,
    handoff,
  };
}
function integrateLegacyAppearance(source) {
  const marker = 'window.Appearance=Object.freeze({open});';
  if (source.split(marker).length !== 2)
    throw new PlatformError('LEGACY_HANDOFF_MISMATCH', '原外观入口已变化，请重新审查。');
  const replacement = `window.Appearance=Object.freeze({open,syncTheme(theme){
    if(dialog.open || !themes.some(item=>item[0]===theme))return;
    current=clean({...current,theme});apply(current);
    try{localStorage.setItem(KEY,JSON.stringify(current));}catch{}
  }});`;
  return { source: source.replace(marker, replacement), marker, replacement };
}
module.exports = { integrateLegacyRenderer, integrateLegacyAppearance };
