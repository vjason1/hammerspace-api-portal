/* Object directory: friendly name <-> UUID for everything on a cluster.
 * - Preloads the main object lists of the active cluster in the background (cached per cluster).
 * - OBJ.attach(input, spec) turns any input that needs an object ID into a searchable picker that
 *   shows name, type and UUID, fills the UUID (or name), and shows which object a typed value refers to.
 * - OBJ.translate() maps IDs picked on one cluster to the same-named object on another (multi-cluster pushes).
 * - The "Object IDs" portal page lists everything with copyable UUIDs. */
'use strict';

const OBJ = (() => {
  // endpoint, type label, objectType enum (as used by stats/filter APIs), warm = preload with the directory
  const SOURCES = [
    ['/cntl', 'Cluster', 'CLUSTER'], ['/sites', 'Site', 'SITE'], ['/nodes', 'Node', 'NODE'], ['/shares', 'Share', 'SHARE'],
    ['/storage-volumes', 'Storage volume', 'STORAGE_VOLUME'], ['/object-storage-volumes', 'Object storage volume', 'OBJECT_STORAGE_VOLUME'],
    ['/base-storage-volumes', 'Volume', 'BASE_STORAGE_VOLUME', false], ['/logical-volumes', 'Logical volume', 'LOGICAL_VOLUME'],
    ['/volume-groups', 'Volume group', 'VOLUME_GROUP'], ['/objectives', 'Objective', 'OBJECTIVE'], ['/data-portals', 'Data portal', 'DATA_PORTAL'],
    ['/network-interfaces', 'Network interface', 'NETWORK_IF'], ['/disk-drives', 'Disk drive', 'DISK_DRIVE'], ['/mdsis', 'MDSI', 'MDSI'],
    ['/share-participants', 'Share participant', 'SHARE_PARTICIPANT'], ['/share-snapshots', 'Snapshot schedule', 'SHARE_SNAPSHOT'],
    ['/schedules', 'Schedule', 'SCHEDULE'], ['/snapshot-retentions', 'Snapshot retention', 'SNAPSHOT_RETENTION'], ['/file-snapshots', 'File snapshot', 'FILE_SNAPSHOT'],
    ['/s3server', 'S3 server', 'S3_SERVER_CONFIG'], ['/smbautohomes', 'SMB auto-home', 'SMB_AUTOHOME'], ['/labels', 'Label', 'LABEL'],
    ['/users', 'User', 'USER'], ['/user-groups', 'User group', 'USER_GROUP'], ['/roles', 'Role', 'MANAGEMENT_ROLE'],
    ['/identity-group-mappings', 'Identity group mapping', 'IDENTITY_GROUP_MAPPING'], ['/login-policy', 'Login policy', 'LOGIN_POLICY'],
    ['/ad', 'Active Directory', 'SAMBA_AD'], ['/ldaps', 'LDAP', 'LDAP'], ['/nis', 'NIS', 'NIS'], ['/idp', 'Identity provider', 'IDP'],
    ['/name-services', 'Name service', 'NAME_SERVICE'], ['/domain-idmaps', 'Domain ID map', 'DOMAIN_IDMAP'],
    ['/dnss', 'DNS', 'DNS'], ['/ntps', 'NTP', 'NTP'], ['/gateways', 'Gateway', 'GATEWAY'], ['/static-routes', 'Static route', 'STATIC_ROUTE'],
    ['/subnet-gateways', 'Subnet gateway', 'SUBNET_GATEWAY'], ['/mail/smtp', 'SMTP', 'SMTP'], ['/snmp', 'SNMP', 'SNMP'], ['/syslog', 'Syslog', 'SYSLOG'],
    ['/notification-rules', 'Notification rule', 'NOTIFICATION_RULE'], ['/heartbeat', 'Heartbeat', 'HEARTBEAT'], ['/kmses', 'KMS', 'KMS'],
    ['/antivirus', 'Antivirus', 'ANTIVIRUS'], ['/pki-certificates', 'Certificate', 'CERTIFICATE'], ['/pki-managed-certificates', 'Managed certificate', 'MANAGED_CERTIFICATE'],
    ['/pki-certificate-authorities', 'Certificate authority', 'CA'], ['/nvmeof-enclosures', 'NVMe-oF enclosure', 'NVME_OF_ENCLOSURE'],
    ['/licenses', 'License', 'LICENSE_ACTIVATION'], ['/backup', 'Backup', 'BACKUP'], ['/sw-update', 'Software update', 'SW_UPDATE_TASK'],
    ['/versions/available', 'Software version', null, false], ['/tasks', 'Task', 'TASK', false], ['/events', 'Event', 'EVENT', false],
  ].map(([endpoint, type, objectType, warm = true]) => ({ endpoint, type, objectType, warm }));
  const SRC = new Map(SOURCES.map(s => [s.endpoint, s]));
  const TTL = 5 * 60e3;
  const lists = new Map();   // `${cluster}|${endpoint}` -> { at, promise, items, error }
  const listeners = new Set();
  const isUuid = v => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));
  const available = () => SOURCES.filter(s => SPEC?.paths?.[s.endpoint]?.get);

  // ---------- normalising list items
  function friendly(it, src) {
    const n = it.name ?? it.displayName ?? it.domainName ?? it.domain ?? it.username ?? it.activationId ?? it.fullVersion ?? it.host ?? it.title;
    if (n != null && n !== '') return String(n);
    if (src.endpoint === '/share-snapshots') return [it.share?.name, it.schedule?.name].filter(Boolean).join(' · ') || null;
    if (src.endpoint === '/share-participants') return [it.shareName, it.name].filter(Boolean).join(' @ ') || null;
    if (it.path) return it.path;
    if (it.ipAddress?.address) return it.ipAddress.address;
    if (it.address) return typeof it.address === 'object' ? it.address.address : it.address;
    if (it.nodeName) return it.nodeName;
    if (Array.isArray(it.servers) && it.servers.length) return it.servers.map(s => s.address || s.server || s).join(', ');
    return null;
  }
  function details(it, src) {
    const parts = [];
    if (it.path && it.name && it.path !== it.name) parts.push(it.path);
    for (const k of ['nodeType', 'productNodeType', 'dataPortalType', 'licenseType', 'shareState', 'state', 'operState', 'nodeState', 'status', 'type', 'objectiveType'])
      if (it[k] != null && typeof it[k] !== 'object') { parts.push(String(it[k])); break; }
    if (it.node?.name && src.endpoint !== '/nodes') parts.push(`on ${it.node.name}`);
    if (it.managementRole?.name) parts.push(it.managementRole.name);
    return parts.join(' · ');
  }
  function normalise(data, src) {
    const arr = Array.isArray(data) ? data : data && typeof data === 'object' ? [data] : [];
    return arr.filter(x => x && typeof x === 'object').map((raw, i) => {
      const uuid = raw.uoid?.uuid ?? (isUuid(raw.uuid) ? raw.uuid : null) ?? (isUuid(raw.id) ? raw.id : null);
      const name = friendly(raw, src);
      return { endpoint: src.endpoint, type: src.type, objectType: raw.uoid?.objectType || src.objectType, uuid, name: name ?? (uuid ? `${src.type} ${uuid.slice(0, 8)}` : `${src.type} #${i + 1}`),
        named: name != null, internalId: raw.internalId ?? null, sub: details(raw, src), raw };
    });
  }

  // ---------- loading (per cluster, cached)
  async function fetchList(endpoint, cid) {
    const r = await fetch(HS(endpoint, cid), { headers: { Accept: 'application/json' } });
    if (r.status === 401 && (await r.clone().text()).includes('PORTAL_AUTH')) throw new Error('Not signed in');
    if (!r.ok) throw new Error(r.status === 404 ? 'not available on this version' : `HTTP ${r.status}`);
    return r.json();
  }
  function list(endpoint, cid = ACTIVE, force) {
    if (!cid) return Promise.resolve([]);
    const key = `${cid}|${endpoint}`;
    const hit = lists.get(key);
    if (hit && !force && Date.now() - hit.at < TTL) return hit.promise;
    const src = SRC.get(endpoint) || { endpoint, type: Pretty.label(endpoint.split('/').filter(Boolean).pop() || 'item').replace(/s$/, ''), objectType: null };
    const entry = { at: Date.now(), items: null, error: null };
    entry.promise = fetchList(endpoint, cid).then(d => (entry.items = normalise(d, src)), e => { entry.error = e.message; entry.items = []; return []; })
      .finally(() => listeners.forEach(f => f(cid)));
    lists.set(key, entry);
    return entry.promise;
  }
  // Preload the whole directory (4 requests at a time)
  function warm(cid = ACTIVE, force) {
    if (!cid) return Promise.resolve([]);
    const prof = VERSIONS.forCluster(CLUSTERS.find(c => c.id === cid));
    const srcs = available().filter(s => s.warm && VERSIONS.opAvailable(prof, 'get', s.endpoint));
    let i = 0;
    return Promise.all(Array.from({ length: 4 }, async () => { while (i < srcs.length) await list(srcs[i++].endpoint, cid, force); }))
      .then(() => items(cid));
  }
  // Everything loaded so far for a cluster
  function items(cid = ACTIVE) {
    const out = [];
    for (const [k, v] of lists) if (k.startsWith(cid + '|') && v.items) out.push(...v.items);
    return out;
  }
  function status(cid = ACTIVE) {
    let loaded = 0, pending = 0, failed = []; let at = 0;
    for (const [k, v] of lists) if (k.startsWith(cid + '|')) { if (v.items) { loaded++; at = Math.max(at, v.at); } else pending++; if (v.error && !/not available/.test(v.error)) failed.push(`${k.split('|')[1]} (${v.error})`); }
    return { loaded, pending, failed, at };
  }
  const byUuid = (uuid, cid = ACTIVE) => uuid ? items(cid).find(x => x.uuid && x.uuid.toLowerCase() === String(uuid).toLowerCase()) : null;
  const nameOf = (uuid, cid) => byUuid(uuid, cid);

  // ---------- picker
  const FILL_KEY = 'hs.idFill';
  const fillPref = () => store.get(FILL_KEY, 'uuid');
  function valueFor(item, spec) {
    const f = spec.fill === 'ask' ? fillPref() : spec.fill || 'uuid';
    if (f.startsWith('field:')) return item.raw[f.slice(6)] ?? item.name;
    if (f === 'name') return item.named ? item.name : (item.uuid || item.name);
    return item.uuid || (item.named ? item.name : '');
  }
  function match(item, v) {
    if (!v) return false;
    const s = String(v).toLowerCase();
    return (item.uuid && item.uuid.toLowerCase() === s) || item.name.toLowerCase() === s || (item.internalId != null && String(item.internalId) === s)
      || ['activationId', 'username', 'participantId'].some(k => item.raw[k] != null && String(item.raw[k]).toLowerCase() === s);
  }
  async function sourceItems(spec, form) {
    if (spec.sources) return (await Promise.all(spec.sources.map(e => list(e)))).flat();
    await warm();
    let all = items();
    // when a sibling object-type field is set, only offer that type
    const t = spec.pair && form?.querySelector(`[data-p="${spec.pair}"]`)?.value;
    if (t) all = all.filter(x => x.objectType === t);
    return all;
  }

  let openPicker = null;
  document.addEventListener('mousedown', e => { if (openPicker && !e.composedPath().includes(openPicker)) openPicker.close(); });

  function attach(input, spec) {
    const wrap = document.createElement('div'); wrap.className = 'idp';
    if (input.parentNode) input.parentNode.insertBefore(wrap, input);
    const row = document.createElement('div'); row.className = 'idp-row';
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn idp-btn'; btn.title = 'Browse objects on this cluster';
    btn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="m15.5 15.5 5 5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg> Browse';
    row.append(input, btn);
    const res = document.createElement('div'); res.className = 'idp-res';
    const panel = document.createElement('div'); panel.className = 'idp-panel'; panel.hidden = true;
    wrap.append(row, res, panel);
    wrap.close = () => { panel.hidden = true; if (openPicker === wrap) openPicker = null; };
    input.setAttribute('autocomplete', 'off');
    input.dataset.idpick = '1';
    const form = () => wrap.closest('form');
    let all = [], active = -1, shown = [];

    const tokens = () => spec.multi ? input.value.split(',').map(x => x.trim()).filter(Boolean) : [input.value.trim()].filter(Boolean);
    const describe = () => {
      const vs = tokens();
      if (!vs.length) { res.innerHTML = ''; res.className = 'idp-res'; return; }
      const hits = vs.map(v => all.find(x => match(x, v)));
      if (hits.every(Boolean)) {
        res.className = 'idp-res ok';
        res.innerHTML = hits.map(hit => `<span class="idp-hit"><span class="idp-ok">✓</span> <b>${esc(hit.name)}</b> <span class="idp-type">${esc(hit.type)}</span>${hit.sub && !spec.multi ? ` <span class="pv-dim">${esc(hit.sub)}</span>` : ''}${hit.uuid && !spec.multi ? ` <code class="uuid" data-copy="${esc(hit.uuid)}" title="Copy UUID">${esc(hit.uuid)}</code>` : ''}</span>`).join('');
      } else {
        res.className = 'idp-res';
        const unknown = vs.filter((v, i) => !hits[i]);
        res.innerHTML = all.length ? `<span class="pv-dim">${unknown.length > 1 ? `${unknown.length} values aren’t` : `“${esc(unknown[0])}” isn’t`} one of the ${all.length} objects loaded from ${esc(clusterLabel(activeCluster()))} — sent as typed.</span>` : '';
      }
    };
    const choose = it => {
      const v = valueFor(it, spec);
      input.value = spec.multi ? [...tokens().filter(t => t !== v), v].join(', ') : v;
      if (spec.pair) { const sib = form()?.querySelector(`[data-p="${spec.pair}"]`); if (sib && it.objectType && [...(sib.options || [])].some(o => o.value === it.objectType)) { sib.value = it.objectType; sib.dispatchEvent(new Event('change', { bubbles: true })); } }
      input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
      if (spec.multi) { draw(); describe(); return; }   // lists: keep the panel open to add more
      wrap.close(); describe();
    };
    const draw = () => {
      const q = (panel.querySelector('.idp-q')?.value || '').trim().toLowerCase();
      const terms = q.split(/\s+/).filter(Boolean);
      shown = all.filter(x => terms.every(t => `${x.name} ${x.type} ${x.sub} ${x.uuid || ''} ${x.internalId ?? ''}`.toLowerCase().includes(t))).slice(0, 300);
      const types = new Set(all.map(x => x.type));
      const st = status();
      panel.querySelector('.idp-list').innerHTML = shown.length ? shown.map((x, i) => `<li data-i="${i}" class="${i === active ? 'on' : ''}">
          <span class="idp-n">${esc(x.name)}${types.size > 1 ? ` <span class="idp-type">${esc(x.type)}</span>` : ''}</span>
          <span class="idp-s">${esc(x.sub || '')}</span><code class="idp-u">${esc(x.uuid || (x.internalId != null ? 'id ' + x.internalId : '—'))}</code></li>`).join('')
        : `<li class="idp-empty">${st.pending ? 'Loading objects…' : all.length ? 'No match.' : `Nothing found on ${esc(clusterLabel(activeCluster()) || 'this cluster')}.`}</li>`;
      panel.querySelector('.idp-foot-n').textContent = `${shown.length < all.length ? `${shown.length} of ` : ''}${all.length} object${all.length === 1 ? '' : 's'}${st.pending ? ' · loading…' : ''}`;
    };
    const open = async () => {
      if (openPicker && openPicker !== wrap) openPicker.close();
      openPicker = wrap; active = -1;
      panel.hidden = false;
      panel.innerHTML = `<input class="idp-q" type="search" placeholder="Filter by name, type or UUID…"><ul class="idp-list"><li class="idp-empty">Loading objects…</li></ul>
        <div class="idp-foot"><span class="idp-foot-n"></span><span class="sp"></span>
          ${spec.fill === 'ask' ? `<span class="idp-fill">Insert <label><input type="radio" name="fill${input.id}" value="uuid" ${fillPref() === 'uuid' ? 'checked' : ''}> UUID</label><label><input type="radio" name="fill${input.id}" value="name" ${fillPref() === 'name' ? 'checked' : ''}> name</label></span>` : `<span class="pv-dim">inserts the ${spec.fill === 'name' ? 'name' : spec.fill?.startsWith('field:') ? Pretty.label(spec.fill.slice(6)) : 'UUID'}</span>`}
          <button type="button" class="btn small ghost idp-reload">Reload</button></div>`;
      const q = panel.querySelector('.idp-q');
      q.addEventListener('input', () => { active = -1; draw(); });
      q.addEventListener('keydown', e => {
        if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, shown.length - 1); draw(); panel.querySelector('li.on')?.scrollIntoView({ block: 'nearest' }); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); draw(); panel.querySelector('li.on')?.scrollIntoView({ block: 'nearest' }); }
        else if (e.key === 'Enter') { e.preventDefault(); const it = shown[active < 0 ? 0 : active]; if (it) choose(it); }
        else if (e.key === 'Escape') { wrap.close(); input.focus(); }
      });
      panel.querySelector('.idp-list').addEventListener('mousedown', e => { const li = e.target.closest('li[data-i]'); if (li) { e.preventDefault(); choose(shown[+li.dataset.i]); } });
      panel.querySelectorAll('.idp-fill input').forEach(r => r.addEventListener('change', () => store.set(FILL_KEY, r.value)));
      panel.querySelector('.idp-reload').addEventListener('click', async () => {
        lists.forEach((v, k) => { if (k.startsWith(ACTIVE + '|') && (!spec.sources || spec.sources.includes(k.split('|')[1]))) lists.delete(k); });
        all = []; draw(); all = await sourceItems(spec, form()); draw(); describe();
      });
      q.focus();
      draw();
      const progress = () => { all = spec.sources ? all : items().filter(x => !spec.pair || !form()?.querySelector(`[data-p="${spec.pair}"]`)?.value || x.objectType === form().querySelector(`[data-p="${spec.pair}"]`).value); if (!panel.hidden) draw(); };
      if (!spec.sources) listeners.add(progress);
      all = await sourceItems(spec, form());
      listeners.delete(progress);
      if (!panel.hidden) draw();
    };
    btn.addEventListener('click', () => panel.hidden ? open() : wrap.close());
    input.addEventListener('keydown', e => { if (e.key === 'ArrowDown' && e.altKey) { e.preventDefault(); open(); } });
    input.addEventListener('input', describe);
    input.addEventListener('change', describe);
    wrap.refresh = describe;
    // load in the background so the name shows as soon as possible
    sourceItems(spec, form()).then(items => {
      all = items; describe();
      if (!input.placeholder) input.placeholder = items.length ? `Browse or type — ${items.length} ${items.length === 1 ? items[0].type.toLowerCase() : 'objects'} on this cluster` : 'Type a name or UUID';
    });
    return wrap;
  }

  // ---------- multi-cluster: find the same object (by name) on another cluster
  async function translate(value, spec, fromCid, toCid) {
    if (!value || fromCid === toCid) return { value };
    if (spec.multi && value.includes(',')) {
      const parts = await Promise.all(value.split(',').map(v => v.trim()).filter(Boolean).map(v => translate(v, { ...spec, multi: false }, fromCid, toCid)));
      const bad = parts.find(x => x.error); if (bad) return bad;
      return { value: parts.map(x => x.value).join(', '), from: parts.filter(x => x.from).map(x => x.from).join(', ') };
    }
    const srcs = spec.sources || available().filter(s => s.warm).map(s => s.endpoint);
    await Promise.all(srcs.map(e => list(e, fromCid)));
    const from = srcs.flatMap(e => lists.get(`${fromCid}|${e}`)?.items || []);
    const hit = from.find(x => x.uuid && x.uuid.toLowerCase() === value.toLowerCase()) || (spec.fill?.startsWith('field:') ? null : from.find(x => x.internalId != null && String(x.internalId) === value));
    if (!hit) return { value };          // a name (or unknown value): send as typed
    if (!hit.named) return { error: `${hit.type} ${value} has no name to match on the other cluster` };
    const there = await list(hit.endpoint, toCid);
    const twin = there.find(x => x.named && x.name === hit.name);
    if (!twin) return { error: `No ${hit.type.toLowerCase()} named “${hit.name}” on this cluster` };
    const f = spec.fill === 'ask' ? fillPref() : spec.fill || 'uuid';
    return { value: f === 'name' ? twin.name : (twin.uuid || twin.name), from: hit.name };
  }

  function clear(cid) { for (const k of [...lists.keys()]) if (!cid || k.startsWith(cid + '|')) lists.delete(k); }
  const onChange = f => { listeners.add(f); return () => listeners.delete(f); };

  return { SOURCES, list, warm, items, status, byUuid, nameOf, attach, translate, clear, onChange, isUuid };
})();

