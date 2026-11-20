/* Rawendpaneel – opstarten, inloggen, menu, navigatie */
import { $, $$, h, esc, icon, logo, api, toast, fail, bus, sheet, menu, ls, IS_IOS, STANDALONE, isMobile, debounce, sleep } from './core.js';
import * as Live from './live.js';
import './datumuur.js';

const BASE = document.querySelector('meta[name="rp-base"]').content;
const VERSION = document.querySelector('meta[name="rp-version"]').content;
export const app = { me: null, settings: null, overview: null, version: VERSION, base: BASE };

// ---------------------------------------------------------------- pagina's
const ROUTES = {
  '': ['dashboard', 'Dashboard'], agenda: ['agenda', 'Agenda'], morgen: ['morgen', 'Morgen klaarleggen'], taken: ['tasks', 'Taken'], notities: ['notes', 'Notities'],
  delen: ['share', 'Delen'], aftellen: ['countdowns', 'Aftellen'],
  sites: ['sites', 'Websites'], server: ['server', 'Server'], containers: ['containers', 'Containers'], terminal: ['terminal', 'Terminal'], bestanden: ['files', 'Bestanden'], apps: ['apps', 'Apps-winkel'], databases: ['databases', 'Databases'], firewall: ['firewall', 'Firewall'], apparaten: ['devices', 'Apparaten'], netwerk: ['network', 'Netwerk'], energie: ['energy', 'Energie'], instellingen: ['settings', 'Instellingen'], meer: ['more', 'Meer'],
};
const NAV = [
  ['', 'home', 'Dashboard'], ['agenda', 'cal', 'Agenda'], ['taken', 'tasks', 'Taken'], ['notities', 'note', 'Notities'], ['delen', 'clip', 'Delen'],
  '-', ['sites', 'globe', 'Websites'], ['apps', 'bag', 'Apps-winkel'], ['databases', 'disk', 'Databases'], ['server', 'server', 'Server'], ['containers', 'box', 'Containers'], ['terminal', 'terminal', 'Terminal'], ['bestanden', 'folder', 'Bestanden'],
  '-', ['netwerk', 'wifi', 'Netwerk'], ['firewall', 'shield', 'Firewall'], ['apparaten', 'wifi', 'Apparaten'], ['energie', 'bolt', 'Energie'],
  '-', ['instellingen', 'sliders', 'Instellingen'],
];
const TOP = [['', 'home', 'Overzicht'], ['sites', 'globe', 'Websites'], ['server', 'server', 'Server'], ['netwerk', 'wifi', 'Netwerk'], ['terminal', 'terminal', 'Terminal'], ['agenda', 'cal', 'Agenda'], ['taken', 'tasks', 'Taken']];
const TOPKEYS = new Set(TOP.map((t) => t[0]));
const BNAV = [['', 'home', 'Home'], ['agenda', 'cal', 'Agenda'], ['taken', 'tasks', 'Taken'], ['sites', 'globe', 'Sites'], ['meer', 'menu', 'Meer']];
const MORE = new Set(['notities', 'delen', 'aftellen', 'server', 'containers', 'terminal', 'bestanden', 'apps', 'databases', 'firewall', 'apparaten', 'energie', 'netwerk', 'instellingen', 'meer', 'morgen']);

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [p, qs] = raw.split('?');
  const parts = p.split('/').filter(Boolean).map(decodeURIComponent);
  return { name: parts[0] || '', params: parts.slice(1), query: Object.fromEntries(new URLSearchParams(qs || '')) };
}
export function go(path) { location.hash = `#/${path.replace(/^#?\/?/, '')}`; }

// ---------------------------------------------------------------- opstarten
async function boot() {
  let me;
  try { me = await api('GET', '/api/me'); } catch (e) {
    $('#root').innerHTML = `<div class="login"><div class="login-box"><div class="logo">${logo()}</div><h1>Geen verbinding</h1><p>${esc(e.message)}</p><button class="btn pri" onclick="location.reload()">Opnieuw proberen</button></div></div>`;
    $('#root button').onclick = () => location.reload();
    return;
  }
  app.me = me;
  if (me.setupNeeded) return setupScreen(me);
  if (!me.loggedIn) return loginScreen(me);
  startApp();
}
bus.on('logout', () => { Live.stop(); if (app.started) { app.started = false; loginScreen(app.me || {}); } });

