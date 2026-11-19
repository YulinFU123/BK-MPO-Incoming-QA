'use strict';
(function (root, factory) {
  const value = factory(
    typeof module === 'object' && module.exports ? require('./label-layout') : root.LabelLayout,
  );
  if (typeof module === 'object' && module.exports) module.exports = value;
  else root.LabelFit = value;
})(typeof window === 'object' ? window : null, (layout) => {
  function fit(input, records, { width, height, mode = 'scale', replaceCustom = false }) {
    const original = layout.config(input);
    if (!['scale', 'reflow'].includes(mode)) throw Error('请选择保留版式缩放或按内容重排。');
    if (mode === 'reflow' && original.composition === 'custom' && !replaceCustom)
      throw Error('按内容重排会替换自定义位置与固定装饰，请先确认；应用后仍可撤销。');
    const candidate = { ...original, width, height };
    if (mode === 'scale') {
      const plan = layout.plan(candidate, records);
      return { config: plan.config, plan, warnings: [...plan.warnings], replacedCustom: false };
    }
    Object.assign(candidate, {
      composition: 'auto',
      template: null,
      layout: 'auto',
      qrMode: 'auto',
      padding: Math.min(original.padding, width / 10, height / 10),
    });
    let last;
    for (
      let font = original.fontSize;
      font >= 3;
      font = Math.max(2.5, Math.round((font - 0.5) * 10) / 10)
    ) {
      try {
        const plan = layout.plan({ ...candidate, fontSize: font }, records),
          warnings = [...plan.warnings];
        if (font < original.fontSize)
          warnings.push(`字号由${original.fontSize}pt适配为${font}pt，文字未删除。`);
        if (font < 6) warnings.push('适配字号较小，建议增大标签或减少显示项，并先试印。');
        if (original.composition === 'custom')
          warnings.push('此预览采用自动布局，将替换原自定义位置与固定装饰；原配置可撤销恢复。');
        return {
          config: plan.config,
          plan,
          warnings,
          replacedCustom: original.composition === 'custom',
        };
      } catch (error) {
        last = error;
      }
    }
    throw Error(`当前尺寸无法容纳已选内容：${last?.message || '请增加标签尺寸。'}`);
  }
  return Object.freeze({ fit });
});
