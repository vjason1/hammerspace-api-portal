/* Multi-cluster screens: cluster switcher, Clusters dashboard, Portal users, Audit log,
 * and the target picker used to push a change to several clusters at once. */
'use strict';

const STATUS = new Map(); // clusterId -> probe result (live, not persisted)

// ---------------------------------------------------------------- switcher
function renderSwitcher() {
  const sel = $('#clusterSel'); if (!sel) return;
  sel.innerHTML = CLUSTERS.length
    ? CLUSTERS.map(c => `<option value="${c.id}" ${c.id === ACTIVE ? 'selected' : ''}>${esc(clusterLabel(c))}${c.tags?.length ? ` · ${esc(c.tags.join(', '))}` : ''}</option>`).join('') + '<option value="__manage">Manage clusters…</option>'
    : '<option value="">No clusters yet</option><option value="__manage">Add a cluster…</option>';
  const st = STATUS.get(ACTIVE);
  $('#swDot').className = 'dot ' + (!ACTIVE ? 'dot-none' : !st ? 'dot-unknown' : st.ok ? (/UP|HA/.test(st.state || 'UP') ? 'dot-ok' : 'dot-warn') : 'dot-bad');
  $('#swDot').title = !st ? 'Status not checked yet' : st.ok ? `State ${st.state || 'unknown'}` : st.error;
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('current', location.hash === `#${a.dataset.nav}`));
  const pr = $('.ph-right'); if (pr) pr.innerHTML = clusterStatusHtml();
  if (ACTIVE && !STATUS.has(ACTIVE)) probeCluster(ACTIVE);
}
$('#clusterSel').addEventListener('change', e => {
  if (e.target.value === '__manage') { renderSwitcher(); location.hash = 'clusters'; return; }
  setActive(e.target.value);
  if (location.hash === '#extract') renderExtract();
});
window.addEventListener('hashchange', renderSwitcher);
document.addEventListener('click', e => { const m = $('.usermenu'); if (m && m.open && !m.contains(e.target)) m.open = false; });

const PROBING = new Map();
function probeCluster(id) {
  if (PROBING.has(id)) return PROBING.get(id);
  const p = (async () => {
    try { const r = await portal('POST', `clusters/${id}/test`); STATUS.set(id, r); }
    catch (e) { STATUS.set(id, { ok: false, error: e.message }); }
    PROBING.delete(id);
    if (id === ACTIVE) renderSwitcher();
    return STATUS.get(id);
  })();
  PROBING.set(id, p);
  return p;
}

// ---------------------------------------------------------------- Clusters page
function renderClusters() {
  CURRENT = null; renderList(); renderSwitcher();
  $('#main').innerHTML = `
    <div class="op-head">
            <div class="sum">Clusters this portal manages. Credentials are stored encrypted on the portal; the portal signs in to each cluster for you. Pick the cluster to work on in the switcher at the top, or push a change to several at once from any operation.</div>
    </div>
    <div class="row" style="margin-bottom:12px">
      <button class="btn primary" id="btnAddCluster" type="button">+ Add Cluster</button>
      <button class="btn" id="btnRefresh" type="button">Refresh status</button>
      <input id="clFilter" type="search" placeholder="Filter by name, URL or tag" style="max-width:280px">
    </div>
    <div id="clEditor"></div>
    <div id="clTable"></div>`;
  portalHead('clusters');
  $('#btnAddCluster').addEventListener('click', () => clusterEditor(null));
  $('#btnRefresh').addEventListener('click', () => refreshAll());
  $('#clFilter').addEventListener('input', drawClusterTable);
  drawClusterTable();
  if (!CLUSTERS.length) clusterEditor(null);
  else refreshAll();
}

async function refreshAll() {
  CLUSTERS.forEach(c => STATUS.delete(c.id));
  drawClusterTable();
  await Promise.all(CLUSTERS.map(c => probeCluster(c.id).then(drawClusterTable)));
  CLUSTERS = await portal('GET', 'clusters'); drawClusterTable(); renderSwitcher();
}

