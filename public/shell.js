/* Console shell styled after the Hammerspace management GUI:
 * icon rail, navigation tree (GUI sections → tabs → operations, then "CLI Only or Hidden APIs"),
 * page header with tab strip, tab landing pages with live data, and the dashboard. */
'use strict';

const SB_KEY = 'hs.sidebar';
const ORDER = { get: 0, post: 1, put: 2, delete: 3, patch: 4 };
const byPath = (a, b) => a.path.localeCompare(b.path) || ORDER[a.method] - ORDER[b.method];
const PORTAL_TABS = [
  { id: 'clusters', title: 'Clusters', icon: 'clusters' },
  { id: 'objects', title: 'Object IDs', icon: 'report' },
  { id: 'extract', title: 'Extract configuration', icon: 'report' },
  { id: 'audit', title: 'Audit log', icon: 'audit' },
  { id: 'users', title: 'Portal users', icon: 'user' },
];

// ---------------------------------------------------------------- where am I
function routeInfo() {
  const h = decodeURIComponent(location.hash.slice(1));
  if (h.startsWith('op=') && CURRENT) return { section: CURRENT.nav.section, tab: CURRENT.nav.tab || CURRENT.tag, op: CURRENT.id };
  if (h.startsWith('tab=')) { const [s, t] = h.slice(4).split('/'); return { section: s, tab: t }; }
  if (h.startsWith('sec=')) return { section: h.slice(4), tab: null };
  if (PORTAL_TABS.some(t => t.id === h)) return { section: 'portal', tab: h };
  return { section: 'dashboard', tab: null };
}
const opsIn = (sid, tid) => OPS.filter(o => o.nav.section === sid && (tid == null || (sid === 'hidden' ? o.tag === tid : o.nav.tab === tid))).sort(byPath);
const opById = id => OPS.find(o => o.id === id);
const opHref = o => `#op=${encodeURIComponent(o.id)}`;
const opName = o => o.op.summary || o.path;

