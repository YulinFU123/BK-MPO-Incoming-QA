'use strict';
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.createModuleStateClient = factory();
})(globalThis, () => {
  return function createModuleStateClient({
    api,
    onStatus = () => {},
    onError = () => {},
    delay = 350,
  }) {
    const entries = new Map();
    let active = true;
    const key = (a) => JSON.stringify(a);
    const report = () => {
      const values = [...entries.values()];
      onStatus(
        values.some((e) => e.error)
          ? 'failed'
          : values.some((e) => e.running)
            ? 'saving'
            : values.some((e) => e.dirty)
              ? 'pending'
              : 'saved',
      );
    };
    async function open(address) {
      const row = await api('readModuleState', address);
      entries.set(key(address), {
        address,
        row,
        dirty: false,
        timer: null,
        error: row.corrupt ? Error(row.warning) : null,
        running: null,
        data: structuredClone(row.data),
      });
      if (row.corrupt) onError({ message: row.warning, code: 'STATE_RECOVERY_REQUIRED' });
      report();
      return row;
    }
    function adopt(address, row) {
      const e = entries.get(key(address));
      if (e?.running || e?.dirty) throw Error('请先等待当前配置保存完成。');
      entries.set(key(address), {
        address,
        row,
        dirty: false,
        timer: null,
        error: row.corrupt ? Error(row.warning) : null,
        running: null,
        data: structuredClone(row.data),
      });
      report();
      return row;
    }
    async function save(e) {
      clearTimeout(e.timer);
      if (e.running) {
        await e.running;
        if (e.dirty) return save(e);
        return true;
      }
      if (!e.dirty) return true;
      if (e.row.corrupt) {
        e.error = Error('请先恢复损坏的配置。');
        report();
        return false;
      }
      const data = structuredClone(e.data);
      e.dirty = false;
      e.error = null;
      const task = (async () => {
        try {
          e.row = await api('saveModuleState', {
            address: e.address,
            data,
            expectedRevision: e.row.revision,
          });
          return true;
        } catch (error) {
          e.dirty = true;
          e.error = error;
          onError(error);
          return false;
        }
      })();
      e.running = task;
      report();
      const ok = await task;
      e.running = null;
      report();
      if (ok && e.dirty) return save(e);
      return ok;
    }
    function change(address, data) {
      const e = entries.get(key(address));
      if (!active || !e) return false;
      if (JSON.stringify(e.data) === JSON.stringify(data)) return true;
      e.data = structuredClone(data);
      e.dirty = true;
      e.error = null;
      clearTimeout(e.timer);
      e.timer = setTimeout(() => save(e), delay);
      report();
      return true;
    }
    return Object.freeze({
      open,
      adopt,
      change,
      current: (address) => entries.get(key(address))?.row,
      async rereadAll() {
        const previous = active;
        active = false;
        const snapshot = [...entries.values()];
        try {
          for (const e of snapshot) clearTimeout(e.timer);
          await Promise.all(snapshot.map((e) => e.running).filter(Boolean));
          const rows = [];
          for (const e of snapshot) {
            if (entries.get(key(e.address)) !== e) continue;
            rows.push(await open(e.address));
          }
          return rows;
        } finally {
          active = previous;
          report();
        }
      },
      async flush() {
        const results = await Promise.all([...entries.values()].map(save));
        if (results.some((x) => !x))
          throw Error('有配置尚未保存，请点击“重试保存”后再关闭或切换工作区。');
        return true;
      },
      detach() {
        for (const [k, e] of entries)
          if (e.address.scope !== 'global') {
            clearTimeout(e.timer);
            entries.delete(k);
          }
        report();
      },
      pause: (value) => {
        active = !value;
      },
    });
  };
});
