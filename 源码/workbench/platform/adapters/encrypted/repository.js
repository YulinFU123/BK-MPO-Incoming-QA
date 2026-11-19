'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { performance } = require('node:perf_hooks');
const { PlatformError } = require('../../domain/errors');
const { canonicalJSON, scopeKey } = require('../../domain/identity');
const { strictISODate } = require('../../domain/validation');
const { normalizeDataset } = require('../bi/rows-adapter');
const { createMemoryRepository } = require('../memory/quality-repository');
const { replaceFile } = require('./replace-file');
const { acquireProcessLock } = require('./process-lock');

const scrypt = promisify(crypto.scrypt);
const VERSION = 1;
const ANALYSIS_PROFILE = Object.freeze({
  format: 'exception-analysis-platform-vault',
  schema: 'exception-analysis-snapshot',
  legacy: false,
});
const UNIFIED_PROFILE = Object.freeze({
  format: 'exception-unified-platform',
  schema: 'exception-unified-workspace',
  legacy: true,
});
const profileAAD = (profile) => Buffer.from(`${profile.format}/v${VERSION}/snapshot-v1`, 'utf8');
const KDF = 'scrypt-32768-8-1';
const KDF_OPTIONS = Object.freeze({ N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
const MAX_PLAIN = 32 * 1024 * 1024;
const MAX_FILE = 45 * 1024 * 1024;
const EMPTY = (profile) => ({
  datasets: [],
  batches: [],
  facts: [],
  observations: [],
  ...(profile.legacy ? { legacyState: null } : {}),
});
const MEASURES = ['inspectedUnits', 'defectiveUnits', 'productionUnits', 'defectEvents'];
const HEX = /^[a-f0-9]{64}$/;
const DIMENSION = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const UNSAFE = new Set(['__proto__', 'constructor', 'prototype']);

function fail(code, message) {
  throw new PlatformError(code, message);
}
function invalid() {
  fail('STORAGE_STATE_INVALID', '分析数据结构无效，未保存。');
}
function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}
function text(value, { required = true, max = 1024 } = {}) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) invalid();
}
function integer(value, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) invalid();
}
function exactKeys(value, allowed, optional = []) {
  if (
    !object(value) ||
    Object.keys(value).some((key) => !allowed.includes(key) && !optional.includes(key)) ||
    allowed.some((key) => !Object.hasOwn(value, key))
  )
    invalid();
}

/** A larger storage budget than a single preview; rejects executable DTOs. */
function plainSnapshot(value, { maxDepth = 16 } = {}) {
  const seen = new Set();
  let nodes = 0;
  let strings = 0;
  function visit(item, depth) {
    if (++nodes > 2000000 || depth > maxDepth) invalid();
    if (typeof item === 'string') {
      if ((strings += item.length) > MAX_PLAIN) invalid();
      return;
    }
    if (
      item === null ||
      typeof item === 'boolean' ||
      (typeof item === 'number' && Number.isFinite(item))
    )
      return;
    if (typeof item !== 'object' || seen.has(item)) invalid();
    const proto = Object.getPrototypeOf(item);
    if (
      (!Array.isArray(item) && proto !== Object.prototype && proto !== null) ||
      (Array.isArray(item) && proto !== Array.prototype)
    )
      invalid();
    const keys = Reflect.ownKeys(item);
    if (
      keys.some((key) => typeof key !== 'string') ||
      (Array.isArray(item) && keys.length !== item.length + 1)
    )
      invalid();
    if (Array.isArray(item)) {
      // A matching key count is insufficient: a sparse array can replace a
      // missing index with an enumerable numeric property outside its length.
      // JSON would turn that hole into null and discard the extra property.
      for (let index = 0; index < item.length; index++) {
        if (!Object.hasOwn(item, index)) invalid();
      }
    }
    seen.add(item);
    for (const key of keys) {
      if (Array.isArray(item) && key === 'length') continue;
      if (UNSAFE.has(key) || (Array.isArray(item) && !/^(0|[1-9]\d*)$/.test(key))) invalid();
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) invalid();
      visit(descriptor.value, depth + 1);
    }
    seen.delete(item);
  }
  visit(value, 0);
}

