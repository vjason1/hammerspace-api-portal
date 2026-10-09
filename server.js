// Hammerspace API Portal — zero-dependency Node server.
// - Portal accounts (master login) and a persistent registry of clusters (store.js)
// - Proxies /c/<clusterId>/hs/* to <cluster><basePath>/*, logging in to each cluster
//   server-side with its stored credentials and re-authenticating when the session expires
// - Builds/uploads extraction bundles (upload.js); audit log of every change
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const Upload = require('./upload');
const Store = require('./store');

const PORT = parseInt(process.env.PORT || '8080', 10);
const DEFAULT_TARGET = (process.env.HS_URL || '').replace(/\/+$/, '');
const ALLOWED_HOSTS = (process.env.HS_ALLOWED_HOSTS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const SESSION_TTL_MS = parseInt(process.env.SESSION_TTL_MIN || '480', 10) * 60 * 1000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const SPEC_PATH = process.env.SPEC_PATH || path.join(PUBLIC_DIR, 'swagger.json');
const spec = JSON.parse(fs.readFileSync(SPEC_PATH, 'utf8'));
const BASE_PATH = (spec.basePath || '/mgmt/v1.2/rest').replace(/\/+$/, '');

// Bootstrap a first admin from env if no users exist yet (optional; otherwise the UI asks)
if (!Store.users.count() && process.env.PORTAL_ADMIN_USER && process.env.PORTAL_ADMIN_PASSWORD) {
  Store.users.add(process.env.PORTAL_ADMIN_USER, process.env.PORTAL_ADMIN_PASSWORD, 'admin');
  console.log(`Created portal admin "${process.env.PORTAL_ADMIN_USER}" from environment`);
}

// ---------------------------------------------------------------- portal sessions
const sessions = new Map(); // sid -> { username, role, touched }
function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
function getSession(req) {
  const sid = parseCookies(req.headers.cookie).hsportal_sid;
  const s = sid && sessions.get(sid);
  if (!s) return null;
  if (Date.now() - s.touched > SESSION_TTL_MS) { sessions.delete(sid); return null; }
  s.touched = Date.now(); return s;
}
function startSession(res, user) {
  const sid = crypto.randomBytes(24).toString('hex');
  sessions.set(sid, { ...user, touched: Date.now() });
  res.setHeader('Set-Cookie', `hsportal_sid=${sid}; HttpOnly; SameSite=Strict; Path=/`);
}
setInterval(() => { const now = Date.now(); for (const [k, s] of sessions) if (now - s.touched > SESSION_TTL_MS) sessions.delete(k); }, 60000).unref();

// simple login throttling per IP
const failures = new Map();
const throttled = ip => { const f = failures.get(ip); return f && f.n >= 5 && Date.now() - f.t < 5 * 60000; };
const fail = ip => { const f = failures.get(ip) || { n: 0, t: 0 }; failures.set(ip, { n: Date.now() - f.t > 5 * 60000 ? 1 : f.n + 1, t: Date.now() }); };

// ---------------------------------------------------------------- cluster connections
const conns = new Map(); // clusterId -> { cookies: Map, loginPromise }
function conn(id) { if (!conns.has(id)) conns.set(id, { cookies: new Map(), loginPromise: null }); return conns.get(id); }
function storeSetCookies(c, setCookie) {
  (Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : []).forEach(sc => {
    const first = sc.split(';')[0]; const i = first.indexOf('=');
    if (i > 0) c.cookies.set(first.slice(0, i).trim(), first.slice(i + 1).trim());
  });
}
function validateTarget(raw) {
  let u; try { u = new URL(raw); } catch { throw Object.assign(new Error('Invalid cluster URL'), { status: 400 }); }
  if (!/^https?:$/.test(u.protocol)) throw Object.assign(new Error('Cluster URL must start with https:// or http://'), { status: 400 });
  if (ALLOWED_HOSTS.length && !ALLOWED_HOSTS.includes(u.hostname.toLowerCase())) throw Object.assign(new Error(`Host ${u.hostname} is not in HS_ALLOWED_HOSTS`), { status: 400 });
  return `${u.protocol}//${u.host}`;
}

function rawRequest(cluster, c, method, pathAndQuery, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(cluster.url + pathAndQuery);
    const lib = u.protocol === 'https:' ? https : http;
    const h = { Accept: '*/*', ...headers };
    const ck = [...c.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    if (ck) h.Cookie = ck;
    if (body && body.length) h['Content-Length'] = body.length;
    const r = lib.request(u, { method, headers: h, rejectUnauthorized: cluster.insecureTls === false, timeout: 300000 }, resp => {
      storeSetCookies(c, resp.headers['set-cookie']); resolve(resp);
    });
    r.on('timeout', () => r.destroy(new Error('Cluster did not respond (timeout)')));
    r.on('error', reject);
    if (body && body.length) r.write(body);
    r.end();
  });
}
const drain = resp => new Promise((res, rej) => { const ch = []; resp.on('data', d => ch.push(d)); resp.on('end', () => res(Buffer.concat(ch))); resp.on('error', rej); });

