'use strict';
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { PlatformError } = require('../domain/errors');

/** Inherited stdin/stdout is the only transport. No port, cookie or web token. */
function startBIWorker({ python, script, source, data }) {
  const child = spawn(python, ['-I', '-B', '-u', script, '--source', source, '--data', data], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: source,
  });
  const exited = new Promise((resolve) => child.once('exit', resolve));
  const pending = new Map();
  let buffer = '',
    closed = false,
    settled = false,
    resolveReady,
    rejectReady;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const startupTimeout = setTimeout(
    () => fail(new PlatformError('BI_START_TIMEOUT', '分析引擎启动超时，请检查离线依赖包。')),
    30000,
  );
  function fail(error) {
    closed = true;
    clearTimeout(startupTimeout);
    if (!settled) {
      settled = true;
      rejectReady(error);
    }
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(error);
    }
    pending.clear();
  }
  child.on('error', () =>
    fail(
      new PlatformError(
        'BI_RUNTIME_UNAVAILABLE',
        '无法启动离线分析引擎，请检查程序旁的 Python 环境包。',
      ),
    ),
  );
  child.on('exit', () =>
    fail(new PlatformError('BI_WORKER_CLOSED', '分析进程已退出，数据文件保留。请重新打开工作区。')),
  );
  // Drain diagnostics without retaining source rows or business data in logs.
  child.stderr.resume();
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    if (buffer.length > 140 * 1024 * 1024) {
      child.kill();
      fail(new PlatformError('BI_RESPONSE_LIMIT', '分析结果过大，请缩小分析范围。'));
      return;
    }
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      let reply;
      try {
        reply = JSON.parse(line);
      } catch {
        child.kill();
        fail(new PlatformError('BI_PROTOCOL_ERROR', '分析引擎返回格式异常。'));
        return;
      }
      if (reply.ready === true) {
        if (!settled) {
          settled = true;
          clearTimeout(startupTimeout);
          resolveReady();
        }
        continue;
      }
      const item = pending.get(reply.id);
      if (!item) continue;
      pending.delete(reply.id);
      clearTimeout(item.timer);
      if (reply.ok) item.resolve(reply.value);
      else
        item.reject(
          new PlatformError(
            'BI_OPERATION_FAILED',
            typeof reply.error === 'string' ? reply.error : 'BI操作未完成。',
          ),
        );
    }
  });
  async function request(message) {
    await ready;
    if (closed) throw new PlatformError('BI_WORKER_CLOSED', '分析进程已关闭。');
    if (pending.size >= 32) throw new PlatformError('BI_BUSY', '待处理操作过多，请稍后再试。');
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(
          new PlatformError('BI_TIMEOUT', 'BI操作尚未完成。请等待当前任务结束，避免重复导入。'),
        );
      }, 180000);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ id, ...message }) + '\n', (error) => {
        if (error) {
          const item = pending.get(id);
          pending.delete(id);
          clearTimeout(timer);
          item?.reject(new PlatformError('BI_WORKER_CLOSED', '分析进程连接已关闭。'));
        }
      });
    });
  }
  return Object.freeze({
    ready,
    request,
    async close() {
      if (closed) return;
      await request({ control: 'close' });
      child.stdin.end();
      await exited;
    },
    abort() {
      if (!closed) {
        child.stdin.destroy();
        child.kill();
      }
      fail(new PlatformError('SESSION_CHANGED', '工作区已锁定。'));
    },
  });
}
module.exports = { startBIWorker };
