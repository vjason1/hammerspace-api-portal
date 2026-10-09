/* Schema-driven form builder. Turns a swagger schema into a fillable form with descriptions.
 * Every component exposes { el, get(), set(v) }. get() returns undefined when nothing was entered,
 * so only fields the user touched are sent. When a form is loaded with an existing object (set),
 * hidden/system fields are preserved and edited fields are overlaid. */
'use strict';

const Forms = (() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const h = (tag, attrs = {}, html = '') => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v); e.innerHTML = html; return e; };
  let SPEC, fetchList;
  const listCache = new Map();
  const REFS = new WeakSet(); // objects that reference another entity (node, role, user...) — merged by replacement, IDs stripped across clusters
  const asRef = o => { if (o && typeof o === 'object') REFS.add(o); return o; };

  function init(spec, fetcher) { SPEC = spec; fetchList = fetcher; listCache.clear(); }

  // ---------- schema utilities
  const refName = s => s && s.$ref ? s.$ref.split('/').pop() : null;
  function resolve(s) {
    const name = refName(s);
    if (name) return { ...resolve(SPEC.definitions[name] || {}), 'x-name': name };
    if (s && s.allOf) {
      // swagger-codegen emits allOf [<unrelated base>, {own properties}] — the inline part is authoritative
      const inline = s.allOf.filter(p => !p.$ref);
      const parts = inline.length ? inline : s.allOf.map(resolve);
      return { type: 'object', properties: Object.assign({}, ...parts.map(p => p.properties || {})) };
    }
    return s || {};
  }
  // Enum-wrapper types like NetworkInterfaceRole { MGMT: enum[...], DATA: enum[...] } are really plain enums
  function wrappedEnum(s) {
    const r = resolve(s); const ps = r.properties && Object.values(r.properties);
    if (!ps || !ps.length || r.type === 'array') return null;
    const first = ps[0].enum;
    if (first && ps.every(p => p.enum && p.enum.join() === first.join()) && Object.keys(r.properties).every(k => first.includes(k))) return first;
    return null;
  }
  const OPAQUE = new Set(['List', 'Set', 'Array', 'JsonSerializable', 'HttpMethod', 'InputStream']);

  const BYTE_FIELD = /(capacity|bytes|sizeLimit|size)$/i;
  const MS_TIME_FIELD = /^(validFrom|validTo|nextSendTime|activationTime|expirationTime|clearTime)$/;
  const SECRET = /(password|secret|privateKey|community|clientSecret|bindSecret|passphrase)/i;
  const LONGTEXT = /(pem|cert$|certPem|csr|expression|tlsCaCert|preferences|publicKey|description)/i;

  function doc(schemaName, field) {
    return META.FIELD_DOCS[`${schemaName}.${field}`] || META.FIELD_DOCS[field] || '';
  }

  // ---------- leaf inputs
  function textInput(field, s) {
    let el;
    if (LONGTEXT.test(field)) el = h('textarea', { rows: 4, class: 'f-text mono-ish', spellcheck: 'false' });
    else el = h('input', { type: SECRET.test(field) ? 'password' : 'text', autocomplete: SECRET.test(field) ? 'new-password' : 'off' });
    if (s.format === 'date-time') el.placeholder = 'YYYY-MM-DDTHH:MM:SS';
    // fields holding another object's UUID get the object picker (name <-> UUID)
    if (/[a-z]Uuid$/.test(field) && typeof OBJ !== 'undefined') {
      const w = OBJ.attach(el, { fill: 'uuid' });
      return { el: w, get: () => el.value === '' ? undefined : el.value, set: v => { el.value = v ?? ''; w.refresh(); } };
    }
    return { el, get: () => el.value === '' ? undefined : el.value, set: v => { el.value = v ?? ''; } };
  }

  function numberInput(field, s) {
    const isInt = s.type === 'integer';
    if (BYTE_FIELD.test(field) && s.format === 'int64') return bytesInput();
    if (MS_TIME_FIELD.test(field)) return timeInput();
    const el = h('input', { type: 'number', step: isInt ? '1' : 'any', inputmode: 'decimal' });
    const unit = /Secs?$|Seconds$/.test(field) ? 'seconds' : /Ms$|Millis$/.test(field) ? 'milliseconds' : /Days$/.test(field) ? 'days' : /Percent/i.test(field) ? '%' : '';
    const wrap = h('div', { class: 'f-inline' }); wrap.appendChild(el);
    if (unit) wrap.appendChild(h('span', { class: 'f-unit' }, unit));
    return { el: wrap, get: () => el.value === '' ? undefined : Number(el.value), set: v => { el.value = v ?? ''; } };
  }

  const UNITS = [['B', 1], ['KB', 1024], ['MB', 1024 ** 2], ['GB', 1024 ** 3], ['TB', 1024 ** 4], ['PB', 1024 ** 5]];
  function bytesInput() {
    const wrap = h('div', { class: 'f-inline' });
    const num = h('input', { type: 'number', step: 'any', min: '0' });
    const sel = h('select', { class: 'f-unit-sel' }, UNITS.map(([u]) => `<option ${u === 'GB' ? 'selected' : ''}>${u}</option>`).join(''));
    wrap.append(num, sel);
    return {
      el: wrap,
      get: () => num.value === '' ? undefined : Math.round(Number(num.value) * UNITS.find(u => u[0] === sel.value)[1]),
      set: v => {
        if (v == null || v === '') { num.value = ''; return; }
        const u = [...UNITS].reverse().find(([, m]) => v >= m && v % (m / 100) === 0) || UNITS[0];
        sel.value = u[0]; num.value = +(v / u[1]).toFixed(2);
      },
    };
  }

  function timeInput() {
    const el = h('input', { type: 'datetime-local', step: '1' });
    return {
      el,
      get: () => el.value ? new Date(el.value).getTime() : undefined,
      set: v => { if (!v) { el.value = ''; return; } const d = new Date(v); el.value = new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 19); },
    };
  }

  function enumSelect(values) {
    const el = h('select', {}, `<option value="">— not set —</option>${values.map(v => `<option value="${esc(v)}">${esc(prettyEnum(v))}</option>`).join('')}`);
    return { el, get: () => el.value || undefined, set: v => { el.value = v ?? ''; } };
  }
  const prettyEnum = v => String(v).replace(/^_/, '').replace(/_/g, ' ');

  function boolInput() {
    const wrap = h('div', { class: 'seg', role: 'radiogroup' });
    let val;
    const opts = [['', 'Not set'], ['true', 'Yes'], ['false', 'No']];
    wrap.innerHTML = opts.map(([v, l]) => `<button type="button" data-v="${v}" role="radio" aria-checked="${v === ''}">${l}</button>`).join('');
    const paint = () => wrap.querySelectorAll('button').forEach(b => b.setAttribute('aria-checked', b.dataset.v === (val === undefined ? '' : String(val))));
    wrap.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; val = b.dataset.v === '' ? undefined : b.dataset.v === 'true'; paint(); wrap.dispatchEvent(new Event('input', { bubbles: true })); });
    return { el: wrap, get: () => val, set: v => { val = v == null ? undefined : !!v; paint(); } };
  }

  function cidrInput() {
    const el = h('input', { type: 'text', placeholder: '10.0.0.10/24', autocomplete: 'off' });
    return {
      el,
      get: () => {
        const v = el.value.trim(); if (!v) return undefined;
        const [address, pl] = v.split('/');
        return pl !== undefined && pl !== '' ? { address, prefixLength: Number(pl) } : { address };
      },
      set: v => { el.value = !v ? '' : typeof v === 'string' ? v : `${v.address ?? ''}${v.prefixLength != null ? '/' + v.prefixLength : ''}`; },
    };
  }

  function jsonInput(placeholder = '{ }') {
    const el = h('textarea', { rows: 3, class: 'f-text mono-ish', spellcheck: 'false', placeholder });
    return {
      el,
      get: () => { const t = el.value.trim(); if (!t) return undefined; try { return JSON.parse(t); } catch { return t; } },
      set: v => { el.value = v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v, null, 2); },
    };
  }

  function anyValueInput() {
    // free value: numbers / booleans / JSON parsed, otherwise string
    const el = h('input', { type: 'text', placeholder: 'value' });
    return {
      el,
      get: () => { const t = el.value.trim(); if (!t) return undefined; try { return JSON.parse(t); } catch { return t; } },
      set: v => { el.value = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); },
    };
  }

  function checkboxGroup(values) {
    const wrap = h('div', { class: 'f-checks' });
    wrap.innerHTML = values.map(v => `<label class="f-check"><input type="checkbox" value="${esc(v)}"> ${esc(prettyEnum(v))}</label>`).join('');
    const boxes = () => [...wrap.querySelectorAll('input')];
    return {
      el: wrap,
      get: () => { const sel = boxes().filter(b => b.checked).map(b => b.value); return sel.length ? sel : undefined; },
      set: v => { const arr = (v || []).map(x => typeof x === 'object' && x ? Object.values(x)[0] : x); boxes().forEach(b => { b.checked = arr.includes(b.value); }); },
    };
  }

  // ---------- references to other entities
  function itemLabel(it) { return it.name ?? it.username ?? it.path ?? it.activationId ?? it.uoid?.uuid ?? it.uuid ?? ''; }
  function itemRef(it) {
    const r = {};
    if (it.uoid) r.uoid = { uuid: it.uoid.uuid };
    if (it.name != null) r.name = it.name; else if (it.username != null) r.username = it.username;
    if (it.internalId != null) r.internalId = it.internalId;
    return r;
  }
  async function loadList(endpoint) {
    if (!listCache.has(endpoint)) listCache.set(endpoint, fetchList(endpoint).catch(() => []));
    return listCache.get(endpoint);
  }
  let dlSeq = 0;
  function datalistFor(endpoint, input, onLoaded) {
    const id = `dl${++dlSeq}`; const dl = h('datalist', { id }); input.setAttribute('list', id);
    loadList(endpoint).then(items => {
      dl.innerHTML = items.map(it => `<option value="${esc(itemLabel(it))}">${esc([it.path && it.name ? it.path : it.nodeType || it.type || '', it.uoid?.uuid].filter(Boolean).join(' · '))}</option>`).join('');
      input.placeholder = items.length ? `Choose or type (${items.length} available)` : 'Type a name';
      onLoaded && onLoaded(items);
    });
    return dl;
  }
  function refPicker(endpoint) {
    const wrap = h('div', { class: 'f-ref' });
    const input = h('input', { type: 'text', autocomplete: 'off', placeholder: 'Loading…' });
    wrap.append(input, datalistFor(endpoint, input));
    let base;
    return {
      el: wrap,
      get: () => {
        const v = input.value.trim(); if (!v) return undefined;
        if (base && itemLabel(base) === v) return base;
        const items = listCache.get(endpoint);
        return items.then ? undefined : undefined; // replaced below
      },
      _endpoint: endpoint, _input: input, _base: v => { base = v; },
      set: v => { base = v || undefined; input.value = v ? itemLabel(v) : ''; },
    };
  }
  // refPicker needs the resolved list synchronously at get(); keep a resolved copy
  const resolved = new Map();
  async function preload(endpoint) { const items = await loadList(endpoint); resolved.set(endpoint, items); return items; }
  function makeRef(endpoint) {
    preload(endpoint);
    const c = refPicker(endpoint);
    c.get = () => {
      const v = c._input.value.trim(); if (!v) return undefined;
      const it = (resolved.get(endpoint) || []).find(x => itemLabel(x) === v || x.uoid?.uuid === v);
      return asRef(it ? itemRef(it) : (/^[0-9a-f-]{36}$/i.test(v) ? { uoid: { uuid: v } } : { name: v }));
    };
    return c;
  }
  function multiRef(endpoint) {
    preload(endpoint);
    const wrap = h('div', { class: 'f-multi' });
    const chips = h('div', { class: 'f-chips' });
    const input = h('input', { type: 'text', autocomplete: 'off', placeholder: 'Loading…' });
    const add = h('button', { type: 'button', class: 'btn small' }, 'Add');
    const row = h('div', { class: 'f-inline' }); row.append(input, add);
    wrap.append(chips, row, datalistFor(endpoint, input));
    let picked = [];
    const draw = () => {
      chips.innerHTML = picked.map((p, i) => `<span class="f-chip">${esc(itemLabel(p))}<button type="button" data-i="${i}" aria-label="Remove">×</button></span>`).join('') || '<span class="f-none">None selected</span>';
    };
    const commit = () => {
      const v = input.value.trim(); if (!v) return;
      const it = (resolved.get(endpoint) || []).find(x => itemLabel(x) === v);
      picked.push(asRef(it ? itemRef(it) : { name: v })); input.value = ''; draw(); wrap.dispatchEvent(new Event('input', { bubbles: true }));
    };
    add.addEventListener('click', commit);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
    input.addEventListener('change', () => { if ((resolved.get(endpoint) || []).some(x => itemLabel(x) === input.value.trim())) commit(); });
    chips.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) { picked.splice(+b.dataset.i, 1); draw(); } });
    draw();
    return { el: wrap, get: () => picked.length ? picked.map(asRef) : undefined, set: v => { picked = (v || []).map(x => typeof x === 'object' ? x : { name: x }); draw(); } };
  }

  // ---------- composite
  function listOf(makeItem, addLabel = 'Add') {
    const wrap = h('div', { class: 'f-list' });
    const rows = h('div', { class: 'f-list-rows' });
    const add = h('button', { type: 'button', class: 'btn small f-add' }, `+ ${addLabel}`);
    wrap.append(rows, add);
    let items = [];
    const addRow = v => {
      const c = makeItem();
      const r = h('div', { class: 'f-list-row' });
      const rm = h('button', { type: 'button', class: 'btn small ghost f-rm', 'aria-label': 'Remove row', title: 'Remove' }, '×');
      r.append(c.el, rm);
      rm.addEventListener('click', () => { items = items.filter(x => x !== c); r.remove(); });
      rows.appendChild(r); items.push(c);
      if (v !== undefined) c.set(v);
      return c;
    };
    add.addEventListener('click', () => { const c = addRow(); c.el.querySelector('input,select,textarea')?.focus(); });
    return {
      el: wrap,
      get: () => { const vals = items.map(c => c.get()).filter(v => v !== undefined); return vals.length ? vals : undefined; },
      set: v => { rows.innerHTML = ''; items = []; (v || []).forEach(x => addRow(x)); },
    };
  }

  function keyValue() {
    return (() => {
      const lst = listOf(() => {
        const r = h('div', { class: 'f-kv' });
        const k = h('input', { type: 'text', placeholder: 'key' }); const v = h('input', { type: 'text', placeholder: 'value' });
        r.append(k, v);
        return { el: r, get: () => k.value.trim() ? [k.value.trim(), v.value] : undefined, set: p => { k.value = p[0]; v.value = p[1] ?? ''; } };
      }, 'Add entry');
      return { el: lst.el, get: () => { const p = lst.get(); return p ? Object.fromEntries(p) : undefined; }, set: o => lst.set(o ? Object.entries(o) : []) };
    })();
  }

  // Object with its own rows. depth 0 = the request body itself.
  function objectForm(schema, depth, parentName) {
    const r = resolve(schema);
    const sName = r['x-name'] || parentName || '';
    const props = r.properties || {};
    const wrap = h('div', { class: depth === 0 ? 'f-form' : 'f-sub' });
    const children = {};
    const dirty = new Set();
    const lead = [], normal = [], adv = [];
    let hiddenCount = 0;
    for (const [k, v] of Object.entries(props)) {
      if (META.isSystem(sName, k) || v.readOnly) { hiddenCount++; continue; }
      (META.LEAD.includes(k) ? lead : META.ADVANCED.has(k) ? adv : normal).push(k);
    }
    lead.sort((a, b) => META.LEAD.indexOf(a) - META.LEAD.indexOf(b));
    const addRows = (keys, into) => keys.forEach(k => {
      const fs = META.FIELD_TYPE_OVERRIDES[`${sName}.${k}`] || props[k];
      const comp = field(k, fs, depth + 1, sName);
      if (!comp) { hiddenCount++; return; }
      children[k] = comp;
      const r = row(k, fs, comp, sName);
      const mark = () => dirty.add(k);
      r.addEventListener('input', mark); r.addEventListener('change', mark);
      r.addEventListener('click', e => { if (e.target.closest('button')) mark(); });
      into.appendChild(r);
    });
    addRows([...lead, ...normal], wrap);
    if (adv.length) {
      const det = h('details', { class: 'f-adv' }, `<summary>Advanced settings <span class="f-dim">${adv.length}</span></summary>`);
      const body = h('div', { class: 'f-adv-body' }); det.appendChild(body); addRows(adv, body); wrap.appendChild(det);
    }
    if (!Object.keys(children).length) wrap.innerHTML = '<p class="f-dim">No editable fields.</p>';
    let base;
    return {
      el: wrap, hiddenCount, children,
      get: () => {
        const out = base ? JSON.parse(JSON.stringify(base)) : {};
        let any = !!base;
        for (const [k, c] of Object.entries(children)) { const v = c.get(); if (v !== undefined) { out[k] = v; any = true; } }
        return any ? out : undefined;
      },
      // Only the fields the user touched since the last set() — used to apply one change to many clusters
      getDelta: () => {
        const out = {};
        for (const k of dirty) { const c = children[k]; if (!c) continue; const v = c.getDelta ? c.getDelta() : c.get(); if (v !== undefined) out[k] = v; }
        return Object.keys(out).length ? out : undefined;
      },
      set: v => {
        base = v && typeof v === 'object' ? v : undefined;
        for (const [k, c] of Object.entries(children)) c.set(v ? v[k] : undefined);
        dirty.clear();
      },
    };
  }

  // Pick the right component for a field
  function field(name, s, depth, parentName) {
    if (!s) return null;
    const ref = refName(s);
    if (ref) {
      if (META.REF_SOURCES[ref] && depth > 0) return makeRef(META.REF_SOURCES[ref]);
      if (ref === 'IpAddressView' || ref === 'IpAddress') return cidrInput();
      if (ref === 'UoidView' || ref === 'Uoid') { const t = textInput('uuid', {}); return { el: t.el, get: () => t.get() && { uuid: t.get() }, set: v => t.set(v?.uuid) }; }
      const we = wrappedEnum(s); if (we) return enumSelect(we);
      if (OPAQUE.has(ref)) return jsonInput();
      if (depth > 4) return jsonInput();
      const sub = objectForm(s, depth, ref);
      return collapsible(sub, name);
    }
    if (s.type === 'array') {
      const it = s.items || {};
      const itRef = refName(it);
      const we = itRef && wrappedEnum(it);
      if (it.enum || we) return checkboxGroup(it.enum || we);
      if (itRef && META.REF_SOURCES[itRef] && !(depth === 0)) return multiRef(META.REF_SOURCES[itRef]);
      if (itRef === 'IpAddressView' || itRef === 'IpAddress') return listOf(cidrInput, 'Add address');
      if (itRef && !OPAQUE.has(itRef)) return listOf(() => cardWrap(objectForm(it, depth, itRef)), `Add ${singular(name)}`);
      if (it.type === 'integer' || it.type === 'number') return listOf(() => numberInput(name, it), 'Add value');
      if (it.type === 'object' || OPAQUE.has(itRef)) return listOf(() => jsonInput(), 'Add item');
      return listOf(() => textInput(name, it), 'Add value');
    }
    if (s.additionalProperties) return keyValue();
    if (s.enum) return enumSelect(s.enum);
    switch (s.type) {
      case 'boolean': return boolInput();
      case 'integer': case 'number': return numberInput(name, s);
      case 'string': return textInput(name, s);
      case 'object': return name === 'value' ? anyValueInput() : jsonInput();
    }
    return textInput(name, s);
  }
  const singular = n => { const l = Pretty.label(n).toLowerCase(); return l.endsWith('ies') ? l.slice(0, -3) + 'y' : l.endsWith('ses') ? l.slice(0, -2) : l.endsWith('s') ? l.slice(0, -1) : 'item'; };

  function cardWrap(sub) { const c = h('div', { class: 'f-card' }); c.appendChild(sub.el); return { el: c, get: sub.get, set: sub.set }; }
  function collapsible(sub, name) {
    const det = h('details', { class: 'f-group' }, `<summary>${esc(Pretty.label(name))} <span class="f-dim f-sum"></span></summary>`);
    det.appendChild(sub.el);
    const sum = det.querySelector('.f-sum');
    const refresh = () => { const v = sub.get(); sum.textContent = v ? `${Object.keys(v).length} set` : 'not set'; };
    det.addEventListener('input', refresh); det.addEventListener('change', refresh); refresh();
    return { el: det, get: sub.get, getDelta: sub.getDelta, set: v => { sub.set(v); refresh(); if (v && Object.keys(v).length) det.open = true; } };
  }

  function typeHint(s) {
    const r = refName(s);
    if (r === 'IpAddressView') return 'IP/prefix';
    if (s.type === 'array') return 'list';
    if (s.enum) return 'choice';
    if (r) return wrappedEnum(s) ? 'choice' : 'group';
    if (s.additionalProperties) return 'key/value';
    return { integer: 'number', number: 'number', boolean: 'yes/no', string: 'text' }[s.type] || '';
  }

  function row(key, s, comp, sName) {
    const d = doc(sName, key);
    const r = h('div', { class: 'f-row' + (comp.el.tagName === 'DETAILS' ? ' f-row-group' : '') });
    if (comp.el.tagName === 'DETAILS') {
      const cg = typeof CLI !== 'undefined' ? CLI.fieldHtml(sName, key, d) : '';
      if (d || cg) comp.el.querySelector('summary').insertAdjacentHTML('afterend', `${d ? `<p class="f-desc">${esc(d)}</p>` : ''}${cg ? `<div class="f-desc">${cg}</div>` : ''}`);
      r.appendChild(comp.el);
      return r;
    }
    const id = `f${++dlSeq}`;
    const ctl = comp.el.matches('input,select,textarea') ? comp.el : comp.el.querySelector('input,select,textarea');
    if (ctl) ctl.id = id;
    r.innerHTML = `<label class="f-label" for="${id}">${esc(Pretty.label(key))}<span class="f-key">${esc(key)} · ${esc(typeHint(s))}</span></label>`;
    const right = h('div', { class: 'f-control' });
    right.appendChild(comp.el);
    if (d) right.appendChild(h('p', { class: 'f-desc' }, esc(d)));
    const cli = typeof CLI !== 'undefined' ? CLI.fieldHtml(sName, key, d) : '';
    if (cli) right.insertAdjacentHTML('beforeend', cli);
    r.appendChild(right);
    return r;
  }

  // Public: build a form for a request body schema
  function build(schema) {
    const s = schema || {};
    if (s.type === 'array') {
      const comp = field('items', s, 0, '');
      const wrap = h('div', { class: 'f-form' }); wrap.appendChild(comp.el);
      return { el: wrap, get: comp.get, getDelta: comp.get, set: comp.set, hiddenCount: 0 };
    }
    return objectForm(s, 0);
  }

  // Copy a value for another cluster: entity references keep only their name (IDs differ per cluster)
  function portable(v) {
    if (Array.isArray(v)) return v.map(portable);
    if (v && typeof v === 'object') {
      if (REFS.has(v)) { const r = {}; if (v.name != null) r.name = v.name; else if (v.username != null) r.username = v.username; else if (v.uoid) r.uoid = v.uoid; return r; }
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, portable(x)]));
    }
    return v;
  }
  // Apply a delta onto a cluster's current object: plain objects merge, references/arrays/values replace
  function merge(base, delta) {
    if (delta === undefined) return base;
    if (!delta || typeof delta !== 'object' || Array.isArray(delta) || REFS.has(delta) || !base || typeof base !== 'object' || Array.isArray(base)) return portable(delta);
    const out = { ...base };
    for (const [k, v] of Object.entries(delta)) out[k] = merge(base[k], v);
    return out;
  }

  return { init, build, resolve, refName, preload, itemLabel, portable, merge };
})();