// ---------------------------------------------------------------- Object IDs page (Portal tab)
async function renderObjects() {
  CURRENT = null; renderList(); renderSwitcher();
  const c = activeCluster();
  $('#main').innerHTML = `
    <div class="op-head"><div class="sum">Every object on <b>${esc(clusterLabel(c) || 'the active cluster')}</b> with its friendly name and UUID — use it to look up an ID, or click a UUID to copy it. Forms use the same list: any field that needs an object ID has a <b>Browse</b> button.</div></div>
    <div class="panel"><div class="panel-h">Objects<span class="panel-n" id="obN"></span><span class="sp"></span>
      <select id="obType" style="width:auto;padding:3px 6px"><option value="">All types</option></select>
      <input id="obQ" type="search" placeholder="Filter by name, type, UUID…" style="max-width:260px;padding:3px 8px">
      <button type="button" class="tbtn" id="obCsv">Export CSV</button><button type="button" class="tbtn" id="obReload">Reload</button></div>
      <div id="obBody"><p class="pv-dim" style="padding:12px">${c ? 'Loading…' : 'No cluster selected — <a href="#clusters">add one</a>.'}</p></div></div>`;
  portalHead('objects');
  if (!c) return;
  const cid = ACTIVE;
  const draw = () => {
    if (location.hash !== '#objects' || ACTIVE !== cid) return;
    const all = OBJ.items(cid).sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
    const sel = $('#obType'), cur = sel.value;
    const types = [...new Set(all.map(x => x.type))].sort();
    sel.innerHTML = `<option value="">All types (${types.length})</option>` + types.map(t => `<option ${t === cur ? 'selected' : ''}>${esc(t)}</option>`).join('');
    const terms = $('#obQ').value.toLowerCase().split(/\s+/).filter(Boolean);
    const rows = all.filter(x => (!sel.value || x.type === sel.value) && terms.every(t => `${x.name} ${x.type} ${x.sub} ${x.uuid || ''}`.toLowerCase().includes(t)));
    const st = OBJ.status(cid);
    $('#obN').textContent = `${rows.length}${rows.length < all.length ? ` of ${all.length}` : ''} · ${st.loaded} lists${st.pending ? ` · ${st.pending} loading…` : ''}${st.at ? ` · read ${new Date(st.at).toLocaleTimeString()}` : ''}`;
    $('#obBody').innerHTML = rows.length ? `<table class="gt"><thead><tr><th>Name</th><th>Type</th><th>UUID</th><th>Details</th><th style="width:70px">Internal ID</th></tr></thead><tbody>${rows.slice(0, 2000).map(x => `
      <tr><td><b>${esc(x.name)}</b></td><td>${esc(x.type)} ${x.objectType ? `<code class="gt-tag">${esc(x.objectType)}</code>` : ''}</td>
        <td>${x.uuid ? `<code class="uuid" data-copy="${esc(x.uuid)}" title="Click to copy">${esc(x.uuid)}</code>` : '<span class="pv-dim">—</span>'}</td>
        <td class="pv-dim">${esc(x.sub)}</td><td>${x.internalId ?? ''}</td></tr>`).join('')}</tbody></table>`
      : `<p class="gt-empty">${st.pending ? 'Loading…' : 'No objects match.'}</p>`;
    if (st.failed.length) $('#obBody').insertAdjacentHTML('beforeend', `<p class="pv-dim" style="padding:8px 12px">Couldn’t read: ${esc(st.failed.join(', '))}</p>`);
  };
  $('#obQ').addEventListener('input', draw); $('#obType').addEventListener('change', draw);
  $('#obReload').addEventListener('click', () => { OBJ.clear(cid); OBJ.warm(cid).then(draw); draw(); });
  $('#obCsv').addEventListener('click', () => {
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = ['type,objectType,name,uuid,internalId,details', ...OBJ.items(cid).map(x => [x.type, x.objectType, x.name, x.uuid, x.internalId, x.sub].map(q).join(','))].join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `object-ids_${(activeCluster()?.clusterName || clusterLabel(activeCluster())).replace(/\W+/g, '-')}.csv`; a.click();
  });
  let t = 0; const throttled = () => { clearTimeout(t); t = setTimeout(draw, 150); };
  if (window.__obOff) window.__obOff();
  window.__obOff = OBJ.onChange(throttled);
  OBJ.warm(cid).then(draw); draw();
}
