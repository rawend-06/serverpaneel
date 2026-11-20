/* Notities: kaartjes zoals Google Keep, vastgepind bovenaan, kleuren, mappen, afvinklijstjes en een opmaakbalk. Bewaart vanzelf. */
import { $, $$, esc, icon, api, toast, fail, sheet, menu, confirmSheet, prompt, debounce, ago, md, isMobile, copyText, emptyState, bus } from '../core.js';
import * as Live from '../live.js';

const CLIENT = Math.random().toString(36).slice(2, 8);
const COLORS = [['', 'Geen'], ['indigo', 'Indigo'], ['blauw', 'Blauw'], ['paars', 'Paars'], ['groen', 'Groen'], ['geel', 'Geel'], ['roze', 'Roze'], ['grijs', 'Grijs']];
const isList = (b) => /^\s*[-*] \[[ xX]\]/m.test(b || '');
const firstLine = (s) => String(s || '').split('\n').find((l) => l.trim())?.replace(/^#+\s*/, '').replace(/^\s*[-*] (\[[ xX]\] )?/, '').slice(0, 80) || '';

// voorbeeld van de inhoud op een kaartje (afvinklijstjes met vakjes)
function preview(n) {
  const lines = String(n.body || '').split('\n').filter((l) => l.trim());
  const body = n.title ? lines : lines.slice(1);
  const items = body.slice(0, 8).map((l) => {
    const m = l.match(/^\s*[-*] \[( |x|X)\]\s*(.*)/);
    if (m) return `<div class="nl ${m[1] !== ' ' ? 'done' : ''}"><span class="cbx">${m[1] !== ' ' ? icon('tick') : ''}</span><span>${esc(m[2])}</span></div>`;
    const h = l.match(/^#+\s*(.*)/); if (h) return `<div class="nl"><b>${esc(h[1])}</b></div>`;
    return `<div class="nl">${esc(l.replace(/^\s*[-*]\s+/, '• ').replace(/\*\*(.+?)\*\*/g, '$1'))}</div>`;
  }).join('');
  const more = body.length > 8 ? `<div class="nl faint">+ ${body.length - 8} meer</div>` : '';
  return items + more;
}

export default async function notes(root, ctx) {
  let data = { notes: [], folders: [] };
  let folder = ctx.query.map || '';
  let q = '';
  root.innerHTML = `
    <div class="top"><div class="grow"><h1>Notities</h1><p data-sub>&nbsp;</p></div>
      <div class="actions"><button class="btn" data-newlist>${icon('tasks', 'sm')}Lijstje</button><button class="btn pri" data-new>${icon('plus', 'sm')}Notitie</button></div></div>
    <div class="ntools">
      <label class="sbox">${icon('search', 'sm')}<input data-q type="search" placeholder="Zoeken in je notities"></label>
      <div class="nfolders" data-folders></div>
    </div>
    <div class="nquick m-only" style="margin-bottom:14px"><button class="nq" data-new>${icon('edit', 'sm')}Notitie…</button><button class="nq" data-newlist aria-label="Nieuw lijstje">${icon('tasks', 'sm')}</button></div>
    <div data-list></div>`;
  ctx.setFab(() => openEditor(null));

  async function load() {
    try { data = await api('GET', '/api/notes'); } catch (e) { fail(e); return; }
    draw();
  }
  function visible() {
    return data.notes.filter((n) => !(n.quick && !String(n.body || '').trim()))
      .filter((n) => !folder || n.folder === folder)
      .filter((n) => !q || `${n.title}\n${n.body}`.toLowerCase().includes(q));
  }
  function card(n) {
    const title = n.quick ? 'Kladblok' : n.title || firstLine(n.body) || 'Zonder titel';
    return `<article class="ncard ${n.color ? `c-${n.color}` : ''}" data-id="${esc(n.id)}" tabindex="0">
      <div class="nh"><b>${esc(title)}</b>${n.pinned ? `<span class="pin" title="Vastgepind">${icon('pinned', 'xs')}</span>` : ''}</div>
      <div class="nb">${preview(n.quick ? { ...n, title: 'x' } : n) || '<div class="nl faint">Leeg</div>'}</div>
      <div class="nf">${n.quick ? `<span class="tag n">${icon('home', 'xs')}dashboard</span>` : ''}${n.folder ? `<span class="tag n">${icon('folder', 'xs')}${esc(n.folder)}</span>` : ''}<span class="faint">${esc(ago(n.updatedAt || n.createdAt))}</span></div>
    </article>`;
  }
  function draw() {
    const counts = {}; for (const n of data.notes) counts[n.folder || ''] = (counts[n.folder || ''] || 0) + 1;
    const real = data.notes.filter((n) => !(n.quick && !String(n.body || '').trim()));
    $('[data-sub]', root).textContent = `${real.length} ${real.length === 1 ? 'notitie' : 'notities'}`;
    $('[data-folders]', root).innerHTML = `<button class="chip ${folder === '' ? 'on' : ''}" data-f="">Alles</button>${data.folders.map((f) => `<button class="chip ${folder === f ? 'on' : ''}" data-f="${esc(f)}">${icon('folder', 'xs')}${esc(f)}${counts[f] ? ` <span class="faint">${counts[f]}</span>` : ''}</button>`).join('')}<button class="chip" data-folders-edit>${icon('sliders', 'xs')}Mappen</button>`;
    const list = visible();
    const pinned = list.filter((n) => n.pinned), others = list.filter((n) => !n.pinned);
    $('[data-list]', root).innerHTML = list.length
      ? `${pinned.length ? `<div class="sec-title">${icon('pinned', 'xs')} Vastgepind</div><div class="ngrid">${pinned.map(card).join('')}</div>` : ''}
         ${others.length ? `${pinned.length ? '<div class="sec-title">Andere</div>' : ''}<div class="ngrid">${others.map(card).join('')}</div>` : ''}`
      : `<div class="card">${emptyState('note', q ? 'Niets gevonden' : folder ? `Nog niets in ${esc(folder)}` : 'Nog geen notities', q ? 'Probeer een ander woord.' : 'Alles wat je wil onthouden, op één plek.', q ? '' : `<button class="btn pri sm" data-new>${icon('plus', 'sm')}Nieuwe notitie</button>`)}</div>`;
  }

  // ---------------------------------------------------------------- de editor (groot venster, op gsm volledig scherm)
  async function openEditor(id, opts = {}) {
    let n = id ? data.notes.find((x) => x.id === id) : null;
    if (!n) {
      try { n = await api('POST', '/api/notes', { title: '', body: opts.list ? '- [ ] ' : '', folder }); data.notes.unshift(n); } catch (e) { fail(e); return; }
    }
    let cur = { ...n };
    let mode = opts.list || !cur.body || (!isList(cur.body) && !opts.view) ? 'edit' : 'view';
    if (id && cur.body && !isMobile() && !isList(cur.body)) mode = 'edit';
    if (id) history.replaceState(null, '', `#/notities/${encodeURIComponent(cur.id)}`);
    const s = sheet({
      size: 'wide nsheet', title: '',
      body: `<div class="ned ${cur.color ? `c-${cur.color}` : ''}" data-ned>
        <input class="nt" data-title placeholder="${cur.quick ? 'Kladblok' : 'Titel'}" value="${esc(cur.quick && !cur.title ? 'Snelle notitie' : cur.title)}" ${cur.quick ? 'readonly' : ''}>
        <div class="ntb" data-tb>
          <div class="seg"><button data-mode="edit" title="Schrijven">${icon('edit', 'xs')}</button><button data-mode="view" title="Bekijken / afvinken">${icon('eye', 'xs')}</button></div>
          <span class="sep"></span>
          <button data-fmt="h" title="Kop">H</button><button data-fmt="b" title="Vet"><b>B</b></button><button data-fmt="ul" title="Opsomming">${icon('list', 'xs')}</button><button data-fmt="chk" title="Afvinklijstje">${icon('tasks', 'xs')}</button><button data-fmt="ol" title="Genummerd">1.</button>
        </div>
        <div data-area></div>
      </div>`,
      foot: `<button class="btn ghost icon" data-pin title="Vastpinnen">${icon('pinned', 'sm')}</button><button class="btn ghost icon" data-color title="Kleur">${icon('sun', 'sm')}</button>${cur.quick ? '' : `<select data-folder class="nfsel"><option value="">Geen map</option>${data.folders.map((f) => `<option ${f === cur.folder ? 'selected' : ''}>${esc(f)}</option>`).join('')}</select>`}<button class="btn ghost icon" data-more title="Meer">${icon('more')}</button><span class="grow"></span><span class="faint tiny" data-state>${esc(ago(cur.updatedAt))}</span><button class="btn pri" data-close>Klaar</button>`,
      onClose: async () => { await flush(true); if (location.hash.startsWith('#/notities/')) history.replaceState(null, '', '#/notities'); load(); },
    });
    const ned = s.$('[data-ned]'), area = s.$('[data-area]'), stEl = s.$('[data-state]');
    const setState = (t) => { if (stEl) stEl.textContent = t; };
    const pinBtn = s.$('[data-pin]');
    const paintPin = () => { pinBtn.style.color = cur.pinned ? 'var(--p2)' : ''; pinBtn.title = cur.pinned ? 'Losmaken' : 'Vastpinnen'; };
    paintPin();
    function drawArea(focus) {
      s.$$('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
      s.$$('[data-fmt]').forEach((b) => { b.disabled = mode !== 'edit'; });
      if (mode === 'edit') {
        area.innerHTML = `<textarea class="nb" data-body placeholder="Begin met typen…">${esc(cur.body)}</textarea>`;
        const ta = $('[data-body]', area);
        ta.addEventListener('input', () => { cur.body = ta.value; setState('Typen…'); save(); autoGrow(ta); });
        ta.addEventListener('keydown', listKeys);
        autoGrow(ta);
        if (focus) setTimeout(() => { if (!cur.title && !cur.body.trim() && !cur.quick) s.$('[data-title]').focus(); else { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } }, 60);
      } else {
        const has = isList(cur.body);
        area.innerHTML = `<div class="md nview" data-md>${md(cur.body) || '<p class="faint">Leeg – tik op het potlood om te schrijven.</p>'}</div>
          ${has ? `<div class="addrow" style="margin-top:6px">${icon('plus', 'sm')}<input data-additem placeholder="Item toevoegen" enterkeyhint="done"></div>` : ''}`;
        const ai = $('[data-additem]', area);
        if (ai) ai.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter' || e.isComposing) return; e.preventDefault(); const v = ai.value.trim(); if (!v) return;
          cur.body = `${cur.body.replace(/\s+$/, '')}\n- [ ] ${v}`; save(); drawArea(); setTimeout(() => $('[data-additem]', area)?.focus(), 30);
        });
      }
    }
    const autoGrow = (ta) => { ta.style.height = 'auto'; ta.style.height = `${Math.max(isMobile() ? 260 : 340, ta.scrollHeight + 4)}px`; };
    // Enter in een lijstje = volgend puntje
    function listKeys(e) {
      if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
      const ta = e.target; const pos = ta.selectionStart; const line = ta.value.slice(0, pos).split('\n').pop();
      const m = line.match(/^(\s*)([-*] \[[ xX]\] |[-*] |(\d+)[.)] )(.*)$/); if (!m) return;
      e.preventDefault();
      if (!m[4].trim()) ta.setRangeText('', pos - line.length, pos, 'end');
      else { const next = m[3] ? `${Number(m[3]) + 1}${m[2].slice(m[3].length)}` : m[2].replace(/\[[xX]\]/, '[ ]'); ta.setRangeText(`\n${m[1]}${next}`, pos, pos, 'end'); }
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
    // opmaakknoppen
    function format(kind) {
      const ta = $('[data-body]', area); if (!ta) return;
      const a = ta.selectionStart, b = ta.selectionEnd, v = ta.value;
      if (kind === 'b') { const sel = v.slice(a, b) || 'vet'; ta.setRangeText(`**${sel}**`, a, b, 'select'); }
      else {
        const ls = v.lastIndexOf('\n', a - 1) + 1; let le = v.indexOf('\n', b); if (le < 0) le = v.length;
        const lines = v.slice(ls, le).split('\n');
        const pre = { h: '## ', ul: '- ', chk: '- [ ] ', ol: '1. ' }[kind];
        const strip = (l) => l.replace(/^(#+\s+|[-*] \[[ xX]\] |[-*] |\d+[.)] )/, '');
        const allHave = lines.every((l) => l.startsWith(pre.trim() === '1.' ? '1' : pre) || (kind === 'ol' && /^\d+[.)] /.test(l)));
        const out = lines.map((l, i) => (allHave ? strip(l) : `${kind === 'ol' ? `${i + 1}. ` : pre}${strip(l)}`)).join('\n');
        ta.setRangeText(out, ls, le, 'end');
      }
      ta.focus(); ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
    s.$('[data-tb]').addEventListener('click', (e) => {
      const m = e.target.closest('[data-mode]'); if (m) { mode = m.dataset.mode; drawArea(mode === 'edit'); return; }
      const f = e.target.closest('[data-fmt]'); if (f) { e.preventDefault(); format(f.dataset.fmt); }
    });
    // afvinken in de weergave
    area.addEventListener('click', (e) => {
      const chk = e.target.closest('.md li.chk[data-line]');
      if (chk) {
        const lines = cur.body.split('\n'); const i = Number(chk.dataset.line);
        lines[i] = lines[i].replace(/\[( |x|X)\]/, (m0, c) => (c === ' ' ? '[x]' : '[ ]')); cur.body = lines.join('\n');
        chk.classList.toggle('on'); $('.cb', chk).classList.toggle('on'); save(); if (navigator.vibrate) navigator.vibrate(8); return;
      }
      if (mode === 'view' && !e.target.closest('a, input, .addrow') && !isList(cur.body)) { mode = 'edit'; drawArea(true); }
    });
    s.$('[data-title]').addEventListener('input', (e) => { cur.title = e.target.value; setState('Typen…'); save(); });
    s.$('[data-title]').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing) return; e.preventDefault();
      if (mode !== 'edit') { mode = 'edit'; drawArea(false); }
      const ta = $('[data-body]', area); if (ta) { ta.focus(); ta.setSelectionRange(0, 0); }
    });
    pinBtn.onclick = async () => { cur.pinned = !cur.pinned; paintPin(); await put({ pinned: cur.pinned }); toast(cur.pinned ? 'Vastgepind' : 'Losgemaakt', { icon: 'pinned' }); };
    s.$('[data-color]').onclick = (e) => menu(e.currentTarget, COLORS.map(([k, l]) => ({ label: `${k === cur.color ? '✓ ' : ''}${l}`, onClick: async () => { cur.color = k; ned.className = `ned ${k ? `c-${k}` : ''}`; await put({ color: k }); } })));
    const fsel = s.$('[data-folder]'); if (fsel) fsel.onchange = async () => { cur.folder = fsel.value; await put({ folder: cur.folder }); };
    s.$('[data-more]').onclick = (e) => menu(e.currentTarget, [
      { label: 'Tekst kopiëren', icon: 'copy', onClick: () => copyText(`${cur.title ? `${cur.title}\n\n` : ''}${cur.body}`) },
      { label: 'Naar je klembord (Delen)', icon: 'clip', onClick: async () => { try { await api('POST', '/api/clipboard', { text: `${cur.title ? `${cur.title}\n` : ''}${cur.body}` }); toast('Op je gedeeld klembord gezet', { icon: 'clip' }); } catch (x) { fail(x); } } },
      ...(isList(cur.body) ? [{ label: 'Afgevinkte items wissen', icon: 'tick', onClick: () => { cur.body = cur.body.split('\n').filter((l) => !/^\s*[-*] \[[xX]\]/.test(l)).join('\n'); save(); drawArea(); } }, { label: 'Alles terug afvinken', icon: 'undo', onClick: () => { cur.body = cur.body.replace(/^(\s*[-*] )\[[xX]\]/gm, '$1[ ]'); save(); drawArea(); } }] : []),
      { label: 'Downloaden (.md)', icon: 'download', onClick: () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([`${cur.title ? `# ${cur.title}\n\n` : ''}${cur.body}`], { type: 'text/markdown' })); a.download = `${(cur.title || 'notitie').replace(/[^\w\- ]+/g, '').slice(0, 60) || 'notitie'}.md`; a.click(); } },
      ...(cur.quick ? [] : ['-', { label: 'Verwijderen', icon: 'trash', danger: true, onClick: async () => {
        const copy = { ...cur }; deleted = true;
        try { await api('DELETE', `/api/notes/${cur.id}`); s.close(); toast('Notitie verwijderd', { action: 'Ongedaan', onAction: async () => { try { await api('POST', '/api/notes', { title: copy.title, body: copy.body, folder: copy.folder, color: copy.color, pinned: copy.pinned }); load(); } catch (x) { fail(x); } } }); } catch (x) { fail(x); }
      } }]),
    ]);
    let deleted = false;
    async function put(f) { try { await api('PUT', `/api/notes/${cur.id}`, { ...f, clientId: CLIENT }); setState('Bewaard'); } catch (e) { setState('Niet bewaard!'); fail(e); } }
    const save = debounce(() => put({ title: cur.title, body: cur.body }), 600);
    async function flush(closing) {
      if (deleted) return;
      // lege notitie die je sluit: weggooien
      if (closing && !cur.quick && !String(cur.title || '').trim() && !String(cur.body || '').replace(/^\s*[-*] \[ \]\s*$/gm, '').trim()) { try { await api('DELETE', `/api/notes/${cur.id}`); } catch { /* */ } return; }
      await put({ title: cur.title, body: cur.body });
    }
    drawArea(mode === 'edit');
    return s;
  }

  // ---------------------------------------------------------------- mappen beheren
  function editFolders() {
    const s = sheet({ title: 'Mappen', sub: 'Hernoemen of verwijderen. Notities in een verwijderde map blijven bestaan.', body: '<div class="grp" data-fl></div><div class="addrow" style="margin-top:4px">' + icon('plus', 'sm') + '<input data-fnew placeholder="Nieuwe map" enterkeyhint="done"></div>', foot: '<button class="btn pri" data-close>Klaar</button>', onClose: load });
    const drawF = () => {
      s.$('[data-fl]').innerHTML = data.folders.length ? data.folders.map((f) => `<div class="rw" data-fname="${esc(f)}">${icon('folder')}<span class="grow">${esc(f)}</span><button class="btn ghost icon sm" data-fren aria-label="Hernoemen">${icon('edit', 'sm')}</button><button class="btn ghost icon sm" data-fdel aria-label="Verwijderen">${icon('trash', 'sm')}</button></div>`).join('') : '<div class="rw faint">Nog geen mappen</div>';
      s.$$('[data-fren]').forEach((b) => { b.onclick = async () => { const from = b.closest('[data-fname]').dataset.fname; const to = await prompt('Map hernoemen', { value: from }); if (!to || to === from) return; try { data.folders = await api('POST', '/api/notes-folders/rename', { from, to }); if (folder === from) folder = to; drawF(); } catch (e) { fail(e); } }; });
      s.$$('[data-fdel]').forEach((b) => { b.onclick = async () => { const from = b.closest('[data-fname]').dataset.fname; if (!(await confirmSheet(`De map "${esc(from)}" verwijderen? De notities erin blijven bestaan (zonder map).`, { ok: 'Verwijderen', danger: true }))) return; try { data.folders = await api('POST', '/api/notes-folders/rename', { from, to: '' }); if (folder === from) folder = ''; drawF(); } catch (e) { fail(e); } }; });
    };
    drawF();
    s.$('[data-fnew]').addEventListener('keydown', async (e) => { if (e.key !== 'Enter') return; e.preventDefault(); const v = e.target.value.trim(); if (!v) return; try { data.folders = await api('PUT', '/api/notes-folders', { folders: [...data.folders, v] }); e.target.value = ''; drawF(); } catch (x) { fail(x); } });
  }

  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-newlist]')) { openEditor(null, { list: true }); return; }
    if (e.target.closest('[data-new]')) { openEditor(null); return; }
    const f = e.target.closest('[data-f]'); if (f) { folder = f.dataset.f; draw(); return; }
    if (e.target.closest('[data-folders-edit]')) { editFolders(); return; }
    const c = e.target.closest('.ncard[data-id]'); if (c) openEditor(c.dataset.id, { view: true });
  });
  root.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('.ncard')) openEditor(e.target.dataset.id, { view: true }); });
  $('[data-q]', root).addEventListener('input', debounce((e) => { q = e.target.value.trim().toLowerCase(); draw(); }, 150));

  await load();
  if (ctx.params[0] && data.notes.some((n) => n.id === ctx.params[0])) openEditor(ctx.params[0], { view: true });
  if (ctx.query.nieuw) openEditor(null);
  const unsubs = [
    Live.on('notes', debounce((d) => { if (d && d.from === CLIENT) return; if (!document.querySelector('dialog[open] .nsheet')) load(); }, 400)),
    bus.on('changed', (k) => { if (k === 'note') load(); }),
  ];
  return { cleanup: () => { unsubs.forEach((u) => u()); document.querySelectorAll('dialog[open] .nsheet').forEach((x) => x.closest('dialog').close()); }, update: (r) => { if (r.params[0] && data.notes.some((n) => n.id === r.params[0])) openEditor(r.params[0], { view: true }); return true; } };
}
