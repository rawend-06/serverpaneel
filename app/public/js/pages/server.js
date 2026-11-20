/* Server: live overzicht (widgets die je zelf kiest), schijven (elk deel apart), processen, onderhoud en terminal. */
import { $, $$, esc, icon, api, toast, fail, confirmSheet, fmtBytes, fmtUptime, ago, debounce, stepUp, isMobile, emptyState, T } from '../core.js';
import * as Live from '../live.js';
import { line, spark } from '../charts.js';
import { app } from '../main.js';
import { termPanel } from './terminal.js';

const TABS = [['overzicht', 'Overzicht', 'activity'], ['schijven', 'Schijven', 'disk'], ['processen', 'Processen', 'list'], ['onderhoud', 'Onderhoud', 'wrench'], ['terminal', 'Terminal', 'terminal']];
const rate = (b) => (b == null ? '–' : `${fmtBytes(b)}/s`);
const pct = (v) => (v == null ? '–' : `${Math.round(v)}%`);
const deg = (v) => (v == null ? '–' : `${Math.round(v)} °C`);
const tempTag = (v) => (v == null ? '' : v < 60 ? '<span class="tag ok">Normaal</span>' : v < 75 ? '<span class="tag w">Warm</span>' : '<span class="tag b">Heet!</span>');
const useCls = (p) => (p >= 90 ? 'b' : p >= 80 ? 'w' : '');
const meter = (p, cls = '') => `<div class="meter ${cls}"><span style="width:${Math.max(1.5, Math.min(100, p || 0))}%"></span></div>`;
const sums = (d) => (d.disks || []).reduce((a, x) => ({ total: a.total + x.total, used: a.used + x.used, free: a.free + x.free }), { total: 0, used: 0, free: 0 });
const statsLine = (vals, fmt) => { const v = (vals || []).filter((x) => x != null); if (!v.length) return ''; const avg = v.reduce((a, b) => a + b, 0) / v.length; return `<span>gem. <b>${esc(fmt(avg))}</b></span><span>hoogste <b>${esc(fmt(Math.max(...v)))}</b></span><span>laagste <b>${esc(fmt(Math.min(...v)))}</b></span>`; };

