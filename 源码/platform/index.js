'use strict';

const { createMemoryRepository } = require('./adapters/memory/quality-repository');
const rowAdapter = require('./adapters/bi/rows-adapter');
const { adaptLegacyState } = require('./adapters/legacy/state-adapter');
const { createUnconfiguredGateway } = require('./adapters/bi/unconfigured-gateway');
const { createImportService } = require('./application/import-service');
const { createAnalysisService } = require('./application/analysis-service');
const { PlatformError } = require('./domain/errors');
const version = require('./package.json').version;
const { createXlsxReader } = require('./adapters/xlsx/reader');
const { createEncryptedRepository } = require('./adapters/encrypted/repository');
const { createQueryService } = require('./application/query-service');
const { createQualityService } = require('./application/quality-service');
const { auditLegacy } = require('./adapters/legacy/quality-audit');
const {
  validateFullLegacyState,
  legacyAnalysisProjection,
} = require('./adapters/legacy/full-state');

/** Composition root. No production files are opened; state is caller-supplied. */
async function createPlatform({
  legacyState = null,
  legacyMappings = {},
  repository = createMemoryRepository(),
  workbookReader = createXlsxReader(),
  clock,
  idFactory,
} = {}) {
  let legacyReport = null;
  if (legacyState) {
    if (repository.unified) {
      const existing = (await repository.snapshot()).legacyState;
      if (existing) legacyReport = legacyAnalysisProjection(existing);
      else {
        validateFullLegacyState(legacyState);
        await repository.transaction((tx) => tx.replaceLegacyState(legacyState));
        legacyReport = legacyAnalysisProjection(legacyState);
      }
    } else {
      legacyReport = adaptLegacyState(legacyState, { mappings: legacyMappings });
      if (legacyReport.stats.rejected > 0)
        throw new PlatformError('LEGACY_SNAPSHOT_INVALID', '历史快照存在无效记录，未载入。', {
          errorCount: legacyReport.stats.rejected,
        });
      await repository.transaction((tx) => tx.replaceObservations(legacyReport.observations));
    }
  }
  const readRepository = Object.freeze({
    kind: repository.kind,
    persistent: repository.persistent,
    transaction: repository.transaction,
    async snapshot() {
      const snapshot = await repository.snapshot();
      if (snapshot.legacyState) {
        const projection = legacyAnalysisProjection(snapshot.legacyState);
        snapshot.observations = projection.observations;
        snapshot.legacyQuality = { stats: projection.stats, errors: projection.errors };
      }
      return snapshot;
    },
  });
  const gateway = createUnconfiguredGateway();
  return Object.freeze({
    capabilities: Object.freeze({
      version,
      status: 'development',
      legacyReadOnlySnapshot: true,
      rowImport: true,
      excelFileImport: !!workbookReader,
      automaticBiExport: false,
      productionPersistence: false,
      durableStorage: repository.persistent === true,
      encryptedStorage: [
        'encrypted-file-development',
        'unified-encrypted-file-development',
      ].includes(repository.kind),
      completeLegacyRecords: repository.unified === true,
      desktopConnected: false,
    }),
    imports: createImportService({ repository, rowAdapter, workbookReader, clock, idFactory }),
    analysis: createAnalysisService({ repository: readRepository }),
    queries: createQueryService({ repository: readRepository }),
    quality: createQualityService({ repository: readRepository, legacyAudit: auditLegacy }),
    bi: gateway,
    legacyReport: legacyReport
      ? structuredClone({ stats: legacyReport.stats, errors: legacyReport.errors })
      : null,
  });
}

/** Host-only factory; no paths, passwords or keys are exposed through desktop IPC. */
async function createFilePlatform({
  file,
  password,
  create = false,
  repositoryFactory = createEncryptedRepository,
  ...options
}) {
  const repository = await repositoryFactory({ file, password, create });
  try {
    const platform = await createPlatform({ ...options, repository });
    return Object.freeze({
      ...platform,
      close: () => repository.close(),
      backup: (input) => repository.backup(input),
      ...(repository.unified
        ? {
            legacy: Object.freeze({
              snapshot: async () => (await repository.snapshot()).legacyState,
              save: (input) => repository.saveLegacy(input),
              backup: (input) => repository.legacyBackup(input),
              completeBackupSync: (input) => repository.backupSync(input),
              changePassword: (current, next) => repository.changePassword(current, next),
            }),
          }
        : {}),
    });
  } catch (error) {
    await repository.close();
    throw error;
  }
}

module.exports = { createPlatform, createFilePlatform };
