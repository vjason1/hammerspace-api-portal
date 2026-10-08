// Persistent portal state: portal user accounts, the cluster registry and the audit log.
// Everything lives in DATA_DIR (mount a volume there). Cluster passwords are encrypted
// with AES-256-GCM; the key comes from PORTAL_SECRET_KEY or a generated key file.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
const F = {
  users: path.join(DATA_DIR, 'users.json'),
  clusters: path.join(DATA_DIR, 'clusters.json'),
  key: path.join(DATA_DIR, 'secret.key'),
  audit: path.join(DATA_DIR, 'audit.log'),
};

// ---------- encryption key
function loadKey() {
  if (process.env.PORTAL_SECRET_KEY) return crypto.createHash('sha256').update(process.env.PORTAL_SECRET_KEY).digest();
  if (!fs.existsSync(F.key)) fs.writeFileSync(F.key, crypto.randomBytes(32).toString('base64'), { mode: 0o600 });
  return Buffer.from(fs.readFileSync(F.key, 'utf8').trim(), 'base64');
}
const KEY = loadKey();
function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([c.update(String(text ?? ''), 'utf8'), c.final()]);
  return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${enc.toString('base64')}`;
}
function decrypt(blob) {
  if (!blob) return '';
  const [, iv, tag, data] = blob.split(':');
  const d = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
}

// ---------- json files (atomic write)
function readJson(file, dflt) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return dflt; } }
function writeJson(file, v) { const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(v, null, 2), { mode: 0o600 }); fs.renameSync(tmp, file); }

// ---------- portal users
function hashPw(pw, salt = crypto.randomBytes(16)) {
  const h = crypto.scryptSync(String(pw), salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt:${salt.toString('base64')}:${h.toString('base64')}`;
}
function checkPw(pw, stored) {
  if (!stored) return false;
  const [, salt, h] = stored.split(':');
  const a = Buffer.from(h, 'base64'), b = crypto.scryptSync(String(pw), Buffer.from(salt, 'base64'), 64, { N: 16384, r: 8, p: 1 });
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const users = {
  list: () => readJson(F.users, []).map(({ hash, ...u }) => u),
  count: () => readJson(F.users, []).length,
  verify(username, pw) {
    const u = readJson(F.users, []).find(x => x.username === username);
    // run a hash even for unknown users to keep timing flat
    const ok = checkPw(pw, u ? u.hash : hashPw('x'));
    return u && ok ? { username: u.username, role: u.role } : null;
  },
  add(username, pw, role = 'admin') {
    if (!/^[A-Za-z0-9._@-]{2,64}$/.test(username || '')) throw new Error('User name: 2–64 letters, digits, . _ @ -');
    if (!pw || String(pw).length < 8) throw new Error('Password must be at least 8 characters');
    const all = readJson(F.users, []);
    if (all.some(x => x.username === username)) throw new Error('That user already exists');
    all.push({ username, role, hash: hashPw(pw), created: Date.now() });
    writeJson(F.users, all);
  },
  setPassword(username, pw) {
    if (!pw || String(pw).length < 8) throw new Error('Password must be at least 8 characters');
    const all = readJson(F.users, []); const u = all.find(x => x.username === username);
    if (!u) throw new Error('No such user');
    u.hash = hashPw(pw); writeJson(F.users, all);
  },
  remove(username) {
    const all = readJson(F.users, []);
    if (all.length <= 1) throw new Error('Can’t remove the last portal user');
    writeJson(F.users, all.filter(x => x.username !== username));
  },
};

// ---------- cluster registry
const PUBLIC_FIELDS = ['id', 'name', 'url', 'username', 'insecureTls', 'tags', 'notes', 'clusterName', 'clusterUuid', 'version', 'lastSeen', 'lastError', 'created'];
const pub = c => Object.fromEntries(PUBLIC_FIELDS.map(k => [k, c[k]]).filter(([, v]) => v !== undefined));
const clusters = {
  list: () => readJson(F.clusters, []).map(pub),
  get: id => readJson(F.clusters, []).find(c => c.id === id) || null,
  credentials: id => { const c = clusters.get(id); return c ? { username: c.username, password: decrypt(c.password) } : null; },
  add(c) {
    const all = readJson(F.clusters, []);
    const rec = { id: crypto.randomBytes(5).toString('hex'), name: c.name, url: c.url, username: c.username, password: encrypt(c.password),
      insecureTls: c.insecureTls !== false, tags: c.tags || [], notes: c.notes || '', created: Date.now() };
    all.push(rec); writeJson(F.clusters, all); return pub(rec);
  },
  update(id, patch) {
    const all = readJson(F.clusters, []); const c = all.find(x => x.id === id);
    if (!c) throw new Error('No such cluster');
    for (const k of ['name', 'url', 'username', 'insecureTls', 'tags', 'notes', 'clusterName', 'clusterUuid', 'version', 'lastSeen', 'lastError']) if (patch[k] !== undefined) c[k] = patch[k];
    if (patch.password) c.password = encrypt(patch.password);
    writeJson(F.clusters, all); return pub(c);
  },
  remove(id) { writeJson(F.clusters, readJson(F.clusters, []).filter(x => x.id !== id)); },
};

// ---------- audit log (JSON lines)
function audit(entry) {
  try { fs.appendFileSync(F.audit, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n', { mode: 0o600 }); } catch {}
}
function auditTail(n = 200) {
  try {
    const lines = fs.readFileSync(F.audit, 'utf8').trim().split('\n');
    return lines.slice(-n).reverse().map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

module.exports = { DATA_DIR, users, clusters, audit, auditTail };