// ---------------------------------------------------------------- widgets
const kpi = (id, title, ic, body) => ({ id, title, icon: ic, sizes: [1, 2, 4], size: 1, kind: 'kpi', body });
const chart = (id, title, ic, def) => ({ id, title, icon: ic, sizes: [2, 4], size: 2, kind: 'chart', ...def });
const W = [
  kpi('cpu', 'Processor', 'cpu', (d) => `<div class="big num">${pct(d.now.cpu)}</div><div class="sb">belasting ${(d.info.load || []).map((l) => l.toFixed(2)).join(' · ')}</div><div class="spark" data-spark="cpu" data-cls="s1" data-max="100"></div>`),
  kpi('temp', 'Temperatuur', 'temp', (d) => `<div class="big num">${deg(d.now.temp)} ${tempTag(d.now.temp)}</div><div class="sb">${d.now.temp == null ? 'geen sensor gevonden' : 'van de processor'}</div><div class="spark" data-spark="temp" data-cls="s2"></div>`),
  kpi('mem', 'Geheugen', 'mem', (d) => `<div class="big num">${pct((d.mem.used / d.mem.total) * 100)}</div><div class="sb">${fmtBytes(d.mem.used)} van ${fmtBytes(d.mem.total)}</div><div class="spark" data-spark="mem" data-cls="s1" data-max="100"></div>`),
  kpi('disk', 'Opslag', 'disk', (d) => { const s = sums(d), p = s.total ? (s.used / s.total) * 100 : 0; return `<div class="big num">${fmtBytes(s.free)} <small>vrij</small></div><div class="sb">${fmtBytes(s.used)} van ${fmtBytes(s.total)} · ${(d.disks || []).length} ${(d.disks || []).length === 1 ? 'deel' : 'delen'}</div>${meter(p, useCls(p) || 's')}`; }),
  kpi('net', 'Netwerk', 'wifi', (d) => `<div class="big num" style="font-size:17px">↓ ${rate(d.now.rx)}<br>↑ ${rate(d.now.tx)}</div><div class="spark" data-spark="rx" data-cls="s1"></div>`),
  kpi('uptime', 'Online sinds', 'clock', (d) => `<div class="big">${esc(fmtUptime(d.info.uptime))}</div><div class="sb">zonder herstart</div>`),
  kpi('swap', 'Swap', 'mem', (d) => { const p = d.mem.swapTotal ? (d.mem.swapUsed / d.mem.swapTotal) * 100 : 0; return `<div class="big num">${fmtBytes(d.mem.swapUsed)}</div><div class="sb">van ${fmtBytes(d.mem.swapTotal)}</div>${meter(p, useCls(p))}`; }),
  chart('chart-cpu', 'Processorgebruik', 'cpu', { size: 4, series: (h) => [{ name: 'Processor', values: h.cpu, cls: 's1' }], fmt: pct, yMax: 100 }),
  chart('chart-temp', 'Temperatuur', 'temp', { series: (h) => [{ name: 'Temperatuur', values: h.temp, cls: 's2' }], fmt: deg, minMax: 60, empty: 'Geen temperatuursensor gevonden.' }),
  chart('chart-mem', 'Geheugengebruik', 'mem', { series: (h) => [{ name: 'Geheugen', values: h.mem, cls: 's1' }], fmt: pct, yMax: 100 }),
  chart('chart-net', 'Netwerkverkeer', 'wifi', { series: (h) => [{ name: 'Binnen ↓', values: h.rx, cls: 's1' }, { name: 'Buiten ↑', values: h.tx, cls: 's2' }], fmt: rate, bytes: true }),
  chart('chart-io', 'Schijfactiviteit', 'disk', { series: (h) => [{ name: 'Lezen', values: h.rd, cls: 's1' }, { name: 'Schrijven', values: h.wr, cls: 's2' }], fmt: rate, bytes: true }),
  { id: 'cores', title: 'Processorkernen', icon: 'cpu', sizes: [2, 4], size: 2, body: (d) => `<h3>${icon('cpu')}Processorkernen</h3>${(d.now.cores || []).length ? `<div class="cores">${d.now.cores.map((c, i) => `<div class="core"><span class="muted">Kern ${i + 1}</span>${meter(c)}<b>${c}%</b></div>`).join('')}</div>` : '<p class="muted small">Aan het meten…</p>'}` },
  { id: 'temps', title: 'Temperaturen', icon: 'temp', sizes: [2, 4], size: 2, body: (d) => `<h3>${icon('temp')}Temperaturen</h3>${(d.temps || []).length ? `<ul class="rows">${d.temps.map((t) => `<li><span>${esc(t.label)} <small class="faint">${esc(t.chip)}</small></span><b>${tempTag(t.value)} ${deg(t.value)}</b></li>`).join('')}</ul>` : '<p class="muted small" style="margin-top:8px">Geen sensoren gevonden. Op je server: <code>sudo apt install lm-sensors</code></p>'}` },
  { id: 'disks', title: 'Opslag per deel', icon: 'disk', sizes: [2, 4], size: 2, body: (d) => `<h3>${icon('disk')}Opslag per deel<a class="more" href="#/server?tab=schijven">Indeling ${icon('right', 'xs')}</a></h3>${(d.disks || []).map((x) => { const p = (x.used / x.total) * 100; return `<div class="part"><span class="sw" style="--c:var(--p2)"></span><b>${x.mount === '/' ? 'Systeem (/)' : esc(x.mount)}</b><span class="v">${fmtBytes(x.free)} vrij</span><small>${esc(x.device)} · ${esc(x.type)} · ${fmtBytes(x.used)} van ${fmtBytes(x.total)}</small>${meter(p, useCls(p) || 's')}</div>`; }).join('') || '<p class="muted small">Geen schijven gevonden.</p>'}` },
  { id: 'top', title: 'Drukste containers', icon: 'box', sizes: [2, 4], size: 2, body: () => `<h3>${icon('box')}Drukste containers<a class="more" href="#/containers">Alle ${icon('right', 'xs')}</a></h3><div data-top></div>` },
  { id: 'info', title: 'Over deze server', icon: 'info', sizes: [2, 4], size: 2, body: (d) => `<h3>${icon('info')}Over deze server</h3><ul class="rows">
      <li><span>Systeem</span><b>${esc(d.info.os)}</b></li><li><span>Kernel</span><b>${esc(d.info.kernel)}</b></li><li><span>Processor</span><b>${esc(d.info.cpuModel)}</b></li><li><span>Kernen</span><b>${d.info.cores}</b></li>
      <li><span>Lokaal IP</span><b>${esc(d.lanIp || '–')}</b></li><li><span>Publiek IP</span><b>${esc(d.publicIp || '–')}</b></li><li><span>Netwerkkaarten</span><b>${esc(((d.net && d.net.ifaces) || []).join(', ') || '–')}</b></li></ul>` },
];
const BY = Object.fromEntries(W.map((w) => [w.id, w]));
const DEFAULT = ['cpu', 'temp', 'mem', 'disk', 'chart-cpu', 'chart-temp', 'chart-mem', 'chart-net', 'chart-io', 'cores', 'disks', 'top', 'temps', 'info'];
const defaultLayout = () => W.map((w) => ({ id: w.id, size: w.size, hidden: !DEFAULT.includes(w.id) })).sort((a, b) => (DEFAULT.indexOf(a.id) + 99 * a.hidden) - (DEFAULT.indexOf(b.id) + 99 * b.hidden));
function normalize(l) {
  const out = (l || []).filter((x) => BY[x.id]).map((x) => ({ id: x.id, size: BY[x.id].sizes.includes(x.size) ? x.size : BY[x.id].size, hidden: !!x.hidden }));
  for (const w of W) if (!out.some((x) => x.id === w.id)) out.push({ id: w.id, size: w.size, hidden: true });
  return out;
}