function drawClusterTable() {
  const host = $('#clTable'); if (!host) return;
  if (!CLUSTERS.length) { host.innerHTML = `<div class="card"><div class="body"><p class="f-desc">No clusters yet. Add your first Hammerspace cluster above — you’ll need its management URL and an admin account.</p></div></div>`; return; }
  const q = ($('#clFilter')?.value || '').toLowerCase();
  const rows = CLUSTERS.filter(c => !q || `${c.name} ${c.url} ${c.clusterName} ${(c.tags || []).join(' ')}`.toLowerCase().includes(q));
  const cap = s => s?.capacity?.total ? `${Pretty.value('used', s.capacity.used, true)} / ${Pretty.value('total', s.capacity.total, true)}` : '—';
  host.innerHTML = `<div class="card"><div class="pv-scroll" style="border:0"><table class="pv-table cl-table"><thead><tr>
      <th>Cluster</th><th>Address</th><th>Status</th><th>Software</th><th>Nodes</th><th>Capacity</th><th>Tags</th><th></th></tr></thead><tbody>${
    rows.map(c => {
      const s = STATUS.get(c.id);
      const status = !s ? '<span class="pv-dim">checking…</span>'
        : s.ok ? `${Pretty.value('state', s.state || 'UP', true)} <span class="pv-dim">${s.ms} ms</span>`
        : `<span class="pill bad">UNREACHABLE</span><div class="cl-err">${esc(s.error)}</div>`;
      return `<tr class="${c.id === ACTIVE ? 'cl-active' : ''}">
        <td><b>${esc(c.name)}</b>${c.id === ACTIVE ? ' <span class="chip">active</span>' : ''}<div class="pv-dim">${esc(c.clusterName && c.clusterName !== c.name ? c.clusterName : '')}${c.clusterUuid ? ` <code class="uuid" title="${esc(c.clusterUuid)}">${esc(c.clusterUuid.slice(0, 8))}…</code>` : ''}</div></td>
        <td><code>${esc(c.url)}</code><div class="pv-dim">as ${esc(c.username)}${c.insecureTls ? '' : ' · verified TLS'}</div></td>
        <td>${status}</td>
        <td>${esc(s?.version || c.version || '—')}</td>
        <td>${s?.nodes ?? '—'}</td>
        <td>${cap(s)}</td>
        <td>${(c.tags || []).map(t => `<span class="chip">${esc(t)}</span>`).join(' ') || '<span class="pv-dim">—</span>'}</td>
        <td class="cl-actions">
          <button class="btn small" data-act="use" data-id="${c.id}" ${c.id === ACTIVE ? 'disabled' : ''}>Use</button>
          <button class="btn small ghost" data-act="test" data-id="${c.id}">Test</button>
          <button class="btn small ghost" data-act="edit" data-id="${c.id}">Edit</button>
          <button class="btn small ghost cl-del" data-act="del" data-id="${c.id}">Remove</button>
        </td></tr>`;
    }).join('')}</tbody></table></div></div>`;
  host.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => clusterAction(b.dataset.act, b.dataset.id)));
}

async function clusterAction(act, id) {
  const c = CLUSTERS.find(x => x.id === id);
  if (act === 'use') { setActive(id); drawClusterTable(); return; }
  if (act === 'test') { STATUS.delete(id); drawClusterTable(); await probeCluster(id); drawClusterTable(); return; }
  if (act === 'edit') { clusterEditor(c); return; }
  if (act === 'del') {
    if (!confirm(`Remove “${clusterLabel(c)}” from the portal?\n\nThis only forgets the cluster and its stored credentials — nothing on the cluster is changed.`)) return;
    await portal('DELETE', `clusters/${id}`);
    await loadClusters(); drawClusterTable();
  }
}

