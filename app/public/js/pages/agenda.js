/* Agenda: dag, 3 dagen, week, maand, jaar en lijst. Slepen om te verplaatsen, onderkant slepen om langer te maken. */
import { $, $$, h, esc, icon, api, toast, fail, sheet, choose, confirmSheet, menu, hm, ymd, sod, sow, addDays, sameDay, parseYmd, dayLabel, longDate, evColors, hexA, isMobile, IS_TOUCH, debounce, md, ls, pad, T, bus } from '../core.js';
import * as Live from '../live.js';

let CALS = []; let SYNC = null; let SETTINGS = null;
const VIEWS = [['day', 'Dag'], ['3day', '3 dagen'], ['week', 'Week'], ['month', 'Maand'], ['year', 'Jaar'], ['list', 'Lijst']];
const ALARMS = [[0, 'Op het moment zelf'], [5, '5 min vooraf'], [10, '10 min vooraf'], [15, '15 min vooraf'], [30, '30 min vooraf'], [60, '1 uur vooraf'], [120, '2 uur vooraf'], [1440, '1 dag vooraf'], [2880, '2 dagen vooraf'], [10080, '1 week vooraf']];
const ALARMS_ALLDAY = [[-540, 'Op de dag zelf om 9:00'], [900, 'De dag ervoor om 9:00'], [-480, 'Op de dag zelf om 8:00'], [2340, '2 dagen ervoor om 9:00'], [9540, '1 week ervoor om 9:00']];
const COLORS = ['', '#6366F1', '#818CF8', '#4F46E5', '#38BDF8', '#0EA5E9', '#7DD3FC', '#312E81'];
export const alarmLabel = (m, allDay) => ((allDay ? ALARMS_ALLDAY : ALARMS).find((a) => a[0] === m) || [m, m < 0 ? `${-m} min erna` : m % 1440 === 0 ? `${m / 1440} dag(en) vooraf` : m % 60 === 0 ? `${m / 60} uur vooraf` : `${m} min vooraf`])[1];

async function loadCals(force) {
  if (CALS.length && !force) return CALS;
  const r = await api('GET', '/api/agenda/calendars'); CALS = r.calendars; SYNC = r.sync; return CALS;
}
async function loadSettings() { if (!SETTINGS) { try { SETTINGS = await api('GET', '/api/settings'); } catch { SETTINGS = {}; } } return SETTINGS; }
bus.on('settings', (s) => { SETTINGS = s; });