// ---------------------------------------------------------------- eerste keer: wachtwoord kiezen
function setupScreen(me) {
  const root = $('#root');
  if (!me.setupAllowed) {
    root.innerHTML = `<div class="login"><div class="login-box"><div class="logo">${logo()}</div><h1>Nog niet ingesteld</h1><p>Om veiligheidsredenen kies je het eerste wachtwoord enkel thuis, via het lokale adres van je server (bv. http://192.168.50.24:3000).</p></div></div>`;
    return;
  }
  root.innerHTML = `<div class="login"><div class="login-box"><div class="logo">${logo()}</div><h1>Welkom!</h1><p>Kies een wachtwoord voor je paneel (minstens 10 tekens).</p>
    <form><label class="field"><span>Wachtwoord</span><input type="password" name="pw" autocomplete="new-password" required></label><label class="field"><span>Nog eens</span><input type="password" name="pw2" autocomplete="new-password" required></label><p class="error" data-err></p><button class="btn pri lg block">Instellen</button></form></div></div>`;
  $('form', root).onsubmit = async (e) => {
    e.preventDefault(); const f = e.target; const err = $('[data-err]', f); err.textContent = '';
    if (f.pw.value !== f.pw2.value) { err.textContent = 'De wachtwoorden zijn niet hetzelfde.'; return; }
    try { await api('POST', '/api/setup', { password: f.pw.value }); toast('Ingesteld! Zet ook 2FA of Face ID aan bij Instellingen.'); startApp(); } catch (x) { err.textContent = x.message; }
  };
}

// ---------------------------------------------------------------- inloggen
async function loginScreen(me) {
  const root = $('#root');
  let pk = { secure: false, count: 0 };
  try { pk = await api('GET', '/api/passkey/available'); } catch { /* */ }
  const hasPk = pk.secure && pk.count > 0 && window.PublicKeyCredential;
  root.innerHTML = `<div class="login"><div class="login-box">
    <div class="logo">${logo()}</div><h1>Rawendpaneel</h1><p data-sub>${me.demo ? 'Demo op je eigen pc · wachtwoord: <code>demo123456</code>' : 'Welkom terug'}</p>
    ${hasPk ? `<div class="fid">${icon('face')}</div><button class="btn pri lg block" data-pk>${IS_IOS ? 'Inloggen met Face ID' : 'Inloggen met vingerafdruk / Face ID'}</button><button class="btn ghost block" style="margin-top:10px" data-pwbtn>Wachtwoord gebruiken</button>` : ''}
    <form class="${hasPk ? 'hidden' : ''}" autocomplete="on">
      <label class="field" data-pwf><span>Wachtwoord</span><input type="password" name="password" autocomplete="current-password" required></label>
      <label class="field hidden" data-code><span>Code uit je authenticator-app</span><input name="code" class="code-input" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••"></label>
      <p class="error" data-err></p>
      <button class="btn pri lg block">Inloggen</button>
    </form>
    <p class="small faint" style="margin-top:22px">${hasPk ? `${icon('lock', 'xs')} Je gezicht/vingerafdruk blijft op je toestel` : ''}</p>
  </div></div>`;
  const f = $('form', root), err = $('[data-err]', f);
  const pkBtn = $('[data-pk]', root);
  if (pkBtn) {
    pkBtn.onclick = async () => {
      try { const o = await api('POST', '/api/passkey/login/options', {}); const resp = await window.SimpleWebAuthnBrowser.startAuthentication({ optionsJSON: o.options }); await api('POST', '/api/passkey/login/verify', { id: o.id, response: resp }); startApp(); }
      catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') toast(e.message, { err: true }); }
    };
    $('[data-pwbtn]', root).onclick = () => { f.classList.remove('hidden'); $('[data-pwbtn]', root).remove(); f.password.focus(); };
    if (STANDALONE) setTimeout(() => pkBtn.click(), 300);
  } else setTimeout(() => f.password.focus(), 50);
  f.onsubmit = async (e) => {
    e.preventDefault(); err.textContent = '';
    const btn = $('button', f); btn.disabled = true;
    try {
      const r = await api('POST', '/api/login', { password: f.password.value, code: f.code.value || undefined });
      if (r.needCode) { $('[data-code]', f).classList.remove('hidden'); $('[data-pwf]', f).classList.add('hidden'); $('[data-sub]', root).textContent = 'Open je authenticator-app en typ de code.'; f.code.focus(); return; }
      startApp();
    } catch (x) { err.textContent = x.message; } finally { btn.disabled = false; }
  };
  f.code.addEventListener('input', () => { if (/^\d{6}$/.test(f.code.value)) f.requestSubmit(); });
}