// ---------------------------------------------------------------- icon rail
function renderRail() {
  const cur = routeInfo().section;
  const link = (href, sid, title, icon) => `<a href="${href}" class="rail-i ${cur === sid ? 'on' : ''}" title="${esc(title)}" aria-label="${esc(title)}">${NAV.icon(icon, 22)}</a>`;
  $('#rail').innerHTML = `
    <button type="button" class="rail-i" id="btnSidebar" title="Show or hide the API list" aria-label="Toggle API list">
      <svg class="ico" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></button>
    ${NAV.SECTIONS.filter(s => s.id !== 'header').map(s => link(`#sec=${s.id}`, s.id, s.title, s.icon)).join('')}
    <span class="rail-sep"></span>
    ${link('#sec=hidden', 'hidden', NAV.HIDDEN_SECTION.title, 'terminal')}
    <span class="rail-grow"></span>
    ${link('#clusters', 'portal', 'Portal: clusters, extraction, audit', 'clusters')}`;
  $('#btnSidebar').addEventListener('click', () => {
    const open = $('#app').classList.toggle('nosb') === false; store.set(SB_KEY, open);
  });
}

// ---------------------------------------------------------------- navigation tree (replaces the old tag list)
const TREE_OPEN = new Set(store.get('hs.treeOpen', ['dashboard']));
function renderList() {
  const q = $('#search').value.trim().toLowerCase();
  const terms = q.split(/\s+/).filter(Boolean);
  const shown = OPS.filter(o => activeMethods.has(o.method) && terms.every(t => o.search.includes(t)));
  const where = routeInfo();
  const searching = terms.length > 0 || activeMethods.size < METHODS.length;
  const gui = shown.filter(o => o.nav.section !== 'hidden').length;
  $('#counts').innerHTML = `${shown.length} of ${OPS.length} operations · <b>${gui}</b> in the GUI · <b>${shown.length - gui}</b> CLI only / hidden`;

  const opLink = o => `<a class="op ${where.op === o.id ? 'active' : ''}" href="${opHref(o)}" title="${esc(o.method.toUpperCase() + ' ' + o.path)}">
      <span class="m m-${o.method}">${o.method}</span><span class="s">${esc(opName(o))}</span><span class="p">${esc(o.path)}</span></a>`;
  const group = (key, href, title, ops, cls) => {
    if (!ops.length) return '';
    const open = searching || TREE_OPEN.has(key) || (where.op && ops.some(o => o.id === where.op));
    return `<details class="nv-tab ${cls || ''}" data-key="${esc(key)}" ${open ? 'open' : ''}><summary>
        <a href="${href}" class="nv-link ${where.tab && href.endsWith('=' + key) ? 'on' : ''}">${esc(title)}</a><span class="n">${ops.length}</span></summary>${ops.sort(byPath).map(opLink).join('')}</details>`;
  };
  const sectionBlock = (s, tabs, hidden) => {
    const body = tabs.join('');
    if (!body) return '';
    const open = searching || TREE_OPEN.has(s.id) || where.section === s.id;
    const n = shown.filter(o => o.nav.section === s.id).length;
    return `<details class="nv-sec ${hidden ? 'nv-hidden' : ''}" data-key="${s.id}" ${open ? 'open' : ''}><summary>
      ${NAV.icon(hidden ? 'terminal' : s.icon, 16)}<a href="#sec=${s.id}" class="nv-link ${where.section === s.id && !where.tab ? 'on' : ''}">${esc(s.title)}</a><span class="n">${n}</span></summary>${body}</details>`;
  };

  let html = NAV.SECTIONS.map(s => sectionBlock(s, s.tabs.map(t =>
    group(`${s.id}/${t.id}`, `#tab=${s.id}/${t.id}`, t.title, shown.filter(o => o.nav.section === s.id && o.nav.tab === t.id))))).join('');
  const hid = shown.filter(o => o.nav.section === 'hidden');
  const tags = [...new Set(hid.map(o => o.tag))].sort();
  const hiddenHtml = sectionBlock(NAV.HIDDEN_SECTION, tags.map(t => group(`hidden/${t}`, `#tab=hidden/${encodeURIComponent(t)}`, Pretty.label(t), hid.filter(o => o.tag === t), 'nv-tag')), true);
  html += hiddenHtml ? `<div class="nv-divider"><span>Not in the Hammerspace GUI</span></div>${hiddenHtml}` : '';
  $('#opList').innerHTML = html || '<p class="nv-none">No operations match.</p>';
}
$('#opList').addEventListener('toggle', e => {
  const d = e.target; if (!d.dataset?.key || $('#search').value) return;
  d.open ? TREE_OPEN.add(d.dataset.key) : TREE_OPEN.delete(d.dataset.key);
  store.set('hs.treeOpen', [...TREE_OPEN]);
}, true);
$('#opList').addEventListener('click', e => { if (e.target.closest('.nv-link')) e.stopPropagation(); });

// ---------------------------------------------------------------- page header + tab strip
function clusterStatusHtml() {
  const c = activeCluster(); if (!c) return '<span class="ph-st">No cluster selected — <a href="#clusters">add one</a></span>';
  const s = STATUS.get(ACTIVE);
  const state = !s ? '<span class="pv-dim">checking…</span>' : s.ok ? `${okIcon(/UP|HA|STANDALONE/.test(s.state || 'UP') ? 'good' : 'warn')} ${esc(stateText(s.state))}` : `${okIcon('bad')} Unreachable`;
  return `<span class="ph-st">Cluster Name: <b>${esc(s?.clusterName || clusterLabel(c))}</b></span><span class="ph-st">Status: ${state}</span>`;
}
const stateText = s => ({ HA: 'High Availability', STANDALONE: 'Standalone', DEGRADED: 'Degraded', UP: 'Up' }[s] || s || 'Up');
const okIcon = kind => `<span class="st-ico st-${kind}" aria-hidden="true">${kind === 'good' ? '✓' : kind === 'warn' ? '!' : '×'}</span>`;

