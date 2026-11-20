/* Dashboard 2.0: je server en je dag op één scherm, met widgets die je zelf kiest (knop Aanpassen). */
import { $, $$, esc, icon, api, toast, fail, hm, sod, addDays, until, greet, fmtBytes, fmtUptime, dayLabel, debounce, evColors, ls, bus, isMobile } from '../core.js';
import * as Live from '../live.js';
import { pushState, enablePush } from '../main.js';
import { openEvent } from './agenda.js';
import { editTask } from './tasks.js';

// widgetbibliotheek: [id, titel, uitleg, icoon]
const LIB = [
  ['sites', 'Websites', 'Status en reactietijd van je sites', 'globe'],
  ['containers', 'Containers', 'Wat draait er, met herstartknop', 'box'],
  ['today', 'Vandaag', 'Je afspraken van vandaag', 'cal'],
  ['tasks', 'Taken', 'Afvinken zonder de pagina te openen', 'tasks'],
  ['actions', 'Snel doen', 'Uploaden, terminal, opruimen…', 'bolt'],
  ['net', 'Netwerk live', 'Download en upload per seconde', 'activity'],
  ['energy', 'Energie', 'Verbruik nu en wat het kost', 'bolt'],
  ['alerts', 'Meldingen', 'Wat er gebeurd is op je server', 'bell'],
  ['security', 'Beveiliging', 'Firewall en wat er tegengehouden werd', 'shield'],
  ['devices', 'Apparaten', 'Pc of NAS aanzetten (Wake-on-LAN)', 'power'],
  ['disks', 'Schijven', 'Opslag per schijf', 'disk'],
  ['countdown', 'Aftellen', 'Examens, vakanties, deadlines', 'flag'],
  ['note', 'Snelle notitie', 'Kladblok dat vanzelf bewaart', 'note'],
  ['speed', 'Snelheidstest', 'Internetsnelheid van je server', 'speed'],
];
const DEFAULT = ['sites', 'containers', 'today', 'actions', 'net', 'energy', 'alerts', 'tasks'];
const MAX = 12;
const ACTIONS = [['Site uploaden', 'upload', '#/sites?nieuw=1'], ['Terminal', 'terminal', '#/terminal'], ['App installeren', 'bag', '#/apps'], ['Opruimen', 'trash', '#/server?tab=onderhoud'], ['Bestanden', 'folder', '#/bestanden'], ['Pc aanzetten', 'power', '#/apparaten']];
const nl = (n, d = 1) => Number(n || 0).toLocaleString('nl-BE', { minimumFractionDigits: d, maximumFractionDigits: d });
const RING = (r) => 2 * Math.PI * r;