export default async function agenda(root, ctx) {
  await Promise.all([loadCals(true), loadSettings()]);
  const mob = isMobile();
  let view = ctx.params[0] && VIEWS.some((v) => v[0] === ctx.params[0]) ? ctx.params[0] : ls.get('agendaView', mob ? 'day' : (SETTINGS.agendaView || 'week'));
  let anchor = ctx.params[1] ? parseYmd(ctx.params[1]) : sod();
  let events = []; let range = [0, 0];
  const hh = mob ? 54 : 48; // hoogte van één uur
  root.innerHTML = `
    <div class="cal-toolbar">
      <button class="btn" data-today>Vandaag</button>
      <button class="iconbtn" data-prev aria-label="Vorige">${icon('left')}</button><button class="iconbtn" data-next aria-label="Volgende">${icon('right')}</button>
      <h1 data-title></h1>
      <div class="grow"></div>
      <div class="seg" data-views>${VIEWS.map(([k, l]) => `<button data-v="${k}">${l}</button>`).join('')}</div>
      <button class="iconbtn" data-search aria-label="Zoeken">${icon('search')}</button>
      <button class="btn pri" data-new>${icon('plus', 'sm')}Afspraak</button>
    </div>
    <div class="m-cal-top" style="display:none;flex-direction:column;gap:10px;margin:-2px 0 12px">
      <div class="row"><h1 data-mtitle style="font-size:22px;font-weight:700;letter-spacing:-.02em;cursor:pointer"></h1><div class="grow"></div>
        <button class="iconbtn" data-today2 aria-label="Vandaag">${icon('cal')}</button><button class="iconbtn" data-search2 aria-label="Zoeken">${icon('search')}</button><button class="iconbtn" data-cals aria-label="Agenda's">${icon('layout')}</button></div>
      <div class="chips scroll" data-mviews>${VIEWS.map(([k, l]) => `<button class="chip" data-v="${k}">${l}</button>`).join('')}</div>
      <div data-strip></div>
    </div>
    <div class="cal-wrap">
      <div class="cal-side col" style="gap:16px">
        <div class="card mini" data-mini></div>
        <div class="card cals-list" data-cals-list></div>
      </div>
      <div data-view style="min-width:0"></div>
    </div>`;
  const viewEl = $('[data-view]', root);

  // ---------------------------------------------------------------- navigatie
  function setView(v) { view = v; ls.set('agendaView', v); history.replaceState(null, '', `#/agenda/${view}/${ymd(anchor)}`); render(); }
  function shift(dir) {
    const n = { day: 1, '3day': 3, week: 7, list: 14 }[view];
    if (n) anchor = addDays(anchor, dir * n);
    else if (view === 'month') { const d = new Date(anchor); d.setMonth(d.getMonth() + dir, 1); anchor = d.getTime(); }
    else if (view === 'year') { const d = new Date(anchor); d.setFullYear(d.getFullYear() + dir); anchor = d.getTime(); }
    history.replaceState(null, '', `#/agenda/${view}/${ymd(anchor)}`); render();
  }
  $('[data-today]', root).onclick = () => { anchor = sod(); render(); };
  $('[data-today2]', root).onclick = () => { anchor = sod(); render(); };
  $('[data-prev]', root).onclick = () => shift(-1);
  $('[data-next]', root).onclick = () => shift(1);
  $$('[data-v]', root).forEach((b) => { b.onclick = () => setView(b.dataset.v); });
  $('[data-new]', root).onclick = () => newEvent();
  $('[data-search]', root).onclick = search; $('[data-search2]', root).onclick = search;
  $('[data-cals]', root).onclick = calsSheet;
  $('[data-mtitle]', root).onclick = () => setView(view === 'month' ? 'day' : 'month');
  ctx.setFab(() => newEvent());
  const onKey = (e) => {
    if (document.querySelector('dialog[open]') || /input|textarea|select/i.test(document.activeElement.tagName)) return;
    if (e.key === 'ArrowLeft') shift(-1); else if (e.key === 'ArrowRight') shift(1); else if (e.key === 't') { anchor = sod(); render(); }
    else if (e.key === 'n') newEvent(); else { const v = { d: 'day', w: 'week', m: 'month', j: 'year', l: 'list' }[e.key]; if (v) setView(v); }
  };
  addEventListener('keydown', onKey);
  // vegen op de gsm: links/rechts = vorige/volgende
  let sx = null, sy = null;
  viewEl.addEventListener('touchstart', (e) => { if (e.touches.length === 1) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; } }, { passive: true });
  viewEl.addEventListener('touchend', (e) => { if (sx == null || dragState) return; const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy; sx = null; if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.8) shift(dx < 0 ? 1 : -1); }, { passive: true });

  function rangeFor() {
    if (view === 'day') return [anchor, addDays(anchor, 1)];
    if (view === '3day') return [anchor, addDays(anchor, 3)];
    if (view === 'week') { const s = sow(anchor); return [s, addDays(s, 7)]; }
    if (view === 'month') { const d = new Date(anchor); d.setDate(1); const s = sow(d.getTime()); return [s, addDays(s, 42)]; }
    if (view === 'year') { const y = new Date(anchor).getFullYear(); return [new Date(y, 0, 1).getTime(), new Date(y + 1, 0, 1).getTime()]; }
    return [anchor, addDays(anchor, 60)];
  }
  async function fetchEvents(force) {
    const r = rangeFor();
    // de minikalender toont stipjes voor de hele maand
    const d = new Date(anchor); d.setDate(1); const ms = sow(d.getTime()); const me = addDays(ms, 42);
    const want = [Math.min(r[0], ms), Math.max(r[1], me)];
    if (!force && want[0] >= range[0] && want[1] <= range[1]) return;
    try { events = await api('GET', `/api/agenda/events?from=${want[0]}&to=${want[1]}`); range = want; } catch (e) { fail(e); }
  }
  async function render(force) {
    await fetchEvents(force);
    const titleTxt = title();
    $('[data-title]', root).textContent = titleTxt; $('[data-mtitle]', root).innerHTML = `${esc(titleTxt)} ${icon('down', 'sm')}`;
    $$('[data-v]', root).forEach((b) => b.classList.toggle('on', b.dataset.v === view));
    renderMini(); renderCals(); renderStrip();
    const [from, to] = rangeFor();
    const inRange = events.filter((o) => o.end > from && o.start < to);
    if (view === 'month') renderMonth(from, inRange);
    else if (view === 'year') renderYear();
    else if (view === 'list') renderList(from, to, inRange);
    else if (view === 'day' && mob) renderDayList(from, inRange);
    else renderGrid(from, view === 'day' ? 1 : view === '3day' ? 3 : 7, inRange);
  }
  function title() {
    const d = new Date(anchor);
    if (view === 'day') return mob ? `${T.MONTHS[d.getMonth()].replace(/^./, (c) => c.toUpperCase())}` : longDate(anchor).replace(/^./, (c) => c.toUpperCase());
    if (view === 'month' || (mob && view !== 'year')) return `${T.MONTHS[d.getMonth()].replace(/^./, (c) => c.toUpperCase())} ${d.getFullYear() !== new Date().getFullYear() ? d.getFullYear() : ''}`.trim();
    if (view === 'year') return String(d.getFullYear());
    const [a, b] = rangeFor(); const e = addDays(b, -1);
    const da = new Date(a), de = new Date(e);
    return da.getMonth() === de.getMonth() ? `${da.getDate()} – ${de.getDate()} ${T.MONTHS[de.getMonth()]} ${de.getFullYear()}` : `${da.getDate()} ${T.MON[da.getMonth()]} – ${de.getDate()} ${T.MON[de.getMonth()]} ${de.getFullYear()}`;
  }

  // ---------------------------------------------------------------- zijkant: minikalender + agenda's
  let miniMonth = null;
  function renderMini() {
    const el = $('[data-mini]', root); if (!el || mob) return;
    const base = new Date(miniMonth ?? anchor); base.setDate(1);
    const start = sow(base.getTime()); const sel = rangeFor();
    const has = new Set(events.map((o) => ymd(o.start)));
    let g = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'].map((x) => `<b>${x}</b>`).join('');
    for (let i = 0; i < 42; i++) {
      const t = addDays(start, i); const d = new Date(t);
      g += `<button class="${d.getMonth() !== base.getMonth() ? 'o' : ''} ${t >= sel[0] && t < sel[1] && view !== 'month' && view !== 'year' ? 'sel' : ''} ${sameDay(t, Date.now()) ? 'td' : ''} ${has.has(ymd(t)) ? 'hv' : ''}" data-d="${ymd(t)}">${d.getDate()}</button>`;
    }
    el.innerHTML = `<div class="mh"><span>${T.MONTHS[base.getMonth()].replace(/^./, (c) => c.toUpperCase())} ${base.getFullYear()}</span><span class="row" style="gap:2px"><button class="btn ghost icon sm" data-mp>${icon('left', 'sm')}</button><button class="btn ghost icon sm" data-mn>${icon('right', 'sm')}</button></span></div><div class="mg">${g}</div>`;
    $('[data-mp]', el).onclick = () => { const d = new Date(base); d.setMonth(d.getMonth() - 1); miniMonth = d.getTime(); renderMini(); };
    $('[data-mn]', el).onclick = () => { const d = new Date(base); d.setMonth(d.getMonth() + 1); miniMonth = d.getTime(); renderMini(); };
    $$('[data-d]', el).forEach((b) => { b.onclick = () => { anchor = parseYmd(b.dataset.d); miniMonth = null; if (view === 'month' || view === 'year') view = 'day'; render(); }; });
  }
  function calsHtml() {
    const dav = CALS.filter((c) => c.kind === 'dav' && c.events), tl = CALS.filter((c) => c.kind === 'dav' && c.todos && !c.events), virt = CALS.filter((c) => c.kind !== 'dav');
    const row = (c) => `<div class="cl" data-cal="${esc(c.id)}"><span class="k ${c.hidden ? '' : 'on'}" style="--c:${c.color}">${icon('tick')}</span><span class="grow ellipsis">${esc(c.name)}</span>${c.shareToken ? `<span title="Gedeeld">${icon('share', 'xs')}</span>` : ''}${c.error ? `<span title="${esc(c.error)}" style="color:var(--warn)">${icon('alert', 'xs')}</span>` : ''}</div>`;
    return `<h4>Mijn agenda's</h4>${dav.map(row).join('')}${virt.length ? `<h4>Abonnementen</h4>${virt.map(row).join('')}` : ''}
      <div class="cl" data-addcal style="color:var(--muted)">${icon('plus', 'sm')}Agenda of abonnement toevoegen</div>
      <div class="cl" data-sync style="color:var(--muted)">${icon('refresh', 'sm')}Synchroniseren met je gsm</div>`;
  }
  function bindCals(el, after) {
    $$('[data-cal]', el).forEach((r) => {
      r.onclick = async (e) => {
        const c = CALS.find((x) => x.id === r.dataset.cal); if (!c) return;
        if (e.target.closest('.k') || !e.target.closest('.grow')) { c.hidden = !c.hidden; r.querySelector('.k').classList.toggle('on', !c.hidden); try { await api('PATCH', `/api/agenda/calendars/${encodeURIComponent(c.id)}`, { hidden: c.hidden }); } catch (x) { fail(x); } range = [0, 0]; render(); return; }
        calendarSettings(c, async () => { await loadCals(true); range = [0, 0]; render(); after && after(); });
      };
    });
    $('[data-addcal]', el).onclick = () => addCalendar(async () => { await loadCals(true); range = [0, 0]; render(); after && after(); });
    $('[data-sync]', el).onclick = () => { location.hash = '#/instellingen/agenda'; };
  }
  function renderCals() { const el = $('[data-cals-list]', root); if (!el || mob) return; el.innerHTML = calsHtml(); bindCals(el); }
  function calsSheet() { const s = sheet({ title: "Agenda's", body: `<div class="cals-list">${calsHtml()}</div>` }); bindCals(s.body, () => { s.body.innerHTML = `<div class="cals-list">${calsHtml()}</div>`; bindCals(s.body); }); }

  // ---------------------------------------------------------------- gsm: weekbalk
  function renderStrip() {
    const el = $('[data-strip]', root); if (!mob || !el) return;
    if (!['day', '3day'].includes(view)) { el.innerHTML = ''; return; }
    const s = sow(anchor); let html = `<div class="strip"><button class="btn ghost icon sm" data-sp>${icon('left', 'sm')}</button>`;
    for (let i = 0; i < 7; i++) {
      const t = addDays(s, i); const list = events.filter((o) => o.start < addDays(t, 1) && o.end > t).slice(0, 3);
      html += `<div class="sd ${sameDay(t, anchor) ? 'sel' : ''} ${sameDay(t, Date.now()) ? 'td' : ''}" data-d="${ymd(t)}">${T.DSH[new Date(t).getDay()]}<b>${new Date(t).getDate()}</b><div class="dd">${list.map((o) => `<i style="--c:${o.color}"></i>`).join('')}</div></div>`;
    }
    el.innerHTML = `${html}<button class="btn ghost icon sm" data-sn>${icon('right', 'sm')}</button></div>`;
    $$('[data-d]', el).forEach((b) => { b.onclick = () => { anchor = parseYmd(b.dataset.d); render(); }; });
    $('[data-sp]', el).onclick = () => { anchor = addDays(anchor, -7); render(); };
    $('[data-sn]', el).onclick = () => { anchor = addDays(anchor, 7); render(); };
  }

  // ---------------------------------------------------------------- dag (gsm): kaartjes onder elkaar
  function renderDayList(from, list) {
    const now = Date.now(); const ad = list.filter((o) => o.allDay), timed = list.filter((o) => !o.allDay);
    let html = `<div class="agl"><div class="dh ${sameDay(from, now) ? 'td' : ''}">${esc(dayLabel(from, true))}</div>`;
    html += ad.map((o) => `<div class="ad" style="${evColors(o.color)};margin-bottom:8px;padding:9px 12px;border-radius:12px;font-size:13px" data-key="${esc(o.key)}">${esc(o.title)}</div>`).join('');
    let line = !sameDay(from, now);
    for (const o of timed) {
      if (!line && o.start > now) { html += `<div class="nowline" style="margin:4px 2px 10px">NU ${hm(now)}</div>`; line = true; }
      html += mev(o, now);
    }
    if (!line && timed.length) html += `<div class="nowline" style="margin:4px 2px 10px">NU ${hm(now)}</div>`;
    if (!list.length) html += `<div class="empty"><div class="ei">${icon('cal')}</div><b>Niets gepland</b><div class="small">Tik op + om iets toe te voegen.</div></div>`;
    html += '</div>';
    viewEl.innerHTML = html;
    viewEl.onclick = clickEvent;
  }
  function mev(o, now) {
    const past = o.end < now, cur = o.start <= now && o.end > now;
    return `<div class="mev ${past ? 'past' : ''} ${cur ? 'now' : ''}" style="${evColors(o.color)}" data-key="${esc(o.key)}"><div class="tt">${o.allDay ? 'hele<small>dag</small>' : `${hm(o.start)}<small>${hm(o.end)}</small>`}</div><div class="vb"></div><div class="grow" style="min-width:0"><b class="ellipsis">${esc(o.title)}</b><div class="sub">${o.location ? `<span>${icon('pin')}${esc(o.location)}</span>` : ''}${o.recurring ? `<span>${icon('repeat')}</span>` : ''}${o.bring && o.bring.length ? `<span>${icon('bag')}${o.bring.length}</span>` : ''}${o.alarms && o.alarms.length ? `<span>${icon('bell')}</span>` : ''}<span>${esc(o.calName)}</span></div></div></div>`;
  }
  function clickEvent(e) {
    const r = e.target.closest('[data-key]'); if (!r) return;
    const o = events.find((x) => x.key === r.dataset.key); if (o) openEvent(o, { onChange: () => render(true) });
  }

  // ---------------------------------------------------------------- lijst
  function renderList(from, to, list) {
    const now = Date.now(); let html = '<div class="agl">'; let any = false;
    for (let t = from; t < to; t = addDays(t, 1)) {
      const day = list.filter((o) => o.start < addDays(t, 1) && o.end > t && (o.allDay ? true : sameDay(o.start, t) || o.start < t));
      if (!day.length) continue; any = true;
      html += `<div class="dh ${sameDay(t, now) ? 'td' : ''}">${esc(dayLabel(t, true))}</div>${day.map((o) => mev(o, now)).join('')}`;
    }
    if (!any) html += `<div class="empty"><div class="ei">${icon('cal')}</div><b>Niets gepland de komende 2 maanden</b></div>`;
    html += `<div style="text-align:center;margin:14px 0"><button class="btn" data-more>Volgende 2 weken</button></div></div>`;
    viewEl.innerHTML = html; viewEl.onclick = clickEvent;
    $('[data-more]', viewEl).onclick = (ev) => { ev.stopPropagation(); shift(1); };
  }

  // ---------------------------------------------------------------- maand
  function renderMonth(from, list) {
    const cur = new Date(anchor).getMonth(); const now = Date.now();
    let html = `<div class="card pad0"><div class="month">${['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'].map((d) => `<div class="dh">${d}</div>`).join('')}`;
    const max = mob ? 3 : 4;
    for (let i = 0; i < 42; i++) {
      const t = addDays(from, i), te = addDays(t, 1);
      const day = list.filter((o) => o.start < te && o.end > t).sort((a, b) => b.allDay - a.allDay || a.start - b.start);
      html += `<div class="dc ${new Date(t).getMonth() !== cur ? 'o' : ''} ${sameDay(t, now) ? 'td' : ''}" data-d="${ymd(t)}"><span class="n">${new Date(t).getDate()}</span>
        ${day.slice(0, max).map((o) => (o.allDay ? `<div class="me ad" style="${evColors(o.color)}" data-key="${esc(o.key)}">${esc(o.title)}</div>` : `<div class="me" style="${evColors(o.color)}" data-key="${esc(o.key)}"><i></i>${mob ? '' : `<span class="faint">${hm(o.start)}</span> `}${esc(o.title)}</div>`)).join('')}
        ${day.length > max ? `<span class="more">+${day.length - max}</span>` : ''}</div>`;
    }
    viewEl.innerHTML = `${html}</div></div>`;
    viewEl.onclick = (e) => {
      const ev = e.target.closest('[data-key]'); if (ev && !mob) return clickEvent(e);
      const c = e.target.closest('[data-d]'); if (!c) return;
      anchor = parseYmd(c.dataset.d); setView('day');
    };
    viewEl.ondblclick = (e) => { const c = e.target.closest('[data-d]'); if (c && !e.target.closest('[data-key]')) newEvent({ start: `${c.dataset.d}T09:00` }); };
  }
  // ---------------------------------------------------------------- jaar
  function renderYear() {
    const y = new Date(anchor).getFullYear(); const count = {};
    for (const o of events) { for (let t = sod(o.start); t < o.end; t = addDays(t, 1)) { const k = ymd(t); count[k] = (count[k] || 0) + 1; if (o.allDay === false) break; } }
    let html = '<div class="card"><div class="year">';
    for (let m = 0; m < 12; m++) {
      const first = new Date(y, m, 1); const s = sow(first.getTime());
      let g = ['m', 'd', 'w', 'd', 'v', 'z', 'z'].map((x) => `<b>${x}</b>`).join('');
      for (let i = 0; i < 42; i++) { const t = addDays(s, i); const d = new Date(t); const n = count[ymd(t)] || 0; g += d.getMonth() !== m ? '<button class="o" disabled></button>' : `<button class="${sameDay(t, Date.now()) ? 'td' : n >= 3 ? 'h3' : n === 2 ? 'h2' : n === 1 ? 'h1' : ''}" data-d="${ymd(t)}">${d.getDate()}</button>`; }
      html += `<div class="ym"><h4 data-m="${m}">${T.MONTHS[m].replace(/^./, (c) => c.toUpperCase())}</h4><div class="mg">${g}</div></div>`;
    }
    viewEl.innerHTML = `${html}</div></div>`;
    viewEl.onclick = (e) => {
      const d = e.target.closest('[data-d]'); if (d) { anchor = parseYmd(d.dataset.d); setView('day'); return; }
      const m = e.target.closest('[data-m]'); if (m) { anchor = new Date(y, Number(m.dataset.m), 1).getTime(); setView('month'); }
    };
  }

  // ---------------------------------------------------------------- tijdraster (dag/3 dagen/week)
  let dragState = null;
  function renderGrid(from, n, list) {
    const days = Array.from({ length: n }, (_, i) => addDays(from, i));
    const cols = `56px repeat(${n}, minmax(0, 1fr))`;
    const now = Date.now();
    let head = '<div></div>' + days.map((t) => `<div class="d ${sameDay(t, now) ? 'td' : ''}" data-d="${ymd(t)}">${T.DSH[new Date(t).getDay()]}<b>${new Date(t).getDate()}</b></div>`).join('');
    let all = '<div class="lbl">hele dag</div>' + days.map((t) => `<div>${list.filter((o) => o.allDay && o.start < addDays(t, 1) && o.end > t).map((o) => `<div class="ad" style="${evColors(o.color)}" data-key="${esc(o.key)}">${esc(o.title)}</div>`).join('')}</div>`).join('');
    let hours = '<div class="tg-hours">' + Array.from({ length: 24 }, (_, i) => `<div>${i ? `${pad(i)}:00` : ''}</div>`).join('') + '</div>';
    let body = hours;
    for (const t of days) {
      const dayEv = list.filter((o) => !o.allDay && o.start < addDays(t, 1) && o.end > t);
      body += `<div class="tg-col ${sameDay(t, now) ? 'td' : ''}" data-col="${ymd(t)}">${Array.from({ length: 24 }, () => '<div class="ln"></div>').join('')}${layoutDay(dayEv, t).map((p) => evBox(p, t)).join('')}${sameDay(t, now) ? `<div class="nowl" style="top:${((now - t) / 3600e3) * hh}px"></div>` : ''}</div>`;
    }
    viewEl.innerHTML = `<div class="card tg" style="--hh:${hh}px"><div class="tg-head" style="grid-template-columns:${cols}">${head}</div><div class="tg-all" style="grid-template-columns:${cols}">${all}</div><div class="tg-scroll" data-scroll><div class="tg-body" style="grid-template-columns:${cols}">${body}</div></div></div>`;
    const sc = $('[data-scroll]', viewEl);
    const firstEv = list.filter((o) => !o.allDay).map((o) => new Date(o.start).getHours()).sort((a, b) => a - b)[0];
    const startH = days.some((t) => sameDay(t, now)) ? Math.max(0, new Date().getHours() - 2) : Math.min(firstEv ?? 7, 7);
    sc.scrollTop = startH * hh;
    $$('.tg-head .d', viewEl).forEach((d) => { d.onclick = () => { anchor = parseYmd(d.dataset.d); setView('day'); }; });
    $('.tg-all', viewEl).onclick = clickEvent;
    bindGrid(sc, days);
  }
  // overlappende afspraken naast elkaar zetten
  function layoutDay(list, dayStart) {
    const items = list.map((o) => ({ o, s: Math.max(o.start, dayStart), e: Math.min(Math.max(o.end, o.start + 20 * 60e3), addDays(dayStart, 1)) })).sort((a, b) => a.s - b.s || b.e - a.e);
    const out = []; let cluster = []; let clusterEnd = 0;
    const flush = () => { const cols = []; for (const it of cluster) { let c = cols.findIndex((end) => end <= it.s); if (c < 0) { c = cols.length; cols.push(0); } cols[c] = it.e; it.col = c; } for (const it of cluster) { it.cols = cols.length; out.push(it); } cluster = []; };
    for (const it of items) { if (cluster.length && it.s >= clusterEnd) flush(); cluster.push(it); clusterEnd = Math.max(clusterEnd, it.e); }
    if (cluster.length) flush();
    return out;
  }
  function evBox(p, dayStart) {
    const o = p.o; const top = ((p.s - dayStart) / 3600e3) * hh; const height = Math.max(18, ((p.e - p.s) / 3600e3) * hh - 2);
    const w = 100 / p.cols; const short = height < 38;
    const cls = `${o.status === 'TENTATIVE' ? 'tentative' : ''} ${o.transp === 'TRANSPARENT' ? 'free' : ''} ${short ? 'short' : ''} ${o.readOnly ? 'ro' : ''}`;
    return `<div class="e ${cls}" data-key="${esc(o.key)}" style="${evColors(o.color)};top:${top}px;height:${height}px;left:calc(${p.col * w}% + 2px);width:calc(${w}% - 4px);right:auto"><b>${esc(o.title)}</b><span>${hm(o.start)}${short ? '' : ` – ${hm(o.end)}`}${o.location && height > 54 ? `<br>${esc(o.location)}` : ''}</span>${o.readOnly ? '' : '<div class="rs"></div>'}</div>`;
  }
  // slepen, langer maken, nieuw maken door te klikken/slepen in een lege plek
  function bindGrid(sc, days) {
    const body = $('.tg-body', sc);
    const snap = (min) => Math.round(min / 15) * 15;
    const yToMin = (y) => Math.max(0, Math.min(24 * 60, snap((y / hh) * 60)));
    const colAt = (x) => { const cs = $$('.tg-col', body); for (const c of cs) { const r = c.getBoundingClientRect(); if (x >= r.left && x < r.right) return c; } return null; };
    const fmtLocal = (dayYmd, min) => { const t = parseYmd(dayYmd) + min * 60e3; const d = new Date(t); return `${ymd(t)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
    const begin = (e, kind, el, x, y) => {
      const col = el ? el.closest('.tg-col') : colAt(x); if (!col) return null;
      const r = col.getBoundingClientRect();
      const o = el ? events.find((z) => z.key === el.dataset.key) : null;
      return { kind, el, o, col, y0: y, x0: x, top0: el ? parseFloat(el.style.top) : y - r.top, h0: el ? parseFloat(el.style.height) : 0, moved: false, startMin: el ? null : yToMin(y - r.top) };
    };
    const moveTo = (st, x, y) => {
      const dy = y - st.y0; const dx = x - st.x0;
      if (!st.moved && Math.hypot(dx, dy) < 5) return; st.moved = true;
      if (st.kind === 'new') {
        const r = st.col.getBoundingClientRect(); const m2 = yToMin(y - r.top); const a = Math.min(st.startMin, m2), b = Math.max(st.startMin + 15, m2);
        if (!st.ghost) { st.ghost = h('<div class="slot-ghost"></div>'); st.col.appendChild(st.ghost); }
        st.ghost.style.top = `${(a / 60) * hh}px`; st.ghost.style.height = `${((b - a) / 60) * hh}px`; st.ghost.textContent = `${pad(Math.floor(a / 60))}:${pad(a % 60)} – ${pad(Math.floor(b / 60))}:${pad(b % 60)}`;
        st.a = a; st.b = b; return;
      }
      st.el.classList.add('dragging');
      if (st.kind === 'resize') { st.el.style.height = `${Math.max(hh / 4, Math.round((st.h0 + dy) / (hh / 4)) * (hh / 4))}px`; return; }
      st.el.style.top = `${Math.max(0, Math.round((st.top0 + dy) / (hh / 4)) * (hh / 4))}px`;
      const c = colAt(x); if (c && c !== st.el.parentElement) { c.appendChild(st.el); }
    };
    const finish = async (st) => {
      if (st.kind === 'new') {
        if (st.ghost) st.ghost.remove();
        const day = st.col.dataset.col;
        const a = st.moved ? st.a : Math.floor(st.startMin / 30) * 30, b = st.moved ? st.b : a + 60;
        newEvent({ start: fmtLocal(day, a), end: fmtLocal(day, b) });
        return;
      }
      if (!st.moved) { openEvent(st.o, { onChange: () => render(true) }); return; }
      const col = st.el.parentElement; const day = col.dataset.col;
      const topMin = Math.round((parseFloat(st.el.style.top) / hh) * 60 / 15) * 15;
      const durMin = Math.round(((parseFloat(st.el.style.height) + 2) / hh) * 60 / 15) * 15;
      const o = st.o;
      const origDur = Math.round((o.end - o.start) / 60000);
      const start = st.kind === 'resize' ? o.startLocal : fmtLocal(day, topMin);
      const end = st.kind === 'resize' ? fmtLocal(ymd(o.start), (new Date(o.start).getHours() * 60 + new Date(o.start).getMinutes()) + Math.max(15, durMin)) : fmtLocal(day, topMin + origDur);
      await moveEvent(o, start, end, () => render(true));
    };
    // muis
    body.onpointerdown = (e) => {
      if (e.pointerType === 'touch' || e.button !== 0) return;
      const el = e.target.closest('.e');
      if (el && el.classList.contains('ro')) { const o = events.find((z) => z.key === el.dataset.key); if (o) openEvent(o); return; }
      const st = begin(e, el ? (e.target.closest('.rs') ? 'resize' : 'move') : 'new', el, e.clientX, e.clientY); if (!st) return;
      e.preventDefault(); dragState = st;
      const mv = (ev) => moveTo(st, ev.clientX, ev.clientY);
      const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); dragState = null; finish(st); };
      addEventListener('pointermove', mv); addEventListener('pointerup', up);
    };
    // aanraken: tikken = openen/nieuw, lang drukken = slepen
    if (IS_TOUCH) {
      let tState = null, timer = null;
      body.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) return;
        const t = e.touches[0]; const el = e.target.closest('.e');
        tState = { x: t.clientX, y: t.clientY, el, moved: false, armed: false };
        if (el && !el.classList.contains('ro')) timer = setTimeout(() => { tState.armed = true; tState.st = begin(e, e.target.closest('.rs') ? 'resize' : 'move', el, t.clientX, t.clientY); dragState = tState.st; if (navigator.vibrate) navigator.vibrate(15); el.classList.add('dragging'); }, 380);
      }, { passive: true });
      body.addEventListener('touchmove', (e) => {
        if (!tState) return; const t = e.touches[0];
        if (tState.armed) { e.preventDefault(); moveTo(tState.st, t.clientX, t.clientY); return; }
        if (Math.hypot(t.clientX - tState.x, t.clientY - tState.y) > 8) { tState.moved = true; clearTimeout(timer); }
      }, { passive: false });
      body.addEventListener('touchend', (e) => {
        clearTimeout(timer); const s = tState; tState = null; if (!s) return;
        if (s.armed) { dragState = null; s.el.classList.remove('dragging'); if (s.st.moved) finish(s.st); return; }
        if (s.moved) return;
        e.preventDefault();
        if (s.el) { const o = events.find((z) => z.key === s.el.dataset.key); if (o) openEvent(o, { onChange: () => render(true) }); return; }
        const col = colAt(s.x); if (!col) return; const r = col.getBoundingClientRect(); const min = Math.floor(yToMin(s.y - r.top) / 30) * 30;
        newEvent({ start: fmtLocal(col.dataset.col, min), end: fmtLocal(col.dataset.col, min + 60) });
      });
    }
  }

  // ---------------------------------------------------------------- nieuwe afspraak / zoeken
  function newEvent(def = {}) {
    let start = def.start; let end = def.end;
    if (!start) { const d = new Date(); const base = sameDay(anchor, Date.now()) ? Date.now() : anchor + 9 * 3600e3; const t = new Date(base); t.setMinutes(0, 0, 0); if (sameDay(anchor, Date.now())) t.setHours(t.getHours() + 1); start = `${ymd(t)}T${pad(t.getHours())}:00`; void d; }
    if (!end) { const t = new Date(start); t.setHours(t.getHours() + 1); end = `${ymd(t)}T${pad(t.getHours())}:${pad(t.getMinutes())}`; }
    editEvent(null, { start, end, ...def }, () => render(true));
  }
  function search() {
    const s = sheet({ title: 'Zoeken in je agenda', body: `<input type="search" placeholder="Titel, locatie, notitie…" data-q autofocus><div data-res style="margin-top:12px"></div>` });
    const run = debounce(async () => {
      const q = s.$('[data-q]').value.trim(); const res = s.$('[data-res]');
      if (q.length < 2) { res.innerHTML = ''; return; }
      try { const l = await api('GET', `/api/agenda/search?q=${encodeURIComponent(q)}`); res.innerHTML = l.length ? `<div class="agl">${l.map((o) => `<div class="small faint" style="margin:8px 2px 4px">${esc(dayLabel(o.start, true))}</div>${mev(o, Date.now())}`).join('')}</div>` : '<p class="muted small">Niets gevonden.</p>'; res.onclick = (e) => { const r = e.target.closest('[data-key]'); if (!r) return; const o = l.find((x) => x.key === r.dataset.key); s.close(); if (o) { anchor = sod(o.start); render(); openEvent(o, { onChange: () => render(true) }); } }; } catch (e) { fail(e); }
    }, 250);
    s.$('[data-q]').addEventListener('input', run);
  }

  const unsub = Live.on('agenda', debounce(async () => { await loadCals(true); range = [0, 0]; render(true); }, 400));
  const unsub2 = bus.on('changed', () => { range = [0, 0]; render(true); });
  if (ctx.query.nieuw) setTimeout(() => newEvent(), 200);
  await render();
  return {
    cleanup: () => { unsub(); unsub2(); removeEventListener('keydown', onKey); },
    update: (r) => { if (r.params[0] && VIEWS.some((v) => v[0] === r.params[0])) view = r.params[0]; if (r.params[1]) anchor = parseYmd(r.params[1]); render(); return true; },
  };
}

// ======================================================================= afspraak bekijken
export async function openEvent(o, { onChange } = {}) {
  await loadCals();
  const cal = CALS.find((c) => c.id === o.cal);
  const when = o.allDay ? (o.end - o.start > 864e5 ? `${dayLabel(o.start, true)} – ${dayLabel(o.end - 1, true)}` : `${dayLabel(o.start, true)} · hele dag`) : `${dayLabel(o.start, true)} · ${hm(o.start)} – ${hm(o.end)}`;
  let details = null;
  const body = h(`<div>
    <div class="row" style="gap:12px;align-items:flex-start;margin-bottom:14px"><span style="width:6px;align-self:stretch;border-radius:4px;background:${o.color}"></span>
      <div class="grow"><div style="font-size:20px;font-weight:700;letter-spacing:-.02em">${esc(o.title)}</div><div class="muted" style="margin-top:2px">${esc(when)}</div>
      <div class="muted small" style="margin-top:2px">${esc(cal ? cal.name : o.calName || '')}${o.recurring ? ` · ${icon('repeat', 'xs')} <span data-rep>herhaalt</span>` : ''}${o.status === 'TENTATIVE' ? ' · onder voorbehoud' : o.status === 'CANCELLED' ? ' · geannuleerd' : ''}</div></div></div>
    <div class="grp" data-info></div>
    <div data-bring></div>
    <div data-notes></div>
  </div>`);
  const info = [];
  if (o.location) info.push(`<div class="rw">${icon('pin')}<span class="grow">${esc(o.location)}</span><a class="btn sm" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(o.location)}">Kaart</a></div>`);
  if (o.travel) info.push(`<div class="rw">${icon('bolt')}<span class="grow">${o.travel} min reistijd</span><span class="v">vertrek ${hm(o.start - o.travel * 60e3)}</span></div>`);
  if (o.alarms && o.alarms.length) info.push(`<div class="rw">${icon('bell')}<span class="grow">${o.alarms.map((a) => esc(alarmLabel(a.min, o.allDay))).join(', ')}</span></div>`);
  if (o.attendees && o.attendees.length) info.push(`<div class="rw">${icon('users')}<span class="grow">${esc(o.attendees.join(', '))}</span></div>`);
  if (o.url) info.push(`<div class="rw">${icon('link')}<a class="grow ellipsis" href="${esc(o.url)}" target="_blank" rel="noopener">${esc(o.url)}</a></div>`);
  if (o.categories && o.categories.length) info.push(`<div class="rw">${icon('tag')}<span class="grow">${o.categories.map((c) => `<span class="tag" style="margin-right:4px">${esc(c)}</span>`).join('')}</span></div>`);
  $('[data-info]', body).innerHTML = info.join(''); if (!info.length) $('[data-info]', body).remove();
  if (o.bring && o.bring.length) $('[data-bring]', body).innerHTML = `<div class="sec-title">Meenemen</div><div class="chips">${o.bring.map((b) => `<span class="chip">${icon('bag', 'xs')}${esc(b)}</span>`).join('')}</div>`;
  if (o.description) $('[data-notes]', body).innerHTML = `<div class="sec-title">Notities</div><div class="md card flat" style="padding:12px 14px">${md(o.description)}</div>`;
  const s = sheet({ title: '', body, size: '', foot: o.readOnly ? '<button class="btn" data-close>Sluiten</button>' : `<button class="btn ghost danger left" data-del>${icon('trash', 'sm')}Verwijderen</button><button class="btn" data-dup>${icon('copy', 'sm')}Kopie</button><button class="btn pri" data-edit>${icon('edit', 'sm')}Bewerken</button>` });
  if (o.readOnly) return;
  const getDetails = async () => (details = details || await api('GET', `/api/agenda/event/${encodeURIComponent(o.cal)}/${encodeURIComponent(o.href)}?uid=${encodeURIComponent(o.uid)}`));
  if (o.recurring) getDetails().then((d) => { const r = s.$('[data-rep]'); if (r && d.repeat) r.textContent = d.repeat.text; }).catch(() => {});
  s.$('[data-edit]').onclick = async () => { try { const d = await getDetails(); s.close(); editEvent(o, d, onChange); } catch (e) { fail(e); } };
  s.$('[data-dup]').onclick = async () => { try { const d = await getDetails(); s.close(); editEvent(null, { ...d, start: o.startLocal, end: o.endLocal, repeat: null, title: d.title, cal: o.cal, uid: undefined }, onChange); } catch (e) { fail(e); } };
  s.$('[data-del]').onclick = async () => {
    let scope = 'all';
    if (o.recurring) { scope = await choose('Herhalende afspraak verwijderen', [{ label: 'Alleen deze keer', value: 'this' }, { label: 'Deze en alle volgende', value: 'future' }, { label: 'Alle keren', value: 'all', danger: true }]); if (!scope) return; }
    else if (!(await confirmSheet(`"${esc(o.title)}" verwijderen?`, { ok: 'Verwijderen', danger: true }))) return;
    try {
      await api('DELETE', `/api/agenda/event/${encodeURIComponent(o.cal)}/${encodeURIComponent(o.href)}?uid=${encodeURIComponent(o.uid)}&scope=${scope}${o.recurrenceId ? `&recurrenceId=${encodeURIComponent(o.recurrenceId)}` : ''}`);
      s.close(); toast('Verwijderd'); onChange && onChange(); bus.emit('changed', 'event');
    } catch (e) { fail(e); }
  };
}
async function moveEvent(o, start, end, after) {
  try {
    let scope = 'all';
    if (o.recurring) { scope = await choose('Herhalende afspraak verplaatsen', [{ label: 'Alleen deze keer', value: 'this' }, { label: 'Deze en alle volgende', value: 'future' }, { label: 'Alle keren', value: 'all' }]); if (!scope) { after(); return; } }
    const d = await api('GET', `/api/agenda/event/${encodeURIComponent(o.cal)}/${encodeURIComponent(o.href)}?uid=${encodeURIComponent(o.uid)}`);
    await api('PUT', `/api/agenda/event/${encodeURIComponent(o.cal)}/${encodeURIComponent(o.href)}`, { ...d, uid: o.uid, start, end, allDay: false, scope, recurrenceId: o.recurrenceId, repeat: scope === 'this' ? undefined : d.repeat });
    toast(`Verplaatst naar ${dayLabel(new Date(start).getTime())} ${start.slice(11)}`, { icon: 'tick' });
  } catch (e) { fail(e); }
  after();
}

