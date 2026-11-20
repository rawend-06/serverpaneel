/* Containers: alles wat in Docker draait, met live processor en geheugen. */
import { $, $$, esc, icon, api, fail, debounce, emptyState } from '../core.js';
import * as Live from '../live.js';
import { loadOverview } from './sites.js';

const base = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop() || '';

export default async function containers(root, ctx) {
  let list = [], ov = null, q = '';
  root.innerHTML = `
    <div class="top"><a class="iconbtn back" href="#/meer" aria-label="Terug">${icon('left')}</a><div class="grow"><h1>Containers</h1><p data-sub>&nbsp;</p></div>
      <div class="actions"><button class="btn keep" data-r>${icon('refresh', 'sm')}<span class="desk-only">Vernieuwen</span></button></div></div>
    <label class="sbox" style="margin-bottom:14px;max-width:360px">${icon('search', 'sm')}<input data-q placeholder="Zoek een container"></label>
    <div class="card pad0"><table class="tbl" data-t></table></div>`;
  ctx.setFab(null, { hide: true });
  const siteOf = (c) => ov && ov.sites.find((s) => (s.type === 'container' && s.container === c.name) || (s.type === 'docker' && (c.name === s.name || c.name.startsWith(`${base(s.path)}-`) || c.name === base(s.path))) || (s.self && c.name === 'serverpaneel'));
  async function load() {
    try { [list, ov] = await Promise.all([api('GET', '/api/containers'), ov ? ov : loadOverview().catch(() => null)]); } catch (e) { fail(e); return; }
    draw();
  }
  function draw() {
    const up = list.filter((c) => c.state === 'running').length;
    $('[data-sub]', root).textContent = `${up} draaien · ${list.length - up} gestopt`;
    const l = list.filter((c) => !q || `${c.name} ${c.image}`.toLowerCase().includes(q)).sort((a, b) => (b.state === 'running') - (a.state === 'running') || a.name.localeCompare(b.name));
    $('[data-t]', root).innerHTML = l.length ? `<thead><tr><th>Container</th><th>Status</th><th style="text-align:right">Processor</th><th style="text-align:right">Geheugen</th><th>Poorten</th></tr></thead><tbody>${l.map((c) => {
      const st = siteOf(c); const cpu = c.stats ? c.stats.cpu : null; const run = c.state === 'running';
      return `<tr data-c="${esc(c.name)}"><td><div class="row"><div class="ib sm ${run ? '' : 'n'}">${icon('box', 'sm')}</div><div class="ellipsis"><b>${esc(c.name)}</b><div class="faint small ellipsis" style="max-width:280px">${st ? `<a href="#/sites/${encodeURIComponent(st.name)}">site: ${esc(st.name)}</a> · ` : ''}${esc(c.image)}</div></div></div></td>
        <td data-l="Status"><span class="pill ${run ? 'up' : 'down'}">${run ? 'draait' : 'gestopt'}</span><div class="faint small">${esc(c.status)}</div></td>
        <td data-l="Processor">${run ? `<div class="cell-meter"><div class="meter"><span data-bar style="width:${Math.max(2, Math.min(100, cpu || 0))}%"></span></div><b data-cpu class="num">${cpu == null ? '…' : `${cpu.toFixed(1)}%`}</b></div>` : '–'}</td>
        <td data-l="Geheugen" style="text-align:right"><b data-mem class="num">${c.stats ? esc(c.stats.mem.split(' / ')[0]) : run ? '…' : '–'}</b></td>
        <td data-l="Poorten" class="small muted">${esc(c.ports || '–')}</td></tr>`;
    }).join('')}</tbody>` : `<tbody><tr><td>${emptyState('box', q ? 'Niets gevonden' : 'Geen containers', '')}</td></tr></tbody>`;
  }
  function live(map) {
    for (const [name, st] of Object.entries(map || {})) {
      const row = $(`tr[data-c="${CSS.escape(name)}"]`, root); if (!row) continue;
      const c = list.find((x) => x.name === name); if (c) c.stats = st;
      const cpu = $('[data-cpu]', row), bar = $('[data-bar]', row), mem = $('[data-mem]', row);
      if (cpu) cpu.textContent = `${st.cpu.toFixed(1)}%`; if (bar) bar.style.width = `${Math.max(2, Math.min(100, st.cpu))}%`; if (mem && st.mem) mem.textContent = st.mem.split(' / ')[0];
    }
  }
  $('[data-r]', root).onclick = load;
  $('[data-q]', root).addEventListener('input', debounce((e) => { q = e.target.value.toLowerCase(); draw(); live(Live.last.containers); }, 120));
  await load();
  const unsubs = [Live.on('containers', live), Live.on('sites', debounce(load, 1000))];
  return () => unsubs.forEach((u) => u());
}
