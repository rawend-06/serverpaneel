/* Netwerk: snelheid in MB/s, hoe je server verbonden is, en wie er op je netwerk zit – met een echte naam per apparaat. */
import { $, esc, icon, api, toast, fail, prompt, ago, debounce } from '../core.js';
import * as Live from '../live.js';

const nl = (n, d = 1) => Number(n || 0).toLocaleString('nl-BE', { minimumFractionDigits: d, maximumFractionDigits: d });
const TYPE_ICON = { phone: 'M8 2h8a2 2 0 012 2v16a2 2 0 01-2 2H8a2 2 0 01-2-2V4a2 2 0 012-2zM11 18h2', tablet: 'M6 2h12a2 2 0 012 2v16a2 2 0 01-2 2H6a2 2 0 01-2-2V4a2 2 0 012-2zM11 18h2', laptop: 'M4 5h16v11H4zM2 19h20', pc: 'M3 4h18v12H3zM8 20h8M12 16v4', tv: 'M3 5h18v12H3zM8 21h8M12 17v4', server: 'M3 4h18v7H3zM3 13h18v7H3zM7 7.5h.01M7 16.5h.01', game: 'M6 9h12a4 4 0 010 8l-2-2H8l-2 2a4 4 0 010-8zM8 12v2M7 13h2M16 12h.01', speaker: 'M6 3h12v18H6zM12 14a2 2 0 100 4 2 2 0 000-4zM12 7h.01', printer: 'M6 9V3h12v6M6 18H4v-7h16v7h-2M6 14h12v7H6z', router: 'M3 14h18v6H3zM7 17h.01M11 17h.01M8 10a6 6 0 018 0M5 7a10 10 0 0114 0', iot: 'M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4M12 8a4 4 0 100 8 4 4 0 000-8z', unknown: 'M12 17h.01M9.1 9a3 3 0 015.8 1c0 2-3 3-3 3M12 2a10 10 0 100 20 10 10 0 000-20z' };
const TYPE_NAME = { phone: 'gsm', tablet: 'tablet', laptop: 'laptop', pc: 'computer', tv: 'tv', server: 'server', game: 'spelconsole', speaker: 'slimme speaker', printer: 'printer', router: 'router', iot: 'slim toestel', unknown: '' };
const FROM = { jij: 'naam van jou', toestel: 'naam van het toestel', windows: 'Windows-naam', router: 'naam van je router' };

