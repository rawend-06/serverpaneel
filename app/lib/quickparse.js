'use strict';
/*
 * Snel typen: Nederlandse zinnetjes omzetten naar een afspraak, taak, uitgave, notitie of aftelling.
 *   "vrijdag 7-15 werk"           -> afspraak vr 07:00-15:00 "Werk" (agenda Werk)
 *   "morgen 14u tandarts"         -> afspraak morgen 14:00-15:00
 *   "elke dinsdag vuilbak buiten" -> herhalende taak
 *   "€12,50 broodjes"             -> uitgave
 *   "examen 19 oktober aftellen"  -> aftelling
 */
const pad = (n) => String(n).padStart(2, '0');
const DAYS = { zondag: 0, zo: 0, maandag: 1, ma: 1, dinsdag: 2, di: 2, woensdag: 3, wo: 3, donderdag: 4, do: 4, vrijdag: 5, vr: 5, zaterdag: 6, za: 6 };
const ICS_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const MONTHS = { januari: 1, jan: 1, februari: 2, feb: 2, maart: 3, mrt: 3, april: 4, apr: 4, mei: 5, juni: 6, jun: 6, juli: 7, jul: 7, augustus: 8, aug: 8, september: 9, sep: 9, sept: 9, oktober: 10, okt: 10, november: 11, nov: 11, december: 12, dec: 12 };
const EXPENSE_CATS = [
  ['Eten & drinken', /\b(eten|broodje|broodjes|lunch|ontbijt|diner|avondeten|snack|koffie|frietjes?|pizza|kebab|restaurant|mcdo|mcdonalds|burger|drank|drinken|cola|resto)\b/],
  ['Boodschappen', /\b(boodschappen|winkel|supermarkt|delhaize|colruyt|aldi|lidl|carrefour|albert heijn|ah)\b/],
  ['Uitgaan', /\b(uitgaan|cinema|film|concert|feest|cafe|café|bar|bowling|club|tickets?)\b/],
  ['Vervoer', /\b(trein|bus|tram|de lijn|nmbs|sncb|tank|tanken|benzine|diesel|parking|uber|taxi|fiets|velo)\b/],
  ['Abonnementen', /\b(spotify|netflix|disney|abonnement|youtube|icloud|gsm|telefoon|internet|proximus|telenet|orange|chatgpt)\b/],
  ['Kleding', /\b(kleren|kleding|schoenen|jas|broek|t-shirt|trui|zara|h&m|primark)\b/],
  ['School', /\b(school|boek|boeken|cursus|ucll|printen|kopies|laptop)\b/],
  ['Cadeaus', /\b(cadeau|cadeaus|kado|geschenk|verjaardag)\b/],
];

