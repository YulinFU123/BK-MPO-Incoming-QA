'use strict';
(() => {
  const frame = document.getElementById('testWorkspace'),
    results = [];
  const doc = () => frame.contentDocument,
    $ = (id) => doc().getElementById(id);
  const wait = async (fn, label) => {
    const end = performance.now() + 12000;
    while (performance.now() < end) {
      if (fn()) return;
      await new Promise((r) => requestAnimationFrame(r));
    }
    throw Error(label + '未就绪');
  };
  const input = async (id, value) => {
    $(id).value = value;
    $(id).dispatchEvent(new Event('input', { bubbles: true }));
    await wait(
      () =>
        !$('labelSummary').textContent.includes('未完成') &&
        !!$('labelCanvas').querySelector('svg'),
      id,
    );
    await new Promise((r) => setTimeout(r, 180));
  };
  const labels = () => [...$('labelCanvas').querySelectorAll('[data-label-code]')];
  const rect = (i) => labels()[i].querySelector('rect');
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
        textContent: results.at(-1).status + (results.at(-1).message || ''),
      }),
    );
    document.getElementById('labelCheckRows').append(tr);
  };
  document.getElementById('runLabelChecks').onclick = async () => {
    document.getElementById('runLabelChecks').disabled = true;
    await check('平台七主入口与二维码目录可达', async () => {
      await wait(() => $('openDemo'), '平台');
      if (!$('lockView').hidden) {
        $('openDemo').click();
        await wait(() => $('lockView').hidden, '示例工作区');
      }
      await wait(
        () => !$('openFunctions').disabled && !doc().body.hasAttribute('aria-busy'),
        '工作区载入完成',
      );
      await wait(() => doc().querySelector('[data-view="data-center"]'), '数据入口');
      doc().querySelector('[data-view="data-center"]').click();
      await wait(() => doc().querySelector('[data-destination="label-studio"]'), '二维码入口');
      doc().querySelector('[data-destination="label-studio"]').click();
      await wait(() => !$('labelStudio').hidden, '二维码页面');
      if (doc().querySelectorAll('#primaryNavigation>[data-view]').length !== 7)
        throw Error('主入口变化');
    });
    await check('空白状态不自动带入公司编号，导出禁用', async () => {
      if ($('labelCodes').value || !doc().querySelector('[data-label-export="xlsx"]').disabled)
        throw Error('空白状态错误');
    });
    await check('顶部记忆入口直接展开方案和记忆设置', async () => {
      $('labelOpenMemory').click();
      if (!$('labelMemoryDetails').open) throw Error('记忆入口无效');
      $('labelMemoryDetails').open = false;
    });
    await check('19个示例形成4列3排两页', async () => {
      $('labelViewBatch').click();
      $('labelDemo').click();
      await input('labelColumns', '4');
      await wait(() => labels().length === 12, '示例图');
      if (!$('labelPageCount').textContent.includes('/ 2')) throw Error('页数错误');
    });
    await check('标签宽高修改即时影响真实矩形', async () => {
      await input('labelWidth', '58');
      await input('labelHeight', '55');
      if (
        Number(rect(0).getAttribute('width')) !== 58 ||
        Number(rect(0).getAttribute('height')) !== 55
      )
        throw Error('只是控件变化');
    });
    await check('二维码尺寸修改影响图形', async () => {
      await input('labelQrMode', 'manual');
      const before = labels()[0].querySelector('path[fill="#000"]').getBBox().width;
      await input('labelQrSize', '25');
      const after = labels()[0].querySelector('path[fill="#000"]').getBBox().width;
      if (Math.abs(after - before) < 0.05 || !$('labelSummary').textContent.includes('二维码25mm'))
        throw Error('二维码没有实际变化');
    });
    await check('横向间距可独立调节并保持对齐', async () => {
      await input('labelGapX', '9');
      if (
        Math.abs(Number(rect(1).getAttribute('x')) - Number(rect(0).getAttribute('x')) - 67) > 0.01
      )
        throw Error('横向位置错误');
      if (rect(1).getAttribute('y') !== rect(0).getAttribute('y')) throw Error('未对齐');
    });
    await check('纵向间距可独立调节并保持对齐', async () => {
      await input('labelGapY', '12');
      if (
        Math.abs(Number(rect(4).getAttribute('y')) - Number(rect(0).getAttribute('y')) - 67) > 0.01
      )
        throw Error('纵向位置错误');
    });
    await check('字号修改影响导出矢量文本', async () => {
      const before = labels()[0].querySelector('text').getAttribute('font-size');
      await input('labelHeight', '60');
      await input('labelFontSize', '10');
      if (labels()[0].querySelector('text').getAttribute('font-size') === before)
        throw Error('文字未变化');
    });
    await check('页边距和纵向纸张自动减少列数', async () => {
      await input('labelMargin', '14');
      await input('labelOrientation', 'portrait');
      if (
        $('labelCanvas').querySelector('svg').viewBox.baseVal.width !== 210 ||
        !$('labelMessage').textContent.includes('自动调整')
      )
        throw Error('方向或列数错误');
    });
    await check('单张放大只改变查看范围', async () => {
      const summary = $('labelSummary').textContent;
      $('labelSingle').checked = true;
      $('labelSingle').dispatchEvent(new Event('change', { bubbles: true }));
      if (
        $('labelCanvas').querySelector('svg').viewBox.baseVal.width !== 62 ||
        $('labelSummary').textContent !== summary
      )
        throw Error('单张放大改了打印尺寸');
      $('labelSingle').checked = false;
      $('labelSingle').dispatchEvent(new Event('change', { bubbles: true }));
    });
    await check('翻页保持同样的尺寸间距', async () => {
      $('labelNext').click();
      if (
        !$('labelPageCount').textContent.startsWith('第2') ||
        Number(rect(0).getAttribute('width')) !== 58
      )
        throw Error('翻页丢失设置');
    });
    await check('重复编号明确报错且不允许导出', async () => {
      $('labelCodes').value = 'X-001\nX-001';
      $('labelCodes').dispatchEvent(new Event('input', { bubbles: true }));
      await wait(() => $('labelMessage').textContent.includes('重复'), '重复校验');
      if (
        !doc().querySelector('[data-label-export="xlsx"]').disabled ||
        $('labelCanvas').querySelector('svg')
      )
        throw Error('错误后仍可导出');
    });
    await check('热剥钳预设20mm高和17mm二维码有效', async () => {
      doc().querySelector('[data-label-preset="stripper"]').click();
      $('labelCodes').value = 'TOOL-001\nTOOL-002';
      $('labelCodes').dispatchEvent(new Event('input', { bubbles: true }));
      await wait(() => labels().length === 2, '热剥钳');
      if (
        Number(rect(0).getAttribute('height')) !== 20 ||
        !$('labelSummary').textContent.includes('二维码17mm')
      )
        throw Error('预设尺寸错误');
    });
    await check('无效高度保留输入并清除旧预览', async () => {
      $('labelHeight').value = '0';
      $('labelHeight').dispatchEvent(new Event('input', { bubbles: true }));
      await wait(() => $('labelMessage').classList.contains('error'), '输入错误');
      if ($('labelHeight').value !== '0' || $('labelCanvas').querySelector('svg'))
        throw Error('无效输入状态不正确');
      $('labelHeight').value = '20';
      $('labelHeight').dispatchEvent(new Event('input', { bubbles: true }));
      await wait(() => labels().length === 2, '恢复');
    });
    await check('回车不触发保存或打印', async () => {
      const before = $('labelMessage').textContent;
      $('labelQrSize').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      if ($('labelMessage').textContent !== before) throw Error('回车触发操作');
    });
    await check('本机设置不保存编号名称和制作人', async () => {
      const c = JSON.parse(doc().defaultView.localStorage.getItem('qa-label-layout-v3'));
      if (['codes', 'name', 'creator', 'records'].some((k) => Object.hasOwn(c, k)))
        throw Error('保存了业务文字');
    });
    const toggle = async (id, checked) => {
      $(id).checked = checked;
      $(id).dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 180));
    };
    await check('名称留空无需关闭开关，也不占用空行', async () => {
      doc().querySelector('[data-label-preset="fixture"]').click();
      await input('labelName', '');
      if (!labels().length || labels()[0].querySelectorAll('text').length !== 7)
        throw Error('空名称仍被限制或占空行');
    });
    await check('关闭名称后自动释放空间给二维码', async () => {
      await input('labelName', '示例名称');
      const before = labels()[0].querySelector('path[fill="#000"]').getBBox().width;
      await toggle('labelShowName', false);
      if (
        !$('labelName').disabled ||
        labels()[0].textContent.includes('示例名称') ||
        labels()[0].querySelector('path[fill="#000"]').getBBox().width <= before
      )
        throw Error('名称隐藏没有释放空间');
    });
    await check('占比调节影响真实二维码而不是预览缩放', async () => {
      const before = labels()[0].querySelector('path[fill="#000"]').getBBox().width;
      await input('labelQrScale', '50');
      const after = labels()[0].querySelector('path[fill="#000"]').getBBox().width;
      if (Math.abs(after / before - 0.5) > 0.01) throw Error('占比没有生效');
    });
    await check('只显示二维码时不留名称编号和审核栏位置', async () => {
      await toggle('labelShowCode', false);
      await toggle('labelSignatures', false);
      await input('labelQrScale', '100');
      if (labels()[0].querySelectorAll('text').length) throw Error('仍有文字');
      if (!$('labelSummary').textContent.includes('二维码46mm')) throw Error('没有充分利用空间');
    });
    await check('8mm小标签允许生成并明确提示试印扫描', async () => {
      await input('labelWidth', '8');
      await input('labelHeight', '8');
      await input('labelPadding', '.5');
      if (!labels().length || !$('labelMessage').textContent.includes('可能难以扫描'))
        throw Error('小标签仍被硬限制');
      if (doc().querySelector('[data-label-export="pdf"]').disabled)
        throw Error('小尺寸不允许导出');
    });
    await check('允许重复编号时保留同编号多张标签', async () => {
      await toggle('labelAllowDuplicates', true);
      await input('labelCodes', 'SAME-001\nSAME-001');
      if (labels().length !== 2 || !$('labelMessage').textContent.includes('重复编号'))
        throw Error('重复标签未保留');
    });
    await check('自动排列会随宽高比例改为二维码在左', async () => {
      await input('labelWidth', '62');
      await input('labelHeight', '20');
      await toggle('labelShowCode', true);
      const p = labels()[0].querySelector('path[fill="#000"]').getBBox(),
        text = labels()[0].querySelector('text');
      if (Number(text.getAttribute('x')) <= p.x + p.width) throw Error('宽标签没有切换排列');
    });
    await check('保存常用方案包括名称开关，不带入本批编号', async () => {
      await wait(() => $('labelMemoryStatus').textContent.includes('记住'), '记忆读取');
      $('labelProfileTitle').value = '无名称热剥钳';
      $('labelProfileSave').click();
      await wait(
        () => $('labelProfiles').options.length === 2 && !!$('labelProfiles').value,
        '保存方案',
      );
      const before = $('labelCodes').value;
      await input('labelWidth', '70');
      $('labelProfiles').dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 180));
      if (
        $('labelWidth').value !== '62' ||
        $('labelShowName').checked ||
        $('labelCodes').value !== before
      )
        throw Error('方案恢复不正确');
    });
    await check('本批编号只有主动勾选后才记住', async () => {
      $('labelRememberCodes').checked = true;
      $('labelRememberCodes').dispatchEvent(new Event('change', { bubbles: true }));
      $('labelMemorySave').click();
      await wait(() => $('labelMemoryStatus').textContent.includes('示例排版已记住'), '记忆保存');
      const result = await doc().defaultView.workbench.readLabelMemory();
      if (!result.ok || result.value.state.current.codes !== 'SAME-001\nSAME-001')
        throw Error('编号没有进入记忆');
      if (Object.hasOwn(result.value.state.profiles[0].composition, 'codes'))
        throw Error('方案携带了本批编号');
    });
    await check('页面重载后恢复尺寸名称开关及已勾选的编号', async () => {
      await new Promise((resolve) => {
        frame.addEventListener('load', resolve, { once: true });
        frame.contentWindow.location.reload();
      });
      await wait(
        () =>
          $('openFunctions') &&
          !$('openFunctions').disabled &&
          !doc().body.hasAttribute('aria-busy'),
        '重载工作区',
      );
      doc().querySelector('[data-view="data-center"]').click();
      doc().querySelector('[data-destination="label-studio"]').click();
      await wait(() => $('labelMemoryStatus').textContent.includes('恢复示例'), '恢复记忆');
      if (
        $('labelWidth').value !== '62' ||
        $('labelShowName').checked ||
        !$('labelRememberCodes').checked ||
        $('labelCodes').value !== 'SAME-001\nSAME-001'
      )
        throw Error('重载丢失记忆');
    });
    await check('取消编号记忆会清除已存编号，排版方案仍保留', async () => {
      $('labelRememberCodes').checked = false;
      $('labelRememberCodes').dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 200));
      const result = await doc().defaultView.workbench.readLabelMemory();
      if (
        Object.hasOwn(result.value.state.current, 'codes') ||
        result.value.state.profiles.length !== 1
      )
        throw Error('编号未清除或方案丢失');
    });
    await check('方案可以移除并撤销，关闭自动记忆保留方案', async () => {
      $('labelProfiles').value = $('labelProfiles').options[1].value;
      $('labelProfiles').dispatchEvent(new Event('change', { bubbles: true }));
      $('labelProfileRemove').click();
      await wait(() => $('labelProfiles').options.length === 1, '移除方案');
      $('labelProfileUndo').click();
      await wait(() => $('labelProfiles').options.length === 2, '撤销移除');
      $('labelAutoRemember').checked = false;
      $('labelAutoRemember').dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 250));
      const result = await doc().defaultView.workbench.readLabelMemory();
      if (result.value.state.current !== null || result.value.state.profiles.length !== 1)
        throw Error('关闭记忆未生效');
      $('labelDemo').click();
    });
    for (const theme of ['silver', 'glass', 'graphite', 'contrast'])
      await check(theme + '主题下标签保持黑白打印内容', async () => {
        $('themeSelect').value = theme;
        $('themeSelect').dispatchEvent(new Event('change', { bubbles: true }));
        if (labels()[0].querySelector('text').getAttribute('fill') !== '#111')
          throw Error('打印文字受主题影响');
      });
    for (const width of [640, 1000, 1440])
      await check(width + 'px参数与预览边界可用', async () => {
        frame.style.width = width + 'px';
        await new Promise((r) => requestAnimationFrame(r));
        const root = $('labelStudio');
        if (root.scrollWidth > root.clientWidth + 2) throw Error('页面横向溢出');
      });
    await check('锁定清除二维码和输入', async () => {
      $('lockButton').click();
      await wait(() => !$('lockView').hidden, '锁定');
      if (
        $('labelCodes').value ||
        $('labelCreator').value ||
        $('labelName').value ||
        $('labelProfileTitle').value ||
        $('labelProfiles').options.length !== 1 ||
        $('labelCanvas').querySelector('svg')
      )
        throw Error('锁定仍留业务内容');
    });
    const result = {
      passed: results.filter((r) => r.status === 'passed').length,
      failed: results.filter((r) => r.status === 'failed').length,
      total: results.length,
      checks: results,
      mode: 'actual-platform-renderer-synthetic-labels',
      nativeDialogsTested: false,
      physicalPrintingTested: false,
    };
    document.getElementById('labelCheckJSON').textContent = JSON.stringify(result, null, 2);
    document.getElementById('labelCheckSummary').textContent =
      `${result.passed}通过，${result.failed}失败`;
  };
})();
