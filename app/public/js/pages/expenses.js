/* Uitgaven: budget per maand, per categorie, grafiek van 6 maanden, vaste uitgaven die elke maand vanzelf komen. */
import { $, $$, esc, icon, api, toast, fail, sheet, confirmSheet, menu, euro, ymd, parseYmd, dayLabel, debounce, emptyState, T, bus } from '../core.js';
import * as Live from '../live.js';

const CAT_IC = { 'Eten & drinken': 'bag', Boodschappen: 'bag', Uitgaan: 'star', Vervoer: 'rocket', Abonnementen: 'repeat', Kleding: 'tag', School: 'note', Cadeaus: 'star', Overig: 'euro' };
const catIcon = (c) => CAT_IC[c] || 'tag';
const curMonth = () => new Date().toISOString().slice(0, 7);
const monthName = (m) => { const [y, mo] = m.split('-').map(Number); return `${T.MONTHS[mo - 1]} ${y}`; };
const shiftMonth = (m, n) => { const [y, mo] = m.split('-').map(Number); const d = new Date(y, mo - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const toEuro = (c) => (c / 100).toFixed(2).replace('.', ',');

export default async function expenses(root, ctx) {
  let month = /^\d{4}-\d{2}$/.test(ctx.query.maand || '') ? ctx.query.maand : curMonth();
  let data = null; let catFilter = '';
  root.innerHTML = `
    <div class="top"><div class="grow"><h1>Uitgaven</h1><p data-sub>&nbsp;</p></div>
      <div class="actions"><div class="seg desk-only" style="align-items:center"><button data-mon="-1" aria-label="Vorige maand">${icon('left', 'sm')}</button><button data-mon="0" data-mname style="min-width:130px"></button><button data-mon="1" aria-label="Volgende maand">${icon('right', 'sm')}</button></div>
      <button class="btn pri" data-add>${icon('plus', 'sm')}Uitgave</button><button class="iconbtn keep" data-menu aria-label="Meer">${icon('more')}</button></div></div>
    <div class="seg block m-only" data-mseg style="margin-bottom:14px"><button data-mon="-1">${icon('left', 'sm')}</button><button data-mon="0" data-mname2 style="flex:3"></button><button data-mon="1">${icon('right', 'sm')}</button></div>
    <div class="grid dash-row2" style="margin-top:0">
      <div class="col" style="gap:16px">
        <div class="money-hero" data-hero></div>
        <div class="card"><h3>${icon('tag')}Per categorie</h3><div data-cats style="margin-top:6px"></div></div>
        <div class="card"><h3>${icon('repeat')}Vaste uitgaven<span class="more" data-addrec>${icon('plus', 'xs')}Toevoegen</span></h3><p class="sub">Komen elke maand vanzelf in je lijst.</p><div data-rec style="margin-top:6px"></div></div>
      </div>
      <div class="col" style="gap:16px">
        <div class="card"><h3>${icon('activity')}Laatste 6 maanden</h3><div class="bars" data-bars></div></div>
        <div class="card"><h3>${icon('list')}<span data-ltitle>Alle uitgaven</span><span class="more" data-clearcat></span></h3><div data-list style="margin-top:4px"></div></div>
      </div>
    </div>`;
  ctx.setFab(() => editExpense(null));

  async function load() {
    try { data = await api('GET', `/api/expenses?month=${month}`); } catch (e) { fail(e); return; }
    draw();
  }
  function draw() {
    const d = data; const isCur = month === curMonth();
    for (const el of $$('[data-mname], [data-mname2]', root)) el.textContent = monthName(month).replace(/^./, (c) => c.toUpperCase());
    $('[data-sub]', root).textContent = `${d.list.length} ${d.list.length === 1 ? 'uitgave' : 'uitgaven'} in ${monthName(month)}`;
    // hero
    const pct = d.budget ? (d.total / d.budget) * 100 : 0;
    const left = d.budget - d.total;
    const [y, m] = month.split('-').map(Number); const days = new Date(y, m, 0).getDate();
    const dayLeft = isCur ? days - new Date().getDate() + 1 : 0;
    $('[data-hero]', root).innerHTML = `<small>${isCur ? 'Uitgegeven deze maand' : `Uitgegeven in ${monthName(month)}`}</small>
      <div class="amt">${euro(d.total)}${d.budget ? ` <span>/ ${euro(d.budget, 0)}</span>` : ''}</div>
      ${d.budget ? `<div class="hb ${pct > 100 ? 'over' : ''}"><i style="width:${Math.min(100, pct)}%"></i></div>
      <div class="ft"><span>${left >= 0 ? `Nog ${euro(left)} over` : `${euro(-left)} over budget`}</span><span>${isCur && left > 0 && dayLeft ? `± ${euro(left / dayLeft)} per dag` : `${Math.round(pct)}%`}</span></div>` : '<div class="ft"><span class="link" data-setbudget style="color:#fff">Stel een maandbudget in</span></div>'}`;
    // categorieën
    const cats = Object.entries(d.byCat).sort((a, b) => b[1] - a[1]);
    const max = cats.length ? cats[0][1] : 1;
    $('[data-cats]', root).innerHTML = cats.length ? cats.map(([c, v], i) => `<div class="ct" data-cat="${esc(c)}" style="cursor:pointer;${catFilter && catFilter !== c ? 'opacity:.45' : ''}"><div class="ib ${i % 2 ? 's' : ''}">${icon(catIcon(c), 'sm')}</div><b>${esc(c)}</b><span class="v">${euro(v)}</span><div class="meter ${i % 2 ? 's' : ''}"><span style="width:${(v / max) * 100}%"></span></div></div>`).join('')
      : '<p class="muted small" style="padding:8px 0">Nog niets deze maand.</p>';
    // balkjes
    const mmax = Math.max(1, ...d.months.map((x) => x.total), d.budget || 0);
    $('[data-bars]', root).innerHTML = d.months.map((x) => `<div class="bc ${x.month === month ? 'on' : ''}" data-goto="${x.month}" title="${euro(x.total)}"><small class="num" style="color:var(--text)">${x.total ? `€${Math.round(x.total / 100)}` : ''}</small><i style="height:${Math.max(3, (x.total / mmax) * 100)}%"></i><small>${T.MON[Number(x.month.slice(5)) - 1]}</small></div>`).join('');
    // lijst
    const list = d.list.filter((e) => !catFilter || e.category === catFilter);
    $('[data-ltitle]', root).textContent = catFilter || 'Alle uitgaven';
    $('[data-clearcat]', root).innerHTML = catFilter ? `${icon('x', 'xs')}Alles tonen` : '';
    let lastDay = ''; let html = '';
    for (const e of list) {
      if (e.date !== lastDay) { html += `<div class="sec-title" style="margin:14px 2px 4px">${esc(dayLabel(parseYmd(e.date), true))}</div>`; lastDay = e.date; }
      html += `<div class="li click" data-id="${esc(e.id)}"><div class="ib sm ${['Abonnementen', 'Vervoer', 'Kleding'].includes(e.category) ? 's' : ''}">${icon(catIcon(e.category), 'sm')}</div><div class="grow ellipsis"><b class="ellipsis">${esc(e.description || e.category)}</b><small>${esc(e.category)}${e.recurringId ? ' · vast' : ''}</small></div><div class="end"><b class="num" style="color:var(--text)">${euro(e.amount)}</b></div></div>`;
    }
    $('[data-list]', root).innerHTML = html || emptyState('euro', 'Geen uitgaven', `Tik op + of typ bv. "€12,50 broodjes" in snel toevoegen.`);
    // vaste
    $('[data-rec]', root).innerHTML = d.recurring.length ? d.recurring.map((r) => `<div class="li"><div class="ib sm s">${icon('repeat', 'sm')}</div><div class="grow ellipsis"><b>${esc(r.description || r.category)}</b><small>Elke ${r.day}e van de maand · ${esc(r.category)}</small></div><div class="end"><b class="num" style="color:var(--text)">${euro(r.amount)}</b><button class="btn ghost icon sm" data-delrec="${esc(r.id)}" aria-label="Verwijderen">${icon('trash', 'sm')}</button></div></div>`).join('')
      : '<p class="muted small" style="padding:6px 0">Bv. Spotify, gsm-abonnement, De Lijn.</p>';
  }
  function setMonth(m) { month = m; catFilter = ''; history.replaceState(null, '', `#/uitgaven?maand=${m}`); load(); }

  root.addEventListener('click', async (e) => {
    const mb = e.target.closest('[data-mon]'); if (mb) { const n = Number(mb.dataset.mon); setMonth(n === 0 ? curMonth() : shiftMonth(month, n)); return; }
    const g = e.target.closest('[data-goto]'); if (g) { setMonth(g.dataset.goto); return; }
    const c = e.target.closest('[data-cat]'); if (c) { catFilter = catFilter === c.dataset.cat ? '' : c.dataset.cat; draw(); return; }
    if (e.target.closest('[data-clearcat]')) { catFilter = ''; draw(); return; }
    if (e.target.closest('[data-add]')) { editExpense(null); return; }
    if (e.target.closest('[data-addrec]')) { editRecurring(); return; }
    if (e.target.closest('[data-setbudget]')) { setBudget(); return; }
    const dr = e.target.closest('[data-delrec]');
    if (dr) { if (!(await confirmSheet('Deze vaste uitgave stoppen? Wat al in je lijst staat blijft staan.', { ok: 'Stoppen', danger: true }))) return; try { await api('DELETE', `/api/expenses/recurring/${dr.dataset.delrec}`); load(); } catch (x) { fail(x); } return; }
    const li = e.target.closest('[data-id]'); if (li) { const x = data.list.find((y) => y.id === li.dataset.id); if (x) editExpense(x); }
  });
  $('[data-menu]', root).onclick = (e) => menu(e.currentTarget, [
    { label: 'Maandbudget instellen', icon: 'sliders', onClick: setBudget },
    { label: 'Vaste uitgave toevoegen', icon: 'repeat', onClick: editRecurring },
    { label: 'Categorieën aanpassen', icon: 'tag', onClick: editCats },
    { label: 'Exporteren (.csv)', icon: 'download', onClick: exportCsv },
  ]);
  async function setBudget() {
    const s = sheet({ title: 'Maandbudget', sub: 'Hoeveel wil je max. per maand uitgeven?', body: `<div class="affix"><span>€</span><input class="amount-input" inputmode="decimal" data-v value="${data.budget ? toEuro(data.budget).replace(/,00$/, '') : ''}" placeholder="450" autofocus style="font-size:26px!important;text-align:left"></div><p class="hint faint small" style="margin-top:8px">Laat leeg (of 0) om geen budget te gebruiken.</p>`, foot: '<button class="btn" data-close>Annuleren</button><button class="btn pri" data-ok>Bewaar</button>' });
    s.$('[data-ok]').onclick = async () => { const v = parseFloat(s.$('[data-v]').value.replace(/\./g, '').replace(',', '.')) || 0; try { await api('PUT', '/api/settings', { budget: Math.round(v * 100) }); s.close(); load(); } catch (x) { fail(x); } };
  }
  async function editCats() {
    const s = sheet({ title: 'Categorieën', body: `<label class="field"><span>Eén per lijn</span><textarea data-v style="min-height:220px">${esc((data.categories || []).join('\n'))}</textarea></label>`, foot: '<button class="btn" data-close>Annuleren</button><button class="btn pri" data-ok>Bewaar</button>' });
    s.$('[data-ok]').onclick = async () => { try { await api('PUT', '/api/settings', { expenseCategories: s.$('[data-v]').value.split('\n') }); s.close(); load(); } catch (x) { fail(x); } };
  }
  function exportCsv() {
    const rows = [['Datum', 'Bedrag', 'Categorie', 'Omschrijving'], ...data.list.map((e) => [e.date, toEuro(e.amount), e.category, e.description || ''])];
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv' })); a.download = `uitgaven-${month}.csv`; a.click();
  }

  function editExpense(x) {
    const isNew = !x; const cats = data ? data.categories : ['Overig'];
    let cat = x ? x.category : '';
    const s = sheet({
      title: isNew ? 'Nieuwe uitgave' : 'Uitgave',
      body: `<div class="affix" style="border:0;background:transparent;justify-content:center"><span style="background:transparent;font-size:30px;font-weight:700;padding:0">€</span><input class="amount-input" data-amt inputmode="decimal" placeholder="0,00" value="${x ? toEuro(x.amount) : ''}" style="max-width:220px" ${isNew ? 'autofocus' : ''}></div>
        <label class="field"><span>Waaraan?</span><input data-desc placeholder="bv. broodjes, Spotify, trein" value="${esc(x ? x.description : '')}"></label>
        <div class="field"><span>Categorie <small class="faint" data-auto></small></span><div class="chips" data-cats>${cats.map((c) => `<button type="button" class="chip ${c === cat ? 'on' : ''}" data-c="${esc(c)}">${icon(catIcon(c), 'xs')}${esc(c)}</button>`).join('')}</div></div>
        <label class="field"><span>Datum</span><input type="date" data-date value="${x ? x.date : (month === curMonth() ? ymd(Date.now()) : `${month}-01`)}"></label>
        ${isNew ? `<label class="check"><input type="checkbox" data-rec> Elke maand terugkerend (vaste uitgave)</label>` : ''}
        <p class="error" data-err></p>`,
      foot: `${isNew ? '' : `<button class="btn ghost danger left" data-del>${icon('trash', 'sm')}</button>`}<button class="btn" data-close>Annuleren</button><button class="btn pri" data-ok>${isNew ? 'Toevoegen' : 'Bewaar'}</button>`,
    });
    let manual = !!cat;
    const pick = (c, man) => { cat = c; if (man) manual = true; s.$$('[data-c]').forEach((b) => b.classList.toggle('on', b.dataset.c === c)); };
    s.$$('[data-c]').forEach((b) => { b.onclick = () => pick(b.dataset.c, true); });
    // categorie raden uit de omschrijving
    s.$('[data-desc]').addEventListener('input', debounce(async (e) => {
      if (manual || !e.target.value.trim()) return;
      try { const p = await api('POST', '/api/quick/parse', { text: `€1 ${e.target.value}` }); if (p.category && cats.includes(p.category)) { pick(p.category); s.$('[data-auto]').textContent = '· automatisch gekozen'; } } catch { /* */ }
    }, 250));
    const go = async () => {
      const err = s.$('[data-err]'); err.textContent = '';
      const amt = s.$('[data-amt]').value.trim().replace(/[€\s]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.');
      if (!(Number(amt) > 0)) { err.textContent = 'Typ een bedrag'; s.$('[data-amt]').focus(); return; }
      const body = { amount: Number(amt), description: s.$('[data-desc]').value.trim(), category: cat || 'Overig', date: s.$('[data-date]').value };
      try {
        if (isNew && s.$('[data-rec]').checked) await api('POST', '/api/expenses/recurring', { ...body, day: Number(body.date.slice(8, 10)) || 1 });
        else if (isNew) await api('POST', '/api/expenses', body);
        else await api('PUT', `/api/expenses/${x.id}`, body);
        s.close(); toast(isNew ? `${euro(Math.round(Number(amt) * 100))} toegevoegd` : 'Opgeslagen', { icon: 'tick' }); load();
      } catch (e) { err.textContent = e.message; }
    };
    s.$('[data-ok]').onclick = go;
    s.$('[data-amt]').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); s.$('[data-desc]').focus(); } });
    s.$('[data-desc]').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); go(); } });
    const del = s.$('[data-del]'); if (del) del.onclick = async () => { try { await api('DELETE', `/api/expenses/${x.id}`); s.close(); toast('Verwijderd', { action: 'Ongedaan', onAction: async () => { await api('POST', '/api/expenses', { amount: x.amount / 100, description: x.description, category: x.category, date: x.date }); load(); } }); load(); } catch (e) { fail(e); } };
  }
  function editRecurring() {
    const cats = data ? data.categories : ['Abonnementen'];
    const s = sheet({ title: 'Vaste uitgave', sub: 'Wordt elke maand automatisch toegevoegd.', body: `
      <label class="field"><span>Wat?</span><input data-desc placeholder="bv. Spotify" autofocus></label>
      <div class="row"><label class="field grow"><span>Bedrag</span><div class="affix"><span>€</span><input data-amt inputmode="decimal" placeholder="11,99"></div></label><label class="field" style="width:120px"><span>Dag van de maand</span><input type="number" data-day min="1" max="28" value="${new Date().getDate() > 28 ? 28 : new Date().getDate()}"></label></div>
      <label class="field"><span>Categorie</span><select data-cat>${cats.map((c) => `<option ${c === 'Abonnementen' ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label><p class="error" data-err></p>`,
    foot: '<button class="btn" data-close>Annuleren</button><button class="btn pri" data-ok>Toevoegen</button>' });
    s.$('[data-ok]').onclick = async () => {
      const amt = Number(s.$('[data-amt]').value.replace(',', '.'));
      if (!(amt > 0)) { s.$('[data-err]').textContent = 'Typ een bedrag'; return; }
      try { await api('POST', '/api/expenses/recurring', { amount: amt, description: s.$('[data-desc]').value.trim(), category: s.$('[data-cat]').value, day: Number(s.$('[data-day]').value) }); s.close(); load(); } catch (e) { s.$('[data-err]').textContent = e.message; }
    };
  }

  await load();
  if (ctx.query.nieuw) editExpense(null);
  const unsubs = [Live.on('expenses', debounce(load, 300)), Live.on('settings', debounce(load, 300)), bus.on('changed', (k) => { if (k === 'expense') load(); })];
  return { cleanup: () => unsubs.forEach((u) => u()), update: (r) => { if (r.query.nieuw) { editExpense(null); return true; } return false; } };
}