async function login(cluster, creds = Store.clusters.credentials(cluster.id)) {
  const c = conn(cluster.id);
  c.cookies.clear();
  const form = Buffer.from(new URLSearchParams({ username: creds.username, password: creds.password || '' }).toString());
  const resp = await rawRequest(cluster, c, 'POST', `${BASE_PATH}/login`, { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, form);
  const text = (await drain(resp)).toString();
  if (resp.statusCode >= 400) {
    let msg = text.slice(0, 300);
    try { const j = JSON.parse(text); msg = j.errors?.[0]?.message || j.message || msg; } catch {}
    throw Object.assign(new Error(`Login to cluster failed (HTTP ${resp.statusCode})${msg ? ': ' + msg : ''}`), { status: 502 });
  }
}
async function ensureLogin(cluster) {
  const c = conn(cluster.id);
  if (c.cookies.size) return;
  if (!c.loginPromise) c.loginPromise = login(cluster).finally(() => { c.loginPromise = null; });
  await c.loginPromise;
}
// Send a request to a registered cluster; re-login once on 401
async function clusterRequest(cluster, method, pathAndQuery, headers, body) {
  await ensureLogin(cluster);
  let resp = await rawRequest(cluster, conn(cluster.id), method, pathAndQuery, headers, body);
  if (resp.statusCode === 401) {
    await drain(resp);
    conn(cluster.id).cookies.clear();
    await ensureLogin(cluster);
    resp = await rawRequest(cluster, conn(cluster.id), method, pathAndQuery, headers, body);
  }
  return resp;
}
async function clusterJson(cluster, p) {
  const r = await clusterRequest(cluster, 'GET', BASE_PATH + p, { Accept: 'application/json' });
  const t = (await drain(r)).toString();
  if (r.statusCode >= 400) throw new Error(`HTTP ${r.statusCode} on ${p}`);
  return t ? JSON.parse(t) : null;
}

// Connectivity + identity check used by "Test" and the Clusters dashboard
async function probe(cluster) {
  const started = Date.now();
  const [cntl, health, nodes] = await Promise.all([
    clusterJson(cluster, '/cntl'), clusterJson(cluster, '/system/health').catch(() => null), clusterJson(cluster, '/nodes').catch(() => []),
  ]);
  const cl = (Array.isArray(cntl) ? cntl[0] : cntl) || {};
  const anvil = (nodes || []).find(n => n.productNodeType === 'ANVIL') || (nodes || [])[0] || {};
  return {
    ok: true, ms: Date.now() - started, clusterName: cl.name, clusterUuid: cl.uoid?.uuid, version: anvil.swVersion?.fullVersion,
    state: health?.clusterState || cl.state, capacity: cl.capacity || null, nodes: (nodes || []).length, health,
  };
}

// ---------------------------------------------------------------- helpers
function readBody(req, limit = 512 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('Request too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks))); req.on('error', reject);
  });
}
const readJsonBody = async (req, limit) => { const b = (await readBody(req, limit)).toString(); return b ? JSON.parse(b) : {}; };
function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
function serveStatic(req, res, pathname) {
  if (pathname === '/') pathname = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' }); res.end(data);
  });
}
const clientIp = req => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;

