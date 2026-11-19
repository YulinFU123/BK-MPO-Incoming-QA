'use strict';
window.chooseWorkspaceSource = ({ name = '' } = {}) =>
  new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'wm-dialog source-choice';
    const title = document.createElement('h2');
    title.id = 'workspaceSourceTitle';
    title.textContent = '选择工作区类型';
    dialog.setAttribute('aria-labelledby', title.id);
    const note = document.createElement('p');
    note.textContent = (name ? name + '：' : '') + '只显示所选类型的功能，原数据保留。';
    dialog.append(title, note);
    let value = null;
    for (const [mode, label, detail] of [
      ['records', '手动录入不良', '扫码和快捷录入、记录查询、处理跟进、记录分析'],
      ['bi', 'BI报表不良', '读取BI文件、字段筛选、日周月分析、图表和报告'],
    ]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'wm-button source-choice-option';
      button.dataset.sourceMode = mode;
      const name = document.createElement('strong'),
        description = document.createElement('span');
      name.textContent = label;
      description.textContent = detail;
      button.append(name, description);
      button.onclick = () => {
        value = mode;
        dialog.close();
      };
      dialog.append(button);
    }
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'wm-button';
    cancel.textContent = '取消';
    cancel.onclick = () => dialog.close();
    dialog.append(cancel);
    dialog.addEventListener(
      'close',
      () => {
        dialog.remove();
        resolve(value);
      },
      { once: true },
    );
    document.body.append(dialog);
    dialog.showModal();
  });
