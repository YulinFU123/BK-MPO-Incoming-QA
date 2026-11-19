/* One optical grid and stroke weight for all application symbols. */
window.UISymbol = (() => {
  const shapes = {
    glass: '<rect x="4" y="4" width="16" height="16" rx="5"/><path d="m8 9 3-3m-3 7 7-7m1 9 1-1"/>',
    entry: '<rect x="5" y="4" width="14" height="17" rx="3"/><path d="M9 4V3h6v1M9 10h6m-6 4h4"/>',
    records: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9h18M9 9v11"/>',
    analysis: '<path d="M4 4v16h16M8 16v-4m4 4V8m4 8V5"/>',
    followup: '<rect x="4" y="5" width="16" height="16" rx="3"/><path d="M8 3v4m8-4v4M4 11h16m-11 5 2 2 4-4"/>',
    settings: '<path d="M4 6h4m4 0h8M4 12h10m4 0h2M4 18h2m4 0h10"/><circle cx="10" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="8" cy="18" r="2"/>',
    backup: '<path d="M12 3v12m-4-4 4 4 4-4M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
    scan: '<path d="M8 3H4a1 1 0 0 0-1 1v4m13-5h4a1 1 0 0 1 1 1v4M3 16v4a1 1 0 0 0 1 1h4m8 0h4a1 1 0 0 0 1-1v-4M7 8v8m4-8v8m3-8v8m3-8v8"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    down: '<path d="m7 10 5 5 5-5"/>',
    up: '<path d="m7 14 5-5 5 5"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    import: '<path d="M12 16V3m-4 4 4-4 4 4M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3"/>'
  };
  function create(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.classList.add('ui-symbol');
    svg.innerHTML = shapes[name] || shapes.entry;
    return svg;
  }
  function decorate() {
    document.querySelectorAll('[data-nav]').forEach(button => button.querySelector('svg')?.replaceWith(create(button.dataset.nav)));
    const buttons = {sideConfig:'settings',sideBackup:'backup',openSecurity:'lock',lockBtn:'lock',openBatch:'scan',saveRecord:'check',importExcel:'import',exportXlsx:'backup',analysisExport:'backup',followupExport:'backup'};
    for (const [id, name] of Object.entries(buttons)) {
      const button = document.getElementById(id);
      if (!button) continue;
      button.querySelector('svg')?.remove();
      button.prepend(create(name));
      button.classList.add('with-symbol');
    }
    document.querySelectorAll('.part-mark').forEach(mark => mark.replaceChildren(create('entry')));
    document.querySelectorAll('.close-x').forEach(button => button.replaceChildren(create('close')));
  }
  return Object.freeze({create, decorate});
})();
