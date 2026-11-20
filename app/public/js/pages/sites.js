/* Websites: overzicht, nieuwe site (gewoon je projectmap slepen), bijwerken, bestaand project toevoegen. */
import { $, $$, esc, icon, api, toast, fail, sheet, menu, confirmSheet, ago, fmtBytes, slug, sleep, debounce, IS_TOUCH, bus, emptyState } from '../core.js';
import * as Live from '../live.js';

// mappen die nooit mee moeten (te groot of nutteloos; de server installeert zelf opnieuw)
export const SKIP = /(^|\/)(node_modules|\.git|\.angular|\.next|\.nuxt|\.svelte-kit|\.cache|\.parcel-cache|coverage|\.turbo|\.vscode|\.idea|__pycache__|\.DS_Store|Thumbs\.db|\.vercel|\.netlify)(\/|$)/;
const COMPOSE = /^(docker-compose|compose)\.ya?ml$/i;
export let OV = null; // laatste overzicht
export const siteUrl = (s) => (s.domain ? `https://${s.domain}` : '');
export const homeUrl = (s) => (s.type === 'static' ? `/view/${encodeURIComponent(s.name)}/` : OV && OV.server.lanIp && s.port ? `http://${OV.server.lanIp}:${s.port}` : '');
export const statusOf = (s) => (s.busy ? { state: 'busy', text: 'bezig…' } : s.status || { state: 'warn', text: '?' });
const hue = (n) => [...n].reduce((a, c) => a + c.charCodeAt(0), 0) % 3 + 1;

export async function loadOverview() { OV = await api('GET', '/api/overview'); return OV; }