export default async function dashboard(root, ctx) {
  const st = ctx.app.settings || {};
  let chosen = ((st.dashboard && st.dashboard.widgets) || DEFAULT).filter((k) => LIB.some((l) => l[0] === k));
  let editing = false, tab = ls.get('dash-tab', chosen[0]);
  const unsubs = [], timers = [];
  const hist = { cpu: [], mem: [], temp: [], rx: [], tx: [] };
  let lastStats = null, overview = null, notes = [];
  let containerList = null, taskData = null, quickNote = null;

  root.innerHTML = `<div class="d2">
    <div class="d2-head-m"><h1>${greet()}, ${esc(st.name || 'Rawend')}</h1><button class="iconbtn keep" data-search aria-label="Zoeken">${icon('search')}</button><button class="iconbtn keep" data-edit aria-label="Dashboard aanpassen">${icon('layout')}</button></div>
    <div data-promo></div>
    <div class="d2-top">
      <section class="hero2" aria-label="Status van je server">
        <svg class="deco" aria-hidden="true" width="300" height="300" viewBox="0 0 300 300"><circle cx="150" cy="150" r="140" fill="none" stroke="#fff" stroke-width="2"/><circle cx="150" cy="150" r="95" fill="none" stroke="#fff" stroke-width="2"/><circle cx="150" cy="150" r="50" fill="none" stroke="#fff" stroke-width="2"/></svg>
        <div class="hring"><svg viewBox="0 0 84 84" width="84" height="84" role="img" aria-label="Gezondheid"><circle cx="42" cy="42" r="35" fill="none" stroke="rgba(255,255,255,.22)" stroke-width="8"/><circle class="v" data-health-ring cx="42" cy="42" r="35" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" stroke-dasharray="${RING(35)}" stroke-dashoffset="${RING(35)}" transform="rotate(-90 42 42)"/></svg><div class="n"><span data-health>–</span><small>gezond</small></div></div>
        <div style="flex:1 1 260px;position:relative;min-width:0">
          <div class="live"><i></i><span data-clock>Live</span></div>
          <h1>${greet()}, ${esc(st.name || 'Rawend')}</h1>
          <div class="chips" data-chips><span>Laden…</span></div>
        </div>
        <div class="hb"><a class="btn w lift" href="#/sites?nieuw=1">${icon('upload', 'sm')}Site uploaden</a><a class="btn o lift" href="#/terminal">${icon('terminal', 'sm')}Terminal</a><button class="btn o lift" data-edit3>${icon('layout', 'sm')}Aanpassen</button></div>
      </section>
      <section class="att" aria-label="Vraagt aandacht"><h2>Vraagt aandacht <span class="cnt" data-att-n>0</span></h2><div class="col" style="gap:6px" data-att><div class="ok"><span class="spinner"></span></div></div></section>
    </div>
    <section class="d2-stats" aria-label="Live server">
      ${['cpu|Processor', 'mem|Geheugen', 'temp|Temperatuur', 'disk|Opslag'].map((x) => { const [k, l] = x.split('|'); return `<div class="st2 lift" data-st="${k}"><div class="rg"><svg viewBox="0 0 62 62" width="62" height="62" aria-hidden="true"><circle cx="31" cy="31" r="26" fill="none" stroke="var(--card2)" stroke-width="7"/><circle class="v" cx="31" cy="31" r="26" fill="none" stroke="var(--p)" stroke-width="7" stroke-linecap="round" stroke-dasharray="${RING(26)}" stroke-dashoffset="${RING(26)}" transform="rotate(-90 31 31)"/></svg><b>–</b></div><div style="flex:1;min-width:0"><div class="l">${l}</div><div class="val">–</div><div class="sp"></div></div></div>`; }).join('')}
    </section>
    <div class="d2-tabs" role="tablist" aria-label="Widgets" data-tabs></div>
    <section class="d2-grid" data-grid></section>
  </div>`;
  document.documentElement.classList.add('dash-lock2'); scrollTo(0, 0);
  ctx.setFab(null, { hide: !isMobile() });
  $('[data-search]', root).onclick = () => ctx.searchAll();
  $('[data-edit]', root).onclick = () => openPanel();
  $('[data-edit3]', root).onclick = () => (panel ? closePanel() : openPanel());

  // ---------------------------------------------------------------- live server
  function ringSet(el, pct, color) { const c = $('circle.v', el); const r = Number(c.getAttribute('r')); c.style.strokeDashoffset = String(RING(r) * (1 - Math.max(0, Math.min(100, pct || 0)) / 100)); if (color) c.setAttribute('stroke', color); }
  function sparkSvg(vals, color, max) {
    const v = vals.filter((x) => x != null); if (v.length < 2) return '';
    const lo = Math.min(...v), hi = Math.max(...v), span = Math.max(hi - lo, (max || hi) * 0.08, 1);
    const pts = v.map((x, i) => `${(i / (v.length - 1)) * 120},${20 - ((x - lo) / span) * 17}`).join(' ');
    return `<svg viewBox="0 0 120 22" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  }
  function tile(k, pct, big, ring, color) {
    const t = $(`[data-st="${k}"]`, root); if (!t) return;
    ringSet($('.rg', t), pct, color); $('.rg b', t).textContent = ring; $('.val', t).textContent = big;
    if (hist[k] && !document.hidden) $('.sp', t).innerHTML = sparkSvg(hist[k].slice(-40), color, k === 'temp' ? 90 : 100);
  }
  function applyStats(d) {
    if (!d || !d.now) return; lastStats = d;
    const n = d.now; const memPct = (d.mem.used / d.mem.total) * 100;
    const coral = 'var(--coral)', blue = 'var(--p)', navy = 'var(--ring2)';
    tile('cpu', n.cpu, `${Math.round(n.cpu || 0)}%`, `${Math.round(n.cpu || 0)}%`, n.cpu > 85 ? coral : blue);
    tile('mem', memPct, fmtBytes(d.mem.used, 1), `${Math.round(memPct)}%`, memPct > 90 ? coral : navy);
    if (n.temp == null) tile('temp', 0, 'geen sensor', '–', blue);
    else tile('temp', n.temp / 0.9, `${Math.round(n.temp)} °C`, `${Math.round(n.temp)}°`, n.temp >= 75 ? coral : blue);
    const ds = d.disks || []; const tot = ds.reduce((a, x) => ({ t: a.t + x.total, u: a.u + x.used, f: a.f + x.free }), { t: 0, u: 0, f: 0 });
    if (tot.t) { const p = (tot.u / tot.t) * 100; tile('disk', p, `${fmtBytes(tot.f, 0)} vrij`, `${Math.round(p)}%`, p > 90 ? coral : navy); }
    health(); hero(); renderLive();
  }
  try { const s = await api('GET', '/api/stats?range=15m'); hist.cpu = s.history.cpu.slice(-40); hist.mem = s.history.mem.slice(-40); hist.temp = s.history.temp.slice(-40); applyStats(s); } catch { /* */ }
  unsubs.push(Live.on('stats', (d) => {
    const n = d.now || {}; const memPct = d.mem ? (d.mem.used / d.mem.total) * 100 : null;
    for (const [k, v] of [['cpu', n.cpu], ['mem', memPct], ['temp', n.temp], ['rx', n.rx], ['tx', n.tx]]) { hist[k].push(v == null ? null : v); if (hist[k].length > 60) hist[k].shift(); }
    applyStats(d);
  }));
  const clock = () => { const c = $('[data-clock]', root); if (c) c.textContent = `Live · ${new Date().toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`; };
  clock(); timers.push(setInterval(clock, 1000));

  // gezondheid en kop
  function health() {
    let h = 100;
    if (overview) h -= overview.sites.filter((s) => s.status.state === 'down' || s.status.state === 'missing').length * 15;
    if (lastStats && lastStats.now && lastStats.now.temp >= 75) h -= 10;
    const ds = (lastStats && lastStats.disks) || []; if (ds.some((x) => x.used / x.total > 0.9)) h -= 10;
    h -= Math.min(20, notes.filter((n) => !n.read && (n.level === 'error' || n.level === 'warn')).length * 5);
    h = Math.max(0, Math.round(h));
    const el = $('[data-health]', root); if (el) el.textContent = String(h);
    const r = $('[data-health-ring]', root); if (r) r.style.strokeDashoffset = String(RING(35) * (1 - h / 100));
  }
  function hero() {
    const chips = [];
    if (overview) { const up = overview.sites.filter((s) => s.status.state === 'up').length; chips.push(`${up}/${overview.sites.length} sites online`); }
    if (containerList) chips.push(`${containerList.filter((c) => c.state === 'running').length} containers`);
    if (lastStats && lastStats.info && lastStats.info.uptime) chips.push(`${fmtUptime(lastStats.info.uptime)} online`);
    if (lastStats && lastStats.now && lastStats.now.temp != null) chips.push(`${Math.round(lastStats.now.temp)} °C`);
    const el = $('[data-chips]', root); if (el && chips.length) el.innerHTML = chips.map((c) => `<span>${esc(c)}</span>`).join('');
  }

  // ---------------------------------------------------------------- vraagt aandacht
  function attention() {
    const el = $('[data-att]', root); if (!el) return;
    const items = [];
    if (overview) for (const s of overview.sites.filter((x) => ['down', 'missing', 'warn'].includes(x.status.state))) items.push({ c: true, t: `${s.name}: ${s.status.text}`, url: `#/sites/${encodeURIComponent(s.name)}` });
    for (const n of notes.filter((x) => !x.read && (x.level === 'error' || x.level === 'warn')).slice(0, 3)) items.push({ c: true, t: n.title, url: n.url || '#/' });
    if (lastStats && lastStats.now && lastStats.now.temp >= 75) items.push({ c: true, t: `Server is warm: ${Math.round(lastStats.now.temp)} °C`, url: '#/server' });
    for (const n of notes.filter((x) => !x.read && x.level !== 'error' && x.level !== 'warn').slice(0, 2)) items.push({ c: false, t: n.title, url: n.url || '#/' });
    $('[data-att-n]', root).textContent = String(items.length);
    $('[data-att-n]', root).style.display = items.length ? '' : 'none';
    el.innerHTML = items.length ? items.slice(0, 3).map((i) => `<a class="it ${i.c ? 'c' : ''}" href="${esc(i.url)}"><i></i><b>${esc(i.t)}</b>${icon('right', 'xs')}</a>`).join('')
      : `<div class="ok">${icon('tick')}Alles in orde – niets om je zorgen over te maken.</div>`;
  }

  // ---------------------------------------------------------------- widgets

  const W = {
    sites: { meta: () => (overview ? `${overview.sites.filter((s) => s.status.state === 'up').length} van ${overview.sites.length}` : ''), link: '#/sites',
      body: () => (overview ? (overview.sites.length ? overview.sites.map((s) => { const bad = s.status.state !== 'up'; return `<a class="wl" href="#/sites/${encodeURIComponent(s.name)}"><span class="fv ${bad ? 'c' : ''}">${esc(s.name[0])}</span><b>${esc(s.name)}</b><small>${esc(s.domain ? s.domain.replace(/.duckdns.org$/, '') : 'thuis')}</small><span class="dt ${bad ? 'c' : ''}" title="${esc(s.status.text)}"></span></a>`; }).join('') : '<p class="muted small">Nog geen sites. <a href="#/sites?nieuw=1">Site toevoegen</a></p>') : spin()) },
    containers: { meta: () => (containerList ? `${containerList.filter((c) => c.state === 'running').length} actief` : ''), link: '#/containers',
      body: () => (containerList ? containerList.slice().sort((a, b) => (b.state === 'running') - (a.state === 'running') || a.name.localeCompare(b.name)).map((c) => `<div class="wl"><span class="dt ${c.state === 'running' ? '' : 'n'}"></span><b>${esc(c.name)}</b><small>${c.state === 'running' ? esc(c.stats ? c.stats.mem.split(' / ')[0] : '') : 'gestopt'}</small></div>`).join('') || '<p class="muted small">Geen containers.</p>' : spin()) },
    today: { meta: () => dayLabel(Date.now()), link: '#/agenda', body: () => '<div class="tl" data-tl>' + spin() + '</div>', after: loadToday },
    tasks: { meta: () => '', link: '#/taken', body: () => `<div data-tasks>${spin()}</div><form class="addrow" data-addtask style="margin-top:auto">${icon('plus', 'sm')}<input placeholder="Taak toevoegen…" enterkeyhint="done" aria-label="Taak toevoegen"></form>`, after: loadTasks },
    actions: { body: () => `<div class="wacts">${ACTIONS.map(([l, ic, url]) => `<a href="${url}">${icon(ic, 'sm')}${esc(l)}</a>`).join('')}</div>` },
    net: { meta: () => 'live', body: () => '<div data-net class="col" style="gap:6px;flex:1;min-height:0"></div>', after: renderLive },
    energy: { meta: () => 'nu', link: '#/energie', body: () => `<div data-energy class="col" style="gap:8px;flex:1">${spin()}</div>`, after: loadEnergy },
    alerts: { meta: () => { const u = notes.filter((n) => !n.read).length; return u ? `${u} nieuw` : ''; }, body: () => (notes.length ? notes.slice(0, 8).map((n) => `<a class="wl" href="${esc(n.url || '#/')}"><span class="dt ${n.level === 'error' || n.level === 'warn' ? 'c' : n.read ? 'n' : ''}"></span><b>${esc(n.title)}</b><small>${esc(dayLabel(n.at))} ${hm(n.at)}</small></a>`).join('') : `<div class="ok muted small" style="padding:6px 0">${icon('shield', 'sm')} Alles rustig.</div>`) },
    security: { link: '#/firewall', body: () => `<div data-sec>${spin()}</div>`, after: loadSecurity },
    devices: { link: '#/apparaten', body: () => `<div data-dev>${spin()}</div>`, after: loadDevices },
    disks: { link: '#/server?tab=schijven', body: () => { const ds = (lastStats && lastStats.disks) || []; return ds.length ? `<div class="col" style="gap:10px">${ds.map((x) => { const p = Math.round((x.used / x.total) * 100); return `<div><div class="row small" style="justify-content:space-between"><b>${esc(x.mount === '/' ? 'Systeem' : x.mount)}</b><span class="num">${fmtBytes(x.used, 0)} / ${fmtBytes(x.total, 0)}</span></div><div class="wbar"><span style="width:${p}%;${p > 90 ? 'background:var(--coral)' : ''}"></span></div></div>`; }).join('')}</div>` : spin(); } },
    countdown: { link: '#/aftellen', body: () => `<div data-cd>${spin()}</div>`, after: loadCountdowns },
    note: { meta: () => '', body: () => '<label style="display:flex;flex:1;min-height:0"><span class="sr">Snelle notitie</span><textarea class="notepad" data-note placeholder="Typ hier… (wordt vanzelf bewaard)"></textarea></label>', after: loadNote },
    speed: { link: '#/server?tab=onderhoud', body: () => `<div data-speed>${spin()}</div>`, after: loadSpeed },
  };
  function spin() { return '<div class="row muted small" style="padding:6px 0"><span class="spinner"></span>Laden…</div>'; }

  function drawGrid() {
    const g = $('[data-grid]', root);
    const n = chosen.length + (editing ? 1 : 0);
    const rows = Math.max(1, Math.ceil(n / 4));
    g.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
    if (!chosen.includes(tab)) tab = chosen[0];
    g.innerHTML = chosen.map((k, i) => { const L = LIB.find((l) => l[0] === k); const w = W[k]; const meta = w.meta ? w.meta() : '';
      return `<article class="wg ${k === tab ? 'act' : ''}" data-w="${k}" style="animation-delay:${0.04 * i}s"><div class="wg-h"><h2>${icon(L[3], 'sm')}${esc(L[1])}</h2>${w.link ? `<a class="m" href="${w.link}" data-meta>${esc(meta || 'Openen')}</a>` : `<span class="m" data-meta>${esc(meta)}</span>`}<button class="wg-x" data-x="${k}" aria-label="${esc(L[1])} verbergen">×</button></div><div class="wg-b" data-b>${w.body()}</div></article>`; }).join('')
      + (editing ? `<button class="wg-add" data-add><span>+</span>Widget toevoegen</button>` : '');
    $('[data-tabs]', root).innerHTML = chosen.map((k) => `<button role="tab" aria-selected="${k === tab}" class="${k === tab ? 'on' : ''}" data-tab="${k}">${esc(LIB.find((l) => l[0] === k)[1])}</button>`).join('') + '<button class="add" data-edit2 aria-label="Widgets kiezen">+</button>';
    $('.d2', root).classList.toggle('editing', editing);
    for (const k of chosen) if (W[k].after) W[k].after();
  }
  function refresh(k) {
    const el = $(`[data-w="${k}"]`, root); if (!el) return;
    const w = W[k]; const m = $('[data-meta]', el); if (m && w.meta) m.textContent = w.meta() || (w.link ? 'Openen' : '');
    if (!w.after) $('[data-b]', el).innerHTML = w.body();
  }
  async function save() { try { ctx.app.settings = await api('PUT', '/api/settings', { dashboard: { ...((ctx.app.settings && ctx.app.settings.dashboard) || {}), widgets: chosen } }); } catch (e) { fail(e); } }

  // aanpassen-paneel
  let panel = null;
  function openPanel() {
    if (panel) return;
    editing = true; drawGrid();
    const shade = document.createElement('div'); shade.className = 'wpanel-shade';
    const p = document.createElement('aside'); p.className = 'wpanel'; p.setAttribute('aria-label', 'Widgets kiezen');
    document.body.append(shade, p); panel = { p, shade };
    const draw = () => {
      p.innerHTML = `<div class="wpanel-h"><div class="grow"><h2>Overzicht aanpassen</h2><p>Kies wat je wil zien · ${chosen.length} van ${MAX} plaatsen</p></div><button class="btn icon ghost" data-close aria-label="Sluiten">${icon('x')}</button></div>
        <div class="wpanel-l">${LIB.map(([k, t, d, ic]) => { const on = chosen.includes(k); const full = !on && chosen.length >= MAX; return `<button class="wpick ${on ? 'on' : ''}" data-k="${k}" aria-pressed="${on}" ${full ? 'disabled' : ''}><span class="ic">${icon(ic)}</span><span class="tx"><b>${esc(t)}</b><span>${esc(full ? 'Eerst een andere uitzetten' : d)}</span></span><span class="sw"></span></button>`; }).join('')}</div>
        <div class="wpanel-f"><button class="btn" data-reset>Standaard</button><button class="btn pri grow" data-close>Klaar</button></div>`;
    };
    draw();
    p.addEventListener('click', (e) => {
      const b = e.target.closest('[data-k]');
      if (b) { const k = b.dataset.k; chosen = chosen.includes(k) ? chosen.filter((x) => x !== k) : [...chosen, k]; draw(); drawGrid(); save(); return; }
      if (e.target.closest('[data-reset]')) { chosen = DEFAULT.slice(); draw(); drawGrid(); save(); return; }
      if (e.target.closest('[data-close]')) closePanel();
    });
    shade.onclick = closePanel;
  }
  function closePanel() { if (!panel) return; panel.p.remove(); panel.shade.remove(); panel = null; editing = false; drawGrid(); }

  root.addEventListener('click', (e) => {
    const x = e.target.closest('[data-x]'); if (x) { chosen = chosen.filter((k) => k !== x.dataset.x); drawGrid(); save(); if (panel) { closePanel(); openPanel(); } return; }
    if (e.target.closest('[data-add]') || e.target.closest('[data-edit2]')) { openPanel(); return; }
    const t = e.target.closest('[data-tab]'); if (t) { tab = t.dataset.tab; ls.set('dash-tab', tab); $$('[data-tab]', root).forEach((b) => { b.classList.toggle('on', b === t); b.setAttribute('aria-selected', b === t); }); $$('.wg', root).forEach((w) => w.classList.toggle('act', w.dataset.w === tab)); }
  });

  // ---------------------------------------------------------------- gegevens per widget
  async function loadOverview() { try { overview = await api('GET', '/api/overview'); ctx.app.overview = overview; } catch { /* */ } refresh('sites'); health(); hero(); attention(); }
  async function loadContainers() { try { containerList = await api('GET', '/api/containers'); } catch { /* */ } refresh('containers'); hero(); }
  async function loadNotes() {
    try { notes = await api('GET', '/api/notifications'); } catch { /* */ }
    refresh('alerts'); attention(); health();
  }
  function renderLive() {
    const el = $('[data-net]', root); if (!el) return;
    const rx = hist.rx.filter((v) => v != null), tx = hist.tx.filter((v) => v != null);
    const now = (a) => (a.length ? (a[a.length - 1] * 8) / 1e6 : 0);
    const max = Math.max(1, ...rx, ...tx);
    const pts = (a) => a.map((v, i) => `${(i / Math.max(1, a.length - 1)) * 600},${135 - (v / max) * 120}`);
    const r = pts(rx);
    el.innerHTML = `<div class="row small" style="gap:14px;font-weight:700"><span class="num"><span style="color:var(--p)">↓</span> ${nl(now(rx))} Mbit/s</span><span class="num"><span style="color:var(--coral)">↑</span> ${nl(now(tx))} Mbit/s</span></div>
      <div class="wnet">${r.length > 1 ? `<svg viewBox="0 0 600 140" preserveAspectRatio="none" role="img" aria-label="Netwerkverkeer"><path d="M0,140 L${r.join(' L')} L600,140 Z" fill="var(--pS)"/><polyline points="${r.join(' ')}" fill="none" stroke="var(--p)" stroke-width="2.5" stroke-linejoin="round"/><polyline points="${pts(tx).join(' ')}" fill="none" stroke="var(--coral)" stroke-width="2" stroke-dasharray="4 4" stroke-linejoin="round"/></svg>` : '<p class="muted small">Metingen komen binnen…</p>'}</div>`;
  }
  async function loadEnergy() {
    const el = $('[data-energy]', root); if (!el) return;
    let e; try { e = await api('GET', '/api/energy?range=week'); } catch (x) { el.innerHTML = `<p class="muted small">${esc(x.message)}</p>`; return; }
    const cost = (kwh) => `€ ${nl(kwh * e.cfg.price, 2)}`;
    const vals = e.chart.map((x) => x[1] || 0); const mx = Math.max(1, ...vals);
    el.innerHTML = `<div class="row" style="align-items:baseline;gap:8px"><span class="wbig">${e.now == null ? '…' : Math.round(e.now)} W</span><span class="muted small">nu</span></div>
      <div class="row small" style="gap:14px"><span>Vandaag <b>${nl(e.kwh.dag, 2)} kWh</b></span><span>Maand <b>${cost(e.kwh.maand)}</b></span></div>
      <div class="wbars">${vals.map((v, i) => `<span class="${i === vals.length - 1 ? 'c' : ''}" style="height:${Math.max(4, Math.round((v / mx) * 100))}%;animation-delay:${i * 0.04}s"></span>`).join('')}</div>`;
  }
  async function loadSecurity() {
    const el = $('[data-sec]', root); if (!el) return;
    let f = null; try { f = await api('GET', '/api/firewall'); } catch { /* */ }
    const me = ctx.app.me || {};
    const pub = f && f.rules ? f.rules.filter((r) => !r.v6 && r.action === 'ALLOW' && /anywhere|^any$/i.test(r.from)).length : null;
    el.innerHTML = `<div class="wkv"><div class="${f && f.installed && !f.active ? 'c' : ''}"><b>${!f ? '?' : !f.installed ? 'Geen' : f.active ? 'Aan' : 'Uit'}</b><span>firewall</span></div><div><b>${f ? (f.blocked24h || 0).toLocaleString('nl-BE') : '?'}</b><span>tegengehouden (24 u)</span></div><div><b>${pub == null ? '?' : pub}</b><span>open naar internet</span></div><div class="${me.totp ? '' : 'c'}"><b>${me.totp ? '2FA' : 'Geen 2FA'}</b><span>${me.totp ? 'aan' : 'zet aan bij instellingen'}</span></div></div>`;
  }
  async function loadDevices() {
    const el = $('[data-dev]', root); if (!el) return;
    let d; try { d = await api('GET', '/api/devices'); } catch (x) { el.innerHTML = `<p class="muted small">${esc(x.message)}</p>`; return; }
    el.innerHTML = d.wol.length ? d.wol.map((w) => `<div class="wl"><span class="fv ${w.online ? '' : 'c'}">${icon('power', 'xs')}</span><b>${esc(w.name)}</b><small>${w.online ? 'aan' : 'uit'}</small>${w.online ? '' : `<button class="btn sm pri" data-wake="${w.id}">Aanzetten</button>`}</div>`).join('')
      : `<p class="muted small">Nog geen computers toegevoegd. <a href="#/apparaten">Toevoegen</a></p><p class="small" style="margin-top:6px">${d.devices.length} apparaten op je netwerk.</p>`;
  }
  async function loadSpeed() {
    const el = $('[data-speed]', root); if (!el) return;
    let s; try { s = await api('GET', '/api/server/speedtest'); } catch { return; }
    const l = s.history[s.history.length - 1];
    el.innerHTML = l ? `<div class="row" style="gap:16px"><span><span class="wbig" style="color:var(--p)">${Math.round(l.down / 1e6)}</span><br><span class="muted small">Mbit/s down</span></span><span><span class="wbig" style="color:var(--coral)">${Math.round(l.up / 1e6)}</span><br><span class="muted small">Mbit/s up</span></span>${l.ping != null ? `<span><span class="wbig">${Math.round(l.ping)}</span><br><span class="muted small">ms</span></span>` : ''}</div><p class="muted small" style="margin-top:6px">${esc(dayLabel(l.at))} ${hm(l.at)}</p><button class="btn sm" data-speedrun style="margin-top:8px">${icon('refresh', 'sm')}Opnieuw meten</button>`
      : `<p class="muted small">Nog niet gemeten.</p><button class="btn sm pri" data-speedrun style="margin-top:8px">Nu meten</button>`;
  }
  async function loadCountdowns() {
    const el = $('[data-cd]', root); if (!el) return;
    let list = []; try { list = await api('GET', '/api/countdowns'); } catch { /* */ }
    const today = sod();
    const items = list.map((c) => ({ ...c, days: Math.round((new Date(`${c.date}T00:00:00`).getTime() - today) / 864e5) })).filter((c) => c.days >= 0).sort((a, b) => a.days - b.days).slice(0, 6);
    el.innerHTML = items.length ? items.map((c, i) => `<a class="wcd ${i === 0 ? 'c' : ''}" href="#/aftellen"><span class="n">${c.days === 0 ? '!' : c.days}<small>${c.days === 0 ? 'vandaag' : c.days === 1 ? 'dag' : 'dagen'}</small></span><span><b style="display:block">${esc(c.title)}</b><span class="muted small">${esc(dayLabel(new Date(`${c.date}T12:00`).getTime()))}</span></span></a>`).join('') : '<p class="muted small">Niets om af te tellen. <a href="#/aftellen">Toevoegen</a></p>';
  }
  async function loadToday() {
    const el = $('[data-tl]', root); if (!el) return;
    const now = Date.now(), from = sod(), to = addDays(from, 1);
    let list; try { list = await api('GET', `/api/agenda/events?from=${from}&to=${to}`); } catch (e) { el.innerHTML = `<p class="muted small">${esc(e.message)}</p>`; return; }
    const timed = list.filter((o) => !o.allDay), allday = list.filter((o) => o.allDay);
    let html = allday.map((o) => `<div class="ad" style="${evColors(o.color)};margin-bottom:4px" data-key="${esc(o.key)}">${esc(o.title)}</div>`).join('');
    let lineDone = false;
    for (const o of timed) {
      if (!lineDone && o.end > now) { html += `<div class="nowline">NU ${hm(now)}</div>`; lineDone = true; }
      const past = o.end < now, cur = o.start <= now && o.end > now;
      html += `<div class="ev ${past ? 'past' : ''} ${cur ? 'now' : ''}" data-key="${esc(o.key)}" style="${evColors(o.color)}"><div class="t">${hm(o.start)}<small>${hm(o.end)}</small></div><div class="bar"></div><div class="ellipsis"><b class="ellipsis">${esc(o.title)}</b><span class="d ellipsis">${o.location ? `${icon('pin')}${esc(o.location)}` : ''}${!past && o.start > now && o.start - now < 3 * 3600e3 ? ` ${until(o.start)}` : cur ? ' nu bezig' : ''}</span></div></div>`;
    }
    if (!list.length) html = `<div class="empty" style="padding:14px 8px"><div class="ei">${icon('cal')}</div><b>Niets gepland vandaag</b><div class="small">Geniet ervan!</div></div>`;
    el.innerHTML = html;
    el.onclick = (e) => { const r = e.target.closest('[data-key]'); if (!r) return; const o = list.find((x) => x.key === r.dataset.key); if (o) openEvent(o, { onChange: loadToday }); };
  }
  async function loadTasks() {
    const el = $('[data-tasks]', root); if (!el) return;
    try { taskData = await api('GET', '/api/tasks'); } catch (e) { el.innerHTML = `<p class="muted small">${esc(e.message)}</p>`; return; }
    const open = taskData.tasks.filter((t) => !t.done && !t.parent).sort((a, b) => (a.dueMs || 9e15) - (b.dueMs || 9e15));
    const w = $('[data-w="tasks"] [data-meta]', root); if (w) w.textContent = open.length ? `${open.length} open` : 'Openen';
    el.innerHTML = open.length ? open.slice(0, 12).map((t) => { const late = t.dueMs && t.dueMs < sod(); return `<div class="task" data-uid="${esc(t.uid)}"><button class="cb" data-done aria-label="Afvinken">${icon('tick')}</button><div class="tt" data-open><b>${esc(t.title)}</b><small>${t.dueMs ? `<span class="${late ? 'late' : ''}">${esc(dayLabel(t.dueMs))}</span>` : ''}</small></div></div>`; }).join('')
      : `<div class="empty" style="padding:10px 4px"><b>Alles gedaan</b><div class="small">Geen openstaande taken.</div></div>`;
  }
  async function loadNote() {
    const ta = $('[data-note]', root); if (!ta) return;
    try { quickNote = await api('GET', '/api/notes/quick'); } catch { return; }
    if (document.activeElement !== ta) ta.value = quickNote.body || '';
  }
  const saveNote = debounce(async () => { const ta = $('[data-note]', root); if (!ta || !quickNote) return; try { await api('PUT', `/api/notes/${quickNote.id}`, { body: ta.value, clientId: 'dash' }); } catch (e) { fail(e); } }, 700);

  root.addEventListener('input', (e) => { if (e.target.closest('[data-note]')) saveNote(); });
  root.addEventListener('submit', async (e) => {
    if (!e.target.closest('[data-addtask]')) return;
    e.preventDefault(); const inp = $('input', e.target); const v = inp.value.trim(); if (!v) return; inp.value = '';
    try { const p = await api('POST', '/api/quick/parse', { text: v }); await api('POST', '/api/tasks', { title: p.title || v, due: p.kind === 'event' ? p.start : p.due || null, repeat: p.repeat || null }); loadTasks(); } catch (x) { fail(x); }
  });
  root.addEventListener('click', async (e) => {
    const row = e.target.closest('.task[data-uid]');
    if (row && taskData) {
      const t = taskData.tasks.find((x) => x.uid === row.dataset.uid); if (!t) return;
      if (e.target.closest('[data-done]')) { e.target.closest('[data-done]').classList.add('on'); row.classList.add('done'); try { await api('PUT', `/api/tasks/${t.list}/${encodeURIComponent(t.href)}`, { uid: t.uid, done: true }); } catch (x) { fail(x); } setTimeout(loadTasks, 500); return; }
      if (e.target.closest('[data-open]')) { editTask(t, taskData.lists, loadTasks); return; }
    }
    const wk = e.target.closest('[data-wake]');
    if (wk) { wk.disabled = true; try { await api('POST', `/api/devices/wol/${wk.dataset.wake}/wake`); toast('Signaal verstuurd – de computer start zo'); setTimeout(loadDevices, 15000); } catch (x) { fail(x); wk.disabled = false; } return; }
    const sp = e.target.closest('[data-speedrun]');
    if (sp) { sp.disabled = true; sp.innerHTML = '<span class="spinner"></span>Meten…'; try { await api('POST', '/api/server/speedtest'); } catch (x) { fail(x); } loadSpeed(); }
  });

  // meldingen aanzetten (eenmalige uitnodiging)
  (async () => {
    const el = $('[data-promo]', root); if (ls.get('promoPushDone')) return;
    let s; try { s = await pushState(); } catch { return; }
    if (s.enabled || s.iosNeedsInstall) return;
    el.innerHTML = `<div class="promo" style="margin-bottom:0"><div class="ib">${icon('bell')}</div><div class="grow"><b>Meldingen op dit toestel</b><small>Herinneringen en waarschuwingen over je server.</small></div><button class="btn pri sm keep" data-on>Aanzetten</button><button class="btn ghost icon sm keep" data-px aria-label="Niet nu">${icon('x', 'sm')}</button></div>`;
    $('[data-px]', el).onclick = () => { ls.set('promoPushDone', true); el.innerHTML = ''; };
    $('[data-on]', el).onclick = async () => { try { await enablePush(); toast('Meldingen staan aan', { icon: 'bell' }); ls.set('promoPushDone', true); el.innerHTML = ''; } catch (x) { fail(x); } };
  })();

  drawGrid();
  loadOverview(); loadContainers(); loadNotes();
  unsubs.push(Live.on('sites', debounce(loadOverview, 600)));
  unsubs.push(Live.on('notifications', debounce(loadNotes, 400)));
  unsubs.push(Live.on('containers', (map) => { if (!containerList) return; for (const c of containerList) if (map[c.name]) c.stats = map[c.name]; refresh('containers'); }));
  unsubs.push(Live.on('agenda', debounce(() => { loadToday(); loadTasks(); }, 500)));
  unsubs.push(Live.on('countdowns', loadCountdowns));
  unsubs.push(Live.on('notes', (d) => { if (!d || d.from !== 'dash') loadNote(); }));
  unsubs.push(bus.on('changed', () => { loadToday(); loadTasks(); loadCountdowns(); }));
  timers.push(setInterval(() => { if (document.hidden) return; refresh('disks'); }, 30000));
  timers.push(setInterval(() => { if (document.hidden) return; loadToday(); if (chosen.includes('energy')) loadEnergy(); }, 60000));
  timers.push(setInterval(() => { if (!document.hidden) loadContainers(); }, 45000));
  return () => { document.documentElement.classList.remove('dash-lock2'); closePanel(); unsubs.forEach((u) => u()); timers.forEach(clearInterval); };
}
