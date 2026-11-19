'use strict';
(() => {
  if (window.FieldControls) return;
  let sequence = 0;
  const controls =
    'input:not([type="hidden"],[type="button"],[type="submit"],[type="reset"],[type="image"]),textarea,select';
  function identify(node, prefix) {
    if (node.id) return node.id;
    let id;
    do {
      id = prefix + ++sequence;
    } while (document.getElementById(id));
    node.id = id;
    return id;
  }
  function reference(input, name, target) {
    const ids = new Set((input.getAttribute(name) || '').split(/\s+/).filter(Boolean));
    ids.add(identify(target, 'field-label-'));
    input.setAttribute(name, [...ids].join(' '));
  }
  function enhance(root = document) {
    const list = [...root.querySelectorAll(controls)];
    if (root.matches?.(controls)) list.unshift(root);
    for (const input of list) {
      if (
        input.labels?.length ||
        input.getAttribute('aria-label') ||
        input.getAttribute('aria-labelledby')
      )
        continue;
      const parent = input.parentElement;
      if (!parent) continue;
      const label =
        parent.querySelector(':scope>label.f,:scope>label:not([for])') ||
        (parent.previousElementSibling?.matches('label:not([for])')
          ? parent.previousElementSibling
          : null);
      if (label && !label.contains(input) && label.textContent.trim()) {
        const siblings = parent.querySelectorAll(controls);
        if (siblings.length === 1) label.htmlFor = identify(input, 'field-control-');
        else reference(input, 'aria-labelledby', label);
        input.dataset.fieldLabelSource = 'existing-label';
        const hint = parent.querySelector(':scope>.hint,:scope>.field-help');
        if (hint) reference(input, 'aria-describedby', hint);
        continue;
      }
      const cell = input.closest('td');
      const header = cell?.closest('table')?.querySelector('thead tr')?.children[cell.cellIndex];
      if (header?.textContent.trim()) {
        const row = cell.parentElement.rowIndex;
        input.setAttribute('aria-label', '第' + row + '行 ' + header.textContent.trim());
        input.dataset.fieldLabelSource = 'table-heading';
      } else if (input.placeholder?.trim()) {
        input.setAttribute('aria-label', input.placeholder.trim());
        input.dataset.fieldLabelSource = 'placeholder-context';
      } else if (input.title?.trim()) {
        input.setAttribute('aria-label', input.title.trim());
        input.dataset.fieldLabelSource = 'existing-title';
      }
    }
  }
  function start() {
    enhance();
    new MutationObserver(() => enhance()).observe(document.body, {
      childList: true,
      subtree: true,
    });
  }
  window.FieldControls = Object.freeze({ enhance });
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
