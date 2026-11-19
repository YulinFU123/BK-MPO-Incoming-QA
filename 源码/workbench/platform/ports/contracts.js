'use strict';

/**
 * QualityRepository: transaction(async tx => result), snapshot().
 * Transaction: getDataset(id), putDataset(spec), findBatch(identity),
 * addBatch(batch), addFacts(facts), replaceObservations(observations).
 * WorkbookReader: read({bytes:Buffer, sheetName:string, headerRow:number})
 *   => Promise<{rows:Array<object>, sheetName:string, headerRow:number,
 *      rowNumbers:Array<number>, warnings:Array<object>, warningCount:number,
 *      warningsTruncated:boolean}>.
 *   inspect({bytes:Buffer}) => Promise<{sheets:Array<object>}>.
 * Reader MUST preserve formatted identifiers as strings, reject formulas without
 * cached values, and enforce decoded-size/zip-entry limits before returning rows.
 * EncryptedRepository also provides backup({file}), close()/lock() (terminal).
 * Host owns file paths/passwords; production acceptance remains separate from
 * process-restart durability tests. Never put new facts in the old vault v1.
 */
const { PlatformError } = require('../domain/errors');

function requireRepository(repository) {
  if (!repository || typeof repository.transaction !== 'function' || typeof repository.snapshot !== 'function') {
    throw new PlatformError('INVALID_REPOSITORY', '仓储接口不完整。');
  }
  return repository;
}

module.exports = { requireRepository };