function dimensions(value, grainFields = []) {
  if (!object(value) || Object.keys(value).length > 32) invalid();
  for (const [key, entry] of Object.entries(value)) {
    if (!DIMENSION.test(key) || UNSAFE.has(key)) invalid();
    text(entry, { required: grainFields.includes(key) });
  }
  if (grainFields.some((field) => !Object.hasOwn(value, field))) invalid();
}

function validateLegacyState(data) {
  const { validateFullLegacyState } = require('../legacy/full-state');
  const validated = validateFullLegacyState(data);
  if (validated === false) invalid();
  return data;
}

function validateSnapshot(state, profile = ANALYSIS_PROFILE) {
  plainSnapshot(state, { maxDepth: profile.legacy ? 42 : 16 });
  exactKeys(state, [
    'datasets',
    'batches',
    'facts',
    'observations',
    ...(profile.legacy ? ['legacyState'] : []),
  ]);
  for (const key of ['datasets', 'batches', 'facts', 'observations'])
    if (!Array.isArray(state[key])) invalid();
  if (profile.legacy && state.legacyState !== null) validateLegacyState(state.legacyState);
  if (
    state.datasets.length > 1000 ||
    state.batches.length > 10000 ||
    state.facts.length > 100000 ||
    state.observations.length > 100000
  )
    invalid();
  const datasets = new Map();
  for (const dataset of state.datasets) {
    const normalized = normalizeDataset(dataset);
    if (canonicalJSON(normalized) !== canonicalJSON(dataset) || datasets.has(dataset.id)) invalid();
    datasets.set(dataset.id, dataset);
  }
  const batches = new Map();
  const identities = new Set();
  for (const batch of state.batches) {
    exactKeys(
      batch,
      [
        'id',
        'identity',
        'datasetId',
        'datasetVersion',
        'mappingFingerprint',
        'provenance',
        'factCount',
        'committedAt',
      ],
      ['warningCodes', 'warningsAcknowledged', 'warningCount', 'warningsTruncated'],
    );
    if (
      Object.hasOwn(batch, 'warningCodes') &&
      (!Array.isArray(batch.warningCodes) ||
        batch.warningCodes.length > 100 ||
        batch.warningCodes.some(
          (code) => typeof code !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(code),
        ))
    )
      invalid();
    if (
      Object.hasOwn(batch, 'warningsAcknowledged') &&
      typeof batch.warningsAcknowledged !== 'boolean'
    )
      invalid();
    if (Object.hasOwn(batch, 'warningCount')) integer(batch.warningCount, 1000000);
    if (Object.hasOwn(batch, 'warningsTruncated') && typeof batch.warningsTruncated !== 'boolean')
      invalid();
    if (
      Object.hasOwn(batch, 'warningCount') &&
      Array.isArray(batch.warningCodes) &&
      batch.warningCount < batch.warningCodes.length
    )
      invalid();
    text(batch.id, { max: 128 });
    if (
      !HEX.test(batch.identity) ||
      !HEX.test(batch.mappingFingerprint) ||
      batches.has(batch.id) ||
      identities.has(batch.identity)
    )
      invalid();
    const dataset = datasets.get(batch.datasetId);
    if (!dataset || batch.datasetVersion !== dataset.version) invalid();
    integer(batch.factCount, 100000);
    integer(batch.committedAt);
    exactKeys(batch.provenance, ['identityBasis', 'contentHash', 'sheetName', 'headerRow']);
    if (
      !['file-sha256', 'normalized-rows-sha256'].includes(batch.provenance.identityBasis) ||
      !HEX.test(batch.provenance.contentHash)
    )
      invalid();
    text(batch.provenance.sheetName, { max: 128 });
    integer(batch.provenance.headerRow, 100000);
    if (batch.provenance.headerRow < 1) invalid();
    batches.set(batch.id, { batch, count: 0 });
    identities.add(batch.identity);
  }
  const factIds = new Set();
  const scopes = new Set();
  for (const fact of state.facts) {
    exactKeys(fact, [
      'id',
      'datasetId',
      'businessDate',
      'grainFields',
      'dimensions',
      'unit',
      'measures',
      'source',
    ]);
    if (!HEX.test(fact.id) || factIds.has(fact.id)) invalid();
    const dataset = datasets.get(fact.datasetId);
    if (
      !dataset ||
      fact.unit !== 'piece' ||
      canonicalJSON(fact.grainFields) !== canonicalJSON(dataset.grainFields)
    )
      invalid();
    strictISODate(fact.businessDate, 'businessDate');
    dimensions(fact.dimensions, fact.grainFields);
    exactKeys(fact.measures, MEASURES);
    for (const value of Object.values(fact.measures)) if (value !== null) integer(value);
    if (Object.values(fact.measures).every((value) => value === null)) invalid();
    if (
      fact.measures.defectiveUnits !== null &&
      fact.measures.inspectedUnits !== null &&
      fact.measures.defectiveUnits > fact.measures.inspectedUnits
    )
      invalid();
    exactKeys(fact.source, ['batchId', 'rowNumber']);
    integer(fact.source.rowNumber, 1048576);
    const owner = batches.get(fact.source.batchId);
    if (!owner || owner.batch.datasetId !== fact.datasetId || fact.source.rowNumber < 1) invalid();
    owner.count++;
    const scope = scopeKey(fact);
    if (scopes.has(scope)) invalid();
    factIds.add(fact.id);
    scopes.add(scope);
  }
  if ([...batches.values()].some((owner) => owner.count !== owner.batch.factCount)) invalid();
  const observationIds = new Set();
  for (const item of state.observations) {
    exactKeys(item, [
      'id',
      'templateId',
      'observedOn',
      'serialNumber',
      'issue',
      'relatedCode',
      'dimensions',
      'source',
    ]);
    text(item.id, { max: 1024 });
    text(item.templateId, { max: 1024 });
    if (observationIds.has(item.id)) invalid();
    observationIds.add(item.id);
    strictISODate(item.observedOn, 'observedOn');
    for (const field of ['serialNumber', 'issue', 'relatedCode'])
      text(item[field], { required: false, max: 32768 });
    dimensions(item.dimensions);
    exactKeys(item.source, ['system', 'recordId', 'templateId', 'dateBasis', 'dateField']);
    if (
      item.source.system !== 'legacy-state-v1' ||
      item.source.recordId !== item.id ||
      item.source.templateId !== item.templateId ||
      !['mapped-discovery-date', 'created-local-date'].includes(item.source.dateBasis)
    )
      invalid();
    text(item.source.dateField, { max: 1024 });
  }
  return state;
}

