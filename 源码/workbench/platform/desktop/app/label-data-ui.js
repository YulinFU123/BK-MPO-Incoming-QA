'use strict';
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.createLabelDataUI = factory(root.LabelData);
})(
  globalThis,
  (model) =>
    function ({ getLegacyRows, toLegacy, defaults, onChange, document: doc = document }) {
      const $ = (id) => doc.getElementById(id),
        create = (tag, text) => {
          const node = doc.createElement(tag);
          if (text !== undefined) node.textContent = text;
          return node;
        };
      let data = [],
        selected = new Set(),
        past = [],
        page = 0;
      const size = 50,
        mode = () => $('labelInputMode').value;
      const status = (text, error = false) => {
        $('labelDataStatus').textContent = text;
        $('labelDataStatus').classList.toggle('error', error);
      };
      function commit(next, { history = true, redraw = true } = {}) {
        next = model.rows(next);
        if (history && JSON.stringify(next) !== JSON.stringify(data)) {
          past.push(structuredClone(data));
          if (past.length > 20) past.shift();
        }
        data = next;
        selected = new Set([...selected].filter((i) => i < data.length));
        if (redraw) render();
        else {
          tools();
          matches();
        }
        onChange();
      }
      function tools() {
        $('labelDataCount').textContent =
          `${data.length}行，选中${selected.size}行；第${page + 1}/${Math.max(1, Math.ceil(data.length / size))}页`;
        $('labelDataUndo').disabled = !past.length;
        $('labelDataPrevious').disabled = page === 0;
        $('labelDataNext').disabled = (page + 1) * size >= data.length;
      }
      function sync() {
        $('labelDataEditor').hidden = mode() !== 'table';
        $('labelCodeInput').hidden = mode() === 'table';
      }
      function render() {
        page = Math.max(0, Math.min(page, Math.ceil(data.length / size) - 1));
        const body = $('labelDataBody');
        body.replaceChildren();
        for (let i = page * size; i < Math.min(data.length, (page + 1) * size); i++) {
          const row = create('tr'),
            check = create('input');
          check.type = 'checkbox';
          check.checked = selected.has(i);
          check.setAttribute('aria-label', `选择第${i + 1}行`);
          check.onchange = () => {
            if (check.checked) selected.add(i);
            else selected.delete(i);
            tools();
            matches();
          };
          const choice = create('td');
          choice.append(check);
          row.append(choice, create('td', String(i + 1)));
          model.fields.forEach((key, column) => {
            const cell = create('td'),
              input = create('input');
            input.type = 'text';
            input.value = data[i][key];
            input.maxLength = model.limits[key];
            input.spellcheck = false;
            input.setAttribute('aria-label', `第${i + 1}行${model.titles[key]}`);
            input.oninput = () => {
              try {
                const next = structuredClone(data);
                next[i][key] = input.value;
                commit(next, { redraw: false });
              } catch (error) {
                status(error.message, true);
              }
            };
            input.onpaste = (event) => {
              const text = event.clipboardData?.getData('text/plain');
              if (!text || !/[\t\r\n]/.test(text)) return;
              event.preventDefault();
              try {
                commit(model.paste(data, text, { row: i, column }));
                status('已粘贴到对应单元格，可撤销。');
              } catch (error) {
                status(error.message, true);
              }
            };
            cell.append(input);
            row.append(cell);
          });
          body.append(row);
        }
        if (!data.length) {
          const row = create('tr'),
            cell = create('td', '暂无行数据。可添加一行、读取Excel或粘贴四列表格。');
          cell.colSpan = 6;
          row.append(cell);
          body.append(row);
        }
        tools();
        sync();
        matches();
      }
      function scope() {
        if ($('labelDataScope').value === 'all') return null;
        if (!selected.size) throw Error('请先勾选行，或将范围改为全部行。');
        return [...selected];
      }
      function operation(fill) {
        return model.edit(data, {
          field: $('labelDataField').value,
          find: $('labelDataFind').value,
          replacement: $('labelDataReplacement').value,
          selected: scope(),
          fill,
        });
      }
      function matches() {
        try {
          $('labelDataMatches').textContent = `替换将修改${operation(false).changed}行。`;
        } catch (error) {
          $('labelDataMatches').textContent = error.message;
        }
      }
      $('labelInputMode').onchange = () => {
        try {
          if (mode() === 'table' && !data.length) commit(getLegacyRows());
          else {
            if (mode() === 'codes') toLegacy(data);
            sync();
            onChange();
          }
          status(
            mode() === 'table'
              ? '每行独立保存名称、规格和制作人；空名称按空白输出。'
              : '仅编号模式使用统一名称与规格，表格数据仍保留。',
          );
        } catch (error) {
          status(error.message, true);
          sync();
        }
      };
      $('labelDataRebuild').onclick = () => {
        try {
          const next = getLegacyRows();
          $('labelInputMode').value = 'table';
          selected.clear();
          commit(next);
          status('已按编号列表重建表格，原表格可撤销恢复。');
        } catch (error) {
          status(error.message, true);
        }
      };
      $('labelDataAdd').onclick = () => {
        try {
          commit([...data, { code: '', ...defaults() }]);
          page = Math.floor((data.length - 1) / size);
          render();
          status('已新增空行，请填写编号后导出。');
        } catch (error) {
          status(error.message, true);
        }
      };
      $('labelDataDelete').onclick = () => {
        if (!selected.size) return status('请先勾选需要移除的行。', true);
        const next = data.filter((_, i) => !selected.has(i));
        selected.clear();
        commit(next);
        status('已移除所选行，可撤销。');
      };
      $('labelDataUndo').onclick = () => {
        if (!past.length) return;
        const next = past.pop();
        selected.clear();
        commit(next, { history: false });
        status('已撤销上次表格修改。');
      };
      $('labelDataSelectPage').onclick = () => {
        const indices = Array.from(
          { length: Math.min(size, data.length - page * size) },
          (_, j) => page * size + j,
        );
        const all = indices.every((i) => selected.has(i));
        indices.forEach((i) => (all ? selected.delete(i) : selected.add(i)));
        render();
      };
      for (const [id, replace] of [
        ['labelDataPasteReplace', true],
        ['labelDataPasteAppend', false],
      ])
        $(id).onclick = () => {
          try {
            const next = model.paste(data, $('labelDataPaste').value, {
              replace,
              row: data.length,
              recognizeHeader: true,
            });
            selected.clear();
            commit(next);
            status('已应用粘贴数据，可撤销。');
          } catch (error) {
            status(error.message, true);
          }
        };
      for (const [id, fill] of [
        ['labelDataReplace', false],
        ['labelDataFill', true],
      ])
        $(id).onclick = () => {
          try {
            const result = operation(fill);
            commit(result.rows);
            status(`已修改${result.changed}行，可撤销。`);
          } catch (error) {
            status(error.message, true);
          }
        };
      for (const id of [
        'labelDataScope',
        'labelDataField',
        'labelDataFind',
        'labelDataReplacement',
      ])
        $(id).addEventListener('input', matches);
      $('labelDataPrevious').onclick = () => {
        page--;
        render();
      };
      $('labelDataNext').onclick = () => {
        page++;
        render();
      };
      render();
      return Object.freeze({
        records: () => (mode() === 'table' ? model.rows(data) : getLegacyRows()),
        snapshot: () => ({ dataMode: mode(), records: model.rows(data) }),
        restore(value) {
          $('labelInputMode').value = value.dataMode || 'codes';
          if (Object.hasOwn(value, 'records')) {
            data = model.rows(value.records);
            past = [];
            selected.clear();
            page = 0;
          }
          render();
        },
        importRows(records) {
          const next = records.map((row) =>
            Object.fromEntries(model.fields.map((key) => [key, row[key] || ''])),
          );
          $('labelInputMode').value = 'table';
          page = 0;
          selected.clear();
          commit(next);
          status('Excel各行名称、规格、制作人已分别保留，请核对后导出。');
        },
        clear() {
          data = [];
          past = [];
          selected.clear();
          page = 0;
          $('labelInputMode').value = 'codes';
          $('labelDataPaste').value = '';
          $('labelDataFind').value = '';
          $('labelDataReplacement').value = '';
          $('labelDataScope').value = 'selected';
          $('labelDataField').value = 'name';
          render();
        },
      });
    },
);
