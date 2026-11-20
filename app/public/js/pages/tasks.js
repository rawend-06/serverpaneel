/* Taken: slimme lijsten (Vandaag, Gepland, …), eigen lijsten, subtaken, herhalen. Synchroniseert met je gsm (Herinneringen / Tasks). */
import { $, $$, esc, icon, api, toast, fail, sheet, choose, confirmSheet, menu, hm, ymd, sod, addDays, parseYmd, dayLabel, isMobile, debounce, pad, bus, emptyState } from '../core.js';
import * as Live from '../live.js';
import { repeatText, repeatSheet, alarmLabel, addCalendar, calendarSettings, loadCals } from './agenda.js';

const SMART = [['vandaag', 'sun', 'Vandaag'], ['gepland', 'cal', 'Gepland'], ['alles', 'list', 'Alles'], ['klaar', 'tick', 'Klaar']];
const PRIO = [[0, 'Geen'], [9, 'Laag'], [5, 'Middel'], [1, 'Hoog']];
const T_ALARMS = [[0, 'Op het tijdstip zelf'], [15, '15 min vooraf'], [60, '1 uur vooraf'], [180, '3 uur vooraf'], [1440, '1 dag vooraf']];
const T_ALARMS_DAY = [[-540, 'Op de dag zelf om 9:00'], [-480, 'Op de dag zelf om 8:00'], [900, 'De dag ervoor om 9:00']];

function whenText(t) {
  if (!t.dueMs) return '';
  const late = t.dueMs < (t.dueAllDay ? sod() : Date.now()) && !t.done;
  const txt = t.dueAllDay ? dayLabel(t.dueMs) : `${dayLabel(t.dueMs)} ${hm(t.dueMs)}`;
  return `<span class="${late ? 'late' : ''}">${icon('clock')}${esc(txt)}</span>`;
}
export function taskRowHtml(t, kids = [], { showList = true } = {}) {
  const doneKids = kids.filter((k) => k.done).length;
  return `<div class="task ${t.done ? 'done' : ''}" data-uid="${esc(t.uid)}">
    <button class="cb round ${t.done ? 'on' : ''}" data-done aria-label="${t.done ? 'Niet klaar' : 'Afvinken'}" style="${t.priority === 1 && !t.done ? 'border-color:var(--bad)' : ''}">${icon('tick')}</button>
    <div class="tt" data-open><b>${esc(t.title)}</b>
      <small>${t.done && t.completedAt ? `<span>Klaar ${esc(dayLabel(t.completedAt).toLowerCase())}</span>` : whenText(t)}${t.priority === 1 ? '<span class="prio h" title="Hoog"></span>' : t.priority === 5 ? '<span class="prio" title="Middel"></span>' : ''}${t.repeat ? `<span>${icon('repeat')}</span>` : ''}${kids.length ? `<span>${icon('list')}${doneKids}/${kids.length}</span>` : ''}${t.description ? `<span>${icon('note')}</span>` : ''}${t.categories && t.categories.length ? t.categories.map((c) => `<span class="tag n" style="padding:1px 7px">${esc(c)}</span>`).join('') : ''}${showList && t.listName ? `<span style="color:${esc(t.color || 'inherit')}">● ${esc(t.listName)}</span>` : ''}</small></div>
  </div>`;
}