export default async function sites(root, ctx) {
  if (ctx.params[0]) { const m = await import('./site.js'); return m.default(root, ctx); }
  root.innerHTML = `
    <div class="top"><div class="grow"><h1>Websites</h1><p data-sub>&nbsp;</p></div>
      <div class="actions"><button class="btn" data-import>${icon('search', 'sm')}Bestaand project</button><button class="btn pri" data-new>${icon('plus', 'sm')}Nieuwe site</button></div></div>
    <div class="chips" data-info style="margin-bottom:16px"></div>
    <div class="grid sites-grid" data-grid></div>
    <div data-empty></div>`;
  ctx.setFab(() => newSite(), { iconName: 'upload' });
  const grid = $('[data-grid]', root);

  async function load() {
    try { await loadOverview(); } catch (e) { fail(e); return; }
    draw();
  }
  function draw() {
    const o = OV; const s = o.server;
    const up = o.sites.filter((x) => statusOf(x).state === 'up').length;
    $('[data-sub]', root).textContent = o.sites.length ? `${up} van ${o.sites.length} online` : 'Nog geen sites';
    const lan = s.lanIp ? `http://${s.lanIp}:${s.port}` : '';
    $('[data-info]', root).innerHTML = [
      s.dockerAtBoot === false ? `<span class="chip" style="color:var(--warn)">${icon('alert', 'xs')}Docker start niet mee op · <code>sudo systemctl enable docker</code></span>` : '',
      s.demo ? `<span class="chip">${icon('info', 'xs')}Demo: er verandert niets op je echte server</span>` : '',
      lan ? `<a class="chip" href="${esc(lan)}">${icon('wifi', 'xs')}Thuis: ${esc(s.lanIp)}:${esc(s.port)}</a>` : '',
      s.panelDomain ? `<a class="chip" href="https://${esc(s.panelDomain)}">${icon('lock', 'xs')}${esc(s.panelDomain)}</a>` : '',
      s.caddy && !s.caddy.running ? `<span class="chip" style="color:var(--bad)">${icon('alert', 'xs')}Caddy staat uit: https werkt niet</span>` : '',
      s.disk ? `<span class="chip">${icon('disk', 'xs')}${fmtBytes(s.disk.free)} vrij</span>` : '',
    ].join('');
    $('[data-empty]', root).innerHTML = o.sites.length ? '' : `<div class="card">${emptyState('globe', 'Nog geen websites', 'Sleep de map van je project hierheen (of een .zip). Het paneel ziet zelf wat het is en bouwt het als dat nodig is.', `<div class="row" style="justify-content:center;margin-top:14px"><button class="btn pri" data-new>${icon('upload', 'sm')}Website online zetten</button><button class="btn" data-import>Bestaand project</button></div>`)}</div>`;
    // kaarten bijwerken zonder voorbeelden te herladen
    const existing = new Map($$('.site-card', grid).map((el) => [el.dataset.name, el]));
    o.sites.forEach((x, i) => {
      let card = existing.get(x.name); existing.delete(x.name);
      if (!card) { card = document.createElement('article'); card.className = 'card site-card'; card.dataset.name = x.name; card.innerHTML = `<div class="prev" data-go><span class="pill"></span></div><div class="sb"></div>`; }
      const pk = `${x.type}:${x.updatedAt}:${x.maintenance ? 1 : 0}`;
      if (card.dataset.pk !== pk) {
        $$('.prev > :not(.pill)', card).forEach((n) => n.remove());
        const prev = $('.prev', card);
        if (x.type === 'static' && !x.maintenance) { const f = document.createElement('iframe'); f.src = `/view/${encodeURIComponent(x.name)}/`; f.loading = 'lazy'; f.tabIndex = -1; f.setAttribute('sandbox', 'allow-same-origin'); f.setAttribute('aria-hidden', 'true'); prev.prepend(f); }
        else prev.insertAdjacentHTML('afterbegin', `<div class="tile t${hue(x.name)}">${x.maintenance ? icon('wrench', 'lg') : esc(x.name[0].toUpperCase())}</div>`);
        card.dataset.pk = pk;
      }
      const st = statusOf(x); const pill = $('.pill', card);
      pill.className = `pill ${st.state}`; pill.textContent = st.text;
      const url = siteUrl(x), home = homeUrl(x);
      const bk = JSON.stringify([x.domain, x.type, x.port, ago(x.updatedAt), x.framework, x.autostart && x.autostart.ok, x.self, OV.server.lanIp]);
      if (card.dataset.bk !== bk) {
        $('.sb', card).innerHTML = `<b><a href="#/sites/${encodeURIComponent(x.name)}" style="color:inherit">${esc(x.name)}</a>${x.self ? '<span class="tag n">dit paneel</span>' : ''}${x.framework ? `<span class="tag s">${esc(x.framework)}</span>` : ''}</b>
          ${url ? `<a class="dom" href="${esc(url)}" target="_blank" rel="noopener">${icon('globe', 'xs')}${esc(x.domain)}</a>` : `<span class="dom">${icon('wifi', 'xs')}${x.type === 'static' ? 'enkel thuis' : x.port ? `thuis op poort ${esc(x.port)}` : 'geen domein'}</span>`}
          <span class="dom faint">${icon('clock', 'xs')}Bijgewerkt ${esc(ago(x.updatedAt))}${x.autostart && x.autostart.ok === false ? ` · <span style="color:var(--warn)">start niet vanzelf</span>` : ''}</span>
          <div class="r">${x.type === 'container' ? `<a class="btn sm pri grow" href="#/sites/${encodeURIComponent(x.name)}">${icon('sliders', 'sm')}Beheren</a>` : `<button class="btn sm pri grow" data-update>${icon('upload', 'sm')}Bijwerken</button>`}
            ${url || home ? `<a class="btn sm icon" href="${esc(url || home)}" target="_blank" rel="noopener" aria-label="Openen">${icon('ext', 'sm')}</a>` : ''}
            <button class="btn sm icon" data-menu aria-label="Meer">${icon('more', 'sm')}</button></div>`;
        card.dataset.bk = bk;
      }
      if (grid.children[i] !== card) grid.insertBefore(card, grid.children[i] || null);
    });
    for (const el of existing.values()) el.remove();
  }
  const siteOf = (el) => OV.sites.find((s) => s.name === el.closest('[data-name]').dataset.name);
  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-new]')) { newSite(); return; }
    if (e.target.closest('[data-import]')) { importSite(); return; }
    const card = e.target.closest('.site-card'); if (!card) return;
    const s = siteOf(card);
    if (e.target.closest('[data-go]')) { ctx.go(`sites/${encodeURIComponent(s.name)}`); return; }
    if (e.target.closest('[data-update]')) { updateSite(s); return; }
    const m = e.target.closest('[data-menu]'); if (m) siteMenu(m, s, { go: ctx.go, after: load });
  });
  // map op een kaart slepen = bijwerken; ergens anders = nieuwe site
  root.addEventListener('dragover', (e) => {
    if (![...(e.dataTransfer.types || [])].includes('Files')) return; e.preventDefault();
    const card = e.target.closest('.site-card');
    $$('.site-card.drag', grid).forEach((c) => { if (c !== card) { c.classList.remove('drag'); $('.drop-hint', c)?.remove(); } });
    if (card && !card.classList.contains('drag') && card.dataset.name && siteOf(card).type !== 'container') { card.classList.add('drag'); card.insertAdjacentHTML('beforeend', `<div class="drop-hint">Loslaten om<br>${esc(card.dataset.name)} bij te werken</div>`); }
  });
  root.addEventListener('dragleave', (e) => { const card = e.target.closest('.site-card'); if (card && !card.contains(e.relatedTarget)) { card.classList.remove('drag'); $('.drop-hint', card)?.remove(); } });
  root.addEventListener('drop', async (e) => {
    if (![...(e.dataTransfer.types || [])].includes('Files')) return; e.preventDefault();
    const card = e.target.closest('.site-card'); $$('.site-card.drag', grid).forEach((c) => { c.classList.remove('drag'); $('.drop-hint', c)?.remove(); });
    const files = await filesFromDrop(e.dataTransfer); if (!files.length) return;
    if (card && siteOf(card).type !== 'container') updateSite(siteOf(card), files); else newSite(files);
  });

  await load();
  if (ctx.query.nieuw) newSite();
  const un = Live.on('sites', debounce(load, 400));
  const t = setInterval(() => { if (!document.hidden) load(); }, 30000);
  return { cleanup: () => { un(); clearInterval(t); }, update: () => false };
}