function filePath(value) {
  if (
    typeof value !== 'string' ||
    !path.isAbsolute(value) ||
    value.length > 32000 ||
    /[\x00-\x1f]/.test(value)
  )
    fail('STORAGE_PATH_INVALID', '需要由宿主指定绝对存储路径。');
  return path.resolve(value);
}
function assertRegularFile(file, { missing = false } = {}) {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink())
      fail('STORAGE_PATH_INVALID', '存储路径不是普通文件。');
    return stat;
  } catch (error) {
    if (missing && error.code === 'ENOENT') return null;
    if (error instanceof PlatformError) throw error;
    fail('STORAGE_READ_FAILED', '无法读取分析存储，请检查文件及权限。');
  }
}
function passwordValid(password, creating) {
  if (
    typeof password !== 'string' ||
    !password.length ||
    password.length > 1024 ||
    (creating && password.length < 12)
  )
    fail('PASSWORD_INVALID', '新存储密码至少 12 个字符，最多 1024 个字符。');
}
function base64(value, expected = null) {
  if (
    typeof value !== 'string' ||
    !value.length ||
    value.length > MAX_FILE ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
  )
    fail('VAULT_FORMAT_INVALID', '不是有效的分析平台加密文件。');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value || (expected !== null && bytes.length !== expected))
    fail('VAULT_FORMAT_INVALID', '不是有效的分析平台加密文件。');
  return bytes;
}

