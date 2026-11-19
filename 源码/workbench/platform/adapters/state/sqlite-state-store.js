'use strict';
const { Worker } = require('node:worker_threads');
const { PlatformError } = require('../../domain/errors');
const messages = {
  STATE_SCHEMA_NEWER: '配置来自较新版本，当前版本未修改该文件。请使用对应版本打开。',
  STATE_DATABASE_DAMAGED: '配置库检查未通过，原文件已保留。请从独立配置备份恢复。',
  STATE_DATABASE_UNAVAILABLE: '配置存储无法打开，已保留原配置。请检查本机目录权限。',
  STATE_CONFLICT: '配置已在其他窗口更新，请重新读取后再保存。',
  STATE_WRITE_FAILED: '本次配置未保存，原配置保留。请稍后重试。',
  STATE_CLOSED: '配置服务已关闭，请重新打开软件。',
};
async function createSQLiteStateStore(file, { readOnly = false } = {}) {
  if (file.startsWith('\\\\'))
    throw new PlatformError(
      'STATE_DATABASE_UNAVAILABLE',
      '配置库需要本机用户目录，不能直接放在网络共享目录。',
    );
  const worker = new Worker(require.resolve('./sqlite-worker'), { workerData: { file, readOnly } });
  const pending = new Map();
  let id = 0,
    closed = false;
  const error = (code) => new PlatformError(code, messages[code] || messages.STATE_WRITE_FAILED);
  const ready = new Promise((resolve, reject) => {
    worker.once('message', (r) => (r.ready ? resolve() : reject(error(r.code))));
    worker.once('error', () => reject(error('STATE_DATABASE_UNAVAILABLE')));
    worker.once('exit', (code) => {
      if (code !== 0) reject(error('STATE_DATABASE_UNAVAILABLE'));
    });
  });
  function failed() {
    for (const { reject } of pending.values()) reject(error('STATE_CLOSED'));
    pending.clear();
    closed = true;
  }
  worker.on('error', failed);
  worker.on('exit', failed);
  worker.on('message', (r) => {
    const task = pending.get(r.id);
    if (!task) return;
    pending.delete(r.id);
    if (r.code) task.reject(error(r.code));
    else task.resolve(r.value);
  });
  try {
    await ready;
  } catch (e) {
    await worker.terminate();
    throw e;
  }
  function request(op, input = {}) {
    if (closed) return Promise.reject(error('STATE_CLOSED'));
    return new Promise((resolve, reject) => {
      const token = ++id;
      pending.set(token, { resolve, reject });
      worker.postMessage({ id: token, op, input });
    });
  }
  return Object.freeze({
    read: (key) => request('read', { key }),
    history: (key) => request('history', { key }),
    revision: (key, revision) => request('revision', { key, revision }),
    write: (input) => request('write', input),
    check: () => request('check'),
    backup: (file) => request('backup', { file }),
    async close() {
      if (closed) return;
      await request('close');
      closed = true;
      await worker.terminate();
    },
  });
}
module.exports = { createSQLiteStateStore };