// ======================================================================= menu van een site
export function siteMenu(anchor, s, { go, after }) {
  const docker = s.type !== 'static';
  menu(anchor, [
    { label: 'Details', icon: 'info', onClick: () => go(`sites/${encodeURIComponent(s.name)}`) },
    ...(s.type !== 'container' ? [{ label: 'Bijwerken', icon: 'upload', onClick: () => updateSite(s) }, { label: 'Vorige versie terugzetten', icon: 'undo', onClick: () => go(`sites/${encodeURIComponent(s.name)}?tab=backups`) }] : []),
    ...(docker ? [{ label: 'Herstarten', icon: 'refresh', onClick: () => siteAction(s, 'restart', after) }, { label: 'Live logs', icon: 'terminal', onClick: () => go(`sites/${encodeURIComponent(s.name)}?tab=logs`) }] : []),
    { label: s.maintenance ? 'Onderhoud uitzetten' : 'Onderhoudsmodus', icon: 'wrench', onClick: () => maintenance(s, !s.maintenance, after) },
    { label: 'Domein & instellingen', icon: 'sliders', onClick: () => go(`sites/${encodeURIComponent(s.name)}?tab=instellingen`) },
    '-', { label: 'Verwijderen', icon: 'trash', danger: true, onClick: () => deleteSite(s, go) },
  ]);
}
export async function siteAction(s, action, after) {
  const labels = { restart: 'herstarten', rebuild: 'opnieuw bouwen', start: 'starten', stop: 'stoppen' };
  if (action === 'stop' && !(await confirmSheet(`${esc(s.name)} stoppen? De site gaat offline tot je hem weer start.`, { ok: 'Stoppen', danger: true }))) return;
  try { const r = await api('POST', `/api/sites/${encodeURIComponent(s.name)}/${action}`); watchJob(r.job, { title: `${s.name} ${labels[action]}`, site: s.name, kind: 'docker', after }); } catch (e) { fail(e); }
}
export async function maintenance(s, on, after) {
  if (on && !(await confirmSheet(`Bezoekers van <b>${esc(s.name)}</b> zien dan een nette pagina "We zijn zo terug". Jij kan in de tussentijd rustig bijwerken.`, { title: 'Onderhoudsmodus aan?', ok: 'Aanzetten' }))) return;
  try { const r = await api('POST', `/api/sites/${encodeURIComponent(s.name)}/maintenance`, { on }); watchJob(r.job, { title: on ? 'Onderhoudsmodus aanzetten' : 'Onderhoudsmodus uitzetten', site: s.name, kind: 'maint', after, quiet: true }); } catch (e) { fail(e); }
}
export function deleteSite(s, go) {
  const sh = sheet({ title: `${s.name} verwijderen`, body: `
    <div class="grp"><label class="rw click"><input type="radio" name="how" value="0" checked style="width:18px;height:18px;accent-color:var(--p)"><span class="grow"><b>Alleen uit het paneel</b><br><small class="muted">De site blijft online en de bestanden blijven staan</small></span></label>
    ${s.managed ? `<label class="rw click"><input type="radio" name="how" value="1" style="width:18px;height:18px;accent-color:var(--p)"><span class="grow"><b>Offline halen</b><br><small class="muted">Domein weg, app stopt, bestanden gaan naar de prullenmap (niet definitief weg)</small></span></label>` : ''}</div>
    <label class="field"><span>Typ <b>${esc(s.name)}</b> om te bevestigen</span><input data-c autocapitalize="off" spellcheck="false"></label><p class="error" data-err></p>`,
  foot: `<button class="btn" data-close>Annuleren</button><button class="btn danger solid" data-go>${icon('trash', 'sm')}Verwijderen</button>` });
  sh.$('[data-go]').onclick = async () => {
    if (sh.$('[data-c]').value.trim() !== s.name) { sh.$('[data-err]').textContent = 'De naam klopt niet.'; return; }
    const files = (sh.$('input[name=how]:checked') || {}).value === '1' ? '1' : '0';
    try { const r = await api('DELETE', `/api/sites/${encodeURIComponent(s.name)}?files=${files}`); sh.close(); watchJob(r.job, { title: `${s.name} verwijderen`, site: s.name, kind: 'delete', after: () => go('sites') }); } catch (e) { sh.$('[data-err]').textContent = e.message; }
  };
}

