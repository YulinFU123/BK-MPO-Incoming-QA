'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');

const fixtureFile = path.join(__dirname, 'fixtures', 'openpyxl-synthetic-quality.xlsx');
const provenance = require('./fixtures/openpyxl-synthetic-quality.provenance.json');
const legacyFixture = require('../fixtures/synthetic.json');
const dataset = {
  id: 'fileFlowQuality', label: '合成工作簿检验样本', version: '1',
  grainFields: ['process', 'relatedCode'], unit: 'piece'
};
const mapping = {
  dateColumn: '业务日', dateFormat: 'iso',
  dimensions: { process: '工序', relatedCode: '丝印编号' },
  measures: { inspectedUnits: '检验数', defectiveUnits: '不良件数', productionUnits: '产量' }
};

function qaDirectory() {
  // Tests write only synthetic QA data in the project build job. An explicitly
  // supplied QA root makes a separately extracted development package portable.
  const root = path.resolve(process.env.PLATFORM_QA_ROOT || path.join(__dirname, '../../../构建/当前作业/测试'));
  const dir = path.join(root, 'file-flow', randomUUID());
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const errorCode = expected => error => error.code === expected;

test('independent openpyxl OOXML fixture preserves dates, text IDs, zero masks and physical rows', async () => {
  const { createXlsxReader } = require('../adapters/xlsx/reader');
  const bytes = fs.readFileSync(fixtureFile);
  assert.equal(provenance.synthetic, true);
  assert.equal(provenance.generator, 'openpyxl');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), provenance.sha256);
  const reader = createXlsxReader();
  const catalog = await reader.inspect({ bytes });
  assert.deepEqual(catalog.sheets.map(sheet => sheet.name), ['检验明细', '说明']);
  await assert.rejects(reader.read({ bytes, headerRow: 2 }), errorCode('SHEET_SELECTION_REQUIRED'));
  const result = await reader.read({ bytes, sheetName: '检验明细', headerRow: 2 });
  assert.equal(result.headerRow, 2);
  assert.equal(result.sheetName, '检验明细');
  assert.deepEqual(result.rowNumbers, [3, 5]);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0]['业务日'], '2026-10-25');
  assert.equal(result.rows[1]['业务日'], '2026-10-26');
  assert.equal(result.rows[0].SN, '0001Ab');
  assert.equal(result.rows[1].SN, '0002aB');
  assert.equal(result.rows[0]['丝印编号'], '0012');
  assert.equal(result.rows[1]['丝印编号'], 'AB12');
  assert.equal(result.rows[1]['检验数'], '100');
  assert.equal(result.rows[1]['不良件数'], '2');
});

