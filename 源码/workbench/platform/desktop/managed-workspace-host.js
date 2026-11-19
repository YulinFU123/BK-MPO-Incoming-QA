'use strict';
// Host only: credentials never cross the IPC boundary. Existing .eap format is retained.
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes, randomUUID, createHash } = require('node:crypto');
const { createSQLiteStateStore } = require('../adapters/state/sqlite-state-store');
const { createUnifiedRepository } = require('../adapters/encrypted/repository');
const { createPlatform } = require('../index');
const { metadata, emptyState } = require('../domain/managed-workspaces');
const { workspaceMode } = require('../domain/home-source');
const { choose } = require('../domain/home-source');
const query = require('../domain/workspace-query');
const { PlatformError } = require('../domain/errors');
const fail = (code, message) => {
  throw new PlatformError(code, message);
};
async function createManagedWorkspaceHost({
  directory,
  encryption,
  controller,
  beforeSwitch = async () => {},
  clock = Date.now,
  saveBackup = async () => null,
  pickBackup = async () => null,
  readBI = async () => ({ state: 'empty' }),
  closeBI = async () => {},
}) {
  const store = await createSQLiteStateStore(path.join(directory, 'catalog.sqlite'));
  const key = 'managed-workspaces/v1';
  let chain = Promise.resolve();
  const queue = (fn) => {
    const p = chain.then(fn);
    chain = p.catch(() => {});
    return p;
  };
  async function publishNew(target, bytes) {
    const handle = await fs.open(target, 'wx');
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
  const file = (id) => {
    if (typeof id !== 'string' || !/^ws_[a-f0-9-]{36}$/.test(id))
      fail('WORKSPACE_INVALID', '工作区标识无效。');
    return path.join(directory, 'data', id + '.eap');
  };
  const today = () => {
    const d = new Date(clock());
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const legacyFingerprint = (p) =>
    createHash('sha256')
      .update(JSON.stringify([p.range, p.start || '', p.end || '', p.grain, p.datasetId]))
      .digest('hex');
  const storedEntry = (e) => {
    const old = query.legacy(e.meta.analysis, today());
    return {
      ...e,
      meta: { ...e.meta, analysis: old },
      analysisV2: structuredClone(e.meta.analysis),
      legacyAnalysisHash: legacyFingerprint(old),
    };
  };
  async function read() {
    const row = await store.read(key);
    if (!row)
      return { revision: 0, items: [], layout: { view: 'cards', sort: 'recent', selectedId: '' } };
    let value;
    try {
      value = JSON.parse(await encryption.decryptString(Buffer.from(row.payload)));
    } catch {
      fail(
        'WORKSPACE_CATALOG_UNREADABLE',
        '本机工作区目录无法解锁，原文件已保留。请使用原Windows账户和完整程序配置。',
      );
    }
    if (value.schema !== 1 || !Array.isArray(value.items) || value.items.length > 100)
      fail('WORKSPACE_CATALOG_UNREADABLE', '工作区目录格式不兼容，原文件未改动。');
    for (const e of value.items) {
      file(e.id);
      if (e.deletedAt !== undefined && (!Number.isSafeInteger(e.deletedAt) || e.deletedAt <= 0))
        fail('WORKSPACE_CATALOG_UNREADABLE', '工作区回收站信息无效，原文件已保留。');
      const fingerprint = legacyFingerprint(e.meta.analysis);
      e.meta = metadata(e.meta);
      e.dataSourceMode = workspaceMode(e.dataSourceMode);
      // v0.11 ignores outer extension fields. Honor edits made by that version.
      if (e.analysisV2 && e.legacyAnalysisHash === fingerprint)
        e.meta.analysis = query.normalize(e.analysisV2);
      if (typeof e.secret !== 'string' || e.secret.length < 32)
        fail('WORKSPACE_CATALOG_UNREADABLE', '工作区密钥不完整。');
    }
    return { ...value, revision: row.revision };
  }
  async function write(c) {
    if (!(await encryption.isEncryptionAvailable()))
      fail('STATE_ENCRYPTION_UNAVAILABLE', '本机账户保护暂不可用，工作区尚未保存。');
    const items = c.items.map(storedEntry);
    const payload = await encryption.encryptString(
      JSON.stringify({ schema: 1, items, layout: c.layout }),
    );
    const saved = await store.write({ key, expected: c.revision, payload, updated: clock() });
    c.revision = saved.revision;
  }
  const publicEntry = (e) => ({
    id: e.id,
    ...e.meta,
    createdAt: e.createdAt,
    lastUsed: e.lastUsed,
    state: e.state,
    dataSourceMode: workspaceMode(e.dataSourceMode),
    ...(e.deletedAt ? { deletedAt: e.deletedAt } : {}),
  });
  function find(c, id, includeDeleted = false) {
    const e = c.items.find((e) => e.id === id);
    if (!e) fail('WORKSPACE_NOT_FOUND', '未找到此工作区。');
    if (e.deletedAt && !includeDeleted)
      fail('WORKSPACE_DELETED', '此工作区已删除，请先从工作区回收站恢复。');
    return e;
  }
  async function using(e, fn) {
    if (controller.status().managedId === e.id) return fn(null);
    const repo = await createUnifiedRepository({ file: file(e.id), password: e.secret });
    try {
      return await fn(repo);
    } finally {
      await repo.close();
    }
  }
  async function settings(e) {
    return using(e, async (repo) =>
      repo ? (await repo.snapshot()).legacyState : controller.legacyBootstrap(),
    );
  }
  async function report(e, input = {}) {
    const { biFilter = null, ...recordInput } = input;
    return using(e, async (repo) => {
      const core = repo ? await createPlatform({ repository: repo }) : null;
      const cat = core ? await core.queries.catalog() : await controller.catalog();
      const q = {
        ...query.resolve(e.meta.analysis, today(), cat.dateRange),
        datasetId: e.meta.analysis.datasetId || cat.datasets[0]?.id || '',
        grain: e.meta.analysis.grain,
        pageSize: 5,
        ...recordInput,
      };
      const result = core
        ? await core.analysis.home(q, { today: today() })
        : await controller.homeReport(q);
      const mode = workspaceMode(e.dataSourceMode);
      const bi =
        mode === 'records'
          ? { state: 'not-requested' }
          : await readBI({
              id: e.id,
              file: file(e.id),
              query: q,
              biFilter,
              allDates: e.meta.analysis.range === 'all' && !recordInput.start && !recordInput.end,
            });
      const primary = choose(result, bi, { mode, channel: 'studio' });
      return {
        ...result,
        datasets: cat.datasets,
        primary,
        biSource: bi,
        scope:
          primary.source === 'bi' && bi.range ? { ...result.scope, ...bi.range } : result.scope,
      };
    });
  }
  async function create(input) {
    const { copyFrom = '', dataSourceMode = 'auto', ...raw } = input;
    workspaceMode(dataSourceMode);
    const meta = metadata(raw),
      c = await read();
    if (c.items.length >= 100)
      fail('WORKSPACE_LIMIT', '工作区与回收站合计最多100个，请保留历史备份后整理。');
    if (c.items.some((e) => !e.deletedAt && e.meta.name === meta.name))
      fail('WORKSPACE_NAME_EXISTS', '已有同名工作区，请换一个名称。');
    let initial = emptyState(meta.name, meta.process);
    if (copyFrom) {
      const original = find(c, copyFrom);
      if (!Object.hasOwn(raw, 'analysis')) meta.analysis = structuredClone(original.meta.analysis);
      const source = await settings(original);
      initial = {
        ...emptyState(meta.name, meta.process),
        templates: structuredClone(source.templates),
        activeTemplateId: source.activeTemplateId,
      };
    }
    const e = {
      id: 'ws_' + randomUUID(),
      secret: randomBytes(32).toString('base64'),
      meta,
      createdAt: clock(),
      lastUsed: 0,
      state: 'creating',
      dataSourceMode,
    };
    c.items.push(e);
    await write(c); // Commit protected key before creating business data.
    const repo = await createUnifiedRepository({
      file: file(e.id),
      password: e.secret,
      create: true,
      initialLegacyState: initial,
    });
    try {
      // Full initial document was atomically published once; no immediate rename.
    } finally {
      await repo.close();
    }
    e.state = 'ready';
    c.layout.selectedId = e.id;
    await write(c);
    return publicEntry(e);
  }
  return Object.freeze({
    managedList: () =>
      queue(async () => {
        const c = await read(),
          items = [],
          deletedItems = [];
        for (const e of c.items) {
          const item = publicEntry(e);
          if (e.deletedAt) {
            deletedItems.push(item);
            continue;
          }
          try {
            const r = await report(e, { grain: 'week' });
            item.summary = query.summary(r);
          } catch (err) {
            item.unavailable = true;
            item.message =
              err instanceof PlatformError ? err.message : '数据暂不可读取，原件保留。';
          }
          items.push(item);
        }
        return {
          items,
          deletedItems,
          layout: c.layout,
          activeId: controller.status().managedId || '',
          storage: 'windows-account-protected',
        };
      }),
    managedCreate: (input) => queue(() => create(input)),
    managedUpdate: ({ id, dataSourceMode, ...patch }) =>
      queue(async () => {
        const c = await read(),
          e = find(c, id);
        e.meta = metadata({ ...e.meta, ...patch });
        if (dataSourceMode !== undefined) e.dataSourceMode = workspaceMode(dataSourceMode);
        if (c.items.some((o) => o.id !== id && !o.deletedAt && o.meta.name === e.meta.name))
          fail('WORKSPACE_NAME_EXISTS', '已有同名工作区。');
        await write(c);
        controller.renameManaged?.({ id, name: e.meta.name, dataSourceMode: e.dataSourceMode });
        return publicEntry(e);
      }),
    managedDelete: ({ id }) =>
      queue(async () => {
        const c = await read(), e = find(c, id, true);
        if (e.deletedAt) return publicEntry(e);
        if (controller.status().managedId === id) await beforeSwitch();
        e.deletedAt = clock();
        // Older versions already understand archived entries and keep them out of the common list.
        e.meta = metadata({ ...e.meta, archived: true });
        if (c.layout.selectedId === id) c.layout.selectedId = '';
        await write(c);
        return publicEntry(e);
      }),
    managedRecover: ({ id }) =>
      queue(async () => {
        const c = await read(), e = find(c, id, true);
        if (!e.deletedAt) return publicEntry(e);
        const occupied = (name) => c.items.some((item) =>
          item.id !== id && !item.deletedAt && item.meta.name === name);
        let name = e.meta.name;
        if (occupied(name)) {
          const base = name.slice(0, 40);
          let index = 1;
          do { name = base + ' 恢复' + (index === 1 ? '' : index); index++; } while (occupied(name));
        }
        e.meta = metadata({ ...e.meta, name, archived: false });
        delete e.deletedAt;
        c.layout.selectedId = id;
        await write(c);
        return publicEntry(e);
      }),
    managedLayout: (input) =>
      queue(async () => {
        const c = await read();
        if (
          !input ||
          Object.keys(input).some((k) => !['view', 'sort', 'selectedId'].includes(k)) ||
          !['cards', 'list'].includes(input.view) ||
          !['recent', 'name', 'created'].includes(input.sort) ||
          typeof input.selectedId !== 'string' ||
          (input.selectedId && !c.items.some((e) => e.id === input.selectedId))
        )
          fail('WORKSPACE_INVALID', '工作区布局无效。');
        c.layout = structuredClone(input);
        await write(c);
        return c.layout;
      }),
    managedReport: ({ id, ...input }) => queue(async () => report(find(await read(), id), input)),
    managedFields: ({ id }) =>
      queue(async () => {
        const s = await settings(find(await read(), id));
        return { templates: s.templates, activeTemplateId: s.activeTemplateId };
      }),
    managedOpen: ({ id }) =>
      queue(async () => {
        const c = await read(),
          e = find(c, id);
        await beforeSwitch();
        const result = await controller.openManaged({
          id,
          name: e.meta.name,
          file: file(id),
          password: e.secret,
          dataSourceMode: workspaceMode(e.dataSourceMode),
        });
        e.lastUsed = clock();
        c.layout.selectedId = id;
        await write(c);
        return { ...result, analysisPreferences: structuredClone(e.meta.analysis) };
      }),
    // Same-account recovery package: protected credential + encrypted .eap, never a plaintext key file.
    managedBackup: ({ id }) =>
      queue(async () => {
        const c = await read(),
          e = find(c, id);
        if (controller.status().managedId === id) await beforeSwitch();
        const target = await saveBackup();
        if (!target) return { cancelled: true };
        const bytes = await fs.readFile(file(id));
        const sealed = await encryption.encryptString(
          JSON.stringify({
            format: 'bk-mpo-managed-backup-v1',
            entry: storedEntry(e),
            data: bytes.toString('base64'),
          }),
        );
        await publishNew(target, sealed);
        return {
          saved: true,
          name: path.basename(target),
          scope: 'same-windows-account',
          includes: 'business-and-catalog-settings',
        };
      }),
    managedRestore: () =>
      queue(async () => {
        const source = await pickBackup();
        if (!source) return { cancelled: true };
        const info = await fs.stat(source);
        if (info.size > 70 * 1024 * 1024) fail('WORKSPACE_INVALID', '备份超过70MB。');
        let v;
        try {
          v = JSON.parse(await encryption.decryptString(await fs.readFile(source)));
        } catch {
          fail('WORKSPACE_BACKUP_INVALID', '备份无法读取，需要原Windows账户及程序配置。');
        }
        if (v.format !== 'bk-mpo-managed-backup-v1' || !v.entry || typeof v.data !== 'string')
          fail('WORKSPACE_BACKUP_INVALID', '备份格式无效。');
        metadata(v.entry.meta);
        workspaceMode(v.entry.dataSourceMode);
        if (typeof v.entry.secret !== 'string' || v.entry.secret.length < 32)
          fail('WORKSPACE_BACKUP_INVALID', '备份密钥无效。');
        const c = await read();
        if (c.items.length >= 100) fail('WORKSPACE_LIMIT', '工作区数量已达上限。');
        const e = {
          ...v.entry,
          id: 'ws_' + randomUUID(),
          meta: {
            ...v.entry.meta,
            name: (
              v.entry.meta.name.slice(0, 28) +
              ' 恢复 ' +
              new Date(clock()).toLocaleTimeString('zh-CN')
            ).slice(0, 48),
          },
          lastUsed: 0,
          state: 'restoring',
        };
        const originalFingerprint = legacyFingerprint(e.meta.analysis);
        e.meta = metadata(e.meta);
        if (e.analysisV2 && e.legacyAnalysisHash === originalFingerprint)
          e.meta.analysis = query.normalize(e.analysisV2);
        c.items.push(e);
        await write(c);
        await fs.mkdir(path.dirname(file(e.id)), { recursive: true });
        await publishNew(file(e.id), Buffer.from(v.data, 'base64'));
        await using(e, async (repo) => {
          await repo.snapshot();
        });
        e.state = 'ready';
        await write(c);
        return publicEntry(e);
      }),
    async close() {
      await chain;
      await closeBI();
      await store.close();
    },
  });
}
module.exports = { createManagedWorkspaceHost };
