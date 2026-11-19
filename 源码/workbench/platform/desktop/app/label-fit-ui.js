'use strict';
window.createLabelFitUI = ({ getConfig, getRecords, apply, onChange = () => {} }) => {
  const $ = (id) => document.getElementById(id);
  let prepared = null,
    signature = '';
  const state = () => ({
    width: Number($('labelFitWidth').value),
    height: Number($('labelFitHeight').value),
    mode: $('labelFitMode').value,
  });
  const fingerprint = () =>
    JSON.stringify([getConfig(), getRecords(), state(), $('labelFitConfirm').checked]);
  function invalidate() {
    prepared = null;
    $('labelFitApply').disabled = true;
    $('labelFitPreview').replaceChildren();
  }
  for (const id of ['labelFitWidth', 'labelFitHeight', 'labelFitMode', 'labelFitConfirm'])
    $(id).addEventListener('input', () => {
      invalidate();
      onChange();
    });
  for (const [id, width, height] of [
    ['labelFitFixture', 50, 50],
    ['labelFitStripper', 62, 20],
  ])
    $(id).onclick = () => {
      $('labelFitWidth').value = width;
      $('labelFitHeight').value = height;
      invalidate();
      onChange();
    };
  $('labelFitTest').onclick = () => {
    invalidate();
    try {
      prepared = window.LabelFit.fit(getConfig(), getRecords(), {
        ...state(),
        replaceCustom: $('labelFitConfirm').checked,
      });
      signature = fingerprint();
      $('labelFitPreview').innerHTML = window.LabelRender.labelSvg(prepared.plan);
      $('labelFitStatus').textContent =
        `${prepared.config.width}×${prepared.config.height}mm，二维码${prepared.plan.qrSize}mm，${prepared.plan.layout === 'custom' ? '保留自定义布局' : prepared.plan.layout === 'vertical' ? '上下排版' : '左右排版'}。${prepared.warnings.join(' ')}`;
      $('labelFitApply').disabled = false;
    } catch (error) {
      $('labelFitStatus').textContent = error.message;
    }
  };
  $('labelFitApply').onclick = () => {
    try {
      if (!prepared || fingerprint() !== signature)
        throw Error('内容或设置已改变，请重新预览适配。');
      const next = prepared.config;
      if (apply(next)) {
        $('labelFitStatus').textContent = '已应用适配，可使用设计区撤销恢复。';
        invalidate();
      }
    } catch (error) {
      invalidate();
      $('labelFitStatus').textContent = error.message;
    }
  };
  return Object.freeze({
    invalidate,
    snapshot: state,
    restore(value, config) {
      const next = value || {
        width: config.width,
        height: config.height,
        mode: config.composition === 'custom' ? 'scale' : 'reflow',
      };
      $('labelFitWidth').value = next.width;
      $('labelFitHeight').value = next.height;
      $('labelFitMode').value = next.mode;
      $('labelFitConfirm').checked = false;
      invalidate();
    },
  });
};
