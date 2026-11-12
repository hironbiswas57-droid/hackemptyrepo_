import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { db, decrypt, encrypt, keyedHash, listInteractions, safeEqualHex, storeInteraction } from './db.js';

const app = express();
const scrypt = promisify(scryptCallback);
const isProduction = process.env.NODE_ENV === 'production';
app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY || false);
app.use(helmet({
  contentSecurityPolicy: { directives: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'], imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"],
    objectSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'self'"], formAction: ["'self'"],
  } },
  hsts: isProduction ? { maxAge: 31536000 } : false,
}));
app.use(express.json({ limit: '96kb', strict: true }));
app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.use('/api', rateLimit({ windowMs: 60_000, limit: 45, standardHeaders: 'draft-7', legacyHeaders: false }));
const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 8, standardHeaders: 'draft-7', legacyHeaders: false });

function originAllowed(req) {
  const origin = req.get('origin');
  if (!origin) return false;
  const configured = process.env.CLIENT_ORIGIN;
  if (configured) return origin === configured;
  if (isProduction) return false;
  try {
    const url = new URL(origin);
    return url.protocol === 'http:' && url.port === '5173' &&
      (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname) ||
       /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname));
  } catch { return false; }
}

function sameOrigin(req, res, next) {
  if (!originAllowed(req)) return res.status(403).json({ error: 'Request origin was not allowed.' });
  if (isProduction && !req.secure) return res.status(426).json({ error: 'Secure HTTPS is required.' });
  next();
}

function cookieOptions(maxAge) {
  return { httpOnly: true, secure: isProduction, sameSite: 'strict', path: '/', maxAge };
}

function sessionToken(req) {
  const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map((part) => {
    const index = part.indexOf('=');
    return index < 0 ? ['', ''] : [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }));
  return cookies.stillwell_session || '';
}

function requireUser(req, res, next) {
  const token = sessionToken(req);
  if (!token) return res.status(401).json({ error: 'Sign in to use saved memory.' });
  const session = db.prepare('SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?').get(keyedHash(token), Date.now());
  if (!session) return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
  req.userId = session.user_id;
  next();
}

function privateUser(id) {
  const row = db.prepare('SELECT id,email_cipher,email_iv,email_tag,name_cipher,name_iv,name_tag,memory_consent_at FROM users WHERE id=?').get(id);
  if (!row) return null;
  return {
    id: row.id,
    email: decrypt(row.email_cipher, row.email_iv, row.email_tag),
    name: decrypt(row.name_cipher, row.name_iv, row.name_tag),
    memoryEnabled: Boolean(row.memory_consent_at),
  };
}

function createSession(userId, res) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + 12 * 60 * 60 * 1000;
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)')
    .run(keyedHash(token), userId, expiresAt, new Date().toISOString());
  res.cookie('stillwell_session', token, cookieOptions(12 * 60 * 60 * 1000));
}

async function passwordHash(password, salt) {
  return Buffer.from(await scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })).toString('hex');
}

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.post('/api/auth/register', authLimiter, sameOrigin, async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = req.body?.password;
  const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 80) : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) return res.status(400).json({ error: 'Use a password between 12 and 128 characters.' });
  if (req.body?.memoryConsent !== true) return res.status(400).json({ error: 'You must opt in to encrypted conversation memory to create a saved account.' });
  const emailLookup = keyedHash(`email:${email}`);
  if (db.prepare('SELECT 1 FROM users WHERE email_lookup=?').get(emailLookup)) return res.status(409).json({ error: 'An account with that email already exists.' });
  const salt = randomBytes(16);
  const hash = await passwordHash(password, salt);
  const encryptedEmail = encrypt(email);
  const encryptedName = encrypt(name);
  const id = randomBytes(16).toString('hex');
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO users(id,email_lookup,email_cipher,email_iv,email_tag,name_cipher,name_iv,name_tag,password_salt,password_hash,memory_consent_at,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, emailLookup, encryptedEmail.cipher, encryptedEmail.iv, encryptedEmail.tag,
    encryptedName.cipher, encryptedName.iv, encryptedName.tag, salt.toString('hex'), hash, now, now);
  createSession(id, res);
  return res.status(201).json({ user: privateUser(id) });
});

app.post('/api/auth/login', authLimiter, sameOrigin, async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = req.body?.password;
  if (typeof password !== 'string' || !email) return res.status(400).json({ error: 'Enter your email and password.' });
  const user = db.prepare('SELECT id,password_salt,password_hash,memory_consent_at FROM users WHERE email_lookup=?').get(keyedHash(`email:${email}`));
  if (!user) { await passwordHash(password, Buffer.alloc(16)); return res.status(401).json({ error: 'Email or password was not recognized.' }); }
  const candidate = await passwordHash(password, Buffer.from(user.password_salt, 'hex'));
  if (!safeEqualHex(candidate, user.password_hash)) return res.status(401).json({ error: 'Email or password was not recognized.' });
  if (!user.memory_consent_at) return res.status(403).json({ error: 'Saved memory is disabled for this account. Contact support to restore access.' });
  createSession(user.id, res);
  return res.json({ user: privateUser(user.id) });
});

