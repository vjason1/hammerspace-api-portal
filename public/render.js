/* Friendly renderer for Hammerspace API responses.
 * Arrays of objects -> sortable, filterable table with click-to-expand detail.
 * Objects -> property card: key facts first, nested objects as collapsible sections.
 * Values are humanized: timestamps, byte sizes, states, booleans, UUIDs. */
'use strict';

const Pretty = (() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- labels
  const ACRONYMS = { id: 'ID', uuid: 'UUID', uoid: 'UOID', ip: 'IP', ips: 'IPs', url: 'URL', uri: 'URI', ad: 'AD', dns: 'DNS',
    ntp: 'NTP', smb: 'SMB', nfs: 'NFS', kms: 'KMS', mgmt: 'Mgmt', sw: 'SW', mtu: 'MTU', mac: 'MAC', cpu: 'CPU', ha: 'HA',
    osv: 'OSV', gc: 'GC', ldap: 'LDAP', tls: 'TLS', pem: 'PEM', nqn: 'NQN', ms: 'ms', iops: 'IOPS', vlan: 'VLAN', s3: 'S3',
    rdma: 'RDMA', dhcp: 'DHCP', sid: 'SID', ou: 'OU', spns: 'SPNs', crc32: 'CRC32', dp: 'DP', mdsi: 'MDSI', fw: 'FW', hw: 'HW', vpd: 'VPD' };
  function label(key) {
    const words = String(key).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').replace(/[_.-]+/g, ' ').trim().split(/\s+/);
    return words.map((w, i) => ACRONYMS[w.toLowerCase()] || (i === 0 ? w[0].toUpperCase() + w.slice(1) : w.toLowerCase())).join(' ');
  }

  // ---------- value classification
  const TIME_KEY = /(^|[a-z])(created|modified|time|date|since|started|ended|expiration|activation|bootTime|lastValidated|issued|notBefore|notAfter|timestamp|clearTime|suspectedSince|lastRegrade|lastVolumeRealigned|SendTime|startOfGrace|scheduledPurge|eulaAccepted)/i;
  const BYTES_KEY = /(capacity|bytes|size|used|free|total|available|space|freed|logicalUsed|sizeLimit)$|^bytes/i;
  const NOT_BYTES = /(count|percent|pages?|files?|keys|inodes|threshold|numOf|license|ms$|secs?$|seconds|duration|rate)/i;
  const DURATION_MS_KEY = /(duration|Ms$|Millis$)/i;
  const GOOD = /^(UP|OK|ONLINE|RUNNING|HA|VALID|SUCCESS|COMPLETED|CONNECTED|MANAGED|CONFIGURED|PUBLISHED|MOUNTED|CREATED|NORMAL|SYNC|ADDED|ACTIVE|AUTHENTICATED|TRUE)$/;
  const WARN = /^(DEGRADED|SUSPECTED|WARN|WARNING|PENDING|QUEUED|EXECUTING|IN_PROGRESS|VALIDATING|INITIALIZING|MAINTENANCE|UPDATE|DECOMMISSIONING|CANCELLING|RECOVERING|STANDALONE|RETRY|NOTICE|DISCOVERED|PARTIALLY_FAILED|RECLAIMING|PRE_REMOVAL|REMOVING|DELETING|OFFLINE|NO_SYNC|OVER_QUOTA)$/;
  const BAD = /^(DOWN|FAILED|CRITICAL|ERROR|ALERT|EMERGENCY|DISABLED|EXPIRED|INVALID|UNAVAILABLE|VALIDATION_FAILED|CANCELLED|HALTED|REMOVE_FAILED|DELETE_FAILED|DISCONNECTED|FAILED_[A-Z_]+|UNABLE_TO_COMMUNICATE|DECOMMISSIONED)$/;
  const STATE_KEY = /(state|status|severity|mode|health|urgency|lifecycle)$/i;

  function fmtBytes(n) {
    const u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB']; let i = 0; let v = Math.abs(n);
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return `${n < 0 ? '-' : ''}${v.toFixed(v >= 100 || i === 0 ? 0 : v >= 10 ? 1 : 2)} ${u[i]}`;
  }
  function fmtDuration(ms) {
    if (ms < 1000) return `${ms} ms`;
    const s = Math.round(ms / 1000), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
    return [d && `${d}d`, h && `${h}h`, m && `${m}m`, (!d && !h) && `${s % 60}s`].filter(Boolean).join(' ');
  }
  function fmtTime(ms) {
    const d = new Date(ms); const ago = Date.now() - ms;
    const rel = Math.abs(ago) < 864e5 * 60 ? ` (${ago >= 0 ? fmtDuration(ago) + ' ago' : 'in ' + fmtDuration(-ago)})` : '';
    return `${d.toLocaleString()}<span class="pv-dim">${rel}</span>`;
  }
  const isUuid = s => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

  // Short, human summary of an object used inside table cells and section headers
  function summarize(o) {
    if (o == null) return '';
    if (Array.isArray(o)) return `${o.length} item${o.length === 1 ? '' : 's'}`;
    if (typeof o !== 'object') return String(o);
    for (const k of ['name', 'username', 'path', 'address', 'shareName', 'fullVersion', 'domainName', 'activationId', 'subnet', 'server', 'host'])
      if (o[k] != null && o[k] !== '') return String(o[k]);
    if (o.ip && o.ip.address) return `${o.ip.address}${o.ip.prefixLength != null ? '/' + o.ip.prefixLength : ''}`;
    if (o.address != null && o.prefixLength != null) return `${o.address}/${o.prefixLength}`;
    if (o.uoid && o.uoid.uuid) return o.uoid.uuid;
    if (o.uuid) return o.uuid;
    if (o.total != null && o.used != null) return `${fmtBytes(o.used)} of ${fmtBytes(o.total)}`;
    const keys = Object.keys(o).filter(k => o[k] != null && typeof o[k] !== 'object');
    return keys.slice(0, 2).map(k => `${label(k)}: ${o[k]}`).join(', ');
  }

  // Render one scalar (or small structure) in a cell / value slot
  function value(key, v, compact) {
    if (v === null || v === undefined || v === '') return '<span class="pv-dim">—</span>';
    if (typeof v === 'boolean') return v ? '<span class="pv-yes">Yes</span>' : '<span class="pv-no">No</span>';
    if (typeof v === 'number') {
      if (TIME_KEY.test(key) && v > 9e11 && v < 5e12) return fmtTime(v);
      if (TIME_KEY.test(key) && v > 9e8 && v < 5e9 && /time|since|date/i.test(key)) return fmtTime(v * 1000);
      if (DURATION_MS_KEY.test(key) && !/^(start|end)/i.test(key)) return fmtDuration(v);
      if (BYTES_KEY.test(key) && !NOT_BYTES.test(key) && v >= 1024) return `<span title="${v.toLocaleString()} bytes">${fmtBytes(v)}</span>`;
      if (/percent/i.test(key)) return `${+v.toFixed(2)}%`;
      return Number.isInteger(v) ? v.toLocaleString() : (+v.toFixed(3)).toLocaleString();
    }
    if (typeof v === 'string') {
      if (STATE_KEY.test(key) || GOOD.test(v) || BAD.test(v)) {
        const cls = GOOD.test(v) ? 'good' : BAD.test(v) ? 'bad' : WARN.test(v) ? 'warn' : 'neutral';
        if (/^[A-Z0-9_]+$/.test(v)) return `<span class="pill ${cls}">${esc(v.replace(/_/g, ' '))}</span>`;
      }
      if (isUuid(v)) {
        const o = typeof OBJ !== 'undefined' && OBJ.byUuid(v);
        return `<code class="uuid" title="${o ? esc(`${o.name} (${o.type}) — `) : ''}${esc(v)} · click to copy" data-copy="${esc(v)}">${o && compact ? `<b>${esc(o.name)}</b> ` : ''}${compact ? esc(v.slice(0, 8)) + '…' : esc(v)}</code>`;
      }
      if (/-----BEGIN /.test(v)) return `<details class="pv-pem"><summary>PEM (${v.length} chars)</summary><pre>${esc(v)}</pre></details>`;
      if (compact && v.length > 80) return `<span title="${esc(v)}">${esc(v.slice(0, 77))}…</span>`;
      return esc(v);
    }
    if (Array.isArray(v)) {
      if (!v.length) return '<span class="pv-dim">none</span>';
      if (v.every(x => typeof x !== 'object' || x === null)) {
        const shown = compact ? v.slice(0, 4) : v;
        return shown.map(x => `<span class="chip">${value(key, x, true)}</span>`).join(' ') + (compact && v.length > 4 ? ` <span class="pv-dim">+${v.length - 4}</span>` : '');
      }
      const names = v.map(summarize).filter(Boolean);
      if (compact) return names.length ? esc(names.slice(0, 3).join(', ')) + (v.length > 3 ? ` <span class="pv-dim">+${v.length - 3}</span>` : '') : `${v.length} items`;
      return null; // caller renders as sub-table
    }
    if (typeof v === 'object') {
      if (v.uuid && Object.keys(v).length <= 2) return value('uuid', v.uuid, compact);
      if (v.address !== undefined && v.prefixLength !== undefined && Object.keys(v).length <= 2) return esc(summarize(v));
      if (compact) return esc(summarize(v)) || '<span class="pv-dim">{…}</span>';
      return null; // caller renders as section
    }
    return esc(String(v));
  }

  const isEmpty = v => v == null || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length);
  const PRIORITY = ['name', 'username', 'path', 'shareName', 'sourceName', 'type', 'nodeType', 'severity', 'operState', 'adminState',
    'state', 'status', 'shareState', 'storageVolumeState', 'nodeState', 'nodeMode', 'serviceState', 'hwComponentState', 'clusterState',
    'licenseType', 'dataPortalType', 'address', 'mgmtIpAddress', 'ipAddresses', 'endpoint', 'domain', 'domainName', 'enabled',
    'capacity', 'totalCapacity', 'space', 'logicalUsed', 'size', 'created', 'started', 'ended', 'progress', 'count', 'internalId'];
  const NOISE = new Set(['extendedInfo', 'unclearedEvents', 'errors', 'modificationCount', 'objectType', '_type', 'params',
    'paramsMap', 'ctxMap', 'clientCert', 'privateKey', 'replicationClientCert', 'replicationPrivateKey', 'certPem', 'pemChain', 'rootFileHandle']);

  function pickColumns(rows) {
    const freq = {};
    rows.slice(0, 200).forEach(r => Object.entries(r).forEach(([k, v]) => { if (!isEmpty(v) && !NOISE.has(k)) freq[k] = (freq[k] || 0) + 1; }));
    const present = Object.keys(freq).filter(k => freq[k] >= Math.min(rows.length, 200) * 0.3);
    const scalarish = k => rows.some(r => r[k] != null && (typeof r[k] !== 'object' || (r[k] && (r[k].address !== undefined || r[k].used !== undefined || Array.isArray(r[k]) || r[k].name))));
    const ranked = [...PRIORITY.filter(k => present.includes(k)), ...present.filter(k => !PRIORITY.includes(k) && scalarish(k) && k !== 'uoid' && k !== 'modified')];
    const cols = ranked.slice(0, 7);
    if (!cols.length) return Object.keys(rows[0] || {}).slice(0, 6);
    return cols;
  }

  function sortVal(v) {
    if (v == null) return '';
    if (typeof v === 'object') return summarize(v).toLowerCase();
    return typeof v === 'string' ? v.toLowerCase() : v;
  }

  // ---------- table
  function table(rows, opts = {}) {
    const id = 't' + Math.random().toString(36).slice(2, 8);
    const cols = pickColumns(rows);
    const state = { sortKey: null, dir: 1, q: '' };
    const wrap = document.createElement('div');
    wrap.className = 'pv-table-wrap';
    wrap.innerHTML = `${rows.length > 8 && !opts.nested ? `<div class="pv-tools"><input type="search" placeholder="Filter ${rows.length} rows…" class="pv-filter"><span class="pv-dim pv-shown"></span></div>` : ''}
      <div class="pv-scroll"><table class="pv-table" id="${id}"><thead><tr>${cols.map(c => `<th data-k="${esc(c)}" tabindex="0">${esc(label(c))}<span class="arr"></span></th>`).join('')}<th class="pv-x"></th></tr></thead><tbody></tbody></table></div>`;
    const tbody = wrap.querySelector('tbody');
    const draw = () => {
      let list = rows.map((r, i) => ({ r, i }));
      if (state.q) { const q = state.q.toLowerCase(); list = list.filter(({ r }) => JSON.stringify(r).toLowerCase().includes(q)); }
      if (state.sortKey) list.sort((a, b) => { const x = sortVal(a.r[state.sortKey]), y = sortVal(b.r[state.sortKey]); return (x > y ? 1 : x < y ? -1 : 0) * state.dir; });
      const LIMIT = 500;
      tbody.innerHTML = list.slice(0, LIMIT).map(({ r, i }) => `<tr data-i="${i}" class="pv-row">${cols.map(c => `<td>${value(c, r[c], true)}</td>`).join('')}<td class="pv-x">▸</td></tr>`).join('')
        + (list.length > LIMIT ? `<tr><td colspan="${cols.length + 1}" class="pv-dim">Showing first ${LIMIT} of ${list.length}. Filter to narrow down, or use the JSON tab.</td></tr>` : '')
        + (!list.length ? `<tr><td colspan="${cols.length + 1}" class="pv-dim">No rows match.</td></tr>` : '');
      const sh = wrap.querySelector('.pv-shown'); if (sh) sh.textContent = state.q ? `${list.length} match` : '';
      wrap.querySelectorAll('th[data-k]').forEach(th => { th.querySelector('.arr').textContent = th.dataset.k === state.sortKey ? (state.dir > 0 ? ' ▲' : ' ▼') : ''; });
    };
    wrap.querySelector('thead').addEventListener('click', e => {
      const th = e.target.closest('th[data-k]'); if (!th) return;
      state.dir = state.sortKey === th.dataset.k ? -state.dir : 1; state.sortKey = th.dataset.k; draw();
    });
    wrap.querySelector('.pv-filter')?.addEventListener('input', e => { state.q = e.target.value.trim(); draw(); });
    tbody.addEventListener('click', e => {
      if (e.target.closest('[data-copy]')) return;
      const tr = e.target.closest('tr.pv-row'); if (!tr) return;
      const next = tr.nextElementSibling;
      if (next && next.classList.contains('pv-detail')) { next.remove(); tr.classList.remove('open'); return; }
      const d = document.createElement('tr'); d.className = 'pv-detail';
      const td = document.createElement('td'); td.colSpan = cols.length + 1;
      td.appendChild(objectCard(rows[+tr.dataset.i], { nested: true }));
      d.appendChild(td); tr.after(d); tr.classList.add('open');
    });
    draw();
    return wrap;
  }

  // ---------- object card
  function objectCard(obj, opts = {}) {
    const el = document.createElement('div');
    el.className = 'pv-card' + (opts.nested ? ' nested' : '');
    const entries = Object.entries(obj);
    const scalars = [], sections = [];
    for (const [k, v] of entries) {
      if (opts.hideEmpty !== false && isEmpty(v)) continue;
      if (k === 'errors' && !opts.nested) continue;
      const rendered = value(k, v, false);
      if (rendered === null) sections.push([k, v]); else scalars.push([k, rendered]);
    }
    // order: priority keys first
    scalars.sort((a, b) => rank(a[0]) - rank(b[0]));
    if (!opts.nested && obj.errors && obj.errors.length) {
      el.insertAdjacentHTML('beforeend', `<div class="pv-errors">${obj.errors.map(e => `<div><span class="pill bad">${esc(e.errorCode || 'ERROR')}</span> ${esc(e.message || '')}</div>`).join('')}</div>`);
    }
    if (scalars.length) {
      el.insertAdjacentHTML('beforeend', `<dl class="pv-dl">${scalars.map(([k, h]) => `<dt>${esc(label(k))}</dt><dd>${h}</dd>`).join('')}</dl>`);
    }
    for (const [k, v] of sections) {
      const det = document.createElement('details');
      det.className = 'pv-section';
      const noisy = NOISE.has(k);
      const sum = Array.isArray(v) ? `${v.length} item${v.length === 1 ? '' : 's'}` : summarize(v);
      det.innerHTML = `<summary><span class="pv-sec-title">${esc(label(k))}</span><span class="pv-dim">${esc(sum)}</span></summary>`;
      det.open = !noisy && !opts.nested && (Array.isArray(v) ? v.length <= 25 : Object.keys(v).length <= 12) && (opts.depth || 0) < 1;
      let filled = false;
      const fill = () => {
        if (filled) return; filled = true;
        const body = document.createElement('div'); body.className = 'pv-sec-body';
        if (Array.isArray(v)) {
          const objs = v.filter(x => x && typeof x === 'object' && !Array.isArray(x));
          if (objs.length === v.length) body.appendChild(table(v, { nested: true }));
          else body.innerHTML = `<pre class="code">${esc(JSON.stringify(v, null, 2))}</pre>`;
        } else body.appendChild(objectCard(v, { nested: true, depth: (opts.depth || 0) + 1 }));
        det.appendChild(body);
      };
      if (det.open) fill();
      det.addEventListener('toggle', () => det.open && fill());
      el.appendChild(det);
    }
    if (!scalars.length && !sections.length && !el.childElementCount) el.innerHTML = '<p class="pv-dim">No populated fields.</p>';
    return el;
  }
  const rank = k => { const i = PRIORITY.indexOf(k); return i < 0 ? 999 : i; };

  // ---------- Influx-style series ({name, columns, values|points})
  function isSeries(arr) { return Array.isArray(arr) && arr.length && arr.every(s => s && Array.isArray(s.columns) && (Array.isArray(s.values) || Array.isArray(s.points) || Array.isArray(s.rows))); }
  function series(arr) {
    const wrap = document.createElement('div');
    arr.forEach(s => {
      const rows = (s.values || s.points || s.rows || []).map(r => Array.isArray(r) ? Object.fromEntries(s.columns.map((c, i) => [c, r[i]])) : r);
      const tags = s.tags ? Object.entries(s.tags).map(([k, v]) => `${k}=${v}`).join(', ') : '';
      wrap.insertAdjacentHTML('beforeend', `<h4 class="pv-h">${esc(s.name || 'series')} <span class="pv-dim">${esc(tags)} · ${rows.length} points</span></h4>`);
      if (rows.length) { const cols = s.columns; const t = tableFixed(rows, cols); wrap.appendChild(t); }
    });
    return wrap;
  }
  function tableFixed(rows, cols) {
    const d = document.createElement('div'); d.className = 'pv-scroll';
    d.innerHTML = `<table class="pv-table"><thead><tr>${cols.map(c => `<th>${esc(label(c))}</th>`).join('')}</tr></thead><tbody>${
      rows.slice(0, 500).map(r => `<tr>${cols.map(c => `<td>${value(c === 'time' ? 'timestamp' : c, r[c], true)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    return d;
  }

  // ---------- entry point
  function render(data) {
    const root = document.createElement('div'); root.className = 'pv';
    if (data === null || data === undefined || data === '') { root.innerHTML = '<p class="pv-dim">Empty response — the request succeeded with no body.</p>'; return root; }
    if (typeof data !== 'object') { root.innerHTML = `<div class="pv-scalar">${value('result', data, false)}</div>`; return root; }
    if (isSeries(data)) { root.appendChild(series(data)); return root; }
    if (Array.isArray(data)) {
      if (!data.length) { root.innerHTML = '<p class="pv-dim">No items returned.</p>'; return root; }
      if (data.every(x => x && typeof x === 'object' && !Array.isArray(x))) {
        root.insertAdjacentHTML('beforeend', `<p class="pv-dim pv-hint">${data.length} item${data.length === 1 ? '' : 's'} · click a row for full details · click a header to sort</p>`);
        root.appendChild(table(data));
      } else root.innerHTML = `<ul class="pv-list">${data.map(x => `<li>${value('item', x, false) ?? esc(JSON.stringify(x))}</li>`).join('')}</ul>`;
      return root;
    }
    // A map of name -> scalar (e.g. events/summary, i18n) reads best as a 2-column table
    const vals = Object.values(data);
    if (vals.length > 12 && vals.every(v => v === null || typeof v !== 'object')) {
      const rows = Object.entries(data).map(([k, v]) => ({ key: k, value: v }));
      root.appendChild(tableFixed(rows, ['key', 'value']));
      return root;
    }
    root.appendChild(objectCard(data));
    return root;
  }

  // copy-on-click for UUIDs anywhere in rendered output
  document.addEventListener('click', e => {
    const c = e.target.closest('[data-copy]'); if (!c) return;
    navigator.clipboard?.writeText(c.dataset.copy);
    c.classList.add('copied'); setTimeout(() => c.classList.remove('copied'), 900);
  });

  return { render, label, value, summarize, pickColumns, isEmpty, NOISE };
})();
