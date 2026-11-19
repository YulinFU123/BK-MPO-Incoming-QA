'use strict';
window.createDataQualityUI = ({ api, getScope, unlocked, onOpen }) => {
  const root = document.getElementById('qualityResults'),
    biRoot = document.getElementById('biQualityResults');
  const refresh = document.getElementById('qualityRefresh'),
    biButton = document.getElementById('biQualityRefresh');
  const make = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = String(text);
    return node;
  };
  let generation = 0;
  function renderChecks(target, checks) {
    target.replaceChildren();
    const summary = make('p', 'quality-result-summary');
    const warnings = checks.filter((row) => row.count && row.severity === 'warning').length;
    const notices = checks.filter((row) => row.count && row.severity === 'notice').length;
    summary.textContent = `${warnings} 项需核对　${notices} 项提示　${checks.filter((row) => !row.count).length} 项未发现所列问题`;
    target.append(summary);
    for (const [source, title] of [
      ['quantity', '检验数量'],
      ['observations', '原异常记录'],
      ['bi', 'BI历史'],
    ]) {
      const rows = checks
        .filter((row) => row.source === source)
        .sort(
          (a, b) =>
            ({ warning: 0, notice: 1, ok: 2 })[a.severity] -
            { warning: 0, notice: 1, ok: 2 }[b.severity],
        );
      if (!rows.length) continue;
      const section = make('section', 'quality-group');
      section.append(make('h3', '', title));
      let passed = null;
      for (const item of rows) {
        const row = make('div', 'quality-check'),
          copy = make('div', 'quality-check-copy');
        row.dataset.qualityCheck = item.id;
        const head = make('div', 'quality-check-heading');
        const badge = make(
          'span',
          'quality-count ' + item.severity,
          item.count ? `${item.count} ${item.id.endsWith('gaps') ? '天' : '项'}` : '未发现所列问题',
        );
        head.append(make('strong', '', item.title), badge);
        copy.append(head, make('p', '', item.explanation));
        if (item.count && item.samples?.length) {
          const details = make('details', 'quality-locations');
          details.append(
            make('summary', '', `查看位置（显示 ${item.samples.length} / ${item.count}）`),
          );
          const list = make('ul', '');
          for (const sample of item.samples) {
            const li = make('li', ''),
              location = sample.date ? sample.date + '；' : '';
            const description = sample.factId
              ? `原表第 ${sample.rowNumber} 行；批次 ${sample.batchId}`
              : sample.recordId
                ? `原记录序位 ${sample.rowNumber}；ID ${sample.recordId}`
                : sample.batchId
                  ? `导入批次 ${sample.batchId}`
                  : '';
            li.append(
              make(
                'span',
                '',
                location + description + (sample.message ? '；' + sample.message : ''),
              ),
            );
            if (sample.factId) {
              const button = make('button', 'button quiet', '查看这行');
              button.type = 'button';
              button.onclick = () => onOpen(item, sample);
              li.append(button);
            }
            list.append(li);
          }
          details.append(list);
          copy.append(details);
        }
        row.append(copy);
        if (item.count && item.action) {
          const button = make(
            'button',
            'button secondary',
            item.action === 'data' ? '查看样本' : '前往核对',
          );
          button.type = 'button';
          button.onclick = () => onOpen(item);
          row.append(button);
        }
        if (item.count) section.append(row);
        else {
          if (!passed) {
            passed = make('details', 'quality-passed');
            passed.append(
              make(
                'summary',
                '',
                `其他项目（${rows.filter((item) => !item.count).length}项未发现所列问题）`,
              ),
            );
            section.append(passed);
          }
          passed.append(row);
        }
      }
      target.append(section);
    }
  }
  async function load() {
    const ticket = ++generation;
    document.getElementById('qualityScope').textContent = '正在核对所选范围…';
    refresh.disabled = true;
    biButton.disabled = true;
    root.replaceChildren(make('p', 'quality-message', '正在核对当前工作区…'));
    biRoot.replaceChildren(
      make('p', 'quality-message', 'BI历史尚未核对；点击“核对BI历史”按相同日期读取原引擎结果。'),
    );
    try {
      const report = await api('qualityReport', getScope());
      if (ticket !== generation || !unlocked()) return;
      renderChecks(root, report.checks);
      document.getElementById('qualityScope').textContent =
        `${report.scope.start} 至 ${report.scope.end}；已核对 ${report.checked.facts} 行检验数据、${report.checked.legacy} 条有效日期异常记录。`;
      if (!report.checked.facts)
        root.prepend(
          make(
            'p',
            'quality-message',
            '当前范围没有已保存检验数据，数量行检查没有样本；日期缺口只作提示。',
          ),
        );
      const note = make('div', 'quality-limits');
      for (const text of report.limits) note.append(make('p', '', text));
      root.append(note);
    } catch (error) {
      if (ticket === generation && unlocked()) {
        document.getElementById('qualityScope').textContent =
          '核对未完成，请先检查日期、数据集和筛选。';
        const message = make('p', 'quality-message error', `检查未完成：${error.message}`);
        message.setAttribute('role', 'alert');
        root.replaceChildren(message);
      }
    } finally {
      if (ticket === generation) {
        refresh.disabled = false;
        biButton.disabled = false;
      }
    }
  }
  async function loadBI() {
    const ticket = generation;
    biButton.disabled = true;
    biRoot.replaceChildren(make('p', 'quality-message', '正在核对BI历史，等待原引擎完成…'));
    try {
      const { start, end } = getScope();
      const report = await api('biQuality', { start, end });
      if (ticket !== generation || !unlocked()) return;
      renderChecks(biRoot, report.empty ? [] : report.checks);
      biRoot.prepend(make('p', 'quality-message', report.note));
    } catch (error) {
      if (ticket === generation && unlocked()) {
        const message = make('p', 'quality-message error', `BI检查未完成：${error.message}`);
        message.setAttribute('role', 'alert');
        biRoot.replaceChildren(message);
      }
    } finally {
      if (ticket === generation) biButton.disabled = false;
    }
  }
  refresh.onclick = load;
  biButton.onclick = loadBI;
  return Object.freeze({
    load,
    clear() {
      generation++;
      root.replaceChildren();
      biRoot.replaceChildren();
      document.getElementById('qualityScope').textContent = '';
    },
  });
};
