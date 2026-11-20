'use strict';
/*
 * iCalendar-hulp: afspraken (VEVENT) en taken (VTODO) lezen, maken, aanpassen en herhalingen uitrekenen.
 * Alles in tijdzone Europe/Brussels, zodat een wekelijkse afspraak om 7:00 ook na het wisselen van zomer-/wintertijd om 7:00 blijft.
 */
const ICAL = require('ical.js');
const crypto = require('crypto');

const TZID = 'Europe/Brussels';
const VTIMEZONE = [
  'BEGIN:VTIMEZONE', `TZID:${TZID}`,
  'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'TZNAME:CEST', 'DTSTART:19700329T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'TZNAME:CET', 'DTSTART:19701025T030000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
  'END:VTIMEZONE',
].join('\r\n');
const vtzComp = new ICAL.Component(ICAL.parse(`BEGIN:VCALENDAR\r\n${VTIMEZONE}\r\nEND:VCALENDAR`)).getFirstSubcomponent('vtimezone');
const ZONE = new ICAL.Timezone(vtzComp);
ICAL.TimezoneService.register(ZONE);
// Windows/Outlook-namen die we tegenkomen in uitnodigingen
for (const alias of ['W. Europe Standard Time', 'Romance Standard Time', 'Europe/Amsterdam', 'Europe/Paris', 'Europe/Berlin', 'Europe/Luxembourg', 'CET']) {
  if (!ICAL.TimezoneService.has(alias)) ICAL.TimezoneService.register(alias, ZONE);
}

const pad = (n) => String(n).padStart(2, '0');
const newUid = () => `${crypto.randomUUID()}@rawendpaneel`;
const nowStamp = () => ICAL.Time.fromJSDate(new Date(), true);

// "2026-10-09" of "2026-10-09T07:00" -> ICAL.Time in Brussel
function toTime(str, allDay) {
  const m = String(str || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) throw new Error(`Ongeldige datum: ${str}`);
  const d = { year: +m[1], month: +m[2], day: +m[3] };
  if (allDay) return ICAL.Time.fromData({ ...d, isDate: true });
  return ICAL.Time.fromData({ ...d, hour: +(m[4] || 0), minute: +(m[5] || 0), second: 0 }, ZONE);
}
// ICAL.Time -> "2026-10-09T07:00" (lokale tijd in Brussel) of "2026-10-09"
function fmtLocal(t) {
  if (!t) return null;
  if (t.isDate) return `${t.year}-${pad(t.month)}-${pad(t.day)}`;
  const l = t.zone && t.zone.tzid !== 'floating' && t.zone !== ZONE ? t.convertToZone(ZONE) : t.zone === ICAL.Timezone.utcTimezone ? t.convertToZone(ZONE) : t;
  return `${l.year}-${pad(l.month)}-${pad(l.day)}T${pad(l.hour)}:${pad(l.minute)}`;
}
function ms(t) { return t ? t.toJSDate().getTime() : null; }
function registerTimezones(root) {
  for (const tz of root.getAllSubcomponents('vtimezone')) {
    const id = tz.getFirstPropertyValue('tzid');
    if (id && !ICAL.TimezoneService.has(id)) { try { ICAL.TimezoneService.register(new ICAL.Timezone(tz)); } catch { /* */ } }
  }
}
function parse(text) {
  const root = new ICAL.Component(ICAL.parse(text));
  registerTimezones(root);
  return root;
}

