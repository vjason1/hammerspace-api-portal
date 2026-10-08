/* Hammerspace API Portal — generates a request console for every operation in swagger.json */
'use strict';

const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

let SPEC, CONFIG, OPS = [], CURRENT = null;
const METHODS = ['get', 'post', 'put', 'delete', 'patch'];
const activeMethods = new Set(METHODS);

// ---------------------------------------------------------------- clusters (registry lives on the server)
let CLUSTERS = [];
let ACTIVE = store.get('hs.active', null);
const HS = (p, id = ACTIVE) => `c/${id}/hs${p}`;
const activeCluster = () => CLUSTERS.find(c => c.id === ACTIVE) || null;
const clusterLabel = c => c ? (c.name || c.clusterName || c.url) : '';

// JSON helper for portal endpoints; bounces to sign-in when the portal session ends
async function portal(method, path, body) {
  const r = await fetch(`portal/${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-Portal': '1' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && j.code === 'PORTAL_AUTH') { showLogin('Your portal session ended — sign in again.'); throw new Error('Not signed in'); }
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}
async function loadClusters() {
  CLUSTERS = await portal('GET', 'clusters');
  if (!CLUSTERS.some(c => c.id === ACTIVE)) setActive(CLUSTERS[0]?.id || null, true);
  renderSwitcher();
}
function setActive(id, quiet) {
  ACTIVE = id; store.set('hs.active', id);
  Forms.init(SPEC, async ep => { if (!ACTIVE) return []; const r = await fetch(HS(ep), { headers: { Accept: 'application/json' } }); if (!r.ok) return []; const j = await r.json(); return Array.isArray(j) ? j : []; });
  renderSwitcher();
  if (ACTIVE && CONFIG?.user) setTimeout(() => OBJ.warm(ACTIVE), 400);   // preload object names/UUIDs
  if (quiet) return;
  if (CURRENT) renderOp(CURRENT);
  else if (/^#?(sec=|tab=|$)/.test(location.hash)) routeFromHash();
}

// ---------------------------------------------------------------- boot
(async function boot() {
  [SPEC, CONFIG] = await Promise.all([
    fetch('swagger.json').then(r => r.json()),
    fetch('portal/config').then(r => r.json()),
  ]);
  buildOps();
  if (CONFIG.needsSetup) showLogin(null, true);
  else if (CONFIG.user) showApp(); else showLogin();
})();

function buildOps() {
  OPS = [];
  for (const [path, item] of Object.entries(SPEC.paths)) {
    for (const method of METHODS) {
      const op = item[method];
      if (!op) continue;
      OPS.push({
        id: `${method}:${path}`, method, path, op,
        tag: (op.tags && op.tags[0]) || 'other',
        nav: NAV.classify(method, path),
        params: [...(item.parameters || []), ...(op.parameters || [])],
        search: `${method} ${path} ${NAV.classify(method, path).section === 'hidden' ? 'hidden cli' : 'gui'} ${op.summary || ''} ${op.description || ''} ${(op.tags || []).join(' ')} ${op.operationId || ''}`.toLowerCase(),
      });
    }
  }
}

// ---------------------------------------------------------------- portal sign-in / first-run setup
let SETUP = false;
function showLogin(msg, setup = false) {
  SETUP = setup;
  $('#app').hidden = true; $('#login').hidden = false;
  $('#lgTitle').textContent = setup ? 'Create the portal admin' : 'Sign in';
  $('#lgIntro').textContent = setup
    ? 'First start: choose the master account for this portal. You’ll add your Hammerspace clusters after signing in.'
    : 'Sign in with your portal account. Cluster credentials are stored on the portal.';
  $('#lgConfirmRow').hidden = !setup;
  $('#lgSubmit').textContent = setup ? 'Create account & continue' : 'Sign in';
  $('#lgPass').autocomplete = setup ? 'new-password' : 'current-password';
  $('#lgUser').value = store.get('hs.user', 'admin');
  $('#lgErr').textContent = msg || '';
  ($('#lgUser').value ? $('#lgPass') : $('#lgUser')).focus();
}

$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('#lgSubmit'); btn.disabled = true; $('#lgErr').textContent = '';
  const body = { username: $('#lgUser').value.trim(), password: $('#lgPass').value };
  try {
    if (SETUP && body.password !== $('#lgPass2').value) throw new Error('The passwords don’t match.');
    const r = await fetch(SETUP ? 'portal/setup' : 'portal/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    store.set('hs.user', body.username);
    CONFIG.user = j.user; CONFIG.needsSetup = false;
    $('#lgPass').value = ''; $('#lgPass2').value = '';
    showApp();
  } catch (err) { $('#lgErr').textContent = err.message; }
  finally { btn.disabled = false; }
});

$('#btnLogout').addEventListener('click', async () => {
  await fetch('portal/logout', { method: 'POST' });
  CONFIG.user = null; showLogin();
});

// ---------------------------------------------------------------- shell
async function showApp() {
  $('#login').hidden = true; $('#app').hidden = false;
  $('#whoami').textContent = CONFIG.user.username;
  setActive(ACTIVE, true);
  try { await loadClusters(); } catch {}
  renderMethodFilter(); renderRail(); renderList();
  if (!CLUSTERS.length && !location.hash.startsWith('#clusters')) location.hash = 'clusters';
  else routeFromHash();
}

function renderMethodFilter() {
  $('#methodFilter').innerHTML = METHODS.filter(m => OPS.some(o => o.method === m))
    .map(m => `<button type="button" data-m="${m}" aria-pressed="${activeMethods.has(m)}">${m.toUpperCase()}</button>`).join('');
}
$('#methodFilter').addEventListener('click', e => {
  const m = e.target.dataset.m; if (!m) return;
  activeMethods.has(m) ? activeMethods.delete(m) : activeMethods.add(m);
  e.target.setAttribute('aria-pressed', activeMethods.has(m)); renderList();
});
$('#search').addEventListener('input', () => renderList());
document.addEventListener('keydown', e => {
  if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); $('#search').focus(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && CURRENT) { e.preventDefault(); $('#btnSend')?.click(); }
});

window.addEventListener('hashchange', routeFromHash);
function routeFromHash() {
  const h = decodeURIComponent(location.hash.slice(1));
  if (h === 'extract') { renderExtract(); return; }
  if (h === 'clusters') { renderClusters(); return; }
  if (h === 'users') { renderUsers(); return; }
  if (h === 'audit') { renderAudit(); return; }
  if (h === 'objects') { renderObjects(); return; }
  if (h.startsWith('sec=')) { renderSection(h.slice(4)); return; }
  if (h.startsWith('tab=')) { const i = h.indexOf('/'); renderTabPage(h.slice(4, i), h.slice(i + 1)); return; }
  const m = h.match(/^op=(.+)$/);
  const op = m && OPS.find(o => o.id === m[1]);
  if (!op) { renderDashboard(); return; }
  CURRENT = op; renderList(); renderRail();
  if (!ACTIVE) { location.hash = 'clusters'; return; }
  renderOp(op); $('.op.active')?.scrollIntoView({ block: 'nearest' });
}

// ---------------------------------------------------------------- schema helpers
function deref(schema, seen = new Set()) {
  if (!schema) return schema;
  if (schema.$ref) {
    const name = schema.$ref.split('/').pop();
    if (seen.has(name)) return { type: 'object', 'x-cycle': name };
    return deref({ ...SPEC.definitions[name], 'x-name': name }, new Set([...seen, name]));
  }
  if (schema.allOf) {
    const merged = { type: 'object', properties: {}, 'x-name': schema['x-name'] };
    const inline = schema.allOf.filter(p => !p.$ref);
    for (const part of (inline.length ? inline : schema.allOf)) {
      const d = deref(part, seen);
      Object.assign(merged.properties, d.properties || {});
    }
    return merged;
  }
  return schema;
}
function refName(schema) { return schema && schema.$ref ? schema.$ref.split('/').pop() : null; }

function typeLabel(s) {
  if (!s) return 'any';
  if (s.$ref) return refName(s);
  if (s.type === 'array') return `${typeLabel(s.items)}[]`;
  if (s.additionalProperties) return `map<string, ${typeLabel(s.additionalProperties)}>`;
  return s.format ? `${s.type}(${s.format})` : (s.type || 'object');
}

// Skeleton JSON for a request body. depth limits nested objects so huge views stay usable.
function example(schema, depth, seen = new Set()) {
  if (!schema) return null;
  const name = refName(schema);
  if (name) {
    if (seen.has(name) || depth < 0) return name === 'UoidView' ? { uuid: '' } : {};
    seen = new Set([...seen, name]);
  }
  const s = deref(schema);
  if (s.enum) return s.enum[0];
  switch (s.type) {
    case 'string': return '';
    case 'integer': case 'number': return 0;
    case 'boolean': return false;
    case 'array': return depth > 0 ? [example(s.items, depth - 1, seen)].filter(v => v !== null && !(typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length)) : [];
  }
  if (s.additionalProperties && !s.properties) return {};
  if (!s.properties) return {};
  const out = {};
  for (const [k, v] of Object.entries(s.properties)) {
    if (v.readOnly) continue;
    if (BOILERPLATE.has(k)) continue;
    out[k] = example(v, depth - 1, seen);
  }
  return out;
}
const BOILERPLATE = new Set(['created', 'modified', 'unclearedEvents', 'errors', 'modificationCount', 'objectType']);

function schemaTree(schema, depth = 0, seen = new Set()) {
  const name = refName(schema);
  if (name && seen.has(name)) return `<span class="e">↻ ${esc(name)}</span>`;
  if (name) seen = new Set([...seen, name]);
  let s = deref(schema);
  if (s && s.type === 'array') return `<span class="t">array of</span> ${schemaTree(s.items, depth, seen)}`;
  if (!s || !s.properties) return `<span class="t">${esc(typeLabel(s))}</span>`;
  const rows = Object.entries(s.properties).map(([k, v]) => {
    const inner = deref(v.type === 'array' ? v.items : v);
    const nested = inner && inner.properties && depth < 6;
    const meta = `<span class="t">${esc(typeLabel(v))}</span>${v.readOnly ? ' <span class="ro">read-only</span>' : ''}${
      (v.enum || (v.items && v.items.enum)) ? ` <span class="e">${esc((v.enum || v.items.enum).join(' | '))}</span>` : ''}`;
    return nested
      ? `<details><summary><span class="f">${esc(k)}</span>: ${meta}</summary>${schemaTree(v.type === 'array' ? v.items : v, depth + 1, seen)}</details>`
      : `<div style="margin-left:14px"><span class="f">${esc(k)}</span>: ${meta}</div>`;
  });
  return `<div>${rows.join('')}</div>`;
}

// ---------------------------------------------------------------- operation view
const DANGER = /shutdown|bypassDecommission|decommission|restore|worm|clear|delete|reset|replace|cancel/i;
const PAGING = new Set(['spec', 'page', 'page.size', 'page.sort', 'page.sort.dir']);
let FORM = null, BODYMODE = 'form';

// The spec types many PUT/POST bodies as the generic BaseEntityView; the real shape is the response type.
function effectiveBodySchema(o, bodyP) {
  if (!bodyP) return null;
  const s = bodyP.schema || {};
  if (refName(s) === 'BaseEntityView') {
    const resp = Object.values(o.op.responses || {}).find(r => r.schema && refName(r.schema));
    if (resp) return resp.schema;
  }
  return s;
}

// What a parameter that names an object should offer: which lists to browse and what to insert.
// fill: 'uuid' | 'name' | 'ask' (user chooses UUID or name; identifier params accept either) | 'field:<key>'
// pair: sibling parameter holding the object type (objectType/objectUuid style pairs)
const ID_PARAMS = {
  share: { sources: ['/shares'], fill: 'name' }, 'share-identifier': { sources: ['/shares'], fill: 'ask' }, shareUuid: { sources: ['/shares'], fill: 'uuid' },
  node: { sources: ['/nodes'], fill: 'name' }, nodeName: { sources: ['/nodes'], fill: 'name' }, 'node-identifier': { sources: ['/nodes'], fill: 'ask' },
  site: { sources: ['/sites'], fill: 'name' }, 'site-identifier': { sources: ['/sites'], fill: 'ask' }, 'site-id': { sources: ['/sites'], fill: 'uuid' },
  'site-name': { sources: ['/sites'], fill: 'name' }, 'site-internal-id': { sources: ['/sites'], fill: 'field:internalId' },
  'objective-identifier': { sources: ['/objectives'], fill: 'ask' }, 'activation-id': { sources: ['/licenses'], fill: 'field:activationId' },
  activationid: { sources: ['/licenses'], fill: 'field:activationId' },
  sv: { sources: ['/storage-volumes'], fill: 'ask' }, from: { sources: ['/base-storage-volumes'], fill: 'ask' }, to: { sources: ['/base-storage-volumes'], fill: 'ask' },
  volumeGroupId: { sources: ['/volume-groups'], fill: 'ask' }, volumeUuid: { sources: ['/storage-volumes', '/object-storage-volumes'], fill: 'uuid' },
  username: { sources: ['/users'], fill: 'name' }, userName: { sources: ['/users'], fill: 'name' }, 'user-identifier': { sources: ['/users'], fill: 'ask' },
  groupname: { sources: ['/user-groups'], fill: 'name' }, 'group-identifier': { sources: ['/user-groups'], fill: 'ask' }, 'user-groups-identifier': { sources: ['/user-groups'], fill: 'ask' },
  version: { sources: ['/versions/available'], fill: 'field:fullVersion' }, 'cluster-uuid': { sources: ['/cntl'], fill: 'uuid' },
  taskId: { sources: ['/tasks'], fill: 'uuid' }, participantId: { sources: ['/share-participants'], fill: 'field:participantId' },
  objectUuid: { fill: 'uuid', pair: 'objectType' }, filterUuid: { fill: 'uuid', pair: 'filterObjectType' },
  fromStorageContainerUuid: { fill: 'uuid', pair: 'fromStorageContainerType' }, toStorageContainerUuid: { fill: 'uuid', pair: 'toStorageContainerType' },
  storageContainerUuid: { fill: 'uuid', pair: 'storageContainerType' },
};
function pickerFor(o, p) {
  if (ID_PARAMS[p.name]) return ID_PARAMS[p.name];
  if (META.PARAM_PICKERS[p.name]) return { sources: [META.PARAM_PICKERS[p.name]], fill: 'ask' };
  if (/^(identifier|uuid|id)$/.test(p.name) || (p.in === 'path' && /identifier|uuid/.test(p.name))) {
    // the list endpoint in front of the parameter, e.g. /shares/{identifier} -> /shares
    const before = o.path.split(`{${p.name}}`)[0].replace(/\/$/, '');
    const parts = before.split('/').filter(Boolean);
    while (parts.length) {
      const cand = '/' + parts.join('/');
      if (OPS.some(x => x.method === 'get' && x.path === cand)) return { sources: [cand], fill: /uuid/i.test(p.name) ? 'uuid' : 'ask' };
      parts.pop();
    }
    return /uuid/i.test(p.name) ? { fill: 'uuid' } : null;   // unknown list: browse every object
  }
  if (/uuid$/i.test(p.name)) return { fill: 'uuid' };
  return null;
}

function paramRow(o, p) {
  const t = p.type === 'array' ? 'list' : p.type === 'boolean' ? 'yes/no' : (p.type === 'integer' || p.type === 'number') ? 'number' : p.enum ? 'choice' : 'text';
  const enumVals = p.enum || p.items?.enum;
  const id = `p_${p.in}_${p.name.replace(/\W/g, '_')}`;
  let input;
  if (enumVals && p.type !== 'array') {
    input = `<select id="${id}" data-p="${esc(p.name)}" data-in="${p.in}"><option value="">— not set —</option>${enumVals.map(v => `<option value="${esc(v)}">${esc(v.replace(/_/g, ' '))}</option>`).join('')}</select>`;
  } else if (p.type === 'boolean') {
    input = `<select id="${id}" data-p="${esc(p.name)}" data-in="${p.in}"><option value="">— not set —</option><option value="true">Yes</option><option value="false">No</option></select>`;
  } else {
    const ph = p.type === 'array' ? (enumVals ? enumVals.slice(0, 3).join(', ') : 'value1, value2') : p.name === 'spec' ? 'name=like=proj*' : '';
    const typ = /password/i.test(p.name) ? 'password' : (p.type === 'integer' || p.type === 'number') ? 'number' : 'text';
    let pick = pickerFor(o, p);
    if (pick && p.type === 'array') pick = { ...pick, multi: true };
    input = `<input id="${id}" type="${typ}" data-p="${esc(p.name)}" data-in="${p.in}" placeholder="${esc(ph)}" ${pick ? `data-pick="${esc(JSON.stringify(pick))}"` : ''} autocomplete="off" ${p.required ? 'required' : ''}>`;
  }
  const desc = [p.description || META.PARAM_DOCS[p.name] || '', enumVals && p.type === 'array' ? `Allowed: ${enumVals.join(', ')}` : ''].filter(Boolean).join('\n');
  return `<div class="f-row"><label class="f-label" for="${id}">${esc(Pretty.label(p.name))}${p.required ? '<span class="req"> *</span>' : ''}<span class="f-key">${esc(p.name)} · ${t}</span></label>
    <div class="f-control">${input}${desc ? `<p class="f-desc">${esc(desc)}</p>` : ''}</div></div>`;
}

function renderOp(o) {
  const { op, method, path, params } = o;
  const pathP = params.filter(p => p.in === 'path');
  const queryP = params.filter(p => p.in === 'query' && !PAGING.has(p.name));
  const pagingP = params.filter(p => p.in === 'query' && PAGING.has(p.name));
  const formP = params.filter(p => p.in === 'formData');
  const bodyP = params.find(p => p.in === 'body');
  const consumes = (op.consumes || ['application/json'])[0];
  const produces = op.produces || ['application/json'];
  const isMultipart = consumes === 'multipart/form-data';
  const bodySchema = effectiveBodySchema(o, bodyP);
  const bodyName = refName(bodySchema) || refName(bodySchema?.items);
  const isUpload = isMultipart || bodyName === 'InputStream';
  const isRawText = bodySchema && bodySchema.type === 'string';
  const isJsonBody = bodyP && !isUpload && !isRawText;
  const danger = method === 'delete' || DANGER.test(path) || params.some(p => /bypassDecommission|force/i.test(p.name));
  const getTwin = OPS.find(x => x.method === 'get' && x.path === path);
  const canLoad = isJsonBody && (method === 'put' || (method === 'post' && pathP.length)) && getTwin;
  const verb = { get: 'Run', post: 'Submit', put: 'Save changes', delete: 'Delete', patch: 'Save changes' }[method];

  const card = (title, inner, extra = '') => inner ? `<div class="card"><h3>${title}<span class="sp"></span>${extra}</h3><div class="body f-form">${inner}</div></div>` : '';
  let bodyCard = '';
  if (isUpload) {
    bodyCard = card('File to upload', `<div class="f-row"><label class="f-label" for="fileInput">File<span class="f-key">multipart upload</span></label>
      <div class="f-control"><input type="file" id="fileInput"><p class="f-desc">Choose the file to send. It is uploaded as form field “<input id="fileField" value="file" class="f-tiny">”.</p></div></div>`);
  } else if (isRawText) {
    bodyCard = card(consumes === 'application/x-pem-file' ? 'Certificate' : 'Content', `<div class="f-row f-row-wide"><label class="f-label" for="bodyText">${consumes === 'application/x-pem-file' ? 'PEM certificate or bundle' : 'Text'}<span class="f-key">${esc(consumes)}</span></label>
      <div class="f-control"><textarea id="bodyText" class="json" placeholder="-----BEGIN CERTIFICATE-----&#10;…&#10;-----END CERTIFICATE-----"></textarea>
      <p class="f-desc">${esc(bodyP.description || 'Paste the full text, including BEGIN/END lines.')}</p></div></div>`);
  } else if (isJsonBody) {
    const title = bodyName ? Pretty.label(bodyName.replace(/View$/, '')) + ' settings' : 'Request details';
    bodyCard = `<div class="card"><h3>${esc(title)}<span class="sp"></span>
        <div class="tabs" role="tablist"><button type="button" data-bm="form">Form</button><button type="button" data-bm="json">JSON</button></div></h3>
      <div class="body">
        <div class="row f-toolbar">
          ${canLoad ? '<button type="button" class="btn small" id="btnLoadCurrent">Load current values</button>' : ''}
          <button type="button" class="btn small ghost" id="btnClear">Clear</button>
          <span class="f-dim" id="formNote"></span>
        </div>
        ${canLoad ? '<p class="f-hint">Tip: pick the item above and its current settings load automatically, so anything you don’t change stays as it is.</p>' : ''}
        ${bodyP.description ? `<p class="f-hint">${esc(bodyP.description)}</p>` : ''}
        <div id="formHost"></div>
        <div id="jsonHost" hidden><textarea id="bodyText" class="json" spellcheck="false"></textarea><p class="err" id="bodyErr"></p></div>
      </div></div>`;
  }

  $('#main').innerHTML = `${pageHead(o.nav.section, o.nav.tab || o.tag)}
    <div class="op-head">
      <div class="line"><span class="badge b-${method}">${method}</span><h2 class="op-title">${esc(op.summary || path)}</h2><span class="sp"></span>${locationBadge(o)}</div>
      ${op.description && op.description !== op.summary ? `<div class="sum">${esc(op.description)}</div>` : ''}
      <div class="meta">${esc(path)} · ${esc(o.tag)}${op.operationId ? ' · ' + esc(op.operationId) : ''}</div>
      ${danger ? `<div class="warn">⚠ This operation can change or remove cluster state. You’ll be asked to confirm before it is sent.</div>` : ''}
    </div>
    <form id="reqForm" novalidate>
      ${card('Which item', pathP.map(p => paramRow(o, p)).join(''))}
      ${card('Options', queryP.map(p => paramRow(o, p)).join(''))}
      ${card('Sign-in details', formP.map(p => paramRow(o, p)).join(''))}
      ${bodyCard}
      ${pagingP.length ? `<details class="card f-paging"><summary>Filter, sort &amp; page results <span class="f-dim">optional</span></summary><div class="body f-form">${pagingP.map(p => paramRow(o, p)).join('')}</div></details>` : ''}
      <div class="card cmd-card"><h3>API command<span class="pv-dim cmd-note" id="cmdNote"></span><span class="sp"></span>
          <div class="tabs" role="tablist"><button type="button" data-cmd="curl">curl</button><button type="button" data-cmd="http">HTTP</button></div>
          <label class="f-check cmd-sec"><input type="checkbox" id="cmdSecrets"> Show secrets</label>
          <button type="button" class="tbtn" id="btnCopyCmd">Copy</button></h3>
        <pre class="cmd" id="cmdPreview"></pre></div>
      <div class="send-bar">
        <button type="submit" class="btn primary" id="btnSend">${verb}</button>
        ${CLUSTERS.length > 1 ? `<button type="button" class="btn small" id="btnTargets" aria-expanded="false" title="Choose which clusters to run this on">Run on: <b id="tgtLabel"></b> ▾</button>` : ''}
        <div class="url-preview" id="urlPreview"></div>
        <button type="button" class="btn small" id="btnCurl">Copy as curl</button>
        <div id="tgtHost" hidden style="flex-basis:100%"></div>
      </div>
    </form>
    <div id="respArea"></div>`;

  const form = $('#reqForm');
  // object pickers (name <-> UUID) for every parameter that names an object
  form.querySelectorAll('[data-pick]').forEach(inp => { inp.__pick = JSON.parse(inp.dataset.pick); OBJ.attach(inp, inp.__pick); });

  form.addEventListener('input', updatePreview);
  form.addEventListener('change', updatePreview);
  form.addEventListener('submit', e => { e.preventDefault(); send(o, { consumes, isUpload, bodyP, isJsonBody, isRawText, danger, produces, verb, canLoad }); });
  // which clusters to run on
  TP = null;
  if ($('#btnTargets')) {
    TP = targetPicker(updateTargets);
    $('#tgtHost').appendChild(TP.el);
    $('#btnTargets').addEventListener('click', () => { const h = $('#tgtHost'); h.hidden = !h.hidden; $('#btnTargets').setAttribute('aria-expanded', String(!h.hidden)); });
    updateTargets();
  }
  $('#btnCurl').addEventListener('click', () => copyCurl(o));
  form.querySelectorAll('[data-cmd]').forEach(b => b.addEventListener('click', () => { CMD_STYLE = b.dataset.cmd; store.set('hs.cmdStyle', CMD_STYLE); updatePreview(); }));
  $('#cmdSecrets').addEventListener('change', updatePreview);
  $('#btnCopyCmd').addEventListener('click', () => {
    navigator.clipboard?.writeText($('#cmdPreview').textContent);
    $('#btnCopyCmd').textContent = 'Copied'; setTimeout(() => { const b = $('#btnCopyCmd'); if (b) b.textContent = 'Copy'; }, 1500);
  });

  const saved = store.get(`hs.form.${o.id}`, null);
  if (saved) form.querySelectorAll('[data-p]').forEach(el => { if (saved.p?.[el.dataset.p] != null && el.type !== 'password') el.value = saved.p[el.dataset.p]; });
  form.querySelectorAll('.idp').forEach(w => w.refresh());

  FORM = null;
  if (isJsonBody) {
    FORM = Forms.build(bodySchema);
    $('#formHost').appendChild(FORM.el);
    if (FORM.hiddenCount) $('#formNote').textContent = `${FORM.hiddenCount} system-managed field${FORM.hiddenCount === 1 ? '' : 's'} hidden (see JSON)`;
    if (saved?.json) { try { FORM.set(JSON.parse(saved.json)); } catch {} }
    BODYMODE = store.get('hs.bodyMode', 'form');
    setBodyMode(BODYMODE, true);
    form.querySelectorAll('[data-bm]').forEach(b => b.addEventListener('click', () => setBodyMode(b.dataset.bm)));
    $('#btnClear').addEventListener('click', () => { FORM.set(undefined); $('#bodyText').value = ''; updatePreview(); });
    if (canLoad) {
      let lastKey = null;
      $('#btnLoadCurrent').addEventListener('click', () => { lastKey = collect(o).path; loadCurrent(o); });
      // auto-load once per chosen item, so edits are never overwritten by a re-load
      pathP.forEach(p => form.querySelector(`[data-in="path"][data-p="${p.name}"]`)?.addEventListener('change', () => {
        const key = collect(o).path;
        if (key.includes('{') || key === lastKey) return;
        lastKey = key; loadCurrent(o);
      }));
    }
  } else if (isRawText && saved?.json) $('#bodyText').value = saved.json;
  updatePreview();
  $('#main').scrollTop = 0;
}

let TP = null;
const targets = () => TP ? TP.get() : (ACTIVE ? [ACTIVE] : []);
function updateTargets() {
  const t = targets(), o = CURRENT;
  const label = t.length === 1 ? clusterLabel(CLUSTERS.find(c => c.id === t[0])) : t.length ? `${t.length} clusters` : 'no clusters';
  if ($('#tgtLabel')) $('#tgtLabel').textContent = label;
  const verb = { get: 'Run', post: 'Submit', put: 'Save changes', delete: 'Delete', patch: 'Save changes' }[o.method];
  $('#btnSend').textContent = t.length > 1 ? `${verb} on ${t.length} clusters` : verb;
  updatePreview();
  const multi = t.length > 1 || (t.length === 1 && t[0] !== ACTIVE);
  const note = $('#multiNote');
  if (multi && FORM && !note) $('#formHost')?.insertAdjacentHTML('beforebegin', `<p class="f-hint" id="multiNote">Running on ${t.length > 1 ? 'several clusters' : 'another cluster'}: ${
    ['put', 'patch'].includes(o.method) || o.params.some(p => p.in === 'path') ? 'only the fields you change are applied — each cluster’s own current settings are loaded and kept for everything else.' : 'the same settings are sent to each cluster. References to nodes, roles, users etc. are matched by name on each cluster.'}</p>`);
  if (!multi && note) note.remove();
}

function setBodyMode(mode, initial) {
  const ta = $('#bodyText');
  if (mode === 'json') {
    const v = FORM.get();
    ta.value = v === undefined ? '{}' : JSON.stringify(v, null, 2);
  } else if (!initial) {
    try { const t = ta.value.trim(); FORM.set(t ? JSON.parse(t) : undefined); $('#bodyErr').textContent = ''; }
    catch (e) { $('#bodyErr').textContent = `Fix the JSON before switching back: ${e.message}`; return; }
  }
  BODYMODE = mode; store.set('hs.bodyMode', mode);
  document.querySelectorAll('[data-bm]').forEach(b => b.setAttribute('aria-selected', b.dataset.bm === mode));
  $('#formHost').hidden = mode !== 'form'; $('#jsonHost').hidden = mode !== 'json';
  updatePreview();
}

function bodyValue() {
  if (BODYMODE === 'json') { const t = $('#bodyText').value.trim(); return t ? JSON.parse(t) : undefined; }
  return FORM.get();
}

function collect(o, overrides) {
  const vals = {};
  document.querySelectorAll('#reqForm [data-p]').forEach(el => { vals[el.dataset.p] = el.value; });
  Object.assign(vals, overrides || {});
  let path = o.path;
  const missing = [];
  const qs = new URLSearchParams();
  const formFields = new URLSearchParams();
  for (const p of o.params) {
    const v = (vals[p.name] ?? '').toString().trim();
    if (p.required && p.in !== 'body' && !v) missing.push(Pretty.label(p.name));
    if (p.in === 'path') path = path.replace(`{${p.name}}`, v ? encodeURIComponent(v) : `{${p.name}}`);
    else if (p.in === 'query' && v !== '') {
      if (p.type === 'array') v.split(',').map(s => s.trim()).filter(Boolean).forEach(x => qs.append(p.name, x));
      else qs.append(p.name, v);
    } else if (p.in === 'formData' && v !== '') formFields.append(p.name, vals[p.name]);
  }
  const q = qs.toString();
  return { vals, path, query: q ? `?${q}` : '', formFields, missing };
}

// ---------------------------------------------------------------- the full API command (curl or raw HTTP), shown live
const SECRET_KEY = /pass(word|phrase)?|secret|private.?key|token|credential/i;
function maskSecrets(v) {
  if (Array.isArray(v)) return v.map(maskSecrets);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SECRET_KEY.test(k) && x != null && typeof x !== 'object' && x !== '' ? '••••••' : maskSecrets(x)]));
  return v;
}
function buildCommand(o, { style = 'curl', secrets = false, pretty = true } = {}) {
  const c = collect(o);
  const method = o.method.toUpperCase();
  const cl = activeCluster();
  const base = (cl?.url || 'https://<cluster>:8443').replace(/\/$/, '');
  const url = `${base}${CONFIG.basePath}${c.path}${c.query}`;
  const consumes = (o.op.consumes || ['application/json'])[0];
  let ctype = null, data = null, file = false;
  if (o.params.some(p => p.in === 'formData')) {
    ctype = 'application/x-www-form-urlencoded';
    const f = new URLSearchParams(c.formFields); if (!secrets) for (const k of [...f.keys()]) if (SECRET_KEY.test(k)) f.set(k, '••••••');
    data = f.toString();
  } else if (FORM || (BODYMODE === 'json' && $('#jsonHost'))) {
    let v; try { v = bodyValue(); } catch (e) { v = undefined; data = `<invalid JSON: ${e.message}>`; }
    if (data == null) { const shown = secrets ? v : maskSecrets(v); data = JSON.stringify(shown ?? (o.params.find(p => p.in === 'body')?.schema?.type === 'array' ? [] : {}), null, pretty ? 2 : 0); }
    ctype = 'application/json';
  } else if ($('#bodyText') && $('#bodyText').value.trim()) { ctype = consumes; data = $('#bodyText').value.trim(); if (!secrets && /PRIVATE KEY/.test(data)) data = '<private key hidden>'; }
  else if ($('#fileInput')) file = $('#fileInput').files?.[0]?.name || '<path>';
  if (style === 'http') {
    const u = new URL(url.replace('<cluster>', 'cluster'));
    return [`${method} ${CONFIG.basePath}${c.path}${c.query} HTTP/1.1`, `Host: ${cl ? u.host : '<cluster>:8443'}`, 'Accept: application/json', 'Cookie: JSESSIONID=<session>',
      ...(ctype ? [`Content-Type: ${ctype}`] : file ? ['Content-Type: multipart/form-data; boundary=…'] : []), '', ...(data != null ? [data] : file ? [`(file: ${file})`] : [])].join('\n');
  }
  const q = s => `'${String(s).replace(/'/g, `'\\''`)}'`;
  const parts = [`curl -k -X ${method} ${q(url)}`, `-H 'Accept: application/json'`, `-b 'JSESSIONID=<session>'`];
  if (ctype) parts.push(`-H ${q('Content-Type: ' + ctype)}`);
  if (data != null) parts.push(`--data ${q(data)}`);
  if (file) parts.push(`-F ${q(`${$('#fileField')?.value || 'file'}=@${file}`)}`);
  return parts.join(' \\\n  ');
}
let CMD_STYLE = store.get('hs.cmdStyle', 'curl'), previewTimer = 0;
function updatePreview() {
  if (!CURRENT || !$('#cmdPreview')) return;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    const o = CURRENT, c = collect(o);
    $('#urlPreview').textContent = `${o.method.toUpperCase()} ${(activeCluster()?.url || '').replace(/\/$/, '')}${CONFIG.basePath}${c.path}${c.query}`;
    $('#cmdPreview').textContent = buildCommand(o, { style: CMD_STYLE, secrets: $('#cmdSecrets')?.checked });
    document.querySelectorAll('[data-cmd]').forEach(b => b.setAttribute('aria-selected', b.dataset.cmd === CMD_STYLE));
    const t = typeof targets === 'function' ? targets() : [];
    const missing = (o.path.match(/\{[^}]+\}/g) || []).filter(x => c.path.includes(x));
    $('#cmdNote').textContent = [missing.length ? `fill in ${missing.join(', ')}` : '', t.length > 1 ? `shown for ${clusterLabel(activeCluster())}; runs on ${t.length} clusters` : '',
      'the portal signs in for you — JSESSIONID is a placeholder'].filter(Boolean).join(' · ');
  }, 60);
}

