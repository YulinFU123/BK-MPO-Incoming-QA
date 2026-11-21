'use strict';
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = (model, client) =>
    factory(model, client, require('./guide-pictures'), require('./guide-crops'));
  else root.createGuideUI = factory(root.WorkbenchGuides, root.createModuleStateClient,
    root.WorkbenchGuidePictures, root.WorkbenchGuideCrops || {});
})(
  globalThis,
  (model, createClient, pictures, crops) =>
    function createGuideUI({
      api,
      beforeOpen,
      afterClose,
      context,
      onError = () => {},
      allowed = () => true,
      document: doc = document,
    }) {
      const address = { scope: 'global', module: 'guides-v3' };
      const make = (tag, text, cls) => {
        const node = doc.createElement(tag);
        if (text !== undefined) node.textContent = text;
        if (cls) node.className = cls;
        return node;
      };
      const button = (text, fn, cls = 'button secondary') => {
        const node = make('button', text, cls);
        node.type = 'button';
        node.onclick = fn;
        return node;
      };
      let data = model.defaults(),
        loaded = false,
        loading = null,
        opening = false,
        corrupt = false,
        error = '',
        saveStatus = '',
        current = 'home',
        step = 0,
        playback = null,
        handledClose = false,
        pending = {},
        generation = 0,
        pictureViews = 0;
      const completedThisSession = new Set();
      const dialog = make('dialog', undefined, 'feature-guide');
      dialog.id = 'featureGuideDialog';
      dialog.setAttribute('aria-labelledby', 'guideTitle');
      const heading = make('h2', '功能新手引导');
      heading.id = 'guideTitle';
      const closeButton = button('退出引导', () => close('paused'), 'button quiet');
      const header = make('header', undefined, 'guide-header');
      header.append(heading, closeButton);
      const note = make(
        'p',
        '只读操作说明，不会自动提交或更改业务数据。可按Esc退出，稍后继续。',
        'guide-note',
      );
      const split = make('div', undefined, 'guide-layout');
      const library = make('nav', undefined, 'guide-library');
      library.setAttribute('aria-label', '全部功能引导');
      const searchLabel = make('label', '查找引导');
      const search = make('input');
      search.type = 'search';
      search.placeholder = '搜索功能名称，如BI、扫码、二维码';
      searchLabel.append(search);
      const list = make('div', undefined, 'guide-list');
      library.append(searchLabel, list);
      const content = make('section', undefined, 'guide-content');
      content.setAttribute('aria-label', '引导步骤');
      const title = make('h3');
      const count = make('p', '', 'guide-note');
      count.setAttribute('aria-live', 'polite');
      const progress = make('progress');
      progress.setAttribute('aria-label', '阅读步骤进度');
      const stepTitle = make('h4'),
        body = make('p', '', 'guide-body');
      const demonstration = make('div', undefined, 'guide-demo');
      const demoScreen = make('strong');
      const demoExample = make('p', '', 'guide-demo-example');
      const demoAction = make('span', '', 'guide-demo-action');
      demonstration.setAttribute('aria-label', '示例操作画面');
      demonstration.append(demoScreen, demoExample, demoAction);
      const viewer = make('dialog', undefined, 'guide-viewer');
      viewer.setAttribute('aria-labelledby', 'guideViewerTitle');
      const viewerTitle = make('h3');
      viewerTitle.id = 'guideViewerTitle';
      const closeViewer = button('返回引导', () => viewer.close());
      const viewerHead = make('header', undefined, 'guide-header');
      viewerHead.append(viewerTitle, closeViewer);
      const figure = make('figure', undefined, 'guide-picture');
      const caption = make('span', undefined, 'guide-picture-label');
      const enlarge = button('放大截图', () => {
        stopPlayback();
        pictureViews++; // A late progress read must not change what the reader is inspecting.
        viewer.showModal();
        closeViewer.focus();
        // A target at the far right of a wide screenshot should not open offscreen.
        if (full.image.decode) void full.image.decode().then(() => {
          if (!viewer.open) return;
          const r = full.marker.getBoundingClientRect(), box = scroll.getBoundingClientRect();
          scroll.scrollLeft += (r.left + r.right - box.left - box.right) / 2;
          scroll.scrollTop += (r.top + r.bottom - box.top - box.bottom) / 2;
        }).catch(() => {});
      }, 'button secondary guide-enlarge');
      const photo = () => {
        const frame = make('div', undefined, 'guide-frame'), image = make('img'), marker = make('span');
        marker.setAttribute('aria-hidden', 'true');
        frame.append(image, marker);
        return { frame, image, marker };
      };
      const thumb = photo(), full = photo();
      const photoBar = make('figcaption', undefined, 'guide-picture-bar');
      photoBar.append(caption, enlarge);
      figure.append(thumb.frame, photoBar);
      const scroll = make('div', undefined, 'guide-image-scroll');
      scroll.tabIndex = 0;
      scroll.setAttribute('role', 'region');
      scroll.setAttribute('aria-label', '原尺寸操作图，可使用方向键滚动');
      scroll.append(full.frame);
      viewer.append(viewerHead, scroll);
      viewer.addEventListener('close', () => { if (dialog.open) enlarge.focus(); });
      // Chromium can send cancel to both stacked dialogs if the top one closes
      // synchronously in cancel. Consume the Escape keystroke at the viewer.
      viewer.addEventListener('keydown', event => {
        if (event.key !== 'Escape' || event.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        viewer.close();
      });
      viewer.addEventListener('cancel', event => { event.preventDefault(); queueMicrotask(() => { if (viewer.open) viewer.close(); }); });
      function renderPicture() {
        const pic = pictures?.get(current, step);
        figure.hidden = !pic;
        if (!pic) return;
        const crop = crops[current + ':' + step];
        const kind = pic.kind === 'capture' ? '示例实拍' : '操作示意（非截图）';
        const heading = '图中标记：' + pic.label;
        const manualExample = pic.kind === 'capture' && ['home','analysis-hub','data-center'].includes(current);
        const description = kind + (manualExample ? '（手动录入工作区）' : '') + ' · ' + heading;
        caption.textContent = description;
        viewerTitle.textContent = description;
        enlarge.textContent = pic.kind === 'capture' ? '放大截图' : '放大示意图';
        for (const view of [thumb, full]) {
          const asset = view === thumb && crop ? crop : pic;
          const { image, marker } = view;
          image.alt = description;
          marker.className = 'guide-mark';
          for (const [i, prop] of ['left','top','width','height'].entries()) marker.style[prop] = asset.rect[i] + '%';
          if (view.file !== asset.file) { view.file = asset.file; image.src = asset.file; }
        }
      }
      thumb.image.onerror = () => { figure.hidden = true; thumb.file = null; };
      const steps = make('ol', undefined, 'guide-steps');
      const actions = make('div', undefined, 'guide-actions');
      const previous = button('上一步', () => move(-1));
      const next = button(
        '下一步',
        () => (step === model.get(current).steps.length - 1 ? complete() : move(1)),
        'button primary',
      );
      const replay = button(
        '重新开始',
        () => {
          stopPlayback();
          step = 0;
          remember('paused', { restart: true });
          render();
        },
        'button quiet',
      );
      const play = button('自动演示', () => {
        if (playback !== null) stopPlayback();
        else startPlayback();
      });
      const skip = button('跳过本功能', () => close('skipped'), 'button quiet');
      actions.append(previous, next, play, replay, skip);
      content.append(title, count, progress, stepTitle, body, figure, demonstration, actions, steps);
      split.append(library, content);
      const status = make('p', '', 'guide-note');
      status.setAttribute('role', 'status');
      const recovery = make('details', undefined, 'guide-recovery');
      recovery.append(make('summary', '进度与恢复'));
      const retry = button('重试保存进度', async () => {
        if (loaded && !corrupt && (await flush())) return;
        // Explicit retry rebases only this reader's touched guides onto the
        // latest revision, preserving progress from another window.
        await load();
        await flush();
        feedback();
      });
      const confirm = make('input');
      confirm.type = 'checkbox';
      const confirmLabel = make('label', '', 'guide-confirm');
      confirmLabel.append(confirm, make('span', '确认仅清除全部引导进度，不改业务数据'));
      const reset = button('重置引导进度', async () => {
        if (!confirm.checked) {
          error = '请先勾选确认，再重置引导进度。';
          feedback();
          return;
        }
        reset.disabled = true;
        try {
          if (!loaded) await load();
          if (!loaded) throw Error('进度尚未读取，不能重置。');
          // A normal save must finish first; corrupted rows have no pending writes.
          if (!corrupt) await client.flush();
          const row = await api('resetModuleState', {
            address,
            expectedRevision: client.current(address).revision,
          });
          client.adopt(address, row);
          data = model.validate(row.data);
          pending = {};
          completedThisSession.clear();
          corrupt = false;
          error = '';
          confirm.checked = false;
          stopPlayback();
          step = 0;
          render();
        } catch (e) {
          error = e.message;
          onError(e);
        } finally {
          reset.disabled = false;
          feedback();
        }
      });
      recovery.append(
        make(
          'p',
          '进度按当前Windows用户保存，各功能独立；切换工作区不会反复要求学习。',
          'guide-note',
        ),
        retry,
        confirmLabel,
        reset,
      );
      dialog.append(header, note, split, status, recovery);
      doc.body.append(dialog, viewer);
      const client = createClient({
        api,
        onStatus: (value) => {
          saveStatus = value;
          feedback();
        },
        onError: (e) => {
          error = e.message;
          feedback();
          onError(e);
        },
      });
      function feedback() {
        status.textContent = error
          ? `${error} 本次仍可阅读或退出，进度尚未可靠保存。`
          : !loaded
            ? '正在读取引导进度…'
            : corrupt
              ? '引导进度损坏，可在进度与恢复中重置。业务数据不受影响。'
              : {
                  saved: '引导进度已保存',
                  pending: '引导进度待保存',
                  saving: '正在保存引导进度',
                  failed: '引导进度未保存，可重试',
                }[saveStatus] || '引导进度已读取';
      }
      function renderList() {
        list.replaceChildren();
        let group;
        for (const guide of model.search(search.value).filter((guide) => allowed(guide.id))) {
          if (guide.group !== group) {
            group = guide.group;
            list.append(make('strong', group, 'guide-group'));
          }
          const state = data.progress[guide.id];
          const suffix = state
            ? { paused: '可继续', completed: '已完成', skipped: '已跳过' }[state.status]
            : '未阅读';
          const row = button(`${guide.title} · ${suffix}`, () => choose(guide.id), 'guide-link');
          row.setAttribute('aria-current', String(current === guide.id));
          list.append(row);
        }
        if (!list.children.length)
          list.append(make('p', '没有匹配的引导，请换一个关键词。', 'guide-note'));
      }
      function render() {
        const guide = model.get(current);
        title.textContent = guide.title;
        count.textContent = `第 ${step + 1} 步，共 ${guide.steps.length} 步`;
        progress.max = guide.steps.length;
        progress.value = step + 1;
        stepTitle.textContent = guide.steps[step].title;
        body.textContent = guide.steps[step].body;
        renderPicture();
        const demo = guide.steps[step].demo;
        demonstration.hidden = !demo;
        play.hidden = !demo;
        if (demo) {
          demoScreen.textContent = `演示数据 · ${demo.screen}`;
          demoExample.textContent = demo.example;
          demoAction.textContent = demo.action;
        }
        previous.disabled = step === 0;
        const last = step === guide.steps.length - 1;
        const completed = completedThisSession.has(current);
        next.textContent = last ? (completed ? '引导已完成' : '完成引导') : '下一步';
        next.disabled = last && completed;
        steps.replaceChildren();
        guide.steps.forEach((item, index) => {
          const row = make('li');
          const link = button(
            item.title,
            () => {
              stopPlayback();
              step = index;
              remember('paused');
              render();
              (next.disabled ? closeButton : next).focus();
            },
            'guide-step',
          );
          if (index === step) link.setAttribute('aria-current', 'step');
          row.append(link);
          steps.append(row);
        });
        renderList();
        feedback();
      }
      async function load() {
        if (loading) return loading;
        loading = (async () => {
          try {
            const row = await client.open(address);
            let restored = model.validate(row.data),
              migrated = false;
            if (!row.corrupt && row.revision === 0) {
              for (const module of ['guides-v2', 'guides']) {
                const legacy = await api('readModuleState', { scope: 'global', module });
                if (!legacy.corrupt) {
                  const candidate = model.validate(legacy.data);
                  if (Object.keys(candidate.progress).length) {
                    restored = candidate;
                    migrated = true;
                    break;
                  }
                }
              }
            }
            corrupt = !!row.corrupt;
            loaded = true;
            data = { ...restored, progress: { ...restored.progress, ...pending } };
            if (corrupt) {
              error = row.warning || '引导进度损坏';
              return;
            }
            error = '';
            if (migrated || Object.keys(pending).length) client.change(address, data);
          } catch (e) {
            error = e.message;
            onError(e);
          } finally {
            loading = null;
            feedback();
          }
        })();
        return loading;
      }
      function remember(state, { restart = false } = {}) {
        if (state === 'paused' && !restart && completedThisSession.has(current)) return;
        if (state !== 'completed') completedThisSession.delete(current);
        data = model.mark(data, current, state, step);
        pending[current] = data.progress[current];
        if (loaded && !corrupt) client.change(address, data);
        generation++;
        feedback();
      }
      function stopPlayback() {
        clearTimeout(playback);
        playback = null;
        play.textContent = '自动演示';
      }
      function schedulePlayback() {
        if (!dialog.open || step === model.get(current).steps.length - 1) {
          stopPlayback();
          return;
        }
        play.textContent = '暂停演示';
        playback = setTimeout(() => {
          move(1, true);
          schedulePlayback();
        }, 8500);
      }
      function startPlayback(restart = false) {
        if (!dialog.open || !model.get(current).steps[step].demo) return;
        stopPlayback();
        if (restart || step === model.get(current).steps.length - 1) {
          step = 0;
          remember('paused', { restart: true });
          render();
        }
        schedulePlayback();
      }
      function move(delta, automatic = false) {
        if (!automatic) stopPlayback();
        step = Math.max(0, Math.min(model.get(current).steps.length - 1, step + delta));
        remember('paused');
        render();
      }
      function choose(id) {
        if (!model.get(id) || !allowed(id)) return;
        stopPlayback();
        if (id !== current) remember('paused');
        current = id;
        const saved = data.progress[id];
        step = saved?.status === 'paused' ? saved.step : 0;
        render();
        next.focus();
      }
      async function flush() {
        try {
          if (loading) await loading;
          if (!loaded && Object.keys(pending).length) await load();
          if (corrupt || !loaded) return false;
          const ticket = generation;
          await client.flush();
          if (ticket === generation) pending = {};
          error = '';
          feedback();
          return true;
        } catch (e) {
          error = e.message;
          feedback();
          onError(e);
          return false;
        }
      }
      function complete() {
        stopPlayback();
        completedThisSession.add(current);
        remember('completed');
        render();
        closeButton.focus();
        void flush();
      }
      function close(state = 'paused') {
        if (!dialog.open) return;
        if (viewer.open) viewer.close();
        stopPlayback();
        remember(state);
        handledClose = true;
        dialog.close();
        // Optional learning progress must never trap a user inside a tour.
        void flush();
      }
      dialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        close('paused');
      });
      dialog.addEventListener('close', () => {
        stopPlayback();
        if (!handledClose) {
          remember('paused');
          void flush();
        }
        handledClose = false;
        afterClose();
      });
      search.oninput = renderList;
      async function open(id = context(), { autoplay = false } = {}) {
        if (!model.get(id) || !allowed(id)) id = 'home';
        if (dialog.open) {
          choose(id);
          if (autoplay) startPlayback(true);
          return;
        }
        if (opening) return;
        if (doc.querySelector('dialog[open]')) {
          onError(Error('请先关闭当前弹窗，再打开新手引导。'));
          return;
        }
        opening = true;
        try {
          await beforeOpen();
          completedThisSession.clear();
          current = id;
          step = 0;
          search.value = '';
          render();
          dialog.showModal();
          closeButton.focus();
          opening = false;
          const ticket = generation, viewsAtOpen = pictureViews;
          if (!loaded) await load();
          if (dialog.open && generation === ticket && pictureViews === viewsAtOpen) {
            const saved = data.progress[current];
            step = saved?.status === 'paused' ? saved.step : 0;
            render();
            if (autoplay) startPlayback(true);
          }
        } catch (e) {
          onError(e);
          afterClose();
        } finally {
          opening = false;
        }
      }
      return Object.freeze({ open, close, flush, isOpen: () => opening || dialog.open });
    },
);