function pageHead(sid, tid, extraCrumb) {
  let title, tabs;
  if (sid === 'portal') { title = 'Portal'; tabs = PORTAL_TABS.map(t => ({ href: `#${t.id}`, title: t.title, on: t.id === tid })); }
  else if (sid === 'hidden') {
    title = NAV.HIDDEN_SECTION.title;
    tabs = [{ href: '#sec=hidden', title: 'All hidden APIs', on: !tid }];
    if (tid) tabs.push({ href: `#tab=hidden/${encodeURIComponent(tid)}`, title: Pretty.label(tid), on: true });
  } else {
    const s = NAV.section(sid); title = s.title;
    tabs = s.tabs.map(t => ({ href: `#tab=${sid}/${t.id}`, title: t.title, on: t.id === tid, n: opsIn(sid, t.id).length + (t.also || []).length }));
    if (sid === 'dashboard') tabs.unshift({ href: '#sec=dashboard', title: 'Overview', on: !tid });
  }
  return `<div class="ph"><h2 class="ph-title">${esc(title)}</h2><div class="ph-right">${clusterStatusHtml()}</div></div>
    <nav class="tabstrip" aria-label="${esc(title)} tabs">${tabs.map(t => `<a href="${t.href}" class="${t.on ? 'on' : ''}">${esc(t.title)}${t.n === 0 ? ' <span class="tab-n">·</span>' : ''}</a>`).join('')}</nav>
    ${extraCrumb || ''}`;
}
// Called by the portal pages (Clusters, Extract, Audit, Users)
function portalHead(id) { $('#main').insertAdjacentHTML('afterbegin', pageHead('portal', id)); renderRail(); }

function locationBadge(o) {
  if (o.nav.section === 'hidden') return `<a class="loc loc-hidden" href="#tab=hidden/${encodeURIComponent(o.tag)}" title="Not exposed in the Hammerspace GUI">${NAV.icon('terminal', 13)} CLI only / hidden · ${esc(Pretty.label(o.tag))}</a>`;
  const s = NAV.section(o.nav.section), t = NAV.tab(o.nav.section, o.nav.tab);
  return `<a class="loc" href="#tab=${s.id}/${t.id}" title="Where this lives in the Hammerspace GUI">${NAV.icon(s.icon, 13)} In GUI: ${esc(s.title)} › ${esc(t.title)}</a>`;
}

// ---------------------------------------------------------------- section / tab landing pages
function renderSection(sid) {
  if (sid === 'dashboard') return renderDashboard();
  if (sid === 'hidden') return renderHidden(null);
  const s = NAV.section(sid); if (!s) return renderDashboard();
  return renderTabPage(sid, s.tabs[0].id);
}

const isListGet = o => o.method === 'get' && !o.path.includes('{') && !o.params.some(p => p.required && p.in !== 'header');
function opTable(ops, caption) {
  if (!ops.length) return '';
  return `<div class="panel"><div class="panel-h">${esc(caption)}<span class="sp"></span><span class="panel-n">${ops.length}</span></div>
    <table class="gt"><thead><tr><th style="width:84px">Method</th><th>Action</th><th>Endpoint</th></tr></thead><tbody>${ops.map(o => `
      <tr><td><span class="mb mb-${o.method}">${o.method.toUpperCase()}</span></td>
        <td><a href="${opHref(o)}">${esc(opName(o))}</a>${o.op.description && o.op.description !== o.op.summary ? `<div class="gt-sub">${esc(o.op.description.slice(0, 160))}</div>` : ''}</td>
        <td><code>${esc(o.path)}</code></td></tr>`).join('')}</tbody></table></div>`;
}

