/* Morgen klaarleggen: wat heb je morgen, wanneer moet je vertrekken en wat moet je meenemen (afvinken). */
import { $, $$, esc, icon, api, toast, fail, hm, ymd, sod, addDays, parseYmd, dayLabel, longDate, evColors, ring, setRing, debounce, emptyState, T } from '../core.js';
import * as Live from '../live.js';
import { openEvent } from './agenda.js';

export default async function morgen(root, ctx) {
  let day = ctx.query.datum && /^\d{4}-\d{2}-\d{2}$/.test(ctx.query.datum) ? parseYmd(ctx.query.datum) : addDays(sod(), 1);
  root.innerHTML = `
    <div class="top"><a class="iconbtn back" href="#/meer" aria-label="Terug">${icon('left')}</a><div class="grow"><h1 data-title>Morgen klaarleggen</h1><p data-sub>&nbsp;</p></div></div>
    <div class="card" style="padding:10px 8px;margin-bottom:16px"><div class="strip" data-strip style="grid-template-columns:repeat(7,1fr)"></div></div>
    <div class="grid dash-row2" style="margin-top:0">
      <div class="col" style="gap:16px">
        <div class="card"><div class="row" style="align-items:center;gap:16px"><div data-ring>${ring(0, { label: '–', size: 70 })}</div><div class="grow"><b style="font-size:16px" data-bigt>&nbsp;</b><div class="muted small" data-bigs></div></div></div>
          <div data-leave></div></div>
        <div data-events class="col" style="gap:12px"></div>
      </div>
      <div class="col" style="gap:16px">
        <div class="card"><h3>${icon('bag')}Alles samen<span class="more" data-allcount></span></h3><div class="bringlist" data-all style="margin-top:6px"></div></div>
        <div class="card"><h3>${icon('tasks')}Taken<a class="more" href="#/taken/gepland">Taken ${icon('right', 'xs')}</a></h3><div data-tasks style="margin-top:6px"></div></div>
      </div>
    </div>`;
  ctx.setFab(null, { hide: true });

  let data = { items: [], date: '' };
  function drawStrip() {
    const el = $('[data-strip]', root); const base = sod();
    el.innerHTML = Array.from({ length: 7 }, (_, i) => addDays(base, i)).map((d) => { const dt = new Date(d); return `<div class="sd ${d === day ? 'sel' : ''} ${d === base ? 'td' : ''}" data-d="${d}">${i18(dt)}<b>${dt.getDate()}</b></div>`; }).join('');
  }
  const i18 = (dt) => (sod(dt) === sod() ? 'vand.' : sod(dt) === addDays(sod(), 1) ? 'morgen' : T.DSH[dt.getDay()]);
  $('[data-strip]', root).onclick = (e) => { const d = e.target.closest('[data-d]'); if (!d) return; day = Number(d.dataset.d); history.replaceState(null, '', `#/morgen?datum=${ymd(day)}`); drawStrip(); load(); };

  async function load() {
    try { data = await api('GET', `/api/agenda/prepare?date=${ymd(day)}`); } catch (e) { fail(e); return; }
    $('[data-title]', root).textContent = day === addDays(sod(), 1) ? 'Morgen klaarleggen' : day === sod() ? 'Vandaag' : `${dayLabel(day, true)}`;
    $('[data-sub]', root).textContent = longDate(day).replace(/^./, (c) => c.toUpperCase());
    draw(); loadTasks();
  }
  function draw() {
    const items = data.items;
    const timed = items.filter((o) => !o.allDay);
    // samen
    const map = new Map();
    for (const o of items) for (const b of o.bring) { const k = b.toLowerCase(); if (!map.has(k)) map.set(k, { name: b, owners: [] }); map.get(k).owners.push({ o, checked: o.checked.includes(b) }); }
    const allItems = [...map.values()];
    const done = allItems.filter((x) => x.owners.every((w) => w.checked)).length;
    const pct = allItems.length ? (done / allItems.length) * 100 : 100;
    setRing($('[data-ring] .ring', root), pct, allItems.length ? `${done}/${allItems.length}` : '✓');
    $('[data-bigt]', root).textContent = !items.length ? 'Niets gepland' : allItems.length && done === allItems.length ? 'Alles klaar!' : allItems.length ? `Nog ${allItems.length - done} ${allItems.length - done === 1 ? 'ding' : 'dingen'} klaarleggen` : 'Niets mee te nemen';
    $('[data-bigs]', root).textContent = timed.length ? `${timed.length} ${timed.length === 1 ? 'afspraak' : 'afspraken'} · eerste om ${hm(timed[0].start)}` : items.length ? 'Enkel hele-dag-items' : 'Een rustige dag';
    const first = timed[0];
    $('[data-leave]', root).innerHTML = first ? `<div class="alert" style="margin-top:14px"><div class="ib sm s">${icon('clock')}</div><div class="grow"><b>${first.travel ? `Vertrekken om ${hm(first.start - first.travel * 60e3)}` : `Om ${hm(first.start)}: ${esc(first.title)}`}</b><small>${first.travel ? `${first.travel} min onderweg naar ${esc(first.location || first.title)}` : first.location ? esc(first.location) : 'Tip: zet bij de afspraak hoelang je onderweg bent, dan zie je hier wanneer je moet vertrekken.'}</small></div></div>` : '';
    $('[data-allcount]', root).textContent = allItems.length ? `${done} van ${allItems.length}` : '';
    $('[data-all]', root).innerHTML = allItems.length ? allItems.map((x) => { const on = x.owners.every((w) => w.checked); return `<div class="bi ${on ? 'done' : ''}" data-all-item="${esc(x.name)}"><button class="cb ${on ? 'on' : ''}">${icon('tick')}</button><span>${esc(x.name)}</span><small>${esc(x.owners.map((w) => w.o.title).filter((v, i, a) => a.indexOf(v) === i).join(', '))}</small></div>`; }).join('')
      : `<p class="muted small" style="padding:8px 0">Voeg bij een afspraak toe wat je moet meenemen, of zet het bij een agenda.</p>`;
    // per afspraak
    $('[data-events]', root).innerHTML = items.length ? items.map((o, i) => `<div class="card" style="${evColors(o.color)};border-left:4px solid ${esc(o.color)}">
        <div class="row" data-open="${i}" style="cursor:pointer"><div class="grow"><b style="font-size:15px">${esc(o.title)}</b><div class="muted small">${o.allDay ? 'Hele dag' : `${hm(o.start)} – ${hm(o.end)}`}${o.location ? ` · ${esc(o.location)}` : ''} · ${esc(o.calName)}</div></div>${icon('right', 'sm')}</div>
        <div class="bringlist" style="margin-top:6px">${o.bring.map((b) => `<div class="bi ${o.checked.includes(b) ? 'done' : ''}" data-i="${i}" data-item="${esc(b)}"><button class="cb ${o.checked.includes(b) ? 'on' : ''}">${icon('tick')}</button><span>${esc(b)}</span></div>`).join('')}</div>
        <form class="addrow" data-addto="${i}" style="margin-top:8px">${icon('plus', 'sm')}<input placeholder="Iets toevoegen om mee te nemen" enterkeyhint="done"></form>
      </div>`).join('') : `<div class="card">${emptyState('cal', 'Niets gepland', 'Er staat niets in je agenda voor deze dag.', '<a class="btn sm" href="#/agenda">Naar agenda</a>')}</div>`;
  }
  async function check(o, item, on) {
    const c = new Set(o.checked); if (on) c.add(item); else c.delete(item); o.checked = [...c];
    try { await api('POST', '/api/agenda/prepare/check', { uid: o.uid, date: data.date, item, checked: on }); } catch (e) { fail(e); }
  }
  root.addEventListener('click', async (e) => {
    const bi = e.target.closest('[data-item]');
    if (bi) { const o = data.items[Number(bi.dataset.i)]; const on = !o.checked.includes(bi.dataset.item); await check(o, bi.dataset.item, on); draw(); if (on && navigator.vibrate) navigator.vibrate(8); return; }
    const all = e.target.closest('[data-all-item]');
    if (all) {
      const name = all.dataset.allItem.toLowerCase();
      const owners = data.items.filter((o) => o.bring.some((b) => b.toLowerCase() === name));
      const on = !owners.every((o) => o.checked.some((c) => c.toLowerCase() === name));
      for (const o of owners) await check(o, o.bring.find((b) => b.toLowerCase() === name), on);
      draw(); return;
    }
    const op = e.target.closest('[data-open]');
    if (op) { const o = data.items[Number(op.dataset.open)]; openEvent(o, { onChange: load }); }
  });
  root.addEventListener('submit', async (e) => {
    const f = e.target.closest('[data-addto]'); if (!f) return; e.preventDefault();
    const inp = $('input', f); const v = inp.value.trim(); if (!v) return;
    const o = data.items[Number(f.dataset.addto)];
    try { await api('POST', '/api/agenda/prepare/add', { uid: o.uid, item: v }); o.bring = [...new Set([...o.bring, v])]; inp.value = ''; draw(); toast(o.recurring ? 'Toegevoegd (ook voor de volgende keren)' : 'Toegevoegd', { icon: 'bag' }); const ni = $(`[data-addto="${f.dataset.addto}"] input`, root); if (ni) ni.focus(); } catch (x) { fail(x); }
  });
  async function loadTasks() {
    const el = $('[data-tasks]', root);
    let r; try { r = await api('GET', '/api/tasks'); } catch { return; }
    const end = addDays(day, 1);
    const list = r.tasks.filter((t) => !t.done && !t.parent && t.dueMs && t.dueMs < end).sort((a, b) => a.dueMs - b.dueMs);
    el.innerHTML = list.length ? list.map((t) => `<div class="task" data-tuid="${esc(t.uid)}"><button class="cb round" data-tdone>${icon('tick')}</button><div class="tt"><b>${esc(t.title)}</b><small>${t.dueMs < day ? `<span class="late">${esc(dayLabel(t.dueMs))}</span>` : t.dueAllDay ? '' : hm(t.dueMs)}</small></div></div>`).join('')
      : '<p class="muted small" style="padding:8px 0">Geen taken voor deze dag.</p>';
    $$('[data-tdone]', el).forEach((b) => { b.onclick = async () => { const t = list.find((x) => x.uid === b.closest('[data-tuid]').dataset.tuid); b.classList.add('on'); b.closest('.task').classList.add('done'); try { await api('PUT', `/api/tasks/${t.list}/${encodeURIComponent(t.href)}`, { uid: t.uid, done: true }); } catch (x) { fail(x); } setTimeout(loadTasks, 500); }; });
  }

  drawStrip(); await load();
  const un = Live.on('agenda', debounce(load, 500));
  return () => un();
}