function clusterEditor(c) {
  const host = $('#clEditor');
  const edit = !!c;
  host.innerHTML = `<form class="card" id="clForm"><h3>${edit ? `Edit ${esc(c.name)}` : 'Add a cluster'}</h3><div class="body f-form">
    ${[
      ['name', 'Display name', 'text', edit ? c.name : '', 'How the cluster appears in the portal, e.g. “Prod East”. Leave blank to use the cluster’s own name.'],
      ['url', 'Management URL', 'url', edit ? c.url : (CONFIG.defaultTarget || ''), 'Address of the Anvil management interface, e.g. https://anvil.example.com:8443'],
      ['username', 'Admin user name', 'text', edit ? c.username : 'admin', 'Hammerspace account the portal uses to sign in to this cluster.'],
      ['password', 'Password', 'password', '', edit ? 'Leave blank to keep the stored password.' : 'Stored encrypted on the portal.'],
      ['tags', 'Tags', 'text', edit ? (c.tags || []).join(', ') : '', 'Optional, comma-separated, e.g. prod, east. Use tags to select groups of clusters when pushing changes.'],
      ['notes', 'Notes', 'text', edit ? (c.notes || '') : '', 'Optional.'],
    ].map(([k, l, t, v, d]) => `<div class="f-row"><label class="f-label" for="cl_${k}">${l}</label><div class="f-control">
      <input id="cl_${k}" name="${k}" type="${t}" value="${esc(v)}" ${k === 'url' || (k === 'username') ? 'required' : ''} autocomplete="${t === 'password' ? 'new-password' : 'off'}"><p class="f-desc">${d}</p></div></div>`).join('')}
    <div class="f-row"><div class="f-label">Certificates</div><div class="f-control">
      <label class="f-check"><input type="checkbox" id="cl_insecure" ${!edit || c.insecureTls ? 'checked' : ''}> Accept the cluster’s self-signed certificate</label>
      <p class="f-desc">Hammerspace clusters usually ship with a self-signed certificate. Untick if yours has a CA-signed one.</p></div></div>
    <div class="row" style="padding:12px 0">
      <button class="btn primary" type="submit">${edit ? 'Save changes' : 'Test & add cluster'}</button>
      ${edit ? '' : '<button class="btn" type="button" id="clSkip">Add without testing</button>'}
      <button class="btn ghost" type="button" id="clCancel">Cancel</button>
      <span class="f-dim" id="clMsg"></span>
    </div>
    <p class="err" id="clErr"></p>
  </div></form>`;
  const form = $('#clForm');
  const val = () => ({
    name: $('#cl_name').value.trim(), url: $('#cl_url').value.trim(), username: $('#cl_username').value.trim(), password: $('#cl_password').value,
    tags: $('#cl_tags').value.split(',').map(s => s.trim()).filter(Boolean), notes: $('#cl_notes').value, insecureTls: $('#cl_insecure').checked,
  });
  const save = async skipTest => {
    $('#clErr').textContent = ''; $('#clMsg').textContent = edit ? 'Saving…' : skipTest ? 'Saving…' : 'Signing in to the cluster…';
    form.querySelectorAll('button').forEach(b => { b.disabled = true; });
    try {
      const v = val();
      if (!edit && !skipTest && !v.password) throw new Error('Enter the password (or use “Add without testing”).');
      const r = edit ? await portal('PUT', `clusters/${c.id}`, v) : await portal('POST', 'clusters', { ...v, skipTest });
      if (r.probe) STATUS.set(r.id, r.probe);
      await loadClusters();
      if (!edit && CLUSTERS.length === 1) setActive(r.id, true);
      host.innerHTML = '';
      drawClusterTable(); renderSwitcher();
      if (edit) { STATUS.delete(c.id); drawClusterTable(); probeCluster(c.id).then(drawClusterTable); }
      else if (!r.probe) probeCluster(r.id).then(drawClusterTable);
    } catch (e) { $('#clErr').textContent = e.message; $('#clMsg').textContent = ''; }
    finally { form.querySelectorAll('button').forEach(b => { b.disabled = false; }); }
  };
  form.addEventListener('submit', e => { e.preventDefault(); save(false); });
  $('#clSkip')?.addEventListener('click', () => save(true));
  $('#clCancel').addEventListener('click', () => { host.innerHTML = ''; });
  (edit ? $('#cl_password') : $('#cl_name')).focus();
}

