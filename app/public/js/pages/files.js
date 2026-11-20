/* Bestanden: alles in je home-map bekijken, bewerken, uploaden en downloaden – zonder FTP of SSH. */
import { $, $$, esc, icon, api, toast, fail, fmtBytes, ago, confirmSheet, prompt, sheet, emptyState, debounce, ls } from '../core.js';

const TEXT_EXT = /\.(txt|md|json|ya?ml|env|conf|cfg|ini|toml|caddy|js|mjs|cjs|ts|tsx|jsx|css|scss|html?|xml|svg|sh|bash|py|rb|php|go|rs|java|c|h|cpp|sql|csv|log|service|dockerignore|gitignore|htaccess)$|^(Dockerfile|Caddyfile|Makefile|\.env.*|README.*|LICENSE)$/i;

export default async function filesPage(root, ctx) {
  let cur = null, sel = new Set(), q = '', editor = null;
  const fav = () => ls.get('files-fav', []);
  root.innerHTML = `
    <div class="top"><a class="iconbtn back" href="#/meer" aria-label="Terug">${icon('left')}</a><div class="grow"><h1>Bestanden</h1><p>Alles op je server, zonder FTP of SSH</p></div>
      <div class="actions"><button class="btn keep" data-mkdir>${icon('folder', 'sm')}<span class="desk-only">Nieuwe map</span></button><button class="btn keep" data-newfile>${icon('file', 'sm')}<span class="desk-only">Nieuw bestand</span></button><label class="btn pri keep">${icon('upload', 'sm')}<span class="desk-only">Uploaden</span><input type="file" multiple hidden data-up></label></div></div>
    <div class="files-layout">
      <aside class="card files-side"><div class="sec-l">Snel naar</div><div data-places></div><div class="sec-l" style="margin-top:10px">Favorieten</div><div data-favs></div><div class="files-disk" data-disk></div><button class="btn sm line block" data-trash style="margin-top:8px">${icon('trash', 'sm')}Prullenbak</button></aside>
      <section class="card pad0 files-main" data-drop>
        <div class="files-bar"><nav class="crumbs" data-crumbs aria-label="Pad"></nav><label class="sbox sm">${icon('search', 'sm')}<input data-q placeholder="Zoek in deze map" aria-label="Zoek in deze map"></label></div>
        <div class="files-sel hidden" data-selbar></div>
        <div class="files-list" data-list><div class="row muted" style="padding:20px"><span class="spinner"></span>Laden…</div></div>
      </section>
    </div>`;
  ctx.setFab(null, { hide: true });

  async function load(p, keepSel) {
    try { cur = await api('GET', `/api/files?path=${encodeURIComponent(p || '')}`); } catch (e) { fail(e); if (!cur) $('[data-list]', root).innerHTML = `<p class="error" style="padding:16px">${esc(e.message)}</p>`; return; }
    if (!keepSel) sel.clear();
    ls.set('files-last', cur.path);
    if (ctx.query.p !== cur.path) history.replaceState(null, '', `#/bestanden?p=${encodeURIComponent(cur.path)}`);
    draw();
  }
  function places() {
    const home = cur.roots[0];
    const list = [['Thuismap', home, 'home'], ['Sites', `${home}/sites`, 'globe'], ['Paneel', `${home}/serverpaneel`, 'server'], ['Apps', `${home}/apps`, 'box'], ['Backups', `${home}/.serverpaneel/backups`, 'refresh']];
    for (const r of cur.roots.slice(1)) list.push([r.split('/').pop(), r, 'disk']);
    return list;
  }
  function draw() {
    $('[data-places]', root).innerHTML = places().map(([l, p, ic]) => `<button class="place ${cur.path === p ? 'on' : ''}" data-go="${esc(p)}">${icon(ic, 'sm')}<span class="ellipsis">${esc(l)}</span></button>`).join('');
    const f = fav();
    $('[data-favs]', root).innerHTML = f.length ? f.map((p) => `<button class="place ${cur.path === p ? 'on' : ''}" data-go="${esc(p)}">${icon('star', 'sm')}<span class="ellipsis">${esc(p.split('/').pop())}</span></button>`).join('') : '<p class="faint small" style="padding:2px 8px">Klik op de ster bij een map</p>';
    $('[data-disk]', root).innerHTML = cur.disk ? `<div class="row small"><span class="grow muted">Vrij</span><b class="num">${fmtBytes(cur.disk.free)}</b></div><div class="meter" style="margin-top:4px"><span style="width:${Math.round((1 - cur.disk.free / cur.disk.total) * 100)}%"></span></div>` : '';
    // kruimelpad
    const rootP = cur.roots.find((r) => cur.path === r || cur.path.startsWith(`${r}/`)) || cur.roots[0];
    const parts = cur.path.slice(rootP.length).split('/').filter(Boolean);
    let acc = rootP;
    const isFav = f.includes(cur.path);
    $('[data-crumbs]', root).innerHTML = `<button data-go="${esc(rootP)}">${icon('home', 'sm')}${esc(rootP.split('/').pop() || '/')}</button>${parts.map((x) => { acc += `/${x}`; return `<span class="sep">/</span><button data-go="${esc(acc)}">${esc(x)}</button>`; }).join('')}<button class="star ${isFav ? 'on' : ''}" data-fav aria-label="${isFav ? 'Uit favorieten' : 'Bij favorieten'}" title="Favoriet">${icon('star', 'sm')}</button>`;
    list();
  }
  function list() {
    const items = cur.entries.filter((e) => !q || e.name.toLowerCase().includes(q));
    $('[data-list]', root).innerHTML = (cur.parent ? `<div class="frow up" data-go="${esc(cur.parent)}"><span></span><span class="fn">${icon('left', 'sm')}<b>..</b></span><span></span><span></span><span></span></div>` : '')
      + (items.length ? items.map((e) => {
        const p = `${cur.path}/${e.name}`;
        return `<div class="frow ${sel.has(p) ? 'sel' : ''}" data-p="${esc(p)}" data-dir="${e.dir ? 1 : ''}">
          <input type="checkbox" aria-label="${esc(e.name)} selecteren" ${sel.has(p) ? 'checked' : ''} data-ck>
          <span class="fn">${e.dir ? `<span class="ficon d">${icon('folder', 'sm')}</span>` : `<span class="ficon">${icon('file', 'sm')}</span>`}<span class="ellipsis"><b>${esc(e.name)}</b>${e.link ? ' <span class="faint small">↪</span>' : ''}</span></span>
          <span class="num muted small">${e.dir ? '' : fmtBytes(e.size)}</span><span class="muted small desk-only">${ago(e.mtime)}</span><span class="muted small mono desk-only">${e.mode}</span></div>`;
      }).join('') : `<div style="padding:12px">${emptyState('folder', q ? 'Niets gevonden' : 'Lege map', q ? '' : 'Sleep bestanden hierheen om ze te uploaden.')}</div>`);
    selbar();
  }
  function selbar() {
    const b = $('[data-selbar]', root);
    b.classList.toggle('hidden', !sel.size);
    if (!sel.size) return;
    const one = sel.size === 1 ? [...sel][0] : null;
    b.innerHTML = `<b>${sel.size} geselecteerd</b><div class="grow"></div>
      ${one ? `<button class="btn sm" data-a="download">${icon('download', 'sm')}Downloaden</button><button class="btn sm" data-a="rename">${icon('edit', 'sm')}Hernoemen</button><button class="btn sm" data-a="chmod">${icon('lock', 'sm')}Rechten</button>` : ''}
      <button class="btn sm danger" data-a="delete">${icon('trash', 'sm')}Naar prullenbak</button><button class="btn sm ghost icon" data-a="clear" aria-label="Selectie wissen">${icon('x', 'sm')}</button>`;
  }
  async function openFile(p) {
    if (!TEXT_EXT.test(p.split('/').pop())) { const e = cur.entries.find((x) => `${cur.path}/${x.name}` === p); if (e && e.size > 200e3) { location.href = `/api/files/download?path=${encodeURIComponent(p)}`; return; } }
    let f; try { f = await api('GET', `/api/files/read?path=${encodeURIComponent(p)}`); } catch (e) { fail(e); return; }
    if (f.binary || f.tooBig) {
      if (await confirmSheet(`${esc(p.split('/').pop())} is ${f.tooBig ? 'te groot om hier te tonen' : 'geen tekstbestand'} (${fmtBytes(f.size)}). Downloaden?`, { title: 'Bestand openen', ok: 'Downloaden' })) location.href = `/api/files/download?path=${encodeURIComponent(p)}`;
      return;
    }
    edit(p, f);
  }
  function edit(p, f) {
    const name = p.split('/').pop();
    const s = sheet({ title: name, sub: `<span class="mono small">${esc(p)}</span>`, size: 'wide', body: `<textarea class="code-ed" spellcheck="false" data-ed>${esc(f.text)}</textarea><p class="faint small" style="margin-top:6px">Bij bewaren wordt eerst een kopie van de vorige versie gemaakt in de backups. Ctrl+S = bewaren.</p>`, foot: `<a class="btn" href="/api/files/download?path=${encodeURIComponent(p)}">${icon('download', 'sm')}Downloaden</a><div class="grow"></div><button class="btn" data-close>Sluiten</button><button class="btn pri" data-save>Bewaren</button>` });
    const ta = s.$('[data-ed]'); let mtime = f.mtime, dirty = false;
    ta.addEventListener('input', () => { dirty = true; });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') { e.preventDefault(); const a = ta.selectionStart; ta.setRangeText('  ', a, ta.selectionEnd, 'end'); dirty = true; }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); }
    });
    async function save() {
      try { const r = await api('POST', '/api/files/write', { path: p, text: ta.value, mtime }); mtime = r.mtime; dirty = false; toast('Bewaard'); load(cur.path, true); } catch (e) { fail(e); }
    }
    s.$('[data-save]').onclick = save;
    editor = { dirty: () => dirty };
  }
  async function upload(files) {
    if (!files.length) return;
    const fd = new FormData(); for (const f of files) fd.append('files', f, f.webkitRelativePath || f.name);
    toast(`${files.length} bestand${files.length > 1 ? 'en' : ''} uploaden…`, { icon: 'upload' });
    try { const r = await api('POST', `/api/files/upload?path=${encodeURIComponent(cur.path)}`, fd); toast(`${r.uploaded} geüpload`); load(cur.path); } catch (e) { fail(e); }
  }
  async function action(a) {
    const one = [...sel][0];
    if (a === 'clear') { sel.clear(); list(); return; }
    if (a === 'download') { location.href = `/api/files/download?path=${encodeURIComponent(one)}`; return; }
    if (a === 'rename') { const n = await prompt('Hernoemen', { value: one.split('/').pop(), label: 'Nieuwe naam' }); if (!n) return; try { await api('POST', '/api/files/rename', { path: one, name: n }); load(cur.path); } catch (e) { fail(e); } return; }
    if (a === 'chmod') { const e = cur.entries.find((x) => `${cur.path}/${x.name}` === one); const n = await prompt('Rechten', { value: e ? e.mode : '644', label: '3 cijfers: 644 = gewoon bestand, 755 = map of script, 600 = enkel jij' }); if (!n) return; try { await api('POST', '/api/files/chmod', { path: one, mode: n }); load(cur.path, true); toast('Rechten aangepast'); } catch (er) { fail(er); } return; }
    if (a === 'delete') {
      if (!(await confirmSheet(`${sel.size} item${sel.size > 1 ? 's' : ''} naar de prullenbak verplaatsen? Je kan ze daar nog terughalen.`, { title: 'Naar prullenbak', ok: 'Verplaatsen', danger: true }))) return;
      try { await api('POST', '/api/files/delete', { paths: [...sel] }); toast('Naar de prullenbak verplaatst'); load(cur.path); } catch (e) { fail(e); }
    }
  }
  async function trash() {
    let t; try { t = await api('GET', '/api/files/trash'); } catch (e) { fail(e); return; }
    const s = sheet({ title: 'Prullenbak', body: `<p class="muted">${t.count} bestand${t.count === 1 ? '' : 'en'} · ${fmtBytes(t.size)}</p><p class="small faint mono" style="margin-top:6px">${esc(t.path)}</p>`, foot: `<button class="btn" data-go-trash>${icon('folder', 'sm')}Bekijken</button><div class="grow"></div><button class="btn danger solid" data-empty ${t.count ? '' : 'disabled'}>Leegmaken</button>` });
    s.$('[data-go-trash]').onclick = () => { s.close(); load(t.path); };
    s.$('[data-empty]').onclick = async () => { if (!(await confirmSheet('Alles in de prullenbak wordt definitief gewist. Dit kan je niet ongedaan maken.', { title: 'Prullenbak leegmaken', ok: 'Definitief wissen', danger: true }))) return; try { await api('POST', '/api/files/trash/empty'); toast('Prullenbak leeggemaakt'); s.close(); } catch (e) { fail(e); } };
  }

  root.addEventListener('click', (e) => {
    const g = e.target.closest('[data-go]'); if (g && !e.target.closest('[data-ck]')) { load(g.dataset.go); return; }
    if (e.target.closest('[data-fav]')) { const f = fav(); const i = f.indexOf(cur.path); if (i >= 0) f.splice(i, 1); else f.push(cur.path); ls.set('files-fav', f.slice(-12)); draw(); return; }
    const ck = e.target.closest('[data-ck]');
    const row = e.target.closest('.frow[data-p]');
    if (ck && row) { if (ck.checked) sel.add(row.dataset.p); else sel.delete(row.dataset.p); row.classList.toggle('sel', ck.checked); selbar(); return; }
    if (row) { if (row.dataset.dir) load(row.dataset.p); else openFile(row.dataset.p); return; }
    const a = e.target.closest('[data-a]'); if (a) action(a.dataset.a);
  });
  $('[data-q]', root).addEventListener('input', debounce((e) => { q = e.target.value.toLowerCase(); list(); }, 100));
  $('[data-up]', root).addEventListener('change', (e) => { upload([...e.target.files]); e.target.value = ''; });
  $('[data-trash]', root).onclick = trash;
  $('[data-mkdir]', root).onclick = async () => { const n = await prompt('Nieuwe map', { label: 'Naam' }); if (!n) return; try { await api('POST', '/api/files/mkdir', { path: cur.path, name: n }); load(cur.path); } catch (e) { fail(e); } };
  $('[data-newfile]', root).onclick = async () => { const n = await prompt('Nieuw bestand', { label: 'Naam', placeholder: 'bv. notities.txt of .env' }); if (!n) return; const p = `${cur.path}/${n}`; try { await api('POST', '/api/files/write', { path: p, text: '' }); await load(cur.path); edit(p, { text: '', mtime: null }); } catch (e) { fail(e); } };
  const drop = $('[data-drop]', root);
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('drag'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('drag'); upload([...e.dataTransfer.files]); });
  await load(ctx.query.p || ls.get('files-last', ''));
  return {
    cleanup: () => { editor = null; },
    update: async (r) => { if (r.query.p && cur && r.query.p !== cur.path) await load(r.query.p); return true; },
  };
}