// ---------------------------------------------------------------- de app
let current = { name: null, cleanup: null, key: '' };
async function startApp() {
  app.started = true;
  try { [app.settings, app.me] = await Promise.all([api('GET', '/api/settings'), api('GET', '/api/me')]); } catch (e) { fail(e); }
  renderShell();
  Live.start();
  route();
  refreshBadges();
  setInterval(refreshBadges, 5 * 60e3);
  Live.on('agenda', debounce(refreshBadges, 800));
  Live.on('notifications', debounce(refreshBadges, 500));
  Live.on('settings', async () => { try { app.settings = await api('GET', '/api/settings'); bus.emit('settings', app.settings); } catch { /* */ } });
  Live.on('stats', sideStats);
  Live.on('status', (ok) => { document.body.classList.toggle('offline', !ok && !navigator.onLine); });
  registerSW();
  checkVersion(); setInterval(checkVersion, 60e3);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { checkVersion(); refreshBadges(); } });
}
function renderShell() {
  $('#root').innerHTML = `<div class="app">
    <header class="topbar"><div class="tb-in">
      <a class="brand" href="#/"><div class="logo">${logo()}</div><b>Rawendpaneel</b></a>
      <nav class="tnav" aria-label="Hoofdmenu">${TOP.map(([r, ic, l]) => `<a href="#/${r}" data-r="${r}">${l}${r === 'taken' ? '<span class="badge hidden" data-badge="tasks"></span>' : ''}</a>`).join('')}<button class="tmore" data-more aria-haspopup="menu">Meer${icon('down', 'xs')}</button></nav>
      <button class="tb-search" data-search>${icon('search', 'sm')}<span>Zoek of voeg toe…</span><kbd>Ctrl K</kbd></button>
      <span class="tb-live" title="Live verbinding met je server"><span class="dot" data-live-dot></span><span data-live-txt>live</span></span>
    </div></header>
    <main class="main" id="page"></main>
  </div>
  <nav class="bnav">${BNAV.map((n) => `<a href="#/${n[0]}" data-r="${n[0]}"><span class="pill2">${icon(n[1])}</span>${n[2]}${n[0] === 'taken' ? '<span class="badge hidden" data-badge="tasks"></span>' : ''}</a>`).join('')}</nav>
  <button class="fab" aria-label="Snel toevoegen">${icon('plus')}</button>`;
  $('.fab').onclick = () => (fabHandler ? fabHandler() : quickAdd());
  $('[data-search]').onclick = () => searchAll();
  $('[data-more]').onclick = (e) => menu(e.currentTarget, NAV.filter((n) => n !== '-' && !TOPKEYS.has(n[0])).map(([r, ic, l]) => ({ label: l, icon: ic, onClick: () => go(r) })));
  Live.on('status', (ok) => { const d = $('[data-live-dot]'); if (d) { d.className = `dot ${ok ? '' : 'w'}`; $('[data-live-txt]').textContent = ok ? 'live' : 'verbinden…'; } });
}
function sideStats(d) {
  if (!d || !d.now) return;
  const set = (k, pct, txt) => { const b = $(`[data-ss="${k}"]`); if (b) b.style.width = `${Math.max(2, Math.min(100, pct))}%`; const v = $(`[data-ssv="${k}"]`); if (v) v.textContent = txt; };
  set('cpu', d.now.cpu || 0, `${Math.round(d.now.cpu || 0)}%`);
  const mp = d.mem ? (d.mem.used / d.mem.total) * 100 : 0; set('mem', mp, `${Math.round(mp)}%`);
  if (d.now.temp == null) $('[data-ss-temp]')?.classList.add('hidden'); else set('temp', d.now.temp, `${Math.round(d.now.temp)}°`);
}
let fabHandler = null;
export function setFab(fn, { hide = false, iconName = 'plus' } = {}) {
  fabHandler = fn; document.body.classList.toggle('no-fab', hide);
  const f = $('.fab'); if (f) f.innerHTML = icon(iconName);
}
async function route() {
  if (!app.started) return;
  const r = parseHash();
  const def = ROUTES[r.name];
  if (!def) { go(''); return; }
  const key = `${r.name}/${r.params.join('/')}?${new URLSearchParams(r.query)}`;
  for (const a of $$('[data-r]')) {
    const on = a.dataset.r === r.name || (a.dataset.r === 'meer' && MORE.has(r.name)) || (a.dataset.r === 'sites' && r.name === 'sites');
    a.classList.toggle('on', on && !(a.closest('.side') && a.dataset.r === 'meer'));
    if (a.closest('.bnav')) a.classList.toggle('on', a.dataset.r === r.name || (a.dataset.r === 'meer' && MORE.has(r.name)));
  }
  $('[data-more]')?.classList.toggle('on', !TOPKEYS.has(r.name));
  // zelfde pagina, andere parameters: de pagina mag dat zelf afhandelen
  if (current.name === def[0] && current.update) { current.key = key; const handled = await current.update(r); if (handled !== false) return; }
  if (current.cleanup) { try { current.cleanup(); } catch (e) { console.error(e); } }
  setFab(null);
  // nieuw element: zo blijven er geen klik-handlers van de vorige pagina hangen
  const oldPage = $('#page'); const page = oldPage.cloneNode(false); oldPage.replaceWith(page);
  document.title = `${def[1]} · Rawendpaneel`;
  current = { name: def[0], cleanup: null, key, update: null };
  try {
    const mod = await import(`./pages/${def[0]}.js`);
    if (current.key !== key) return; // ondertussen al verder geklikt
    const res = await mod.default(page, { ...r, app, go, setFab, quickAdd, searchAll });
    if (typeof res === 'function') current.cleanup = res;
    else if (res) { current.cleanup = res.cleanup || null; current.update = res.update || null; }
  } catch (e) { console.error(e); page.innerHTML = `<div class="card"><b>Deze pagina kon niet laden</b><p class="muted small">${esc(e.message)}</p></div>`; }
  if (!r.query.keep) scrollTo({ top: 0 });
  if (r.query.snel) setTimeout(() => quickAdd(), 150);
}
addEventListener('hashchange', route);

