/* Eén website: overzicht, domein-check, live logs, backups en instellingen. */
import { $, $$, esc, icon, api, toast, fail, confirmSheet, ago, fmtBytes, debounce, emptyState, copyText } from '../core.js';
import * as Live from '../live.js';
import { OV, loadOverview, siteUrl, homeUrl, statusOf, updateSite, siteAction, maintenance, deleteSite, watchJob, domainField, bindDomain } from './sites.js';

const TABS = [['overzicht', 'Overzicht'], ['logs', 'Live logs'], ['backups', 'Backups'], ['instellingen', 'Instellingen']];
const ACT = { deploy: 'Bijgewerkt', create: 'Online gezet', rollback: 'Teruggezet', settings: 'Instellingen', restart: 'Herstart', rebuild: 'Opnieuw gebouwd', start: 'Gestart', stop: 'Gestopt', pull: 'git pull', import: 'Toegevoegd' };

export default async function site(root, ctx) {
  const name = ctx.params[0];
  let tab = TABS.some((t) => t[0] === ctx.query.tab) ? ctx.query.tab : 'overzicht';
  let d = null; let es = null; let paused = false; let lines = 0;
  root.innerHTML = `
    <div class="top"><a class="iconbtn" href="#/sites" aria-label="Terug">${icon('left')}</a><div class="grow ellipsis"><h1 class="ellipsis" data-h>${esc(name)}</h1><p data-sub class="ellipsis">&nbsp;</p></div>
      <div class="actions" data-acts></div></div>
    <div class="tabs" data-tabs>${TABS.map(([k, l]) => `<button data-t="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div data-body></div>`;
  ctx.setFab(null, { hide: true });

  async function load() {
    try { d = await api('GET', `/api/sites/${encodeURIComponent(name)}/details`); } catch (e) { $('[data-body]', root).innerHTML = `<div class="card">${emptyState('alert', 'Site niet gevonden', esc(e.message), '<a class="btn sm" href="#/sites">Terug</a>')}</div>`; return false; }
    if (!OV) { try { await loadOverview(); } catch { /* */ } }
    const st = statusOf(d);
    $('[data-sub]', root).innerHTML = `<span class="pill ${st.state}" style="margin-right:6px">${esc(st.text)}</span>${d.domain ? esc(d.domain) : d.type === 'static' ? 'enkel thuis' : ''}`;
    const url = siteUrl(d) || (d.lanUrl && !d.lanUrl.startsWith('/') ? d.lanUrl : '') || d.lanUrl;
    $('[data-acts]', root).innerHTML = `${url ? `<a class="btn" href="${esc(url)}" target="_blank" rel="noopener">${icon('ext', 'sm')}Openen</a>` : ''}${d.type !== 'container' ? `<button class="btn pri keep" data-upd>${icon('upload', 'sm')}<span class="desk-only">Bijwerken</span></button>` : ''}`;
    return true;
  }
  function setTab(t) {
    tab = t; if (es) { es.close(); es = null; }
    $$('[data-t]', root).forEach((b) => b.classList.toggle('on', b.dataset.t === t));
    history.replaceState(null, '', `#/sites/${encodeURIComponent(name)}${t === 'overzicht' ? '' : `?tab=${t}`}`);
    ({ overzicht: overview, logs, backups, instellingen: settings })[t]();
  }

  // ------------------------------------------------------------- overzicht
  async function overview() {
    const b = $('[data-body]', root); const st = statusOf(d);
    const url = siteUrl(d), home = homeUrl(d);
    b.innerHTML = `<div class="grid dash-row2" style="margin-top:0">
      <div class="col" style="gap:16px">
        <div class="card site-card" style="padding:0">
          <div class="prev" style="height:220px">${d.type === 'static' && !d.maintenance ? `<iframe src="/view/${encodeURIComponent(d.name)}/" tabindex="-1" sandbox="allow-same-origin" aria-hidden="true" style="width:300%;height:300%;transform:scale(.3333)"></iframe>` : `<div class="tile t2">${d.maintenance ? icon('wrench', 'lg') : esc(d.name[0].toUpperCase())}</div>`}<span class="pill ${st.state}">${esc(st.text)}</span></div>
          <div class="sb"><div class="r" style="padding-top:0;flex-wrap:wrap">
            ${d.type !== 'container' ? `<button class="btn sm pri" data-upd>${icon('upload', 'sm')}Bijwerken</button>` : ''}
            ${d.type !== 'static' ? `<button class="btn sm" data-a="restart">${icon('refresh', 'sm')}Herstarten</button>` : ''}
            <button class="btn sm" data-maint>${icon('wrench', 'sm')}${d.maintenance ? 'Onderhoud uit' : 'Onderhoud'}</button>
            ${home ? `<a class="btn sm" href="${esc(home)}" target="_blank" rel="noopener">${icon('home', 'sm')}${d.type === 'static' ? 'Voorbeeld' : 'Thuis openen'}</a>` : ''}
          </div></div>
        </div>
        ${d.maintenance ? `<div class="note s">${icon('wrench')}<span><b>Onderhoudsmodus staat aan</b> sinds ${esc(ago(d.maintenance.since))}. Bezoekers zien een nette "we zijn zo terug"-pagina.</span></div>` : ''}
        <div class="card"><h3>${icon('shield')}Domein-check<span class="more" data-recheck>${icon('refresh', 'xs')}Opnieuw</span></h3><div data-check style="margin-top:6px">${d.domain ? '<div class="row muted small" style="padding:10px 0"><span class="spinner"></span>Controleren…</div>' : `<p class="muted small" style="padding:8px 0">Deze site heeft nog geen domeinnaam. <span class="link" data-t="instellingen">Domein toevoegen</span></p>`}</div></div>
      </div>
      <div class="col" style="gap:16px">
        <div class="card"><h3>${icon('info')}Gegevens</h3><ul class="rows">
          <li><span>Soort</span><b>${d.type === 'static' ? 'Website (bestanden)' : d.type === 'docker' ? 'App in Docker' : 'Losse container'}${d.framework ? ` · ${esc(d.framework)}` : ''}</b></li>
          ${url ? `<li><span>Adres</span><b><a href="${esc(url)}" target="_blank" rel="noopener">${esc(d.domain)}</a></b></li>` : ''}
          ${d.port ? `<li><span>Poort</span><b>${esc(d.port)}</b></li>` : ''}
          ${d.path ? `<li><span>Map op de server</span><b class="mono" style="font-size:12px">${esc(d.path)}</b></li>` : ''}
          ${d.container ? `<li><span>Container</span><b class="mono" style="font-size:12px">${esc(d.container)}</b></li>` : ''}
          ${d.size != null ? `<li><span>Grootte</span><b>${fmtBytes(d.size)}</b></li>` : ''}
          ${d.type === 'static' && !d.domainExternal ? `<li><span>Bezoekers (24 u)</span><b>${d.visits24h || 0}</b></li>` : ''}
          ${d.autostart ? `<li><span>Na stroomuitval</span><b style="color:${d.autostart.ok ? 'var(--ok)' : 'var(--warn)'}">${d.autostart.ok ? 'start vanzelf' : 'start niet vanzelf'}</b></li>` : ''}
          ${d.spa ? '<li><span>Single-page app</span><b>aan</b></li>' : ''}
          <li><span>Toegevoegd</span><b>${esc(ago(d.createdAt))}</b></li><li><span>Bijgewerkt</span><b>${esc(ago(d.updatedAt))}</b></li>
        </ul></div>
        <div class="card"><h3>${icon('activity')}Geschiedenis</h3><div data-act style="margin-top:4px"></div></div>
      </div></div>`;
    if (d.domain) check();
    try {
      const a = await api('GET', `/api/sites/${encodeURIComponent(name)}/activity`);
      $('[data-act]', b).innerHTML = a.length ? a.slice(0, 12).map((x) => `<div class="li"><div class="ib sm ${x.ok ? 'ok' : 'b'}">${icon(x.ok ? 'tick' : 'x', 'sm')}</div><div class="grow ellipsis"><b>${esc(ACT[x.action] || x.action)}</b><small class="ellipsis">${x.ok ? (x.changes && (x.changes.added || x.changes.changed || x.changes.removed) ? `${x.changes.added} nieuw · ${x.changes.changed} gewijzigd · ${x.changes.removed} verwijderd` : 'gelukt') : esc(x.error || 'mislukt')}</small></div><div class="end small">${esc(ago(x.at))}</div></div>`).join('')
        : '<p class="muted small" style="padding:8px 0">Nog niets gebeurd.</p>';
    } catch { /* */ }
  }
  async function check() {
    const el = $('[data-check]', root); if (!el) return;
    el.innerHTML = '<div class="row muted small" style="padding:10px 0"><span class="spinner"></span>Controleren…</div>';
    try {
      const r = await api('GET', `/api/sites/${encodeURIComponent(name)}/check`);
      if (!$('[data-check]', root)) return;
      $('[data-check]', root).innerHTML = r.checks.map((c) => `<div class="chk-item"><div class="okc ${c.ok ? (c.warn ? 'w' : '') : 'b'}">${icon(c.ok ? 'tick' : 'x')}</div><div class="grow"><b>${esc(c.title)}</b><small>${esc(c.detail || '')}${c.id === 'tls' && c.days != null ? ` · nog ${c.days} dagen` : ''}</small></div></div>`).join('')
        + (r.checks.every((c) => c.ok) ? '' : `<p class="small muted" style="margin-top:8px">${icon('info', 'xs')} Net een domein toegevoegd? Het kan een paar minuten duren voor alles groen is.</p>`);
    } catch (e) { el.innerHTML = `<p class="error">${esc(e.message)}</p>`; }
  }

  // ------------------------------------------------------------- live logs
  function logs() {
    const b = $('[data-body]', root);
    b.innerHTML = `<div class="card" style="padding:12px"><div class="row" style="margin-bottom:10px;flex-wrap:wrap"><span class="dot pulse" data-ldot></span><b class="grow" data-lstate>Verbinden…</b>
        <label class="sbox" style="min-height:34px;width:200px">${icon('search', 'sm')}<input data-lf placeholder="Filter" style="min-height:32px!important"></label>
        <button class="btn sm" data-lpause>${icon('pause', 'sm')}Pauze</button><button class="btn sm" data-lclear>${icon('trash', 'sm')}Wissen</button><button class="btn sm" data-lcopy>${icon('copy', 'sm')}</button></div>
      <pre class="log logs-box" data-log></pre></div>`;
    const pre = $('[data-log]', b); lines = 0; paused = false;
    let filter = '';
    const add = (txt, kind) => {
      if (paused) return;
      const atBottom = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 40;
      const span = document.createElement('div');
      const cls = kind === 'info' ? 'linf' : /\s(5\d\d)\s|error|fatal|exception/i.test(txt) ? 'le' : /\s(4\d\d)\s|warn/i.test(txt) ? 'lw' : '';
      span.className = cls; span.textContent = txt;
      if (filter && !txt.toLowerCase().includes(filter)) span.hidden = true;
      pre.appendChild(span); lines++;
      if (lines > 2000) { pre.firstChild.remove(); lines--; }
      if (atBottom) pre.scrollTop = pre.scrollHeight;
    };
    es = new EventSource(`/api/sites/${encodeURIComponent(name)}/logs/stream`);
    es.addEventListener('line', (e) => add(JSON.parse(e.data), 'line'));
    es.addEventListener('info', (e) => add(JSON.parse(e.data), 'info'));
    es.onopen = () => { $('[data-lstate]', b).textContent = 'Live'; $('[data-ldot]', b).className = 'dot pulse'; };
    es.onerror = () => { $('[data-lstate]', b).textContent = 'Verbinding weg… opnieuw proberen'; $('[data-ldot]', b).className = 'dot w'; };
    $('[data-lpause]', b).onclick = (e) => { paused = !paused; e.currentTarget.innerHTML = paused ? `${icon('play', 'sm')}Verder` : `${icon('pause', 'sm')}Pauze`; };
    $('[data-lclear]', b).onclick = () => { pre.innerHTML = ''; lines = 0; };
    $('[data-lcopy]', b).onclick = () => copyText(pre.innerText, 'Logs gekopieerd');
    $('[data-lf]', b).addEventListener('input', debounce((e) => { filter = e.target.value.toLowerCase(); for (const l of pre.children) l.hidden = !!filter && !l.textContent.toLowerCase().includes(filter); }, 150));
  }

  // ------------------------------------------------------------- backups
  function backups() {
    const b = $('[data-body]', root);
    if (d.type === 'container') { b.innerHTML = `<div class="card">${emptyState('info', 'Geen backups', 'Voor een losse container maakt het paneel geen backups.')}</div>`; return; }
    b.innerHTML = `<div class="card"><h3>${icon('clock')}Vorige versies</h3><p class="sub">Bij elke update wordt automatisch een backup gemaakt. Terugzetten bewaart eerst de huidige versie, dus je kan altijd terug.</p>
      <div style="margin-top:10px">${d.backups.length ? d.backups.map((x, i) => `<div class="li"><div class="ib sm n">${icon('clock', 'sm')}</div><div class="grow"><b>${esc(x.date)}</b><small>${i === 0 ? 'de versie van vóór je laatste update' : 'oudere versie'}</small></div><div class="end"><button class="btn sm" data-rb="${esc(x.id)}">${icon('undo', 'sm')}Terugzetten</button></div></div>`).join('') : emptyState('clock', 'Nog geen backups', 'Bij je volgende update wordt er automatisch een gemaakt.')}</div></div>`;
  }

  // ------------------------------------------------------------- instellingen
  function settings() {
    const b = $('[data-body]', root);
    b.innerHTML = `<div class="grid two">
      <div class="card"><h3>${icon('globe')}Domein en instellingen</h3><div style="margin-top:14px" data-sf>
        ${d.domainExternal ? `<div class="note">${icon('globe')}<span><b>https://${esc(d.domain)}</b><br>Dit domein staat in je eigen Caddyfile. Het paneel komt er niet aan.</span></div>` : domainField(d.domain)}
        ${d.type === 'docker' ? `<label class="field"><span>Poort van de app</span><input name="port" inputmode="numeric" value="${esc(d.port || '')}"></label>` : ''}
        ${d.type !== 'container' ? `<label class="field"><span>Nooit overschrijven bij bijwerken</span><input name="keep" value="${esc((d.keep || []).join(', '))}"><span class="hint">.env, data en uploads worden altijd al beschermd.</span></label>
        <div class="grp"><div class="rw"><span class="grow">Single-page app<br><small class="faint">Onbekende adressen tonen index.html (Angular, React, Vue…)</small></span><button class="tog ${d.spa ? 'on' : ''}" data-spa></button></div></div>` : ''}
        <p class="error" data-err></p><button class="btn pri" data-save>Opslaan</button></div></div>
      <div class="col" style="gap:16px">
        ${d.type !== 'static' ? `<div class="card"><h3>${icon('box')}App</h3><div class="list" style="margin-top:6px">
          <div class="li"><div class="ib sm">${icon('refresh', 'sm')}</div><div class="grow"><b>Herstarten</b><small>Snel opnieuw opstarten</small></div><button class="btn sm" data-a="restart">Herstarten</button></div>
          ${d.type === 'docker' ? `<div class="li"><div class="ib sm">${icon('hammer', 'sm')}</div><div class="grow"><b>Opnieuw bouwen</b><small>Als er iets vastzit</small></div><button class="btn sm" data-a="rebuild">Bouwen</button></div>` : ''}
          ${d.self ? '' : `<div class="li"><div class="ib sm ok">${icon('play', 'sm')}</div><div class="grow"><b>Starten</b><small>Als de app gestopt is</small></div><button class="btn sm" data-a="start">Starten</button></div>
          <div class="li"><div class="ib sm b">${icon('stop', 'sm')}</div><div class="grow"><b>Stoppen</b><small>De app gaat offline</small></div><button class="btn sm danger" data-a="stop">Stoppen</button></div>`}
        </div></div>` : ''}
        <div class="card"><h3>${icon('wrench')}Onderhoudsmodus</h3><div class="grp" style="margin:10px 0 0"><div class="rw"><span class="grow">Bezoekers zien "we zijn zo terug"</span><button class="tog ${d.maintenance ? 'on' : ''}" data-maint></button></div></div></div>
        ${d.self ? '' : `<div class="card" style="border-color:var(--badS)"><h3 style="color:var(--bad)">${icon('trash')}Verwijderen</h3><p class="sub">Uit het paneel halen, of helemaal offline.</p><button class="btn danger" style="margin-top:12px" data-del>${icon('trash', 'sm')}${esc(d.name)} verwijderen</button></div>`}
      </div></div>`;
    const sf = $('[data-sf]', b);
    const readDomain = d.domainExternal ? () => undefined : bindDomain($('[data-domain]', sf));
    const spa = $('[data-spa]', sf); if (spa) spa.onclick = () => spa.classList.toggle('on');
    $('[data-save]', sf).onclick = async () => {
      const err = $('[data-err]', sf); err.textContent = '';
      try {
        const data = {};
        if (!d.domainExternal) data.domain = readDomain();
        if ($('[name=keep]', sf)) data.keep = $('[name=keep]', sf).value;
        if (spa) data.spa = spa.classList.contains('on') ? '1' : '0';
        if ($('[name=port]', sf)) { data.port = $('[name=port]', sf).value.trim(); if (data.domain && !data.port) throw new Error('Vul de poort van je app in.'); }
        const r = await api('PATCH', `/api/sites/${encodeURIComponent(name)}`, data);
        watchJob(r.job, { title: `${name} opslaan`, site: name, kind: 'settings', after: refresh });
      } catch (x) { err.textContent = x.message; }
    };
  }

  async function refresh() { if (await load()) setTab(tab); }
  root.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-t]'); if (t) { setTab(t.dataset.t); return; }
    if (!d) return;
    if (e.target.closest('[data-upd]')) { updateSite(d); return; }
    const a = e.target.closest('[data-a]'); if (a) { siteAction(d, a.dataset.a, refresh); return; }
    if (e.target.closest('[data-maint]')) { maintenance(d, !d.maintenance, refresh); return; }
    if (e.target.closest('[data-recheck]')) { check(); return; }
    if (e.target.closest('[data-del]')) { deleteSite(d, ctx.go); return; }
    const rb = e.target.closest('[data-rb]');
    if (rb) {
      if (!(await confirmSheet(`De versie van <b>${esc(d.backups.find((x) => x.id === rb.dataset.rb).date)}</b> terugzetten? De huidige versie wordt eerst bewaard.`, { ok: 'Terugzetten' }))) return;
      try { const r = await api('POST', `/api/sites/${encodeURIComponent(name)}/rollback`, { backup: rb.dataset.rb }); watchJob(r.job, { title: `${name} terugzetten`, site: name, kind: 'rollback', after: refresh }); } catch (x) { fail(x); }
    }
  });

  if (await load()) setTab(tab);
  const un = Live.on('sites', debounce(async () => { if (tab === 'overzicht' || tab === 'backups') { await load(); if (tab === 'backups') backups(); } else load(); }, 800));
  return { cleanup: () => { un(); if (es) es.close(); }, update: (r) => { if (r.params[0] !== name) return false; if (r.query.tab && r.query.tab !== tab) setTab(r.query.tab); return true; } };
}