export default async function server(root, ctx) {
  let tab = TABS.some((t) => t[0] === ctx.query.tab) ? ctx.query.tab : 'overzicht';
  let cleanupTab = null;
  root.innerHTML = `
    <div class="top"><div class="ib" style="background:var(--grad);color:#fff">${icon('server')}</div><div class="grow ellipsis"><h1 data-name>Server</h1><p data-sub class="ellipsis">&nbsp;</p></div>
      <div class="actions"><span class="pill up" data-up></span></div></div>
    <div class="tabs">${TABS.map(([k, l, ic]) => `<button data-t="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div data-body></div>`;
  ctx.setFab(null, { hide: true });
  try { const s = await api('GET', '/api/server/summary'); $('[data-name]', root).textContent = s.hostname || 'Server'; $('[data-up]', root).textContent = `online ${fmtUptime(s.uptime)}`; } catch { /* */ }

  function setTab(t) {
    if (cleanupTab) { try { cleanupTab(); } catch { /* */ } cleanupTab = null; }
    tab = t; $$('[data-t]', root).forEach((b) => b.classList.toggle('on', b.dataset.t === t));
    history.replaceState(null, '', `#/server${t === 'overzicht' ? '' : `?tab=${t}`}`);
    const body = $('[data-body]', root); body.innerHTML = '';
    cleanupTab = ({ overzicht: overviewTab, schijven: disksTab, processen: procTab, onderhoud: maintTab, terminal: termTab })[t](body, root) || null;
  }
  root.addEventListener('click', (e) => { const t = e.target.closest('[data-t]'); if (t) setTab(t.dataset.t); });
  setTab(tab);
  return { cleanup: () => { if (cleanupTab) cleanupTab(); }, update: (r) => { const t = r.query.tab || 'overzicht'; if (t !== tab) setTab(t); return true; } };
}

