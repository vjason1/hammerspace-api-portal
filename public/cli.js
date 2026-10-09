/* Explanations from the Hammerspace Command Line Reference (data in cli-docs.js):
 * per-field and per-parameter option help, the CLI equivalent of each API operation, and CLI names for search. */
'use strict';

const CLI = (() => {
  const D = typeof CLI_DOCS !== 'undefined' ? CLI_DOCS : { version: '', commands: {}, ops: {}, fields: {}, params: {} };
  const e = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const desc = (cmd, opt) => D.commands[cmd]?.options?.[opt] || '';
  // Long option help: put "--x a --x b" style examples on their own lines
  const fmt = t => e(t).replace(/\n/g, '<br>').replace(/\s(--[a-z0-9-]+ )/g, '<br>$1').replace(/\s(Example:?|Examples:?|Format:?)\s/g, '<br><b>$1</b> ');

  // pairs: [[cmd, opt], ...] -> HTML block under a form field
  function block(pairs, existing) {
    if (!pairs || !pairs.length) return '';
    const ex = norm(existing);
    const items = [], seen = new Set();
    for (const [cmd, opt] of pairs) {
      const d = desc(cmd, opt); if (!d) continue;
      const key = norm(d); if (seen.has(key) || (ex && (key === ex || ex.includes(key)))) continue;
      seen.add(key); items.push({ cmd, opt, d });
    }
    if (!items.length) return '';
    const title = `<span class="cli-tag" title="From the CLI’s built-in help and the Hammerspace ${e(D.version)} Command Line Reference">CLI</span>`;
    if (items.length === 1 && items[0].d.length <= 240) {
      const it = items[0];
      return `<p class="cli-doc">${title} <code title="${e(it.cmd)}">--${e(it.opt)}</code> ${fmt(it.d)}</p>`;
    }
    const lead = items.map(it => `--${it.opt}`).slice(0, 4).join(', ') + (items.length > 4 ? ` +${items.length - 4}` : '');
    const first = items[0].d;
    return `<details class="cli-doc"><summary>${title} <code>${e(lead)}</code> <span class="cli-lead">${e(first.length > 140 ? first.slice(0, 137) + '…' : first)}</span></summary>
      <dl>${items.map(it => `<dt><code>--${e(it.opt)}</code> <span class="pv-dim">${e(it.cmd)}</span></dt><dd>${fmt(it.d)}</dd>`).join('')}</dl></details>`;
  }
  const fieldHtml = (schema, key, existing) => block(D.fields[`${schema}.${key}`], existing);
  const paramHtml = (opId, name, existing) => block(D.params[opId]?.[name], existing);
  // A field without its own description borrows the CLI text as the main description
  const fieldText = (schema, key) => { const p = D.fields[`${schema}.${key}`]; return p ? desc(p[0][0], p[0][1]) : ''; };

  const forOp = opId => D.ops[opId] || [];
  const searchText = opId => forOp(opId).join(' ');

  // "CLI equivalent" card on an operation page
  function opCard(opId) {
    const cmds = forOp(opId).map(c => [c, D.commands[c]]).filter(([, v]) => v);
    if (!cmds.length) return '';
    return `<div class="card cli-card"><h3><span class="cli-tag">CLI</span> Command-line equivalent<span class="sp"></span></h3>
      <div class="body">${cmds.map(([name, c]) => {
        const opts = Object.entries(c.options);
        return `<div class="cli-cmd"><div class="cli-head"><code class="cli-name">${e(name)}</code> <span class="pv-dim">${e(c.chapter)}</span><span class="cli-src">Source: ${e(D.sources?.[c.source] || 'Command Line Reference')}</span></div>
          <p class="cli-sum">${e(c.summary)}</p>
          ${c.example ? `<pre class="cli-ex">${e(c.example.replace(/ (?=--)/g, ' \\\n    '))}</pre>` : ''}
          ${opts.length ? `<details class="cli-opts"><summary>${opts.length} option${opts.length === 1 ? '' : 's'}</summary><dl>${opts.map(([o, d]) => `<dt><code>--${e(o)}</code></dt><dd>${fmt(d)}</dd>`).join('')}</dl></details>` : ''}</div>`;
      }).join('')}</div></div>`;
  }
  const chips = opId => forOp(opId).map(c => `<code class="cli-chip">${e(c)}</code>`).join(' ');

  return { fieldHtml, paramHtml, fieldText, forOp, searchText, opCard, chips, version: D.version, commandCount: Object.keys(D.commands).length };
})();