export default async function networkPage(root, ctx) {
  let net = null, devs = null, sort = 'naam', q = '', running = false;
  const hist = { rx: [], tx: [] };
  root.innerHTML = `
    <div class="top"><a class="iconbtn back" href="#/meer" aria-label="Terug">${icon('left')}</a><div class="grow"><h1>Netwerk</h1><p>Alle snelheden in MB/s (megabyte per seconde) · 1 MB/s = 8 Mbit/s</p></div>
      <div class="actions"><span class="nw-pill" data-pill></span></div></div>
    <div class="nw">
      <section class="nw-speed" aria-label="Snelheidstest">
        <div class="row" style="justify-content:space-between"><h2>Snelheidstest</h2><small data-when></small></div>
        <div class="nw-gauge"><svg viewBox="0 0 300 190" role="img" aria-label="Snelheidsmeter" data-gauge>
          <defs><linearGradient id="nw-sweep" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#1F5EFF" stop-opacity="0"/><stop offset="100%" stop-color="#1F5EFF" stop-opacity=".35"/></linearGradient><clipPath id="nw-half"><rect x="0" y="0" width="300" height="150"/></clipPath></defs>
          <g clip-path="url(#nw-half)" aria-hidden="true"><g class="nw-radar"><path d="M150 150 L150 40 A110 110 0 0 1 228 72 Z" fill="url(#nw-sweep)"/></g><circle cx="150" cy="150" r="70" fill="none" stroke="#16244A" stroke-dasharray="2 5"/><circle cx="150" cy="150" r="40" fill="none" stroke="#16244A" stroke-dasharray="2 5"/></g>
          <path d="M30 150 A120 120 0 0 1 270 150" fill="none" stroke="#16244A" stroke-width="16" stroke-linecap="round"/>
          <path class="nw-arc" data-arc d="M30 150 A120 120 0 0 1 270 150" fill="none" stroke="#1F5EFF" stroke-width="16" stroke-linecap="round" stroke-dasharray="377" stroke-dashoffset="377"/>
          <g fill="#A9BBE0" font-size="10" font-weight="600" data-scale></g>
          <g class="nw-needle" data-needle style="transform:rotate(-90deg)"><path d="M150 150 L150 48" stroke="#FF6B3D" stroke-width="4" stroke-linecap="round"/></g>
          <circle cx="150" cy="150" r="11" fill="#FF6B3D"/><circle cx="150" cy="150" r="4" fill="#0B1530"/>
        </svg></div>
        <div class="nw-big"><b class="num" data-down>–</b> <span>MB/s download</span></div>
        <div class="nw-kv"><div><b class="num" data-up>–</b><span>MB/s upload</span></div><div><b class="num" data-ping>–</b><span>ms ping</span></div><div><b class="num" data-max>–</b><span>MB/s max <span data-maxlbl>kabel</span></span></div></div>
        <button class="btn pri lg block" data-run>${icon('speed', 'sm')}Snelheidstest starten</button>
        <p class="tiny" style="color:#A9BBE0;margin:0;text-align:center">Duurt ± 20 seconden · 8 verbindingen tegelijk via Cloudflare</p>
      </section>
      <section class="card nw-devs" aria-label="Wie zit er op je netwerk">
        <div class="row wrap" style="gap:8px;margin-bottom:10px"><h3 class="grow" style="margin:0">${icon('wifi')}Wie zit er op je netwerk <span class="muted small" data-count></span></h3>
          <label class="sbox sm" style="width:180px">${icon('search', 'sm')}<input data-q placeholder="Zoek" aria-label="Zoek apparaat"></label>
          <div class="seg" role="group" aria-label="Sorteren"><button data-sort="naam" class="on" aria-pressed="true">Naam</button><button data-sort="ip" aria-pressed="false">Adres</button><button data-sort="nieuw" aria-pressed="false">Nieuwst</button></div>
          <button class="btn sm" data-refresh title="Namen opnieuw zoeken">${icon('refresh', 'sm')}<span class="desk-only">Namen zoeken</span></button></div>
        <div class="nw-list" data-list><div class="row muted" style="padding:16px"><span class="spinner"></span>Apparaten en namen zoeken…</div></div>
      </section>
      <div class="nw-side">
        <section class="card nw-live"><div class="row" style="justify-content:space-between"><h3 style="margin:0">${icon('activity')}Nu live</h3><span class="num small" style="font-weight:700"><span style="color:var(--p)">↓ <span data-ldn>–</span></span> · <span style="color:var(--a2)">↑ <span data-lup>–</span></span> MB/s</span></div><div class="nw-bars" data-bars></div><div class="row tiny muted" style="justify-content:space-between;font-weight:600"><span>1 minuut geleden</span><span>nu</span></div></section>
        <section class="card nw-checks"><h3 style="margin:0 0 8px">${icon('info')}Waarom niet sneller?</h3><div class="col" style="gap:9px" data-checks><div class="row muted small"><span class="spinner"></span>Controleren…</div></div></section>
      </div>
    </div>`;
  ctx.setFab(null, { hide: true });

  // ---------------------------------------------------------------- snelheid
  function gauge() {
    const link = net && (net.links || [])[0];
    const max = link && link.speed ? link.speed / 8 : 125;
    const sp = net && net.speed;
    const down = sp ? sp.down / 8e6 : null; const pct = down == null ? 0 : Math.min(1, down / max);
    $('[data-scale]', root).innerHTML = [0, 0.25, 0.5, 0.75, 1].map((f, i) => { const a = Math.PI * (1 - f); const x = 150 + Math.cos(a) * 140, y = 150 - Math.sin(a) * 140 + (i === 0 || i === 4 ? 22 : 4); return `<text x="${x.toFixed(0)}" y="${y.toFixed(0)}" text-anchor="middle">${Math.round(max * f)}</text>`; }).join('');
    $('[data-arc]', root).style.strokeDashoffset = String(running ? 377 : 377 * (1 - pct));
    $('[data-arc]', root).setAttribute('stroke', pct && pct < 0.7 ? '#FF6B3D' : '#1F5EFF');
    $('[data-needle]', root).style.transform = `rotate(${running ? -90 : -90 + pct * 180}deg)`;
    $('[data-down]', root).textContent = running ? '…' : down == null ? '–' : nl(down);
    $('[data-up]', root).textContent = sp ? nl(sp.up / 8e6) : '–';
    $('[data-ping]', root).textContent = sp && sp.ping != null ? Math.round(sp.ping) : '–';
    $('[data-max]', root).textContent = link && link.speed ? nl(max, 0) : '–';
    $('[data-maxlbl]', root).textContent = link && link.kind === 'wifi' ? 'wifi' : 'kabel';
    $('[data-when]', root).textContent = sp ? `laatst: ${ago(sp.at)}` : 'nog niet gemeten';
    const pill = $('[data-pill]', root);
    if (down != null && link && link.speed) { const p = Math.round(pct * 100); pill.className = `nw-pill ${p < 70 ? 'c' : ''}`; pill.textContent = p < 70 ? `Je haalt ${p}% van wat de ${link.kind === 'wifi' ? 'wifi' : 'kabel'} aankan` : `Je internet haalt ${p}% van de ${link.kind === 'wifi' ? 'wifi' : 'kabel'}`; } else pill.textContent = '';
  }
  async function loadNet() {
    try { net = await api('GET', '/api/network'); } catch (e) { fail(e); return; }
    gauge(); checks();
  }
  $('[data-run]', root).onclick = async (e) => {
    const b = e.currentTarget; if (running) return;
    running = true; b.disabled = true; b.innerHTML = '<span class="spinner"></span>Bezig met meten… (± 20 s)'; gauge();
    try { await api('POST', '/api/server/speedtest'); } catch (x) { fail(x); }
    running = false; b.disabled = false; b.innerHTML = `${icon('speed', 'sm')}Opnieuw meten`;
    await loadNet();
  };

  // ---------------------------------------------------------------- waarom niet sneller?
  function checks() {
    const el = $('[data-checks]', root); if (!el || !net) return;
    const link = (net.links || [])[0]; const sp = net.speed; const out = [];
    const ok = (t, s) => out.push(`<div class="nw-ck"><span class="ok">✓</span><span><b>${t}</b><span>${s}</span></span></div>`);
    const warn = (t, s) => out.push(`<div class="nw-ck"><span class="w">!</span><span><b>${t}</b><span>${s}</span></span></div>`);
    if (!link) warn('Geen verbinding gevonden', 'De netwerkkaart van je server kon niet uitgelezen worden.');
    else {
      if (!link.speed) warn(`${link.name}: snelheid onbekend`, 'De kaart geeft geen snelheid door (normaal bij wifi of een virtuele machine).');
      else if (link.speed < 1000) warn(`${link.kind === 'wifi' ? 'Wifi' : 'Kabel'} werkt maar op ${link.speed} Mbit/s`, `Max ${nl(link.speed / 8, 0)} MB/s. Vaak een oude of kapotte kabel: neem Cat5e of Cat6, of probeer een andere poort op je router.`);
      else ok(`${link.kind === 'wifi' ? 'Wifi' : 'Kabel'}: ${link.speed >= 1000 ? `${link.speed / 1000} Gbit/s` : `${link.speed} Mbit/s`}`, `Max ${nl(link.speed / 8, 0)} MB/s. De poort werkt op volle snelheid.`);
      if (link.duplex && link.duplex !== 'full') warn('Half-duplex', 'De verbinding kan niet tegelijk zenden en ontvangen. Controleer de kabel en de poort.');
      if (link.rxErrors + link.txErrors > 100) warn(`${link.rxErrors + link.txErrors} fouten op de kabel`, 'Er gaan pakketjes verloren. Wissel de kabel.');
      else ok('Kabel: geen fouten', `${link.rxErrors + link.txErrors} fouten sinds de laatste herstart.`);
    }
    if (sp && link && link.speed) {
      const p = sp.down / 8e6 / (link.speed / 8);
      if (p < 0.7) warn(`Gemeten ${nl(sp.down / 8e6)} MB/s (${Math.round(sp.down / 1e6)} Mbit/s)`, 'Dat is minder dan je kabel aankan. Check welke snelheid je abonnement belooft, en test opnieuw als niemand anders iets downloadt of streamt.');
      else ok(`Gemeten ${nl(sp.down / 8e6)} MB/s`, 'Je haalt bijna alles wat je kabel aankan.');
    } else if (!sp) warn('Nog geen snelheidstest', 'Klik op "Snelheidstest starten" om te meten.');
    if (net.dnsMs != null) (net.dnsMs < 60 ? ok : warn)(`DNS: ${net.dnsMs} ms`, net.dnsMs < 60 ? 'Sites worden snel opgezocht.' : 'Het opzoeken van sites is traag. Probeer DNS 1.1.1.1 in je router.');
    el.innerHTML = out.join('');
  }

  // ---------------------------------------------------------------- apparaten met naam
  async function loadDevs(refresh) {
    try { devs = await api(refresh ? 'POST' : 'GET', refresh ? '/api/network/devices/refresh' : '/api/network/devices'); } catch (e) { fail(e); return; }
    drawDevs();
  }
  function drawDevs() {
    let list = devs.devices.filter((d) => !q || `${d.name} ${d.host} ${d.vendor} ${d.ip} ${d.mac}`.toLowerCase().includes(q));
    const ipn = (ip) => ip.split('.').reduce((a, x) => a * 256 + Number(x), 0);
    list = list.slice().sort(sort === 'ip' ? (a, b) => ipn(a.ip) - ipn(b.ip) : sort === 'nieuw' ? (a, b) => (b.firstSeen || 0) - (a.firstSeen || 0) : (a, b) => (b.self - a.self) || (a.unknown - b.unknown) || a.name.localeCompare(b.name, 'nl'));
    $('[data-count]', root).textContent = `· ${devs.devices.length} apparaten`;
    $('[data-list]', root).innerHTML = list.map((d) => {
      const bits = [d.vendor, TYPE_NAME[d.type], d.ip].filter(Boolean);
      return `<div class="nw-dev ${d.unknown ? 'unk' : ''}">
        <span class="nw-ic t-${d.type}">${`<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="${TYPE_ICON[d.type] || TYPE_ICON.unknown}"/></svg>`}</span>
        <span class="grow" style="min-width:0"><span class="row" style="gap:6px"><b class="ellipsis">${esc(d.name)}</b>${d.isNew ? '<span class="nw-new">NIEUW</span>' : ''}${d.state === 'ok' ? '' : '<span class="tag">even weg</span>'}</span>
          <small class="ellipsis">${esc(bits.join(' · '))}${d.nameFrom ? ` · <i>${esc(FROM[d.nameFrom] || '')}</i>` : ''}${d.randomMac && !d.givenName ? ' · privé-adres (gsm/laptop)' : ''}</small></span>
        <span class="nw-seen small muted">${d.firstSeen ? ago(d.firstSeen) : ''}</span>
        <button class="btn sm ${d.unknown ? 'pri' : 'ghost'}" data-name="${esc(d.mac)}">${d.unknown ? 'Naam geven' : icon('edit', 'sm')}</button></div>`;
    }).join('') || '<p class="muted small" style="padding:12px">Niets gevonden.</p>';
    if (!devs.ouiReady) $('[data-list]', root).insertAdjacentHTML('beforeend', '<p class="tiny muted" style="padding:8px">De merkenlijst wordt de eerste keer gedownload; merken verschijnen zo.</p>');
  }
  root.addEventListener('click', async (e) => {
    const s = e.target.closest('[data-sort]');
    if (s) { sort = s.dataset.sort; root.querySelectorAll('[data-sort]').forEach((b) => { b.classList.toggle('on', b === s); b.setAttribute('aria-pressed', b === s); }); drawDevs(); return; }
    const n = e.target.closest('[data-name]');
    if (n) {
      const d = devs.devices.find((x) => x.mac === n.dataset.name);
      const v = await prompt('Wie is dit?', { value: d.givenName || (d.unknown ? '' : d.name), label: [d.vendor, d.host, d.ip, d.mac.toUpperCase()].filter(Boolean).join(' · '), placeholder: 'bv. Laptop van Noor', ok: 'Bewaren' });
      if (v === null) return;
      try { await api('POST', '/api/devices/name', { mac: d.mac, name: v }); toast(v ? 'Naam bewaard' : 'Naam gewist'); loadDevs(); } catch (x) { fail(x); }
      return;
    }
    if (e.target.closest('[data-refresh]')) { toast('Namen worden opnieuw gezocht…'); await loadDevs(true); setTimeout(() => loadDevs(), 6000); }
  });
  $('[data-q]', root).addEventListener('input', debounce((e) => { q = e.target.value.toLowerCase(); drawDevs(); }, 100));

  // ---------------------------------------------------------------- live verkeer
  function bars() {
    const el = $('[data-bars]', root); if (!el) return;
    const mx = Math.max(1, ...hist.rx, ...hist.tx);
    el.innerHTML = hist.rx.map((v, i) => `<span><i style="height:${Math.max(2, (v / mx) * 82).toFixed(1)}%"></i><i class="u" style="height:${Math.max(2, ((hist.tx[i] || 0) / mx) * 82).toFixed(1)}%"></i></span>`).join('');
    const last = (a) => (a.length ? a[a.length - 1] / 1e6 : 0);
    $('[data-ldn]', root).textContent = nl(last(hist.rx), last(hist.rx) < 10 ? 2 : 1); $('[data-lup]', root).textContent = nl(last(hist.tx), last(hist.tx) < 10 ? 2 : 1);
  }
  try { const s = await api('GET', '/api/stats?range=15m'); hist.rx = (s.history.rx || []).slice(-40).map((v) => v || 0); hist.tx = (s.history.tx || []).slice(-40).map((v) => v || 0); bars(); } catch { /* */ }
  const un = Live.on('stats', (d) => { if (!d.now) return; hist.rx.push(d.now.rx || 0); hist.tx.push(d.now.tx || 0); if (hist.rx.length > 40) { hist.rx.shift(); hist.tx.shift(); } bars(); });

  await Promise.all([loadNet(), loadDevs()]);
  setTimeout(() => loadDevs(), 5000); // namen komen er even later bij
  const iv = setInterval(() => { if (!document.hidden) loadDevs(); }, 30000);
  return () => { un(); clearInterval(iv); };
}