// ---------------------------------------------------------------- target picker (push to many clusters)
// Returns { el, get(): [clusterIds] }. Starts with only the active cluster selected.
function targetPicker(onChange) {
  const el = document.createElement('div');
  el.className = 'tp';
  const tags = [...new Set(CLUSTERS.flatMap(c => c.tags || []))].sort();
  el.innerHTML = `
    <div class="tp-head"><b>Run on</b>
      <span class="tp-quick"><button type="button" class="btn small ghost" data-q="active">Active only</button><button type="button" class="btn small ghost" data-q="all">All ${CLUSTERS.length}</button>${
        tags.map(t => `<button type="button" class="btn small ghost" data-q="tag:${esc(t)}">#${esc(t)}</button>`).join('')}</span></div>
    <div class="tp-list">${CLUSTERS.map(c => `<label class="f-check tp-item"><input type="checkbox" value="${c.id}" ${c.id === ACTIVE ? 'checked' : ''}>
      <span>${esc(clusterLabel(c))}</span>${(c.tags || []).map(t => `<span class="chip">${esc(t)}</span>`).join('')}</label>`).join('')}</div>`;
  const boxes = () => [...el.querySelectorAll('.tp-list input')];
  el.addEventListener('click', e => {
    const q = e.target.dataset?.q; if (!q) return;
    boxes().forEach(b => {
      const c = CLUSTERS.find(x => x.id === b.value);
      b.checked = q === 'all' ? true : q === 'active' ? b.value === ACTIVE : (c.tags || []).includes(q.slice(4));
    });
    onChange && onChange();
  });
  el.addEventListener('change', () => onChange && onChange());
  return { el, get: () => boxes().filter(b => b.checked).map(b => b.value) };
}

// ---------------------------------------------------------------- Portal users
async function renderUsers() {
  CURRENT = null; renderList(); renderSwitcher();
  $('#main').innerHTML = `<div class="op-head"><div class="sum">People who can sign in to this portal. Every portal user can use all registered clusters; their changes are recorded in the audit log under their name.</div></div>
    <div class="card"><h3>Accounts</h3><div class="body" id="usrList">Loading…</div></div>
    <form class="card" id="usrAdd"><h3>Add a portal user</h3><div class="body f-form">
      <div class="f-row"><label class="f-label" for="nu_name">User name</label><div class="f-control"><input id="nu_name" required autocomplete="off"></div></div>
      <div class="f-row"><label class="f-label" for="nu_pass">Password</label><div class="f-control"><input id="nu_pass" type="password" required autocomplete="new-password"><p class="f-desc">At least 8 characters.</p></div></div>
      <div class="row" style="padding:12px 0"><button class="btn primary" type="submit">Add user</button><span class="err" id="nu_err"></span></div></div></form>`;
  portalHead('users');
  const draw = async () => {
    const users = await portal('GET', 'users');
    $('#usrList').innerHTML = `<table class="pv-table"><thead><tr><th>User</th><th>Role</th><th>Created</th><th></th></tr></thead><tbody>${
      users.map(u => `<tr><td><b>${esc(u.username)}</b>${u.username === CONFIG.user.username ? ' <span class="chip">you</span>' : ''}</td><td>${esc(u.role)}</td><td>${u.created ? Pretty.value('created', u.created, true) : '—'}</td>
        <td class="cl-actions"><button class="btn small ghost" data-pw="${esc(u.username)}">Change password</button>${u.username !== CONFIG.user.username ? `<button class="btn small ghost cl-del" data-rm="${esc(u.username)}">Remove</button>` : ''}</td></tr>`).join('')}</tbody></table>`;
    $('#usrList').querySelectorAll('[data-pw]').forEach(b => b.addEventListener('click', async () => {
      const pw = prompt(`New password for ${b.dataset.pw} (at least 8 characters):`); if (!pw) return;
      try { await portal('PUT', `users/${encodeURIComponent(b.dataset.pw)}/password`, { password: pw }); alert('Password changed.'); } catch (e) { alert(e.message); }
    }));
    $('#usrList').querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm(`Remove portal user ${b.dataset.rm}?`)) return;
      try { await portal('DELETE', `users/${encodeURIComponent(b.dataset.rm)}`); draw(); } catch (e) { alert(e.message); }
    }));
  };
  $('#usrAdd').addEventListener('submit', async e => {
    e.preventDefault(); $('#nu_err').textContent = '';
    try { await portal('POST', 'users', { username: $('#nu_name').value.trim(), password: $('#nu_pass').value }); e.target.reset(); draw(); }
    catch (err) { $('#nu_err').textContent = err.message; }
  });
  draw();
}

// ---------------------------------------------------------------- Audit log
async function renderAudit() {
  CURRENT = null; renderList(); renderSwitcher();
  $('#main').innerHTML = `<div class="op-head"><div class="sum">Every change made through the portal (all non-read API calls, cluster and user changes, uploads), newest first. Calls from one multi-cluster push share a batch ID.</div></div>
    <div class="row" style="margin-bottom:10px"><input id="auFilter" type="search" placeholder="Filter by user, cluster, path, batch…" style="max-width:340px"><button class="btn" id="auReload" type="button">Reload</button>
      <a class="btn ghost" id="auDl" download="portal-audit.json">Download</a></div>
    <div class="card"><div class="pv-scroll" style="border:0" id="auTable">Loading…</div></div>`;
  portalHead('audit');
  let rows = [];
  const draw = () => {
    const q = $('#auFilter').value.toLowerCase();
    const shown = rows.filter(r => !q || JSON.stringify(r).toLowerCase().includes(q));
    $('#auTable').innerHTML = shown.length ? `<table class="pv-table"><thead><tr><th>When</th><th>User</th><th>Action</th><th>Cluster</th><th>Request</th><th>Result</th><th>Batch</th></tr></thead><tbody>${
      shown.map(r => `<tr><td style="white-space:nowrap">${Pretty.value('time', Date.parse(r.at), true)}</td><td>${esc(r.user)}</td><td>${esc(r.action)}</td>
        <td>${esc(r.clusterName || r.name || '')}</td>
        <td>${r.method ? `<span class="m m-${r.method.toLowerCase()}">${esc(r.method)}</span> <code>${esc(r.path)}</code>` : esc(r.target || r.file || r.url || '')}</td>
        <td>${r.error ? `<span class="pill bad">ERROR</span> ${esc(r.error)}` : r.status ? `<span class="s${String(r.status)[0]}">${r.status}</span>` : ''}</td>
        <td>${r.batch ? `<code>${esc(r.batch)}</code>` : ''}</td></tr>`).join('')}</tbody></table>` : '<p class="pv-dim" style="padding:14px">Nothing recorded yet.</p>';
  };
  const load = async () => { rows = await portal('GET', 'audit?n=1000'); $('#auDl').href = URL.createObjectURL(new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' })); draw(); };
  $('#auFilter').addEventListener('input', draw); $('#auReload').addEventListener('click', load);
  load();
}