// ---------------------------------------------------------------- routes
async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');

  if (p === '/healthz') return sendJson(res, 200, { ok: true });

  if (p === '/portal/config' && req.method === 'GET') {
    const s = getSession(req);
    return sendJson(res, 200, {
      needsSetup: Store.users.count() === 0, user: s ? { username: s.username, role: s.role } : null,
      defaultTarget: DEFAULT_TARGET, basePath: BASE_PATH, upload: { enabled: Upload.UPLOAD_ENABLED, url: Upload.UPLOAD_URL },
    });
  }

  // first-run: create the first portal admin
  if (p === '/portal/setup' && req.method === 'POST') {
    if (Store.users.count() > 0) return sendJson(res, 409, { error: 'Setup already completed' });
    try {
      const { username, password } = await readJsonBody(req, 64 * 1024);
      Store.users.add(username, password, 'admin');
      Store.audit({ user: username, action: 'portal.setup' });
      startSession(res, { username, role: 'admin' });
      return sendJson(res, 200, { ok: true, user: { username, role: 'admin' } });
    } catch (e) { return sendJson(res, 400, { error: e.message }); }
  }

  if (p === '/portal/login' && req.method === 'POST') {
    const ip = clientIp(req);
    if (throttled(ip)) return sendJson(res, 429, { error: 'Too many failed sign-ins. Try again in a few minutes.' });
    try {
      const { username, password } = await readJsonBody(req, 64 * 1024);
      const u = Store.users.verify(username, password);
      if (!u) { fail(ip); Store.audit({ user: username, action: 'portal.login.failed', ip }); return sendJson(res, 401, { error: 'Wrong user name or password' }); }
      failures.delete(ip);
      startSession(res, u);
      Store.audit({ user: u.username, action: 'portal.login', ip });
      return sendJson(res, 200, { ok: true, user: u });
    } catch (e) { return sendJson(res, 400, { error: e.message }); }
  }

  if (p === '/portal/logout' && req.method === 'POST') {
    const sid = parseCookies(req.headers.cookie).hsportal_sid;
    if (sid) sessions.delete(sid);
    res.setHeader('Set-Cookie', 'hsportal_sid=; Max-Age=0; Path=/');
    return sendJson(res, 200, { ok: true });
  }

  // ----- everything below needs a portal session
  if (p.startsWith('/portal/') || p.startsWith('/c/')) {
    const session = getSession(req);
    if (!session) return sendJson(res, 401, { error: 'Not signed in to the portal', code: 'PORTAL_AUTH' });
    if (req.method !== 'GET' && req.headers['x-portal'] !== '1') return sendJson(res, 403, { error: 'Missing X-Portal header' });
    try { return await authed(req, res, url, p, session); }
    catch (e) { return sendJson(res, e.status || 500, { error: e.message }); }
  }

  if (req.method === 'GET') return serveStatic(req, res, p);
  res.writeHead(405); res.end();
}