export default async function tasks(root, ctx) {
  let data = { lists: [], tasks: [] };
  let view = ctx.params[0] || 'vandaag';
  let showDone = false;
  root.innerHTML = `
    <div class="top"><div class="grow"><h1 data-title>Taken</h1><p data-sub>&nbsp;</p></div>
      <div class="actions"><button class="btn" data-newlist>${icon('plus', 'sm')}Lijst</button><button class="btn pri" data-new>${icon('plus', 'sm')}Taak</button><button class="iconbtn keep" data-menu aria-label="Meer">${icon('more')}</button></div></div>
    <div class="chips scroll" data-chips style="margin-bottom:14px"></div>
    <div class="cal-wrap">
      <div class="cal-side col"><div class="card mini cals-list" data-side></div></div>
      <div class="card" style="padding:10px 16px 16px">
        <form class="addrow" data-add style="margin:4px 0 6px">${icon('plus', 'sm')}<input placeholder="Nieuwe taak…" enterkeyhint="done" autocomplete="off"></form>
        <div data-list></div>
      </div>
    </div>`;
  ctx.setFab(() => editTask(null, data.lists, load, defaults()));

  const counts = () => {
    const open = data.tasks.filter((t) => !t.done && !t.parent);
    const end = addDays(sod(), 1);
    return { vandaag: open.filter((t) => t.dueMs && t.dueMs < end).length, gepland: open.filter((t) => t.dueMs).length, alles: open.length, klaar: data.tasks.filter((t) => t.done && !t.parent).length };
  };
  const defaults = () => {
    const d = {};
    if (data.lists.some((l) => l.id === view)) d.list = view;
    if (view === 'vandaag') d.due = ymd(Date.now());
    return d;
  };
  function drawNav() {
    const c = counts();
    const side = $('[data-side]', root);
    side.innerHTML = `<h4>Slimme lijsten</h4>${SMART.map(([k, ic, l]) => `<div class="cl ${view === k ? 'on' : ''}" data-v="${k}" style="${view === k ? 'background:var(--pS)' : ''}">${icon(ic, 'sm')}<span class="grow">${l}</span><span class="faint small">${c[k] || ''}</span></div>`).join('')}
      <h4>Lijsten</h4>${data.lists.map((l) => { const n = data.tasks.filter((t) => t.list === l.id && !t.done && !t.parent).length; return `<div class="cl" data-v="${esc(l.id)}" style="${view === l.id ? 'background:var(--pS)' : ''}"><span class="k on" style="--c:${esc(l.color)};border-radius:50%"></span><span class="grow ellipsis">${esc(l.name)}</span><span class="faint small">${n || ''}</span></div>`; }).join('')}
      <div class="cl" data-newlist2 style="color:var(--muted)">${icon('plus', 'sm')}<span>Nieuwe lijst</span></div>`;
    $('[data-chips]', root).innerHTML = [...SMART.map(([k, ic, l]) => [k, l, c[k]]), ...data.lists.map((l) => [l.id, l.name, data.tasks.filter((t) => t.list === l.id && !t.done && !t.parent).length])]
      .map(([k, l, n]) => `<button class="chip ${view === k ? 'on' : ''}" data-v="${esc(k)}">${esc(l)}${n ? ` <span class="faint">${n}</span>` : ''}</button>`).join('');
    $('[data-chips]', root).classList.toggle('hidden', !isMobile() && innerWidth > 1050);
  }
  function title() {
    const s = SMART.find((x) => x[0] === view); if (s) return s[2];
    const l = data.lists.find((x) => x.id === view); return l ? l.name : 'Taken';
  }
  function drawList() {
    const el = $('[data-list]', root);
    $('[data-title]', root).textContent = title();
    const end = addDays(sod(), 1);
    const kidsOf = (t) => data.tasks.filter((k) => k.parent === t.uid);
    let pool = data.tasks.filter((t) => !t.parent || !data.tasks.some((p) => p.uid === t.parent));
    let groups = [];
    const open = pool.filter((t) => !t.done);
    const byDue = (a, b) => (a.dueMs || 9e15) - (b.dueMs || 9e15) || (prioRank(a) - prioRank(b)) || (a.created || 0) - (b.created || 0);
    if (view === 'vandaag') {
      const late = open.filter((t) => t.dueMs && t.dueMs < sod()).sort(byDue);
      const today = open.filter((t) => t.dueMs && t.dueMs >= sod() && t.dueMs < end).sort(byDue);
      groups = [['Te laat', late, 'late'], ['Vandaag', today]];
      const doneToday = pool.filter((t) => t.done && t.completedAt >= sod());
      if (doneToday.length) groups.push(['Vandaag afgewerkt', doneToday]);
    } else if (view === 'gepland') {
      const p = open.filter((t) => t.dueMs).sort(byDue);
      const wk = addDays(sod(), 7);
      groups = [['Te laat', p.filter((t) => t.dueMs < sod()), 'late'], ['Vandaag', p.filter((t) => t.dueMs >= sod() && t.dueMs < end)], ['Morgen', p.filter((t) => t.dueMs >= end && t.dueMs < addDays(end, 1))], ['Deze week', p.filter((t) => t.dueMs >= addDays(end, 1) && t.dueMs < wk)], ['Later', p.filter((t) => t.dueMs >= wk)]];
    } else if (view === 'alles') {
      groups = data.lists.map((l) => [l.name, open.filter((t) => t.list === l.id).sort(byDue)]);
    } else if (view === 'klaar') {
      groups = [['Afgewerkt', pool.filter((t) => t.done).sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0)).slice(0, 200)]];
    } else {
      const inList = pool.filter((t) => t.list === view);
      groups = [['', inList.filter((t) => !t.done).sort(byDue)]];
      const done = inList.filter((t) => t.done).sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
      if (done.length) groups.push([`Afgewerkt (${done.length})`, showDone ? done : [], 'donegrp']);
    }
    const isList = data.lists.some((l) => l.id === view);
    const html = groups.filter(([, items, cls]) => items.length || cls === 'donegrp').map(([name, items, cls]) => `
      ${name ? `<div class="sec-title ${cls === 'late' ? 'late' : ''}" ${cls === 'donegrp' ? 'data-toggledone style="cursor:pointer"' : ''}>${esc(name)}${cls === 'donegrp' ? ` · <span class="link">${showDone ? 'verbergen' : 'tonen'}</span>` : ''}</div>` : ''}
      <div>${items.map((t) => { const kids = kidsOf(t); return taskRowHtml(t, kids, { showList: !isList }) + (kids.length && !t.done ? `<div style="margin-left:34px">${kids.sort((a, b) => a.done - b.done || (a.created || 0) - (b.created || 0)).map((k) => taskRowHtml(k, [], { showList: false })).join('')}</div>` : ''); }).join('')}</div>`).join('');
    const empty = { vandaag: ['sun', 'Niets voor vandaag', 'Taken met een datum van vandaag of eerder komen hier.'], gepland: ['cal', 'Niets gepland', 'Geef een taak een datum en ze verschijnt hier.'], klaar: ['tick', 'Nog niets afgewerkt', ''], alles: ['list', 'Geen open taken', 'Alles is gedaan!'] }[view] || ['tasks', 'Deze lijst is leeg', 'Typ hierboven om een taak toe te voegen.'];
    el.innerHTML = html.trim() ? html : emptyState(empty[0], empty[1], empty[2]);
    const c = counts();
    $('[data-sub]', root).textContent = view === 'klaar' ? `${c.klaar} afgewerkt` : `${open.length} open${c.vandaag ? ` · ${c.vandaag} voor vandaag` : ''}`;
  }
  const prioRank = (t) => ({ 1: 0, 5: 1, 9: 2 }[t.priority] ?? 3);

  async function load() {
    try { data = await api('GET', '/api/tasks'); } catch (e) { fail(e); return; }
    if (!SMART.some((s) => s[0] === view) && !data.lists.some((l) => l.id === view)) view = 'vandaag';
    drawNav(); drawList();
  }
  function setView(v) { view = v; showDone = false; history.replaceState(null, '', `#/taken/${encodeURIComponent(v)}`); drawNav(); drawList(); }

  root.addEventListener('click', async (e) => {
    const v = e.target.closest('[data-v]'); if (v) { setView(v.dataset.v); return; }
    if (e.target.closest('[data-newlist], [data-newlist2]')) { addCalendar(async () => { await loadCals(true); load(); }); return; }
    if (e.target.closest('[data-new]')) { editTask(null, data.lists, load, defaults()); return; }
    if (e.target.closest('[data-toggledone]')) { showDone = !showDone; drawList(); return; }
    const row = e.target.closest('.task[data-uid]'); if (!row) return;
    const t = data.tasks.find((x) => x.uid === row.dataset.uid); if (!t) return;
    if (e.target.closest('[data-done]')) { toggleDone(t, row); return; }
    if (e.target.closest('[data-open]')) editTask(t, data.lists, load);
  });
  async function toggleDone(t, row) {
    const cb = $('[data-done]', row); cb.classList.toggle('on'); row.classList.toggle('done');
    try {
      const r = await api('PUT', `/api/tasks/${t.list}/${encodeURIComponent(t.href)}`, { uid: t.uid, done: !t.done });
      if (r.advanced) toast(`Herhaalt: volgende keer ${dayLabel(parseYmd(r.advanced)).toLowerCase()}`, { icon: 'repeat' });
      else if (!t.done) toast('Afgevinkt', { icon: 'tick', action: 'Ongedaan', onAction: async () => { try { await api('PUT', `/api/tasks/${t.list}/${encodeURIComponent(t.href)}`, { uid: t.uid, done: false }); load(); } catch (x) { fail(x); } } });
    } catch (x) { fail(x); }
    setTimeout(load, 350);
  }
  $('[data-menu]', root).onclick = (e) => {
    const l = data.lists.find((x) => x.id === view);
    const items = [{ label: 'Nieuwe lijst', icon: 'plus', onClick: () => addCalendar(async () => { await loadCals(true); load(); }) }];
    if (l) items.push({ label: 'Lijst instellingen', icon: 'sliders', onClick: () => calendarSettings(l, async () => { await loadCals(true); load(); }) });
    const done = data.tasks.filter((t) => t.done && (!l || t.list === l.id));
    if (done.length) items.push('-', { label: `Afgewerkte taken wissen (${done.length})`, icon: 'trash', danger: true, onClick: async () => {
      if (!(await confirmSheet(`${done.length} afgewerkte ${done.length === 1 ? 'taak' : 'taken'}${l ? ` uit "${esc(l.name)}"` : ''} definitief verwijderen?`, { ok: 'Wissen', danger: true }))) return;
      try { for (const t of done) await api('DELETE', `/api/tasks/${t.list}/${encodeURIComponent(t.href)}?uid=${encodeURIComponent(t.uid)}`).catch(() => {}); toast('Gewist'); load(); } catch (x) { fail(x); }
    } });
    menu(e.currentTarget, items);
  };
  $('[data-add]', root).addEventListener('submit', async (e) => {
    e.preventDefault(); const inp = $('input', e.target); const v = inp.value.trim(); if (!v) return;
    inp.value = '';
    try {
      const p = await api('POST', '/api/quick/parse', { text: v });
      const d = defaults();
      let due = p.due || (p.kind === 'event' ? p.start : null) || d.due || null;
      if (p.kind === 'event' && p.allDay && due) due = due.slice(0, 10);
      const title = (p.kind === 'task' || p.kind === 'event') && p.title ? p.title : v;
      await api('POST', '/api/tasks', { title, due, repeat: p.repeat || null, list: d.list, priority: /!$|\bbelangrijk\b/i.test(v) ? 1 : 0 });
      load();
    } catch (x) { fail(x); }
  });

  await load();
  if (ctx.query.nieuw) setTimeout(() => editTask(null, data.lists, load, defaults()), 50);
  const unsubs = [Live.on('agenda', debounce(load, 400)), bus.on('changed', debounce(load, 200))];
  const onResize = debounce(drawNav, 200); addEventListener('resize', onResize);
  return {
    cleanup: () => { unsubs.forEach((u) => u()); removeEventListener('resize', onResize); },
    update: (r) => { if (r.query.nieuw) { editTask(null, data.lists, load, defaults()); return true; } if (r.params[0] && r.params[0] !== view) setView(r.params[0]); return true; },
  };
}

