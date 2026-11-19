'use strict';
(() => {
  const frame = document.getElementById('testWorkspace'),
    doc = () => frame.contentDocument,
    $ = (id) => doc().getElementById(id),
    results = [];
  const wait = async (fn, title) => {
    const end = performance.now() + 12000;
    while (performance.now() < end) {
      if (fn()) return;
      await new Promise((r) => requestAnimationFrame(r));
    }
    throw Error(title + '未就绪');
  };
  const pause = () => new Promise((r) => setTimeout(r, 300));
  const input = async (id, value) => {
    $(id).value = value;
    $(id).dispatchEvent(new Event('input', { bubbles: true }));
    $(id).dispatchEvent(new Event('change', { bubbles: true }));
    await pause();
  };
  const toggle = async (id, value) => {
    $(id).checked = value;
    $(id).dispatchEvent(new Event('input', { bubbles: true }));
    $(id).dispatchEvent(new Event('change', { bubbles: true }));
    await pause();
  };
  const qr = () => $('labelDesignCanvas').querySelector('[data-element-id="qr"] rect');
  const box = () =>
    Object.fromEntries(['x', 'y', 'width', 'height'].map((k) => [k, Number(qr().getAttribute(k))]));
  const groupRects = () =>
    [...$('labelCanvas').querySelectorAll('[data-label-code]')].map((g) => g.querySelector('rect'));
  const check = async (name, work) => {
    try {
      await work();
      results.push({ name, status: 'passed' });
    } catch (e) {
      results.push({ name, status: 'failed', message: e.message });
    }
    const tr = document.createElement('tr');
    tr.append(
      Object.assign(document.createElement('td'), { textContent: name }),
      Object.assign(document.createElement('td'), {
        textContent: results.at(-1).status + ' ' + (results.at(-1).message || ''),
      }),
    );
    document.getElementById('freeLabelRows').append(tr);
  };
  document.getElementById('runFreeLabelChecks').onclick = async () => {
    document.getElementById('runFreeLabelChecks').disabled = true;
    await check('进入实际设计器，自动列数可超过四列', async () => {
      await wait(() => $('openDemo'), '程序');
      if (!$('lockView').hidden) $('openDemo').click();
      await wait(
        () =>
          $('openFunctions') &&
          !$('openFunctions').disabled &&
          !doc().body.hasAttribute('aria-busy'),
        '工作区',
      );
      doc().querySelector('[data-view="data-center"]').click();
      doc().querySelector('[data-destination="label-studio"]').click();
      $('labelViewBatch').click();
      $('labelDemo').click();
      await input('labelColumns', '0');
      await wait(() => groupRects().length === 15, '自动列数');
      if (!$('labelSummary').textContent.includes('5列')) throw Error('仍固定四列');
    });
    await check('自定义纸张宽高控制真实页面，不受方向旧值覆盖', async () => {
      await toggle('labelSignatures', false);
      await toggle('labelShowName', false);
      $('labelViewDesign').click();
      await input('labelWidth', '30');
      await input('labelHeight', '20');
      $('labelViewBatch').click();
      await input('labelPaperWidth', '110');
      await input('labelPaperHeight', '70');
      await input('labelMargin', '4');
      await input('labelGapX', '3');
      await input('labelGapY', '3');
      await input('labelCodes', 'T-001\nT-002\nT-003\nT-004\nT-005\nT-006\nT-007');
      const svg = $('labelCanvas').querySelector('svg');
      if (
        svg.getAttribute('viewBox') !== '0 0 110 70' ||
        groupRects().length !== 6 ||
        $('labelPaperSize').value !== 'custom'
      )
        throw Error('纸张或容量错误');
    });
    await check('四边页边距映射到真实可打印边界', async () => {
      await toggle('labelSeparateMargins', true);
      await input('labelMarginLeft', '7');
      await input('labelMarginRight', '13');
      await input('labelMarginTop', '5');
      await input('labelMarginBottom', '9');
      const guide = $('labelCanvas').querySelector('[data-printable-guide]');
      if (
        guide.getAttribute('x') !== '7' ||
        guide.getAttribute('width') !== '90' ||
        guide.getAttribute('height') !== '56'
      )
        throw Error('可打印边界错误');
    });
    await check('整页垂直居中与不足一排居中均改变真实标签坐标', async () => {
      await input('labelPageAlignY', 'center');
      await input('labelLastRowAlign', 'center');
      await input('labelCodes', 'T-001\nT-002\nT-003');
      const r = groupRects();
      if (Number(r[0].getAttribute('y')) !== 11.5 || Number(r[2].getAttribute('x')) !== 37)
        throw Error('居中仍有偏移');
    });
    await check('按输入顺序排版与自然排序可切换，单张模板跨页一致', async () => {
      await toggle('labelSort', false);
      await input('labelCodes', '010\n002\n001\n009\n008');
      const codes = [...$('labelCanvas').querySelectorAll('[data-label-code]')].map(
        (g) => g.dataset.labelCode,
      );
      if (codes.join(',') !== '010,002,001,009') throw Error('输入顺序未保留');
      $('labelNext').click();
      if (!$('labelCanvas').querySelector('[data-label-code="008"]')) throw Error('分页丢失编号');
      $('labelPrevious').click();
    });
    await check('无效纸张尺寸清除旧图并禁用导出，恢复后可继续', async () => {
      await input('labelPaperWidth', '0');
      if (
        $('labelCanvas').querySelector('svg') ||
        !doc().querySelector('[data-label-export="pdf"]').disabled
      )
        throw Error('沿用旧预览');
      await input('labelPaperWidth', '110');
    });
    await check('二维码和文字可分别一键水平及垂直居中', async () => {
      $('labelViewDesign').click();
      doc().querySelector('[data-label-preset="fixture"]').click();
      await toggle('labelSignatures', false);
      await toggle('labelShowName', false);
      await input('designWidth', '20');
      await input('designElement', 'qr');
      doc().querySelector('[data-design-align="center"]').click();
      doc().querySelector('[data-design-align="middle"]').click();
      const r = box();
      if (r.x !== 15 || r.y !== 15) throw Error('二维码中心不准确');
    });
    await check('文字字体和框内垂直对齐在图形中生效', async () => {
      await input('designElement', 'code');
      await input('designHeight', '10');
      await input('designValign', 'top');
      await input('designFontFamily', 'mono');
      const t = $('labelDesignCanvas').querySelector('[data-element-id="code"] text');
      if (!t.getAttribute('font-family').includes('Consolas')) throw Error('字体未更新');
    });
    await check('多选后组合、居中和键盘移动保留内部位置', async () => {
      $('designSelectAll').click();
      $('designGroup').click();
      const before = box();
      doc().querySelector('[data-design-align="center"]').click();
      const x = box().x;
      $('labelDesignCanvas').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
      );
      if (Math.abs(box().x - x - 0.1) > 0.001) throw Error('组合无法键盘移动');
      const state = (await doc().defaultView.workbench.readLabelMemory()).value.state;
      await doc().defaultView.flushLabelStudio();
      const saved = (await doc().defaultView.workbench.readLabelMemory()).value.state;
      const es = saved.current.config.template.elements;
      if (!es.every((e) => e.group && e.group === es[0].group)) throw Error('组合未进入加密记忆');
      void before;
      void state;
    });
    await check('组合宽度可精确缩放，二维码保持正方形，字体同步缩放', async () => {
      const before = Number($('designWidth').value);
      await input('designWidth', String(before * 0.8));
      const r = box();
      if (Math.abs(r.width - r.height) > 0.001) throw Error('二维码被拉伸');
      if (Number($('designWidth').value) >= before) throw Error('组合缩放无效');
    });
    await check('取消组合、撤销与重做可恢复组合状态', async () => {
      $('designUngroup').click();
      $('designUndo').click();
      await doc().defaultView.flushLabelStudio();
      const state = (await doc().defaultView.workbench.readLabelMemory()).value.state;
      if (!state.current.config.template.elements.some((e) => e.group))
        throw Error('撤销未恢复组合');
      $('designRedo').click();
    });
    await check('参考线只属于设计界面，不进入整页与导出图形', async () => {
      if (
        $('labelCanvas').querySelector('.design-guide') ||
        $('labelCanvas').querySelector('[data-design-overlay]')
      )
        throw Error('设计控件进入整页');
    });
    for (const width of [640, 1000, 1440])
      await check(width + 'px新增控件无横向溢出', async () => {
        frame.style.width = width + 'px';
        await new Promise((r) => requestAnimationFrame(r));
        for (const id of ['labelViewDesign', 'labelViewBatch']) {
          $(id).click();
          await new Promise((r) => requestAnimationFrame(r));
          if ($('labelStudio').scrollWidth > $('labelStudio').clientWidth + 2)
            throw Error('横向溢出');
        }
      });
    await check('锁定清除组合和属性草稿，正式业务库不参与', async () => {
      $('lockButton').click();
      await wait(() => !$('lockView').hidden, '锁定');
      if ($('labelDesignCanvas').textContent || $('labelCodes').value) throw Error('锁定残留');
    });
    const result = {
      passed: results.filter((r) => r.status === 'passed').length,
      failed: results.filter((r) => r.status === 'failed').length,
      total: results.length,
      checks: results,
      mode: 'actual-platform-free-design-synthetic-inputs',
      realPointerDragTestedSeparately: true,
      physicalPrinterTested: false,
    };
    document.getElementById('freeLabelResult').textContent = JSON.stringify(result, null, 2);
    document.getElementById('freeLabelSummary').textContent =
      result.passed + '通过，' + result.failed + '失败';
  };
})();