// ======================================================================= overzicht (widgets)
function overviewTab(body, root) {
  let range = '1h', last = null, editing = false, layout = null, dragId = null, saveT = null, raf = 0, topList = [], liveStats = {}, timer2 = null, alive = true;
  body.innerHTML = `<div class="row" style="margin-bottom:14px;flex-wrap:wrap"><div class="seg" data-range>${[['15m', '15 min'], ['1h', '1 uur'], ['24h', '24 uur']].map(([k, l]) => `<button data-r="${k}" class="${k === range ? 'on' : ''}">${l}</button>`).join('')}</div><span class="grow"></span><button class="btn sm" data-edit>${icon('layout', 'sm')}<span>Aanpassen</span></button></div>
    <div class="srv-grid" data-grid></div><div data-add style="margin-top:16px"></div>`;
  const grid = $('[data-grid]', body);
  const save = () => { clearTimeout(saveT); saveT = setTimeout(() => api('PUT', '/api/layout', layout).catch(fail), 300); };
  function build() {
    grid.innerHTML = layout.filter((l) => !l.hidden).map((l) => {
      const w = BY[l.id];
      return `<section class="card widget w-${l.size} ${w.kind === 'kpi' ? 'stat' : ''} ${editing ? 'editing' : ''}" data-wid="${l.id}" ${editing ? 'draggable="true"' : ''} style="${w.kind === 'kpi' ? 'display:block' : ''}">
        ${editing ? `<div class="w-tools"><span class="grip">${icon('grip', 'sm')}</span><button data-act="left" aria-label="Naar voren">${icon('left', 'xs')}</button><button data-act="right" aria-label="Naar achteren">${icon('right', 'xs')}</button>${w.sizes.map((s) => `<button data-act="size" data-size="${s}" class="${s === l.size ? 'on' : ''}">${{ 1: 'Klein', 2: 'Half', 4: 'Breed' }[s]}</button>`).join('')}<button data-act="hide" aria-label="Verbergen" style="margin-left:auto">${icon('eyeoff', 'xs')}</button></div>` : ''}
        ${w.kind === 'kpi' ? `<div class="lab">${icon(w.icon)}${esc(w.title)}</div>` : ''}
        ${w.kind === 'chart' ? `<div class="chart-head"><h3>${esc(w.title)}</h3>${w.series({}).length > 1 ? `<div class="legend">${w.series({}).map((s) => `<span><i class="lk ${s.cls}"></i>${esc(s.name)}</span>`).join('')}</div>` : ''}</div><div class="chart" data-box></div><div class="chart-stats" data-stats></div>` : ''}
        <div class="w-body"></div></section>`;
    }).join('');
    const hidden = layout.filter((l) => l.hidden);
    $('[data-add]', body).innerHTML = editing ? `<div class="card"><div class="row" style="flex-wrap:wrap"><div class="grow"><h3>Widgets toevoegen</h3><p class="sub">${hidden.length ? 'Tik op een widget om hem toe te voegen. Sleep widgets om ze te verplaatsen.' : 'Alle widgets staan al op de pagina.'}</p></div><button class="btn sm" data-act="reset">${icon('undo', 'sm')}Standaard</button><button class="btn sm pri" data-act="done">${icon('tick', 'sm')}Klaar</button></div>
      ${hidden.length ? `<div class="chips" style="margin-top:12px">${hidden.map((l) => `<button class="chip" data-act="show" data-id="${l.id}">${icon(BY[l.id].icon, 'xs')}${esc(BY[l.id].title)} ${icon('plus', 'xs')}</button>`).join('')}</div>` : ''}</div>` : '';
    if (last) fill(last);
  }
  function fill(d) {
    const h = d.history || { t: [] };
    $('[data-sub]', root).textContent = `${d.info.os} · ${d.info.cpuModel} · ${d.info.cores} kernen`;
    for (const el of $$('[data-wid]', grid)) {
      const w = BY[el.dataset.wid];
      if (w.kind === 'chart') {
        const series = w.series(h).map((s) => ({ ...s, values: s.values || [] }));
        const box = $('[data-box]', el);
        if (w.empty && series.every((s) => !s.values.some((v) => v != null))) { box.innerHTML = `<div class="chart-empty">${esc(w.empty)}</div>`; $('[data-stats]', el).innerHTML = ''; continue; }
        line(box, { t: h.t, series, fmt: (v, tick) => (tick && w.bytes ? fmtBytes(v) : w.fmt(v)), bytes: w.bytes, yMax: w.yMax, minMax: w.minMax, area: true, label: w.title, seconds: range !== '24h', keepHoverT: box._hoverT, height: isMobile() ? 160 : el.classList.contains('w-4') ? 210 : 190 });
        $('[data-stats]', el).innerHTML = series.map((s) => `<div>${series.length > 1 ? `<i class="lk ${s.cls}"></i>` : ''}${statsLine(s.values, w.fmt)}</div>`).join('');
      } else {
        const b = $('.w-body', el); b.innerHTML = w.body(d);
        $$('[data-spark]', b).forEach((sp) => spark(sp, (h[sp.dataset.spark] || []).slice(-60), sp.dataset.cls, sp.dataset.max ? Number(sp.dataset.max) : undefined, 30));
        if (w.id === 'top') drawTop();
      }
    }
  }
  function drawTop() {
    const el = $('[data-top]', grid); if (!el) return;
    const top = topList.filter((c) => c.state === 'running').map((c) => ({ ...c, stats: liveStats[c.name] || c.stats })).sort((a, b) => (b.stats?.cpu || 0) - (a.stats?.cpu || 0)).slice(0, 6);
    el.innerHTML = top.length ? `<ul class="rows">${top.map((c) => `<li><span class="ellipsis"><b style="color:var(--text)">${esc(c.name)}</b></span><b>${c.stats ? `${c.stats.cpu.toFixed(1)}%` : '–'} <small class="faint">${esc(c.stats?.mem?.split(' / ')[0] || '')}</small></b></li>`).join('')}</ul>` : '<p class="muted small" style="margin-top:8px">Geen draaiende containers.</p>';
  }
  const WINDOW = { '15m': 15 * 60e3, '1h': 3600e3, '24h': 24 * 3600e3 };
  const FIELDS = ['cpu', 'temp', 'mem', 'rx', 'tx', 'rd', 'wr'];
  function merge(p, add = true) {
    if (!last || !p.now) return;
    last.now = p.now; last.mem = p.mem; last.temps = p.temps; last.disks = p.disks; Object.assign(last.info, p.info);
    const h = last.history;
    if (add && h && range !== '24h' && (!h.t.length || p.now.t > h.t[h.t.length - 1])) {
      h.t.push(p.now.t); for (const f of FIELDS) { const v = f === 'mem' ? (p.mem.used / p.mem.total) * 100 : p.now[f]; h[f].push(v == null ? null : Math.round(v * 10) / 10); }
      const from = p.now.t - WINDOW[range]; let cut = 0; while (cut < h.t.length && h.t[cut] < from) cut++;
      if (cut) { h.t.splice(0, cut); for (const f of FIELDS) h[f].splice(0, cut); }
    }
  }
  const draw = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { if (alive && last && !document.hidden && !dragId) fill(last); }); };
  async function load() { try { last = await api('GET', `/api/stats?range=${range}`); if (Live.last.stats) merge(Live.last.stats, false); draw(); } catch (e) { fail(e); } }
  async function loadTop() { try { topList = await api('GET', '/api/containers'); drawTop(); } catch { /* */ } }
  const move = (id, dir) => { const vis = layout.filter((l) => !l.hidden); const i = vis.findIndex((l) => l.id === id); const j = i + dir; if (j < 0 || j >= vis.length) return; const a = layout.indexOf(vis[i]), b = layout.indexOf(vis[j]); [layout[a], layout[b]] = [layout[b], layout[a]]; save(); build(); };
  body.addEventListener('click', (e) => {
    const r = e.target.closest('[data-r]'); if (r) { range = r.dataset.r; $$('[data-r]', body).forEach((x) => x.classList.toggle('on', x === r)); clearInterval(timer2); if (range === '24h') timer2 = setInterval(() => { if (!document.hidden) load(); }, 60000); load(); return; }
    if (e.target.closest('[data-edit]')) { editing = !editing; $('[data-edit] span', body).textContent = editing ? 'Klaar' : 'Aanpassen'; build(); return; }
    const b = e.target.closest('[data-act]'); if (!b) return;
    const id = b.closest('[data-wid]')?.dataset.wid || b.dataset.id; const l = layout.find((x) => x.id === id);
    switch (b.dataset.act) {
      case 'left': move(id, -1); break; case 'right': move(id, 1); break;
      case 'size': l.size = Number(b.dataset.size); save(); build(); break;
      case 'hide': l.hidden = true; save(); build(); break;
      case 'show': l.hidden = false; layout.splice(layout.indexOf(l), 1); layout.splice(layout.filter((x) => !x.hidden).length, 0, l); save(); build(); break;
      case 'reset': layout = defaultLayout(); api('DELETE', '/api/layout').catch(() => {}); build(); toast('Standaard-indeling hersteld'); break;
      case 'done': $('[data-edit]', body).click(); break;
      default:
    }
  });
  grid.addEventListener('dragstart', (e) => { const el = e.target.closest('[data-wid]'); if (!el || !editing) return; dragId = el.dataset.wid; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId); });
  grid.addEventListener('dragend', () => { $$('.drop-before', grid).forEach((x) => x.classList.remove('drop-before')); dragId = null; });
  grid.addEventListener('dragover', (e) => { if (!dragId) return; const el = e.target.closest('[data-wid]'); if (!el) return; e.preventDefault(); $$('.drop-before', grid).forEach((x) => x.classList.remove('drop-before')); if (el.dataset.wid !== dragId) el.classList.add('drop-before'); });
  grid.addEventListener('drop', (e) => { if (!dragId) return; const el = e.target.closest('[data-wid]'); if (!el) return; e.preventDefault(); const to = el.dataset.wid; if (to === dragId) return; const [item] = layout.splice(layout.findIndex((x) => x.id === dragId), 1); layout.splice(layout.findIndex((x) => x.id === to), 0, item); dragId = null; save(); build(); });
  const onResize = debounce(() => { if (last) build(); }, 200); addEventListener('resize', onResize);
  (async () => {
    try { layout = normalize((await api('GET', '/api/layout')) || defaultLayout()); } catch { layout = defaultLayout(); }
    build(); await load(); loadTop();
  })();
  const unsubs = [Live.on('stats', (p) => { merge(p); draw(); }), Live.on('containers', (m) => { liveStats = m; drawTop(); })];
  return () => { alive = false; unsubs.forEach((u) => u()); clearInterval(timer2); cancelAnimationFrame(raf); removeEventListener('resize', onResize); };
}