// ======================================================================= afspraak maken / bewerken
export async function editEvent(o, d, onChange) {
  await Promise.all([loadCals(), loadSettings()]);
  const isNew = !o;
  const cals = CALS.filter((c) => c.kind === 'dav' && c.events);
  const st = { ...d };
  st.cal = st.cal || (o && o.cal) || SETTINGS.defaultCal || (cals[0] && cals[0].id);
  st.alarms = st.alarms || (isNew && (SETTINGS.defaultAlarm ?? 15) >= 0 ? [{ min: SETTINGS.defaultAlarm ?? 15 }] : []);
  st.bring = st.bring || []; st.categories = st.categories || []; st.attendees = st.attendees || [];
  st.allDay = !!st.allDay;
  st.repeat = st.repeat || null;
  if (o && !d.startLocal) { st.start = o.startLocal; st.end = o.endLocal; }
  if (o) { st.start = o.startLocal; st.end = o.endLocal; } // bewerken vanuit een voorkomen: dat voorkomen
  if (st.allDay && st.end) { const e = parseYmd(st.end); st.endIncl = ymd(addDays(e, -1)); } // in het scherm: t/m-datum
  const templates = (SETTINGS.shiftTemplates || []);
  const dt = (s) => String(s || '').slice(0, 10), tm = (s) => String(s || '').slice(11, 16) || '09:00';
  const body = h(`<form class="no-autofocus" autocomplete="off">
    <input class="ev-title" name="title" placeholder="Titel" value="${esc(st.title || '')}" ${isNew && !st.title ? 'autofocus' : ''} enterkeyhint="next">
    ${templates.length ? `<div class="chips scroll" style="margin:0 0 14px">${templates.map((t, i) => `<button type="button" class="chip" data-tpl="${i}">${esc(t.name)} <b style="color:var(--text);font-weight:650">${esc(t.start.replace(/:00$/, ''))}–${esc(t.end.replace(/:00$/, ''))}</b></button>`).join('')}</div>` : ''}
    <div class="grp">
      <div class="rw">${icon('clock')}Hele dag<button type="button" class="tog ${st.allDay ? 'on' : ''}" data-allday style="margin-left:auto"></button></div>
      <div class="rw" style="padding-left:44px">Begin<div class="v"><input type="date" name="sd" value="${dt(st.start)}" required><input type="time" name="stime" value="${tm(st.start)}" step="300" ${st.allDay ? 'hidden' : ''}></div></div>
      <div class="rw" style="padding-left:44px">Einde<div class="v"><input type="date" name="ed" value="${st.allDay ? (st.endIncl || dt(st.start)) : dt(st.end || st.start)}"><input type="time" name="etime" value="${tm(st.end)}" step="300" ${st.allDay ? 'hidden' : ''}></div></div>
      <div class="rw click" data-repeat>${icon('repeat')}Herhalen<div class="v"><b data-reptxt style="font-weight:600;color:var(--text)"></b>${icon('right', 'sm')}</div></div>
    </div>
    <div class="grp">
      <div class="rw">${icon('cal')}Agenda<div class="v"><select name="cal">${cals.map((c) => `<option value="${esc(c.id)}" ${c.id === st.cal ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div></div>
      <div class="rw">${icon('pin')}<input class="bare grow" name="location" placeholder="Locatie" value="${esc(st.location || '')}"></div>
      <div class="rw">${icon('bolt')}Reistijd<div class="v"><select name="travel">${[0, 5, 10, 15, 20, 30, 45, 60, 90, 120].map((m) => `<option value="${m}" ${Number(st.travel || 0) === m ? 'selected' : ''}>${m ? `${m} min` : 'Geen'}</option>`).join('')}</select></div></div>
      <div class="rw">${icon('bell')}<span>Herinneringen</span><div class="rem" data-alarms style="margin-left:auto"></div></div>
    </div>
    <div class="sec-title">Meenemen</div>
    <div class="grp"><div class="rw" style="flex-wrap:wrap;gap:8px" data-bring></div><div class="rw">${icon('plus')}<input class="bare grow" data-bringin placeholder="Iets toevoegen" enterkeyhint="done"></div></div>
    <details class="more" ${st.categories.length || st.url || st.attendees.length || st.description || st.transp === 'TRANSPARENT' || (st.status && st.status !== 'CONFIRMED') || st.color ? 'open' : ''}><summary>Meer opties</summary>
      <div class="grp" style="margin-top:8px">
        <div class="rw">${icon('eye')}Weergeven als<div class="v"><select name="transp"><option value="OPAQUE">Bezet</option><option value="TRANSPARENT" ${st.transp === 'TRANSPARENT' ? 'selected' : ''}>Vrij</option></select></div></div>
        <div class="rw">${icon('flag')}Status<div class="v"><select name="status"><option value="CONFIRMED">Bevestigd</option><option value="TENTATIVE" ${st.status === 'TENTATIVE' ? 'selected' : ''}>Onder voorbehoud</option><option value="CANCELLED" ${st.status === 'CANCELLED' ? 'selected' : ''}>Geannuleerd</option></select></div></div>
        <div class="rw">${icon('tag')}<input class="bare grow" name="categories" placeholder="Labels, met komma's" value="${esc(st.categories.join(', '))}"></div>
        <div class="rw">${icon('users')}<input class="bare grow" name="attendees" placeholder="Met wie (namen, met komma's)" value="${esc(st.attendees.join(', '))}"></div>
        <div class="rw">${icon('link')}<input class="bare grow" name="url" type="url" placeholder="Link" value="${esc(st.url || '')}"></div>
        <div class="rw" style="flex-wrap:wrap">Kleur<div class="color-dots" style="margin-left:auto">${COLORS.map((c) => `<button type="button" class="${(st.color || '') === c ? 'on' : ''}" data-color="${c}" style="--c:${c || 'var(--line2)'}" title="${c ? c : 'Kleur van de agenda'}">${c ? '' : ''}</button>`).join('')}</div></div>
      </div>
    </details>
    <div class="sec-title">Notities</div>
    <textarea name="description" placeholder="Notities">${esc(st.description || '')}</textarea>
    <p class="error" data-err></p>
  </form>`);
  const f = body;
  let color = st.color || '';
  const calBring = () => { const c = CALS.find((x) => x.id === f.cal.value); return c ? c.bring || [] : []; };
  function drawBring() {
    const cb = calBring();
    $('[data-bring]', f).innerHTML = [...cb.map((b) => `<span class="chip" title="Vast bij deze agenda" style="opacity:.75">${icon('bag', 'xs')}${esc(b)}<small class="faint">vast</small></span>`), ...st.bring.map((b, i) => `<span class="chip on" data-rb="${i}">${esc(b)} ${icon('x', 'xs')}</span>`)].join('') || '<span class="faint small">Nog niets</span>';
    $$('[data-rb]', f).forEach((c) => { c.onclick = () => { st.bring.splice(Number(c.dataset.rb), 1); drawBring(); }; });
  }
  function drawAlarms() {
    const el = $('[data-alarms]', f);
    el.innerHTML = st.alarms.map((a, i) => `<span data-ra="${i}">${esc(alarmLabel(a.min, st.allDay).replace(' vooraf', ''))} ${icon('x')}</span>`).join('') + `<span data-addalarm style="background:var(--card2);color:var(--muted)">${icon('plus')}</span>`;
    $$('[data-ra]', el).forEach((c) => { c.onclick = () => { st.alarms.splice(Number(c.dataset.ra), 1); drawAlarms(); }; });
    $('[data-addalarm]', el).onclick = async () => {
      const opts = (st.allDay ? ALARMS_ALLDAY : ALARMS).filter((a) => !st.alarms.some((x) => x.min === a[0])).map((a) => ({ label: a[1], value: a[0] }));
      const v = await choose('Herinnering toevoegen', opts); if (v == null) return; st.alarms.push({ min: v }); st.alarms.sort((a, b) => a.min - b.min); drawAlarms();
    };
  }
  const repText = () => { $('[data-reptxt]', f).textContent = st.repeat ? (st.repeat.text || repeatText(st.repeat)) : 'Nooit'; };
  drawBring(); drawAlarms(); repText();
  f.cal.onchange = drawBring;
  $('[data-bringin]', f).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); const v = e.target.value.trim(); if (v) { st.bring.push(v); e.target.value = ''; drawBring(); } } });
  $('[data-allday]', f).onclick = (e) => {
    st.allDay = !st.allDay; e.currentTarget.classList.toggle('on', st.allDay);
    f.stime.hidden = st.allDay; f.etime.hidden = st.allDay;
    st.alarms = st.allDay ? [{ min: 900 }] : (SETTINGS.defaultAlarm ?? 15) >= 0 ? [{ min: SETTINGS.defaultAlarm ?? 15 }] : []; drawAlarms();
  };
  // begin verschuift het einde mee
  let lastStart = `${f.sd.value}T${f.stime.value}`;
  const syncEnd = () => {
    const now = `${f.sd.value}T${f.stime.value}`; const a = new Date(lastStart).getTime(), b = new Date(now).getTime();
    if (Number.isFinite(a) && Number.isFinite(b) && f.ed.value) { const e = new Date(`${f.ed.value}T${f.etime.value || '00:00'}`).getTime() + (b - a); const ed = new Date(e); f.ed.value = ymd(e); f.etime.value = `${pad(ed.getHours())}:${pad(ed.getMinutes())}`; }
    lastStart = now;
  };
  f.sd.addEventListener('change', syncEnd); f.stime.addEventListener('change', syncEnd);
  $$('[data-tpl]', f).forEach((b) => { b.onclick = () => { const t = templates[Number(b.dataset.tpl)]; if (!f.title.value.trim() || templates.some((x) => x.title === f.title.value)) f.title.value = t.title || t.name; f.stime.value = t.start; f.etime.value = t.end; f.ed.value = f.sd.value; if (t.end < t.start) f.ed.value = ymd(addDays(parseYmd(f.sd.value), 1)); lastStart = `${f.sd.value}T${f.stime.value}`; if (t.cal && CALS.some((c) => c.id === t.cal)) { f.cal.value = t.cal; drawBring(); } if (st.allDay) $('[data-allday]', f).click(); $$('[data-tpl]', f).forEach((x) => x.classList.toggle('on', x === b)); }; });
  $$('[data-color]', f).forEach((b) => { b.onclick = () => { color = b.dataset.color; $$('[data-color]', f).forEach((x) => x.classList.toggle('on', x === b)); }; });
  $('[data-repeat]', f).onclick = async () => { const r = await repeatSheet(st.repeat, f.sd.value); if (r !== undefined) { st.repeat = r; repText(); } };

  const s = sheet({ title: isNew ? 'Nieuwe afspraak' : 'Afspraak bewerken', body, ios: true, saveText: 'Bewaar', onSave: save, size: '', foot: `${!isNew ? `<button class="btn ghost danger left" data-del2>${icon('trash', 'sm')}</button>` : ''}<button class="btn" data-close>Annuleren</button><button class="btn pri" data-save>Bewaar</button>` });
  if (isNew && !st.title && !IS_TOUCH) setTimeout(() => f.title.focus(), 60);
  const del2 = s.$('[data-del2]'); if (del2) del2.onclick = () => { s.close(); openEvent(o, { onChange }); };
  let saving = false;
  async function save() {
    if (saving) return;
    const err = $('[data-err]', f); err.textContent = '';
    const allDay = st.allDay;
    const start = allDay ? f.sd.value : `${f.sd.value}T${f.stime.value}`;
    let end = allDay ? ymd(addDays(parseYmd(f.ed.value || f.sd.value), 1)) : `${f.ed.value || f.sd.value}T${f.etime.value}`;
    if (!f.sd.value) { err.textContent = 'Kies een datum'; return; }
    if (!allDay && new Date(end) < new Date(start)) { err.textContent = 'Het einde ligt vóór het begin'; return; }
    const payload = {
      title: f.title.value.trim() || 'Nieuwe afspraak', start, end, allDay, cal: f.cal.value, location: f.location.value.trim(), travel: Number(f.travel.value) || 0,
      alarms: st.alarms, bring: st.bring, transp: f.transp.value, status: f.status.value, categories: f.categories.value.split(',').map((x) => x.trim()).filter(Boolean),
      attendees: f.attendees.value.split(',').map((x) => x.trim()).filter(Boolean), url: f.url.value.trim(), color, description: f.description.value, repeat: st.repeat,
    };
    saving = true;
    try {
      if (isNew) await api('POST', '/api/agenda/events', payload);
      else {
        let scope = 'all';
        if (o.recurring) {
          scope = await choose('Herhalende afspraak aanpassen', [{ label: 'Alleen deze keer', value: 'this' }, { label: 'Deze en alle volgende', value: 'future' }, { label: 'Alle keren', value: 'all' }]);
          if (!scope) { saving = false; return; }
        }
        await api('PUT', `/api/agenda/event/${encodeURIComponent(o.cal)}/${encodeURIComponent(o.href)}`, { ...payload, uid: o.uid, scope, recurrenceId: o.recurrenceId, repeat: scope === 'this' ? undefined : payload.repeat, cal: scope === 'all' ? payload.cal : o.cal });
      }
      s.close(); toast(isNew ? 'Afspraak toegevoegd' : 'Opgeslagen', { icon: 'tick' }); onChange && onChange(); bus.emit('changed', 'event');
    } catch (e) { err.textContent = e.message; saving = false; }
  }
}
function repeatText(r) {
  const d = { MO: 'ma', TU: 'di', WE: 'wo', TH: 'do', FR: 'vr', SA: 'za', SU: 'zo' };
  const n = r.interval || 1;
  let s = r.freq === 'DAILY' ? (n === 1 ? 'Elke dag' : `Om de ${n} dagen`) : r.freq === 'WEEKLY' ? `${n === 1 ? 'Elke week' : `Om de ${n} weken`}${r.byday && r.byday.length ? ` op ${r.byday.map((x) => d[x.slice(-2)]).join(', ')}` : ''}` : r.freq === 'MONTHLY' ? (n === 1 ? 'Elke maand' : `Om de ${n} maanden`) : (n === 1 ? 'Elk jaar' : `Om de ${n} jaar`);
  if (r.count) s += `, ${r.count} keer`; else if (r.until) s += ` tot ${dayLabel(parseYmd(r.until))}`;
  return s;
}
// herhaling kiezen (met "aangepast")
function repeatSheet(cur, dateStr) {
  return new Promise((resolve) => {
    const dd = new Date(parseYmd(dateStr || ymd(Date.now())));
    const IC = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']; const dname = T.DAYS[dd.getDay()];
    const nth = Math.ceil(dd.getDate() / 7); const lastWeek = dd.getDate() + 7 > new Date(dd.getFullYear(), dd.getMonth() + 1, 0).getDate();
    const presets = [
      ['Nooit', null], ['Elke dag', { freq: 'DAILY' }], ['Elke werkdag (ma–vr)', { freq: 'WEEKLY', byday: ['MO', 'TU', 'WE', 'TH', 'FR'] }],
      [`Elke week op ${dname}`, { freq: 'WEEKLY', byday: [IC[dd.getDay()]] }], [`Om de 2 weken op ${dname}`, { freq: 'WEEKLY', interval: 2, byday: [IC[dd.getDay()]] }],
      [`Elke maand op de ${dd.getDate()}e`, { freq: 'MONTHLY', bymonthday: [dd.getDate()] }],
      [`Elke maand op de ${lastWeek ? 'laatste' : ['', 'eerste', 'tweede', 'derde', 'vierde', 'vijfde'][nth]} ${dname}`, { freq: 'MONTHLY', byday: [`${lastWeek ? -1 : nth}${IC[dd.getDay()]}`] }],
      [`Elk jaar op ${dd.getDate()} ${T.MONTHS[dd.getMonth()]}`, { freq: 'YEARLY' }],
    ];
    let result;
    const r0 = cur || { freq: 'WEEKLY', interval: 1, byday: [IC[dd.getDay()]] };
    const s = sheet({ title: 'Herhalen', body: `<div class="grp">${presets.map(([l, v], i) => `<div class="rw click" data-p="${i}">${esc(l)}${JSON.stringify(v) === JSON.stringify(cur ? { ...cur, text: undefined } : null) ? `<span class="v">${icon('tick')}</span>` : ''}</div>`).join('')}</div>
      <div class="sec-title">Aangepast</div>
      <div class="grp"><div class="rw">Om de<div class="v"><input type="number" min="1" max="99" value="${r0.interval || 1}" data-int style="width:70px"><select data-freq><option value="DAILY">dagen</option><option value="WEEKLY">weken</option><option value="MONTHLY">maanden</option><option value="YEARLY">jaar</option></select></div></div>
        <div class="rw" data-days style="flex-wrap:wrap;gap:6px">${['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'].map((x, i) => `<button type="button" class="chip ${(r0.byday || []).some((b) => b.endsWith(x)) ? 'on' : ''}" data-day="${x}">${['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'][i]}</button>`).join('')}</div>
        <div class="rw">Stopt<div class="v"><select data-end><option value="never">nooit</option><option value="until" ${r0.until ? 'selected' : ''}>op datum</option><option value="count" ${r0.count ? 'selected' : ''}>na aantal keer</option></select><input type="date" data-until value="${r0.until || ''}" ${r0.until ? '' : 'hidden'}><input type="number" data-count min="1" value="${r0.count || 10}" style="width:80px" ${r0.count ? '' : 'hidden'}></div></div>
      </div>`, foot: '<button class="btn" data-close>Annuleren</button><button class="btn pri" data-ok>Gebruik aangepast</button>', onClose: () => resolve(result) });
    s.$('[data-freq]').value = r0.freq || 'WEEKLY';
    const daysRow = s.$('[data-days]'); const upd = () => { daysRow.hidden = s.$('[data-freq]').value !== 'WEEKLY'; }; upd();
    s.$('[data-freq]').onchange = upd;
    s.$$('[data-day]').forEach((b) => { b.onclick = () => b.classList.toggle('on'); });
    s.$('[data-end]').onchange = (e) => { s.$('[data-until]').hidden = e.target.value !== 'until'; s.$('[data-count]').hidden = e.target.value !== 'count'; };
    s.$$('[data-p]').forEach((b) => { b.onclick = () => { result = presets[Number(b.dataset.p)][1]; s.close(); }; });
    s.$('[data-ok]').onclick = () => {
      const freq = s.$('[data-freq]').value; const r = { freq, interval: Math.max(1, Number(s.$('[data-int]').value) || 1) };
      if (freq === 'WEEKLY') { const days = s.$$('[data-day].on').map((b) => b.dataset.day); if (days.length) r.byday = days; }
      const end = s.$('[data-end]').value; if (end === 'until' && s.$('[data-until]').value) r.until = s.$('[data-until]').value; if (end === 'count') r.count = Number(s.$('[data-count]').value) || 10;
      result = r; s.close();
    };
  });
}

// ======================================================================= agenda's beheren
function calendarSettings(c, after) {
  const virt = c.kind !== 'dav';
  const shareUrl = c.shareToken ? `${location.origin}/ics/${c.shareToken}.ics` : '';
  const s = sheet({
    title: c.name, sub: virt ? (c.kind === 'holidays' ? 'Wordt automatisch berekend' : esc(c.url || '')) : c.todos && !c.events ? 'Takenlijst' : 'Agenda',
    body: `<label class="field"><span>Naam</span><input name="name" value="${esc(c.name)}" ${c.kind === 'holidays' ? 'disabled' : ''}></label>
      ${c.kind !== 'holidays' ? `<div class="field"><span>Kleur</span><div class="color-dots">${COLORS.filter(Boolean).concat(['#94A3B8']).map((x) => `<button type="button" class="${x.toUpperCase() === c.color.toUpperCase() ? 'on' : ''}" data-color="${x}" style="--c:${x}"></button>`).join('')}</div></div>` : ''}
      ${c.events ? `<label class="field"><span>Altijd meenemen bij afspraken van deze agenda</span><input name="bring" value="${esc((c.bring || []).join(', '))}"><span class="hint">Komt in je meeneemlijst en in de melding van 21:00.</span></label>` : ''}
      ${!virt ? `<div class="sec-title">Delen</div><div class="grp"><div class="rw">${icon('share')}<span class="grow">Deel-link (alleen lezen)<br><small class="faint">Iemand anders kan hem toevoegen in zijn agenda-app</small></span><button class="tog ${c.shareToken ? 'on' : ''}" data-share></button></div>
        <div class="rw ${c.shareToken ? '' : 'hidden'}" data-sharerow style="flex-wrap:wrap"><input readonly value="${esc(shareUrl)}" data-shareurl style="flex:1;min-width:0"><button class="btn sm" data-copy>${icon('copy', 'sm')}Kopieer</button></div>
        <div class="rw ${c.shareToken ? '' : 'hidden'}" data-busyrow>${icon('eyeoff')}<span class="grow">Enkel "bezet" tonen (geen titels)</span><button class="tog ${c.shareBusyOnly ? 'on' : ''}" data-busy></button></div></div>
        <div class="row" style="margin-top:4px"><a class="btn sm" href="/api/agenda/export/${encodeURIComponent(c.id)}.ics" download>${icon('download', 'sm')}Exporteren (.ics)</a><label class="btn sm">${icon('upload', 'sm')}Importeren (.ics)<input type="file" accept=".ics,text/calendar" data-import hidden></label></div>` : c.kind === 'subscription' ? `<button class="btn sm" data-refresh>${icon('refresh', 'sm')}Nu vernieuwen</button>${c.error ? `<p class="error" style="margin-top:8px">${esc(c.error)}</p>` : ''}` : ''}`,
    foot: `${c.kind !== 'holidays' ? `<button class="btn ghost danger left" data-del>${icon('trash', 'sm')}Verwijderen</button>` : ''}<button class="btn" data-close>Annuleren</button><button class="btn pri" data-save>Bewaar</button>`,
  });
  let color = c.color;
  s.$$('[data-color]').forEach((b) => { b.onclick = () => { color = b.dataset.color; s.$$('[data-color]').forEach((x) => x.classList.toggle('on', x === b)); }; });
  const share = s.$('[data-share]');
  if (share) share.onclick = async () => { const on = !share.classList.contains('on'); try { const r = await api('PATCH', `/api/agenda/calendars/${encodeURIComponent(c.id)}`, { share: on }); share.classList.toggle('on', on); c.shareToken = r.meta && r.meta.shareToken; s.$('[data-shareurl]').value = c.shareToken ? `${location.origin}/ics/${c.shareToken}.ics` : ''; s.$('[data-sharerow]').classList.toggle('hidden', !on); s.$('[data-busyrow]').classList.toggle('hidden', !on); } catch (e) { fail(e); } };
  const cp = s.$('[data-copy]'); if (cp) cp.onclick = () => { import('../core.js').then((m) => m.copyText(s.$('[data-shareurl]').value, 'Link gekopieerd')); };
  const busy = s.$('[data-busy]'); if (busy) busy.onclick = async () => { const on = !busy.classList.contains('on'); try { await api('PATCH', `/api/agenda/calendars/${encodeURIComponent(c.id)}`, { shareBusyOnly: on }); busy.classList.toggle('on', on); } catch (e) { fail(e); } };
  const imp = s.$('[data-import]'); if (imp) imp.onchange = async () => { const fd = new FormData(); fd.append('cal', c.id); fd.append('file', imp.files[0]); try { const r = await api('POST', '/api/agenda/import', fd); toast(`${r.imported} items geïmporteerd`, { icon: 'tick' }); after && after(); } catch (e) { fail(e); } };
  const rf = s.$('[data-refresh]'); if (rf) rf.onclick = async () => { try { const r = await api('POST', `/api/agenda/subscriptions/${encodeURIComponent(c.id)}/refresh`); toast(r.error ? `Fout: ${r.error}` : 'Vernieuwd', { err: !!r.error }); after && after(); } catch (e) { fail(e); } };
  s.$('[data-save]').onclick = async () => {
    try { await api('PATCH', `/api/agenda/calendars/${encodeURIComponent(c.id)}`, { name: s.$('[name=name]').value.trim() || undefined, color, bring: s.$('[name=bring]') ? s.$('[name=bring]').value : undefined }); s.close(); after && after(); } catch (e) { fail(e); }
  };
  const del = s.$('[data-del]'); if (del) del.onclick = async () => {
    if (!(await confirmSheet(virt ? `Abonnement "${esc(c.name)}" verwijderen?` : `De agenda "${esc(c.name)}" en <b>alles erin</b> verwijderen? Dit verdwijnt ook van je gsm.`, { ok: 'Verwijderen', danger: true }))) return;
    try { await api('DELETE', `/api/agenda/calendars/${encodeURIComponent(c.id)}`); s.close(); toast('Verwijderd'); after && after(); } catch (e) { fail(e); }
  };
}
function addCalendar(after) {
  const s = sheet({ title: 'Toevoegen', body: `<div class="seg block" style="margin-bottom:14px"><button class="on" data-t="cal">Nieuwe agenda</button><button data-t="list">Takenlijst</button><button data-t="sub">Abonnement</button></div>
    <label class="field"><span>Naam</span><input name="name"></label>
    <label class="field hidden" data-urlf><span>Link naar de agenda (.ics of webcal://)</span><input name="url" placeholder="https://… of webcal://…"><span class="hint">Wordt elk half uur vernieuwd.</span></label>
    <div class="field"><span>Kleur</span><div class="color-dots">${COLORS.filter(Boolean).map((x, i) => `<button type="button" class="${i === 0 ? 'on' : ''}" data-color="${x}" style="--c:${x}"></button>`).join('')}</div></div><p class="error" data-err></p>`,
  foot: '<button class="btn" data-close>Annuleren</button><button class="btn pri" data-go>Toevoegen</button>' });
  let type = 'cal', color = COLORS[1];
  s.$$('[data-t]').forEach((b) => { b.onclick = () => { type = b.dataset.t; s.$$('[data-t]').forEach((x) => x.classList.toggle('on', x === b)); s.$('[data-urlf]').classList.toggle('hidden', type !== 'sub'); }; });
  s.$$('[data-color]').forEach((b) => { b.onclick = () => { color = b.dataset.color; s.$$('[data-color]').forEach((x) => x.classList.toggle('on', x === b)); }; });
  s.$('[data-go]').onclick = async () => {
    const name = s.$('[name=name]').value.trim();
    try {
      if (type === 'sub') { const r = await api('POST', '/api/agenda/subscriptions', { name, url: s.$('[name=url]').value.trim(), color }); if (r.error) toast(`Toegevoegd, maar: ${r.error}`, { err: true }); }
      else { if (!name) throw new Error('Geef een naam'); await api('POST', '/api/agenda/calendars', { name, color, kind: type === 'list' ? 'VTODO' : 'VEVENT' }); }
      s.close(); after && after();
    } catch (e) { s.$('[data-err]').textContent = e.message; }
  };
}
export { loadCals, repeatText, repeatSheet, calendarSettings, addCalendar };