function parseEnvelope(raw, profile = ANALYSIS_PROFILE) {
  if (!Buffer.isBuffer(raw) || raw.length === 0 || raw.length > MAX_FILE)
    fail('VAULT_FORMAT_INVALID', '加密文件格式或大小无效。');
  let envelope;
  try {
    envelope = JSON.parse(raw.toString('utf8'));
  } catch {
    fail('VAULT_FORMAT_INVALID', '不是有效的分析平台加密文件。');
  }
  if (profile.legacy && envelope?.format === ANALYSIS_PROFILE.format)
    fail('MIGRATION_REQUIRES_COPY', '这是早期分析库，请复制导入到新的统一工作区，原文件不会修改。');
  if (
    !object(envelope) ||
    Object.keys(envelope).length !== 8 ||
    envelope.format !== profile.format ||
    envelope.version !== VERSION ||
    envelope.kdf !== KDF ||
    envelope.cipher !== 'aes-256-gcm'
  )
    fail('VAULT_FORMAT_INVALID', '不是本分析平台的加密文件，不会修改原文件。');
  const salt = base64(envelope.salt, 16),
    iv = base64(envelope.iv, 12),
    tag = base64(envelope.tag, 16),
    data = base64(envelope.data);
  if (data.length > MAX_PLAIN) fail('VAULT_FORMAT_INVALID', '加密数据超过大小限制。');
  return { salt, iv, tag, data };
}

async function decode(raw, password, profile = ANALYSIS_PROFILE) {
  const envelope = parseEnvelope(raw, profile);
  const key = await scrypt(password, envelope.salt, 32, KDF_OPTIONS);
  let plaintext;
  let authenticated = false;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, envelope.iv);
    decipher.setAAD(profileAAD(profile));
    decipher.setAuthTag(envelope.tag);
    plaintext = Buffer.concat([decipher.update(envelope.data), decipher.final()]);
    authenticated = true;
    if (plaintext.length > MAX_PLAIN) invalid();
    const payload = JSON.parse(plaintext.toString('utf8'));
    exactKeys(payload, ['schema', 'version', 'state']);
    if (payload.schema !== profile.schema || payload.version !== 1) invalid();
    validateSnapshot(payload.state, profile);
    return { key, salt: envelope.salt, state: payload.state };
  } catch (error) {
    key.fill(0);
    // Only a failed GCM authentication means the password (or the tag) is
    // wrong. A readable ciphertext with broken JSON/schema is a different
    // problem and must not send the user off retrying passwords forever.
    if (!authenticated)
      fail('VAULT_AUTH_FAILED', '密码不正确，或加密文件的认证信息已损坏。');
    if (error instanceof PlatformError) throw error;
    fail(
      'VAULT_STATE_CORRUPT',
      '密码正确，但加密文件内部数据损坏或版本不兼容；原文件未修改，请改用备份恢复。',
    );
  } finally {
    if (plaintext) plaintext.fill(0);
  }
}

function sealPayload(payload, key, salt, { format, aad }) {
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  try {
    if (plaintext.length > MAX_PLAIN) fail('STORAGE_CAPACITY', '分析数据超过当前开发版存储上限。');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(aad);
    const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Buffer.from(
      JSON.stringify({
        format,
        version: VERSION,
        kdf: KDF,
        cipher: 'aes-256-gcm',
        salt: salt.toString('base64'),
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        data: data.toString('base64'),
      }),
      'utf8',
    );
  } finally {
    plaintext.fill(0);
  }
}

function encode(state, key, salt, profile = ANALYSIS_PROFILE) {
  validateSnapshot(state, profile);
  return sealPayload({ schema: profile.schema, version: 1, state }, key, salt, {
    format: profile.format,
    aad: profileAAD(profile),
  });
}

