import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const envPath = resolve('.env');
const current = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '# Server-only secrets. Keep this file out of Git.\n';
const entries = new Map();
for (const line of current.split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) entries.set(match[1], match[2]);
}
if (!entries.get('SESSION_SECRET') || entries.get('SESSION_SECRET') === 'replace-me') entries.set('SESSION_SECRET', randomBytes(48).toString('base64url'));
const dataKey = Buffer.from(entries.get('DATA_ENCRYPTION_KEY') || '', 'base64');
if (dataKey.length !== 32) entries.set('DATA_ENCRYPTION_KEY', randomBytes(32).toString('base64'));
if (!entries.has('PORT')) entries.set('PORT', '3001');
if (!entries.has('HOST')) entries.set('HOST', '127.0.0.1');
if (!entries.has('HF_TOKEN')) entries.set('HF_TOKEN', 'add your api key here');
if (!entries.has('HF_MODEL')) entries.set('HF_MODEL', 'openai/gpt-oss-20b:fastest');
writeFileSync(envPath, `# Server-only secrets and provider settings. Never commit this file.\n${[...entries].map(([key, value]) => `${key}=${value}`).join('\n')}\n`, { mode: 0o600 });
console.log('Local session and data-encryption secrets are ready in the ignored .env file. Back them up securely; losing the data key makes encrypted records unreadable.');
