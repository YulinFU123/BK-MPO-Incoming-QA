'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { PlatformError } = require('../../domain/errors');

const FORMAT = 'exception-analysis-lock';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const busy = (uncertain = false) =>
  new PlatformError(
    'STORAGE_IN_USE',
    uncertain
      ? '此工作区的占用信息不完整，暂未强制打开。请先正常关闭其他程序后重试，原数据和配置已保留。'
      : '此工作区正在另一个程序中使用。请回到已打开的窗口，或正常关闭它后重试；不需要删除数据或重新设置密码。',
  );

function regular(file) {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Not a regular file');
    return stat;
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw new PlatformError('STORAGE_LOCK_FAILED', '无法读取工作区占用信息，原数据已保留。');
  }
}

function dead(pid) {
  try {
    process.kill(pid, 0);
    return false;
  } catch (e) {
    // Permission errors and reused/live PIDs must never authorize takeover.
    return e.code === 'ESRCH';
  }
}

/** OS-owned SQLite lock serializes recovery and releases automatically on crash.
 * The original .lock is retained for interoperability with earlier releases.
 * The sidecar contains no business records, credentials or encryption keys. */
function acquireProcessLock(file) {
  const lockFile = file + '.lock';
  const leaseFile = file + '.lock.sqlite';
  const token = crypto.randomUUID();
  let lease, fd;
  function closeLease() {
    try {
      lease?.exec('ROLLBACK');
    } catch {}
    try {
      lease?.close();
    } catch {}
    lease = null;
  }
  try {
    regular(leaseFile);
    lease = new DatabaseSync(leaseFile, { allowExtension: false });
    lease.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE');
    const stat = regular(lockFile);
    if (stat) {
      let owner;
      try {
        if (stat.size > 2048) throw new Error('Oversized lock');
        owner = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
      } catch {
        throw busy(true);
      }
      if (
        !owner ||
        owner.format !== FORMAT ||
        !Number.isInteger(owner.pid) ||
        owner.pid < 1 ||
        owner.pid > 2147483647 ||
        !UUID.test(owner.token || '')
      )
        throw busy(true);
      if (!dead(owner.pid)) throw busy();
      // Every new opener holds the OS lease. Earlier versions cannot recover
      // stale locks; if one wins the following wx race we leave its lock alone.
      fs.unlinkSync(lockFile);
    }
    fd = fs.openSync(lockFile, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify({ format: FORMAT, pid: process.pid, token }), 'utf8');
    fs.fsyncSync(fd);
  } catch (e) {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {}
      try {
        fs.unlinkSync(lockFile);
      } catch {}
    }
    closeLease();
    if (e instanceof PlatformError) throw e;
    if (e.code === 'EEXIST' || e.errcode === 5 || e.errcode === 6) throw busy();
    throw new PlatformError(
      'STORAGE_LOCK_FAILED',
      '无法取得工作区写入权限。请检查目录权限后重试，原数据已保留。',
    );
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    try {
      fs.closeSync(fd);
    } catch {}
    try {
      if (JSON.parse(fs.readFileSync(lockFile, 'utf8')).token === token) fs.unlinkSync(lockFile);
    } catch {
      /* Preserve unrecognized/replacement lock metadata. */
    }
    closeLease();
  };
}

module.exports = { acquireProcessLock };