const RECOVERY_NAME = /^[^\/\\]+\.recovery-[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const recoveryPrefix = (file) => `${path.basename(file)}.recovery-`;

/** Encrypted snapshots left behind by a failed Windows atomic replacement. */
function listRecoverySnapshots(file) {
  const target = filePath(file);
  const directory = path.dirname(target);
  const prefix = recoveryPrefix(target);
  let names;
  try {
    names = fs.readdirSync(directory);
  } catch {
    return [];
  }
  const snapshots = [];
  for (const name of names) {
    if (!name.startsWith(prefix) || !RECOVERY_NAME.test(name)) continue;
    try {
      const stat = fs.statSync(path.join(directory, name));
      if (stat.isFile()) snapshots.push({ name, bytes: stat.size, mtimeMs: Math.round(stat.mtimeMs) });
    } catch {
      /* a concurrently removed recovery file is not an error */
    }
  }
  return snapshots.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/** Bound disk growth without deleting the newest safety copies. */
function pruneRecoverySnapshots(file, keep = 3) {
  const directory = path.dirname(filePath(file));
  const stale = listRecoverySnapshots(file).slice(keep);
  for (const snapshot of stale) {
    try {
      fs.unlinkSync(path.join(directory, snapshot.name));
    } catch {
      /* best-effort cleanup only */
    }
  }
}

function recoveryPath(file, recoveryFile) {
  const target = filePath(file);
  if (typeof recoveryFile !== 'string' || !RECOVERY_NAME.test(recoveryFile) ||
      !recoveryFile.startsWith(recoveryPrefix(target)))
    fail('RECOVERY_INVALID', '可恢复副本名称无效，未修改任何文件。');
  return path.join(path.dirname(target), recoveryFile);
}

/** Verify the password and contents of a recovery snapshot without touching
 * the live workspace. Used by the recovery tool before any overwrite. */
async function inspectRecoverySnapshot({ file, recoveryFile, password, profile = UNIFIED_PROFILE }) {
  passwordValid(password, false);
  const source = recoveryPath(file, recoveryFile);
  const decoded = await decode(readEncrypted(source), password, profile);
  try {
    return { bytes: fs.statSync(source).size, state: structuredClone(decoded.state) };
  } finally {
    decoded.key.fill(0);
    decoded.salt.fill(0);
  }
}

/** Atomically publish a verified recovery snapshot over a workspace file.
 * The previous file is copied aside first, so the operation stays reversible. */
async function restoreRecoverySnapshot({ file, recoveryFile, password, profile = UNIFIED_PROFILE }) {
  passwordValid(password, false);
  const source = recoveryPath(file, recoveryFile);
  const checked = await decode(readEncrypted(source), password, profile);
  checked.key.fill(0);
  checked.salt.fill(0);
  const target = filePath(file);
  const backup = `${target}.before-recovery-${crypto.randomUUID()}`;
  const staged = `${target}.recovery-staging-${crypto.randomUUID()}`;
  fs.copyFileSync(target, backup, fs.constants.COPYFILE_EXCL);
  try {
    fs.copyFileSync(source, staged, fs.constants.COPYFILE_EXCL);
    replaceFile(staged, target);
  } catch (error) {
    try {
      fs.unlinkSync(staged);
    } catch {}
    try {
      fs.unlinkSync(backup);
    } catch {}
    throw error;
  }
  try {
    fs.unlinkSync(source);
  } catch {
    /* the staged copy is already the committed file; leftover is harmless */
  }
  return { restoredFrom: recoveryFile, preRestoreBackup: path.basename(backup) };
}

/** File-fsync plus same-directory atomic replacement. Directory fsync is not
 * available on every Windows filesystem; no power-loss durability claim is made.
 * Initial publication uses a hard link for an atomic no-overwrite destination. */
function atomicWrite(file, raw, { create = false } = {}) {
  const temporary = `${file}.pending-${crypto.randomUUID()}`;
  const started = performance.now();
  let phase = 'create-temporary';
  let fd;
  let published = false;
  let temporaryOwned = false;
  try {
    fd = fs.openSync(temporary, 'wx', 0o600);
    temporaryOwned = true;
    phase = 'write-temporary';
    fs.writeFileSync(fd, raw);
    phase = 'sync-temporary';
    fs.fsyncSync(fd);
    phase = 'close-temporary';
    fs.closeSync(fd);
    fd = undefined;
    if (create) {
      phase = 'publish-new';
      fs.linkSync(temporary, file);
      published = true;
      // Publication already succeeded. Failure removing an encrypted temporary
      // link must not misreport the successful commit as rolled back.
      try {
        fs.unlinkSync(temporary);
      } catch {
        /* encrypted, recognizable leftover */
      }
    } else {
      phase = 'verify-destination';
      assertRegularFile(file);
      phase = 'replace-existing';
      replaceFile(temporary, file);
      published = true;
    }
    if (published) {
      try {
        pruneRecoverySnapshots(file);
      } catch {
        /* cleanup must never turn a successful commit into a failure */
      }
    }
  } catch (error) {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {}
    }
    let temporaryCleaned = !temporaryOwned;
    let recoveryFile = null;
    if (!published && temporaryOwned) {
      // Once the temporary has been fully written, fsynced and closed it is
      // the ONLY copy of the user's new data. Deleting it on a failed Windows
      // replace silently discards the whole edit, so keep it as an encrypted,
      // clearly named recovery snapshot instead. Incomplete writes (fd still
      // open) are useless ciphertext and are still removed.
      if (fd === undefined) {
        const name = `${path.basename(file)}.recovery-${crypto.randomUUID()}`;
        try {
          fs.renameSync(temporary, path.join(path.dirname(file), name));
          recoveryFile = name;
          temporaryCleaned = true;
        } catch {
          temporaryCleaned = false;
        }
      } else {
        try {
          fs.unlinkSync(temporary);
          temporaryCleaned = true;
        } catch {
          // A failed write can leave an encrypted temporary, never a plaintext
          // recovery file. Report cleanup failure instead of hiding that fact.
        }
      }
    }
    if (error.code === 'EEXIST') fail('STORAGE_EXISTS', '目标文件已存在，不会覆盖。');
    const reason =
      typeof error.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(error.code)
        ? error.code
        : 'IO_ERROR';
    const guidance = recoveryFile
      ? '本次内容已加密保留为可恢复副本，请保留当前输入并点击重试；如需退出，请先用恢复工具取回内容，持续失败时检查目录写入权限或文件占用。'
      : ['EPERM', 'EACCES', 'EBUSY'].includes(reason)
        ? '请保留当前输入，稍后重试；持续失败时检查目录写入权限或文件占用。'
        : reason === 'ENOSPC'
          ? '磁盘空间不足，请保留当前输入并释放空间后重试。'
          : '请保留当前输入，检查磁盘及保存位置后重试。';
    throw new PlatformError('STORAGE_WRITE_FAILED', `加密保存失败，原有数据保持不变。${guidance}`, {
      reason,
      phase,
      attempts: Number.isSafeInteger(error.atomicAttempts) ? error.atomicAttempts : 1,
      elapsedMs: Math.max(0, Math.round(performance.now() - started)),
      temporaryCleaned,
      recoverable: Boolean(recoveryFile),
      recoveryFile,
    });
  }
}

async function hydrate(state, profile = ANALYSIS_PROFILE) {
  const repository = createMemoryRepository({ legacyStateEnabled: profile.legacy });
  await repository.transaction((tx) => {
    for (const dataset of state.datasets) tx.putDataset(dataset);
    for (const batch of state.batches) tx.addBatch(batch);
    tx.addFacts(state.facts);
    tx.replaceObservations(state.observations);
    if (profile.legacy) tx.replaceLegacyState(state.legacyState);
  });
  return repository;
}

function readEncrypted(file) {
  const stat = assertRegularFile(file);
  if (stat.size === 0 || stat.size > MAX_FILE)
    fail('VAULT_FORMAT_INVALID', '加密文件格式或大小无效。');
  try {
    return fs.readFileSync(file);
  } catch {
    fail('STORAGE_READ_FAILED', '无法读取分析加密文件。');
  }
}

async function openRepository({
  file: requestedFile,
  password,
  create = false,
  initialState = null,
  profile = ANALYSIS_PROFILE,
}) {
  const file = filePath(requestedFile);
  passwordValid(password, create);
  if (create) {
    if (assertRegularFile(file, { missing: true }))
      fail('STORAGE_EXISTS', '分析存储已存在，请解锁；不会覆盖。');
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
    } catch {
      fail('STORAGE_WRITE_FAILED', '无法创建分析存储目录。');
    }
  }
  const releaseLock = acquireProcessLock(file);
  let key = null;
  let salt = null;
  let state = null;
  try {
    if (create) {
      state = structuredClone(initialState || EMPTY(profile));
      validateSnapshot(state, profile);
      salt = crypto.randomBytes(16);
      key = await scrypt(password, salt, 32, KDF_OPTIONS);
      atomicWrite(file, encode(state, key, salt, profile), { create: true });
    } else {
      const decoded = await decode(readEncrypted(file), password, profile);
      ({ key, salt, state } = decoded);
    }
  } catch (error) {
    if (key) key.fill(0);
    releaseLock();
    throw error;
  }

  let queue = Promise.resolve();
  let lockRequested = false;
  let closed = false;
  let closePromise;
  let pending = 0;
  function unlocked() {
    if (lockRequested || closed || !key) fail('WORKSPACE_LOCKED', '分析存储已锁定，请重新打开。');
  }
  function enqueue(work) {
    try {
      unlocked();
    } catch (error) {
      return Promise.reject(error);
    }
    pending++;
    const operation = queue
      .then(async () => {
        unlocked();
        return work();
      })
      .finally(() => {
        pending--;
      });
    queue = operation.catch(() => undefined);
    return operation;
  }
  function close() {
    if (closePromise) return closePromise;
    lockRequested = true;
    // Reject queued work and destroy the private key/cache immediately. An
    // already-running callback may finish against its isolated staging copy,
    // but its final unlocked() check prevents any subsequent disk commit.
    if (key) key.fill(0);
    if (salt) salt.fill(0);
    key = null;
    salt = null;
    state = null;
    closePromise = queue.then(() => {
      closed = true;
      releaseLock();
    });
    return closePromise;
  }
  function publishBackup(destination) {
    const target = filePath(destination);
    if (assertRegularFile(target, { missing: true }))
      fail('STORAGE_EXISTS', '备份目标已存在，不会覆盖。');
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
    } catch {
      fail('STORAGE_WRITE_FAILED', '无法创建加密备份目录。');
    }
    const raw = encode(state, key, salt, profile);
    atomicWrite(target, raw, { create: true });
    return { format: profile.format, bytes: raw.length };
  }

  return Object.freeze({
    kind: profile.legacy ? 'unified-encrypted-file-development' : 'encrypted-file-development',
    unified: profile.legacy,
    persistent: true,
    snapshot: () => enqueue(() => structuredClone(state)),
    transaction(work) {
      if (typeof work !== 'function')
        return Promise.reject(new PlatformError('INVALID_TRANSACTION', '事务需要操作函数。'));
      return enqueue(async () => {
        const staging = await hydrate(state, profile);
        unlocked();
        const result = await staging.transaction(work);
        const candidate = await staging.snapshot();
        unlocked();
        validateSnapshot(candidate, profile);
        const raw = encode(candidate, key, salt, profile);
        // No await between final lock check, durable write and visible commit.
        unlocked();
        atomicWrite(file, raw);
        state = candidate;
        return structuredClone(result);
      });
    },
    backup({ file: destination } = {}) {
      return enqueue(() => publishBackup(destination));
    },
    backupSync({ file: destination } = {}) {
      unlocked();
      if (pending) fail('STORAGE_BUSY', '工作区正在保存其他变更，请稍后重试。');
      return publishBackup(destination);
    },
    changePassword(current, next) {
      return enqueue(async () => {
        passwordValid(current, false);
        passwordValid(next, true);
        const checked = await decode(readEncrypted(file), current, profile);
        let replacementKey;
        let replacementSalt;
        let adopted = false;
        try {
          unlocked();
          replacementSalt = crypto.randomBytes(16);
          replacementKey = await scrypt(next, replacementSalt, 32, KDF_OPTIONS);
          unlocked();
          const raw = encode(state, replacementKey, replacementSalt, profile);
          unlocked();
          atomicWrite(file, raw);
          key.fill(0);
          salt.fill(0);
          key = replacementKey;
          salt = replacementSalt;
          adopted = true;
          return true;
        } finally {
          checked.key.fill(0);
          checked.salt.fill(0);
          if (!adopted) {
            if (replacementKey) replacementKey.fill(0);
            if (replacementSalt) replacementSalt.fill(0);
          }
        }
      });
    },
    ...(profile.legacy
      ? {
          saveLegacy(data) {
            unlocked();
            if (pending) fail('STORAGE_BUSY', '工作区正在保存其他变更，请稍后重试。');
            validateLegacyState(data);
            const candidate = { ...structuredClone(state), legacyState: structuredClone(data) };
            const raw = encode(candidate, key, salt, profile);
            unlocked();
            atomicWrite(file, raw);
            state = candidate;
            return structuredClone(candidate.legacyState);
          },
          legacyBackup(data = undefined) {
            unlocked();
            if (pending) fail('STORAGE_BUSY', '工作区正在保存其他变更，请稍后重试。');
            const legacy = data === undefined ? state.legacyState : data;
            if (legacy === null || legacy === undefined)
              fail('LEGACY_STATE_MISSING', '统一工作区还没有异常记录数据。');
            validateLegacyState(legacy);
            return sealPayload(legacy, key, salt, {
              format: 'quality-desk-encrypted-vault',
              aad: Buffer.from('QualityDesk/vault/v1'),
            }).toString('utf8');
          },
        }
      : {}),
    lock: close,
    close,
  });
}

