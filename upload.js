// Bundles an extraction (report HTML + raw JSON) into a .tar.gz and uploads it to Hammerspace,
// mirroring the support script:
//   curl --insecure -X POST -F payload=prosvcs -F cluster_id=<id> -F payload_type=prosvcs -F file=@<tarball> <UPLOAD_URL>
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { URL } = require('url');

const UPLOAD_URL = process.env.UPLOAD_URL || 'https://v1proto.sc.hammerspace.com/upload/';
const UPLOAD_ENABLED = (process.env.UPLOAD_ENABLED || 'true').toLowerCase() === 'true';
const UPLOAD_INSECURE = (process.env.UPLOAD_INSECURE_TLS || 'true').toLowerCase() === 'true'; // script uses --insecure
const UPLOAD_PAYLOAD = process.env.UPLOAD_PAYLOAD || 'prosvcs';
const WORK_DIR = process.env.UPLOAD_WORK_DIR || path.join(os.tmpdir(), 'hs-portal-uploads');
const KEEP_BUNDLES = (process.env.UPLOAD_KEEP_BUNDLES || 'false').toLowerCase() === 'true';

// File-name safe: letters, digits, dot, dash, underscore
const safe = s => String(s || '').trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'unknown';

function stamp(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${Math.floor(d.getTime() / 1000)}`; // DATESTAMP_EPOCH like the script
}

// ---- minimal ustar writer (no dependencies)
function tarHeader(name, size, mtime, type = '0') {
  const b = Buffer.alloc(512);
  const w = (str, off, len) => b.write(str, off, Math.min(Buffer.byteLength(str), len), 'utf8');
  const oct = (n, len) => n.toString(8).padStart(len - 1, '0') + '\0';
  // ustar: long paths are split into prefix (<=155 bytes, the directory) + name (<=100 bytes)
  let prefix = '';
  if (Buffer.byteLength(name) > 100) {
    const i = name.lastIndexOf('/', name.endsWith('/') ? name.length - 2 : name.length - 1);
    prefix = name.slice(0, i); name = name.slice(i + 1);
    if (Buffer.byteLength(name) > 100 || Buffer.byteLength(prefix) > 155) throw new Error(`tar entry name too long: ${prefix}/${name}`);
  }
  w(name, 0, 100);
  w(oct(type === '5' ? 0o755 : 0o644, 8), 100, 8);
  w(oct(0, 8), 108, 8); w(oct(0, 8), 116, 8);
  w(oct(size, 12), 124, 12);
  w(oct(Math.floor(mtime / 1000), 12), 136, 12);
  b.fill(' ', 148, 156);            // checksum placeholder
  w(type, 156, 1);
  w('ustar\0', 257, 6); w('00', 263, 2);
  w('hsportal', 265, 32); w('hsportal', 297, 32);
  if (prefix) w(prefix, 345, 155);
  let sum = 0; for (const x of b) sum += x;
  w(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
  return b;
}
function tarGz(dirName, files) {
  const now = Date.now();
  const parts = [tarHeader(`${dirName}/`, 0, now, '5')];
  for (const f of files) {
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8');
    parts.push(tarHeader(`${dirName}/${f.name}`, data.length, now), data);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad) parts.push(Buffer.alloc(pad));
  }
  parts.push(Buffer.alloc(1024)); // end-of-archive
  return zlib.gzipSync(Buffer.concat(parts), { level: 9 });
}

// Names: everything carries cluster name + cluster id
function names(clusterName, clusterId, when = new Date()) {
  const cn = safe(clusterName).slice(0, 40), id = safe(clusterId).slice(0, 40), ts = stamp(when);
  const base = `hs_config_${cn}_${id}_${ts}`;
  return {
    dir: base,                                        // folder inside the tarball
    tarball: `hs_config_bundle_${cn}_${id}_${ts}.tar.gz`,
    report: `${base}_report.html`,
    json: `${base}_raw.json`,
    manifest: 'MANIFEST.txt',
  };
}

function buildBundle({ html, json, clusterName, clusterId, target, user, redacted }) {
  const when = new Date();
  const n = names(clusterName, clusterId, when);
  const manifest = [
    'Hammerspace cluster configuration extraction',
    `Cluster name : ${clusterName}`,
    `Cluster id   : ${clusterId}`,
    `Cluster URL  : ${target}`,
    `Collected by : ${user} via Hammerspace API Portal`,
    `Collected at : ${when.toISOString()}`,
    `Secrets      : ${redacted ? 'redacted' : 'NOT redacted'}`,
    '', 'Files:', `  ${n.report}  - formatted report (open in a browser)`, `  ${n.json}  - raw API responses`, '',
  ].join('\n');
  const gz = tarGz(n.dir, [
    { name: n.manifest, data: manifest },
    { name: n.report, data: html },
    { name: n.json, data: json },
  ]);
  return { ...n, gz };
}

function multipart(fields, file) {
  const boundary = '----hsportal' + crypto.randomBytes(12).toString('hex');
  const chunks = [];
  for (const [k, v] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: application/gzip\r\n\r\n`));
  chunks.push(file.data, Buffer.from(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

function post(urlStr, body, contentType) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, {
      method: 'POST', rejectUnauthorized: !UPLOAD_INSECURE, timeout: 600000,
      headers: { 'Content-Type': contentType, 'Content-Length': body.length, 'User-Agent': 'hammerspace-api-portal' },
    }, res => {
      const out = []; res.on('data', c => out.push(c));
      res.on('end', () => resolve({ status: res.statusCode, statusText: res.statusMessage, headers: res.headers, body: Buffer.concat(out).toString('utf8') }));
    });
    req.on('timeout', () => req.destroy(new Error('Upload timed out')));
    req.on('error', reject);
    req.end(body);
  });
}

async function upload(bundle, clusterId) {
  fs.mkdirSync(WORK_DIR, { recursive: true, mode: 0o700 });
  const tarPath = path.join(WORK_DIR, bundle.tarball);
  fs.writeFileSync(tarPath, bundle.gz, { mode: 0o600 });
  const started = Date.now();
  try {
    const { body, contentType } = multipart(
      { payload: UPLOAD_PAYLOAD, cluster_id: clusterId, payload_type: UPLOAD_PAYLOAD },
      { name: bundle.tarball, data: fs.readFileSync(tarPath) });
    const res = await post(UPLOAD_URL, body, contentType);
    return { ...res, ms: Date.now() - started, file: bundle.tarball, bytes: bundle.gz.length, url: UPLOAD_URL };
  } finally {
    if (!KEEP_BUNDLES) fs.rmSync(tarPath, { force: true }); // like `rm -f "$tarball"`
  }
}

module.exports = { UPLOAD_URL, UPLOAD_ENABLED, buildBundle, upload, names, safe };
