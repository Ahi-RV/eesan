const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

class SessionStore {
  constructor(encryptionKey, file = path.join(process.cwd(), 'data', 'sessions.json')) {
    this.file = file;
    this.key = Buffer.from(encryptionKey || '', 'base64');
    if (this.key.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!fs.existsSync(file)) fs.writeFileSync(file, '{}', { mode: 0o600 });
  }
  read() { return JSON.parse(fs.readFileSync(this.file, 'utf8')); }
  write(data) { fs.writeFileSync(this.file, JSON.stringify(data, null, 2), { mode: 0o600 }); }
  seal(value) {
    const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64')).join('.');
  }
  open(value) {
    const [iv, tag, encrypted] = value.split('.').map((part) => Buffer.from(part, 'base64'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, iv); decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8'));
  }
  get(id) { const record = this.read()[id]; return record ? this.open(record) : null; }
  set(id, value) { const all = this.read(); all[id] = this.seal(value); this.write(all); }
  delete(id) { const all = this.read(); delete all[id]; this.write(all); }
}
module.exports = { SessionStore };

