'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const samples = [
    { name: '本期记录', values: [3, 5, 0, null, 4, 7, 2] },
    { name: '前期记录', values: [2, 5, 1, 3, 4, 6, 1] },
  ];
  const labels = ['10/21', '10/22', '10/23', '10/24', '10/25', '10/26', '10/27'];
  let pass = 0,
    fail = 0;
  const records = [];
  const next = () =>
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  function expect(value, message) {
    if (!value) throw Error(message);
  }
  async function check(label, fn) {
    const row = document.createElement('tr'),
      a = document.createElement('td'),
      b = document.createElement('td');
    a.textContent = label;
    try {
      await fn();
      pass++;
      b.className = 'pass';
      b.textContent = '已通过';
      records.push({ label, status: 'passed' });
    } catch (error) {
      fail++;
      b.className = 'fail';
      b.textContent = '失败：' + error.message;
      records.push({ label, status: 'failed', message: error.message });
    }
    row.append(a, b);
    $('surfaceResults').append(row);
    $('surfaceSummary').textContent = pass + '通过，' + fail + '失败';
  }
  function rgb(value) {
    return (value.match(/[\d.]+/g) || [])
      .slice(0, 3)
      .map(Number)
      .map((n) => {
        n /= 255;
        return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
      });
  }
  function contrast(a, b) {
    const x = rgb(a),
      y = rgb(b),
      l = (v) => v[0] * 0.2126 + v[1] * 0.7152 + v[2] * 0.0722;
    return (Math.max(l(x), l(y)) + 0.05) / (Math.min(l(x), l(y)) + 0.05);
  }
  $('runSurface').onclick = async () => {
    $('runSurface').disabled = true;
    window.FieldControls.enhance();
    await check('既有标签关联原控件，可点击定位；提示引用保留', () => {
      for (const id of [
        'plain',
        'find',
        'quantity',
        'date',
        'masked',
        'readonly',
        'disabled',
        'invalid',
        'multiline',
      ])
        expect($(id).labels.length > 0, '缺少关联标签：' + id);
      expect($('invalid').getAttribute('aria-describedby').includes('errorHint'), '原错误提示丢失');
      expect(
        $('multiline').getAttribute('aria-describedby').includes('remarkHint'),
        '备注提示未关联',
      );
    });
    await check('只增强原对象，不重写值、原事件或数值约束', () => {
      const input = $('plain');
      let inputs = 0,
        changes = 0;
      input.addEventListener('input', () => inputs++);
      input.addEventListener('change', () => changes++);
      window.FieldControls.enhance();
      input.dispatchEvent(new Event('input'));
      input.dispatchEvent(new Event('change'));
      expect(input.value === '0012 Aa 中文' && inputs === 1 && changes === 1, '值或事件发生变化');
      expect(
        $('quantity').min === '0' && $('quantity').max === '99' && $('quantity').step === '1',
        '数值约束发生变化',
      );
    });
    await check('多行框使用同一字体，允许纵向调整；只读可复制、禁用不启用', () => {
      expect(
        getComputedStyle($('plain')).fontFamily === getComputedStyle($('multiline')).fontFamily,
        '字体不一致',
      );
      expect(getComputedStyle($('multiline')).resize === 'vertical', '多行框无法纵向调整');
      expect(
        $('readonly').readOnly && $('readonly').value === '0012' && $('disabled').disabled,
        '只读/禁用语义改变',
      );
      expect($('masked').type === 'password' && $('masked').value === '', '密码框被改写');
      expect(getComputedStyle($('checkbox')).minHeight !== '36px', '复选框被改为文本框');
    });
    for (const theme of ['silver', 'glass', 'graphite', 'contrast'])
      await check(theme + '主题下文字、占位、边框、只读和错误可辨', async () => {
        document.documentElement.dataset.theme = theme;
        await next();
        for (const id of ['plain', 'multiline', 'readonly', 'disabled', 'invalid']) {
          const c = getComputedStyle($(id));
          expect(contrast(c.color, c.backgroundColor) >= 4.5, id + '文字对比不足');
          expect(c.fontSize === '13px', '标准字号失效');
        }
        const normal = getComputedStyle($('plain')),
          placeholder = getComputedStyle($('plain'), '::placeholder');
        expect(contrast(placeholder.color, normal.backgroundColor) >= 4.5, '占位对比不足');
        expect(contrast(normal.borderColor, normal.backgroundColor) >= 3, '边框对比不足');
        expect(getComputedStyle($('invalid')).borderColor !== normal.borderColor, '错误边框不可辨');
        expect(getComputedStyle($('readonly')).borderStyle === 'dashed', '只读状态不可辨');
      });
    await check('较大字号同时适用于文本、多行和日期；Tab顺序仍由原DOM决定', async () => {
      document.documentElement.dataset.font = 'large';
      await next();
      for (const id of ['plain', 'multiline', 'date'])
        expect(getComputedStyle($(id)).fontSize === '15px', '较大字号失效');
      expect($('plain').tabIndex === 0 && $('multiline').tabIndex === 0, '新增了自定义Tab排序');
      delete document.documentElement.dataset.font;
    });
    await check('文本焦点有清楚轮廓，较大字号不改变输入内容', async () => {
      const input = $('plain');
      input.focus({ preventScroll: true });
      await next();
      const style = getComputedStyle(input);
      // Chromium quantizes 2px to 1.6px at the current display scale; compare with its 1px border.
      expect(
        input.matches(':focus-visible') &&
          style.outlineStyle === 'solid' &&
          parseFloat(style.outlineWidth) >=
            Math.max(1.5, parseFloat(style.borderTopWidth) * 2 - 0.05) &&
          contrast(style.outlineColor, style.backgroundColor) >= 3,
        '焦点不明显',
      );
      expect(input.value === '0012 Aa 中文', '焦点或字号修改了原文');
    });
    const chart = window.ChartSurface.create({
      labels,
      series: samples,
      title: '构造记录趋势',
      unit: '条记录',
    });
    $('chartFixture').append(chart);
    await next();
    await check('每个真实折点均有对应数值，零与缺数分开，日期全量显示', () => {
      expect(chart.querySelectorAll('.cs-point').length === 13, '折点数量不符');
      expect(chart.querySelectorAll('.cs-value').length === 13, '未给每个折点标数');
      expect(
        [...chart.querySelectorAll('.cs-value')].some((n) => n.textContent === '0'),
        '零值没有标数',
      );
      expect(chart.querySelectorAll('.cs-missing').length === 1, '缺数被当作零');
      expect(chart.querySelectorAll('.cs-axis[data-period]').length === 7, '日期被抽样隐藏');
      expect(chart.querySelectorAll('.cs-grid').length >= 4, '缺少水平刻度线');
    });
    await check('横向滚动时纵轴固定、数据标签不被缩小', async () => {
      const scroll = chart.querySelector('.cs-scroll'),
        axis = chart.querySelector('.cs-fixed-axis'),
        label = chart.querySelector('.cs-value');
      const before = axis.getBoundingClientRect().left;
      scroll.style.maxWidth = '360px';
      await next();
      expect(
        chart.querySelector('.cs-value[data-period="0"]').getBoundingClientRect().left >=
          axis.getBoundingClientRect().right,
        '固定纵轴遮住首个标数',
      );
      expect(
        chart.querySelector('.cs-axis[data-period="0"]').getBoundingClientRect().left >=
          axis.getBoundingClientRect().right,
        '固定纵轴遮住首个日期',
      );
      scroll.scrollLeft = scroll.scrollWidth;
      await next();
      expect(scroll.scrollLeft > 0, '未实际执行横向滚动');
      expect(Math.abs(axis.getBoundingClientRect().left - before) < 2, '纵轴随图移出');
      expect(getComputedStyle(label).fontSize === '13px', '标数随图压缩');
      expect(axis.getBoundingClientRect().width < 120, '纵轴宽度被原样式覆盖');
      scroll.scrollLeft = 0;
      scroll.style.maxWidth = '';
    });
    await check('密集数据全量标数，保留细项表；标签按纯文字呈现', () => {
      const many = window.ChartSurface.create({
        labels: Array.from({ length: 101 }, (_, i) => '周期' + i),
        series: [{ name: '<img onerror=bad()>', values: Array.from({ length: 101 }, (_, i) => i) }],
        unit: 'pcs',
      });
      expect(many.querySelectorAll('.cs-value').length === 101, '密集数据丢标签');
      expect(many.querySelectorAll('tbody tr').length === 101, '明细表缺行');
      expect(!many.querySelector('img'), '名称被解释为HTML');
    });
    await check('多系列分成同一刻度的小图，每条数据均可读', () => {
      const multi = window.ChartSurface.create({
        labels: ['1', '2'],
        series: [
          { name: 'A', values: [1, 2] },
          { name: 'B', values: [4, 5] },
          { name: 'C', values: [8, 10] },
        ],
        unit: 'pcs',
      });
      expect(multi.querySelectorAll('.cs-series-pane').length === 3, '多系列仍叠在一张图');
      expect(multi.querySelectorAll('.cs-value').length === 6, '多系列数据标数不全');
      const axes = [...multi.querySelectorAll('.cs-fixed-axis')].map((n) => n.textContent);
      expect(new Set(axes).size === 1, '小图刻度不一致');
    });
    await check('比率显示为百分数，原钻取点击仍触发一次', () => {
      let clicked = 0;
      const rate = window.ChartSurface.create({
        labels: ['1', '2'],
        series: [{ name: '不良率', values: [0.0267, 0] }],
        unit: '%',
        percent: true,
        onPoint: () => clicked++,
      });
      expect(
        [...rate.querySelectorAll('.cs-value')].map((n) => n.textContent).join(',') === '2.67%,0%',
        '比率错误放大或零值丢失',
      );
      rate.querySelector('.cs-point').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(clicked === 1, '钻取重复触发');
    });
    for (const theme of ['silver', 'glass', 'graphite', 'contrast'])
      await check(theme + '图表标数与刻度文字可读', async () => {
        document.documentElement.dataset.theme = theme;
        await next();
        for (const node of [chart.querySelector('.cs-value'), chart.querySelector('.cs-y-label')]) {
          const style = getComputedStyle(node),
            bg = getComputedStyle(document.documentElement).getPropertyValue('--cs-surface');
          const swatch = document.createElement('span');
          swatch.style.color = bg;
          document.body.append(swatch);
          const normalized = getComputedStyle(swatch).color;
          swatch.remove();
          expect(contrast(style.fill, normalized) >= 4.5, '图表文字对比不足');
        }
      });
    const result = {
      passed: pass,
      failed: fail,
      total: pass + fail,
      mode: 'actual-components-synthetic-data',
      checks: records,
      productionAccepted: false,
    };
    const pre = document.createElement('pre');
    pre.id = 'surfaceResultJSON';
    pre.textContent = JSON.stringify(result);
    $('surfaceResults').after(pre);
  };
})();