async function loadCurrent(o) {
  const c = collect(o);
  const note = $('#formNote');
  if (c.path.includes('{')) { note.textContent = 'Fill in the item above first.'; return; }
  note.textContent = 'Loading current values…';
  const r = await fetch(HS(c.path), { headers: { Accept: 'application/json' } });
  const t = await r.text();
  if (!r.ok) { note.textContent = `Couldn’t load current values (HTTP ${r.status}).`; return; }
  try {
    const obj = JSON.parse(t);
    FORM.set(obj);
    if (BODYMODE === 'json') $('#bodyText').value = JSON.stringify(obj, null, 2);
    note.textContent = 'Current values loaded — edit what you need, then save.';
    updatePreview();
  } catch { note.textContent = 'Response was not JSON.'; }
}

async function send(o, ctx) {
  const c = collect(o);
  if (c.missing.length) { showResp({ error: `Please fill in: ${c.missing.join(', ')}` }); return; }

  const headers = { 'X-Portal': '1', Accept: ctx.produces.includes('application/json') ? 'application/json' : ctx.produces[0] };
  let body, bodyText;
  if (ctx.isUpload) {
    const f = $('#fileInput')?.files?.[0];
    if (f) { body = new FormData(); body.append($('#fileField').value || 'file', f, f.name); }
  } else if (o.params.some(p => p.in === 'formData')) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded'; body = c.formFields.toString();
  } else if (ctx.isRawText) {
    const raw = $('#bodyText').value.trim();
    if (raw) { headers['Content-Type'] = ctx.consumes; body = bodyText = raw; }
  } else if (ctx.isJsonBody) {
    let v;
    try { v = bodyValue(); } catch (e) { $('#bodyErr').textContent = `Invalid JSON: ${e.message}`; return; }
    headers['Content-Type'] = 'application/json';
    body = bodyText = JSON.stringify(v === undefined ? (ctx.bodyP.schema?.type === 'array' ? [] : {}) : v);
  } else if (o.method !== 'get') {
    headers['Content-Type'] = 'application/json';
  }

  const tgts = targets();
  if (!tgts.length) { showResp({ error: 'Choose at least one cluster to run this on.' }); return; }
  if (tgts.length > 1 || tgts[0] !== ACTIVE) return sendMulti(o, ctx, c, tgts, { headers, body });
  if (ctx.danger && !confirm(`${ctx.verb}: ${o.op.summary || o.path}\n${o.method.toUpperCase()} ${c.path}${c.query}\non ${clusterLabel(activeCluster())} (${activeCluster()?.url})\n\nThis may modify or remove cluster state. Continue?`)) return;

  store.set(`hs.form.${o.id}`, { p: Object.fromEntries(Object.entries(c.vals).filter(([k]) => !/password/i.test(k))), json: bodyText && !/password|secret/i.test(bodyText) ? bodyText : undefined });
  const btn = $('#btnSend'); btn.disabled = true; btn.textContent = 'Working…';
  const t0 = performance.now();
  try {
    const r = await fetch(HS(`${c.path}${c.query}`), { method: o.method.toUpperCase(), headers, body });
    const ms = Math.round(performance.now() - t0);
    if (r.status === 401 && (await r.clone().text()).includes('PORTAL_AUTH')) { showLogin('Your portal session ended — sign in again.'); return; }
    const ct = r.headers.get('content-type') || '';
    let upHeaders = {};
    try { upHeaders = JSON.parse(atob(r.headers.get('x-upstream-headers') || '') || '{}'); } catch {}
    let text = null, blob = null;
    if (/json|text|xml|pem/.test(ct) || !ct) text = await r.text(); else blob = await r.blob();
    pushHistory(o, c, r.status, ms);
    showResp({ status: r.status, statusText: r.statusText, ms, ct, text, blob, headers: upHeaders,
      filename: (r.headers.get('content-disposition') || '').match(/filename="?([^";]+)/)?.[1] || `${o.op.operationId || 'response'}.bin` });
  } catch (e) {
    showResp({ error: e.message });
  } finally { btn.disabled = false; updateTargets(); }
}