// ======================================================================= schijven: elk deel apart
const PCOL = ['#2563EB', '#0A1630', '#60A5FA', '#1E40AF', '#93C5FD', '#3B82F6'];
function disksTab(body) {
  body.innerHTML = '<div class="row muted" style="padding:20px"><span class="spinner"></span>Schijven lezen…</div>';
  (async () => {
    let disks; try { disks = await api('GET', '/api/server/disks'); } catch (e) { body.innerHTML = `<div class="card">${emptyState('alert', 'Kon de schijven niet lezen', esc(e.message))}</div>`; return; }
    if (!disks.length) { body.innerHTML = `<div class="card">${emptyState('disk', 'Geen schijven gevonden', '')}</div>`; return; }
    const total = disks.reduce((a, d) => a + d.size, 0);
    body.innerHTML = `<p class="muted small" style="margin:-4px 2px 14px">${disks.length} ${disks.length === 1 ? 'schijf' : 'schijven'} · ${fmtBytes(total)} in totaal. Elke kleur is een deel (partitie) van de schijf.</p>` + disks.map((d) => {
      let ci = 0;
      const segs = []; const rows = [];
      for (const p of d.parts) {
        if (p.lvm) {
          for (const v of p.lvm.volumes) { const c = PCOL[ci++ % PCOL.length]; segs.push({ size: v.size, used: v.used, c, label: v.mount || v.name }); rows.push(partRow({ ...v, name: v.name, role: `LVM-volume in ${p.name}` }, c, true)); }
          if (p.lvm.free > 1e9) { segs.push({ size: p.lvm.free, c: 'var(--line2)', label: 'vrij in LVM' }); rows.push(`<div class="part sub"><span class="sw" style="--c:var(--line2)"></span><b>Vrije ruimte in LVM</b><span class="v">${fmtBytes(p.lvm.free)}</span><small>Nog niet aan een volume gegeven. Uitbreiden: <code>sudo lvextend -r -l +100%FREE ${esc(p.lvm.volumes[0] ? `/dev/${p.lvm.volumes[0].name}` : '')}</code></small></div>`); }
          rows.splice(rows.length - p.lvm.volumes.length - (p.lvm.free > 1e9 ? 1 : 0), 0, `<div class="part"><span class="sw" style="--c:transparent;border:2px solid var(--p2)"></span><b>${esc(p.name)} · ${esc(p.role || 'LVM')}</b><span class="v">${fmtBytes(p.size)}</span><small>Bevat ${p.lvm.volumes.length} ${p.lvm.volumes.length === 1 ? 'volume' : 'volumes'}</small></div>`);
        } else { const c = p.unused ? 'var(--faint)' : PCOL[ci++ % PCOL.length]; segs.push({ size: p.size, used: p.used, c, label: p.mount || p.label || p.name }); rows.push(partRow(p, c)); }
      }
      if (d.unallocated > 1e9) { segs.push({ size: d.unallocated, c: 'transparent', label: 'niet ingedeeld', dashed: true }); rows.push(`<div class="part"><span class="sw" style="--c:transparent;border:1.5px dashed var(--faint)"></span><b>Niet ingedeelde ruimte</b><span class="v">${fmtBytes(d.unallocated)}</span><small>Hoort bij geen enkel deel – kan je nog gebruiken voor een nieuw deel.</small></div>`); }
      return `<div class="card" style="margin-bottom:16px"><div class="row"><div class="ib ${d.rotational ? 's' : ''}">${icon('disk')}</div><div class="grow"><h3 style="font-size:16px">${esc(d.name)}${d.model ? ` · <span class="muted" style="font-weight:550">${esc(d.model)}</span>` : ''}</h3><p class="sub">${fmtBytes(d.size)} · ${d.rotational ? 'harde schijf (HDD)' : 'SSD'}${d.removable ? ' · verwijderbaar' : ''} · ${d.parts.length} ${d.parts.length === 1 ? 'deel' : 'delen'}</p></div></div>
        <div class="disk-map">${segs.map((s) => `<div style="flex:${Math.max(s.size / d.size, 0.012)};background:${s.c};${s.dashed ? 'border:1.5px dashed var(--faint);color:var(--muted)' : ''}" title="${esc(s.label)} · ${fmtBytes(s.size)}">${s.used != null && s.size ? `<div class="used" style="width:${Math.min(100, (s.used / s.size) * 100)}%"></div>` : ''}<span>${s.size / d.size > 0.12 ? esc(s.label) : ''}</span></div>`).join('')}</div>
        ${rows.join('')}</div>`;
    }).join('');
  })();
}
function partRow(p, c, sub = false) {
  const has = p.used != null && p.free != null; const tot = has ? p.used + p.free : 0; const pc = tot ? (p.used / tot) * 100 : 0;
  const what = p.mount === '/' ? 'Systeem en alles daarop (sites, Docker, OpenCloud…)' : p.role || (p.unused ? 'Niet in gebruik (niet gekoppeld)' : p.fs === 'swap' ? 'Swap' : '');
  return `<div class="part ${sub ? 'sub' : ''}"><span class="sw" style="--c:${c}"></span><b>${esc(p.mount || p.label || p.name)}${p.mount && p.label ? ` <span class="faint" style="font-weight:500">(${esc(p.label)})</span>` : ''}</b><span class="v">${has ? `${fmtBytes(p.free)} vrij` : fmtBytes(p.size)}</span>
    <small>${esc(p.name)}${p.fs ? ` · ${esc(p.fs)}` : ''} · ${fmtBytes(p.size)}${what ? ` · ${esc(what)}` : ''}${has ? ` · ${fmtBytes(p.used)} gebruikt (${Math.round(pc)}%)` : ''}</small>${has ? meter(pc, useCls(pc) || (sub ? 's' : '')) : ''}</div>`;
}

