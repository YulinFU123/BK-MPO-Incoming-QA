'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const tick = () => new Promise((resolve) => requestAnimationFrame(resolve));
  const assert = (condition, message) => {
    if (!condition) throw Error(message);
  };
  const sendKey = (input, key) =>
    input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  const values = ['0012', '12', 'A', 'a', '中文长异常说明', '<img src=x>', '0012'];
  let started = false;

  $('runChecks').onclick = async () => {
    if (started) return;
    started = true;
    $('runChecks').disabled = true;
    const field = document.createElement('input');
    field.id = 'editable';
    field.setAttribute('list', 'testOptions');
    field.placeholder = '编号候选';
    const list = document.createElement('datalist');
    list.id = 'testOptions';
    for (const value of values) {
      const option = document.createElement('option');
      option.value = value;
      list.append(option);
    }
    const other = document.createElement('input');
    other.placeholder = '另一个字段';
    $('fixture').append(field, list, other);
    SelectionControls.scan();
    let changes = 0,
      inputs = 0,
      passed = 0,
      failed = 0;
    field.addEventListener('input', () => inputs++);
    field.addEventListener('change', () => changes++);
    const menus = () => document.querySelectorAll('.choice-menu');
    const options = () => [...document.querySelectorAll('.choice-menu [role=option]')];
    const textOf = (element) => element.querySelector('.choice-label')?.textContent;
    const choose = (value) => {
      const option = options().find((item) => textOf(item) === value);
      assert(option, '缺少预期候选');
      option.click();
    };
    async function check(label, work) {
      const row = document.createElement('tr'),
        name = document.createElement('td'),
        result = document.createElement('td');
      name.textContent = label;
      try {
        await work();
        passed++;
        result.textContent = '已通过';
        result.className = 'pass';
      } catch (error) {
        failed++;
        result.textContent = '失败：' + error.message;
        result.className = 'fail';
      }
      row.append(name, result);
      $('results').append(row);
      SelectionControls.close();
    }
    await check('接入原输入框，保留可编辑语义，避免双重原生候选', () => {
      assert(
        field.getAttribute('role') === 'combobox' && !field.hasAttribute('list'),
        '接入状态错误',
      );
      assert(field.getAttribute('aria-expanded') === 'false', '初始状态错误');
    });
    await check('展开全部候选，去重但保留0012/12与A/a', () => {
      field.click();
      assert(options().length === 6, '候选去重错误');
      for (const value of ['0012', '12', 'A', 'a'])
        assert(
          options().some((item) => textOf(item) === value),
          '编号被转换',
        );
      assert(menus()[0].matches(':popover-open'), '浮层未进入顶层');
    });
    await check('点击候选后回传原input/change，保持前导零', () => {
      field.click();
      const beforeInput = inputs,
        beforeChange = changes;
      choose('0012');
      assert(field.value === '0012' && menus().length === 0, '选择值或关闭状态错误');
      assert(inputs === beforeInput + 1 && changes === beforeChange + 1, '原事件丢失或重复');
      assert(list.options.length === values.length, '自定义输入被增加到预设');
    });
    await check('过滤候选、方向键和回车选择保留英文大小写', () => {
      field.value = 'a';
      field.dispatchEvent(new InputEvent('input', { bubbles: true }));
      assert(options().length === 2, '过滤结果错误');
      sendKey(field, 'ArrowDown');
      sendKey(field, 'Enter');
      assert(field.value === 'A', '方向键选择错误');
    });
    await check('Esc和Tab关闭候选，不擅自提交高亮值', () => {
      field.value = '12';
      field.click();
      sendKey(field, 'ArrowDown');
      sendKey(field, 'Escape');
      assert(field.value === '12' && menus().length === 0, 'Esc改变值');
      field.click();
      sendKey(field, 'ArrowDown');
      sendKey(field, 'Tab');
      assert(field.value === '12' && menus().length === 0, 'Tab改变值');
    });
    await check('无匹配项展示空状态，允许继续输入', () => {
      field.value = '不存在';
      field.dispatchEvent(new InputEvent('input', { bubbles: true }));
      assert(options().length === 0 && !!document.querySelector('.choice-empty'), '缺少空状态');
    });
    await check('中文组合输入期间不弹层，组合结束才过滤', () => {
      field.value = '中文';
      field.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          isComposing: true,
          inputType: 'insertCompositionText',
        }),
      );
      assert(menus().length === 0, '组合输入被打断');
      field.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '中文' }));
      assert(
        options().length === 1 && textOf(options()[0]) === '中文长异常说明',
        '组合结束没有更新',
      );
    });
    await check('候选文本按文字呈现，不解释成HTML', () => {
      field.value = '';
      field.click();
      assert(
        options().some((item) => textOf(item) === '<img src=x>'),
        '文字丢失',
      );
      assert(document.querySelector('.choice-menu img') === null, '候选执行了HTML');
    });
    await check('标签输入第一次回车只选值，下一次才交给原加入逻辑', () => {
      const tags = [];
      field.onkeydown = (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          tags.push(field.value);
          field.value = '';
        }
      };
      field.value = '';
      field.click();
      sendKey(field, 'ArrowDown');
      sendKey(field, 'Enter');
      assert(tags.length === 0 && field.value === '0012', '候选回车提前加入标签');
      sendKey(field, 'Enter');
      assert(tags.length === 1 && tags[0] === '0012', '未回传原标签回车');
      field.onkeydown = null;
    });
    await check('重复扫描组件不会重复派发选择事件', () => {
      SelectionControls.scan();
      SelectionControls.scan();
      field.value = '';
      field.click();
      const before = changes;
      choose('a');
      assert(changes === before + 1 && field.value === 'a', '事件重复绑定');
    });
    await check('弹窗候选位于模态窗口的顶层且不越出视口', () => {
      $('modal').showModal();
      SelectionControls.scan();
      $('modalInput').click();
      const menu = menus()[0],
        rect = menu.getBoundingClientRect();
      assert(
        menu.closest('dialog') === $('modal') && menu.matches(':popover-open'),
        '浮层被模态窗口遮挡',
      );
      assert(
        rect.left >= 0 &&
          rect.right <= innerWidth + 1 &&
          rect.top >= 0 &&
          rect.bottom <= innerHeight + 1,
        '菜单越界',
      );
      SelectionControls.close();
      $('modal').close();
    });
    await check('实际CSS支持统一原生picker与大字号菜单', () => {
      const select = document.createElement('select');
      select.append(new Option('0012', '0012'), new Option('英文 A', 'A'));
      $('fixture').append(select);
      assert(getComputedStyle(select).appearance === 'base-select', '浏览器未应用可定制picker');
      assert(getComputedStyle(select.options[0]).minHeight === '32px', '选项规则未被浏览器接受');
      document.documentElement.dataset.font = 'large';
      field.value = '';
      field.click();
      assert(
        getComputedStyle(options()[0]).minHeight === '36px' &&
          getComputedStyle(menus()[0]).fontSize === '15px',
        '大字号没有覆盖候选',
      );
      delete document.documentElement.dataset.font;
    });
    await check('四种主题的当前选中项可读，高对比关闭透明材质', () => {
      const root = document.documentElement;
      const luminance = (color) => {
        const rgb = color
          .match(/[\d.]+/g)
          .slice(0, 3)
          .map(Number)
          .map((n) => n / 255);
        const linear = rgb.map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4));
        return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
      };
      for (const theme of ['silver', 'glass', 'graphite', 'contrast']) {
        root.dataset.theme = theme;
        field.value = '0012';
        field.click();
        const option = options().find((item) => item.getAttribute('aria-selected') === 'true');
        const style = getComputedStyle(option),
          a = luminance(style.color),
          b = luminance(style.backgroundColor);
        assert(
          (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 4.5,
          '选中项对比不足：' + theme,
        );
        if (theme === 'contrast')
          assert(getComputedStyle(menus()[0]).backdropFilter === 'none', '高对比仍透明');
        SelectionControls.close();
      }
      root.dataset.theme = 'graphite';
    });
    await check('页面重绘移除字段后清除残留菜单', async () => {
      field.value = '';
      field.click();
      field.remove();
      await tick();
      assert(menus().length === 0, '遗留孤立菜单');
    });
    const result = {
      passed,
      failed,
      total: passed + failed,
      mode: 'actual-component-synthetic-events',
      nativeIMEAccepted: false,
      windowsExeAccepted: false,
    };
    $('summary').textContent = `${passed} 项通过，${failed} 项失败`;
    const pre = document.createElement('pre');
    pre.id = 'resultJSON';
    pre.textContent = JSON.stringify(result);
    $('results').after(pre);
  };
})();