// ======================================================================= taak bewerken
export async function editTask(t, lists, onChange, defaults = {}) {
  if (!lists || !lists.length) { try { lists = (await api('GET', '/api/tasks')).lists; } catch (e) { fail(e); return; } }
  const isNew = !t;
  let all = []; try { all = (await api('GET', '/api/tasks')).tasks; } catch { /* */ }
  const st = {
    title: t ? t.title : '', description: t ? t.description : '', list: t ? t.list : defaults.list || (lists.find((l) => l.id === 'taken') || lists[0]).id,
    date: t && t.due ? t.due.slice(0, 10) : defaults.due ? defaults.due.slice(0, 10) : '', time: t && t.due && !t.dueAllDay ? t.due.slice(11, 16) : '',
    priority: t ? t.priority : 0, repeat: t ? t.repeat : null, alarms: t ? (t.alarms || []).map((a) => ({ min: a.min })) : [], categories: t ? t.categories || [] : [],
  };
  const kids = t ? all.filter((k) => k.parent === t.uid) : [];
  const newKids = [];
  const s = sheet({
    title: isNew ? 'Nieuwe taak' : 'Taak', ios: true, size: '',
    body: `<form data-f autocomplete="off">
      <input class="ev-title" name="title" placeholder="Wat moet er gebeuren?" value="${esc(st.title)}" ${isNew ? 'autofocus' : ''}>
      <div class="grp">
        <div class="rw">${icon('cal')}<span>Datum</span><div class="v"><input type="date" name="date" value="${esc(st.date)}"><button type="button" class="btn ghost icon sm ${st.date ? '' : 'hidden'}" data-cleardate aria-label="Geen datum">${icon('x', 'sm')}</button></div></div>
        <div class="rw ${st.date ? '' : 'hidden'}" data-timerow>${icon('clock')}<span>Tijd</span><div class="v"><input type="time" name="time" value="${esc(st.time)}" placeholder="hele dag"><button type="button" class="btn ghost icon sm ${st.time ? '' : 'hidden'}" data-cleartime aria-label="Geen tijd">${icon('x', 'sm')}</button></div></div>
        <div class="rw ${st.date ? '' : 'hidden'} click" data-repeat>${icon('repeat')}<span>Herhalen</span><span class="v" data-reptext></span></div>
        <div class="rw ${st.date ? '' : 'hidden'}" data-alrow>${icon('bell')}<span>Herinnering</span><div class="rem" data-alarms style="margin-left:auto"></div></div>
      </div>
      <div class="grp">
        <div class="rw">${icon('flag')}<span>Belangrijk</span><div class="v"><div class="seg" data-prio>${PRIO.map(([v, l]) => `<button type="button" data-p="${v}" class="${st.priority === v ? 'on' : ''}">${l}</button>`).join('')}</div></div></div>
        <div class="rw">${icon('list')}<span>Lijst</span><div class="v"><select name="list">${lists.map((l) => `<option value="${esc(l.id)}" ${l.id === st.list ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></div></div>
        <div class="rw">${icon('tag')}<input class="bare grow" name="categories" placeholder="Labels (komma's ertussen)" value="${esc(st.categories.join(', '))}"></div>
      </div>
      <div class="sec-title">Subtaken</div>
      <div class="grp" data-kids style="padding:2px 14px"></div>
      <div class="sec-title">Notities</div>
      <textarea name="description" placeholder="Extra info, links…" style="min-height:90px">${esc(st.description)}</textarea>
      <p class="error" data-err style="margin-top:10px"></p>
    </form>`,
    foot: `${isNew ? '' : `<button class="btn ghost danger left" data-del>${icon('trash', 'sm')}</button>`}<button class="btn" data-close>Annuleren</button><button class="btn pri" data-save>${isNew ? 'Toevoegen' : 'Bewaar'}</button>`,
    onSave: () => save(),
  });
  const f = s.$('[data-f]');
  const syncDate = () => {
    const has = !!f.date.value;
    for (const k of ['[data-timerow]', '[data-repeat]', '[data-alrow]']) s.$(k).classList.toggle('hidden', !has);
    s.$('[data-cleardate]').classList.toggle('hidden', !has);
    s.$('[data-cleartime]').classList.toggle('hidden', !f.time.value);
  };
  f.date.onchange = () => { syncDate(); drawAlarms(); };
  f.time.onchange = () => { const wasDay = !st.time; st.time = f.time.value; if (wasDay !== !st.time) st.alarms = []; syncDate(); drawAlarms(); };
  s.$('[data-cleardate]').onclick = () => { f.date.value = ''; f.time.value = ''; st.time = ''; st.repeat = null; st.alarms = []; syncDate(); repText(); drawAlarms(); };
  s.$('[data-cleartime]').onclick = () => { f.time.value = ''; st.time = ''; st.alarms = []; syncDate(); drawAlarms(); };
  const repText = () => { s.$('[data-reptext]').innerHTML = `${st.repeat ? esc(repeatText(st.repeat)) : 'Nooit'} ${icon('right', 'sm')}`; };
  s.$('[data-repeat]').onclick = async () => { const r = await repeatSheet(st.repeat, f.date.value); if (r !== undefined) { st.repeat = r; repText(); } };
  s.$$('[data-p]').forEach((b) => { b.onclick = () => { st.priority = Number(b.dataset.p); s.$$('[data-p]').forEach((x) => x.classList.toggle('on', x === b)); }; });
  function drawAlarms() {
    const el = s.$('[data-alarms]'); const day = !f.time.value;
    el.innerHTML = st.alarms.map((a, i) => `<span data-ra="${i}">${esc(alarmLabel(a.min, day).replace(' vooraf', ''))} ${icon('x')}</span>`).join('') + `<span data-addalarm style="background:var(--card2);color:var(--muted)">${icon('plus')}${st.alarms.length ? '' : 'Toevoegen'}</span>`;
    $$('[data-ra]', el).forEach((c) => { c.onclick = () => { st.alarms.splice(Number(c.dataset.ra), 1); drawAlarms(); }; });
    $('[data-addalarm]', el).onclick = async () => {
      const opts = (day ? T_ALARMS_DAY : T_ALARMS).filter((a) => !st.alarms.some((x) => x.min === a[0])).map((a) => ({ label: a[1], value: a[0] }));
      const v = await choose('Herinnering', opts); if (v == null) return; st.alarms.push({ min: v }); drawAlarms();
    };
  }
  // subtaken
  function drawKids() {
    const el = s.$('[data-kids]');
    el.innerHTML = [...kids.map((k) => ({ ...k, saved: true })), ...newKids.map((title, i) => ({ title, i, done: false }))].map((k) => `<div class="task ${k.done ? 'done' : ''}" style="padding:8px 0" ${k.saved ? `data-kuid="${esc(k.uid)}"` : `data-ki="${k.i}"`}><button type="button" class="cb round ${k.done ? 'on' : ''}" data-kdone>${icon('tick')}</button><div class="tt"><b>${esc(k.title)}</b></div><button type="button" class="btn ghost icon sm" data-kdel aria-label="Weg">${icon('x', 'sm')}</button></div>`).join('')
      + `<div class="addrow" style="border:0;margin:0;padding:10px 0">${icon('plus', 'sm')}<input data-kadd placeholder="Subtaak toevoegen" enterkeyhint="done"></div>`;
    const inp = $('[data-kadd]', el);
    inp.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter' || e.isComposing) return; e.preventDefault(); const v = inp.value.trim(); if (!v) return;
      if (isNew) { newKids.push(v); drawKids(); s.$('[data-kadd]').focus(); return; }
      try { const r = await api('POST', '/api/tasks', { title: v, list: t.list, parent: t.uid }); kids.push({ uid: r.uid, href: r.href, list: r.list, title: v, done: false }); drawKids(); s.$('[data-kadd]').focus(); onChange && onChange(); } catch (x) { fail(x); }
    });
    $$('[data-kdone]', el).forEach((b) => { b.onclick = async () => {
      const row = b.closest('.task'); const k = kids.find((x) => x.uid === row.dataset.kuid); if (!k) return;
      k.done = !k.done; drawKids();
      try { await api('PUT', `/api/tasks/${k.list}/${encodeURIComponent(k.href)}`, { uid: k.uid, done: k.done }); onChange && onChange(); } catch (x) { fail(x); }
    }; });
    $$('[data-kdel]', el).forEach((b) => { b.onclick = async () => {
      const row = b.closest('.task');
      if (row.dataset.ki != null) { newKids.splice(Number(row.dataset.ki), 1); drawKids(); return; }
      const i = kids.findIndex((x) => x.uid === row.dataset.kuid); if (i < 0) return; const k = kids[i];
      try { await api('DELETE', `/api/tasks/${k.list}/${encodeURIComponent(k.href)}?uid=${encodeURIComponent(k.uid)}`); kids.splice(i, 1); drawKids(); onChange && onChange(); } catch (x) { fail(x); }
    }; });
  }
  repText(); drawAlarms(); drawKids(); syncDate();
  const del = s.$('[data-del]');
  if (del) del.onclick = async () => {
    if (!(await confirmSheet(`"${esc(t.title)}"${kids.length ? ` en ${kids.length} subtaken` : ''} verwijderen?`, { ok: 'Verwijderen', danger: true }))) return;
    try { await api('DELETE', `/api/tasks/${t.list}/${encodeURIComponent(t.href)}?uid=${encodeURIComponent(t.uid)}`); s.close(); toast('Verwijderd'); onChange && onChange(); bus.emit('changed', 'task'); } catch (e) { fail(e); }
  };
  f.title.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); save(); } });
  let busy = false;
  async function save() {
    if (busy) return; busy = true;
    const err = s.$('[data-err]'); err.textContent = '';
    const title = f.title.value.trim(); if (!title) { err.textContent = 'Geef de taak een naam'; busy = false; f.title.focus(); return; }
    const due = f.date.value ? (f.time.value ? `${f.date.value}T${f.time.value}` : f.date.value) : null;
    const body = { title, description: f.description.value, due, priority: st.priority, repeat: due ? st.repeat : null, alarms: due ? st.alarms : [], categories: f.categories.value.split(',').map((x) => x.trim()).filter(Boolean), list: f.list.value };
    try {
      if (isNew) {
        const r = await api('POST', '/api/tasks', body);
        for (const k of newKids) await api('POST', '/api/tasks', { title: k, list: r.list, parent: r.uid });
        toast('Taak toegevoegd', { icon: 'tick' });
      } else {
        await api('PUT', `/api/tasks/${t.list}/${encodeURIComponent(t.href)}`, { uid: t.uid, ...body });
        if (body.list !== t.list) for (const k of kids) await api('PUT', `/api/tasks/${k.list}/${encodeURIComponent(k.href)}`, { uid: k.uid, list: body.list }).catch(() => {});
      }
      s.close(); onChange && onChange(); bus.emit('changed', 'task');
    } catch (e) { err.textContent = e.message; busy = false; }
  }
}