// ======================================================================= processen
function procTab(body) {
  let sort = 'cpu', q = '', list = [];
  body.innerHTML = `<div class="card" style="padding:12px 14px"><div class="row" style="margin-bottom:8px;flex-wrap:wrap"><label class="sbox grow" style="max-width:340px">${icon('search', 'sm')}<input data-q placeholder="Zoek een proces"></label><span class="faint small" data-n></span><span class="grow"></span><span class="dot pulse"></span><span class="small muted">elke 3 s</span></div>
    <div style="overflow-x:auto"><table class="proc-table"><thead><tr><th data-s="name">Proces</th><th class="hide-m">Gebruiker</th><th class="r" data-s="cpu">CPU</th><th class="r" data-s="mem">Geheugen</th><th class="hide-m r">PID</th></tr></thead><tbody data-rows></tbody></table></div></div>`;
  const draw = () => {
    const l = list.filter((p) => !q || `${p.name} ${p.cmd}`.toLowerCase().includes(q)).sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name) : b[sort] - a[sort]));
    $('[data-n]', body).textContent = `${l.length} processen`;
    $$('[data-s]', body).forEach((th) => { th.style.color = th.dataset.s === sort ? 'var(--p2)' : ''; });
    $('[data-rows]', body).innerHTML = l.map((p) => `<tr><td><b>${esc(p.name)}</b><div class="ellipsis faint" style="font-size:11.5px;max-width:52vw">${esc(p.cmd)}</div></td><td class="hide-m muted">${esc(p.user)}</td><td class="r"><b style="color:${p.cpu > 50 ? 'var(--warn)' : 'inherit'}">${p.cpu.toFixed(1)}%</b></td><td class="r">${fmtBytes(p.mem)}</td><td class="hide-m r faint">${p.pid}</td></tr>`).join('');
  };
  const load = async () => { if (document.hidden) return; try { list = await api('GET', '/api/server/processes'); draw(); } catch (e) { $('[data-rows]', body).innerHTML = `<tr><td colspan="5" class="error">${esc(e.message)}</td></tr>`; } };
  $('[data-q]', body).addEventListener('input', debounce((e) => { q = e.target.value.toLowerCase(); draw(); }, 120));
  body.addEventListener('click', (e) => { const th = e.target.closest('[data-s]'); if (th) { sort = th.dataset.s; draw(); } });
  load(); const t = setInterval(load, 3000);
  return () => clearInterval(t);
}