// ---------------------------------------------------------------- tellers (taken vandaag, meldingen)
async function refreshBadges() {
  try {
    const t = await api('GET', '/api/tasks');
    const end = new Date(); end.setHours(23, 59, 59, 999);
    const n = t.tasks.filter((x) => !x.done && x.dueMs && x.dueMs <= end.getTime() && !x.parent).length;
    for (const b of $$('[data-badge="tasks"]')) { b.textContent = n; b.classList.toggle('hidden', !n); }
  } catch { /* */ }
}

// ---------------------------------------------------------------- snel toevoegen ("snel typen")
export function quickAdd(initial = '') {
  const s = sheet({
    title: 'Snel toevoegen', sub: 'Typ zoals je praat',
    body: `<div class="qa"><div class="in">${icon('bolt')}<input data-q placeholder="Typ hier…" autocomplete="off" enterkeyhint="done" value="${esc(initial)}" autofocus></div><div class="pv" data-pv></div></div>
      <p class="error" data-err></p>`,
    foot: '<button class="btn" data-close>Annuleren</button><button class="btn pri" data-add disabled>Toevoegen</button>',
  });
  const inp = s.$('[data-q]'), pv = s.$('[data-pv]'), addBtn = s.$('[data-add]');
  let parsed = null;
  const kinds = { event: ['cal', 'Afspraak'], task: ['tasks', 'Taak'], expense: ['euro', 'Uitgave'], note: ['note', 'Notitie'], countdown: ['flag', 'Aftellen'] };
  const run = debounce(async () => {
    const v = inp.value.trim(); if (!v) { pv.innerHTML = ''; addBtn.disabled = true; parsed = null; return; }
    try {
      parsed = await api('POST', '/api/quick/parse', { text: v });
      const k = kinds[parsed.kind];
      pv.innerHTML = `<div class="vb"></div><div class="grow"><b>${esc(k[1])}: ${esc(parsed.kind === 'note' ? (parsed.text || '').slice(0, 60) : parsed.title)}</b><small>${esc(parsed.summary)}${parsed.cal ? ` · agenda ${esc(parsed.cal)}` : ''}</small></div><span class="tag">${icon(k[0], 'xs')}${esc(k[1])}</span>`;
      addBtn.disabled = false;
    } catch { /* */ }
  }, 220);
  inp.addEventListener('input', run);
  s.$$('[data-ex]').forEach((e) => { e.onclick = () => { inp.value = e.textContent; run(); inp.focus(); }; });
  const add = async () => {
    if (!parsed) return;
    addBtn.disabled = true;
    try {
      const r = await api('POST', '/api/quick/add', { text: inp.value, parsed });
      s.close();
      toast(`${kinds[r.kind][1]} toegevoegd${r.summary ? ` · ${r.summary}` : ''}`, { icon: 'tick', action: 'Ongedaan', onAction: async () => { try { await api('POST', '/api/quick/undo', { item: r }); toast('Ongedaan gemaakt'); bus.emit('changed', r.kind); } catch (e) { fail(e); } } });
      bus.emit('changed', r.kind);
    } catch (e) { s.$('[data-err]').textContent = e.message; addBtn.disabled = false; }
  };
  addBtn.onclick = add;
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); add(); } });
  if (initial) run();
}
// ---------------------------------------------------------------- zoeken overal (Ctrl K)
const ACTIONS = [
  ['Snel toevoegen (afspraak, taak, notitie…)', () => quickAdd()], ['Website online zetten', () => go('sites?nieuw=1')],
  ['Terminal openen', () => go('terminal')], ['App installeren', () => go('apps')], ['Bestanden bekijken', () => go('bestanden')],
  ['Firewall en poorten', () => go('firewall')], ['Computer aanzetten (Wake-on-LAN)', () => go('apparaten')], ['Stroomverbruik', () => go('energie')],
  ['Opruimen (oude images, cache)', () => go('server?tab=onderhoud')], ['Processen bekijken', () => go('server?tab=processen')], ['Instellingen', () => go('instellingen')],
];
export function searchAll(initial = '') {
  const s = sheet({ title: '', body: `<div class="sp"><label class="sp-in">${icon('search')}<span class="sr">Zoek in je hele paneel</span><input data-q placeholder="Zoek sites, containers, bestanden, notities… of typ > voor een actie" autocomplete="off" value="${esc(initial)}" autofocus><kbd>Esc</kbd></label><div class="sp-res" data-res role="listbox"></div><div class="sp-foot"><span>↑↓ kiezen</span><span>↵ openen</span><span>&gt; acties</span></div></div>`, size: 'wide' });
  s.box.classList.add('sp-box');
  const inp = s.$('[data-q]'), res = s.$('[data-res]');
  let items = [], idx = 0, seq = 0;
  const PAGES = 'Pagina’s';
  const pages = Object.entries(ROUTES).filter(([k]) => k !== 'meer').map(([k, [, title]]) => ({ group: PAGES, kind: 'Pagina', title, sub: '', url: `#/${k}` }));
  function draw() {
    idx = Math.min(idx, Math.max(0, items.length - 1));
    let g = '';
    res.innerHTML = items.length ? items.map((it, i) => { const head = it.group !== g ? `<div class="sp-g">${esc(it.group)}</div>` : ''; g = it.group; return `${head}<button class="sp-it ${i === idx ? 'on' : ''}" data-i="${i}" role="option" aria-selected="${i === idx}"><span class="tag">${esc(it.kind)}</span><span class="grow"><b>${esc(it.title)}</b>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span>${it.shell ? `<span class="sp-shell" data-shell="${i}">${icon('terminal', 'xs')}shell</span>` : ''}</button>`; }).join('') : '<p class="muted small" style="padding:16px;text-align:center">Niets gevonden</p>';
    const on = $('.sp-it.on', res); if (on) on.scrollIntoView({ block: 'nearest' });
  }
  const local = (q) => {
    const cmd = q.startsWith('>'); const t = q.replace(/^>\s*/, '').toLowerCase();
    const acts = ACTIONS.filter(([l]) => !t || l.toLowerCase().includes(t)).map(([title, fn]) => ({ group: 'Acties', kind: 'Actie', title, run: fn }));
    if (cmd) return acts;
    const pg = pages.filter((p) => !t || p.title.toLowerCase().includes(t));
    const add = t ? [{ group: 'Toevoegen', kind: 'Nieuw', title: `"${q}" toevoegen`, sub: 'als afspraak, taak, notitie of uitgave – zoals je het typt', run: () => quickAdd(q) }] : [];
    return [...pg.slice(0, t ? 4 : 6), ...acts.slice(0, t ? 3 : 5), ...add];
  };
  const run = debounce(async () => {
    const q = inp.value.trim(); const my = ++seq;
    items = local(q); idx = 0; draw();
    if (q.length < 2 || q.startsWith('>')) return;
    try { const r = await api('GET', `/api/search?q=${encodeURIComponent(q)}`); if (my !== seq) return; const l = local(q); items = [...l.filter((x) => x.group === PAGES), ...r, ...l.filter((x) => x.group !== PAGES)]; draw(); } catch { /* */ }
  }, 160);
  const open = (it, shell) => { if (!it) return; s.close(); if (shell) go(`terminal?container=${encodeURIComponent(it.shell)}`); else if (it.run) it.run(); else location.hash = it.url; };
  inp.addEventListener('input', run);
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(items.length - 1, idx + 1); draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(0, idx - 1); draw(); }
    else if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); open(items[idx]); }
  });
  res.addEventListener('click', (e) => { const sh = e.target.closest('[data-shell]'); if (sh) { e.stopPropagation(); open(items[Number(sh.dataset.shell)], true); return; } const b = e.target.closest('[data-i]'); if (b) open(items[Number(b.dataset.i)]); });
  items = local(initial); draw(); if (initial) run();
}
addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if (app.started && !document.querySelector('dialog[open]')) searchAll(); }
});