// ---------------------------------------------------------------- push one operation to several clusters
async function sendMulti(o, ctx, c, ids, single) {
  const method = o.method.toUpperCase();
  const isEdit = ctx.isJsonBody && ctx.canLoad && !c.path.includes('{');
  const getTwin = OPS.find(x => x.method === 'get' && x.path === o.path);
  let delta, createBody;
  if (ctx.isJsonBody) {
    try {
      if (BODYMODE === 'json') { const t = $('#bodyText').value.trim(); delta = t ? JSON.parse(t) : undefined; createBody = delta; }
      else { delta = FORM.getDelta(); createBody = Forms.merge(undefined, FORM.get()); }
    } catch (e) { $('#bodyErr').textContent = `Invalid JSON: ${e.message}`; return; }
    if (isEdit && BODYMODE === 'form' && !delta) { showResp({ error: 'You haven’t changed any field yet. Change the settings you want to apply, then run it.' }); return; }
  }
  const names = ids.map(id => clusterLabel(CLUSTERS.find(x => x.id === id)));
  if (method !== 'GET' && !confirm(`${ctx.verb} on ${ids.length} cluster${ids.length === 1 ? '' : 's'}:\n  • ${names.join('\n  • ')}\n\n${method} ${c.path}${c.query}${
    isEdit ? `\nChanged fields: ${Object.keys(delta || {}).map(k => Pretty.label(k)).join(', ') || '(JSON as entered)'}` : ''}${
    document.querySelector('#reqForm [data-pick]') ? '\nObject IDs are matched by name on each cluster.' : ''}\n\nThis changes every cluster listed. Continue?`)) return;

  const batch = `b-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const area = $('#respArea');
  area.innerHTML = `<div class="card"><h3>Results on ${ids.length} clusters <span class="mono" style="text-transform:none;letter-spacing:0">batch ${batch}</span><span class="sp"></span><span id="mrSum" class="mono" style="text-transform:none;letter-spacing:0"></span></h3>
    <div class="body"><table class="pv-table multi-res"><thead><tr><th>Cluster</th><th>Result</th><th>Time</th><th>Details</th></tr></thead><tbody>${
      ids.map((id, i) => `<tr data-row="${i}"><td><b>${esc(names[i])}</b></td><td class="mr-st"><span class="pv-dim">waiting…</span></td><td class="mr-ms"></td><td class="mr-msg"></td></tr><tr class="mr-detail" data-detail="${i}" hidden><td colspan="4"></td></tr>`).join('')}</tbody></table></div></div>`;
  area.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const btn = $('#btnSend'); btn.disabled = true; btn.textContent = 'Working…';
  let okN = 0, failN = 0;

  const runOne = async (id, i) => {
    const row = area.querySelector(`[data-row="${i}"]`), det = area.querySelector(`[data-detail="${i}"]`);
    const set = (st, ms, msg) => { row.querySelector('.mr-st').innerHTML = st; row.querySelector('.mr-ms').textContent = ms != null ? `${ms} ms` : ''; row.querySelector('.mr-msg').innerHTML = msg || ''; };
    set('<span class="pill neutral">RUNNING</span>');
    const t0 = performance.now();
    try {
      // object IDs picked on the active cluster -> the same-named object on this cluster
      let cc = c; const mapped = [];
      if (id !== ACTIVE) {
        const over = {};
        for (const inp of document.querySelectorAll('#reqForm [data-pick]')) {
          const v = inp.value.trim(); if (!v || !inp.__pick) continue;
          const t = await OBJ.translate(v, inp.__pick, ACTIVE, id);
          if (t.error) throw new Error(t.error);
          if (t.value !== v) { over[inp.dataset.p] = t.value; mapped.push(`${t.from} → ${t.value}`); }
        }
        if (mapped.length) cc = collect(o, over);
      }
      let body = single.body;
      if (ctx.isJsonBody) {
        let obj;
        if (isEdit && BODYMODE === 'form' && getTwin) {
          set('<span class="pill neutral">READING</span>', null, 'Loading this cluster’s current settings…');
          const cur = await fetch(HS(cc.path, id), { headers: { Accept: 'application/json' } });
          if (!cur.ok) throw new Error(cur.status === 404 ? 'Not found on this cluster (no object with that name/ID).' : `Couldn’t read current settings (HTTP ${cur.status}).`);
          obj = Forms.merge(await cur.json(), delta);
        } else obj = createBody;
        body = JSON.stringify(obj === undefined ? (ctx.bodyP.schema?.type === 'array' ? [] : {}) : obj);
      }
      const r = await fetch(HS(`${cc.path}${cc.query}`, id), { method, headers: { ...single.headers, 'X-Batch': batch }, body });
      const ms = Math.round(performance.now() - t0);
      const ct = r.headers.get('content-type') || '';
      const text = /json|text/.test(ct) || !ct ? await r.text() : null;
      let parsed; try { parsed = text ? JSON.parse(text) : null; } catch {}
      const ok = r.ok; ok ? okN++ : failN++;
      const errMsg = !ok ? (parsed?.errors?.[0]?.message || parsed?.error || parsed?.message || (text || '').slice(0, 200)) : '';
      set(`<span class="pill ${ok ? 'good' : 'bad'}">${r.status} ${ok ? 'OK' : 'FAILED'}</span>`, ms,
        `${mapped.length ? `<div class="pv-dim">IDs matched by name: ${esc(mapped.join(', '))}</div>` : ''}${errMsg ? esc(errMsg) + ' ' : ''}${text ? '<button type="button" class="btn small ghost mr-show">Show response</button>' : ''}`);
      if (text) {
        row.querySelector('.mr-show').addEventListener('click', e => {
          det.hidden = !det.hidden; e.target.textContent = det.hidden ? 'Show response' : 'Hide response';
          if (!det.firstElementChild.childElementCount) { try { det.firstElementChild.appendChild(Pretty.render(parsed ?? text)); } catch { det.firstElementChild.innerHTML = `<pre class="code">${esc(text)}</pre>`; } }
        });
      }
      pushHistory(o, { path: cc.path, query: `${cc.query} @ ${clusterLabel(CLUSTERS.find(x => x.id === id))}` }, r.status, ms);
    } catch (e) {
      failN++;
      set('<span class="pill bad">FAILED</span>', Math.round(performance.now() - t0), esc(e.message));
    }
    $('#mrSum').textContent = `${okN} succeeded · ${failN} failed`;
  };
  // run 4 at a time
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, ids.length) }, async () => { while (next < ids.length) { const i = next++; await runOne(ids[i], i); } }));
  btn.disabled = false; updateTargets();
}

function showResp(r) {
  const area = $('#respArea');
  if (r.error) { area.innerHTML = `<div class="card"><h3>Response</h3><div class="body"><p class="err">${esc(r.error)}</p></div></div>`; return; }
  let pretty = r.text ?? '', parsed, isJson = false;
  if (r.text && /json/.test(r.ct)) { try { parsed = JSON.parse(r.text); isJson = true; pretty = JSON.stringify(parsed, null, 2); } catch {} }
  const count = Array.isArray(parsed) ? `${parsed.length} items · ` : '';
  const size = r.blob ? r.blob.size : (r.text || '').length;
  const view = store.get('hs.respView', 'formatted');
  const tab0 = isJson || !r.text ? (view === 'json' && r.text ? 'json' : 'formatted') : 'json';
  const errMsg = r.status >= 400 && parsed && typeof parsed === 'object' ? (parsed.errors?.length ? null : (parsed.message || parsed.error)) : null;
  area.innerHTML = `<div class="card"><h3>Response <span class="resp-status s${String(r.status)[0]}">${r.status} ${esc(r.statusText || '')}</span>
      <span class="mono" style="text-transform:none;letter-spacing:0">${count}${size.toLocaleString()} bytes · ${r.ms} ms</span><span class="sp"></span>
      <div class="tabs">${isJson || !r.text ? `<button type="button" data-rt="formatted">Formatted</button>` : ''}<button type="button" data-rt="json">${isJson ? 'JSON' : 'Raw'}</button><button type="button" data-rt="headers">Headers</button></div>
      ${r.text ? '<button type="button" class="btn small" id="btnCopyResp">Copy</button>' : ''}
      <a class="btn small" id="btnDl" style="text-decoration:none">Download</a></h3>
    ${errMsg ? `<div class="body" style="padding-bottom:0"><div class="warn">${esc(errMsg)}</div></div>` : ''}
    <div class="body" data-rp="formatted"></div>
    <div class="body" data-rp="json">${r.blob ? `<p>Binary response (${esc(r.ct)}). Use Download.</p>` : `<pre class="code">${esc(pretty) || '<span style="opacity:.6">(empty body)</span>'}</pre>`}</div>
    <div class="body" data-rp="headers"><pre class="code">${esc(JSON.stringify(r.headers, null, 2))}</pre></div></div>`;
  const fp = area.querySelector('[data-rp="formatted"]');
  if (r.blob) fp.innerHTML = `<p>Binary response (${esc(r.ct)}) — use Download to save it.</p>`;
  else { try { fp.appendChild(Pretty.render(isJson ? parsed : r.text)); } catch (e) { fp.innerHTML = `<pre class="code">${esc(pretty)}</pre>`; } }
  const selectTab = t => {
    area.querySelectorAll('[data-rt]').forEach(x => x.setAttribute('aria-selected', x.dataset.rt === t));
    area.querySelectorAll('[data-rp]').forEach(p => { p.hidden = p.dataset.rp !== t; });
  };
  selectTab(r.blob ? 'formatted' : tab0);
  const blob = r.blob || new Blob([pretty], { type: r.ct || 'text/plain' });
  const dl = $('#btnDl'); dl.href = URL.createObjectURL(blob);
  dl.download = r.blob ? r.filename : `${CURRENT.op.operationId || 'response'}.${/json/.test(r.ct) ? 'json' : 'txt'}`;
  $('#btnCopyResp')?.addEventListener('click', e => { navigator.clipboard?.writeText(pretty); e.target.textContent = 'Copied'; });
  area.querySelectorAll('[data-rt]').forEach(b => b.addEventListener('click', () => {
    selectTab(b.dataset.rt);
    if (b.dataset.rt !== 'headers') store.set('hs.respView', b.dataset.rt);
  }));
  area.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function copyCurl(o) {
  navigator.clipboard?.writeText(buildCommand(o, { style: 'curl', secrets: $('#cmdSecrets')?.checked }));
  $('#btnCurl').textContent = 'Copied';
  setTimeout(() => { const b = $('#btnCurl'); if (b) b.textContent = 'Copy as curl'; }, 1500);
}

// ---------------------------------------------------------------- history
function pushHistory(o, c, status, ms) {
  const h = store.get('hs.history', []);
  h.unshift({ id: o.id, method: o.method, url: c.path + c.query, status, ms, at: Date.now() });
  store.set('hs.history', h.slice(0, 100));
}
$('#btnHistory').addEventListener('click', () => {
  const h = store.get('hs.history', []);
  $('#historyList').innerHTML = h.length ? h.map(x => `<li data-id="${esc(x.id)}"><span class="when">${new Date(x.at).toLocaleTimeString()}</span>
    <span class="m m-${x.method}">${x.method}</span><span>${esc(x.url)}</span><span class="s${String(x.status)[0]}">${x.status}</span></li>`).join('')
    : '<li style="cursor:default;color:var(--ink-3)">No requests yet.</li>';
  $('#historyDlg').showModal();
});
$('#historyList').addEventListener('click', e => {
  const li = e.target.closest('li[data-id]'); if (!li) return;
  $('#historyDlg').close(); location.hash = `op=${encodeURIComponent(li.dataset.id)}`;
});
$('#historyDlg [data-close]').addEventListener('click', () => $('#historyDlg').close());

// ---------------------------------------------------------------- configuration extraction (one or many clusters)
const EXTRACTS = new Map(); // clusterId -> { results, meta, secs }
let EX_TP = null;
function renderExtract() {
  CURRENT = null; renderList(); renderSwitcher();
  const planned = Extract.planSections(SPEC, { perShare: true });
  $('#main').innerHTML = `
    <div class="op-head">
      <div class="sum">Reads every configuration area of the selected clusters using read-only requests, then builds a formatted report for each. Nothing on the clusters is changed.</div>
    </div>
    <form id="exForm" class="card"><h3>What to include</h3><div class="body f-form">
      <div class="f-row"><div class="f-label">Clusters<span class="f-key">one report per cluster</span></div><div class="f-control" id="exClusters"></div></div>
      <div class="f-row"><div class="f-label">Configuration areas<span class="f-key">${planned.length} retrieval calls per cluster</span></div>
        <div class="f-control"><div class="f-checks ex-areas">${Extract.CHAPTERS.map(c => `<label class="f-check"><input type="checkbox" name="ch" value="${c.id}" checked> ${esc(c.title)}</label>`).join('')}
          <label class="f-check"><input type="checkbox" name="ch" value="other" checked> Other settings</label></div>
          <p class="f-desc">Untick areas you don’t need. Metrics, reports, events and file listings are not configuration and are skipped.</p></div></div>
      <div class="f-row"><div class="f-label">Per-share details<span class="f-key">one call per share</span></div>
        <div class="f-control"><label class="f-check"><input type="checkbox" id="exPerShare" checked> Include objectives applied to each share and its existing snapshots</label>
          <p class="f-desc">Turn off on clusters with many shares to make extraction faster.</p></div></div>
      <div class="f-row"><div class="f-label">Runtime information<span class="f-key">optional</span></div>
        <div class="f-control">${Extract.OPTIONAL.map(o => `<label class="f-check"><input type="checkbox" name="opt" value="${o.id}"> ${esc(o.title)}</label>`).join('')}</div></div>
      <div class="f-row"><div class="f-label">Secrets</div>
        <div class="f-control"><label class="f-check"><input type="checkbox" id="exRedact" checked> Redact passwords, secret keys and other credentials in the report and JSON</label>
          <p class="f-desc">Recommended if you will share the report.</p></div></div>
    </div></form>
    <div class="send-bar"><button class="btn primary" id="btnRunExtract" type="button">Start extraction</button><div class="url-preview" id="exStatus">Ready.</div>
      ${CLUSTERS.length > 1 ? '<button class="btn small" id="btnUploadAll" type="button" hidden>Upload all to Hammerspace</button>' : ''}</div>
    <div id="exProgress"></div>
    <div id="exResults"></div>`;
  portalHead('extract');
  EX_TP = CLUSTERS.length ? targetPicker(updateExtractBtn) : null;
  if (EX_TP) { EX_TP.el.querySelector('.tp-head b').textContent = 'Extract from'; $('#exClusters').appendChild(EX_TP.el); }
  else $('#exClusters').innerHTML = '<p class="f-desc">No clusters registered yet — <a href="#clusters">add one</a>.</p>';
  $('#btnRunExtract').addEventListener('click', runExtract);
  $('#btnUploadAll')?.addEventListener('click', uploadAll);
  updateExtractBtn();
  for (const id of EXTRACTS.keys()) if (CLUSTERS.some(c => c.id === id)) showExtractResult(id);
}
function updateExtractBtn() {
  const n = EX_TP ? EX_TP.get().length : 0;
  $('#btnRunExtract').textContent = n > 1 ? `Extract from ${n} clusters` : 'Start extraction';
  $('#btnRunExtract').disabled = !n;
}

async function runExtract() {
  const ids = EX_TP.get();
  const chapters = new Set([...document.querySelectorAll('#exForm [name=ch]:checked')].map(x => x.value));
  const optional = Object.fromEntries([...document.querySelectorAll('#exForm [name=opt]:checked')].map(x => [x.value, true]));
  const opts = { perShare: $('#exPerShare').checked, optional, redact: $('#exRedact').checked };
  const filter = s => chapters.has(s.chapter) || Extract.OPTIONAL.some(o => o.path === s.path);
  const btn = $('#btnRunExtract'); btn.disabled = true; btn.textContent = 'Extracting…';
  for (const id of ids) { EXTRACTS.delete(id); $(`#exr-${id}`)?.remove(); }
  const prog = $('#exProgress');
  prog.innerHTML = '';
  for (const [n, id] of ids.entries()) {
    const cl = CLUSTERS.find(c => c.id === id);
    const card = document.createElement('div'); card.className = 'card';
    card.innerHTML = `<h3>${esc(clusterLabel(cl))} <span class="sp"></span><span class="mono ex-count" style="text-transform:none;letter-spacing:0">waiting</span></h3>
      <div class="body"><div class="ex-bar"><div></div></div><details class="ex-logwrap"><summary class="f-dim">Details</summary><ul class="ex-log"></ul></details></div>`;
    prog.appendChild(card);
    const log = card.querySelector('.ex-log'), bar = card.querySelector('.ex-bar > div'), cnt = card.querySelector('.ex-count');
    const rows = new Map();
    $('#exStatus').textContent = `Cluster ${n + 1} of ${ids.length}: ${clusterLabel(cl)}…`;
    const t0 = performance.now();
    try {
      const results = await Extract.run(SPEC, opts, ev => {
        const key = ev.section.path || ev.section.perShare;
        let li = rows.get(key);
        if (!li) { li = document.createElement('li'); rows.set(key, li); log.appendChild(li); }
        const icon = { running: '◌', ok: '✓', empty: '–', na: '–', error: '✗' }[ev.state];
        const note = ev.state === 'ok' ? `${ev.count} item${ev.count === 1 ? '' : 's'}` : ev.state === 'empty' ? 'not configured' : ev.state === 'na' ? 'not on this version' : ev.state === 'error' ? `failed (${esc(String(ev.status))})` : 'reading…';
        li.className = `ex-${ev.state}`;
        li.innerHTML = `<span class="ex-i">${icon}</span><span>${esc(ev.section.title)}</span><span class="ex-n">${note}</span>`;
        if (ev.total) { bar.style.width = `${Math.round(ev.done / ev.total * 100)}%`; cnt.textContent = `${ev.done} / ${ev.total}`; }
      }, filter, id);
      const secs = ((performance.now() - t0) / 1000).toFixed(1);
      const data = results.map(r => ({ ...r, data: Extract.redact(r.data, opts.redact) }));
      const meta = { target: cl.url, user: CONFIG.user.username, when: new Date(), redacted: opts.redact, basePath: CONFIG.basePath };
      EXTRACTS.set(id, { results: data, meta, secs });
      const failed = data.filter(r => !r.ok && !r.unavailable).length;
      cnt.innerHTML = `done in ${secs}s${failed ? ` · <span class="err-inline">${failed} unreadable</span>` : ''}`;
      showExtractResult(id);
    } catch (e) {
      cnt.innerHTML = `<span class="err-inline">failed: ${esc(e.message)}</span>`;
    }
  }
  $('#exStatus').textContent = `Finished ${ids.length} cluster${ids.length === 1 ? '' : 's'}.`;
  if ($('#btnUploadAll')) $('#btnUploadAll').hidden = EXTRACTS.size < 2;
  btn.disabled = false; updateExtractBtn();
}