// ======================================================================= onderhoud
function maintTab(body) {
  body.innerHTML = `<div class="grid two">
    <div class="card"><h3>${icon('refresh')}Opruimen</h3><p class="sub">Oude Docker-images en bouwcache wissen. Je sites en bestanden blijven staan.</p><div data-clean style="margin-top:12px"><span class="spinner"></span></div></div>
    <div class="card"><h3>${icon('speed')}Snelheidstest</h3><p class="sub">Hoe snel is het internet van je server?</p><div data-speed style="margin-top:4px"></div></div>
    <div class="card"><h3>${icon('cloud')}OpenCloud</h3><p class="sub">Je eigen cloud voor foto's en bestanden</p><div data-oc style="margin-top:10px"><span class="spinner"></span></div></div>
    <div class="card"><h3>${icon('power')}Server herstarten</h3><p class="sub">Alles gaat 1 à 2 minuten offline en start daarna vanzelf terug op (sites, OpenCloud, het paneel).</p>
      <div class="note s" style="margin-top:12px">${icon('info')}<span>Na een stroomuitval start je server vanzelf terug op, zonder dat je moet inloggen – als in het BIOS "Restore on AC power loss" op <b>Power On</b> staat.</span></div>
      <button class="btn danger" data-reboot>${icon('power', 'sm')}Herstarten…</button></div>
  </div>`;
  const cleanEl = $('[data-clean]', body), spEl = $('[data-speed]', body), ocEl = $('[data-oc]', body);
  async function clean() {
    try { const c = await api('GET', '/api/server/cleanup');
      cleanEl.innerHTML = `<div class="big num" style="font-size:26px;font-weight:700">${fmtBytes(c.reclaimable)} <small class="muted" style="font-size:13px;font-weight:550">kan weg</small></div>${(c.parts || []).map((p) => `<div class="li"><div class="grow"><b>${esc(p.type)}</b><small>${p.count != null ? `${p.count} stuks` : ''}</small></div><div class="end">${fmtBytes(p.size)}</div></div>`).join('')}<button class="btn pri" data-doclean style="margin-top:12px" ${c.reclaimable > 1e6 ? '' : 'disabled'}>${icon('trash', 'sm')}Opruimen</button>`;
    } catch (e) { cleanEl.innerHTML = `<p class="error">${esc(e.message)}</p>`; }
  }
  async function speed(entry) {
    let d; try { d = await api('GET', '/api/server/speedtest'); } catch (e) { spEl.innerHTML = `<p class="error">${esc(e.message)}</p>`; return; }
    const lastR = entry || (d.history || [])[d.history.length - 1];
    const mb = (b) => (b / 1e6).toFixed(b < 1e8 ? 1 : 0).replace('.', ',');
    spEl.innerHTML = `<div class="speed"><div><small>Download</small><b>${lastR ? mb(lastR.down) : '–'}</b> <span>Mbit/s</span></div><div><small>Upload</small><b>${lastR ? mb(lastR.up) : '–'}</b> <span>Mbit/s</span></div><div><small>Ping</small><b>${lastR && lastR.ping != null ? Math.round(lastR.ping) : '–'}</b> <span>ms</span></div></div>
      <div class="row" style="margin-top:12px"><span class="faint small grow">${lastR ? `Laatste test ${esc(ago(lastR.at))}` : 'Nog niet getest'}</span><button class="btn pri" data-dospeed ${d.busy ? 'disabled' : ''}>${d.busy ? '<span class="spinner"></span>Bezig…' : `${icon('play', 'sm')}Test starten`}</button></div>
      ${(d.history || []).length > 2 ? `<div class="bars" style="height:70px">${d.history.slice(-12).map((h) => `<div class="bc" title="${mb(h.down)} Mbit/s · ${esc(ago(h.at))}"><i style="height:${(h.down / Math.max(...d.history.slice(-12).map((x) => x.down))) * 100}%"></i></div>`).join('')}</div>` : ''}`;
  }
  async function oc() {
    try { const o = await api('GET', '/api/server/opencloud');
      if (!o.found) { ocEl.innerHTML = '<p class="muted small">Geen OpenCloud-container gevonden op je server.</p>'; return; }
      ocEl.innerHTML = `<div class="row"><span class="pill ${o.running ? 'up' : 'down'}">${o.running ? 'draait' : 'staat uit'}</span><span class="faint small">${esc(o.status || '')}</span></div><ul class="rows">
        ${o.size != null ? `<li><span>Gebruikt</span><b>${fmtBytes(o.size)}</b></li>` : ''}${o.files != null ? `<li><span>Bestanden</span><b>${o.files.toLocaleString('nl-BE')}</b></li>` : ''}
        ${o.dataDir ? `<li><span>Opslag op de server</span><b class="mono" style="font-size:12px">${esc(o.dataDir)}</b></li>` : ''}<li><span>Image</span><b class="mono" style="font-size:12px">${esc(o.image || '')}</b></li></ul>
        ${o.domain ? `<a class="btn" style="margin-top:10px" href="https://${esc(o.domain)}" target="_blank" rel="noopener">${icon('ext', 'sm')}${esc(o.domain)} openen</a>` : ''}`;
    } catch (e) { ocEl.innerHTML = `<p class="error">${esc(e.message)}</p>`; }
  }
  body.addEventListener('click', async (e) => {
    const c = e.target.closest('[data-doclean]');
    if (c) { if (!(await confirmSheet('Oude Docker-images en bouwcache wissen? Draaiende sites en je bestanden blijven staan.', { ok: 'Opruimen' }))) return; c.disabled = true; c.innerHTML = '<span class="spinner"></span>Opruimen…'; try { const r = await api('POST', '/api/server/cleanup'); toast(`${fmtBytes(r.freed || 0)} vrijgemaakt`, { icon: 'tick' }); } catch (x) { fail(x); } clean(); return; }
    const s = e.target.closest('[data-dospeed]');
    if (s) { s.disabled = true; s.innerHTML = '<span class="spinner"></span>Meten… (± 30 s)'; try { const r = await api('POST', '/api/server/speedtest'); speed(r); } catch (x) { fail(x); speed(); } return; }
    if (e.target.closest('[data-reboot]')) {
      if (!(await confirmSheet('Je server herstart nu. Alles is 1 à 2 minuten offline (ook dit paneel). Je krijgt een melding als hij terug is.', { title: 'Server herstarten?', ok: 'Herstarten', danger: true }))) return;
      try { await api('POST', '/api/server/reboot'); rebootWait(); } catch (x) { fail(x); }
    }
  });
  clean(); speed(); oc();
  const un = Live.on('speedtest', (en) => speed(en));
  return () => un();
}
function rebootWait() {
  const ov = document.createElement('div');
  ov.className = 'login'; ov.style.cssText = 'position:fixed;inset:0;z-index:2000';
  ov.innerHTML = `<div class="login-box"><div class="fid" style="border-color:var(--a);color:var(--a)">${icon('power')}</div><h1>Server herstart…</h1><p data-w>Even geduld. Deze pagina komt vanzelf terug.</p><div class="prog ind" style="max-width:260px;margin:0 auto"><i></i></div></div>`;
  document.body.appendChild(ov);
  const t0 = Date.now(); let wentDown = false;
  const iv = setInterval(async () => {
    const s = Math.round((Date.now() - t0) / 1000); $('[data-w]', ov).textContent = `${s} seconden… ${wentDown ? 'aan het opstarten' : 'afsluiten'}`;
    try { const r = await fetch('/api/version', { cache: 'no-store' }); if (r.ok && wentDown) { clearInterval(iv); location.reload(); } } catch { wentDown = true; }
    if (s > 15 && !wentDown) wentDown = true;
    if (s > 420) { clearInterval(iv); $('[data-w]', ov).textContent = 'Het duurt langer dan normaal. Kijk of je server aan staat.'; }
  }, 3000);
}

// ======================================================================= terminal
function termTab(body) { return termPanel(body).cleanup; }
export { T };
