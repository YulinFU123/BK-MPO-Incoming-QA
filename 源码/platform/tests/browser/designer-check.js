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
  const pause = () => new Promise((r) => setTimeout(r, 200));
  const set = async (id, value) => {
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
  const check = async (name, work) => {
    try {
      await work();
      results.push({ name, status: 'passed' });
    } catch (e) {
      results.push({ name, status: 'failed', message: e.message });
    }
    const row = document.createElement('tr');
    row.append(
      Object.assign(document.createElement('td'), { textContent: name }),
      Object.assign(document.createElement('td'), {
        textContent: results.at(-1).status + (results.at(-1).message || ''),
      }),
    );
    document.getElementById('designerRows').append(row);
  };
  const svg = () => $('labelDesignCanvas').querySelector('svg');
  const labelGroups = () => [...$('labelCanvas').querySelectorAll('[data-label-code]')];
  document.getElementById('runDesignerChecks').onclick = async () => {
    document.getElementById('runDesignerChecks').disabled = true;
    await check('打开后先设计单张，示例不进入编号和导出', async () => {
      await wait(() => $('openDemo'), '平台');
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
      await wait(() => svg(), '单张');
      if (
        $('labelDesignView').hidden ||
        !$('labelBatchView').hidden ||
        $('labelCodes').value ||
        !doc().querySelector('[data-label-export="pdf"]').disabled
      )
        throw Error('设计与批量边界不清楚');
    });
    await check('批量区和设计区切换，不改变编号', async () => {
      $('labelViewBatch').click();
      $('labelDemo').click();
      await set('labelColumns', '4');
      await wait(() => labelGroups().length === 12, '示例批量');
      const codes = $('labelCodes').value;
      $('labelViewDesign').click();
      if ($('labelDesignView').hidden || $('labelCodes').value !== codes)
        throw Error('切换丢失编号');
      await toggle('labelSignatures', false);
      await toggle('labelShowName', false);
    });
    await check('边框粗细内缩圆角及线型影响实际SVG', async () => {
      await set('designElement', 'border');
      await set('designBorderWidth', '.8');
      await set('designBorderInset', '1.5');
      await set('designBorderRadius', '3');
      await set('designBorderStyle', 'dashed');
      await set('designBorderColor', '#222222');
      const b = svg().querySelector('[data-label-border]');
      if (b.getAttribute('stroke-width') !== '.8' && b.getAttribute('stroke-width') !== '0.8')
        throw Error('线宽没有变化');
      if (b.getAttribute('rx') !== '3' || !b.hasAttribute('stroke-dasharray'))
        throw Error('圆角线型没有变化');
    });
    await check('输入对象位置转为自定义，二维码保持正方形', async () => {
      await set('designElement', 'qr');
      await set('designWidth', '25');
      await set('designX', '3');
      await set('designY', '3');
      if (
        $('designMode').value !== 'custom' ||
        $('designHeight').value !== '25' ||
        !$('designHeight').disabled
      )
        throw Error('自定义或比例错误');
      if (!$('labelPadding').closest('label').hidden)
        throw Error('自定义模式仍展示无效的自动内边距');
      const box = svg().querySelector('[data-element-id="qr"] rect');
      if (Number(box.getAttribute('width')) !== 25 || Number(box.getAttribute('x')) !== 3)
        throw Error('只是输入值变化');
    });
    await check('方向键按毫米微调对象，可撤销与重做', async () => {
      $('labelDesignCanvas').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
      );
      if (Math.abs(Number($('designX').value) - 3.1) > 0.001) throw Error('微调无效');
      $('designUndo').click();
      if (Number($('designX').value) !== 3) throw Error('撤销无效');
      $('designRedo').click();
      if (Number($('designX').value) !== 3.1) throw Error('重做无效');
    });
    await check('仅输入事件也会同步图形，不依赖离开输入框', async () => {
      $('designWidth').value = '24';
      $('designWidth').dispatchEvent(new Event('input', { bubbles: true }));
      await wait(
        () =>
          Number(svg().querySelector('[data-element-id="qr"] rect').getAttribute('width')) === 24,
        '实时尺寸',
      );
      if ($('designHeight').value !== '24') throw Error('二维码比例未同步');
      await set('designWidth', '25');
    });
    await check('连续属性输入在记忆刷新前一起提交，防止最后一笔丢失', async () => {
      for (const [id, value] of [
        ['designWidth', '24'],
        ['designX', '4'],
        ['designY', '4'],
      ]) {
        $(id).value = value;
        $(id).dispatchEvent(new Event('input', { bubbles: true }));
      }
      await doc().defaultView.flushLabelStudio();
      const r = svg().querySelector('[data-element-id="qr"] rect');
      if (
        Number(r.getAttribute('width')) !== 24 ||
        Number(r.getAttribute('x')) !== 4 ||
        Number(r.getAttribute('y')) !== 4
      )
        throw Error('连续属性未提交到图形');
      const result = await doc().defaultView.workbench.readLabelMemory();
      const qr = result.value.state.current.config.template.elements.find((e) => e.type === 'qr');
      if (qr.width !== 24 || qr.x !== 4 || qr.y !== 4) throw Error('记忆遗漏待提交属性');
      await set('designX', '3.1');
      await set('designY', '3');
      await set('designWidth', '25');
    });
    await check('动态编号框可独立调整尺寸与位置', async () => {
      await set('designElement', 'code');
      await set('designY', '30');
      await set('designHeight', '5');
      await set('designFont', '9');
      if (
        !svg().querySelector('[data-element-id="code"] text').textContent.includes('DEMO-FIX-001')
      )
        throw Error('编号绑定丢失');
    });
    let fixedId, nameId;
    await check('可以插入固定文字，修改内容位置颜色及加粗', async () => {
      $('designAddText').click();
      fixedId = $('designElement').value;
      await set('designX', '29');
      await set('designY', '4');
      await set('designWidth', '18');
      await set('designHeight', '8');
      await set('designText', 'QA复核');
      await set('designTextColor', '#333333');
      await toggle('designBold', true);
      const t = svg().querySelector(`[data-element-id="${fixedId}"] text`);
      if (!t || t.textContent !== 'QA复核' || t.getAttribute('font-weight') !== '700')
        throw Error('固定文字没有生效');
    });
    await check('新增文字可以绑定每条名称，并支持前缀', async () => {
      $('designAddText').click();
      nameId = $('designElement').value;
      await set('designY', '37');
      await set('designHeight', '5');
      await set('designFont', '8');
      await set('designBinding', 'name');
      await set('designText', '类型：');
      const t = svg().querySelector(`[data-element-id="${nameId}"] text`);
      if (!t?.textContent.includes('类型：示例夹具') || !$('labelShowName').checked)
        throw Error('动态名称未生效');
    });
    await check('横线可以调位置长度粗细，删除后可撤销', async () => {
      $('designAddLine').click();
      const id = $('designElement').value;
      await set('designY', '45');
      await set('designLineWidth', '.5');
      if (!svg().querySelector(`[data-element-id="${id}"] path`)) throw Error('横线未生成');
      $('designDelete').click();
      if (svg().querySelector(`[data-element-id="${id}"]`)) throw Error('删除无效');
      $('designUndo').click();
      if (!svg().querySelector(`[data-element-id="${id}"] path`)) throw Error('撤销横线无效');
    });
    await check('批量只替换编号，所有标签保持同一模板位置和边框', async () => {
      $('labelViewBatch').click();
      await set('labelCodes', 'Z-001\nZ-002\nZ-003');
      if (labelGroups().length !== 3) throw Error('编号数量不符');
      for (const [i, g] of labelGroups().entries()) {
        const r = g.querySelector('rect'),
          q = g.querySelector('[data-element-id="qr"] rect');
        if (
          Math.abs(Number(q.getAttribute('x')) - Number(r.getAttribute('x')) - 3.1) > 0.001 ||
          Number(q.getAttribute('width')) !== 25
        )
          throw Error('模板坐标不一致');
        if (
          !g.textContent.includes(`Z-00${i + 1}`) ||
          g.textContent.includes('DEMO-FIX') ||
          !g.textContent.includes('QA复核')
        )
          throw Error('内容未逐条替换');
        if (g.querySelector('[data-label-border]').getAttribute('stroke-width') !== '0.8')
          throw Error('批量边框丢失');
      }
    });
    await check('可以逐条查看真实编号而不是固定设计样例', async () => {
      $('labelViewDesign').click();
      $('designNext').click();
      if (
        !svg().textContent.includes('Z-002') ||
        !$('designRecordCount').textContent.includes('第2')
      )
        throw Error('逐条预览无效');
      $('designPrevious').click();
    });
    await check('设计和整页共存时裁切标识独立，避免二维码被另一视图裁掉', async () => {
      const ids = [...doc().querySelectorAll('#labelStudio clipPath')].map((n) => n.id);
      if (ids.length < 2 || new Set(ids).size !== ids.length) throw Error('不同视图复用了裁切标识');
    });
    await check('自定义模板只保存到加密记忆，不进入普通本机缓存', async () => {
      $('labelOpenMemory').click();
      await wait(() => $('labelMemoryStatus').textContent.includes('记住'), '记忆');
      $('labelProfileTitle').value = '自定义复核标签';
      $('labelProfileSave').click();
      await wait(
        () => [...$('labelProfiles').options].some((o) => o.text === '自定义复核标签'),
        '保存方案',
      );
      const raw = doc().defaultView.localStorage.getItem('qa-label-layout-v3') || '';
      if (raw.includes('QA复核') || raw.includes('类型：')) throw Error('模板文字泄漏到普通缓存');
      const result = await doc().defaultView.workbench.readLabelMemory(),
        profile = result.value.state.profiles.find((p) => p.title === '自定义复核标签');
      if (
        profile.composition.config.composition !== 'custom' ||
        !profile.composition.config.template.elements.some((e) => e.text === 'QA复核')
      )
        throw Error('方案没有保存模板');
    });
    await check('切换和恢复方案保留本批编号并恢复自定义几何', async () => {
      const option = [...$('labelProfiles').options].find((o) => o.text === '自定义复核标签');
      await set('designElement', 'qr');
      await set('designX', '8');
      await set('labelProfiles', option.value);
      if (
        Math.abs(Number($('designX').value) - 3.1) > 0.001 ||
        $('labelCodes').value !== 'Z-001\nZ-002\nZ-003'
      )
        throw Error('方案恢复不完整');
    });
    await check('加载方案会取消旧属性草稿，延迟输入不会覆盖恢复结果', async () => {
      $('designX').value = '9';
      $('designX').dispatchEvent(new Event('input', { bubbles: true }));
      $('labelProfiles').dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 350));
      const r = svg().querySelector('[data-element-id="qr"] rect');
      if (Math.abs(Number(r.getAttribute('x')) - 3.1) > 0.001)
        throw Error('旧输入覆盖了已恢复模板');
    });
    for (const theme of ['silver', 'glass', 'graphite', 'contrast'])
      await check(theme + '下设计控制与纸张可区分', async () => {
        $('themeSelect').value = theme;
        $('themeSelect').dispatchEvent(new Event('change', { bubbles: true }));
        const fill = svg().querySelector('[data-element-id="qr"] path').getAttribute('fill');
        if (fill !== '#000') throw Error('二维码受主题影响');
      });
    for (const width of [640, 1000, 1440])
      await check(width + 'px设计与批量布局均无横向溢出', async () => {
        frame.style.width = width + 'px';
        await new Promise((r) => requestAnimationFrame(r));
        for (const id of ['labelViewDesign', 'labelViewBatch']) {
          $(id).click();
          await new Promise((r) => requestAnimationFrame(r));
          if ($('labelStudio').scrollWidth > $('labelStudio').clientWidth + 2)
            throw Error('横向溢出');
        }
      });
    await check('锁定后设计内容、固定文字和撤销历史从界面清除', async () => {
      $('lockButton').click();
      await wait(() => !$('lockView').hidden, '锁定');
      if (
        $('labelDesignCanvas').textContent ||
        $('designText').value ||
        !$('designUndo').disabled ||
        $('labelCodes').value
      )
        throw Error('锁定未清除');
    });
    const result = {
      passed: results.filter((r) => r.status === 'passed').length,
      failed: results.filter((r) => r.status === 'failed').length,
      total: results.length,
      checks: results,
      mode: 'actual-platform-designer-synthetic-inputs',
      realPointerDragTestedSeparately: true,
      physicalPrinterTested: false,
    };
    document.getElementById('designerResultJSON').textContent = JSON.stringify(result, null, 2);
    document.getElementById('designerSummary').textContent =
      `${result.passed}通过，${result.failed}失败`;
  };
})();
