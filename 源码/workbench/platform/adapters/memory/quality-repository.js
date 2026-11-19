'use strict';

const { PlatformError } = require('../../domain/errors');
const { canonicalJSON, scopeKey } = require('../../domain/identity');

const copy = value => structuredClone(value);

/** Development only. A serialized copy-on-write transaction, never a disk store. */
function createMemoryRepository({ legacyStateEnabled = false } = {}) {
  let state = { datasets: new Map(), batches: new Map(), facts: new Map(), scopes: new Map(), observations: [], ...(legacyStateEnabled ? { legacyState: null } : {}) };
  let queue = Promise.resolve();
  let pending = 0;

  function transaction(work) {
    pending++;
    const operation = queue.then(async () => {
      const draft = copy(state);
      let open = true;
      const guard = () => {
        if (!open) throw new PlatformError('TRANSACTION_CLOSED', '事务已关闭。');
      };
      const tx = Object.freeze({
        getDataset(id) { guard(); return copy(draft.datasets.get(id) || null); },
        putDataset(spec) {
          guard();
          const existing = draft.datasets.get(spec.id);
          if (existing && canonicalJSON(existing) !== canonicalJSON(spec)) {
            throw new PlatformError('DATASET_CONFLICT', '数据集定义已存在且不一致；请建立独立数据集。');
          }
          draft.datasets.set(spec.id, copy(spec));
        },
        findBatch(identity) { guard(); return copy(draft.batches.get(identity) || null); },
        addBatch(batch) {
          guard();
          if (draft.batches.has(batch.identity)) throw new PlatformError('DUPLICATE_BATCH', '此批次已导入。');
          draft.batches.set(batch.identity, copy(batch));
        },
        addFacts(facts) {
          guard();
          for (const fact of facts) {
            const scope = scopeKey(fact);
            if (draft.scopes.has(scope)) throw new PlatformError('GRAIN_OVERLAP', '相同日期和统计维度已存在数据，整批未导入。');
            if (draft.facts.has(fact.id)) throw new PlatformError('DUPLICATE_FACT', '事实编号重复，整批未导入。');
            draft.scopes.set(scope, fact.id);
            draft.facts.set(fact.id, copy(fact));
          }
        },
        replaceObservations(observations) { guard(); draft.observations = copy(observations); },
        ...(legacyStateEnabled ? {
          replaceLegacyState(data) { guard(); draft.legacyState = copy(data); }
        } : {})
      });
      try {
        const result = await work(tx);
        const detached = copy(result);
        state = draft;
        return detached;
      } finally { open = false; }
    }).finally(() => { pending--; });
    queue = operation.catch(() => undefined);
    return operation;
  }

  return Object.freeze({
    kind: 'memory-development',
    unified: legacyStateEnabled,
    persistent: false,
    transaction,
    ...(legacyStateEnabled ? {
      replaceLegacySync(data) {
        if (pending) throw new PlatformError('STORAGE_BUSY', '工作区正在保存其他变更，请稍后重试。');
        state.legacyState = copy(data);
        return copy(state.legacyState);
      }
    } : {}),
    async snapshot() {
      await queue;
      return copy({
        datasets: [...state.datasets.values()], batches: [...state.batches.values()],
        facts: [...state.facts.values()], observations: state.observations,
        ...(legacyStateEnabled ? { legacyState: state.legacyState } : {})
      });
    }
  });
}

module.exports = { createMemoryRepository };
