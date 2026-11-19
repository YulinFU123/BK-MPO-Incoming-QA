'use strict';
const { parentPort, workerData } = require('node:worker_threads');
const { DatabaseSync, backup } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
let db;
try {
  if (!workerData.readOnly && workerData.file !== ':memory:')
    fs.mkdirSync(path.dirname(workerData.file), { recursive: true });
  db = new DatabaseSync(workerData.file, {
    allowExtension: false,
    readOnly: workerData.readOnly === true,
  });
  db.exec('PRAGMA busy_timeout=300; PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF;');
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (![0, 1].includes(version)) throw Object.assign(Error(), { stateCode: 'STATE_SCHEMA_NEWER' });
  if (db.prepare('PRAGMA quick_check').get().quick_check !== 'ok')
    throw Object.assign(Error(), { stateCode: 'STATE_DATABASE_DAMAGED' });
  if (version === 0) {
    if (workerData.readOnly) throw Object.assign(Error(), { stateCode: 'STATE_DATABASE_DAMAGED' });
    // Never adopt an unrelated database as an empty configuration store.
    if (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().length)
      throw Object.assign(Error(), { stateCode: 'STATE_DATABASE_DAMAGED' });
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE heads (key TEXT PRIMARY KEY, revision INTEGER NOT NULL, updated INTEGER NOT NULL);
      CREATE TABLE revisions (key TEXT NOT NULL, revision INTEGER NOT NULL, updated INTEGER NOT NULL, payload BLOB NOT NULL, PRIMARY KEY(key,revision));
      PRAGMA application_id=1112232787; PRAGMA user_version=1; COMMIT;`);
  }
  if (db.prepare('PRAGMA application_id').get().application_id !== 1112232787)
    throw Object.assign(Error(), { stateCode: 'STATE_DATABASE_DAMAGED' });
  if (!workerData.readOnly) db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
  parentPort.postMessage({ ready: true });
} catch (error) {
  db?.close();
  parentPort.postMessage({ ready: false, code: error.stateCode || 'STATE_DATABASE_UNAVAILABLE' });
}
const routes = {
  read: ({ key }) => {
    const row = db
      .prepare(
        'SELECT h.revision,h.updated,r.payload FROM heads h JOIN revisions r ON h.key=r.key AND h.revision=r.revision WHERE h.key=?',
      )
      .get(key);
    if (!row && db.prepare('SELECT revision FROM heads WHERE key=?').get(key))
      throw Object.assign(Error(), { stateCode: 'STATE_DATABASE_DAMAGED' });
    return row || null;
  },
  history: ({ key }) =>
    db
      .prepare('SELECT revision,updated FROM revisions WHERE key=? ORDER BY revision DESC LIMIT 20')
      .all(key),
  revision: ({ key, revision }) =>
    db
      .prepare('SELECT revision,updated,payload FROM revisions WHERE key=? AND revision=?')
      .get(key, revision) || null,
  write: ({ key, expected, payload, updated }) => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const current = db.prepare('SELECT revision FROM heads WHERE key=?').get(key)?.revision || 0;
      if (current !== expected) throw Object.assign(Error(), { stateCode: 'STATE_CONFLICT' });
      const revision = current + 1;
      db.prepare('INSERT INTO revisions VALUES(?,?,?,?)').run(
        key,
        revision,
        updated,
        Buffer.from(payload),
      );
      db.prepare(
        'INSERT INTO heads VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET revision=excluded.revision,updated=excluded.updated',
      ).run(key, revision, updated);
      db.prepare('DELETE FROM revisions WHERE key=? AND revision<=?').run(key, revision - 20);
      db.exec('COMMIT');
      return { revision, updated };
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  },
  check: () => ({
    integrity: db.prepare('PRAGMA quick_check').get().quick_check,
    schemaVersion: 1,
    journal: db.prepare('PRAGMA journal_mode').get().journal_mode,
  }),
  backup: async ({ file }) => {
    await backup(db, file);
    return { saved: true };
  },
  close: () => {
    db.close();
    return true;
  },
};
let chain = Promise.resolve();
parentPort.on('message', (message) => {
  chain = chain.then(async () => {
    try {
      const value = await routes[message.op](message.input);
      parentPort.postMessage({ id: message.id, value });
    } catch (error) {
      parentPort.postMessage({ id: message.id, code: error.stateCode || 'STATE_WRITE_FAILED' });
    }
  });
});
