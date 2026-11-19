'use strict';
window.createLabelMemoryUI = ({ api, unlocked, capture, apply }) => {
  const $ = (id) => document.getElementById(id);
  const initial = () => ({
    schemaVersion: 3,
    revision: 0,
    autoRemember: true,
    rememberCodes: false,
    current: null,
    profiles: [],
  });
  let state = initial(),
    ready = false,
    ticket = 0,
    edits = 0,
    savedEdits = 0,
    timer,
    saving = null,
    removed = null,
    persistence = '';
  function message(text, error = false) {
    $('labelMemoryStatus').textContent = text;
    $('labelMemoryStatus').classList.toggle('error', error);
  }
  function profiles() {
    const selected = $('labelProfiles').value;
    $('labelProfiles').replaceChildren(
      new Option('选择常用排版', ''),
      ...state.profiles.map((p) => new Option(p.title, p.id)),
    );
    if (state.profiles.some((p) => p.id === selected)) $('labelProfiles').value = selected;
    $('labelProfileRemove').disabled = !$('labelProfiles').value;
    $('labelProfileUndo').hidden = !removed;
  }
  function changed() {
    edits++;
    clearTimeout(timer);
    if (ready && $('labelAutoRemember').checked) {
      message('排版记忆待保存…');
      timer = setTimeout(() => flush(), 500);
    }
  }
  async function flush(force = false) {
    clearTimeout(timer);
    if (!unlocked() || !ready) return true;
    if (saving) {
      const result = await saving;
      return result && (edits !== savedEdits || force) ? flush(force) : result;
    }
    if (!force && edits === savedEdits) return true;
    const owner = ticket,
      version = edits;
    let snapshot;
    try {
      snapshot = {
        ...state,
        autoRemember: $('labelAutoRemember').checked,
        rememberCodes: $('labelRememberCodes').checked,
        current: $('labelAutoRemember').checked ? capture() : null,
      };
    } catch (error) {
      message('当前设置尚未有效，上次有效的排版记忆仍保留。', true);
      return !force;
    }
    const action = (async () => {
      try {
        const result = await api('saveLabelMemory', snapshot);
        if (owner !== ticket || !unlocked()) return false;
        // Preserve profile mutations made while the request was pending.
        state = { ...result.state, profiles: state.profiles };
        persistence = result.persistence;
        savedEdits = version;
        message(
          snapshot.autoRemember
            ? persistence === 'session-only'
              ? '示例排版已记住，仅在本次演示中保留。'
              : '排版已在本机加密记住' +
                (snapshot.rememberCodes ? '，包含本批编号及逐行内容。' : '，未记住本批行数据。')
            : '自动记忆已关闭；已存方案仍可使用。',
        );
        return true;
      } catch (error) {
        if (owner === ticket && unlocked()) {
          message(error.message, true);
          if (error.code === 'LABEL_MEMORY_CONFLICT') ready = false;
        }
        return false;
      }
    })();
    saving = action;
    const result = await action;
    if (saving === action) saving = null;
    if (result && owner === ticket && edits !== savedEdits) return flush();
    return result;
  }
  async function load() {
    const owner = ++ticket,
      version = edits;
    ready = false;
    message('正在读取本工作区的排版记忆…');
    try {
      const result = await api('readLabelMemory');
      if (owner !== ticket || !unlocked()) return;
      state = result.state;
      persistence = result.persistence;
      ready = true;
      $('labelAutoRemember').checked = state.autoRemember;
      $('labelRememberCodes').checked = state.rememberCodes;
      profiles();
      if (version === edits && state.autoRemember && state.current) {
        apply(state.current);
        savedEdits = edits;
        message(
          persistence === 'session-only'
            ? '已恢复示例排版记忆。'
            : '已恢复本工作区上次排版' + (state.rememberCodes ? '和本批内容。' : '。'),
        );
      } else {
        message(
          state.autoRemember
            ? '将自动记住排版，可在“排版方案与记忆”中选择是否记住编号。'
            : '自动记忆已关闭；可选择已存方案。',
        );
        if (version !== edits) changed();
      }
    } catch (error) {
      if (owner === ticket) message(error.message, true);
    }
  }
  $('labelAutoRemember').onchange = () => {
    edits++;
    flush(true);
  };
  $('labelRememberCodes').onchange = () => {
    edits++;
    flush(true);
  };
  $('labelMemorySave').onclick = () => {
    edits++;
    flush(true);
  };
  $('labelMemoryReload').onclick = load;
  $('labelOpenMemory').onclick = () => {
    $('labelViewDesign').click();
    $('labelMemoryDetails').open = true;
    $('labelMemoryDetails').scrollIntoView({ block: 'nearest' });
  };
  $('labelProfiles').onchange = () => {
    const p = state.profiles.find((p) => p.id === $('labelProfiles').value);
    $('labelProfileRemove').disabled = !p;
    if (p) {
      $('labelProfileTitle').value = p.title;
      apply(p.composition);
      changed();
    }
  };
  $('labelProfileSave').onclick = async () => {
    if (!ready) {
      message('请先恢复或重试读取记忆。', true);
      return;
    }
    try {
      const title = $('labelProfileTitle').value.trim();
      if (!title) throw Error('请填写方案名称。');
      const c = capture();
      delete c.codes;
      delete c.creators;
      delete c.records;
      const existing =
        state.profiles.find((p) => p.id === $('labelProfiles').value) ||
        state.profiles.find((p) => p.title === title);
      const profile = { id: existing?.id || crypto.randomUUID(), title, composition: c };
      if (!existing && state.profiles.length >= 30)
        throw Error('最多保留30个常用方案，可先移除不再使用的方案。');
      state.profiles = existing
        ? state.profiles.map((p) => (p.id === existing.id ? profile : p))
        : [...state.profiles, profile];
      edits++;
      if (await flush(true)) {
        profiles();
        $('labelProfiles').value = profile.id;
        $('labelProfileRemove').disabled = false;
      }
    } catch (error) {
      message(error.message, true);
    }
  };
  $('labelProfileRemove').onclick = async () => {
    const p = state.profiles.find((p) => p.id === $('labelProfiles').value);
    if (!p) return;
    removed = p;
    state.profiles = state.profiles.filter((item) => item.id !== p.id);
    edits++;
    profiles();
    await flush(true);
  };
  $('labelProfileUndo').onclick = async () => {
    if (!removed) return;
    if (state.profiles.length >= 30) {
      message('方案数量已满，请先移除一项。', true);
      return;
    }
    state.profiles = [...state.profiles, removed];
    removed = null;
    edits++;
    profiles();
    await flush(true);
  };
  return Object.freeze({
    changed,
    flush,
    activate: () => {
      if (!ready) load();
    },
    clear: () => {
      ticket++;
      saving = null;
      clearTimeout(timer);
      state = initial();
      ready = false;
      edits = 0;
      savedEdits = 0;
      removed = null;
      $('labelProfileTitle').value = '';
      $('labelAutoRemember').checked = true;
      $('labelRememberCodes').checked = false;
      profiles();
      message('打开排版页后读取记忆。');
    },
  });
};