// ---------------------------------------------------------------- herhaling <-> eenvoudig object
const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
function recurToObj(recur) {
  if (!recur) return null;
  const o = { freq: recur.freq, interval: recur.interval || 1 };
  if (recur.parts.BYDAY) o.byday = recur.parts.BYDAY.slice();
  if (recur.parts.BYMONTHDAY) o.bymonthday = recur.parts.BYMONTHDAY.slice();
  if (recur.parts.BYSETPOS) o.bysetpos = recur.parts.BYSETPOS.slice();
  if (recur.parts.BYMONTH) o.bymonth = recur.parts.BYMONTH.slice();
  if (recur.count) o.count = recur.count;
  if (recur.until) o.until = fmtLocal(recur.until).slice(0, 10);
  o.text = recurText(o);
  return o;
}
function objToRecur(o, startTime) {
  if (!o || !o.freq) return null;
  const freq = String(o.freq).toUpperCase();
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) throw new Error('Ongeldige herhaling');
  const data = { freq, interval: Math.max(1, Math.min(999, Number(o.interval) || 1)) };
  const parts = {};
  if (Array.isArray(o.byday) && o.byday.length) parts.BYDAY = o.byday.map((d) => String(d).toUpperCase()).filter((d) => /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/.test(d));
  if (Array.isArray(o.bymonthday) && o.bymonthday.length) parts.BYMONTHDAY = o.bymonthday.map(Number).filter((n) => n >= -31 && n <= 31 && n);
  if (Array.isArray(o.bysetpos) && o.bysetpos.length) parts.BYSETPOS = o.bysetpos.map(Number);
  if (Array.isArray(o.bymonth) && o.bymonth.length) parts.BYMONTH = o.bymonth.map(Number);
  const r = new ICAL.Recur({ ...data, parts });
  if (o.count) r.count = Math.max(1, Math.min(5000, Number(o.count)));
  else if (o.until) {
    // tot en met die dag
    const u = toTime(o.until, true);
    if (startTime && !startTime.isDate) { const t = ICAL.Time.fromData({ year: u.year, month: u.month, day: u.day, hour: 23, minute: 59, second: 59 }, ZONE); r.until = t.convertToZone(ICAL.Timezone.utcTimezone); }
    else r.until = u;
  }
  return r;
}
const DAYNAME = { MO: 'maandag', TU: 'dinsdag', WE: 'woensdag', TH: 'donderdag', FR: 'vrijdag', SA: 'zaterdag', SU: 'zondag' };
const DAYSHORT = { MO: 'ma', TU: 'di', WE: 'wo', TH: 'do', FR: 'vr', SA: 'za', SU: 'zo' };
const MONTHS = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
function recurText(o) {
  if (!o) return '';
  const n = o.interval || 1;
  const posName = { 1: 'eerste', 2: 'tweede', 3: 'derde', 4: 'vierde', '-1': 'laatste' };
  let s;
  if (o.freq === 'DAILY') s = n === 1 ? 'Elke dag' : `Om de ${n} dagen`;
  else if (o.freq === 'WEEKLY') {
    const days = (o.byday || []).map((d) => d.slice(-2));
    const weekdays = ['MO', 'TU', 'WE', 'TH', 'FR'];
    const list = days.length === 5 && weekdays.every((d) => days.includes(d)) ? 'werkdag' : days.length ? days.map((d) => DAYSHORT[d]).join(', ') : '';
    s = n === 1 ? (list === 'werkdag' ? 'Elke werkdag' : `Elke week${list ? ` op ${list}` : ''}`) : `Om de ${n} weken${list ? ` op ${list}` : ''}`;
  } else if (o.freq === 'MONTHLY') {
    let on = '';
    if (o.bymonthday && o.bymonthday.length) on = o.bymonthday[0] === -1 ? ' op de laatste dag' : ` op de ${o.bymonthday.join(', ')}e`;
    else if (o.byday && o.byday.length) { const m = o.byday[0].match(/^([+-]?\d+)?(\w\w)$/); const pos = m[1] || (o.bysetpos && o.bysetpos[0]); if (pos) on = ` op de ${posName[String(Number(pos))] || `${pos}e`} ${DAYNAME[m[2]]}`; }
    s = (n === 1 ? 'Elke maand' : `Om de ${n} maanden`) + on;
  } else if (o.freq === 'YEARLY') s = n === 1 ? 'Elk jaar' : `Om de ${n} jaar`;
  else s = 'Herhaalt';
  if (o.count) s += `, ${o.count} keer`;
  else if (o.until) { const [y, mo, d] = o.until.split('-').map(Number); s += ` tot ${d} ${MONTHS[mo - 1]} ${y}`; }
  return s;
}

