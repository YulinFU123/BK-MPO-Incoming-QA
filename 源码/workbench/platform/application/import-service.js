'use strict';

const { randomUUID } = require('node:crypto');
const { PlatformError } = require('../domain/errors');
const { canonicalJSON, sha256 } = require('../domain/identity');
const { exactText } = require('../domain/validation');
const { requireRepository } = require('../ports/contracts');
const { assertJSONData } = require('../ports/dto');

const deepFreeze = value => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};

/** Two-phase import. Only a service-owned preview can be committed. */
function createImportService({ repository, rowAdapter, workbookReader = null, clock = () => Date.now(), idFactory = randomUUID, ttlMs = 600000, maxPreviews = 20 }) {
  requireRepository(repository);
  const previews = new Map();
  const completed = new Set();
  const activeCount = () => previews.size - completed.size;
  const expire = () => {
    const now = clock();
    for (const [id, entry] of previews) if (entry.expiresAt <= now) { previews.delete(id); completed.delete(id); }
  };

  async function prepare({ rows, dataset, mapping, source = {} }, fileIdentity = null) {
    expire();
    if (activeCount() >= maxPreviews) throw new PlatformError('PREVIEW_CAPACITY', '待确认预览过多，请取消旧预览后重试。');
    // Bound before cloning/hashing to avoid accepting an unbounded renderer DTO.
    if (!Array.isArray(rows) || rows.length === 0 || rows.length > 10000) throw new PlatformError('INVALID_ROWS', '每批需要 1～10000 行。');
    assertJSONData({ rows, dataset, mapping, source });
    let serialized;
    try { serialized = JSON.stringify(rows); } catch { throw new PlatformError('INVALID_ROWS', '行数据必须可序列化。'); }
    if (serialized.length > 8 * 1024 * 1024) throw new PlatformError('PAYLOAD_TOO_LARGE', '导入预览超过大小限制。');
    const snapshot = structuredClone({ rows, dataset, mapping });
    const spec = rowAdapter.normalizeDataset(snapshot.dataset);
    const sheetName = exactText(source.sheetName ?? '数据', { field: 'sheetName', required: true });
    if (sheetName.length > 128) throw new PlatformError('INVALID_SHEET', '工作表名称过长。');
    const rowOffset = source.headerRow === undefined ? 2 : source.headerRow + 1;
    if (!Number.isSafeInteger(rowOffset) || rowOffset < 2 || rowOffset > 100000) throw new PlatformError('INVALID_HEADER_ROW', '表头行必须是有效正整数。');
    const contentHash = fileIdentity?.sha256 || sha256(canonicalJSON(snapshot.rows));
    const identityBasis = fileIdentity ? 'file-sha256' : 'normalized-rows-sha256';
    // Mapping intentionally excluded: changing it cannot re-import the same file.
    const identity = sha256(canonicalJSON({ datasetId: spec.id, identityBasis, contentHash, sheetName }));
    const previewId = idFactory();
    const batchId = idFactory();
    const normalized = rowAdapter.previewBiRows({ ...snapshot, dataset: spec, source: {
      batchId, rowOffset, ...(source.rowNumbers ? { rowNumbers: source.rowNumbers } : {})
    } });
    const warnings = fileIdentity?.warnings || [];
    const warningCount = fileIdentity?.warningCount ?? warnings.length;
    const warningsTruncated = warningCount > warnings.length;
    const requiresAcknowledgement = warningsTruncated || warnings.some(warning => warning.requiresAcknowledgement === true);
    const current = (await repository.snapshot()).datasets.find(item => item.id === spec.id);
    if (current && canonicalJSON(current) !== canonicalJSON(spec)) throw new PlatformError('DATASET_CONFLICT', '现有数据集定义不同，请使用独立数据集。');
    const entry = deepFreeze({
      previewId, batchId, identity, dataset: normalized.dataset,
      mappingFingerprint: normalized.mappingFingerprint,
      facts: normalized.facts, errors: normalized.errors, stats: normalized.stats,
      warnings: structuredClone(warnings), warningCount, warningsTruncated, requiresAcknowledgement,
      createdAt: clock(), expiresAt: clock() + ttlMs,
      provenance: { identityBasis, contentHash, sheetName, headerRow: rowOffset - 1 }
    });
    // Another preview may have completed during the asynchronous repository read.
    expire();
    if (activeCount() >= maxPreviews) throw new PlatformError('PREVIEW_CAPACITY', '待确认预览过多，请取消旧预览后重试。');
    previews.set(previewId, entry);
    return structuredClone({
      previewId, expiresAt: entry.expiresAt, dataset: entry.dataset,
      stats: entry.stats, errors: entry.errors, warnings: entry.warnings,
      warningCount: entry.warningCount, warningsTruncated: entry.warningsTruncated,
      requiresAcknowledgement: entry.requiresAcknowledgement,
      canCommit: entry.stats.errorCount === 0 && entry.facts.length > 0 && !entry.requiresAcknowledgement,
      mappingFingerprint: entry.mappingFingerprint, provenance: entry.provenance
    });
  }

  return Object.freeze({
    previewRows: input => prepare(input),
    async inspectWorkbook({ bytes }) {
      if (!workbookReader || typeof workbookReader.inspect !== 'function') throw new PlatformError('WORKBOOK_READER_UNAVAILABLE', '工作簿检查器尚未配置。');
      if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > 25 * 1024 * 1024) throw new PlatformError('INVALID_WORKBOOK', '工作簿必须为不超过 25MB 的字节数据。');
      return workbookReader.inspect({ bytes: Buffer.from(bytes) });
    },
    async previewWorkbook({ bytes, dataset, mapping, source = {} }) {
      if (!workbookReader || typeof workbookReader.read !== 'function') throw new PlatformError('WORKBOOK_READER_UNAVAILABLE', '此开发内核尚未连接 Excel 文件解析器。');
      if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > 25 * 1024 * 1024) throw new PlatformError('INVALID_WORKBOOK', '工作簿必须为不超过 25MB 的字节数据。');
      const ownedBytes = Buffer.from(bytes);
      const actualHash = sha256(ownedBytes);
      const decoded = await workbookReader.read({ bytes: ownedBytes, sheetName: source.sheetName, headerRow: source.headerRow });
      const warnings = decoded.warnings || [];
      assertJSONData(warnings);
      if (!Array.isArray(warnings) || warnings.length > 100) throw new PlatformError('INVALID_READER_RESULT', '读取器警告结构无效。');
      const warningCount = decoded.warningCount ?? warnings.length;
      if (!Number.isSafeInteger(warningCount) || warningCount < warnings.length || warningCount > 1000000 ||
          (warningCount > 0 && warnings.length === 0) || warnings.some(warning => !warning || typeof warning !== 'object' ||
            typeof warning.code !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(warning.code) ||
            typeof warning.message !== 'string' || warning.message.length > 256)) {
        throw new PlatformError('INVALID_READER_RESULT', '读取器警告结构无效。');
      }
      return prepare({ rows: decoded.rows, dataset, mapping, source: {
        sheetName: decoded.sheetName, headerRow: decoded.headerRow,
        ...(decoded.rowNumbers ? { rowNumbers: decoded.rowNumbers } : {})
      } }, { sha256: actualHash, warnings, warningCount });
    },
    cancelPreview(previewId) { completed.delete(previewId); return previews.delete(previewId); },
    async commitPreview(previewId, { authorize = () => true, acknowledgeWarnings = false } = {}) {
      expire();
      const entry = previews.get(previewId);
      if (!entry) throw new PlatformError('PREVIEW_EXPIRED', '预览已过期或已取消，请重新预览。');
      if (entry.stats.errorCount !== 0 || !entry.facts.length) throw new PlatformError('INVALID_PREVIEW', '存在无效数据，整批未导入。');
      if (entry.requiresAcknowledgement && acknowledgeWarnings !== true) throw new PlatformError('WARNINGS_NOT_ACKNOWLEDGED', '请先核对并明确确认导入警告。');
      const result = await repository.transaction(async tx => {
        // Host-only guard is evaluated after any transaction-queue delay.
        if (!await authorize()) throw new PlatformError('WORKSPACE_LOCKED', '请先解锁工作台。');
        if (previews.get(previewId) !== entry) throw new PlatformError('PREVIEW_EXPIRED', '预览已取消或过期，请重新预览。');
        if (entry.expiresAt <= clock()) throw new PlatformError('PREVIEW_EXPIRED', '预览已过期，请重新预览。');
        const existing = tx.findBatch(entry.identity);
        if (existing) return { status: 'duplicate', batch: existing };
        tx.putDataset(entry.dataset);
        const batch = {
          id: entry.batchId, identity: entry.identity, datasetId: entry.dataset.id,
          datasetVersion: entry.dataset.version, mappingFingerprint: entry.mappingFingerprint,
          provenance: entry.provenance, factCount: entry.facts.length, committedAt: clock(),
          warningCodes: entry.warnings.map(warning => warning.code),
          warningsAcknowledged: entry.requiresAcknowledgement && acknowledgeWarnings === true,
          warningCount: entry.warningCount, warningsTruncated: entry.warningsTruncated
        };
        tx.addBatch(batch);
        tx.addFacts(entry.facts);
        return { status: 'imported', batch };
      });
      if (previews.has(previewId)) completed.add(previewId);
      // Retain a bounded idempotency window without blocking new imports.
      while (completed.size > 100) {
        const oldest = completed.values().next().value;
        completed.delete(oldest); previews.delete(oldest);
      }
      return result;
    }
  });
}

module.exports = { createImportService };