function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function ymd(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

/**
 * @param {string} input
 * @param {{now?:Date, calendars?:{id,name}[], templates?:{name,title,start,end,cal}[]}} opt
 */
function parse(input, opt = {}) {
  const now = opt.now ? new Date(opt.now) : new Date();
  const original = String(input || '').trim();
  let s = ` ${original.toLowerCase().replace(/\s+/g, ' ')} `;
  const used = []; // stukken die we herkend hebben (worden uit de titel gehaald)
  const take = (re, fn) => { const m = s.match(re); if (!m) return null; const r = fn ? fn(m) : m; if (r !== false && r !== null) { s = s.replace(m[0], ' '); used.push(m[0].trim()); } return r === false ? null : r; };

  // ---- soort expliciet
  let kind = null;
  take(/\s(?:taak|todo|to-do|te doen)\s*:?\s/, () => { kind = 'task'; return true; });
  take(/\s(?:notitie|noteer|note)\s*:?\s/, () => { kind = 'note'; return true; });
  take(/\s(?:aftellen|countdown|aftelling)(?:\s+(?:tot|naar))?\s*:?\s/, () => { kind = 'countdown'; return true; });
  take(/\s(?:afspraak|event)\s*:?\s/, () => { kind = 'event'; return true; });
  take(/\s(?:uitgave|betaald|gekocht|kost(?:te)?)\s*:?\s/, () => { kind = 'expense'; return true; });

  // ---- bedrag
  let amount = null;
  take(/\s(?:€\s?(\d{1,6}(?:[.,]\d{1,2})?)|(\d{1,6}(?:[.,]\d{1,2})?)\s?(?:€|euro|eur)\b)\s/, (m) => { amount = Math.round(parseFloat((m[1] || m[2]).replace(',', '.')) * 100); return true; });
  if (amount == null) take(/\s(\d{1,5},\d{2})\s/, (m) => { amount = Math.round(parseFloat(m[1].replace(',', '.')) * 100); return true; });
  if (amount != null && !kind) kind = 'expense';

  // ---- herhaling
  let repeat = null;
  take(/\s(?:elke|iedere)\s+(werkdag|dag|week|maand|jaar|(?:(?:maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag|ma|di|wo|do|vr|za|zo)(?:\s*(?:,|en)\s*(?:maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag|ma|di|wo|do|vr|za|zo))*))\s/, (m) => {
    const w = m[1];
    if (w === 'dag') repeat = { freq: 'DAILY' };
    else if (w === 'werkdag') repeat = { freq: 'WEEKLY', byday: ['MO', 'TU', 'WE', 'TH', 'FR'] };
    else if (w === 'week') repeat = { freq: 'WEEKLY' };
    else if (w === 'maand') repeat = { freq: 'MONTHLY' };
    else if (w === 'jaar') repeat = { freq: 'YEARLY' };
    else repeat = { freq: 'WEEKLY', byday: w.split(/\s*(?:,|en)\s*/).map((d) => ICS_DAYS[DAYS[d]]) };
    return true;
  });
  take(/\s(?:om de|elke)\s+(\d{1,2})\s+(dagen|weken|maanden)\s/, (m) => { repeat = { freq: { dagen: 'DAILY', weken: 'WEEKLY', maanden: 'MONTHLY' }[m[2]], interval: Number(m[1]) }; return true; });

  // ---- datum
  let date = null;
  const today = startOfDay(now);
  take(/\s(vandaag|vanavond|vanmiddag|vannacht)\s/, (m) => { date = today; if (m[1] === 'vanavond') s += ' __avond '; return true; });
  take(/\s(overmorgen)\s/, () => { date = addDays(today, 2); return true; });
  take(/\s(morgen(?:avond|middag|ochtend|vroeg)?)\s/, (m) => { date = addDays(today, 1); if (/avond/.test(m[1])) s += ' __avond '; return true; });
  take(/\s(gisteren)\s/, () => { date = addDays(today, -1); return true; });
  take(/\sover\s+(\d{1,3}|een|twee|drie)\s+(dag|dagen|week|weken|maand|maanden)\s/, (m) => {
    const n = { een: 1, twee: 2, drie: 3 }[m[1]] || Number(m[1]);
    if (/dag/.test(m[2])) date = addDays(today, n); else if (/week/.test(m[2])) date = addDays(today, 7 * n); else { const d = new Date(today); d.setMonth(d.getMonth() + n); date = d; }
    return true;
  });
  take(/\s(volgende|deze|komende)?\s?week\s/, (m) => { if (m[1] === 'volgende' || m[1] === 'komende') { const d = addDays(today, 7); const dow = (d.getDay() + 6) % 7; date = addDays(d, -dow); } return m[1] ? true : false; });
  take(/\s(\d{1,2})\s+(januari|jan|februari|feb|maart|mrt|april|apr|mei|juni|jun|juli|jul|augustus|aug|september|sept|sep|oktober|okt|november|nov|december|dec)\.?(?:\s+(\d{4}))?\s/, (m) => {
    const y = m[3] ? Number(m[3]) : now.getFullYear();
    let d = new Date(y, MONTHS[m[2]] - 1, Number(m[1]));
    if (!m[3] && d < addDays(today, -1)) d = new Date(y + 1, MONTHS[m[2]] - 1, Number(m[1]));
    date = d; return true;
  });
  take(/\s(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\s/, (m) => {
    const mo = Number(m[2]), da = Number(m[1]); if (mo < 1 || mo > 12 || da < 1 || da > 31) return false;
    let y = m[3] ? Number(m[3]) : now.getFullYear(); if (y < 100) y += 2000;
    let d = new Date(y, mo - 1, da); if (!m[3] && d < addDays(today, -1)) d = new Date(y + 1, mo - 1, da);
    date = d; return true;
  });
  take(/\s(?:(volgende|deze|komende|aanstaande)\s+)?(maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag|ma|di|wo|do|vr|za|zo)(?:avond|middag|ochtend)?\s/, (m) => {
    if (repeat && repeat.byday) return false;
    const target = DAYS[m[2]]; let diff = (target - today.getDay() + 7) % 7;
    if (diff === 0 && m[1] !== 'deze') diff = 7;
    if (m[1] === 'volgende' && diff < 7 && diff <= 3) { /* "volgende vrijdag" op woensdag = deze week, zoals de meeste mensen het bedoelen */ }
    date = addDays(today, diff);
    if (/avond/.test(m[0])) s += ' __avond ';
    return true;
  });

  // ---- tijd
  let startT = null, endT = null;
  const tm = (h, mi) => { let hh = Number(h); const mm = Number(mi || 0); if (hh > 24 || mm > 59) return null; return { h: hh % 24, m: mm }; };
  // 7-15, 7u-15u, 07:00-15:00, van 9 tot 17, 9u tot 17u30
  take(/\s(?:van\s+)?(\d{1,2})(?:[:.u](\d{2}))?\s?u?\s?(?:-|–|tot|t\/m)\s?(\d{1,2})(?:[:.u](\d{2}))?\s?u?(?:ur)?\s/, (m) => {
    const a = tm(m[1], m[2]), b = tm(m[3], m[4]); if (!a || !b) return false;
    startT = a; endT = b; return true;
  });
  if (!startT) take(/\s(?:om\s+)?(\d{1,2})(?:[:.](\d{2})|u(\d{2})?)\s?(?:uur)?\s/, (m) => { const a = tm(m[1], m[2] || m[3]); if (!a) return false; startT = a; return true; });
  if (!startT) take(/\som\s+(\d{1,2})\s?(?:uur)?\s/, (m) => { const a = tm(m[1]); if (!a) return false; startT = a; return true; });
  if (startT && / __avond /.test(s) && startT.h < 12) { startT.h += 12; if (endT && endT.h < 12) endT.h += 12; }
  s = s.replace(/ __avond /g, ' ');
  // duur
  let durMin = null;
  take(/\s(?:voor\s+)?(\d{1,3})\s?(min|minuten|minuut|u|uur|uren)\s/, (m) => { if (!startT) return false; durMin = /min/.test(m[2]) ? Number(m[1]) : Number(m[1]) * 60; return true; });

  // ---- herinnering
  let alarms = null;
  take(/\s(?:herinner(?:ing)?(?:\s+me)?|melding)\s+(\d{1,3})\s?(min|minuten|u|uur|dag|dagen)\s?(?:vooraf|voor|ervoor)?\s/, (m) => { const n = Number(m[1]); alarms = [{ min: /min/.test(m[2]) ? n : /u/.test(m[2]) ? n * 60 : n * 1440 }]; return true; });

  // ---- locatie
  let location = '';
  take(/\s(?:in|@|bij|op)\s+([A-Z][\w'.-]+(?:\s[A-Z][\w'.-]+)*)\s/i, (m) => {
    // enkel als het in de originele tekst met een hoofdletter staat (Leuven, AD Delhaize, ...)
    const idx = original.toLowerCase().indexOf(m[1].toLowerCase());
    const orig = idx >= 0 ? original.slice(idx, idx + m[1].length) : '';
    if (!/^[A-Z@]/.test(orig) && !/^@/.test(m[0].trim())) return false;
    location = orig; return true;
  });

  // ---- titel = wat overblijft
  let title = s.replace(/\s+/g, ' ').trim().replace(/^(om|op|aan|de|het|een|:|-)\s+/, '').replace(/\s+(om|op|de|en)$/, '').trim();
  if (title) {
    // originele schrijfwijze terugzetten
    const idx = original.toLowerCase().indexOf(title);
    title = idx >= 0 ? original.slice(idx, idx + title.length) : title;
    title = title.charAt(0).toUpperCase() + title.slice(1);
  }

  // ---- agenda raden
  let cal = null;
  const cals = opt.calendars || [];
  const tl = (title || '').toLowerCase();
  for (const c of cals) { const n = c.name.toLowerCase(); if (tl === n || tl.startsWith(`${n} `) || tl.endsWith(` ${n}`)) { cal = c.id; break; } }
  if (!cal) {
    if (/\b(werk|shift|dienst|delhaize)\b/.test(tl)) cal = cals.find((c) => /werk/i.test(c.name))?.id || null;
    else if (/\b(les|examen|school|ucll|college|project|deadline|presentatie|toets)\b/.test(tl)) cal = cals.find((c) => /school/i.test(c.name))?.id || null;
    else if (/\bverjaardag\b/.test(tl)) cal = cals.find((c) => /verjaard/i.test(c.name))?.id || null;
  }
  // werkdienst-sjablonen
  let template = null;
  for (const t of opt.templates || []) {
    const [sh, sm] = t.start.split(':').map(Number), [eh, em] = t.end.split(':').map(Number);
    if (startT && endT && startT.h === sh && startT.m === sm && endT.h === eh && endT.m === em && (!t.cal || !cal || t.cal === cal)) { template = t; break; }
    if (!startT && tl && t.name && tl.includes(t.name.toLowerCase())) { template = t; startT = { h: sh, m: sm }; endT = { h: eh, m: em }; title = t.title || title; break; }
  }
  if (template) { if (!cal) cal = template.cal || null; if (!title || title.toLowerCase() === (cals.find((c) => c.id === cal)?.name || '').toLowerCase()) title = template.title || title; }

  // ---- soort bepalen
  if (!kind) {
    if (startT) kind = 'event';
    else if (repeat) kind = 'task';
    else if (date && /\b(examen|vakantie|concert|reis|verjaardag)\b/.test(tl) && /\b(nog|aftel)/.test(original.toLowerCase())) kind = 'countdown';
    else if (date && cal) kind = 'event';
    else if (date) kind = 'task';
    else kind = 'task';
  }

  const result = { kind, title: title || '', input: original, recognized: used };
  if (kind === 'event') {
    const d = date || (startT && (startT.h * 60 + startT.m) < now.getHours() * 60 + now.getMinutes() && !repeat ? addDays(today, 1) : today);
    const day = repeat && repeat.byday && !date ? nextWeekday(today, repeat.byday) : d;
    if (startT) {
      const st = new Date(day); st.setHours(startT.h, startT.m, 0, 0);
      let en;
      if (endT) { en = new Date(day); en.setHours(endT.h, endT.m, 0, 0); if (en <= st) en = addDays(en, 1); }
      else en = new Date(st.getTime() + (durMin || 60) * 60000);
      result.start = `${ymd(st)}T${pad(st.getHours())}:${pad(st.getMinutes())}`;
      result.end = `${ymd(en)}T${pad(en.getHours())}:${pad(en.getMinutes())}`;
      result.allDay = false;
    } else { result.start = ymd(day); result.end = ymd(addDays(day, 1)); result.allDay = true; }
    result.cal = cal; result.location = location; result.repeat = repeat; if (alarms) result.alarms = alarms; result.template = template ? template.name : null;
    if (!result.title) result.title = cals.find((c) => c.id === cal)?.name || 'Afspraak';
  } else if (kind === 'task') {
    let due = date;
    if (!due && repeat) due = repeat.byday ? nextWeekday(today, repeat.byday, true) : today;
    result.due = due ? (startT ? `${ymd(due)}T${pad(startT.h)}:${pad(startT.m)}` : ymd(due)) : null;
    result.repeat = repeat; if (alarms) result.alarms = alarms;
    if (!result.title) result.title = 'Nieuwe taak';
  } else if (kind === 'expense') {
    result.amount = amount; result.date = ymd(date || today);
    const text = `${tl} ${original.toLowerCase()}`;
    result.category = (EXPENSE_CATS.find(([, re]) => re.test(text)) || ['Overig'])[0];
    if (!result.title) result.title = result.category;
  } else if (kind === 'note') {
    result.title = ''; result.text = original.replace(/^\s*(notitie|noteer|note)\s*:?\s*/i, '');
  } else if (kind === 'countdown') {
    result.date = date ? ymd(date) : null;
    result.title = (title || '').replace(/^(tot|naar)\s+/i, '').replace(/\b(nog|aftellen)\b/gi, '').trim() || 'Aftellen';
  }
  result.summary = summarize(result);
  return result;
}
function nextWeekday(today, byday, includeToday = false) {
  for (let i = includeToday ? 0 : 0; i < 8; i++) { const d = addDays(today, i); if (byday.includes(ICS_DAYS[d.getDay()])) return d; }
  return today;
}
const WD = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
const MN = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
function niceDate(str) { if (!str) return ''; const [y, m, d] = str.slice(0, 10).split('-').map(Number); const dt = new Date(y, m - 1, d); return `${WD[dt.getDay()]} ${d} ${MN[m - 1]}`; }
function summarize(r) {
  if (r.kind === 'event') return `${niceDate(r.start)}${r.allDay ? ' · hele dag' : ` · ${r.start.slice(11)} – ${r.end.slice(11)}`}${r.repeat ? ' · herhaalt' : ''}${r.location ? ` · ${r.location}` : ''}`;
  if (r.kind === 'task') return `${r.due ? niceDate(r.due) : 'zonder datum'}${r.repeat ? ' · herhaalt' : ''}`;
  if (r.kind === 'expense') return `€${(r.amount / 100).toFixed(2).replace('.', ',')} · ${r.category} · ${niceDate(r.date)}`;
  if (r.kind === 'countdown') return r.date ? `tot ${niceDate(r.date)}` : 'kies een datum';
  return 'notitie';
}

module.exports = { parse, EXPENSE_CATS: EXPENSE_CATS.map(([n]) => n).concat('Overig') };