// ---------------------------------------------------------------- nieuwe versie / service worker / meldingen
async function checkVersion() {
  try {
    const { version } = await api('GET', '/api/version');
    if (version && version !== VERSION && !document.querySelector('dialog[open]')) location.reload();
  } catch { /* offline */ }
}
async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try { app.sw = await navigator.serviceWorker.register('/sw.js', { scope: '/' }); } catch (e) { console.warn('SW', e); }
  navigator.serviceWorker.addEventListener('message', (e) => { if (e.data && e.data.type === 'navigate' && e.data.url) location.hash = e.data.url.replace(/^.*#/, '#'); });
}
export async function pushState() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return { supported: false, iosNeedsInstall: IS_IOS && !STANDALONE };
  const reg = await Promise.race([navigator.serviceWorker.ready, sleep(2500).then(() => null)]);
  if (!reg) return { supported: false, iosNeedsInstall: IS_IOS && !STANDALONE, noSw: true };
  const sub = await reg.pushManager.getSubscription();
  return { supported: true, enabled: !!sub && Notification.permission === 'granted', permission: Notification.permission, iosNeedsInstall: IS_IOS && !STANDALONE };
}
export async function enablePush() {
  const st = await pushState();
  if (!st.supported) throw new Error(st.iosNeedsInstall ? 'Zet het paneel eerst op je beginscherm (Deel → Zet op beginscherm) en open het van daar.' : 'Je browser ondersteunt geen meldingen.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Meldingen zijn geweigerd. Zet ze aan in de instellingen van je browser/gsm.');
  const reg = await navigator.serviceWorker.ready;
  const { key } = await api('GET', '/api/push/key');
  const raw = atob(key.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (key.length % 4)) % 4));
  const appKey = Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
  let sub = await reg.pushManager.getSubscription();
  if (sub) { try { await sub.unsubscribe(); } catch { /* */ } }
  sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey });
  await api('POST', '/api/push/subscribe', { subscription: sub.toJSON() });
  return true;
}
export async function disablePush() {
  const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription();
  if (sub) { await api('POST', '/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe(); }
}
export function setTheme(t) { ls.set('theme', t); if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t); }
addEventListener('online', () => document.body.classList.remove('offline'));
addEventListener('offline', () => document.body.classList.add('offline'));
if (!navigator.onLine) document.body.classList.add('offline');

boot();
export { Live, sleep, isMobile };