// ---------------------------------------------------------------- VEVENT lezen
function alarmsOf(comp, start) {
  const out = [];
  for (const a of comp.getAllSubcomponents('valarm')) {
    const trig = a.getFirstProperty('trigger'); if (!trig) continue;
    const v = trig.getFirstValue();
    if (v instanceof ICAL.Duration) {
      if (trig.getParameter('related') === 'END') continue; // zeldzaam, negeren
      out.push({ min: Math.round(-v.toSeconds() / 60) });
    } else if (v instanceof ICAL.Time && start) {
      out.push({ min: Math.round((ms(start) - ms(v)) / 60000) });
    }
  }
  return out;
}
function textList(comp, name) { return comp.getAllProperties(name).flatMap((p) => p.getValues()).map(String).filter(Boolean); }
function eventFields(ev) {
  const c = ev.component;
  const start = ev.startDate, end = ev.endDate;
  return {
    uid: ev.uid,
    title: ev.summary || '(zonder titel)',
    location: ev.location || '',
    description: ev.description || '',
    url: c.getFirstPropertyValue('url') || '',
    color: c.getFirstPropertyValue('color') || '',
    categories: textList(c, 'categories'),
    transp: (c.getFirstPropertyValue('transp') || 'OPAQUE').toUpperCase(),
    status: (c.getFirstPropertyValue('status') || 'CONFIRMED').toUpperCase(),
    allDay: !!(start && start.isDate),
    alarms: alarmsOf(c, start),
    attendees: c.getAllProperties('attendee').map((p) => p.getParameter('cn') || String(p.getFirstValue()).replace(/^mailto:/i, '')).filter(Boolean),
    startLocal: fmtLocal(start), endLocal: fmtLocal(end),
  };
}
// alle afspraken uit één bestand (master + uitzonderingen)
function readEvents(root) {
  const vevents = root.getAllSubcomponents('vevent');
  const masters = [], exceptions = [];
  for (const v of vevents) { const e = new ICAL.Event(v); (e.isRecurrenceException() ? exceptions : masters).push(e); }
  for (const m of masters) for (const ex of exceptions) if (ex.uid === m.uid) { try { m.relateException(ex); } catch { /* */ } }
  // losse uitzonderingen zonder master (komt voor bij uitnodigingen)
  const orphans = exceptions.filter((ex) => !masters.some((m) => m.uid === ex.uid));
  return { masters, orphans };
}
// alle voorkomens binnen [from, to) (ms)
function expandEvents(root, from, to, max = 2000) {
  const { masters, orphans } = readEvents(root);
  const out = [];
  const add = (ev, start, end, recurrenceId, recurring) => {
    const s = ms(start), e = end ? ms(end) : s + (start.isDate ? 86400000 : 0);
    const endMs = Math.max(e, s);
    if (endMs < from || s >= to) return;
    if (start.isDate && endMs === s) { /* lege hele-dag */ }
    const f = eventFields(ev);
    out.push({ ...f, start: s, end: endMs, startLocal: fmtLocal(start), endLocal: fmtLocal(end || start), recurring, recurrenceId: recurrenceId ? fmtLocal(recurrenceId) : null });
  };
  for (const m of masters) {
    if (!m.startDate) continue;
    if (!m.isRecurring()) { add(m, m.startDate, m.endDate, null, false); continue; }
    const it = m.iterator();
    let next, n = 0;
    const dur = m.duration;
    while ((next = it.next()) && n < max) {
      n++;
      const nms = ms(next);
      if (nms >= to) break;
      if (nms + Math.max(0, dur ? dur.toSeconds() * 1000 : 0) + 86400000 * 2 < from) continue;
      let det; try { det = m.getOccurrenceDetails(next); } catch { continue; }
      add(det.item, det.startDate, det.endDate, det.recurrenceId, true);
    }
  }
  for (const o of orphans) add(o, o.startDate, o.endDate, o.recurrenceId, true);
  return out;
}

