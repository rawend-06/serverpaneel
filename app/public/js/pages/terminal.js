/* Terminal: rechtstreeks op je server (ook buiten thuis), met tabbladen, een shell in een container en snelle commando's. */
import { $, $$, esc, icon, api, fail, toast, debounce, isMobile, stepUp, menu, sheet, emptyState, ls } from '../core.js';
import { app } from '../main.js';

let xtermLoaded = null;
export function loadXterm() {
  if (xtermLoaded) return xtermLoaded;
  const base = app.base;
  const add = (tag, attrs) => new Promise((res, rej) => { const el = document.createElement(tag); Object.assign(el, attrs); el.onload = res; el.onerror = () => rej(new Error('Terminal kon niet laden')); document.head.appendChild(el); });
  xtermLoaded = Promise.all([add('link', { rel: 'stylesheet', href: `${base}/vendor/xterm.css` }), add('script', { src: `${base}/vendor/xterm.js` }).then(() => add('script', { src: `${base}/vendor/xterm-fit.js` }))]).catch((e) => { xtermLoaded = null; throw e; });
  return xtermLoaded;
}
const THEME = { background: '#071022', foreground: '#DCE8FF', cursor: '#7FB0FF', selectionBackground: 'rgba(59,130,246,.4)', black: '#0A1630', blue: '#60A5FA', brightBlue: '#93C5FD', cyan: '#7FB0FF', brightCyan: '#BFD6FF', green: '#93C5FD', brightGreen: '#BFD6FF', red: '#F87171', yellow: '#FFFFFF', magenta: '#A5B4FC', white: '#E6EEFF' };
const KEYS = ['Esc', 'Tab', 'Ctrl', 'Ctrl+C', '↑', '↓', '←', '→', '|', '~', '/', '-'];
const KEYMAP = { Esc: '\x1b', Tab: '\t', '↑': '\x1b[A', '↓': '\x1b[B', '→': '\x1b[C', '←': '\x1b[D', 'Ctrl+C': '\x03' };

export default async function terminalPage(root, ctx) {
  root.innerHTML = `
    <div class="top"><a class="iconbtn back" href="#/meer" aria-label="Terug">${icon('left')}</a><div class="grow"><h1>Terminal</h1><p>Rechtstreeks op je server – thuis en onderweg, zonder SSH-app</p></div>
      <div class="actions"><button class="btn icon keep" data-fs-down title="Kleiner" aria-label="Tekst kleiner">${icon('minus', 'sm')}</button><button class="btn icon keep" data-fs-up title="Groter" aria-label="Tekst groter">${icon('plus', 'sm')}</button><button class="btn keep desk-only" data-full>${icon('ext', 'sm')}Volledig scherm</button></div></div>
    <div data-tp></div>`;
  ctx.setFab(null, { hide: true });
  const panel = termPanel($('[data-tp]', root), { page: true, container: ctx.query.container || '' });
  $('[data-fs-up]', root).onclick = () => panel.fontSize(1);
  $('[data-fs-down]', root).onclick = () => panel.fontSize(-1);
  $('[data-full]', root).onclick = () => { const el = $('.term-wrap', root); if (el && el.requestFullscreen) el.requestFullscreen().catch(() => {}); };
  return panel.cleanup;
}