async function authed(req, res, url, p, session) {
  const who = session.username;
  let m;

  // ----- portal users
  if (p === '/portal/users' && req.method === 'GET') return sendJson(res, 200, Store.users.list());
  if (p === '/portal/users' && req.method === 'POST') {
    const { username, password } = await readJsonBody(req, 64 * 1024);
    try { Store.users.add(username, password); } catch (e) { e.status = 400; throw e; }
    Store.audit({ user: who, action: 'portal.user.add', target: username });
    return sendJson(res, 200, { ok: true });
  }
  if ((m = p.match(/^\/portal\/users\/([^/]+)\/password$/)) && req.method === 'PUT') {
    const name = decodeURIComponent(m[1]); const { password } = await readJsonBody(req, 64 * 1024);
    try { Store.users.setPassword(name, password); } catch (e) { e.status = 400; throw e; }
    Store.audit({ user: who, action: 'portal.user.password', target: name });
    return sendJson(res, 200, { ok: true });
  }
  if ((m = p.match(/^\/portal\/users\/([^/]+)$/)) && req.method === 'DELETE') {
    const name = decodeURIComponent(m[1]);
    if (name === who) return sendJson(res, 400, { error: 'You can’t remove your own account while signed in' });
    try { Store.users.remove(name); } catch (e) { e.status = 400; throw e; }
    Store.audit({ user: who, action: 'portal.user.remove', target: name });
    return sendJson(res, 200, { ok: true });
  }

  // ----- cluster registry
  if (p === '/portal/clusters' && req.method === 'GET') return sendJson(res, 200, Store.clusters.list());
  if (p === '/portal/clusters' && req.method === 'POST') {
    const b = await readJsonBody(req, 64 * 1024);
    const rec = { name: (b.name || '').trim(), url: validateTarget(b.url), username: (b.username || '').trim(), password: b.password || '',
      insecureTls: b.insecureTls !== false, tags: (b.tags || []).map(String).map(s => s.trim()).filter(Boolean), notes: b.notes || '', apiProfile: /^\d+\.\d+$/.test(b.apiProfile || '') ? b.apiProfile : '' };
    if (!rec.username) throw Object.assign(new Error('Cluster user name is required'), { status: 400 });
    if (Store.clusters.list().some(c => c.url === rec.url && c.username === rec.username)) throw Object.assign(new Error('That cluster is already registered'), { status: 409 });
    let info = null;
    if (!b.skipTest) {
      const tmp = { id: 'test-' + crypto.randomBytes(4).toString('hex'), ...rec };
      try { await login(tmp, rec); info = await probe(tmp); }
      catch (e) { throw Object.assign(new Error(`${e.message}. Check the URL and credentials, or save without testing.`), { status: 400 }); }
      finally { conns.delete(tmp.id); }
    }
    const saved = Store.clusters.add({ ...rec, name: rec.name || info?.clusterName || new URL(rec.url).hostname });
    if (info) Store.clusters.update(saved.id, { clusterName: info.clusterName, clusterUuid: info.clusterUuid, version: info.version, lastSeen: Date.now(), lastError: null });
    Store.audit({ user: who, action: 'cluster.add', cluster: saved.id, name: saved.name, url: rec.url });
    return sendJson(res, 200, { ...Store.clusters.list().find(c => c.id === saved.id), probe: info });
  }
  if ((m = p.match(/^\/portal\/clusters\/([a-z0-9]+)(\/test)?$/))) {
    const id = m[1];
    const cl = Store.clusters.get(id);
    if (!cl) return sendJson(res, 404, { error: 'No such cluster' });
    if (m[2] && req.method === 'POST') {
      try {
        const info = await probe(cl);
        Store.clusters.update(id, { clusterName: info.clusterName, clusterUuid: info.clusterUuid, version: info.version, lastSeen: Date.now(), lastError: null });
        return sendJson(res, 200, info);
      } catch (e) {
        conn(id).cookies.clear();
        Store.clusters.update(id, { lastError: e.message });
        return sendJson(res, 200, { ok: false, error: e.message });
      }
    }
    if (req.method === 'PUT') {
      const b = await readJsonBody(req, 64 * 1024);
      const patch = { name: b.name, username: b.username, password: b.password || undefined, insecureTls: b.insecureTls, tags: b.tags, notes: b.notes, apiProfile: b.apiProfile === undefined ? undefined : (/^\d+\.\d+$/.test(b.apiProfile || '') ? b.apiProfile : '') };
      if (b.url) patch.url = validateTarget(b.url);
      const updated = Store.clusters.update(id, patch);
      conns.delete(id); // force re-login with new settings
      Store.audit({ user: who, action: 'cluster.update', cluster: id, name: updated.name, fields: Object.keys(b).filter(k => k !== 'password' || b.password) });
      return sendJson(res, 200, updated);
    }
    if (req.method === 'DELETE') {
      Store.clusters.remove(id); conns.delete(id);
      Store.audit({ user: who, action: 'cluster.remove', cluster: id, name: cl.name });
      return sendJson(res, 200, { ok: true });
    }
  }

  if (p === '/portal/audit' && req.method === 'GET') return sendJson(res, 200, Store.auditTail(parseInt(url.searchParams.get('n') || '300', 10)));

  // ----- proxy to a registered cluster: /c/<id>/hs/<api path>
  if ((m = p.match(/^\/c\/([a-z0-9]+)\/hs(\/.*)$/))) {
    const cl = Store.clusters.get(m[1]);
    if (!cl) return sendJson(res, 404, { error: 'Unknown cluster — it may have been removed' });
    const sub = m[2];
    const body = ['GET', 'HEAD'].includes(req.method) ? null : await readBody(req);
    const fwd = {};
    if (req.headers['content-type']) fwd['Content-Type'] = req.headers['content-type'];
    if (req.headers.accept) fwd.Accept = req.headers.accept;
    const batch = req.headers['x-batch'] || undefined;
    const started = Date.now();
    let up;
    try { up = await clusterRequest(cl, req.method, BASE_PATH + sub + url.search, fwd, body); }
    catch (e) {
      Store.clusters.update(cl.id, { lastError: e.message });
      if (req.method !== 'GET') Store.audit({ user: who, action: 'api', cluster: cl.id, clusterName: cl.name, method: req.method, path: sub + url.search, status: 0, error: e.message, batch });
      return sendJson(res, 502, { error: e.message });
    }
    const ms = Date.now() - started;
    if (req.method !== 'GET') Store.audit({ user: who, action: 'api', cluster: cl.id, clusterName: cl.name, method: req.method, path: sub + url.search, status: up.statusCode, ms, batch });
    const headers = { 'X-Upstream-Ms': String(ms), 'Cache-Control': 'no-store' };
    for (const h of ['content-type', 'content-disposition', 'location', 'x-partial-success']) if (up.headers[h]) headers[h] = up.headers[h];
    headers['X-Upstream-Headers'] = Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(up.headers).filter(([k]) => k !== 'set-cookie')))).toString('base64');
    res.writeHead(up.statusCode, headers);
    up.pipe(res);
    return;
  }

  // ----- extraction bundles
  if (p === '/portal/bundle' && req.method === 'POST') {
    const b = await readJsonBody(req);
    if (!b.html || !b.json) return sendJson(res, 400, { error: 'Nothing to bundle — run an extraction first' });
    const cl = Store.clusters.get(b.cluster);
    const clusterId = b.clusterId || cl?.clusterUuid || 'manual';
    const clusterName = b.clusterName || cl?.clusterName || cl?.name || 'cluster';
    const bundle = Upload.buildBundle({ html: b.html, json: b.json, clusterName, clusterId, target: cl?.url || '', user: who, redacted: !!b.redacted });
    if (b.action === 'download') {
      res.writeHead(200, { 'Content-Type': 'application/gzip', 'Content-Disposition': `attachment; filename="${bundle.tarball}"`, 'Content-Length': bundle.gz.length });
      return res.end(bundle.gz);
    }
    if (!Upload.UPLOAD_ENABLED) return sendJson(res, 403, { error: 'Uploading is disabled on this portal (UPLOAD_ENABLED=false)' });
    try {
      const r = await Upload.upload(bundle, clusterId);
      Store.audit({ user: who, action: 'upload', cluster: b.cluster, clusterName, clusterId, file: bundle.tarball, status: r.status, url: r.url });
      return sendJson(res, 200, { ok: r.status >= 200 && r.status < 300, status: r.status, statusText: r.statusText, body: r.body.slice(0, 4000), file: r.file, bytes: r.bytes, ms: r.ms, url: r.url, clusterId, clusterName });
    } catch (e) {
      Store.audit({ user: who, action: 'upload', cluster: b.cluster, clusterName, clusterId, file: bundle.tarball, error: e.message });
      return sendJson(res, 502, { error: `Upload failed: ${e.message}` });
    }
  }

  return sendJson(res, 404, { error: 'Not found' });
}

http.createServer((req, res) => {
  handle(req, res).catch(e => { try { sendJson(res, 500, { error: e.message }); } catch {} });
}).listen(PORT, () => {
  console.log(`Hammerspace API Portal on :${PORT} — ${Object.keys(spec.paths).length} paths, basePath ${BASE_PATH}`);
  console.log(`Data dir: ${Store.DATA_DIR} · ${Store.clusters.list().length} registered cluster(s) · ${Store.users.count()} portal user(s)`);
});