function renderTabPage(sid, tid) {
  if (sid === 'hidden') return renderHidden(tid);
  const s = NAV.section(sid), t = NAV.tab(sid, tid);
  if (!t) return renderSection(sid);
  CURRENT = null; renderList(); renderRail();
  const ops = opsIn(sid, tid);
  const also = (t.also || []).map(opById).filter(Boolean);
  // live data: the tab's main list endpoints, in the order of the tab's rules (e.g. /shares before /share-participants)
  const rank = o => { const i = (t.rules || []).findIndex(([m, re]) => re.test(o.path)); return i < 0 ? 99 : i; };
  const lists = ops.filter(o => isListGet(o) && o.path !== '/files').sort((a, b) => rank(a) - rank(b) || a.path.length - b.path.length).slice(0, 3);
  $('#main').innerHTML = `${pageHead(sid, tid)}
    ${t.note ? `<div class="note">${esc(t.note)}</div>` : ''}
    ${!ACTIVE ? '<div class="note">Add a cluster on the <a href="#clusters">Clusters</a> page to see live data here.</div>' : ''}
    <div id="livePanels">${ACTIVE ? lists.map((o, i) => livePanel(o, i)).join('') : ''}</div>
    ${opTable(ops, `${t.title} — API operations`) || (also.length ? '' : '<div class="note">This GUI tab has no API operations of its own.</div>')}
    ${opTable(also, 'Also used on this tab')}`;
  if (ACTIVE) lists.forEach((o, i) => loadLive(o, i));
}

function livePanel(o, i) {
  const create = OPS.find(x => x.method === 'post' && x.path === o.path);
  return `<div class="panel live" id="live${i}"><div class="panel-h">${esc(LIVE_TITLES[o.path] || Pretty.label(o.path.split('/').filter(Boolean).join(' ')))}
      <span class="panel-n" id="liveN${i}"></span><span class="sp"></span>
      ${create ? `<a class="tbtn" href="${opHref(create)}">${NAV.icon('plus', 13)} ${esc(create.op.summary && create.op.summary.length < 40 ? create.op.summary : 'Create')}</a>` : ''}
      <a class="tbtn" href="${opHref(o)}" title="Open the request form for ${esc(o.path)}">Open in console</a>
      <button type="button" class="tbtn" data-reload="${i}">Refresh</button></div>
    <div class="panel-b" id="liveB${i}"><p class="pv-dim">Loading ${esc(o.path)} from ${esc(clusterLabel(activeCluster()))}…</p></div></div>`;
}
const LIVE = [];
const LIVE_TITLES = { '/cntl': 'Cluster', '/sites/local': 'Local site', '/ad': 'Active Directory', '/s3server': 'S3 servers', '/snmp': 'SNMP', '/sw-update': 'Software update history', '/pd-support': 'Support bundles' };
async function loadLive(o, i) {
  LIVE[i] = o;
  const host = $(`#liveB${i}`); if (!host) return;
  try {
    const r = await fetch(HS(o.path), { headers: { Accept: 'application/json' } });
    if (r.status === 404) { host.innerHTML = '<p class="pv-dim">Not available on this cluster’s software version.</p>'; return; }
    const text = await r.text();
    if (!r.ok) { host.innerHTML = `<p class="err-inline">HTTP ${r.status}: ${esc(text.slice(0, 300))}</p>`; return; }
    let data; try { data = JSON.parse(text); } catch { data = text; }
    if ($(`#liveN${i}`) && Array.isArray(data)) $(`#liveN${i}`).textContent = data.length;
    host.innerHTML = ''; host.appendChild(Array.isArray(data) && !data.length ? Object.assign(document.createElement('p'), { className: 'gt-empty', textContent: 'There are no items to display' }) : Pretty.render(data));
  } catch (e) { host.innerHTML = `<p class="err-inline">${esc(e.message)}</p>`; }
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-reload]'); if (!b) return;
  const i = +b.dataset.reload; $(`#liveB${i}`).innerHTML = '<p class="pv-dim">Loading…</p>'; loadLive(LIVE[i], i);
});