test('actual XLSX commits encrypted, survives a fresh process, restores safely and deduplicates after restart', async () => {
  const { createPlatform } = require('../index');
  const { createXlsxReader } = require('../adapters/xlsx/reader');
  const { createEncryptedRepository, restoreEncryptedBackup } = require('../adapters/encrypted/repository');
  const bytes = fs.readFileSync(fixtureFile);
  const qa = qaDirectory();
  const file = path.join(qa, '合成数据.encrypted.json');
  const backupFile = path.join(qa, '合成备份.encrypted.json');
  const restoredFile = path.join(qa, '合成恢复.encrypted.json');
  const password = 'Synthetic-QA-password-2026';
  const source = { sheetName: '检验明细', headerRow: 2 };
  let repository = await createEncryptedRepository({ file, password, create: true });
  try {
    const platform = await createPlatform({
      repository, workbookReader: createXlsxReader(),
      legacyState: structuredClone(legacyFixture.legacyState),
      legacyMappings: structuredClone(legacyFixture.legacyMappings)
    });
    const preview = await platform.imports.previewWorkbook({ bytes, dataset, mapping, source });
    assert.equal(preview.provenance.identityBasis, 'file-sha256');
    assert.equal(preview.provenance.contentHash, provenance.sha256);
    assert.equal(preview.provenance.sheetName, source.sheetName);
    const committed = await platform.imports.commitPreview(preview.previewId, { acknowledgeWarnings: true });
    assert.equal(committed.status, 'imported');
    const snapshot = await repository.snapshot();
    assert.deepEqual(snapshot.facts.map(fact => fact.source.rowNumber), [3, 5]);
    assert.deepEqual(snapshot.facts.map(fact => fact.dimensions.relatedCode), ['0012', 'AB12']);
    const ciphertext = fs.readFileSync(file, 'utf8');
    assert.equal(ciphertext.includes('0001Ab'), false);
    assert.equal(ciphertext.includes('底座断裂'), false);
    assert.equal(ciphertext.includes(password), false);
  } finally { await repository.close(); }

  // A new OS process proves that reopening does not depend on a module singleton
  // or retained memory state. The password goes through stdin, never argv/logs.
  const childScript = `
    const fs = require('node:fs');
    const {createEncryptedRepository} = require(process.argv[1]);
    const {createPlatform} = require(process.argv[2]);
    (async () => {
      const {password} = JSON.parse(fs.readFileSync(0, 'utf8'));
      const repo = await createEncryptedRepository({file:process.argv[3],password});
      try {
        const platform = await createPlatform({repository:repo});
        const report = await platform.analysis.overview({start:'2026-10-26',end:'2026-10-26',datasetId:'fileFlowQuality'});
        const snapshot = await repo.snapshot();
        process.stdout.write(JSON.stringify({
          factCount:snapshot.facts.length, batchCount:snapshot.batches.length,
          sourceRows:snapshot.facts.map(f=>f.source.rowNumber),
          relatedCodes:snapshot.facts.map(f=>f.dimensions.relatedCode),
          rate:report.quality.rate.value, inspected:report.quality.totals.inspectedUnits,
          defective:report.quality.totals.defectiveUnits,
          recordCount:report.observations.recordCount, uniqueSN:report.observations.uniqueSerialCount
        }));
      } finally { await repo.close(); }
    })().catch(error => {process.stderr.write(error.code || 'CHILD_FAILED');process.exitCode=1;});
  `;
  const child = spawnSync(process.execPath, ['-e', childScript,
    require.resolve('../adapters/encrypted/repository'), require.resolve('../index'), file], {
    input: JSON.stringify({ password }), encoding: 'utf8', timeout: 30000,
    windowsHide: true, maxBuffer: 1024 * 1024
  });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stderr || 'Fresh process did not exit successfully');
  assert.deepEqual(JSON.parse(child.stdout), {
    factCount: 2, batchCount: 1, sourceRows: [3, 5], relatedCodes: ['0012', 'AB12'],
    rate: 0.02, inspected: 100, defective: 2, recordCount: 2, uniqueSN: 1
  });

  repository = await createEncryptedRepository({ file, password });
  try {
    const platform = await createPlatform({ repository, workbookReader: createXlsxReader() });
    const again = await platform.imports.previewWorkbook({ bytes, dataset, mapping, source });
    assert.equal((await platform.imports.commitPreview(again.previewId, { acknowledgeWarnings: true })).status, 'duplicate');
    assert.equal((await repository.snapshot()).batches.length, 1);
    await repository.backup({ file: backupFile });
    assert.equal(fs.readFileSync(backupFile, 'utf8').includes('0001Ab'), false);
  } finally { await repository.close(); }

  const restored = await restoreEncryptedBackup({ backupFile, file: restoredFile, password });
  try {
    const platform = await createPlatform({ repository: restored });
    const report = await platform.analysis.overview({ start: '2026-10-26', end: '2026-10-26', datasetId: dataset.id });
    assert.equal(report.quality.rate.value, 0.02);
    assert.equal(report.quality.totals.inspectedUnits, 100);
    assert.equal(report.observations.recordCount, 2);
    const snapshot = await restored.snapshot();
    assert.equal(snapshot.batches.length, 1);
    assert.deepEqual(snapshot.facts.map(fact => fact.source.rowNumber), [3, 5]);
  } finally { await restored.close(); }

  // A failed restore must not publish an empty/partial destination or touch the
  // authenticated source vault. These checks use the actual XLSX-derived store.
  const vaultHash = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const backupHash = createHash('sha256').update(fs.readFileSync(backupFile)).digest('hex');
  const wrongPasswordFile = path.join(qa, '错误密码不得生成.encrypted.json');
  await assert.rejects(restoreEncryptedBackup({ backupFile, file: wrongPasswordFile, password: 'Wrong-Synthetic-QA-Password' }), errorCode('VAULT_AUTH_FAILED'));
  assert.equal(fs.existsSync(wrongPasswordFile), false);
  assert.equal(fs.existsSync(wrongPasswordFile + '.lock'), false);

  const tamperedBackupFile = path.join(qa, '合成篡改备份.encrypted.json');
  const tamperedDestination = path.join(qa, '篡改备份不得生成.encrypted.json');
  const tampered = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
  tampered.data = (tampered.data[0] === 'A' ? 'B' : 'A') + tampered.data.slice(1);
  fs.writeFileSync(tamperedBackupFile, JSON.stringify(tampered), { encoding: 'utf8', flag: 'wx' });
  await assert.rejects(restoreEncryptedBackup({ backupFile: tamperedBackupFile, file: tamperedDestination, password }), errorCode('VAULT_AUTH_FAILED'));
  assert.equal(fs.existsSync(tamperedDestination), false);
  assert.equal(fs.existsSync(tamperedDestination + '.lock'), false);
  await assert.rejects(restoreEncryptedBackup({ backupFile, file, password }), errorCode('STORAGE_EXISTS'));
  assert.equal(createHash('sha256').update(fs.readFileSync(file)).digest('hex'), vaultHash);
  assert.equal(createHash('sha256').update(fs.readFileSync(backupFile)).digest('hex'), backupHash);
});
