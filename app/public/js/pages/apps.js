/* Apps-winkel: kant-en-klare apps met één klik installeren (container, domein met https en backups inbegrepen). */
import { $, $$, esc, icon, api, fail, fmtBytes, sheet, debounce } from '../core.js';
import { domainField, bindDomain, watchJob } from './sites.js';

export default async function appsPage(root, ctx) {
  let data = null, cat = 'Alle', q = '';
  root.innerHTML = `
    <div class="top"><a class="iconbtn back" href="#/meer" aria-label="Terug">${icon('left')}</a><div class="grow"><h1>Apps-winkel</h1><p>Eén klik: het paneel maakt de container, het domein met https en de backup</p></div>
      <div class="actions"><label class="sbox sm" style="width:240px">${icon('search', 'sm')}<input data-q placeholder="Zoek een app" aria-label="Zoek een app"></label></div></div>
    <div class="row wrap" data-cats style="gap:6px;margin-bottom:12px"></div>
    <div class="grid apps-grid" data-list><div class="row muted" style="padding:20px"><span class="spinner"></span>Laden…</div></div>
    <p class="faint small" data-foot style="margin-top:14px"></p>`;
  ctx.setFab(null, { hide: true });

  async function load() { try { data = await api('GET', '/api/apps'); } catch (e) { fail(e); return; } draw(); }
  function draw() {
    const cats = ['Alle', ...new Set(data.apps.map((a) => a.cat))];
    $('[data-cats]', root).innerHTML = cats.map((c) => `<button class="chip ${c === cat ? 'on' : ''}" data-cat="${esc(c)}" aria-pressed="${c === cat}">${esc(c)}</button>`).join('');
    const list = data.apps.filter((a) => (cat === 'Alle' || a.cat === cat) && (!q || `${a.name} ${a.desc}`.toLowerCase().includes(q)));
    $('[data-list]', root).innerHTML = list.map((a) => `
      <article class="card app-card ${a.installed ? 'inst' : ''}">
        <div class="row"><div class="app-logo">${esc(a.name[0])}</div><div class="grow" style="min-width:0"><h3 style="margin:0">${esc(a.name)}</h3><div class="small muted">${esc(a.cat)} · ± ${a.ram >= 1000 ? `${(a.ram / 1000).toFixed(0)} GB` : `${a.ram} MB`} geheugen</div></div></div>
        <p class="small" style="margin:8px 0;flex:1">${esc(a.desc)}</p>
        ${a.note ? `<p class="tiny faint" style="margin:-2px 0 8px">${esc(a.note)}</p>` : ''}
        <div class="row" style="gap:6px">${a.installed
          ? `<span class="tag">Geïnstalleerd</span><div class="grow"></div>${a.installed.startsWith('(') ? '' : `<a class="btn sm" href="#/sites/${encodeURIComponent(a.installed)}">Beheren</a>`}${a.domain ? `<a class="btn sm pri" href="https://${esc(a.domain)}" target="_blank" rel="noopener">Openen</a>` : ''}`
          : `<div class="grow"></div><button class="btn sm pri" data-inst="${a.id}">${icon('download', 'sm')}Installeren</button>`}</div>
      </article>`).join('') || '<p class="muted">Niets gevonden.</p>';
    $('[data-foot]', root).textContent = `Vrij op je server: ${data.freeRam != null ? fmtBytes(data.freeRam) : '?'} geheugen · ${data.freeDisk != null ? fmtBytes(data.freeDisk) : '?'} opslag. Apps komen in ${data.appsDir}.`;
  }
  function install(a) {
    const low = data.freeRam != null && data.freeRam < a.ram * 1.3e6;
    const s = sheet({
      title: `${a.name} installeren`, sub: esc(a.image),
      body: `<form data-f>
        <label class="field"><span>Naam</span><input name="name" value="${esc(a.id)}" autocapitalize="off" spellcheck="false"><span class="hint">Enkel kleine letters, cijfers en -. Map: ${esc(data.appsDir)}/<span data-nm>${esc(a.id)}</span></span></label>
        <label class="field"><span>Poort op je server</span><input name="port" inputmode="numeric" value="${a.port}" ${a.fixedPort ? 'disabled' : ''}>${a.portFree ? '' : '<span class="hint" style="color:var(--bad)">Deze poort is al in gebruik</span>'}</label>
        ${domainField('')}
        ${a.needsDomain ? '<p class="small" style="margin:-4px 0 10px"><b>Deze app werkt enkel via https:</b> kies een domein.</p>' : ''}
        <div class="card flat" style="background:var(--card2);padding:10px 12px;margin-top:4px"><div class="small">Vrij: <b>${data.freeRam != null ? fmtBytes(data.freeRam) : '?'}</b> geheugen · <b>${data.freeDisk != null ? fmtBytes(data.freeDisk) : '?'}</b> opslag${low ? ' · <b style="color:var(--bad)">mogelijk te weinig geheugen</b>' : ''}</div><div class="tiny faint" style="margin-top:3px">Start automatisch na een stroompanne · wachtwoorden worden willekeurig gemaakt en bewaard in <code>.env</code> in de app-map.</div></div>
      </form>`,
      foot: '<button class="btn" data-close>Annuleren</button><button class="btn pri" data-ok>Installeren</button>',
    });
    const f = s.$('[data-f]'); const getDomain = bindDomain(f);
    f.name.addEventListener('input', () => { f.name.value = f.name.value.toLowerCase().replace(/[^a-z0-9-]/g, ''); s.$('[data-nm]').textContent = f.name.value; });
    s.$('[data-ok]').onclick = async () => {
      try {
        const r = await api('POST', '/api/apps/install', { id: a.id, name: f.name.value, port: f.port.value, domain: getDomain() });
        s.close();
        watchJob(r.job, { title: `${a.name} installeren`, kind: 'import', after: load });
      } catch (e) { fail(e); }
    };
  }
  root.addEventListener('click', (e) => {
    const c = e.target.closest('[data-cat]'); if (c) { cat = c.dataset.cat; draw(); return; }
    const i = e.target.closest('[data-inst]'); if (i) install(data.apps.find((a) => a.id === i.dataset.inst));
  });
  $('[data-q]', root).addEventListener('input', debounce((e) => { q = e.target.value.toLowerCase(); draw(); }, 100));
  await load();
}