// ======================================================================= bestanden kiezen
export async function filesFromDrop(dt) {
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  if (!entries.length) return [...dt.files].map((f) => ({ file: f, path: f.name }));
  const out = []; for (const en of entries) await walk(en, '', out); return out;
}
async function walk(entry, prefix, out) {
  const p = prefix + entry.name; if (SKIP.test(p)) return;
  if (entry.isFile) { const f = await new Promise((res, rej) => entry.file(res, rej)); out.push({ file: f, path: p }); }
  else if (entry.isDirectory) {
    const reader = entry.createReader(); let batch;
    do { batch = await new Promise((res, rej) => reader.readEntries(res, rej)); for (const e of batch) await walk(e, `${p}/`, out); } while (batch.length);
  }
}
// wat zit er in de map? (enkel om te tonen; de server kijkt het zelf nog eens na)
export async function analyse(files) {
  const isZip = files.length === 1 && /\.zip$/i.test(files[0].file.name);
  if (isZip) return { isZip, name: slug(files[0].file.name), kind: 'zip', size: files[0].file.size, count: 1 };
  const tops = new Set(files.map((p) => p.path.split('/')[0]));
  const common = tops.size === 1 && files.every((p) => p.path.includes('/')) ? [...tops][0] : '';
  const rel = (p) => (common ? p.path.slice(common.length + 1) : p.path);
  const byRel = new Map(files.map((p) => [rel(p), p]));
  const compose = files.find((p) => COMPOSE.test(rel(p)));
  let port = null;
  if (compose) { const txt = await compose.file.text(); const m = txt.match(/["'\s-](?:\d+\.\d+\.\d+\.\d+:)?(\d{2,5}):\d{2,5}(?:\/tcp)?["'\s]/); port = m ? Number(m[1]) : null; }
  let pkg = null; const pj = byRel.get('package.json'); if (pj) { try { pkg = JSON.parse(await pj.file.text()); } catch { /* */ } }
  const deps = pkg ? { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) } : {};
  const has = (n) => n in deps;
  let framework = null;
  if (byRel.has('angular.json') || has('@angular/core')) framework = 'Angular';
  else if (has('next')) framework = 'Next.js'; else if (has('nuxt')) framework = 'Nuxt'; else if (has('@sveltejs/kit')) framework = 'SvelteKit'; else if (has('astro')) framework = 'Astro';
  else if (has('vite')) framework = has('react') ? 'React (Vite)' : has('vue') ? 'Vue (Vite)' : has('svelte') ? 'Svelte (Vite)' : 'Vite';
  else if (has('react-scripts')) framework = 'React'; else if (has('@vue/cli-service')) framework = 'Vue'; else if (has('parcel')) framework = 'Parcel'; else if (has('gatsby')) framework = 'Gatsby';
  const build = !!(pkg && pkg.scripts && pkg.scripts.build);
  const rootIndex = byRel.has('index.html');
  const subIndex = [...byRel.keys()].find((k) => /^(dist|build|out|public|docs|www|site|_site)(\/[^/]+)*\/index\.html$/i.test(k));
  let kind = 'unknown';
  if (compose) kind = 'docker';
  else if (build && (!rootIndex || framework === 'Vite' || /Vite/.test(framework || ''))) kind = 'build';
  else if (rootIndex) kind = 'static';
  else if (subIndex) kind = 'static-sub';
  return { isZip: false, name: slug((pkg && pkg.name && !/^@/.test(pkg.name) ? pkg.name : '') || common), kind, framework, port, size: files.reduce((a, p) => a + p.file.size, 0), count: files.length, subIndex, hasLock: byRel.has('package-lock.json') || byRel.has('yarn.lock') || byRel.has('pnpm-lock.yaml'), hasSrc: [...byRel.keys()].some((k) => k.startsWith('src/')) };
}
function detectHtml(a) {
  if (!a) return '';
  const lg = a.isZip ? icon('zip') : a.kind === 'docker' ? icon('box') : a.framework ? esc(a.framework[0]) : icon('globe');
  const title = a.isZip ? 'Zip-bestand' : a.kind === 'docker' ? 'App met Docker (docker-compose.yml)' : a.kind === 'build' ? `${a.framework || 'Node'}-project` : a.kind === 'static' ? 'Kant-en-klare website' : a.kind === 'static-sub' ? 'Website in een submap' : 'Geen website gevonden';
  const sub = a.isZip ? 'Na het uploaden kijkt de server zelf wat erin zit (en bouwt het als dat moet).'
    : a.kind === 'docker' ? `De server bouwt en start de container${a.port ? ` op poort ${a.port}` : ''}.`
    : a.kind === 'build' ? 'De server installeert de pakketten en bouwt je site zelf (npm ci + npm run build). Enkel het resultaat gaat online.'
    : a.kind === 'static' ? 'HTML, CSS en afbeeldingen: gaat meteen online.'
    : a.kind === 'static-sub' ? `De index.html staat in "${esc(a.subIndex.replace(/\/index\.html$/i, ''))}" – die map wordt gebruikt.`
    : 'Er is geen index.html, package.json of docker-compose.yml. Kies de map van je project.';
  const found = a.isZip ? [] : [[a.count, `${a.count} bestanden`], [true, fmtBytes(a.size)], [a.framework, a.framework], [a.hasSrc, 'broncode (src)'], [a.hasLock, 'lockfile'], [a.port, `poort ${a.port}`]].filter(([c]) => c);
  return `<div class="det" style="${a.kind === 'unknown' ? 'background:var(--warnS);border-color:transparent' : ''}"><div class="lg">${lg}</div><div class="grow"><b>${title}</b><small>${sub}</small></div></div>
    ${found.length ? `<div class="found">${found.map(([, l]) => `<span>${icon('tick')}${esc(l)}</span>`).join('')}<span class="faint">node_modules en .git worden overgeslagen</span></div>` : ''}`;
}
// de "dropzone"
function picker(el, onPick, initial) {
  el.innerHTML = `<div class="drop" data-dz>
      <div class="big">${icon(IS_TOUCH ? 'zip' : 'upload', 'lg')}</div>
      <b>${IS_TOUCH ? 'Kies een .zip van je project' : 'Sleep de map van je project hierheen'}</b>
      <p>${IS_TOUCH ? 'Op een gsm kan je geen map kiezen: maak op je computer een zip van de projectmap.' : 'De hele map mag: het paneel zoekt zelf de website en bouwt hem als dat nodig is. Of kies een .zip.'}</p>
      <div class="row" style="justify-content:center;flex-wrap:wrap">${IS_TOUCH ? '' : `<button type="button" class="btn sm pri" data-pdir>${icon('folder', 'sm')}Map kiezen</button>`}<button type="button" class="btn sm ${IS_TOUCH ? 'pri' : ''}" data-pzip>${icon('zip', 'sm')}Zip kiezen</button>${IS_TOUCH ? `<button type="button" class="btn sm" data-pfiles>${icon('file', 'sm')}Losse bestanden</button>` : ''}</div>
      <input type="file" hidden data-dir webkitdirectory multiple><input type="file" hidden data-zip accept=".zip,application/zip,application/x-zip-compressed"><input type="file" hidden data-files multiple>
    </div><div data-picked></div>`;
  const dz = $('[data-dz]', el); let picked = [];
  const set = async (list) => {
    picked = list.filter((p) => !SKIP.test(p.path));
    if (!picked.length) { $('[data-picked]', el).innerHTML = ''; return; }
    $('[data-picked]', el).innerHTML = '<div class="row muted small" style="justify-content:center;padding:18px"><span class="spinner"></span>Map bekijken…</div>'; dz.classList.add('hidden');
    const a = await analyse(picked);
    $('[data-picked]', el).innerHTML = `${detectHtml(a)}<div style="text-align:right;margin-top:8px"><button type="button" class="btn ghost sm" data-clear>${icon('refresh', 'sm')}Andere map kiezen</button></div>`;
    $('[data-clear]', el).onclick = () => { picked = []; $('[data-picked]', el).innerHTML = ''; dz.classList.remove('hidden'); onPick && onPick(null); };
    onPick && onPick(a);
  };
  const b = (s) => $(s, el);
  if (b('[data-pdir]')) b('[data-pdir]').onclick = () => b('[data-dir]').click();
  if (b('[data-pfiles]')) b('[data-pfiles]').onclick = () => b('[data-files]').click();
  b('[data-pzip]').onclick = () => b('[data-zip]').click();
  b('[data-dir]').onchange = (e) => set([...e.target.files].map((f) => ({ file: f, path: f.webkitRelativePath || f.name })));
  b('[data-zip]').onchange = (e) => set([...e.target.files].map((f) => ({ file: f, path: f.name })));
  b('[data-files]').onchange = (e) => set([...e.target.files].map((f) => ({ file: f, path: f.name })));
  dz.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', async (e) => { e.preventDefault(); e.stopPropagation(); dz.classList.remove('over'); set(await filesFromDrop(e.dataTransfer)); });
  if (initial && initial.length) set(initial);
  return { files: () => picked };
}
function uploadWithProgress(url, fields, files, onProgress) {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null) fd.append(k, v);
    fd.append('paths', JSON.stringify(files.map((p) => p.path)));
    for (const p of files) fd.append('files', p.file, p.file.name);
    const x = new XMLHttpRequest(); x.open('POST', url);
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded, e.total); };
    x.onload = () => { let d = {}; try { d = JSON.parse(x.responseText); } catch { /* */ } if (x.status === 401) { bus.emit('logout'); reject(new Error('Niet ingelogd')); } else if (x.status < 300) resolve(d); else reject(new Error(d.error || `Fout ${x.status}`)); };
    x.onerror = () => reject(new Error('Verbinding verbroken tijdens het uploaden'));
    x.send(fd);
  });
}