function clusterIdentity(id) {
  const ex = EXTRACTS.get(id), cl = CLUSTERS.find(c => c.id === id) || {};
  const cntl = ((ex?.results.find(r => r.path === '/cntl' && r.ok)?.data) || [])[0] || {};
  return { name: cntl.name || cl.clusterName || cl.name || 'cluster', id: cntl.uoid?.uuid || cl.clusterUuid || 'manual' };
}
function bundlePayload(id, action) {
  const { results, meta } = EXTRACTS.get(id);
  const html = Extract.buildReport(results, meta);
  const ci = clusterIdentity(id);
  const bundle = { generated: meta.when.toISOString(), cluster: meta.target, clusterName: ci.name, clusterId: ci.id, user: meta.user, basePath: meta.basePath, secretsRedacted: meta.redacted,
    sections: results.map(r => ({ title: r.title, chapter: r.chapter, endpoint: r.path, status: r.status, configured: !!r.configured, data: r.data, error: r.error })) };
  return { html, bundle, ci, body: JSON.stringify({ action, cluster: id, html, json: JSON.stringify(bundle, null, 2), clusterName: ci.name, clusterId: ci.id, redacted: meta.redacted }) };
}
async function uploadOne(id) {
  const r = await fetch('portal/bundle', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Portal': '1' }, body: bundlePayload(id, 'upload').body });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}
function uploadResultHtml(j) {
  return `<div class="${j.ok ? 'ex-up-ok' : 'warn'}"><b>${j.ok ? 'Upload complete' : `Upload rejected (HTTP ${j.status} ${esc(j.statusText || '')})`}</b> — <code>${esc(j.file)}</code>, ${(j.bytes / 1024).toFixed(1)} KB in ${(j.ms / 1000).toFixed(1)}s, cluster_id=${esc(j.clusterId)}
    ${j.body ? `<details style="margin-top:6px"><summary>Server response</summary><pre class="code">${esc(j.body)}</pre></details>` : ''}</div>`;
}
async function uploadAll() {
  const ids = [...EXTRACTS.keys()].filter(id => CLUSTERS.some(c => c.id === id));
  const unredacted = ids.filter(id => !EXTRACTS.get(id).meta.redacted).length;
  if (!confirm(`Upload ${ids.length} configuration bundles to Hammerspace (${CONFIG.upload?.url})?\n\n${ids.map(id => `  • ${clusterIdentity(id).name} (${clusterIdentity(id).id})`).join('\n')}${unredacted ? `\n\n${unredacted} of them are NOT redacted.` : ''}`)) return;
  const b = $('#btnUploadAll'); b.disabled = true;
  for (const id of ids) {
    const host = $(`#exr-${id} .up-result`);
    if (host) host.innerHTML = '<p class="f-desc">Compressing & uploading…</p>';
    try { const j = await uploadOne(id); if (host) host.innerHTML = uploadResultHtml(j); }
    catch (e) { if (host) host.innerHTML = `<div class="warn"><b>Upload failed.</b> ${esc(e.message)}</div>`; }
  }
  b.disabled = false;
}

function showExtractResult(id) {
  const ex = EXTRACTS.get(id); if (!ex) return;
  const { results, meta, secs } = ex;
  const { html, bundle, ci } = bundlePayload(id, 'download');
  const cl = CLUSTERS.find(c => c.id === id) || {};
  const conf = results.filter(r => r.configured).length, empty = results.filter(r => r.ok && !r.configured).length, failed = results.filter(r => !r.ok && !r.unavailable).length, na = results.filter(r => r.unavailable).length;
  const safe = v => String(v || '').trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'unknown';
  const stamp = meta.when.toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const base = `hs_config_${safe(ci.name)}_${safe(ci.id)}_${stamp}`;
  const htmlUrl = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const jsonUrl = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }));
  let card = $(`#exr-${id}`);
  if (!card) { card = document.createElement('div'); card.id = `exr-${id}`; card.className = 'card'; $('#exResults').appendChild(card); }
  card.innerHTML = `<h3>Report — ${esc(clusterLabel(cl))}<span class="sp"></span>
      <a class="btn small" href="${htmlUrl}" target="_blank" rel="noopener">Open</a>
      <a class="btn small primary" href="${htmlUrl}" download="${base}_report.html">Download report</a>
      <a class="btn small" href="${jsonUrl}" download="${base}_raw.json">Raw JSON</a>
      <button type="button" class="btn small" data-bundle>Bundle (.tar.gz)</button></h3>
    <div class="body ex-upload">
      <div class="ex-up-row">
        <div><p class="f-desc"><b>${conf}</b> sections with configuration · ${empty} not configured${na ? ` · ${na} not available on this version` : ''} · ${failed ? `<b class="err-inline">${failed} could not be read</b>` : '0 errors'}${secs ? ` · ${secs}s` : ''}.</p>
          <p class="f-desc">Cluster <b>${esc(ci.name)}</b> · cluster ID <code>${esc(ci.id)}</code> · secrets ${meta.redacted ? 'redacted' : '<b class="err-inline">NOT redacted</b>'}</p></div>
        <button type="button" class="btn primary" data-upload ${CONFIG.upload?.enabled === false ? 'disabled title="Uploading is disabled on this portal"' : ''}>Upload to Hammerspace</button>
      </div>
      <div class="up-result"></div>
    </div>
    <details class="ex-prev"><summary>Preview report</summary><div class="body"><iframe class="ex-preview" title="Report preview" sandbox="allow-same-origin allow-popups"></iframe></div></details>`;
  const det = card.querySelector('.ex-prev');
  det.addEventListener('toggle', () => { if (det.open) { const f = det.querySelector('iframe'); if (!f.srcdoc) f.srcdoc = html; } });
  card.querySelector('[data-bundle]').addEventListener('click', async e => {
    const b = e.target; b.disabled = true; b.textContent = 'Building…';
    try {
      const r = await fetch('portal/bundle', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Portal': '1' }, body: bundlePayload(id, 'download').body });
      if (!r.ok) throw new Error((await r.json()).error || `HTTP ${r.status}`);
      const name = (r.headers.get('content-disposition') || '').match(/filename="([^"]+)"/)?.[1] || 'hs_config_bundle.tar.gz';
      const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = name; document.body.appendChild(a); a.click(); a.remove();
    } catch (err) { alert(`Couldn’t build the bundle: ${err.message}`); }
    finally { b.disabled = false; b.textContent = 'Bundle (.tar.gz)'; }
  });
  card.querySelector('[data-upload]').addEventListener('click', async e => {
    if (!confirm(`Upload this configuration to Hammerspace?\n\nCluster: ${ci.name}\nCluster ID: ${ci.id}\nDestination: ${CONFIG.upload?.url}\nSecrets: ${meta.redacted ? 'redacted' : 'NOT REDACTED — passwords and keys will be included'}`)) { card.querySelector('.up-result').innerHTML = '<p class="f-desc">Upload skipped.</p>'; return; }
    const b = e.target; b.disabled = true; b.textContent = 'Compressing & uploading…';
    try { card.querySelector('.up-result').innerHTML = uploadResultHtml(await uploadOne(id)); }
    catch (err) { card.querySelector('.up-result').innerHTML = `<div class="warn"><b>Upload failed.</b> ${esc(err.message)}</div>`; }
    finally { b.disabled = false; b.textContent = 'Upload to Hammerspace'; }
  });
}
