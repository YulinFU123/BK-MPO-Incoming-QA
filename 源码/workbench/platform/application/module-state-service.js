'use strict';
const { createHash, randomUUID } = require('node:crypto');
const model = require('../domain/module-state');
const { PlatformError } = require('../domain/errors');
const { assertJSONData } = require('../ports/dto');
const hash = (s) => createHash('sha256').update(s).digest('hex');
const fail = (code, message) => {
  throw new PlatformError(code, message);
};
/** Plain configuration and drafts only. This service never receives a business repository. */
function createModuleStateService({ store, encryption, context, clock = Date.now }) {
  let queue = Promise.resolve();
  const serial = (fn) => {
    const p = queue.then(fn);
    queue = p.catch(() => {});
    return p;
  };
  function bind(input) {
    assertJSONData(input);
    const a = model.address(input),
      c = context();
    if (a.scope !== 'global' && !c.unlocked)
      fail('WORKSPACE_LOCKED', '请先打开工作区，再读取该模块的配置。');
    const workspace = a.scope === 'global' ? 'global' : c.workspace;
    if (typeof workspace !== 'string' || !workspace) fail('STATE_INVALID', '工作区标识无效。');
    return {
      address: a,
      workspace,
      epoch: c.epoch,
      key: hash(JSON.stringify([workspace, a.scope, a.module, a.page, a.templateId])),
    };
  }
  function guard(b) {
    const now = context();
    if (
      b.address.scope !== 'global' &&
      (!now.unlocked || now.epoch !== b.epoch || now.workspace !== b.workspace)
    )
      fail('SESSION_CHANGED', '工作区已变化，本次配置操作已取消。');
  }
  async function available() {
    if (
      !(await encryption?.isEncryptionAvailable()) ||
      encryption.getSelectedStorageBackend?.() === 'basic_text'
    )
      fail(
        'STATE_ENCRYPTION_UNAVAILABLE',
        '本机加密暂不可用，本次配置不会以明文保存。请稍后重试。',
      );
  }
  async function decode(row, b) {
    await available();
    const v = JSON.parse(await encryption.decryptString(Buffer.from(row.payload)));
    assertJSONData(v);
    if (
      v.format !== 'BK-MPO-MODULE-STATE' ||
      v.version !== 1 ||
      v.key !== b.key ||
      v.revision !== row.revision
    )
      throw Error('binding');
    return {
      data: b.profiles ? validateProfiles(b, v.data) : model.validate(b.address, v.data),
      reset: v.reset === true,
    };
  }
  const defaultFor = (b) => (b.profiles ? { profiles: [] } : model.defaultData(b.address));
  function validateProfiles(b, value) {
    if (
      !value ||
      Object.keys(value).join() !== 'profiles' ||
      !Array.isArray(value.profiles) ||
      value.profiles.length > 12
    )
      fail('STATE_INVALID', '最多保存12个命名方案。');
    const ids = new Set();
    for (const p of value.profiles) {
      if (
        !p ||
        Object.keys(p).some((k) => !['id', 'name', 'createdAt', 'data'].includes(k)) ||
        typeof p.id !== 'string' ||
        !p.id ||
        ids.has(p.id) ||
        typeof p.name !== 'string' ||
        !p.name.trim() ||
        p.name.length > 64 ||
        !Number.isFinite(p.createdAt)
      )
        fail('STATE_INVALID', '配置方案名称或内容无效。');
      ids.add(p.id);
      model.validate(b.address, p.data);
    }
    return structuredClone(value);
  }
  function profileBind(input) {
    const b = bind(input);
    if (b.address.scope !== 'module')
      fail('STATE_INVALID', '命名方案仅适用于模块长期配置，草稿不会混入方案。');
    return { ...b, key: hash(b.key + ':profiles'), profiles: true };
  }
  async function readBound(b) {
    guard(b);
    const row = await store.read(b.key);
    guard(b);
    if (!row)
      return {
        address: b.address,
        revision: 0,
        data: defaultFor(b),
        savedAt: null,
        corrupt: false,
      };
    try {
      const v = await decode(row, b);
      guard(b);
      return {
        address: b.address,
        revision: row.revision,
        data: v.data,
        reset: v.reset,
        savedAt: row.updated,
        corrupt: false,
      };
    } catch (error) {
      if (
        error instanceof PlatformError &&
        ['SESSION_CHANGED', 'STATE_ENCRYPTION_UNAVAILABLE'].includes(error.code)
      )
        throw error;
      const history = await store.history(b.key);
      guard(b);
      return {
        address: b.address,
        revision: row.revision,
        data: defaultFor(b),
        savedAt: null,
        corrupt: true,
        warning:
          '当前配置无法读取，原文件保留。本次使用默认值；请在配置记忆中选择历史版本恢复，恢复前不会覆盖损坏版本。',
        history: history.filter((x) => x.revision !== row.revision),
      };
    }
  }
  function revision(v) {
    if (!Number.isSafeInteger(v) || v < 0) fail('STATE_INVALID', '配置版本无效。');
  }
  async function writeBound(b, data, expected, { reset = false, recover = false } = {}) {
    revision(expected);
    data = b.profiles ? validateProfiles(b, data) : model.validate(b.address, data);
    if (Buffer.byteLength(JSON.stringify(data), 'utf8') > 128 * 1024)
      fail('STATE_TOO_LARGE', '该模块配置或草稿超过128KB，请拆分后保存。');
    const current = await readBound(b);
    guard(b);
    if (current.revision !== expected) fail('STATE_CONFLICT', '配置已更新，请重新读取后再保存。');
    if (current.corrupt && !recover)
      fail('STATE_RECOVERY_REQUIRED', '当前配置损坏，请先明确选择历史版本恢复，原配置不会被覆盖。');
    if (!recover && !reset && JSON.stringify(current.data) === JSON.stringify(data))
      return { ...current, unchanged: true };
    await available();
    const payload = await encryption.encryptString(
      JSON.stringify({
        format: 'BK-MPO-MODULE-STATE',
        version: 1,
        key: b.key,
        revision: expected + 1,
        reset,
        data,
      }),
    );
    guard(b);
    const saved = await store.write({ key: b.key, expected, payload, updated: clock() });
    guard(b);
    return { address: b.address, ...saved, savedAt: saved.updated, data, corrupt: false, reset };
  }
  return Object.freeze({
    read(input) {
      const b = bind(input);
      return serial(() => readBound(b));
    },
    save({ address, data, expectedRevision }) {
      assertJSONData(data);
      data = structuredClone(data);
      const b = bind(address);
      return serial(() => writeBound(b, data, expectedRevision));
    },
    recover({ address, data, expectedRevision, confirmed }) {
      assertJSONData(data);
      data = structuredClone(data);
      const b = bind(address);
      if (confirmed !== true) fail('STATE_RECOVERY_REQUIRED', '请明确确认从备份恢复当前模块。');
      return serial(() => writeBound(b, data, expectedRevision, { recover: true }));
    },
    reset({ address, expectedRevision }) {
      const b = bind(address);
      return serial(() =>
        writeBound(b, model.defaultData(b.address), expectedRevision, { reset: true }),
      );
    },
    history(input) {
      const b = bind(input);
      return serial(async () => {
        guard(b);
        const rows = await store.history(b.key);
        guard(b);
        return rows;
      });
    },
    restore({ address, revision: target, expectedRevision }) {
      const b = bind(address);
      revision(target);
      return serial(async () => {
        guard(b);
        const row = await store.revision(b.key, target);
        if (!row) fail('STATE_HISTORY_MISSING', '该历史配置已不在保留的20个版本中。');
        let restored;
        try {
          restored = await decode(row, b);
        } catch {
          fail('STATE_HISTORY_DAMAGED', '该历史配置也无法读取，请选择其他版本。');
        }
        guard(b);
        return writeBound(b, restored.data, expectedRevision, {
          reset: restored.reset,
          recover: true,
        });
      });
    },
    profiles(input) {
      const b = profileBind(input);
      return serial(() => readBound(b));
    },
    saveProfile({ address, name, id, expectedRevision }) {
      const source = bind(address),
        target = profileBind(address);
      if (typeof name !== 'string' || !name.trim() || name.length > 64)
        fail('STATE_INVALID', '请填写1至64字的方案名称。');
      return serial(async () => {
        const current = await readBound(source),
          catalog = await readBound(target);
        if (current.corrupt) fail('STATE_RECOVERY_REQUIRED', '请先恢复当前模块配置。');
        const profiles = [...catalog.data.profiles];
        if (id) {
          const found = profiles.find((p) => p.id === id);
          if (!found) fail('STATE_INVALID', '未找到该方案。');
          found.name = name.trim();
          found.data = current.data;
        } else
          profiles.push({
            id: randomUUID(),
            name: name.trim(),
            createdAt: clock(),
            data: current.data,
          });
        return writeBound(target, { profiles }, expectedRevision);
      });
    },
    applyProfile({ address, id, expectedRevision }) {
      const target = bind(address),
        catalogBind = profileBind(address);
      return serial(async () => {
        const catalog = await readBound(catalogBind),
          p = catalog.data.profiles.find((x) => x.id === id);
        if (!p || catalog.corrupt) fail('STATE_INVALID', '该方案无法读取，请重新选择。');
        return writeBound(target, p.data, expectedRevision);
      });
    },
    flush: () => queue,
  });
}
module.exports = { createModuleStateService };