// ---------------------------------------------------------------- VEVENT schrijven
function setProp(comp, name, value) {
  comp.removeAllProperties(name);
  if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) return;
  if (Array.isArray(value)) { const p = new ICAL.Property(name, comp); p.setValues(value); comp.addProperty(p); return; }
  comp.addPropertyWithValue(name, value);
}
function setTimeProp(comp, name, time) {
  comp.removeAllProperties(name);
  if (!time) return;
  const p = new ICAL.Property(name, comp);
  p.setValue(time);
  if (!time.isDate && time.zone === ZONE) p.setParameter('tzid', TZID);
  comp.addProperty(p);
}
function setAlarms(comp, alarms, title) {
  for (const a of comp.getAllSubcomponents('valarm')) comp.removeSubcomponent(a);
  for (const a of alarms || []) {
    const min = Number(a.min); if (!Number.isFinite(min)) continue;
    const va = new ICAL.Component('valarm');
    va.addPropertyWithValue('action', 'DISPLAY');
    va.addPropertyWithValue('description', title || 'Herinnering');
    const dur = ICAL.Duration.fromSeconds(-min * 60);
    va.addPropertyWithValue('trigger', dur);
    va.addPropertyWithValue('x-wr-alarmuid', crypto.randomUUID());
    comp.addSubcomponent(va);
  }
}
// velden uit een eenvoudig object op een VEVENT-component zetten
function applyEventFields(comp, o, { keepRecurrence = false } = {}) {
  const allDay = !!o.allDay;
  const start = toTime(o.start, allDay);
  let end = o.end ? toTime(o.end, allDay) : null;
  if (allDay) { if (!end || end.compare(start) <= 0) { end = start.clone(); end.day += 1; end = ICAL.Time.fromData({ year: end.year, month: end.month, day: end.day, isDate: true }); end.normalize(); } }
  else if (!end || end.compare(start) < 0) { end = start.clone(); end.hour += 1; end.normalize(); }
  setTimeProp(comp, 'dtstart', start);
  comp.removeAllProperties('duration');
  setTimeProp(comp, 'dtend', end);
  setProp(comp, 'summary', String(o.title || '').slice(0, 300) || 'Nieuwe afspraak');
  setProp(comp, 'location', String(o.location || '').slice(0, 300));
  setProp(comp, 'description', String(o.description || '').slice(0, 20000));
  setProp(comp, 'url', String(o.url || '').slice(0, 1000));
  setProp(comp, 'color', /^#[0-9a-f]{6}$/i.test(o.color || '') ? o.color : '');
  setProp(comp, 'categories', (o.categories || []).map((x) => String(x).trim()).filter(Boolean).slice(0, 20));
  setProp(comp, 'transp', o.transp === 'TRANSPARENT' ? 'TRANSPARENT' : 'OPAQUE');
  setProp(comp, 'status', ['TENTATIVE', 'CANCELLED'].includes(o.status) ? o.status : 'CONFIRMED');
  comp.removeAllProperties('attendee');
  for (const n of (o.attendees || []).map((x) => String(x).trim()).filter(Boolean).slice(0, 30)) {
    const p = new ICAL.Property('attendee', comp);
    p.setValue(/@/.test(n) ? `mailto:${n}` : `urn:name:${encodeURIComponent(n)}`);
    p.setParameter('cn', n); comp.addProperty(p);
  }
  if (!keepRecurrence) {
    comp.removeAllProperties('rrule');
    const r = objToRecur(o.repeat, start);
    if (r) comp.addPropertyWithValue('rrule', r);
  }
  setAlarms(comp, o.alarms, o.title);
  setProp(comp, 'last-modified', nowStamp());
  setProp(comp, 'dtstamp', nowStamp());
  const seq = Number(comp.getFirstPropertyValue('sequence') || 0); setProp(comp, 'sequence', seq + 1);
  return { start, end };
}
function wrapCalendar(components) {
  const cal = new ICAL.Component(['vcalendar', [], []]);
  cal.addPropertyWithValue('prodid', '-//Rawendpaneel//NL');
  cal.addPropertyWithValue('version', '2.0');
  cal.addSubcomponent(new ICAL.Component(ICAL.parse(`BEGIN:VCALENDAR\r\n${VTIMEZONE}\r\nEND:VCALENDAR`)).getFirstSubcomponent('vtimezone'));
  for (const c of components) cal.addSubcomponent(c);
  return cal;
}
function ensureTz(root) {
  if (!root.getAllSubcomponents('vtimezone').some((t) => t.getFirstPropertyValue('tzid') === TZID)) {
    root.addSubcomponent(new ICAL.Component(ICAL.parse(`BEGIN:VCALENDAR\r\n${VTIMEZONE}\r\nEND:VCALENDAR`)).getFirstSubcomponent('vtimezone'));
  }
}
function newEvent(o) {
  const v = new ICAL.Component('vevent');
  const uid = o.uid || newUid();
  v.addPropertyWithValue('uid', uid);
  v.addPropertyWithValue('created', nowStamp());
  applyEventFields(v, o);
  return { uid, text: wrapCalendar([v]).toString() };
}
function findMaster(root, uid) { return root.getAllSubcomponents('vevent').find((v) => v.getFirstPropertyValue('uid') === uid && !v.hasProperty('recurrence-id')); }
function findOverride(root, uid, recId) {
  return root.getAllSubcomponents('vevent').find((v) => v.getFirstPropertyValue('uid') === uid && v.hasProperty('recurrence-id') && fmtLocal(v.getFirstPropertyValue('recurrence-id')) === recId);
}
// recurrence-id ("2026-10-09T07:00" of "2026-10-09") -> ICAL.Time met dezelfde soort als de master
function recIdTime(master, recId) {
  const ms0 = master.getFirstPropertyValue('dtstart');
  if (ms0.isDate) return toTime(recId, true);
  const t = toTime(recId, false);
  if (ms0.zone === ICAL.Timezone.utcTimezone) return t.convertToZone(ICAL.Timezone.utcTimezone);
  return t;
}
function addExdate(master, time) {
  const p = new ICAL.Property('exdate', master);
  p.setValue(time);
  if (!time.isDate && time.zone === ZONE) p.setParameter('tzid', TZID);
  master.addProperty(p);
}
/**
 * Afspraak aanpassen.
 * scope: 'all' (hele reeks), 'this' (enkel dit voorkomen), 'future' (dit en volgende)
 * Geeft { text, extra?: {uid, text} } terug (extra = nieuwe reeks bij 'future').
 */
function editEvent(text, uid, o, scope = 'all', recId = null) {
  const root = parse(text); ensureTz(root);
  const master = findMaster(root, uid);
  if (!master) {
    // enkel uitzondering zonder master: gewoon die aanpassen
    const only = root.getAllSubcomponents('vevent').find((v) => v.getFirstPropertyValue('uid') === uid);
    if (!only) throw new Error('Afspraak niet gevonden');
    applyEventFields(only, o, { keepRecurrence: true });
    return { text: root.toString() };
  }
  const recurring = master.hasProperty('rrule') || master.hasProperty('rdate');
  if (!recurring || scope === 'all' || !recId) {
    if (recurring && recId && o.start) {
      // aangepast vanuit één voorkomen: de hele reeks evenveel verschuiven
      const allDay = !!o.allDay;
      const oldOcc = recIdTime(master, recId);
      const newStart = toTime(o.start, allDay), newEnd = o.end ? toTime(o.end, allDay) : null;
      const m0 = master.getFirstPropertyValue('dtstart');
      if (allDay) {
        const dayShift = Math.round((ms(newStart) - ms(oldOcc)) / 86400000);
        const ns = ICAL.Time.fromData({ year: m0.year, month: m0.month, day: m0.day + dayShift, isDate: true }); ns.normalize();
        const len = newEnd ? Math.max(1, Math.round((ms(newEnd) - ms(newStart)) / 86400000)) : 1;
        const ne = ns.clone(); ne.day += len; ne.normalize();
        o = { ...o, start: fmtLocal(ns), end: fmtLocal(ne) };
      } else {
        const shift = ms(newStart) - ms(oldOcc);
        const ns = ICAL.Time.fromJSDate(new Date(ms(m0) + shift), true).convertToZone(ZONE);
        const dur = newEnd ? ms(newEnd) - ms(newStart) : 3600000;
        const ne = ICAL.Time.fromJSDate(new Date(ms(ns) + dur), true).convertToZone(ZONE);
        o = { ...o, start: fmtLocal(ns), end: fmtLocal(ne) };
      }
    }
    const before = master.getFirstPropertyValue('dtstart');
    applyEventFields(master, o, { keepRecurrence: o.repeat === undefined });
    if (recurring) shiftExceptions(root, master, before, master.getFirstPropertyValue('dtstart'));
    return { text: root.toString() };
  }
  if (scope === 'this') {
    let ov = findOverride(root, uid, recId);
    if (!ov) {
      ov = new ICAL.Component('vevent');
      ov.addPropertyWithValue('uid', uid);
      const rt = recIdTime(master, recId);
      const p = new ICAL.Property('recurrence-id', ov); p.setValue(rt); if (!rt.isDate && rt.zone === ZONE) p.setParameter('tzid', TZID); ov.addProperty(p);
      root.addSubcomponent(ov);
    }
    applyEventFields(ov, { ...o, repeat: null }, { keepRecurrence: false });
    ov.removeAllProperties('rrule');
    return { text: root.toString() };
  }
  // 'future': oude reeks laten stoppen vóór dit voorkomen, nieuwe reeks beginnen
  const occ = recIdTime(master, recId);
  const rr = master.getFirstPropertyValue('rrule');
  const oldRepeat = recurToObj(rr);
  stopBefore(root, master, rr, occ);
  const repeat = o.repeat === undefined ? (oldRepeat ? { ...oldRepeat, until: undefined, count: undefined } : null) : o.repeat;
  const created = newEvent({ ...o, repeat });
  return { text: root.toString(), extra: created };
}
// reeks verschoven: uitzonderingen (EXDATE / RECURRENCE-ID) mee verschuiven
function shiftExceptions(root, master, before, after) {
  if (!before || !after) return;
  const move = (t) => {
    if (t.isDate || before.isDate || after.isDate) {
      const days = Math.round((ms(after) - ms(before)) / 86400000); if (!days) return t;
      const n = t.clone(); n.day += days; n.normalize(); return n;
    }
    const delta = ms(after) - ms(before); if (!delta) return t;
    const n = ICAL.Time.fromJSDate(new Date(ms(t) + delta), true);
    return t.zone === ICAL.Timezone.utcTimezone ? n : n.convertToZone(t.zone && t.zone.tzid !== 'floating' ? t.zone : ZONE);
  };
  for (const p of master.getAllProperties('exdate')) p.setValues(p.getValues().map(move));
  const uid = master.getFirstPropertyValue('uid');
  for (const v of root.getAllSubcomponents('vevent')) {
    if (v === master || v.getFirstPropertyValue('uid') !== uid) continue;
    const p = v.getFirstProperty('recurrence-id'); if (p) p.setValue(move(p.getFirstValue()));
  }
}
// reeks laten eindigen net vóór 'occ' en latere uitzonderingen weghalen
function stopBefore(root, master, rr, occ) {
  if (occ.isDate) { const u = occ.clone(); u.day -= 1; u.normalize(); rr.until = u; }
  else rr.until = ICAL.Time.fromJSDate(new Date(ms(occ) - 1000), true);
  rr.count = null;
  master.updatePropertyWithValue('rrule', rr);
  const uid = master.getFirstPropertyValue('uid');
  for (const v of root.getAllSubcomponents('vevent')) {
    if (v !== master && v.getFirstPropertyValue('uid') === uid && v.hasProperty('recurrence-id') && ms(v.getFirstPropertyValue('recurrence-id')) >= ms(occ)) root.removeSubcomponent(v);
  }
}
/** verwijderen: 'all' => null (bestand weg), 'this' => EXDATE, 'future' => UNTIL */
function deleteEvent(text, uid, scope = 'all', recId = null) {
  const root = parse(text);
  const master = findMaster(root, uid);
  if (!master || scope === 'all' || !recId) return null;
  const rt = recIdTime(master, recId);
  if (scope === 'this') {
    const ov = findOverride(root, uid, recId); if (ov) root.removeSubcomponent(ov);
    addExdate(master, rt);
    return root.toString();
  }
  const rr = master.getFirstPropertyValue('rrule'); if (!rr) return null;
  stopBefore(root, master, rr, rt);
  return root.toString();
}
// details van de master om te bewerken
function eventDetails(text, uid) {
  const root = parse(text);
  const m = findMaster(root, uid) || root.getAllSubcomponents('vevent').find((v) => v.getFirstPropertyValue('uid') === uid);
  if (!m) return null;
  const ev = new ICAL.Event(m);
  const rr = m.getFirstPropertyValue('rrule');
  return { ...eventFields(ev), repeat: recurToObj(rr), exdates: m.getAllProperties('exdate').map((p) => fmtLocal(p.getFirstValue())) };
}

// ---------------------------------------------------------------- VTODO (taken)
function todoFields(c) {
  const due = c.getFirstPropertyValue('due');
  const start = c.getFirstPropertyValue('dtstart');
  const completed = c.getFirstPropertyValue('completed');
  const rr = c.getFirstPropertyValue('rrule');
  return {
    uid: c.getFirstPropertyValue('uid'),
    title: c.getFirstPropertyValue('summary') || '(zonder titel)',
    description: c.getFirstPropertyValue('description') || '',
    due: due ? fmtLocal(due) : null,
    dueMs: due ? ms(due) : null,
    dueAllDay: !!(due && due.isDate),
    start: start ? fmtLocal(start) : null,
    priority: Number(c.getFirstPropertyValue('priority') || 0),
    status: (c.getFirstPropertyValue('status') || 'NEEDS-ACTION').toUpperCase(),
    done: (c.getFirstPropertyValue('status') || '').toUpperCase() === 'COMPLETED',
    completedAt: completed ? ms(completed) : null,
    categories: textList(c, 'categories'),
    repeat: recurToObj(rr),
    alarms: alarmsOf(c, due || start),
    parent: (c.getFirstProperty('related-to') && c.getFirstPropertyValue('related-to')) || null,
    created: c.getFirstPropertyValue('created') ? ms(c.getFirstPropertyValue('created')) : null,
    order: Number(c.getFirstPropertyValue('x-apple-sort-order') || 0),
  };
}
function readTodos(root) { return root.getAllSubcomponents('vtodo').map(todoFields); }
function applyTodoFields(c, o) {
  if (o.title !== undefined) setProp(c, 'summary', String(o.title || '').slice(0, 300) || 'Nieuwe taak');
  if (o.description !== undefined) setProp(c, 'description', String(o.description || '').slice(0, 20000));
  if (o.due !== undefined) {
    const allDay = o.due && !/T\d/.test(o.due);
    setTimeProp(c, 'due', o.due ? toTime(o.due, allDay) : null);
    // DTSTART moet hetzelfde type hebben als DUE (anders weigeren sommige apps de taak)
    if (c.hasProperty('dtstart')) setTimeProp(c, 'dtstart', o.due ? toTime(o.due, allDay) : null);
  }
  if (o.priority !== undefined) setProp(c, 'priority', [0, 1, 5, 9].includes(Number(o.priority)) ? Number(o.priority) || '' : '');
  if (o.categories !== undefined) setProp(c, 'categories', (o.categories || []).map((x) => String(x).trim()).filter(Boolean).slice(0, 20));
  if (o.repeat !== undefined) {
    c.removeAllProperties('rrule');
    const due = c.getFirstPropertyValue('due');
    const r = o.repeat ? objToRecur(o.repeat, due) : null;
    if (r) {
      if (!due) throw new Error('Een herhalende taak heeft een datum nodig.');
      if (!c.hasProperty('dtstart')) setTimeProp(c, 'dtstart', due.clone());
      c.addPropertyWithValue('rrule', r);
    }
  }
  if (o.alarms !== undefined) setAlarms(c, o.alarms, o.title || c.getFirstPropertyValue('summary'));
  if (o.parent !== undefined) setProp(c, 'related-to', o.parent || '');
  if (o.done !== undefined) {
    if (o.done) { setProp(c, 'status', 'COMPLETED'); setProp(c, 'completed', nowStamp()); setProp(c, 'percent-complete', 100); }
    else { setProp(c, 'status', 'NEEDS-ACTION'); c.removeAllProperties('completed'); c.removeAllProperties('percent-complete'); }
  }
  setProp(c, 'last-modified', nowStamp());
  setProp(c, 'dtstamp', nowStamp());
}
function newTodo(o) {
  const c = new ICAL.Component('vtodo');
  const uid = o.uid || newUid();
  c.addPropertyWithValue('uid', uid);
  c.addPropertyWithValue('created', nowStamp());
  setProp(c, 'status', 'NEEDS-ACTION');
  applyTodoFields(c, { ...o, repeat: undefined });
  if (o.repeat) applyTodoFields(c, { repeat: o.repeat });
  return { uid, text: wrapCalendar([c]).toString() };
}
function editTodo(text, uid, o) {
  const root = parse(text); ensureTz(root);
  const c = root.getAllSubcomponents('vtodo').find((x) => x.getFirstPropertyValue('uid') === uid);
  if (!c) throw new Error('Taak niet gevonden');
  // herhalende taak afvinken: volgende datum zetten in plaats van afvinken
  if (o.done === true && c.hasProperty('rrule')) {
    const due = c.getFirstPropertyValue('due') || c.getFirstPropertyValue('dtstart');
    const rr = c.getFirstPropertyValue('rrule');
    if (due && rr) {
      const it = rr.iterator(c.getFirstPropertyValue('dtstart') || due);
      let next, guard = 0; const nowMs = Date.now();
      while ((next = it.next()) && guard++ < 5000) { if (next.compare(due) > 0 && (ms(next) > nowMs - 86400000 || !due.isDate)) break; }
      if (next) {
        const nd = due.isDate ? ICAL.Time.fromData({ year: next.year, month: next.month, day: next.day, isDate: true }) : next;
        setTimeProp(c, 'due', nd); if (c.hasProperty('dtstart')) setTimeProp(c, 'dtstart', nd.clone());
        c.removeAllProperties('completed'); setProp(c, 'status', 'NEEDS-ACTION');
        const rest = { ...o }; delete rest.done; applyTodoFields(c, rest);
        return { text: root.toString(), advanced: fmtLocal(nd) };
      }
      // reeks is op: echt afvinken
    }
  }
  applyTodoFields(c, o);
  return { text: root.toString() };
}

// ---------------------------------------------------------------- feeds en import
function feed(name, color, texts) {
  const cal = new ICAL.Component(['vcalendar', [], []]);
  cal.addPropertyWithValue('prodid', '-//Rawendpaneel//NL');
  cal.addPropertyWithValue('version', '2.0');
  cal.addPropertyWithValue('x-wr-calname', name);
  if (color) cal.addPropertyWithValue('x-apple-calendar-color', color);
  cal.addPropertyWithValue('x-wr-timezone', TZID);
  const tzs = new Set();
  const out = [];
  for (const t of texts) {
    let root; try { root = parse(t); } catch { continue; }
    for (const tz of root.getAllSubcomponents('vtimezone')) { const id = tz.getFirstPropertyValue('tzid'); if (!tzs.has(id)) { tzs.add(id); cal.addSubcomponent(tz); } }
    for (const c of [...root.getAllSubcomponents('vevent'), ...root.getAllSubcomponents('vtodo')]) out.push(c);
  }
  if (!tzs.has(TZID)) cal.addSubcomponent(new ICAL.Component(ICAL.parse(`BEGIN:VCALENDAR\r\n${VTIMEZONE}\r\nEND:VCALENDAR`)).getFirstSubcomponent('vtimezone'));
  for (const c of out) cal.addSubcomponent(c);
  return cal.toString();
}
// een groot .ics-bestand opsplitsen in losse items (per UID)
function splitIcs(text) {
  const root = parse(text);
  const tzs = root.getAllSubcomponents('vtimezone');
  const byUid = new Map();
  for (const c of [...root.getAllSubcomponents('vevent'), ...root.getAllSubcomponents('vtodo')]) {
    let uid = c.getFirstPropertyValue('uid');
    if (!uid) { uid = newUid(); c.addPropertyWithValue('uid', uid); }
    if (!byUid.has(uid)) byUid.set(uid, []);
    byUid.get(uid).push(c);
  }
  const items = [];
  for (const [uid, comps] of byUid) {
    const cal = new ICAL.Component(['vcalendar', [], []]);
    cal.addPropertyWithValue('prodid', '-//Rawendpaneel//NL');
    cal.addPropertyWithValue('version', '2.0');
    for (const tz of tzs) cal.addSubcomponent(new ICAL.Component(tz.toJSON()));
    for (const c of comps) cal.addSubcomponent(c);
    items.push({ uid, text: cal.toString(), kind: comps[0].name });
  }
  return items;
}

// ---------------------------------------------------------------- Belgische feestdagen
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(y, month - 1, day));
}
function holidaysBE(year) {
  const e = easter(year);
  const plus = (n) => { const d = new Date(e); d.setUTCDate(d.getUTCDate() + n); return d; };
  const D = (m, d) => new Date(Date.UTC(year, m - 1, d));
  const list = [[D(1, 1), 'Nieuwjaar'], [e, 'Pasen'], [plus(1), 'Paasmaandag'], [D(5, 1), 'Dag van de Arbeid'], [plus(39), 'O.L.H. Hemelvaart'], [plus(49), 'Pinksteren'], [plus(50), 'Pinkstermaandag'],
    [D(7, 11), 'Feest van de Vlaamse Gemeenschap'], [D(7, 21), 'Nationale feestdag'], [D(8, 15), 'O.L.V. Hemelvaart'], [D(11, 1), 'Allerheiligen'], [D(11, 11), 'Wapenstilstand'], [D(12, 25), 'Kerstmis']];
  return list.map(([d, title]) => ({ date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, title }));
}

module.exports = {
  ICAL, TZID, VTIMEZONE, ZONE, toTime, fmtLocal, ms, parse, newUid, recurText, recurToObj, objToRecur,
  expandEvents, readEvents, eventDetails, newEvent, editEvent, deleteEvent, eventFields,
  readTodos, newTodo, editTodo, todoFields, feed, splitIcs, holidaysBE, DAYS,
};