function createEncryptedRepository({ file, password, create = false }) {
  if (typeof create !== 'boolean')
    return Promise.reject(new PlatformError('INVALID_STORAGE_MODE', '存储创建模式无效。'));
  return openRepository({ file, password, create });
}

function createUnifiedRepository({ file, password, create = false, initialLegacyState = null }) {
  if (typeof create !== 'boolean')
    return Promise.reject(new PlatformError('INVALID_STORAGE_MODE', '存储创建模式无效。'));
  if (initialLegacyState !== null && !create)
    return Promise.reject(new PlatformError('INVALID_STORAGE_MODE', '初始记录仅能用于新建文件。'));
  const initialState =
    initialLegacyState === null
      ? null
      : { ...EMPTY(UNIFIED_PROFILE), legacyState: structuredClone(initialLegacyState) };
  return openRepository({ file, password, create, initialState, profile: UNIFIED_PROFILE });
}

/** Authenticate and validate backup before touching a new destination. Restore
 * never overwrites an existing file, and publishes only one encrypted snapshot. */
async function restoreEncryptedBackup({ backupFile, file, password }) {
  passwordValid(password, false);
  const decoded = await decode(readEncrypted(filePath(backupFile)), password);
  try {
    return await openRepository({ file, password, create: true, initialState: decoded.state });
  } finally {
    decoded.key.fill(0);
    decoded.salt.fill(0);
  }
}

async function restoreUnifiedBackup({ backupFile, file, password }) {
  passwordValid(password, false);
  const decoded = await decode(readEncrypted(filePath(backupFile)), password, UNIFIED_PROFILE);
  try {
    return await openRepository({
      file,
      password,
      create: true,
      initialState: decoded.state,
      profile: UNIFIED_PROFILE,
    });
  } finally {
    decoded.key.fill(0);
    decoded.salt.fill(0);
  }
}

module.exports = {
  createEncryptedRepository,
  restoreEncryptedBackup,
  createUnifiedRepository,
  restoreUnifiedBackup,
  listRecoverySnapshots,
  inspectRecoverySnapshot,
  restoreRecoverySnapshot,
};
