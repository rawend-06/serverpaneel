/* Databases: PostgreSQL, MySQL/MariaDB (in Docker) en SQLite – tabellen bekijken, query's uitvoeren, backups maken. */
import { $, esc, icon, api, toast, fail, fmtBytes, ago, emptyState, ls } from '../core.js';

const ENGINE = { postgres: 'PostgreSQL', mysql: 'MySQL / MariaDB', sqlite: 'SQLite' };

export default async function databasesPage(root, ctx) {
  let all = null, cur = null, info = null, db = '', write = false, last = null;
  root.innerHTML = `
    <div class="top"><a class="iconbtn back" href="#/meer" aria-label="Terug">${icon('left')}</a><div class="grow"><h1>Databases</h1><p>PostgreSQL, MySQL/MariaDB en SQLite – bekijken, query's en backups</p></div>
      <div class="actions"><a class="btn pri keep" href="#/apps">${icon('plus', 'sm')}<span class="desk-only">Nieuwe database</span></a></div></div>
    <div class="grid db-cards" data-cards><div class="row muted" style="padding:20px"><span class="spinner"></span>Databases zoeken…</div></div>
    <div data-detail></div>`;
  ctx.setFab(null, { hide: true });

  async function load() {
    try { all = await api('GET', '/api/databases'); } catch (e) { fail(e); return; }
    if (!all.list.length) { $('[data-cards]', root).innerHTML = `<div class="card" style="grid-column:1/-1">${emptyState('disk', 'Geen databases gevonden', 'Installeer PostgreSQL of MariaDB via de Apps-winkel, of zet een app met een database online. SQLite-bestanden in je sites verschijnen hier vanzelf.')}</div>`; return; }
    const keep = cur && all.list.find((d) => d.id === cur.id);
    cur = keep || all.list.find((d) => d.id === ls.get('db-last')) || all.list[0];
    cards(); await pick(cur, db);
  }
  function cards() {
    $('[data-cards]', root).innerHTML = all.list.map((d) => `<button class="card db-card ${d === cur ? 'on' : ''}" data-id="${esc(d.id)}" aria-pressed="${d === cur}">
      <span class="row"><b class="grow ellipsis">${esc(d.name)}</b><span class="tag ${d === cur ? 'dark' : ''}">${ENGINE[d.engine]}</span></span>
      <span class="small muted ellipsis">${d.kind === 'file' ? esc(d.site ? `site: ${d.site}` : d.file) : `${esc(d.image || '')}${d.running ? '' : ' · gestopt'}`}</span></button>`).join('');
  }
  async function pick(d, wantDb) {
    cur = d; ls.set('db-last', d.id); cards();
    const det = $('[data-detail]', root);
    det.innerHTML = '<div class="row muted" style="padding:20px"><span class="spinner"></span>Laden…</div>';
    try { info = await api('GET', `/api/databases/info?id=${encodeURIComponent(d.id)}${wantDb ? `&db=${encodeURIComponent(wantDb)}` : ''}`); } catch (e) { det.innerHTML = `<div class="card">${emptyState('alert', 'Kon deze database niet openen', esc(e.message))}</div>`; return; }
    db = info.db; last = null;
    const first = info.tables[0] ? info.tables[0].name : '';
    const quote = (t) => (cur.engine === 'mysql' ? `\`${t}\`` : t.includes('.') ? t : `"${t}"`);
    det.innerHTML = `
      <div class="db-layout">
        <aside class="card db-side">
          ${info.dbs.length > 1 ? `<label class="field" style="margin-bottom:8px"><span>Database</span><select data-db>${info.dbs.map((x) => `<option ${x.name === db ? 'selected' : ''} value="${esc(x.name)}">${esc(x.name)} · ${fmtBytes(x.size)}</option>`).join('')}</select></label>` : `<div class="sec-l">Database · ${esc(db)} · ${fmtBytes((info.dbs[0] || {}).size || 0)}</div>`}
          <div class="sec-l">Tabellen (${info.tables.length})</div>
          <div class="db-tables">${info.tables.map((t) => `<button class="place" data-t="${esc(t.name)}"><span class="grow ellipsis">${esc(t.name)}</span><span class="tiny faint num">${t.approx ? '±' : ''}${t.rows.toLocaleString('nl-BE')}</span></button>`).join('') || '<p class="muted small" style="padding:4px 8px">Nog geen tabellen.</p>'}</div>
          <div class="col" style="gap:6px;margin-top:10px;border-top:1px solid var(--line);padding-top:10px">
            <button class="btn sm pri" data-backup>${icon('download', 'sm')}Backup maken</button>
            ${info.user ? `<div class="tiny faint">Gebruiker: <b>${esc(info.user)}</b> · wachtwoord staat in de .env van de app</div>` : ''}
          </div>
        </aside>
        <section class="db-main">
          <div class="term-wrap db-q"><div class="term-bar"><span class="grow">SQL · ${write ? '<b style="color:#fff">wijzigen toegestaan</b>' : 'alleen lezen'}</span><label class="row small" style="gap:6px;color:#DCE8FF"><input type="checkbox" data-write ${write ? 'checked' : ''}>Wijzigen toestaan</label><button class="btn sm pri" data-run>${icon('play', 'sm')}Uitvoeren <span class="desk-only faint" style="color:#C9D8F5">Ctrl ↵</span></button></div>
            <label><span class="sr">SQL-query</span><textarea data-sql spellcheck="false">${first ? `SELECT * FROM ${esc(quote(first))} LIMIT 50;` : 'SELECT 1;'}</textarea></label></div>
          <div class="card pad0" style="margin-top:10px"><div class="files-bar"><b class="grow" data-rtitle>Resultaat</b><span class="small muted" data-rinfo></span><button class="btn sm" data-csv disabled>${icon('download', 'sm')}CSV</button></div><div class="db-result" data-res><p class="muted small" style="padding:14px">Klik op een tabel of op Uitvoeren.</p></div></div>
          ${all.backups.length ? `<div class="card" style="margin-top:10px"><h3>${icon('refresh')}Backups</h3><div class="list-rows" style="margin-top:4px">${all.backups.slice(0, 6).map((b) => `<div class="lr small"><span class="grow mono ellipsis">${esc(b.file)}</span><span class="muted">${fmtBytes(b.size)} · ${ago(b.at)}</span><a class="btn sm" href="/api/databases/backups/${encodeURIComponent(b.file)}">${icon('download', 'sm')}</a></div>`).join('')}</div></div>` : ''}
        </section>
      </div>`;
    const ta = $('[data-sql]', det);
    ta.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); } });
    $('[data-run]', det).onclick = run;
    $('[data-write]', det).onchange = (e) => { write = e.target.checked; $('.db-q .term-bar span', det).innerHTML = `SQL · ${write ? '<b style="color:#fff">wijzigen toegestaan</b>' : 'alleen lezen'}`; };
    if ($('[data-db]', det)) $('[data-db]', det).onchange = (e) => pick(cur, e.target.value);
    $('[data-backup]', det).onclick = async (e) => { const b = e.currentTarget; b.disabled = true; try { const r = await api('POST', '/api/databases/backup', { id: cur.id, db }); all.backups = r.backups; toast('Backup gemaakt'); location.href = `/api/databases/backups/${encodeURIComponent(r.file)}`; } catch (er) { fail(er); } b.disabled = false; };
    $('[data-csv]', det).onclick = () => {
      if (!last) return;
      const c = (v) => (v == null ? '' : /[",\n;]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
      const csv = [last.columns, ...last.rows].map((r) => r.map(c).join(',')).join('\n');
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `${cur.name}-${db}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };
    det.addEventListener('click', (e) => { const t = e.target.closest('[data-t]'); if (!t) return; ta.value = `SELECT * FROM ${quote(t.dataset.t)} LIMIT 50;`; run(); });
  }
  async function run() {
    const det = $('[data-detail]', root); const res = $('[data-res]', det);
    res.innerHTML = '<div class="row muted" style="padding:14px"><span class="spinner"></span>Bezig…</div>';
    try {
      last = await api('POST', '/api/databases/query', { id: cur.id, db, sql: $('[data-sql]', det).value, write });
      $('[data-rinfo]', det).textContent = `${last.total != null ? `${last.total.toLocaleString('nl-BE')} rij${last.total === 1 ? '' : 'en'}` : ''}${last.truncated ? ' (eerste 500 getoond)' : ''} · ${last.ms} ms`;
      $('[data-csv]', det).disabled = false;
      res.innerHTML = `<table class="tbl db-tbl"><thead><tr>${last.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${last.rows.map((r) => `<tr>${r.map((v) => `<td>${v == null ? '<span class="faint">NULL</span>' : esc(String(v).length > 300 ? `${String(v).slice(0, 300)}…` : v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    } catch (e) { last = null; $('[data-csv]', det).disabled = true; res.innerHTML = `<p class="error" style="padding:14px;white-space:pre-wrap">${esc(e.message)}</p>`; }
  }
  root.addEventListener('click', (e) => { const c = e.target.closest('.db-card[data-id]'); if (c) pick(all.list.find((d) => d.id === c.dataset.id)); });
  await load();
}
