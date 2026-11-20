/* Delen: gedeeld klembord tussen gsm en laptop + bestanden delen met een link die vanzelf vervalt. */
import { $, $$, esc, icon, api, toast, fail, menu, confirmSheet, choose, copyText, ago, fmtBytes, debounce, emptyState, bus } from '../core.js';
import * as Live from '../live.js';

const EXPIRY = [[1, '1 uur'], [24, '1 dag'], [72, '3 dagen'], [168, '1 week'], [720, '30 dagen']];
function left(t) { const m = Math.round((t - Date.now()) / 60000); if (m <= 0) return 'verlopen'; if (m < 60) return `nog ${m} min`; if (m < 1440) return `nog ${Math.round(m / 60)} u`; return `nog ${Math.round(m / 1440)} d`; }
const ext = (n) => (String(n).match(/\.([a-z0-9]{1,4})$/i) || [, 'bestand'])[1];

export default async function share(root, ctx) {
  let clips = []; let files = [];
  let hours = 24;
  root.innerHTML = `
    <div class="top"><div class="grow"><h1>Delen</h1><p>Tekst van je gsm naar je laptop (en terug), of een bestand met een link.</p></div></div>
    <div class="tabs m-only" data-tabs><button class="on" data-tab="clip">Klembord</button><button data-tab="files">Bestanden</button></div>
    <div class="grid two">
      <div data-pane="clip">
        <div class="card"><h3>${icon('clip')}Gedeeld klembord<span class="more" data-clearall></span></h3>
          <div class="paste" style="margin-top:12px"><textarea data-txt placeholder="Plak of typ hier… verschijnt meteen op je andere toestellen"></textarea>
            <div class="row" style="justify-content:flex-end;margin-top:8px"><button class="btn sm" data-paste>${icon('copy', 'sm')}Plakken</button><button class="btn sm pri" data-send>${icon('send', 'sm')}Delen</button></div></div>
          <div data-clips></div>
        </div>
      </div>
      <div data-pane="files">
        <div class="card"><h3>${icon('upload')}Bestanden delen</h3>
          <label class="drop" data-drop style="display:block;margin-top:12px;cursor:pointer"><div class="big">${icon('upload', 'lg')}</div><b>Sleep een bestand hierheen</b><p>of tik om te kiezen · je krijgt een link die je kan doorsturen</p>
            <input type="file" data-file hidden multiple></label>
          <div class="row" style="margin-top:12px;flex-wrap:wrap"><span class="muted small">Link werkt</span><div class="chips" data-exp>${EXPIRY.map(([h, l]) => `<button class="chip ${h === hours ? 'on' : ''}" data-h="${h}">${l}</button>`).join('')}</div></div>
          <div data-up></div>
          <div data-files style="margin-top:10px"></div>
        </div>
      </div>
    </div>`;
  ctx.setFab(null, { hide: true });
  const mob = matchMedia('(max-width:760px)');
  const setTab = (t) => { $$('[data-tab]', root).forEach((b) => b.classList.toggle('on', b.dataset.tab === t)); $$('[data-pane]', root).forEach((p) => { p.style.display = mob.matches && p.dataset.pane !== t ? 'none' : ''; }); };
  setTab(ctx.query.tab === 'bestanden' ? 'files' : 'clip');

  // ---- klembord
  async function loadClips() { try { clips = await api('GET', '/api/clipboard'); } catch (e) { fail(e); return; } drawClips(); }
  function drawClips() {
    $('[data-clearall]', root).innerHTML = clips.some((c) => !c.pinned) ? `${icon('trash', 'xs')}Wissen` : '';
    $('[data-clips]', root).innerHTML = clips.length ? clips.map((c) => `<div class="clip" data-id="${esc(c.id)}"><div class="tx">${linkify(c.text)}</div>
      <div class="mt">${icon(c.from === 'gsm' ? 'bell' : 'layout', 'xs')}<span>${c.from === 'gsm' ? 'van gsm' : 'van laptop'} · ${esc(ago(c.createdAt))}</span>${c.pinned ? `<span class="tag" style="padding:1px 7px">${icon('pinned', 'xs')}vast</span>` : ''}
        <div class="act"><button class="btn sm pri" data-copy>${icon('copy', 'sm')}Kopieer</button><button class="btn ghost icon sm" data-cmenu aria-label="Meer">${icon('more', 'sm')}</button></div></div></div>`).join('')
      : `<div style="margin-top:12px">${emptyState('clip', 'Nog niets gedeeld', 'Wat je hier plakt kan je op je andere toestel meteen kopiëren.')}</div>`;
  }
  const linkify = (t) => esc(t).replace(/(https?:\/\/[^\s<]+)/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
  async function send(text) {
    text = (text || '').trim(); if (!text) return;
    try { await api('POST', '/api/clipboard', { text }); $('[data-txt]', root).value = ''; toast('Gedeeld', { icon: 'clip' }); loadClips(); } catch (e) { fail(e); }
  }
  $('[data-send]', root).onclick = () => send($('[data-txt]', root).value);
  $('[data-txt]', root).addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send(e.target.value); });
  $('[data-paste]', root).onclick = async () => {
    try { const t = await navigator.clipboard.readText(); if (t) send(t); else toast('Je klembord is leeg'); }
    catch { $('[data-txt]', root).focus(); toast('Houd lang ingedrukt in het vak en kies "Plak"'); }
  };
  if (!navigator.clipboard || !navigator.clipboard.readText) $('[data-paste]', root).classList.add('hidden');

  // ---- bestanden
  async function loadFiles() { try { files = await api('GET', '/api/shares'); } catch (e) { fail(e); return; } drawFiles(); }
  function drawFiles() {
    const active = files.filter((f) => f.expiresAt > Date.now());
    $('[data-files]', root).innerHTML = active.length ? `<div class="sec-title">Gedeelde links</div>${active.map((f) => `<div class="li" data-fid="${esc(f.id)}"><div class="fileic">${esc(ext(f.name))}</div><div class="grow ellipsis"><b class="ellipsis">${esc(f.name)}</b><small>${fmtBytes(f.size)} · ${left(f.expiresAt)} · ${f.downloads || 0}× gedownload</small></div><div class="end"><button class="btn sm" data-flink>${icon('link', 'sm')}<span class="desk-only">Link</span></button><button class="btn ghost icon sm" data-fmenu aria-label="Meer">${icon('more', 'sm')}</button></div></div>`).join('')}`
      : '';
  }
  const fullUrl = (f) => `${location.origin}${f.url}`;
  async function shareLink(f) {
    if (navigator.share && matchMedia('(pointer:coarse)').matches) { try { await navigator.share({ title: f.name, url: fullUrl(f) }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    copyText(fullUrl(f), 'Link gekopieerd');
  }
  $$('[data-h]', root).forEach((b) => { b.onclick = () => { hours = Number(b.dataset.h); $$('[data-h]', root).forEach((x) => x.classList.toggle('on', x === b)); }; });
  const drop = $('[data-drop]', root);
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); upload([...e.dataTransfer.files]); });
  $('[data-file]', root).onchange = (e) => { upload([...e.target.files]); e.target.value = ''; };
  async function upload(list) {
    for (const file of list) {
      const box = $('[data-up]', root);
      const row = document.createElement('div'); row.className = 'li';
      row.innerHTML = `<div class="fileic">${esc(ext(file.name))}</div><div class="grow"><b class="ellipsis">${esc(file.name)}</b><div class="prog" style="margin-top:6px"><i></i></div></div><small class="faint" data-pct>0%</small>`;
      box.appendChild(row);
      try {
        const res = await new Promise((resolve, reject) => {
          const fd = new FormData(); fd.append('hours', hours); fd.append('file', file);
          const x = new XMLHttpRequest(); x.open('POST', '/api/shares');
          x.upload.onprogress = (ev) => { if (ev.lengthComputable) { const p = Math.round((ev.loaded / ev.total) * 100); $('.prog i', row).style.width = `${p}%`; $('[data-pct]', row).textContent = `${p}%`; } };
          x.onload = () => { let d = {}; try { d = JSON.parse(x.responseText); } catch { /* */ } if (x.status === 401) { bus.emit('logout'); reject(new Error('Niet ingelogd')); } else if (x.status >= 400) reject(new Error(d.error || `Fout ${x.status}`)); else resolve(d); };
          x.onerror = () => reject(new Error('Upload mislukt (verbinding)'));
          x.send(fd);
        });
        row.remove(); await loadFiles();
        toast('Klaar! Link gekopieerd', { icon: 'link' }); copyText(fullUrl(res), 'Klaar! Link gekopieerd');
      } catch (e) { row.remove(); fail(e); }
    }
  }

  root.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-tab]'); if (t) { setTab(t.dataset.tab); return; }
    const cl = e.target.closest('.clip[data-id]');
    if (cl) {
      const c = clips.find((x) => x.id === cl.dataset.id); if (!c) return;
      if (e.target.closest('[data-copy]')) { copyText(c.text); return; }
      const m = e.target.closest('[data-cmenu]');
      if (m) menu(m, [
        { label: c.pinned ? 'Losmaken' : 'Vastzetten (wordt niet gewist)', icon: 'pinned', onClick: async () => { try { await api('PUT', `/api/clipboard/${c.id}`, { pinned: !c.pinned }); loadClips(); } catch (x) { fail(x); } } },
        { label: 'Als notitie bewaren', icon: 'note', onClick: async () => { try { await api('POST', '/api/notes', { title: '', body: c.text }); toast('Bewaard bij Notities', { icon: 'note' }); } catch (x) { fail(x); } } },
        '-', { label: 'Verwijderen', icon: 'trash', danger: true, onClick: async () => { try { await api('DELETE', `/api/clipboard/${c.id}`); loadClips(); } catch (x) { fail(x); } } },
      ]);
      return;
    }
    if (e.target.closest('[data-clearall]')) { if (!(await confirmSheet('Alles op het klembord wissen? Vastgezette items blijven.', { ok: 'Wissen', danger: true }))) return; try { await api('DELETE', '/api/clipboard'); loadClips(); } catch (x) { fail(x); } return; }
    const fr = e.target.closest('[data-fid]');
    if (fr) {
      const f = files.find((x) => x.id === fr.dataset.fid); if (!f) return;
      if (e.target.closest('[data-flink]')) { shareLink(f); return; }
      const m = e.target.closest('[data-fmenu]');
      if (m) menu(m, [
        { label: 'Link kopiëren', icon: 'copy', onClick: () => copyText(fullUrl(f), 'Link gekopieerd') },
        { label: 'Openen', icon: 'ext', onClick: () => window.open(f.url, '_blank') },
        { label: 'Langer laten werken', icon: 'clock', onClick: async () => { const h = await choose('Link werkt nog…', EXPIRY.map(([v, l]) => ({ label: l, value: v }))); if (!h) return; try { await api('PUT', `/api/shares/${f.id}`, { hours: h }); loadFiles(); } catch (x) { fail(x); } } },
        '-', { label: 'Nu stoppen en verwijderen', icon: 'trash', danger: true, onClick: async () => { try { await api('DELETE', `/api/shares/${f.id}`); toast('Link werkt niet meer'); loadFiles(); } catch (x) { fail(x); } } },
      ]);
    }
  });

  await Promise.all([loadClips(), loadFiles()]);
  const unsubs = [Live.on('clipboard', debounce(loadClips, 150)), Live.on('shares', debounce(loadFiles, 200))];
  const tick = setInterval(drawFiles, 60e3);
  const onMq = () => setTab($('[data-tab].on', root)?.dataset.tab || 'clip'); mob.addEventListener('change', onMq);
  return () => { unsubs.forEach((u) => u()); clearInterval(tick); mob.removeEventListener('change', onMq); };
}
