/* Meer (gsm): snel typen, alle onderdelen als tegels, en snelle acties. */
import { $, esc, icon, api, fmtBytes, euro, hm, addDays, sod, debounce } from '../core.js';
import * as Live from '../live.js';

const TILES = [
  ['notities', 'note', 'Notities', '', 's'], ['sites', 'globe', 'Websites', 'data-sites', ''], ['delen', 'clip', 'Delen', 'klembord', 's'],
  ['aftellen', 'flag', 'Aftellen', 'data-cd', ''], ['morgen', 'bag', 'Morgen', 'klaarleggen', 's'],
  ['server', 'server', 'Server', 'data-srv', 's'], ['containers', 'box', 'Containers', 'data-cnt', ''], ['terminal', 'terminal', 'Terminal', 'ook onderweg', 's'], ['bestanden', 'folder', 'Bestanden', 'op je server', ''], ['apps', 'bag', 'Apps-winkel', '1 klik', 's'], ['databases', 'disk', 'Databases', '', ''], ['netwerk', 'wifi', 'Netwerk', 'MB/s + wie is er', ''], ['firewall', 'shield', 'Firewall', 'poorten', 's'], ['apparaten', 'wifi', 'Apparaten', 'Wake-on-LAN', ''], ['energie', 'bolt', 'Energie', 'verbruik', 's'], ['instellingen', 'sliders', 'Instellingen', '', 's'],
];

export default async function more(root, ctx) {
  root.innerHTML = `
    <div class="top"><div class="grow"><h1>Meer</h1></div><a class="iconbtn keep" href="#/instellingen" aria-label="Instellingen">${icon('sliders')}</a></div>
    <div class="qa" data-qa style="cursor:text;margin-bottom:6px"><div class="in">${icon('bolt')}<span class="faint" style="font-size:15px">Snel toevoegen…</span></div></div>
    <div class="qa-hint" style="margin-bottom:18px">Afspraak, taak, notitie of aftellen – gewoon typen zoals je praat.</div>
    <div class="tiles">${TILES.map(([r, ic, l, sub, cls]) => `<a class="tile2" href="#/${r}"><div class="ib ${cls}">${icon(ic)}</div>${l}<small ${sub.startsWith('data-') ? sub : ''}>${sub.startsWith('data-') ? '&nbsp;' : esc(sub)}</small></a>`).join('')}</div>
    <div class="sec-title">Snelle acties</div>
    <div class="grp">
      <a class="rw click" href="#/agenda?nieuw=1" style="color:inherit;text-decoration:none">${icon('cal')}<span class="grow">Nieuwe afspraak</span>${icon('right', 'sm')}</a>
      <a class="rw click" href="#/taken?nieuw=1" style="color:inherit;text-decoration:none">${icon('tasks')}<span class="grow">Nieuwe taak</span>${icon('right', 'sm')}</a>
      <a class="rw click" href="#/notities?nieuw=1" style="color:inherit;text-decoration:none">${icon('note')}<span class="grow">Nieuwe notitie</span>${icon('right', 'sm')}</a>
      <a class="rw click" href="#/delen?tab=bestanden" style="color:inherit;text-decoration:none">${icon('upload')}<span class="grow">Bestand delen</span>${icon('right', 'sm')}</a>
      <a class="rw click" href="#/sites?nieuw=1" style="color:inherit;text-decoration:none">${icon('globe')}<span class="grow">Website online zetten</span>${icon('right', 'sm')}</a>
    </div>
    <p class="faint small" style="text-align:center;margin-top:20px">Rawendpaneel · versie ${esc(ctx.app.version)}</p>`;
  ctx.setFab(null, { hide: true });
  $('[data-qa]', root).onclick = () => ctx.quickAdd();
  const set = (sel, v) => { const el = $(`[${sel}]`, root); if (el) el.textContent = v; };
  const stats = (d) => { if (!d || !d.now) return; set('data-srv', `${Math.round(d.now.cpu || 0)}% · ${d.now.temp != null ? `${Math.round(d.now.temp)}°` : fmtBytes(d.mem.used)}`); };
  (async () => {
    try { const o = await api('GET', '/api/overview'); set('data-sites', `${o.sites.filter((x) => x.status && x.status.state === 'up').length} van ${o.sites.length} online`); } catch { /* */ }
    try { const c = await api('GET', '/api/countdowns'); const n = c.map((x) => Math.round((new Date(`${x.date}T00:00`).getTime() - sod()) / 864e5)).filter((d) => d >= 0).sort((a, b) => a - b)[0]; set('data-cd', n != null ? `nog ${n} ${n === 1 ? 'dag' : 'dagen'}` : ''); } catch { /* */ }
    try { const c = await api('GET', '/api/containers'); set('data-cnt', `${c.filter((x) => x.state === 'running').length} draaien`); } catch { /* */ }
  })();
  const un = Live.on('stats', debounce(stats, 500));
  return () => un();
}
export { hm, addDays };
