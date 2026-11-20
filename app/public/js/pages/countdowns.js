/* Aftellen: dagen tot je examen, vakantie, verjaardag… Vastgezette staan bovenaan je dashboard. */
import { $, esc, icon, api, toast, fail, sheet, confirmSheet, sod, parseYmd, dayLabel, longDate, ymd, addDays, debounce, emptyState } from '../core.js';
import * as Live from '../live.js';

const daysTo = (c) => Math.round((parseYmd(c.date) - sod()) / 864e5);

export default async function countdowns(root, ctx) {
  let list = [];
  root.innerHTML = `
    <div class="top"><a class="iconbtn back" href="#/meer" aria-label="Terug">${icon('left')}</a><div class="grow"><h1>Aftellen</h1><p>Hoeveel dagen nog tot…</p></div>
      <div class="actions"><button class="btn pri" data-add>${icon('plus', 'sm')}Nieuw</button></div></div>
    <div data-list></div>`;
  ctx.setFab(() => edit(null));

  async function load() { try { list = await api('GET', '/api/countdowns'); } catch (e) { fail(e); return; } draw(); }
  function draw() {
    const up = list.filter((c) => daysTo(c) >= 0); const past = list.filter((c) => daysTo(c) < 0).reverse();
    const card = (c) => {
      const d = daysTo(c); const wk = Math.floor(d / 7);
      return `<div class="card cd-card ${d < 0 ? 'past' : ''}" data-id="${esc(c.id)}" style="cursor:pointer">
        <div class="row" style="align-items:flex-start"><div class="cd" style="box-shadow:none;border:0;padding:0;background:transparent"><div class="n" style="min-width:64px;height:64px;font-size:26px;border-radius:18px;${d < 0 ? 'background:var(--card2);color:var(--muted)' : ''}">${d === 0 ? '!' : Math.abs(d)}${d ? `<small>${Math.abs(d) === 1 ? 'dag' : 'dagen'}</small>` : ''}</div></div>
          <div class="grow" style="padding-top:4px"><b style="font-size:16px;display:block">${esc(c.title)}</b><span class="muted small">${esc(longDate(parseYmd(c.date)).replace(/^./, (x) => x.toUpperCase()))}${c.time ? ` · ${esc(c.time)}` : ''}</span>
            <div class="small faint" style="margin-top:4px">${d === 0 ? 'Vandaag!' : d < 0 ? `${-d} dagen geleden` : d === 1 ? 'Morgen al!' : wk >= 2 ? `± ${wk} weken${d % 7 ? ` en ${d % 7} ${d % 7 === 1 ? 'dag' : 'dagen'}` : ''}` : dayLabel(parseYmd(c.date))}</div></div>
          ${d >= 0 ? `<button class="btn ghost icon sm" data-pin title="${c.pinned !== false ? 'Staat op je dashboard' : 'Niet op dashboard'}" style="${c.pinned !== false ? 'color:var(--p2)' : 'color:var(--faint)'}">${icon('pinned', 'sm')}</button>` : ''}</div></div>`;
    };
    $('[data-list]', root).innerHTML = (up.length ? `<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr))">${up.map(card).join('')}</div>` : `<div class="card">${emptyState('flag', 'Niets om af te tellen', 'Voeg een datum toe om naar af te tellen.', '<button class="btn pri sm" data-add>Toevoegen</button>')}</div>`)
      + (past.length ? `<div class="sec-title">Voorbij</div><div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr));opacity:.7">${past.slice(0, 12).map(card).join('')}</div>` : '');
  }
  root.addEventListener('click', async (e) => {
    if (e.target.closest('[data-add]')) { edit(null); return; }
    const cardEl = e.target.closest('[data-id]'); if (!cardEl) return;
    const c = list.find((x) => x.id === cardEl.dataset.id); if (!c) return;
    if (e.target.closest('[data-pin]')) { try { await api('PUT', `/api/countdowns/${c.id}`, { pinned: c.pinned === false }); toast(c.pinned === false ? 'Staat nu op je dashboard' : 'Niet meer op je dashboard'); load(); } catch (x) { fail(x); } return; }
    edit(c);
  });
  function edit(c) {
    const s = sheet({ title: c ? 'Aftellen bewerken' : 'Nieuw aftellen', body: `
      <label class="field"><span>Waarnaar tel je af?</span><input data-t value="${esc(c ? c.title : '')}" autofocus></label>
      <label class="field"><span>Datum</span><input type="date" data-d value="${c ? c.date : ymd(addDays(Date.now(), 30))}"></label>
      <label class="check"><input type="checkbox" data-p ${!c || c.pinned !== false ? 'checked' : ''}> Tonen op mijn dashboard</label><p class="error" data-err></p>`,
    foot: `${c ? `<button class="btn ghost danger left" data-del>${icon('trash', 'sm')}</button>` : ''}<button class="btn" data-close>Annuleren</button><button class="btn pri" data-ok>${c ? 'Bewaar' : 'Toevoegen'}</button>` });
    const go = async () => {
      const body = { title: s.$('[data-t]').value.trim() || 'Aftellen', date: s.$('[data-d]').value, pinned: s.$('[data-p]').checked };
      try { if (c) await api('PUT', `/api/countdowns/${c.id}`, body); else await api('POST', '/api/countdowns', body); s.close(); load(); } catch (e) { s.$('[data-err]').textContent = e.message; }
    };
    s.$('[data-ok]').onclick = go;
    s.$('[data-t]').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); go(); } });
    const del = s.$('[data-del]'); if (del) del.onclick = async () => { if (!(await confirmSheet(`"${esc(c.title)}" verwijderen?`, { ok: 'Verwijderen', danger: true }))) return; try { await api('DELETE', `/api/countdowns/${c.id}`); s.close(); load(); } catch (e) { fail(e); } };
  }
  await load();
  if (ctx.query.nieuw) edit(null);
  const un = Live.on('countdowns', debounce(load, 200));
  return () => un();
}
