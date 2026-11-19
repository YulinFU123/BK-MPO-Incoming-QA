'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);
const FORMAT = 'quality-desk-encrypted-vault';
const AAD = Buffer.from('QualityDesk/vault/v1');
const OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };
function validState(data) {
  return !!(data && data.version === 1 && Array.isArray(data.templates) && data.templates.length && Array.isArray(data.records)
    && data.templates.every(t => t && typeof t.id === 'string' && typeof t.name === 'string' && Array.isArray(t.columns) && t.columns.length
      && t.columns.every(c => c && typeof c.id === 'string' && typeof c.label === 'string' && ['text','date','number','choice','multiline'].includes(c.type)))
    && data.records.every(r => r && typeof r.id === 'string' && typeof r.templateId === 'string' && typeof r.createdAt === 'string' && r.values && typeof r.values === 'object' && !Array.isArray(r.values)));
}
function envelope(raw) {
  if (typeof raw !== 'string' || raw.length > 150 * 1024 * 1024) throw Error('备份文件过大或格式不正确。');
  const value = JSON.parse(raw);
  if (value.format !== FORMAT || value.version !== 1 || value.kdf !== 'scrypt-32768-8-1' || value.cipher !== 'aes-256-gcm') throw Error('不是本软件的加密备份文件。');
  for (const [name, size] of [['salt',16],['iv',12],['tag',16]]) {
    if (typeof value[name] !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value[name]) || Buffer.from(value[name], 'base64').length !== size) throw Error('加密文件已损坏。');
  }
  if (typeof value.data !== 'string' || !value.data.length) throw Error('加密文件没有数据。');
  return value;
}
async function derive(password, salt) {
  if (typeof password !== 'string' || password.length > 1024) throw Error('密码格式不正确。');
  return scrypt(password, salt, 32, OPTIONS);
}
function seal(data, key, salt) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(AAD);
  const bytes = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  return { format: FORMAT, version: 1, kdf: 'scrypt-32768-8-1', cipher: 'aes-256-gcm', salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: bytes.toString('base64') };
}
async function open(raw, password) {
  const item = envelope(raw);
  const salt = Buffer.from(item.salt, 'base64');
  const key = await derive(password, salt);
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(item.iv, 'base64'));
    decipher.setAAD(AAD); decipher.setAuthTag(Buffer.from(item.tag, 'base64'));
    const data = JSON.parse(Buffer.concat([decipher.update(Buffer.from(item.data, 'base64')), decipher.final()]).toString('utf8'));
    if (!validState(data)) throw Error('数据结构不正确。');
    return { data, key, salt };
  } catch (e) { key.fill(0); throw Error('密码不正确，或加密文件已损坏。'); }
}
class Vault {
  constructor(file) { this.file = file; this.key = null; this.salt = null; this.data = null; }
  exists() { return fs.existsSync(this.file); }
  write(raw) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    const fd = fs.openSync(tmp, 'w', 0o600);
    try { fs.writeFileSync(fd, raw, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, this.file);
  }
  async setup(password, data) {
    if (this.exists()) throw Error('已设置密码，请直接解锁。');
    if (typeof password !== 'string' || password.length < 10) throw Error('密码至少需要 10 个字符。');
    if (!validState(data)) throw Error('数据格式不正确。');
    const salt = crypto.randomBytes(16), key = await derive(password, salt);
    try { this.write(JSON.stringify(seal(data, key, salt))); } catch (e) { key.fill(0); throw e; }
    this.key = key; this.salt = salt; this.data = data; return data;
  }
  async unlock(password) {
    const result = await open(fs.readFileSync(this.file, 'utf8'), password);
    this.lock(); this.key = result.key; this.salt = result.salt; this.data = result.data; return this.data;
  }
  save(data) {
    if (!this.key) throw Error('已锁定，请先解锁。');
    if (!validState(data)) throw Error('数据格式不正确。');
    this.write(JSON.stringify(seal(data, this.key, this.salt))); this.data = data;
  }
  backup(data = this.data) {
    if (!this.key) throw Error('请先解锁。');
    if (!validState(data)) throw Error('数据格式不正确。');
    return JSON.stringify(seal(data, this.key, this.salt));
  }
  async changePassword(current, next) {
    if (!this.key) throw Error('请先解锁。');
    if (typeof next !== 'string' || next.length < 10) throw Error('新密码至少需要 10 个字符。');
    const checked = await open(fs.readFileSync(this.file, 'utf8'), current); checked.key.fill(0);
    const salt = crypto.randomBytes(16), key = await derive(next, salt);
    try { this.write(JSON.stringify(seal(this.data, key, salt))); } catch (e) { key.fill(0); throw e; }
    this.key.fill(0); this.key = key; this.salt = salt;
  }
  async restore(raw, password) {
    const result = await open(raw, password);
    try { this.write(raw); } catch (e) { result.key.fill(0); throw e; }
    this.lock(); this.key = result.key; this.salt = result.salt; this.data = result.data; return this.data;
  }
  lock() { if (this.key) this.key.fill(0); this.key = null; this.salt = null; this.data = null; }
}
module.exports = { Vault, open, validState };
