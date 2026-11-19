'use strict';
window.InsightSummary = Object.freeze({
  create(report, { onAction } = {}) {
    const make = (tag, className, text) => {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = String(text);
      return node;
    };
    const root = make('section', 'insight-summary');
    root.setAttribute('aria-label', '变化解读');
    const heading = make('div', 'insight-summary-heading');
    heading.append(make('h3', '', '变化解读'), make('span', '', report.scope || '当前范围'));
    root.append(heading);
    for (const item of report.highlights) {
      const row = make('div', 'insight-summary-row');
      const body = make('div', 'insight-summary-copy');
      body.append(make('strong', '', item.label), make('p', '', item.text));
      if (item.evidence?.length) {
        const details = make('details', 'insight-evidence'),
          summary = make('summary', '', '查看依据');
        details.append(summary, ...item.evidence.map((text) => make('p', '', text)));
        body.append(details);
      }
      row.append(body);
      if (item.action && onAction) {
        const button = make(
          'button',
          'insight-action',
          item.action.kind === 'quality' ? '核对数据' : '查看来源',
        );
        button.type = 'button';
        button.onclick = () => onAction(item.action);
        row.append(button);
      }
      root.append(row);
    }
    root.append(make('p', 'insight-footnote', report.note));
    return root;
  },
});