// Ook gebruikt door het tabblad Terminal op de serverpagina
export function termPanel(body, { page = false, container = '' } = {}) {
  let info = null, alive = true, ctrl = false, size = Number(ls.get('term-font', isMobile() ? 12.5 : 13.5)) || 13.5;
  const tabs = []; let cur = null, ro = null;
  body.innerHTML = '<div class="row muted" style="padding:20px"><span class="spinner"></span>Laden…</div>';
  (async () => {
    try { info = await api('GET', '/api/terminal/info'); } catch (e) { body.innerHTML = `<p class="error">${esc(e.message)}</p>`; return; }
    if (!alive) return;
    if (!info.available) { body.innerHTML = `<div class="card">${emptyState('terminal', 'Terminal is nog niet beschikbaar', 'Werk het paneel bij met de nieuwste versie: die bevat de terminal.')}</div>`; return; }
    const secure = location.protocol === 'https:';
    body.innerHTML = `
      <div class="term-conn"><div class="ib sm s">${icon('shield', 'sm')}</div><div class="grow small"><b>${secure ? 'Veilig verbonden (https)' : 'Verbonden via je thuisnetwerk'}</b> <span class="muted">· ${esc(location.host)} · als <b>${esc(info.user || 'rawend')}</b> · voor <code>sudo</code> typ je je serverwachtwoord · sluit na 30 min niets doen</span></div></div>
      <div class="term-layout">
        <div class="term-main" data-main><div class="card" style="padding:16px"><div class="row wrap"><div class="grow"><b>Klaar om te verbinden</b><div class="muted small">Je bevestigt eerst met Face ID, vingerafdruk of je code.</div></div><button class="btn pri" data-open>${icon(container ? 'box' : 'terminal', 'sm')}${container ? `Shell in ${esc(container)} openen` : 'Terminal openen'}</button></div></div></div>
        <aside class="term-side card" data-side>
          <h3>${icon('bolt')}Snelle commando's</h3><p class="sub">Eén tik = uitvoeren in het open tabblad</p>
          <div class="snips" data-snips></div>
          <button class="btn sm line block" data-edit-snips style="margin-top:8px">${icon('edit', 'sm')}Aanpassen</button>
        </aside>
      </div>`;
    drawSnips();
    $('[data-open]', body).onclick = () => open(container && info.containers.includes(container) ? container : null);
    $('[data-edit-snips]', body).onclick = editSnips;
  })();

  function drawSnips() {
    const box = $('[data-snips]', body); if (!box) return;
    box.innerHTML = info.snippets.map((s, i) => `<button class="snip" data-s="${i}"><b>${esc(s.label)}</b><code>${esc(s.cmd)}</code></button>`).join('') || '<p class="muted small">Nog geen snelle commando\'s.</p>';
    box.onclick = (e) => { const b = e.target.closest('[data-s]'); if (!b) return; runSnip(info.snippets[Number(b.dataset.s)]); };
    const chips = $('[data-chips]', body);
    if (chips) { chips.innerHTML = info.snippets.map((s, i) => `<button data-s="${i}">${esc(s.label)}</button>`).join(''); chips.onclick = box.onclick; }
  }
  function runSnip(s) {
    if (!cur) { toast('Open eerst de terminal'); return; }
    send(cur, { t: 'i', d: `${s.cmd}\r` }); cur.term.focus();
  }
  function editSnips() {
    const rows = () => `<div class="col" data-rows>${info.snippets.map((s) => row(s)).join('')}</div><button class="btn sm line" data-add style="margin-top:8px">${icon('plus', 'sm')}Commando toevoegen</button>`;
    const row = (s = { label: '', cmd: '' }) => `<div class="snip-edit"><input data-l placeholder="Naam (bv. Logs van caddy)" value="${esc(s.label)}"><input data-c class="mono" placeholder="docker logs -f --tail 50 caddy" value="${esc(s.cmd)}"><button class="btn icon sm ghost" data-del aria-label="Verwijderen">${icon('trash', 'sm')}</button></div>`;
    const sh = sheet({ title: 'Snelle commando\'s', sub: 'Bewaard op je server, dus ook op je gsm', body: rows(), foot: '<button class="btn" data-close>Annuleren</button><button class="btn pri" data-ok>Bewaren</button>' });
    sh.body.addEventListener('click', (e) => {
      if (e.target.closest('[data-del]')) e.target.closest('.snip-edit').remove();
      if (e.target.closest('[data-add]')) { sh.$('[data-rows]').insertAdjacentHTML('beforeend', row()); sh.$('[data-rows] .snip-edit:last-child input').focus(); }
    });
    sh.$('[data-ok]').onclick = async () => {
      const list = sh.$$('.snip-edit').map((r) => ({ label: $('[data-l]', r).value, cmd: $('[data-c]', r).value }));
      try { info.snippets = await api('POST', '/api/terminal/snippets', { snippets: list }); drawSnips(); sh.close(); toast('Bewaard'); } catch (e) { fail(e); }
    };
  }

  async function open(container) {
    if (!(await stepUp(container ? `een shell openen in ${container}` : 'de terminal openen'))) return;
    try { await loadXterm(); } catch (e) { fail(e); return; }
    if (!alive) return;
    let main = $('[data-main]', body);
    if (!$('.term-wrap', main)) {
      main.innerHTML = `<div class="term-wrap"><div class="term-bar" role="tablist" aria-label="Sessies"><div class="tabs" data-tabs></div><button class="tab add" data-add aria-label="Nieuw tabblad">${icon('plus', 'xs')}</button><div class="r"><span data-st></span><button class="btn sm ghost" data-paste style="color:#C9D8F5">${icon('copy', 'sm')}<span class="desk-only">Plakken</span></button><button class="btn sm ghost" data-re style="color:#C9D8F5">${icon('refresh', 'sm')}<span class="desk-only">Opnieuw</span></button></div></div>
        <div class="term-views" data-views></div>
        <div class="term-chips" data-chips></div>
        <div class="term-keys">${KEYS.map((k) => `<button data-k="${k}">${k}</button>`).join('')}</div></div>`;
      drawSnips();
      $('[data-add]', main).onclick = (e) => menu(e.currentTarget, [{ label: `Server (${info.user || 'rawend'})`, icon: 'server', onClick: () => open(null) }, '-', ...info.containers.map((c) => ({ label: `Container: ${c}`, icon: 'box', onClick: () => open(c) }))]);
      $('[data-re]', main).onclick = () => { if (!cur) return; if (cur.ws) cur.ws.close(); cur.term.reset(); connect(cur); };
      $('[data-paste]', main).onclick = async () => { if (!cur) return; try { const t = await navigator.clipboard.readText(); if (t) send(cur, { t: 'i', d: t }); cur.term.focus(); } catch { toast('Plakken mag niet in deze browser: gebruik Ctrl+Shift+V of lang drukken', { err: true }); } };
      main.addEventListener('click', (e) => {
        const k = e.target.closest('[data-k]'); if (!k || !cur) return; e.preventDefault();
        if (k.dataset.k === 'Ctrl') { ctrl = !ctrl; k.classList.toggle('on', ctrl); cur.term.focus(); return; }
        send(cur, { t: 'i', d: KEYMAP[k.dataset.k] || k.dataset.k }); cur.term.focus();
      });
      ro = new ResizeObserver(debounce(() => { if (cur) try { cur.fit.fit(); } catch { /* */ } }, 80)); ro.observe($('[data-views]', main));
    }
    const t = { id: Math.random().toString(36).slice(2), container, title: container || location.hostname.replace(/^www\./, '').split('.')[0] || 'server' };
    t.el = document.createElement('div'); t.el.className = 'term'; $('[data-views]', main).appendChild(t.el);
    t.term = new window.Terminal({ fontFamily: 'ui-monospace, "Cascadia Code", "SF Mono", Consolas, monospace', fontSize: size, cursorBlink: true, scrollback: 5000, theme: THEME });
    t.fit = new window.FitAddon.FitAddon(); t.term.loadAddon(t.fit);
    tabs.push(t); select(t);
    t.term.open(t.el); t.fit.fit(); t.term.focus();
    t.term.onData((d) => { if (ctrl && d.length === 1) { const c = d.toUpperCase().charCodeAt(0); if (c >= 64 && c <= 95) d = String.fromCharCode(c - 64); ctrl = false; $('[data-k="Ctrl"]', body)?.classList.remove('on'); } send(t, { t: 'i', d }); });
    t.term.onResize(({ cols, rows }) => send(t, { t: 'r', c: cols, r: rows }));
    connect(t);
  }
  function drawTabs() {
    const box = $('[data-tabs]', body); if (!box) return;
    box.innerHTML = tabs.map((t) => `<span class="tab ${t === cur ? 'on' : ''}" role="tab" aria-selected="${t === cur}" data-t="${t.id}" tabindex="0">${icon(t.container ? 'box' : 'terminal', 'xs')}${esc(t.title)}<span class="dotc ${t.state || ''}"></span><button class="x" data-close-t="${t.id}" aria-label="Tabblad sluiten">${icon('x', 'xs')}</button></span>`).join('');
    box.onclick = (e) => {
      const c = e.target.closest('[data-close-t]'); if (c) { e.stopPropagation(); close(tabs.find((t) => t.id === c.dataset.closeT)); return; }
      const tb = e.target.closest('[data-t]'); if (tb) select(tabs.find((t) => t.id === tb.dataset.t));
    };
  }
  function select(t) {
    cur = t; for (const x of tabs) x.el.style.display = x === t ? '' : 'none';
    drawTabs(); status();
    if (t.term) setTimeout(() => { try { t.fit.fit(); t.term.focus(); } catch { /* */ } }, 0);
  }
  function close(t) {
    if (!t) return; if (t.ws) t.ws.close(); t.term.dispose(); t.el.remove();
    tabs.splice(tabs.indexOf(t), 1);
    if (tabs.length) select(tabs[tabs.length - 1]); else { cur = null; drawTabs(); status(); }
  }
  function status() {
    const st = $('[data-st]', body); if (!st) return;
    const s = cur ? cur.state : '';
    st.textContent = !cur ? 'geen sessie' : s === 'up' ? 'verbonden' : s === 'down' ? 'gesloten' : 'verbinden…';
    st.style.color = s === 'up' ? '#93C5FD' : '#C9D8F5';
  }
  function send(t, o) { if (t && t.ws && t.ws.readyState === 1) t.ws.send(JSON.stringify(o)); }
  function connect(t) {
    t.state = ''; drawTabs(); status();
    const q = `cols=${t.term.cols}&rows=${t.term.rows}${t.container ? `&container=${encodeURIComponent(t.container)}` : ''}`;
    t.ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/terminal?${q}`);
    t.ws.onopen = () => { t.state = 'up'; drawTabs(); status(); };
    t.ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } if (m.t === 'o') t.term.write(m.d); else if (m.t === 'x') t.term.write('\r\n\x1b[90m[sessie gesloten]\x1b[0m\r\n'); };
    t.ws.onclose = (e) => { t.state = 'down'; drawTabs(); status(); if (e.code === 1006 && alive) t.term.write('\r\n\x1b[37mVerbinding kon niet gemaakt worden. Bevestig opnieuw en klik op Opnieuw.\x1b[0m\r\n'); };
  }
  function fontSize(d) {
    size = Math.max(9, Math.min(22, size + d)); ls.set('term-font', size);
    for (const t of tabs) { t.term.options.fontSize = size; try { t.fit.fit(); } catch { /* */ } }
  }
  const cleanup = () => { alive = false; for (const t of tabs) { if (t.ws) t.ws.close(); t.term.dispose(); } if (ro) ro.disconnect(); };
  return { cleanup, fontSize, page };
}