app.post('/api/auth/logout', sameOrigin, (req, res) => {
  const token = sessionToken(req);
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(keyedHash(token));
  res.clearCookie('stillwell_session', cookieOptions(0));
  return res.json({ ok: true });
});

app.get('/api/auth/me', requireUser, (req, res) => {
  const user = privateUser(req.userId);
  if (!user) return res.status(401).json({ error: 'Account was not found.' });
  return res.json({ user });
});

app.get('/api/memory', requireUser, (req, res) => {
  const user = db.prepare('SELECT memory_consent_at FROM users WHERE id=?').get(req.userId);
  if (!user?.memory_consent_at) return res.status(403).json({ error: 'Conversation memory is turned off.' });
  return res.json({ interactions: listInteractions(req.userId, 200) });
});

app.delete('/api/memory', sameOrigin, requireUser, (req, res) => {
  db.prepare('DELETE FROM interactions WHERE user_id=?').run(req.userId);
  return res.json({ ok: true });
});

app.patch('/api/memory/consent', sameOrigin, requireUser, (req, res) => {
  if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ error: 'Choose whether saved memory is enabled.' });
  db.prepare('UPDATE users SET memory_consent_at=? WHERE id=?').run(req.body.enabled ? new Date().toISOString() : null, req.userId);
  return res.json({ memoryEnabled: req.body.enabled });
});

app.delete('/api/account', sameOrigin, requireUser, (req, res) => {
  db.prepare('DELETE FROM users WHERE id=?').run(req.userId);
  res.clearCookie('stillwell_session', cookieOptions(0));
  return res.json({ ok: true });
});

const chatLimit = rateLimit({ windowMs: 60_000, limit: 12, standardHeaders: 'draft-7', legacyHeaders: false });
app.post('/api/chat', chatLimit, sameOrigin, async (req, res) => {
  const token = sessionToken(req);
  const session = token ? db.prepare('SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?').get(keyedHash(token), Date.now()) : null;
  const consent = session?.user_id ? db.prepare('SELECT memory_consent_at FROM users WHERE id=?').get(session.user_id) : null;
  const userId = consent?.memory_consent_at ? session.user_id : null;
  const message = req.body?.message;
  const guestMessages = req.body?.messages;
  if (userId) {
    if (typeof message !== 'string' || !message.trim() || message.length > 4000) return res.status(400).json({ error: 'Write a message up to 4,000 characters.' });
    const user = db.prepare('SELECT memory_consent_at FROM users WHERE id=?').get(userId);
    if (!user?.memory_consent_at) return res.status(403).json({ error: 'Enable conversation memory in your account to continue.' });
  } else if (!Array.isArray(guestMessages) || guestMessages.length < 1 || guestMessages.length > 20 || guestMessages.some((m) => !['user', 'assistant'].includes(m?.role) || typeof m?.content !== 'string' || m.content.length > 4000)) {
    return res.status(400).json({ error: 'Sign in to save memory, or send a valid guest conversation.' });
  }
  if (!process.env.HF_TOKEN || process.env.HF_TOKEN === 'add your api key here') return res.status(503).json({ error: 'Add a Hugging Face access token to the root .env file to enable AI replies.' });

  let chatMessages;
  if (userId) {
    storeInteraction(userId, 'user', message.trim());
    chatMessages = listInteractions(userId, 16).map(({ role, content }) => ({ role, content }));
  } else chatMessages = guestMessages;
  const system = { role: 'system', content: 'You are Stillwell, a supportive AI wellbeing companion. Be warm, respectful, nonjudgmental, concise, and clear that you are not a licensed clinician. Do not claim professional credentials, diagnose, prescribe, or recommend changing medication. Offer general information and encourage qualified professional support for persistent or severe symptoms. If someone may be in immediate danger or at risk of harming themselves or another person, encourage contacting local emergency services or a crisis line now and reaching a trusted person nearby. Do not present yourself as emergency care.' };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const upstream = await fetch('https://router.huggingface.co/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.HF_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.HF_MODEL || 'openai/gpt-oss-20b:fastest', messages: [system, ...chatMessages], max_tokens: 350, temperature: 0.6 }),
      signal: controller.signal,
    });
    if (!upstream.ok) return res.status(502).json({ error: 'The AI service could not answer just now. Please try again.' });
    const data = await upstream.json();
    const reply = data?.choices?.[0]?.message?.content;
    if (typeof reply !== 'string' || !reply.trim()) return res.status(502).json({ error: 'The AI service returned an empty response. Please try again.' });
    const cleanReply = reply.trim();
    if (userId) storeInteraction(userId, 'assistant', cleanReply);
    return res.json({ reply: cleanReply });
  } catch {
    return res.status(502).json({ error: 'Could not reach the AI service. Check your connection and try again.' });
  } finally { clearTimeout(timeout); }
});

db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now());
if (isProduction) {
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API route was not found.' }));
  const dist = resolve('dist');
  app.use(express.static(dist, { dotfiles: 'deny', index: false, maxAge: '1y', immutable: true }));
  app.get('*', (_req, res) => { res.set('Cache-Control', 'no-cache'); res.sendFile(resolve(dist, 'index.html')); });
}
const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || '127.0.0.1';
app.listen(port, host, () => console.log(`Stillwell API listening on ${host}:${port}`));
