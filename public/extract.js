/* Cluster configuration extraction.
 * Runs every read-only retrieval endpoint that describes configuration, keeps what is configured,
 * and builds a self-contained HTML report (plus a raw JSON bundle) the user can save. */
'use strict';

const Extract = (() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Report chapters. cols: columns for the summary table ("a.b" reaches into nested objects).
  // single: render as a settings card instead of a table.
  const CHAPTERS = [
    { id: 'cluster', title: 'Cluster overview', sections: [
      { path: '/cntl', title: 'Cluster', single: true },
      { path: '/system/health', title: 'Health summary', single: true },
      { path: '/system/counts', title: 'Object counts', single: true },
      { path: '/sites/local', title: 'Local site', single: true },
      { path: '/mdsis', title: 'Metadata server instances', cols: ['name', 'containerNode.name', 'internalId'] },
    ] },
    { id: 'nodes', title: 'Nodes & networking', sections: [
      { path: '/nodes', title: 'Nodes & storage systems', cols: ['name', 'nodeType', 'productNodeType', 'nodeState', 'nodeMode', 'mgmtIpAddress', 'endpoint', 'swVersion.fullVersion'] },
      { path: '/nodes/unauthenticated', title: 'Unauthenticated nodes', cols: ['name', 'nodeType', 'mgmtIpAddress', 'nodeState'] },
      { path: '/network-interfaces', title: 'Network interfaces', cols: ['name', 'ipAddresses', 'roles', 'mtu', 'vlanId', 'linkSpeed', 'adminState', 'serviceState'] },
      { path: '/gateways', title: 'Default gateways', cols: ['nodeName', 'ipv4', 'ipv6'] },
      { path: '/static-routes', title: 'Static routes', cols: ['destination', 'nextHop'] },
      { path: '/subnet-gateways', title: 'Subnet gateways', cols: ['subnet', 'subnetgateway'] },
      { path: '/data-portals', title: 'Data portals (protocol services)', cols: ['dataPortalType', 'operState', 'adminState', 'dataPortalState', 'exported'] },
      { path: '/disk-drives', title: 'Disk drives', cols: ['name', 'capacity', 'hwComponentState', 'vpd.vendor', 'vpd.productName', 'vpd.serialNumber', 'temperature'] },
      { path: '/nvmeof-enclosures', title: 'NVMe-oF enclosures', cols: ['name', 'serviceState', 'adminState', 'nvmeOfTargets'] },
    ] },
    { id: 'storage', title: 'Storage', sections: [
      { path: '/storage-volumes', title: 'File storage volumes', cols: ['name', 'node.name', 'logicalVolume.exportPath', 'storageVolumeState', 'operState', 'accessType', 'effectiveTotalCapacity', 'spaceUsed'] },
      { path: '/object-storage-volumes', title: 'Object storage volumes', cols: ['name', 'node.name', 'objectStoreLogicalVolume.name', 'storageVolumeState', 'operState', 'compressionType', 'shared', 'kms.name'] },
      { path: '/logical-volumes', title: 'Logical volumes (exports discovered on nodes)', cols: ['name', 'exportPath', 'fsType', 'totalCapacity', 'capacity', 'serviceState'] },
      { path: '/volume-groups', title: 'Volume groups', cols: ['name', 'state', 'volumes', 'userModifiable'] },
    ] },
    { id: 'shares', title: 'Shares & data services', sections: [
      { path: '/shares', title: 'Shares', cols: ['name', 'path', 'shareState', 'exportOptions', 'shareSizeLimit', 'space', 'totalNumberOfFiles', 'smbBrowsable'] },
      { path: '/shares/mount-details', title: 'Share mount details' },
      { perShare: '/shares/{id}/objective-list', title: 'Objectives applied per share', key: 'shareObjectives' },
      { path: '/objectives', title: 'Objectives', cols: ['name', 'basic', 'expression', 'priority'] },
      { path: '/labels', title: 'Labels', cols: ['name', 'impliedLabels'] },
      { path: '/smbautohomes', title: 'SMB auto-home shares', cols: ['user.username', 'path', 'homeShareName', 'acl', 'createHomeDir', 'isDefault'] },
      { path: '/s3server', title: 'S3 services', cols: ['name', 'endpoints', 'ports', 'identityProvider', 'buckets', 'users', 'defaultServer'] },
    ] },
    { id: 'protection', title: 'Data protection', sections: [
      { path: '/schedules', title: 'Schedules', cols: ['name', 'cronExpression', 'cronDesc'] },
      { path: '/snapshot-retentions', title: 'Snapshot retention policies', cols: ['name', 'retentionTime', 'numOfCopies'] },
      { path: '/share-snapshots', title: 'Share snapshot schedules', cols: ['share.name', 'schedule.name', 'retention.name'] },
      { perShare: '/share-snapshots/snapshot-list/{id}', title: 'Existing snapshots per share', key: 'snapshots' },
      { path: '/file-snapshots', title: 'File snapshot schedules', cols: ['filePath', 'retention.name'] },
      { path: '/backup', title: 'Configuration backup', cols: ['backupStorageVolume', 'schedule.name', 'schedule.cronExpression', 'availableBackups'] },
      { path: '/antivirus', title: 'Antivirus services', cols: ['name', 'node.name', 'operState', 'adminState'] },
    ] },
    { id: 'replication', title: 'Sites & replication', sections: [
      { path: '/sites', title: 'Sites', cols: ['name', 'type', 'mgmtAddress', 'dataAddress', 'swVersion.fullVersion'] },
      { path: '/share-participants', title: 'Replicated share participants', cols: ['shareName', 'name', 'participantId', 'operState', 'adminState', 'updateInterval'] },
    ] },
    { id: 'identity', title: 'Identity & access', sections: [
      { path: '/ad', title: 'Active Directory', single: true },
      { path: '/name-services', title: 'Name services', cols: ['name', 'nameServiceType', 'domain', 'ordinal', 'ldapTransport', 'operState'] },
      { path: '/ldaps', title: 'LDAP', cols: ['url', 'base', 'uri'] },
      { path: '/nis', title: 'NIS', single: true },
      { path: '/domain-idmaps', title: 'Domain ID mapping rules', cols: ['mapFrom', 'mapTo', 'attribute', 'bidirectional', 'priority'] },
      { path: '/idp', title: 'Federated identity providers', cols: ['name', 'type', 'domain', 'servers', 'connectionSecurityType'] },
      { path: '/identity-group-mappings', title: 'Directory group → role mappings', cols: ['name', 'group', 'managementRole.name'] },
      { path: '/users', title: 'Local users', cols: ['username', 'firstName', 'lastName', 'email', 'managementRole.name', 'enabled', 'dataAccessRoles'] },
      { path: '/user-groups', title: 'User groups', cols: ['name', 'managementRole.name', 'gid', 'users'] },
      { path: '/roles', title: 'Management roles', cols: ['name', 'defType', 'loginPolicy.name', 'idleTimeoutSeconds'] },
      { path: '/login-policy', title: 'Login policies', cols: ['allowedNetworks', 'lockAfterFailures', 'lockFailureInterval', 'lockoutTime'] },
    ] },
    { id: 'services', title: 'System services', sections: [
      { path: '/dnss', title: 'DNS', single: true },
      { path: '/ntps', title: 'NTP', single: true },
      { path: '/mail/smtp', title: 'Email (SMTP)', single: true },
      { path: '/snmp', title: 'SNMP', single: true },
      { path: '/syslog', title: 'Syslog forwarding', single: true },
      { path: '/notification-rules', title: 'Notification rules', cols: ['name', 'threshold', 'format', 'collectLogs', 'users'] },
      { path: '/heartbeat', title: 'Heartbeat / phone-home', cols: ['name', 'payloadType', 'enabled', 'intervalSecs'] },
    ] },
    { id: 'security', title: 'Security & certificates', sections: [
      { path: '/kmses', title: 'Key management systems', cols: ['name', 'type', 'endpoint', 'keyId'] },
      { path: '/pki-certificate-authorities', title: 'Certificate authorities', cols: ['role', 'certificate.certChainInfo', 'certificate.fingerprint'] },
      { path: '/pki-certificates', title: 'Trusted certificates', cols: ['origin', 'fingerprint', 'certChainInfo'] },
      { path: '/pki-managed-certificates', title: 'Managed certificates', cols: ['certificate.origin', 'issuingCa.role', 'isUploaded', 'isRevoked'] },
    ] },
    { id: 'licensing', title: 'Licensing & software', sections: [
      { path: '/licenses', title: 'Licenses', cols: ['activationId', 'licenseType', 'licenseCount', 'capacityPercentUsed', 'expirationTime', 'feature.status'] },
      { path: '/license-server', title: 'Metered licenses (license server)', cols: ['activationId', 'licenseType', 'site.name', 'activelyReporting'] },
      { path: '/versions/available', title: 'Software packages available', cols: ['fullVersion', 'productName', 'packageName', 'date'] },
      { path: '/sw-update', title: 'Software update history', cols: ['version', 'status', 'created', 'ended'] },
    ] },
  ];

  // Optional runtime sections (off by default)
  const OPTIONAL = [
    { id: 'clients', title: 'Connected NFS clients', path: '/nfs-clients', chapter: 'nodes', cols: ['address', 'port', 'protocol'] },
    { id: 'events', title: 'Open events (latest 200)', path: '/events?spec=cleared%3Deq%3Dfalse&page=0&page.size=200&page.sort=created&page.sort.dir=desc', chapter: 'cluster', cols: ['created', 'severity', 'type', 'sourceName', 'count'] },
  ];

  // Never extracted: telemetry, lookups that need input, duplicates, or the session itself
  const SKIP = [/^\/events/, /^\/metrics/, /^\/data-analytics/, /^\/reports\//, /^\/files/, /^\/i18n/, /^\/tasks/, /^\/users\/_current/,
    /related-list$/, /^\/name-services\/resolve/, /^\/file-snapshots\/list/, /^\/shares\/uuid-list/, /^\/system\/ping/, /^\/cntl\/state/,
    /^\/base-storage-volumes$/, /^\/network-interfaces\/resolve/, /^\/volume-groups\/findByLocation/, /^\/system-info/, /^\/nfs-clients/,
    /^\/pki-certificate-authorities\/system/];

  const SECRET_KEY = /(password|secret|privatekey|passphrase|community|securitytoken|bindsecret|token)$/i;

  // ---------- helpers
  const get = (o, path) => path.split('.').reduce((v, k) => (v == null ? v : v[k]), o);
  const isConfigured = d => d != null && d !== '' && !(Array.isArray(d) && !d.length) && !(typeof d === 'object' && !Array.isArray(d) && !Object.keys(d).length);

  function redact(v, on) {
    if (!on || v == null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(x => redact(x, on));
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = SECRET_KEY.test(k) && x != null && x !== '' && typeof x !== 'object' ? '••••••• (redacted)' : redact(x, on);
    return out;
  }

  function planSections(spec, opts) {
    const planned = [];
    const known = new Set();
    for (const ch of CHAPTERS) for (const s of ch.sections) {
      if (s.path) known.add(s.path);
      if (s.path && !spec.paths[s.path.split('?')[0]]?.get) continue;
      planned.push({ ...s, chapter: ch.id });
    }
    for (const o of OPTIONAL) if (opts.optional?.[o.id]) planned.push({ ...o });
    // Anything else in the spec that is a parameter-free GET and not excluded -> "Other settings"
    for (const [p, item] of Object.entries(spec.paths)) {
      const g = item.get; if (!g || known.has(p) || p.includes('{') || SKIP.some(r => r.test(p))) continue;
      if ((g.parameters || []).some(x => x.required)) continue;
      planned.push({ path: p, title: g.summary || p, chapter: 'other' });
    }
    if (!opts.perShare) return planned.filter(s => !s.perShare);
    return planned;
  }

  async function fetchJson(path, clusterId) {
    const r = await fetch(HS(path, clusterId), { headers: { Accept: 'application/json, text/plain, */*' } });
    const text = await r.text();
    let data = text;
    try { data = text ? JSON.parse(text) : null; } catch {}
    return { status: r.status, ok: r.ok, data };
  }

  async function pool(items, n, fn) {
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }));
  }

  // ---------- run
  async function run(spec, opts, onProgress, filter, clusterId = ACTIVE) {
    const sections = planSections(spec, opts).filter(s => !filter || filter(s));
    const results = [];
    const perShare = sections.filter(s => s.perShare);
    const plain = sections.filter(s => !s.perShare);
    let done = 0; const total = () => plain.length + perShare.length;
    await pool(plain, 4, async s => {
      if (opts.unavailable && opts.unavailable(s.path.split('?')[0])) {   // not in this cluster's release: don't call it
        results.push({ ...s, status: 404, ok: false, unavailable: true });
        onProgress({ section: s, state: 'na', status: 404, done: ++done, total: total() });
        return;
      }
      onProgress({ section: s, state: 'running' });
      try {
        const r = await fetchJson(s.path, clusterId);
        const res = { ...s, status: r.status, data: r.data, ok: r.ok };
        res.configured = r.ok && isConfigured(r.data);
        res.unavailable = r.status === 404;
        results.push(res);
        onProgress({ section: s, state: res.unavailable ? 'na' : !r.ok ? 'error' : res.configured ? 'ok' : 'empty', status: r.status, count: Array.isArray(r.data) ? r.data.length : (res.configured ? 1 : 0), done: ++done, total: total() });
      } catch (e) {
        results.push({ ...s, status: 0, error: e.message, ok: false });
        onProgress({ section: s, state: 'error', status: e.message, done: ++done, total: total() });
      }
    });
    // per-share drill-down, using the shares we just listed
    const shares = (results.find(r => r.path === '/shares')?.data || []).filter(x => x && x.name);
    for (const s of perShare) {
      onProgress({ section: s, state: 'running' });
      const rows = [];
      let errors = 0;
      await pool(shares, 4, async sh => {
        try {
          const r = await fetchJson(s.perShare.replace('{id}', encodeURIComponent(sh.name)), clusterId);
          if (!r.ok) { errors++; return; }
          const d = r.data;
          if (s.key === 'snapshots') { (Array.isArray(d) ? d : []).forEach(n => rows.push({ share: sh.name, snapshot: n })); }
          else {
            const list = (d && (d.appliedObjectives || d.activeObjectives)) || [];
            list.forEach(a => rows.push({ share: sh.name, path: d.path || '/', objective: a.objective?.name || a.name, applicability: a.applicability ?? '' }));
          }
        } catch { errors++; }
      });
      const res = { ...s, path: s.perShare, status: 200, ok: true, data: rows, configured: rows.length > 0, cols: s.key === 'snapshots' ? ['share', 'snapshot'] : ['share', 'path', 'objective', 'applicability'] };
      results.push(res);
      onProgress({ section: s, state: rows.length ? 'ok' : 'empty', count: rows.length, status: errors ? `${errors} share(s) failed` : 200, done: ++done, total: total() });
    }
    return results;
  }

  const COL_LABELS = { 'swVersion.fullVersion': 'Software version', 'logicalVolume.exportPath': 'Export', 'objectStoreLogicalVolume.name': 'Bucket',
    'containerNode.name': 'Host node', 'certificate.fingerprint': 'Fingerprint', 'certificate.certChainInfo': 'Certificate', 'issuingCa.role': 'Issuing CA',
    'feature.status': 'Status', 'schedule.cronExpression': 'Cron', 'vpd.serialNumber': 'Serial', 'vpd.productName': 'Model' };
  // ---------- static report rendering
  const NOISE = new Set([...Pretty.NOISE, 'uoid', 'modified', 'clientCert', 'privateKey', 'certPem', 'pemChain']);
  function cell(key, v) {
    const h = Pretty.value(key, v, true);
    return h == null ? esc(Pretty.summarize(v)) : h;
  }
  function staticObject(obj, depth = 0) {
    if (obj == null || typeof obj !== 'object') return `<p>${cell('value', obj)}</p>`;
    if (depth > 4) return `<pre>${esc(JSON.stringify(obj, null, 2))}</pre>`;
    const rows = [], subs = [];
    for (const [k, v] of Object.entries(obj)) {
      if (Pretty.isEmpty(v) || NOISE.has(k)) continue;
      if (k === 'uoid' && depth > 0) continue;
      const h = Pretty.value(k, v, false);
      if (h !== null) rows.push(`<tr><th>${esc(Pretty.label(k))}</th><td>${h}</td></tr>`);
      else if (Array.isArray(v)) {
        const objs = v.filter(x => x && typeof x === 'object');
        subs.push(`<div class="sub"><h5>${esc(Pretty.label(k))} <span class="dim">(${v.length})</span></h5>${objs.length === v.length ? staticTable(v) : `<pre>${esc(JSON.stringify(v, null, 2))}</pre>`}</div>`);
      } else subs.push(`<div class="sub"><h5>${esc(Pretty.label(k))}</h5>${staticObject(v, depth + 1)}</div>`);
    }
    if (obj.uoid?.uuid && depth === 0) rows.push(`<tr><th>UUID</th><td><code>${esc(obj.uoid.uuid)}</code></td></tr>`);
    return (rows.length ? `<table class="kv">${rows.join('')}</table>` : '') + subs.join('') || '<p class="dim">No populated fields.</p>';
  }
  function staticTable(rows, cols) {
    cols = cols && cols.length ? cols : Pretty.pickColumns(rows);
    const colLabel = c => { const p = c.split('.'); if (p.length === 1) return Pretty.label(c);
      const last = p[p.length - 1]; return COL_LABELS[c] || Pretty.label(/^(name|username|fullVersion|role|origin|status)$/.test(last) ? p[p.length - 2] : last); };
    const head = cols.map(c => `<th>${esc(colLabel(c))}</th>`).join('');
    const body = rows.map(r => `<tr>${cols.map(c => `<td>${cell(c.split('.').pop(), get(r, c))}</td>`).join('')}</tr>`).join('');
    return `<div class="tw"><table class="grid"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  }
  const itemTitle = it => it.name ?? it.username ?? it.path ?? it.activationId ?? it.fullVersion ?? it.dataPortalType ?? it.domainName ?? it.shareName ?? Pretty.summarize(it);

  function sectionHtml(s, idx) {
    const d = s.data;
    const count = Array.isArray(d) ? d.length : 1;
    let body;
    if (typeof d !== 'object') body = `<pre>${esc(d)}</pre>`;
    else if (!Array.isArray(d)) body = staticObject(d);
    else if (s.single && d.length === 1) body = staticObject(d[0]);
    else if (d.every(x => x && typeof x === 'object' && !Array.isArray(x))) {
      body = staticTable(d, s.cols);
      const detail = !s.perShare && d.some(x => Object.keys(x).length > (s.cols || []).length + 2);
      if (detail) body += `<details class="all"><summary>Full details for all ${count} item${count === 1 ? '' : 's'}</summary>${
        d.map(it => `<details class="item"><summary>${esc(itemTitle(it))}</summary>${staticObject(it)}</details>`).join('')}</details>`;
    } else body = `<ul>${d.map(x => `<li>${cell('item', x)}</li>`).join('')}</ul>`;
    return `<section id="s${idx}"><h3>${esc(s.title)} <span class="count">${Array.isArray(d) && !(s.single && count === 1) ? count : ''}</span></h3><p class="src">GET ${esc(s.path)}</p>${body}</section>`;
  }

  function overview(results, meta) {
    const R = p => results.find(r => r.path === p && r.ok)?.data;
    const cl = (R('/cntl') || [])[0] || {};
    const nodes = R('/nodes') || [];
    const anvil = nodes.find(n => n.productNodeType === 'ANVIL') || nodes[0] || {};
    const health = R('/system/health') || {};
    const cap = cl.capacity || cl.shareCapacity || {};
    const n = p => (R(p) || []).length;
    const tile = (k, v, cls = '') => `<div class="tile ${cls}"><div class="k">${esc(k)}</div><div class="v">${v}</div></div>`;
    const hc = c => c ? `${c.ok ?? 0} ok${c.degraded ? ` · <b class="w">${c.degraded} degraded</b>` : ''}${c.failed ? ` · <b class="b">${c.failed} failed</b>` : ''}` : '—';
    return `<div class="tiles">
      ${tile('Cluster', esc(cl.name || meta.target))}
      ${tile('State', Pretty.value('state', health.clusterState || cl.state, true) || '—')}
      ${tile('Software', esc(anvil.swVersion?.fullVersion || '—'))}
      ${tile('Capacity used', cap.total ? `${Pretty.value('used', cap.used, true)} of ${Pretty.value('total', cap.total, true)}` : '—')}
      ${tile('Nodes / systems', `${nodes.length} <span class="dim">${hc(health.productNodeCounts)}</span>`)}
      ${tile('Shares', `${n('/shares')} <span class="dim">${hc(health.shareCounts)}</span>`)}
      ${tile('File volumes', `${n('/storage-volumes')}`)}
      ${tile('Object volumes', `${n('/object-storage-volumes')}`)}
      ${tile('Sites', `${n('/sites') || 1}`)}
      ${tile('Time zone', esc(cl.timezone || '—'))}
    </div>`;
  }

  function buildReport(results, meta) {
    const titles = Object.fromEntries([...CHAPTERS.map(c => [c.id, c.title]), ['other', 'Other settings']]);
    const order = [...CHAPTERS.map(c => c.id), 'other'];
    const configured = results.filter(r => r.configured);
    const empty = results.filter(r => r.ok && !r.configured);
    const unavailable = results.filter(r => r.unavailable);
    const failed = results.filter(r => !r.ok && !r.unavailable);
    let idx = 0;
    const chapters = order.map(id => {
      const secs = configured.filter(r => r.chapter === id);
      // keep the declared order within a chapter
      const declared = (CHAPTERS.find(c => c.id === id)?.sections || []).map(s => s.path || s.perShare);
      secs.sort((a, b) => (declared.indexOf(a.path) + 1 || 999) - (declared.indexOf(b.path) + 1 || 999));
      if (!secs.length) return null;
      return { id, title: titles[id], secs: secs.map(s => ({ s, i: idx++ })) };
    }).filter(Boolean);

    const toc = chapters.map(c => `<li><a href="#c-${c.id}">${esc(c.title)}</a><ul>${c.secs.map(({ s, i }) =>
      `<li><a href="#s${i}">${esc(s.title)}</a>${Array.isArray(s.data) ? ` <span class="dim">${s.data.length}</span>` : ''}</li>`).join('')}</ul></li>`).join('');
    const body = chapters.map(c => `<div class="chapter" id="c-${c.id}"><h2>${esc(c.title)}</h2>${c.secs.map(({ s, i }) => sectionHtml(s, i)).join('')}</div>`).join('');
    const appendix = `<div class="chapter" id="c-appendix"><h2>Appendix: extraction log</h2>
      <p>${configured.length} sections with configuration · ${empty.length} not configured${unavailable.length ? ` · ${unavailable.length} not available on this software version` : ''} · ${failed.length} could not be read.</p>
      ${empty.length ? `<h4>Not configured (returned no data)</h4><p class="dim">${empty.map(r => esc(r.title)).join(' · ')}</p>` : ''}
      ${unavailable.length ? `<h4>Not available on this cluster’s software version</h4><p class="dim">${unavailable.map(r => `${esc(r.title)} <code>${esc(r.path)}</code>`).join(' · ')}</p>` : ''}
      ${failed.length ? `<h4>Could not be read</h4><table class="grid"><thead><tr><th>Section</th><th>Endpoint</th><th>Result</th></tr></thead><tbody>${
        failed.map(r => `<tr><td>${esc(r.title)}</td><td><code>${esc(r.path)}</code></td><td>${esc(r.error || `HTTP ${r.status}`)}${r.data && typeof r.data === 'object' && r.data.errors?.[0]?.message ? ' — ' + esc(r.data.errors[0].message) : ''}</td></tr>`).join('')}</tbody></table>` : ''}
    </div>`;

    const clusterName = ((results.find(r => r.path === '/cntl')?.data || [])[0] || {}).name || meta.target;
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Hammerspace configuration — ${esc(clusterName)} — ${esc(meta.when.toISOString().slice(0, 10))}</title>
<style>${REPORT_CSS}</style></head><body>
<header class="cover">
  <div class="brand">HS</div>
  <div><h1>Cluster configuration report</h1>
  <p class="subtitle">${esc(clusterName)} · ${esc(meta.target)}</p>
  <p class="meta">Generated ${esc(meta.when.toLocaleString())} by ${esc(meta.user)} · ${configured.length} configured sections${meta.redacted ? ' · secrets redacted' : ''}</p></div>
</header>
<main>
${overview(results, meta)}
<nav class="toc"><h2>Contents</h2><ol>${toc}<li><a href="#c-appendix">Appendix: extraction log</a></li></ol></nav>
${body}
${appendix}
</main>
<footer>Hammerspace API Portal · read-only extraction via sys-mgmt API ${esc(meta.basePath)}</footer>
</body></html>`;
  }

  const REPORT_CSS = `
:root{--ink:#333;--ink2:#555;--ink3:#8a8a8a;--line:#d9d9d9;--bg:#fff;--alt:#f5f5f5;--acc:#2a7bc6;--navy:#2d4a7a;--g:#2e9d5b;--w:#c47f12;--b:#d64545}
*{box-sizing:border-box}body{margin:0;font:13.5px/1.5 "Open Sans","Segoe UI","Helvetica Neue",Arial,sans-serif;color:var(--ink);background:var(--bg)}
code,pre{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px}pre{background:var(--alt);padding:10px;border-radius:6px;overflow:auto;white-space:pre-wrap;word-break:break-word}
.cover{display:flex;gap:18px;align-items:center;padding:24px 40px;background:var(--navy);color:#fff;border-bottom:4px solid #3a8ad2}.cover .subtitle,.cover .meta{color:#d4deec}
.brand{width:52px;height:52px;border-radius:4px;background:#3a8ad2;color:#fff;display:grid;place-items:center;font:800 18px ui-monospace,monospace}
h1{margin:0;font-size:24px;letter-spacing:-.01em}.subtitle{margin:2px 0 0;font-size:15px;color:var(--ink2)}.meta{margin:4px 0 0;color:var(--ink3);font-size:12.5px}
main{padding:24px 40px 40px;max-width:1280px}
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;margin-bottom:28px}
.tile{border:1px solid #bdbdbd;border-radius:0;padding:10px 14px}.tile .k{font-size:11.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--ink3)}.tile .v{font-size:16px;font-weight:600;margin-top:2px}
.tile .dim{font-size:12px;font-weight:400}
.toc{border:1px solid var(--line);border-radius:0;padding:6px 20px 14px;margin-bottom:28px;background:var(--alt)}
.toc h2{font-size:15px;border:0;margin:10px 0 4px;padding:0;background:none}.toc ol{margin:0;padding-left:20px;columns:2;column-gap:40px}.toc li{break-inside:avoid;margin:3px 0}
.toc ul{margin:2px 0 6px;padding-left:16px;font-size:12.5px}.toc a{color:var(--acc);text-decoration:none}.toc a:hover{text-decoration:underline}
h2{font-size:18px;margin:34px 0 12px;padding:7px 12px;background:#ebebeb;border:1px solid var(--line);font-weight:600}
section{margin:0 0 26px}h3{font-size:15px;margin:0 0 2px}.count{font-weight:400;color:var(--ink3);font-size:13px}
.src{margin:0 0 8px;font:11.5px ui-monospace,monospace;color:var(--ink3)}
h4{font-size:13.5px;margin:16px 0 6px}h5{font-size:12.5px;margin:12px 0 6px;color:var(--ink2)}
.tw{overflow-x:auto;border:1px solid var(--line)}
table.grid{border-collapse:collapse;width:100%;font-size:12.5px}table.grid th{background:#fafafa;color:var(--ink)!important;text-align:left;padding:7px 10px;border-bottom:1px solid var(--line);white-space:nowrap;font-weight:600;color:var(--ink2)}
table.grid td{padding:7px 10px;border-bottom:1px solid var(--line);vertical-align:top;max-width:340px;overflow-wrap:anywhere}table.grid tr:last-child td{border-bottom:0}
table.kv{border-collapse:collapse;width:100%;font-size:12.5px}table.kv th{text-align:left;font-weight:500;color:var(--ink2);width:240px;padding:5px 12px 5px 0;border-bottom:1px solid var(--line);vertical-align:top}
table.kv td{padding:5px 0;border-bottom:1px solid var(--line);overflow-wrap:anywhere}
.sub{margin-left:14px;padding-left:12px;border-left:2px solid var(--line)}
details.all{margin-top:8px}details.all>summary{cursor:pointer;color:var(--acc);font-size:12.5px;font-weight:600}
details.item{border:1px solid var(--line);border-radius:6px;margin:6px 0;padding:0 12px}details.item>summary{cursor:pointer;padding:7px 0;font-weight:600}
details.item[open]{padding-bottom:10px}
.dim{color:var(--ink3)}.pv-dim{color:var(--ink3)}b.w{color:var(--w)}b.b{color:var(--b)}
.pill{display:inline-block;font:600 10.5px Inter,system-ui,sans-serif;padding:1px 7px;border-radius:999px;border:1px solid currentColor;white-space:nowrap}
.pill.good{color:var(--g)}.pill.warn{color:var(--w)}.pill.bad{color:var(--b)}.pill.neutral{color:var(--ink2)}
.pv-yes{color:var(--g);font-weight:600}.pv-no{color:var(--ink3)}
.chip{display:inline-block;background:var(--alt);border:1px solid var(--line);border-radius:4px;padding:0 5px;font-size:11.5px;margin:1px 0}
code.uuid{background:var(--alt);padding:1px 4px;border-radius:4px}
.pv-pem pre{font-size:10.5px}
footer{padding:16px 40px;color:var(--ink3);font-size:12px;border-top:1px solid var(--line)}
@media print{
  body{font-size:11px}.cover{padding:0 0 12px}main{padding:12px 0;max-width:none}footer{padding:8px 0}
  .chapter{break-before:page}.toc{break-after:page}section{break-inside:auto}table.grid tr{break-inside:avoid}
  details>summary{list-style:none}details>summary::-webkit-details-marker{display:none}
  details.all,details.item{display:block}.tw{overflow:visible;border:0}
}
@media(max-width:700px){.cover,main,footer{padding-left:16px;padding-right:16px}.toc ol{columns:1}table.kv th{width:40%}}
`;

  // Expand all <details> before printing so the PDF contains everything
  const PRINT_SCRIPT = `<script>window.addEventListener('beforeprint',()=>document.querySelectorAll('details').forEach(d=>d.open=true));<\/script>`;

  return { CHAPTERS, OPTIONAL, planSections, run, buildReport: (r, m) => buildReport(r, m).replace('</body>', PRINT_SCRIPT + '</body>'), redact };
})();
