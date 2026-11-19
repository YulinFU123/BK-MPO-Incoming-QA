'use strict';
(function (root, factory) {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.WorkbenchTheme = model;
})(typeof window === 'object' ? window : null, () => {
  const silver = {
    canvas: '#eef2f6',
    nav: '#e2e8ef',
    surface: '#fbfcfd',
    subtle: '#f3f6f9',
    text: '#142333',
    muted: '#536576',
    line: '#c8d2de',
    input: '#7c8da0',
    accent: '#0969c8',
    hover: '#0759ab',
    accentInk: '#ffffff',
    selected: '#d7e7f8',
    danger: '#a52d34',
    dangerSoft: '#fff0f0',
    warning: '#865718',
    warningSoft: '#fff5df',
    positive: '#236a54',
    positiveSoft: '#e6f3ed',
    comparison: '#7548aa',
    chartAlt: '#9b5219',
    shadow: '0 12px 32px #14233326',
    scheme: 'light',
  };
  const themes = {
    silver,
    glass: {
      ...silver,
      canvas: '#e7eff8',
      nav: '#dce7f3',
      surface: '#f9fbfe',
      subtle: '#e9f1fa',
      line: '#b5c9df',
      accent: '#0864b8',
      hover: '#064f95',
    },
    graphite: {
      canvas: '#171e27',
      nav: '#202b37',
      surface: '#242e3b',
      subtle: '#1d2733',
      text: '#edf2f8',
      muted: '#b8c5d4',
      line: '#445467',
      input: '#8091a5',
      accent: '#82b8ff',
      hover: '#9ac8ff',
      accentInk: '#122339',
      selected: '#354b64',
      danger: '#ffb0b5',
      dangerSoft: '#3d2831',
      warning: '#f2cc8c',
      warningSoft: '#493c28',
      positive: '#8ed5bb',
      positiveSoft: '#243f38',
      comparison: '#d3b5ff',
      chartAlt: '#f2be85',
      shadow: '0 12px 32px #0005',
      scheme: 'dark',
    },
    contrast: {
      ...silver,
      canvas: '#ffffff',
      nav: '#edf0f3',
      surface: '#ffffff',
      subtle: '#f0f2f4',
      text: '#101820',
      muted: '#344555',
      line: '#344555',
      input: '#344555',
      accent: '#00478a',
      hover: '#003568',
      selected: '#d4e6ff',
      danger: '#96021d',
      dangerSoft: '#ffedf0',
      warning: '#704500',
      warningSoft: '#fff0c7',
      positive: '#095637',
      positiveSoft: '#dff2e8',
      comparison: '#5d196e',
      chartAlt: '#863900',
      shadow: 'none',
    },
  };
  function normalize(value) {
    return value === 'professional' ? 'silver' : Object.hasOwn(themes, value) ? value : 'silver';
  }
  function palette(value) {
    return Object.freeze({ ...themes[normalize(value)] });
  }
  function variables(theme, { forcedColors = false } = {}) {
    let p = palette(theme);
    if (forcedColors)
      p = {
        ...p,
        canvas: 'Canvas',
        nav: 'Canvas',
        surface: 'Canvas',
        subtle: 'Canvas',
        text: 'CanvasText',
        muted: 'CanvasText',
        line: 'CanvasText',
        input: 'CanvasText',
        accent: 'Highlight',
        hover: 'Highlight',
        accentInk: 'HighlightText',
        selected: 'Canvas',
        danger: 'CanvasText',
        dangerSoft: 'Canvas',
        warning: 'CanvasText',
        warningSoft: 'Canvas',
        positive: 'CanvasText',
        positiveSoft: 'Canvas',
        comparison: 'CanvasText',
        chartAlt: 'CanvasText',
        shadow: 'none',
        scheme: 'light dark',
      };
    const out = {};
    function put(names, value) {
      for (const name of names.split(' ')) out['--' + name] = value;
    }
    put('canvas page bg hs-bg paper', p.canvas);
    put('nav rail', p.nav);
    put(
      'surface panel card control surface-raised popup-surface glass-surface hs-surface field-bg choice-field choice-layer cs-surface',
      p.surface,
    );
    put(
      'surface-2 surface-subtle panel-subtle stripe header-bg field-readonly field-disabled',
      p.subtle,
    );
    put(
      'text ink txt navy hs-text rail-ink metric-ink header-ink field-ink choice-ink cs-ink',
      p.text,
    );
    put(
      'muted sub ink-2 hs-muted wm-muted rail-muted metric-muted field-muted choice-muted cs-muted',
      p.muted,
    );
    put('line line-soft hs-line wm-line rail-line glass-line', p.line);
    put('input-line field-line choice-line', p.input);
    put(
      'accent primary pri blue navy2 navy-2 hs-blue wm-accent focus focus-ring field-focus choice-accent cs-line-0 chart-color teal',
      p.accent,
    );
    put('accent-hover field-hover', p.hover);
    put('accent-ink choice-accent-ink', p.accentInk);
    put('accent-soft selected blue-l pri-soft teal-soft choice-soft chart-track', p.selected);
    put('selected-ink', p.text);
    put('danger bad field-error', p.danger);
    put('danger-soft error-bg bad-l field-error-bg', p.dangerSoft);
    put('warning warn amber', p.warning);
    put('warning-soft warn-l amber-soft', p.warningSoft);
    put('positive success ok cs-line-2', p.positive);
    put('positive-soft success-bg ok-l', p.positiveSoft);
    put('comparison cs-line-3', p.comparison);
    put('chart-alt cs-line-1', p.chartAlt);
    put('cs-grid', p.input);
    put('metric-bg', p.subtle);
    put('shadow choice-shadow frame-shadow', p.shadow);
    return Object.freeze({ ...out, 'color-scheme': p.scheme });
  }
  function applyDocument(root, value, surface = 'shell', options = {}) {
    if (!['shell', 'bi', 'legacy'].includes(surface)) throw Error('Theme surface invalid');
    const theme = normalize(value),
      vars = variables(theme, options);
    for (const [name, color] of Object.entries(vars))
      root.style.setProperty(name, color, 'important');
    root.dataset.uiTheme = theme;
    root.dataset.themeSurface = surface;
    return theme;
  }
  function embeddedScript(value, surface) {
    if (!['bi', 'legacy'].includes(surface)) throw Error('Embedded theme surface invalid');
    const theme = normalize(value);
    return `(()=>{const root=document.documentElement;root.dataset.fusionTheme=${JSON.stringify(theme)};${surface === 'legacy' ? `window.Appearance?.syncTheme(${JSON.stringify(theme === 'silver' ? 'professional' : theme)});` : ''}if(!window.WorkbenchTheme)throw Error('Theme contract missing');window.WorkbenchTheme.applyDocument(root,${surface === 'legacy' ? `root.dataset.theme||${JSON.stringify(theme)}` : JSON.stringify(theme)},${JSON.stringify(surface)},{forcedColors:typeof matchMedia==='function'&&matchMedia('(forced-colors: active)').matches});})()`;
  }
  function windowColors(value) {
    const p = palette(value);
    return { color: p.canvas, symbolColor: p.text };
  }
  return Object.freeze({
    normalize,
    palette,
    variables,
    applyDocument,
    embeddedScript,
    windowColors,
    themes: Object.freeze(Object.keys(themes)),
  });
});
