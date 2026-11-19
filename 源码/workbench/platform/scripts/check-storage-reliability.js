'use strict';

// Opt-in, synthetic-only investigation. Never opens a selected business file.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { createUnifiedRepository } = require('../adapters/encrypted/repository');
const fixture = require('../fixtures/synthetic.json');
const PASSWORD = 'Synthetic-reliability-QA-only-2026!';

function countArg(name, fallback, maximum) {
  const at = process.argv.indexOf(name);
  const value = at < 0 ? fallback : Number(process.argv[at + 1]);
  if (!Number.isInteger(value) || value < 1 || value > maximum) throw new Error(`Invalid ${name}`);
  return value;
}

async function run() {
  const cases = countArg('--cases', 40, 500);
  const writes = countArg('--writes', 15, 100);
  const root = path.resolve(
    process.env.PLATFORM_QA_ROOT || path.join(__dirname, '../../../../构建/当前作业/测试'),
  );
  if (root.startsWith('\\\\')) throw new Error('Use a local QA directory');
  fs.mkdirSync(root, { recursive: true });
  const directory = fs.mkdtempSync(path.join(root, 'storage-reliability-'));
  const reportFile = path.join(directory, 'result.json');
  const report = {
    schema: 'synthetic-storage-reliability/v1',
    runtime: process.versions.node,
    platform: process.platform,
    sourceVersion: require('../package.json').version,
    adapterSha256: crypto
      .createHash('sha256')
      .update(fs.readFileSync(require.resolve('../adapters/encrypted/repository')))
      .digest('hex'),
    syntheticOnly: true,
    cases,
    writesPerCase: writes,
    operations: 0,
    failedWrites: 0,
    recoveredRetries: 0,
    reopensVerified: 0,
    rollbackChecks: 0,
    retryEvents: [],
    failures: [],
    completed: false,
    storageIssueResolved: false,
  };
  const digest = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const originalRename = fs.renameSync;
  let active = null;
  fs.renameSync = (source, destination) => {
    try {
      return originalRename(source, destination);
    } catch (error) {
      if (active && destination === active.file) {
        active.events.push({
          code: /^[A-Z0-9_]{1,64}$/.test(error.code || '') ? error.code : 'IO_ERROR',
          errno: Number.isInteger(error.errno) ? error.errno : null,
          syscall: error.syscall === 'rename' ? 'rename' : 'other',
          elapsedMs: Math.round(performance.now() - active.started),
        });
      }
      throw error;
    }
  };
  const persist = () => fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  try {
    for (let caseId = 1; caseId <= cases; caseId++) {
      const file = path.join(directory, `synthetic-${caseId}.eap`);
      let repository;
      try {
        repository = await createUnifiedRepository({ file, password: PASSWORD, create: true });
        let expected = await repository.snapshot();
        for (let writeId = 1; writeId <= writes; writeId++) {
          const before = digest(file);
          active = { file, events: [], started: performance.now() };
          report.operations++;
          try {
            if (writeId % 3 === 0) await repository.transaction(() => {});
            else repository.saveLegacy(structuredClone(fixture.legacyState));
            expected = await repository.snapshot();
          } catch (error) {
            if (error.code !== 'STORAGE_WRITE_FAILED') throw error;
            report.failedWrites++;
            assert.equal(digest(file), before, 'Failed write changed original bytes');
            assert.deepEqual(await repository.snapshot(), expected, 'Failed write changed cache');
            report.rollbackChecks++;
            report.failures.push({
              caseId,
              writeId,
              code: error.code,
              details: error.details,
              io: active.events,
            });
            // Explicit investigation retry, not a change to production retry policy.
            await new Promise((resolve) => setTimeout(resolve, 300));
            try {
              repository.saveLegacy(structuredClone(fixture.legacyState));
              report.recoveredRetries++;
              expected = await repository.snapshot();
            } catch (retryError) {
              if (retryError.code !== 'STORAGE_WRITE_FAILED') throw retryError;
              assert.equal(digest(file), before);
              assert.deepEqual(await repository.snapshot(), expected);
              report.failures[report.failures.length - 1].retryFailed = true;
            }
          } finally {
            if (active.events.length)
              report.retryEvents.push({ caseId, writeId, events: active.events });
            active = null;
          }
        }
        await repository.close();
        repository = await createUnifiedRepository({ file, password: PASSWORD });
        assert.deepEqual(await repository.snapshot(), expected);
        report.reopensVerified++;
      } finally {
        if (repository) await repository.close();
        persist();
      }
    }
    report.completed = true;
  } catch (error) {
    report.fatal = { name: error.name, code: error.code || 'QA_ASSERTION_FAILED' };
    process.exitCode = 1;
  } finally {
    fs.renameSync = originalRename;
    persist();
  }
  console.log(JSON.stringify({ reportFile, ...report, retryEvents: report.retryEvents.length }));
  if (report.failedWrites) process.exitCode = 2;
}

if (require.main === module)
  run().catch(() => {
    process.exitCode = 1;
  });
