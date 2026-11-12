import { DatabaseSync } from 'node:sqlite';
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const keyString = process.env.DATA_ENCRYPTION_KEY || '';
const dataKey = Buffer.from(keyString, 'base64');
if (dataKey.length !== 32) throw new Error('DATA_ENCRYPTION_KEY must be a base64 encoded 32-byte key. Run npm run setup.');
const sessionSecret = process.env.SESSION_SECRET || '';
if (Buffer.byteLength(sessionSecret) < 32) throw new Error('SESSION_SECRET must contain at least 32 characters. Run npm run setup.');

const dbPath = resolve(process.env.DB_PATH || 'data/stillwell.sqlite');
mkdirSync(dirname(dbPath), { recursive: true });
export const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = DELETE; PRAGMA secure_delete = ON; PRAGMA busy_timeout = 5000;');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email_lookup TEXT NOT NULL UNIQUE,
    email_cipher TEXT NOT NULL,
    email_iv TEXT NOT NULL,
    email_tag TEXT NOT NULL,
    name_cipher TEXT NOT NULL,
    name_iv TEXT NOT NULL,
    name_tag TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    memory_consent_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
  CREATE TABLE IF NOT EXISTS interactions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('user','assistant')),
    content_cipher TEXT NOT NULL,
    content_iv TEXT NOT NULL,
    content_tag TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS interactions_owner_time ON interactions(user_id, created_at);
`);

export function encrypt(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', dataKey, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return { cipher: ciphertext.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}

export function decrypt(ciphertext, iv, tag) {
  const decipher = createDecipheriv('aes-256-gcm', dataKey, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8');
}

export function keyedHash(value) {
  return createHmac('sha256', sessionSecret).update(value).digest('hex');
}

export function safeEqualHex(left, right) {
  const a = Buffer.from(left, 'hex'); const b = Buffer.from(right, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function storeInteraction(userId, role, content) {
  const encrypted = encrypt(content);
  const id = randomBytes(16).toString('hex');
  const createdAt = new Date().toISOString();
  db.prepare('INSERT INTO interactions(id,user_id,role,content_cipher,content_iv,content_tag,created_at) VALUES(?,?,?,?,?,?,?)')
    .run(id, userId, role, encrypted.cipher, encrypted.iv, encrypted.tag, createdAt);
  return { id, role, content, createdAt };
}

export function listInteractions(userId, limit = 100) {
  return db.prepare('SELECT id,role,content_cipher,content_iv,content_tag,created_at FROM interactions WHERE user_id=? ORDER BY created_at DESC, rowid DESC LIMIT ?')
    .all(userId, limit).reverse().map((row) => ({
      id: row.id, role: row.role, content: decrypt(row.content_cipher, row.content_iv, row.content_tag), createdAt: row.created_at,
    }));
}