function renderHidden(tag) {
  CURRENT = null; renderList(); renderRail();
  const hid = OPS.filter(o => o.nav.section === 'hidden');
  const intro = `<div class="note">These API operations are not exposed anywhere in the Hammerspace management GUI (based on the 5.2 GUI). They are only reachable through the API or the CLI. Some are internal helpers (lookups, related-lists, login); others configure features that are otherwise CLI-only (e.g. DNS, NTP, LDAP, KMS, roles, syslog, SMTP, antivirus).</div>`;
  if (tag) {
    $('#main').innerHTML = `${pageHead('hidden', tag)}${opTable(opsIn('hidden', tag), `${Pretty.label(tag)} — CLI only / hidden`)}`;
    return;
  }
  const tags = [...new Set(hid.map(o => o.tag))].sort();
  $('#main').innerHTML = `${pageHead('hidden', null)}${intro}
    <div class="panel"><div class="panel-h">API areas<span class="sp"></span><span class="panel-n">${hid.length} operations</span></div>
    <table class="gt"><thead><tr><th>Area</th><th style="width:110px">Operations</th><th>Methods</th></tr></thead><tbody>${tags.map(t => {
      const ops = hid.filter(o => o.tag === t);
      const ms = [...new Set(ops.map(o => o.method))].sort((a, b) => ORDER[a] - ORDER[b]);
      return `<tr><td><a href="#tab=hidden/${encodeURIComponent(t)}">${esc(Pretty.label(t))}</a> <code class="gt-tag">${esc(t)}</code></td><td>${ops.length}</td><td>${ms.map(m => `<span class="mb mb-${m}">${m.toUpperCase()}</span>`).join(' ')}</td></tr>`;
    }).join('')}</tbody></table></div>`;
}