// ======================================================================= domein kiezen
export function domainField(current = '') {
  const duck = /\.duckdns\.org$/.test(current); const mode = !current ? 'none' : duck ? 'duck' : 'own';
  return `<div class="field" data-domain><span>Domeinnaam</span>
    <div class="seg block" data-dmode>${[['none', 'Nog geen'], ['duck', 'DuckDNS'], ['own', 'Eigen domein']].map(([v, l]) => `<button type="button" data-m="${v}" class="${mode === v ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="affix ${mode === 'duck' ? '' : 'hidden'}" data-dm="duck" style="margin-top:8px"><span>https://</span><input name="duck" value="${esc(duck ? current.replace(/\.duckdns\.org$/, '') : '')}" autocapitalize="off" spellcheck="false"><span>.duckdns.org</span></div>
    <div class="affix ${mode === 'own' ? '' : 'hidden'}" data-dm="own" style="margin-top:8px"><span>https://</span><input name="own" value="${esc(duck ? '' : current)}" autocapitalize="off" spellcheck="false"></div>
    <span class="hint" data-dhint>${mode === 'none' ? 'Je kan de site dan enkel thuis bekijken. Later toevoegen kan altijd.' : mode === 'duck' ? 'Maak de naam ook aan op duckdns.org (zelfde IP). Het paneel regelt https.' : 'Laat het domein (A-record) naar je thuis-IP wijzen. Het paneel regelt https.'}</span></div>`;
}
export function bindDomain(root) {
  let mode = ($('[data-dmode] .on', root) || {}).dataset?.m || 'none';
  $$('[data-dmode] [data-m]', root).forEach((b) => { b.onclick = () => {
    mode = b.dataset.m; $$('[data-dmode] [data-m]', root).forEach((x) => x.classList.toggle('on', x === b));
    $('[data-dm=duck]', root).classList.toggle('hidden', mode !== 'duck'); $('[data-dm=own]', root).classList.toggle('hidden', mode !== 'own');
    $('[data-dhint]', root).textContent = mode === 'none' ? 'Je kan de site dan enkel thuis bekijken. Later toevoegen kan altijd.' : mode === 'duck' ? 'Maak de naam ook aan op duckdns.org (zelfde IP). Het paneel regelt https.' : 'Laat het domein (A-record) naar je thuis-IP wijzen. Het paneel regelt https.';
    const i = $(`[data-dm=${mode}] input`, root); if (i) i.focus();
  }; });
  $('input[name=duck]', root).addEventListener('input', (e) => { e.target.value = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''); });
  return () => {
    if (mode === 'duck') { const v = $('input[name=duck]', root).value.trim(); if (!v) throw new Error('Vul je DuckDNS-naam in.'); return `${v}.duckdns.org`; }
    if (mode === 'own') { const v = $('input[name=own]', root).value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''); if (!v) throw new Error('Vul je domein in.'); return v; }
    return '';
  };
}

// ======================================================================= nieuwe site
export function newSite(initialFiles) {
  const st = { a: null, step: 1 };
  const s = sheet({
    title: 'Website online zetten', sub: '<span data-stepl>Stap 1 van 3 · project kiezen</span>', size: 'wide',
    body: `<div class="prog" style="margin-bottom:16px"><i data-sbar style="width:33%"></i></div>
      <section data-step="1"><div data-pick></div></section>
      <section data-step="2" class="hidden">
        <div data-det2 style="margin-bottom:14px"></div>
        <label class="field"><span>Naam</span><input name="name" autocapitalize="off" spellcheck="false"><span class="hint">Kleine letters, cijfers en streepjes. Enkel voor jezelf.</span></label>
        ${domainField()}
        <details class="more"><summary>Geavanceerd</summary>
          <label class="field" data-portf><span>Poort van de app</span><input name="port" inputmode="numeric"><span class="hint">Het linkse getal bij <code>ports:</code> in je docker-compose.yml.</span></label>
          <label class="field"><span>Nooit overschrijven bij bijwerken</span><input name="keep"><span class="hint">.env, data en uploads worden altijd al beschermd.</span></label>
          <label class="check"><input type="checkbox" name="spa"><span>Single-page app: onbekende adressen tonen index.html <small class="faint">(wordt automatisch gezet bij Angular/React/Vue)</small></span></label>
        </details>
      </section>
      <section data-step="3" class="hidden" data-run></section>
      <p class="error" data-err></p>`,
    foot: '<button class="btn ghost left hidden" data-back>Terug</button><button class="btn" data-close>Annuleren</button><button class="btn pri" data-next disabled>Volgende</button>',
  });
  const err = s.$('[data-err]'), next = s.$('[data-next]');
  const readDomain = bindDomain(s.$('[data-domain]'));
  s.$('[name=name]').addEventListener('input', (e) => { e.target.value = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''); });
  const go = (n) => {
    st.step = n; err.textContent = '';
    s.$$('[data-step]').forEach((x) => x.classList.toggle('hidden', Number(x.dataset.step) !== n));
    s.$('[data-sbar]').style.width = `${n * 33.4}%`;
    s.$('[data-stepl]').textContent = ['', 'Stap 1 van 3 · project kiezen', 'Stap 2 van 3 · naam en domein', 'Stap 3 van 3 · online zetten'][n];
    s.$('[data-back]').classList.toggle('hidden', n !== 2);
    next.innerHTML = n === 1 ? 'Volgende' : `${icon('rocket', 'sm')}Online zetten`;
    next.disabled = n === 1 ? !st.a || st.a.kind === 'unknown' : n === 3;
    next.classList.toggle('hidden', n === 3);
    if (n === 2) { s.$('[data-det2]').innerHTML = detectHtml(st.a); s.$('[data-portf]').classList.toggle('hidden', st.a.kind !== 'docker'); setTimeout(() => s.$('[name=name]').focus(), 40); }
  };
  const pk = picker(s.$('[data-pick]'), (a) => {
    st.a = a; next.disabled = !a || a.kind === 'unknown';
    if (a) { const f = s.$('[name=name]'); if (!f.value && a.name && !(OV && OV.sites.some((x) => x.name === a.name))) f.value = a.name; if (a.port && !s.$('[name=port]').value) s.$('[name=port]').value = a.port; if (a.kind === 'build') s.$('[name=spa]').checked = !/Next|Astro|Gatsby/.test(a.framework || ''); }
  }, initialFiles);
  s.$('[data-back]').onclick = () => go(1);
  next.onclick = async () => {
    if (st.step === 1) { go(2); return; }
    let domain; const name = s.$('[name=name]').value.trim();
    try {
      if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(name)) throw new Error('Kies een naam met kleine letters, cijfers of streepjes.');
      if (OV && OV.sites.some((x) => x.name === name)) throw new Error('Die naam bestaat al. Kies een andere, of werk die site bij.');
      domain = readDomain();
      if (st.a.kind === 'docker' && domain && !s.$('[name=port]').value) { s.$('details.more').open = true; throw new Error('Ik vond geen poort in je docker-compose.yml. Vul ze in bij Geavanceerd.'); }
    } catch (x) { err.textContent = x.message; return; }
    const fields = { name, type: st.a.isZip ? 'auto' : st.a.kind === 'docker' ? 'docker' : 'static', domain, port: st.a.kind === 'docker' ? s.$('[name=port]').value.trim() : '', keep: s.$('[name=keep]').value, spa: s.$('[name=spa]').checked ? '1' : '0' };
    go(3);
    const runEl = s.$('[data-run]');
    runEl.innerHTML = `<div class="det"><div class="lg">${icon('rocket')}</div><div class="grow"><b>${esc(name)}</b><small>${domain ? `wordt https://${esc(domain)}` : 'zonder domein (enkel thuis)'}</small></div></div>
      <div style="margin-top:16px"><div class="row small"><b class="grow">Uploaden</b><span class="faint" data-upt>0%</span></div><div class="prog" style="margin-top:6px"><i data-upb></i></div></div>`;
    s.el.dataset.busy = '1';
    try {
      const r = await uploadWithProgress('/api/sites', fields, pk.files(), (l, t) => { s.$('[data-upb]').style.width = `${(l / t) * 100}%`; s.$('[data-upt]').textContent = `${fmtBytes(l)} van ${fmtBytes(t)}`; });
      delete s.el.dataset.busy;
      runJob(runEl, r.job, { site: name, kind: 'nieuw', sheet: s });
    } catch (x) { delete s.el.dataset.busy; go(2); err.textContent = x.message; }
  };
  go(1);
}

// ======================================================================= bijwerken
export function updateSite(site, initialFiles) {
  const s = sheet({
    title: `${site.name} bijwerken`, sub: 'Kies de nieuwe versie. Alleen wat veranderd is wordt vervangen.', size: 'wide',
    body: `<div data-pick></div>
      ${site.self ? `<div class="note" style="margin-top:12px">${icon('info')}<span>Kies de map <b>serverpaneel</b> (op je laptop: <code>projects\\serverpaneel</code>) of <b>serverpaneel.zip</b>. Je wachtwoord, sites en instellingen blijven. Start de nieuwe versie niet goed, dan komt de vorige vanzelf terug.</span></div>` : ''}
      <div class="note ok" style="margin-top:12px">${icon('shield')}<span>Eerst wordt automatisch een backup gemaakt. <b>.env</b>, <b>data</b> en <b>uploads</b>${site.keep && site.keep.length ? `, ${esc(site.keep.join(', '))}` : ''} op de server blijven altijd staan.</span></div>
      <div data-run></div><p class="error" data-err></p>`,
    foot: `${site.type !== 'static' || site.managed ? `<button class="btn ghost sm left" data-pull title="Als de map op de server een git-repo is">${icon('refresh', 'sm')}git pull</button>` : ''}<button class="btn" data-close>Annuleren</button><button class="btn pri" data-go disabled>${icon('upload', 'sm')}Bijwerken</button>`,
  });
  const goBtn = s.$('[data-go]'), err = s.$('[data-err]');
  const pk = picker(s.$('[data-pick]'), (a) => { goBtn.disabled = !a || a.kind === 'unknown'; }, initialFiles);
  const pull = s.$('[data-pull]');
  if (pull) pull.onclick = async () => { try { const r = await api('POST', `/api/sites/${encodeURIComponent(site.name)}/pull`); s.$('[data-pick]').innerHTML = ''; goBtn.classList.add('hidden'); pull.remove(); runJob(s.$('[data-run]'), r.job, { site: site.name, kind: 'update', sheet: s }); } catch (x) { err.textContent = x.message; } };
  goBtn.onclick = async () => {
    err.textContent = ''; goBtn.disabled = true;
    const run = s.$('[data-run]');
    run.innerHTML = `<div style="margin-top:14px"><div class="row small"><b class="grow">Uploaden</b><span class="faint" data-upt>0%</span></div><div class="prog" style="margin-top:6px"><i data-upb></i></div></div>`;
    s.el.dataset.busy = '1';
    try {
      const r = await uploadWithProgress(`/api/sites/${encodeURIComponent(site.name)}/deploy`, {}, pk.files(), (l, t) => { s.$('[data-upb]').style.width = `${(l / t) * 100}%`; s.$('[data-upt]').textContent = `${fmtBytes(l)} van ${fmtBytes(t)}`; });
      delete s.el.dataset.busy; s.$('[data-pick]').innerHTML = ''; goBtn.classList.add('hidden'); if (pull) pull.remove();
      runJob(run, r.job, { site: site.name, kind: 'update', sheet: s, self: site.self });
    } catch (x) { delete s.el.dataset.busy; err.textContent = x.message; goBtn.disabled = false; run.innerHTML = ''; }
  };
}

// ======================================================================= bestaand project
export async function importSite() {
  const s = sheet({ title: 'Bestaand project toevoegen', sub: 'Wat al op je server staat, beheer je vanaf nu ook hier. Er wordt niets aangepast.', size: 'wide',
    body: `<div data-found><div class="row muted" style="padding:16px 0"><span class="spinner"></span>Je server doorzoeken…</div></div>
      <details class="more"><summary>Of geef zelf een map op</summary>
        <label class="field"><span>Map op de server</span><input name="path" value="${esc((OV && OV.server.allowedRoot) || '')}/" autocapitalize="off" spellcheck="false"></label>
        <label class="field"><span>Naam</span><input name="name" autocapitalize="off"></label>
        <button class="btn pri" data-manual>Toevoegen</button></details>
      <div data-run></div><p class="error" data-err></p>` });
  const err = s.$('[data-err]');
  const add = async (p) => {
    err.textContent = '';
    try { const r = await api('POST', '/api/sites/import', p.container ? { name: p.name, container: p.container } : { name: p.name, path: p.path, type: p.type || 'auto', port: p.port ? String(p.port) : '' }); s.$('[data-found]').innerHTML = ''; s.$('details.more').remove(); runJob(s.$('[data-run]'), r.job, { site: p.name, kind: 'import', sheet: s }); }
    catch (x) { err.textContent = x.message; }
  };
  s.$('[data-manual]').onclick = () => add({ name: s.$('[name=name]').value.trim().toLowerCase(), path: s.$('[name=path]').value.trim() });
  if (!OV) { try { await loadOverview(); } catch { /* */ } }
  try {
    const found = await api('GET', '/api/discover');
    s.$('[data-found]').innerHTML = found.length ? `<div class="list">${found.map((p, i) => `<div class="li"><div class="ib ${p.type === 'static' ? '' : 's'}">${icon(p.type === 'static' ? 'globe' : 'box')}</div><div class="grow ellipsis"><b>${esc(p.name)}</b><small class="ellipsis">${p.domain ? `<span style="color:var(--ok)">online op ${esc(p.domain)}</span> · ` : ''}${p.self ? 'dit paneel · ' : ''}${p.type === 'container' ? `losse container · ${esc(p.image || '')}` : ''}${p.infra ? 'systeem · ' : ''}${esc(p.path || '')}</small></div><button class="btn sm" data-i="${i}">${icon('plus', 'sm')}Toevoegen</button></div>`).join('')}</div>`
      : `<div class="note">${icon('info')}<span>Geen nieuwe projecten gevonden. Geef hieronder zelf de map op.</span></div>`;
    s.$$('[data-i]').forEach((b) => { b.onclick = () => add(found[Number(b.dataset.i)]); });
    if (!found.length) s.$('details.more').open = true;
  } catch (x) { s.$('[data-found]').innerHTML = ''; err.textContent = x.message; s.$('details.more').open = true; }
}

// ======================================================================= een taak volgen
export function watchJob(id, o = {}) {
  const s = sheet({ title: o.title || 'Bezig…', body: '<div data-run></div>', foot: '<button class="btn" data-close>Sluiten</button>' });
  runJob(s.$('[data-run]'), id, { ...o, sheet: s });
  return s;
}
const HEADS = { nieuw: 'Je site staat online!', update: 'Bijgewerkt!', rollback: 'Vorige versie teruggezet', settings: 'Opgeslagen', delete: 'Verwijderd', import: 'Toegevoegd!', docker: 'Gelukt', maint: 'Gelukt' };
export async function runJob(el, id, o = {}) {
  el.innerHTML = `<div class="steps" data-steps></div><div class="prog ind" data-ind style="margin:10px 0 4px"><i></i></div><div data-result></div>
    <details class="more"><summary>Technische details</summary><pre class="log" data-log style="margin-top:8px"></pre></details>`;
  const stepsEl = $('[data-steps]', el), log = $('[data-log]', el);
  const t0 = Date.now(); const times = [];
  const before = document.querySelector('meta[name="rp-version"]').content;
  for (;;) {
    if (!el.isConnected) return;
    let j; try { j = await api('GET', `/api/jobs/${id}`); } catch (e) { stepsEl.innerHTML = `<p class="error">${esc(e.message)}</p>`; return; }
    log.innerHTML = colorLog(j.log.trim());
    if (o.sheet) { if (j.status === 'running') o.sheet.el.dataset.busy = '1'; else delete o.sheet.el.dataset.busy; }
    const steps = j.log.split('\n').filter((l) => l.startsWith('==> ') && l !== '==> Klaar.').map((l) => l.slice(4));
    while (times.length < steps.length) times.push(Date.now());
    stepsEl.innerHTML = steps.map((st, i) => {
      const last = i === steps.length - 1;
      const cls = last && j.status === 'running' ? 'run' : last && j.status === 'error' ? 'fail' : 'done';
      const dur = Math.round(((i + 1 < times.length ? times[i + 1] : Date.now()) - times[i]) / 1000);
      return `<div class="st ${cls}"><span class="bub">${cls === 'run' ? '<span class="spinner" style="width:13px;height:13px"></span>' : cls === 'fail' ? icon('x', 'xs') : icon('tick', 'xs')}</span><b>${esc(st)}</b>${cls === 'run' && /npm (ci|install)/.test(st) ? '<span class="faint small" style="margin-left:6px">de eerste keer kan dit enkele minuten duren</span>' : ''}<small>${dur > 1 ? `${dur}s` : ''}</small></div>`;
    }).join('') || `<div class="st run"><span class="bub"><span class="spinner" style="width:13px;height:13px"></span></span><b>Starten…</b></div>`;
    if (j.status !== 'running') {
      $('[data-ind]', el).remove();
      if (o.sheet) o.sheet.$$('[data-close]').forEach((b) => { if (!b.classList.contains('x')) b.textContent = 'Sluiten'; });
      try { await loadOverview(); } catch { /* */ }
      const site = OV && OV.sites.find((x) => x.name === o.site);
      const c = (re) => (j.log.match(re) || []).length;
      const changes = [[c(/^ {2}\+ nieuw:/gm), 'nieuw'], [c(/^ {2}~ gewijzigd:/gm), 'gewijzigd'], [c(/^ {2}- verwijderd:/gm), 'verwijderd']].filter(([n]) => n);
      const res = $('[data-result]', el);
      if (j.status === 'ok' && j.selfRestart) {
        stepsEl.classList.add('hidden');
        res.innerHTML = `<div class="result"><div class="bigic" style="background:var(--pS);color:var(--p2)"><span class="spinner lg"></span></div><h3>Het paneel wordt vernieuwd…</h3><p class="muted">Het bouwt zichzelf opnieuw en herstart. Meestal 1 à 3 minuten – de eerste keer met de AI-dienst en agenda kan het 5 à 10 minuten duren. Deze pagina laadt daarna vanzelf de nieuwe versie.</p><p class="faint small" data-wait></p></div>`;
        for (;;) {
          await sleep(3000); const secs = Math.round((Date.now() - t0) / 1000);
          const w = $('[data-wait]', res); if (w) w.textContent = `${secs} seconden bezig…`;
          let v = null; try { v = (await (await fetch('/api/version', { cache: 'no-store' })).json()).version; } catch { /* herstart nog */ }
          if (v && v !== before) { res.innerHTML = `<div class="result"><div class="bigic">${icon('tick')}</div><h3>Nieuwe versie actief!</h3></div>`; setTimeout(() => location.reload(), 1200); return; }
          if (secs > 900) { res.innerHTML = `<div class="result fail"><div class="bigic">${icon('x')}</div><h3>Het duurt langer dan verwacht</h3><p class="muted">Start de nieuwe versie niet goed, dan zet het paneel zelf de vorige terug. Kijk in <code>~/serverpaneel/data/laatste-update.log</code>.</p></div>`; return; }
        }
      }
      if (j.status === 'ok') {
        stepsEl.classList.add('hidden');
        const url = site && siteUrl(site), home = site && homeUrl(site);
        res.innerHTML = o.quiet ? `<div class="note ok">${icon('tick')}<span>Gelukt</span></div>` : `<div class="result"><div class="bigic">${icon('tick')}</div><h3>${HEADS[o.kind] || 'Gelukt'}</h3>
          ${changes.length ? `<div class="summary">${changes.map(([n, l]) => `<span>${n} ${l}</span>`).join('')}</div>` : /\(geen wijzigingen\)/.test(j.log) ? '<div class="summary"><span>Er was niets veranderd</span></div>' : ''}
          ${o.kind !== 'delete' && (url || home) ? `<div class="links">${url ? `<a class="btn pri lg" href="${esc(url)}" target="_blank" rel="noopener">${icon('globe', 'sm')}${esc(site.domain)} openen</a>` : ''}${home ? `<a class="btn" href="${esc(home)}" target="_blank" rel="noopener">${icon('home', 'sm')}${site.type === 'static' ? 'Voorbeeld bekijken' : 'Thuis openen'}</a>` : ''}</div>` : ''}
          ${url && (o.kind === 'nieuw' || o.kind === 'settings') ? '<p class="faint small" style="margin-top:10px">De eerste keer kan het tot een minuut duren voor https werkt.</p>' : ''}</div>`;
        if (o.quiet && o.sheet) setTimeout(() => o.sheet.close(), 900);
        bus.emit('changed', 'site'); o.after && o.after();
      } else {
        const msg = (j.log.match(/!! FOUT: (.*)/) || [])[1] || 'Onbekende fout';
        res.innerHTML = `<div class="result fail"><div class="bigic">${icon('x')}</div><h3>Dat lukte niet</h3><p class="muted" style="max-width:520px;margin:0 auto">${esc(msg)}</p><p class="faint small" style="margin-top:8px">Er is niets kapotgemaakt: bij bijwerken staat er altijd een backup klaar.</p></div>`;
        $('details.more', el).open = true; log.scrollTop = log.scrollHeight;
        o.after && o.after();
      }
      return;
    }
    await sleep(800);
  }
}
export function colorLog(t) {
  return esc(t).split('\n').map((l) => (/^==&gt; /.test(l) ? `<span class="lp">${l}</span>` : /^!! |ERR!|error/i.test(l) ? `<span class="le">${l}</span>` : /warn/i.test(l) ? `<span class="lw">${l}</span>` : /^ {2}\+ /.test(l) ? `<span class="lok">${l}</span>` : /^ {2}[~-] /.test(l) ? `<span class="linf">${l}</span>` : l)).join('\n');
}