// ---------------------------------------------------------------- dashboard
async function renderDashboard() {
  CURRENT = null; renderList(); renderRail();
  const det = tid => `<a class="w-det" href="#tab=dashboard/${tid}">Details</a>`;
  const coverage = [...NAV.SECTIONS, NAV.HIDDEN_SECTION].map(s => ({ s, n: OPS.filter(o => o.nav.section === s.id).length }));
  const max = Math.max(...coverage.map(c => c.n));
  $('#main').innerHTML = `${pageHead('dashboard', null)}
    ${!ACTIVE ? '<div class="note">No cluster yet — <a href="#clusters">add your first cluster</a> to see its dashboard.</div>' : ''}
    <div class="widgets">
      <section class="widget"><header>Health ${det('health')}</header><div class="w-b" id="wHealth"><p class="pv-dim">Loading…</p></div></section>
      <section class="widget"><header>Capacity ${det('capacity')}</header><div class="w-b" id="wCap"><p class="pv-dim">Loading…</p></div></section>
      <section class="widget"><header>Cluster <a class="w-det" href="#tab=admin/system">Details</a></header><div class="w-b" id="wCluster"><p class="pv-dim">Loading…</p></div></section>
      <section class="widget w-wide"><header>API coverage <span class="w-sub">${OPS.length} operations in this spec</span></header><div class="w-b">
        ${coverage.map(({ s, n }) => `<a class="cov" href="#sec=${s.id}"><span class="cov-l">${NAV.icon(s.icon || 'terminal', 15)} ${esc(s.title)}</span>
          <span class="cov-bar"><span style="width:${(n / max * 100).toFixed(1)}%" class="${s.id === 'hidden' ? 'cov-h' : ''}"></span></span><span class="cov-n">${n}</span></a>`).join('')}
      </div></section>
    </div>`;
  if (!ACTIVE) { ['#wHealth', '#wCap', '#wCluster'].forEach(s => $(s).innerHTML = '<p class="pv-dim">No cluster selected.</p>'); return; }
  const get = p => fetch(HS(p), { headers: { Accept: 'application/json' } }).then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)));
  const [health, cntl] = await Promise.allSettled([get('/system/health'), get('/cntl')]);
  const h = health.value, c = Array.isArray(cntl.value) ? cntl.value[0] : cntl.value;
  if (!$('#wHealth')) return;
  // Health: green/yellow/red counts like the GUI
  if (h) {
    const circ = (n, k) => `<span class="hc hc-${k} ${n ? '' : 'hc-0'}">${n ?? 0}</span>`;
    const row = (label, cnt, href) => `<div class="h-row"><a href="${href}">${label}</a>${circ(cnt?.ok, 'ok')}${circ(cnt?.degraded, 'warn')}${circ(cnt?.failed, 'bad')}</div>`;
    const st = h.clusterState || c?.state;
    $('#wHealth').innerHTML = `<div class="h-row"><a href="#tab=admin/system">Cluster</a><span class="h-state">${okIcon(/DEGRADED|FAIL|DOWN/.test(st || '') ? 'warn' : 'good')} ${esc(stateText(st))}${h.clusterStateReason ? ` <span class="pv-dim">${esc(h.clusterStateReason)}</span>` : ''}</span></div>
      ${row('Remote Sites', h.remoteSiteCounts, '#tab=admin/sites')}${row('Product Nodes', h.productNodeCounts, '#tab=admin/system')}
      ${row('Storage Systems', h.storageSystemCounts, '#tab=infrastructure/storage-systems')}${row('Volumes', h.volumeCounts, '#tab=infrastructure/volumes')}
      ${row('Shares', h.shareCounts, '#tab=data/shares')}`;
    const sum = x => x ? (x.ok || 0) + (x.degraded || 0) + (x.failed || 0) : '—';
    var storage = `<div class="w-h">Storage</div><div class="tiles">
      <a href="#tab=infrastructure/storage-systems"><b>${sum(h.storageSystemCounts)}</b>Storage Systems</a><a href="#tab=infrastructure/volumes"><b>${sum(h.volumeCounts)}</b>Volumes</a>
      <a href="#tab=data/shares"><b>${sum(h.shareCounts)}</b>Shares</a><a href="#tab=admin/system"><b>${sum(h.productNodeCounts)}</b>Nodes</a></div>`;
  } else $('#wHealth').innerHTML = `<p class="err-inline">Couldn’t read /system/health: ${esc(health.reason?.message)}</p>`;
  // Capacity
  const cap = c?.nasCapacity?.total ? c.nasCapacity : c?.capacity;
  if (cap?.total) {
    const pct = cap.used / cap.total * 100;
    $('#wCap').innerHTML = `<div class="w-h">NAS Total <span class="w-sub">${Pretty.value('total', cap.total, true)} Total</span></div>
      <div class="capbar"><span style="width:${Math.max(pct, .6).toFixed(2)}%"></span></div>
      <div class="cap-leg"><span><i class="lg-used"></i>${Pretty.value('used', cap.used, true)} used</span><span><i class="lg-free"></i>${(100 - pct).toFixed(1)}% free</span></div>${storage || ''}`;
  } else $('#wCap').innerHTML = (cntl.reason ? `<p class="err-inline">Couldn’t read /cntl: ${esc(cntl.reason.message)}</p>` : '<p class="pv-dim">No capacity reported.</p>') + (storage || '');
  // Cluster facts
  if (c) {
    const s = STATUS.get(ACTIVE) || {};
    const ips = a => (a || []).map(x => `${x.address}${x.prefixLength ? '/' + x.prefixLength : ''}`).join(', ') || '—';
    const facts = [['Cluster ID', c.uoid?.uuid ? `<code class="uuid" data-copy="${esc(c.uoid.uuid)}">${esc(c.uoid.uuid)}</code>` : '—'], ['Name', esc(c.name || '—')],
      ['Software', esc(s.version || '—')], ['Management IPs', esc(ips(c.mgmtIps))], ['Cluster floating IPs', esc(ips(c.clusterFloatingIps))],
      ['Time zone', esc(c.timezone || '—')], ['Prometheus exporters', c.prometheusEnabled ? '<span class="toggle on">Enabled</span>' : '<span class="toggle">Disabled</span>']];
    $('#wCluster').innerHTML = `<dl class="facts">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
  } else $('#wCluster').innerHTML = `<p class="err-inline">Couldn’t read /cntl: ${esc(cntl.reason?.message)}</p>`;
}

// ---------------------------------------------------------------- top bar: clock + sidebar state
function tick() {
  const el = $('#clock'); if (!el) return;
  el.textContent = new Date().toLocaleString(undefined, { weekday: 'long', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
}
tick(); setInterval(tick, 20000);
if (store.get(SB_KEY, innerWidth > 900) === false) $('#app').classList.add('nosb');
