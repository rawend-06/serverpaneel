/* Rawendpaneel – gedeelde hulpjes voor alle pagina's */
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.childElementCount === 1 ? t.content.firstElementChild : t.content; }
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export function debounce(fn, ms = 300) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
export const IS_TOUCH = matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
export const isMobile = () => matchMedia('(max-width: 760px)').matches;
export const IS_IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const STANDALONE = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export const ls = {
  get(k, d) { try { const v = localStorage.getItem(`rp.${k}`); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`rp.${k}`, JSON.stringify(v)); } catch { /* privé-venster */ } },
};

// ---------------------------------------------------------------- iconen (eigen lijn-iconen)
const P = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  cal: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  tasks: 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  globe: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20',
  server: 'M4 3h16v7H4zM4 14h16v7H4zM8 6.5h.01M8 17.5h.01',
  box: 'M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8',
  note: 'M4 4h16v12l-4 4H4zM16 16v4M16 16h4M8 9h8M8 13h5',
  sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3',
  plus: 'M12 5v14M5 12h14', minus: 'M5 12h14',
  cpu: 'M6 6h12v12H6zM9.5 9.5h5v5h-5zM9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4',
  mem: 'M2 7h20v10H2zM6 11v2M10 11v2M14 11v2M18 11v2M6 17v3M18 17v3',
  temp: 'M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z',
  disk: 'M22 12H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11zM6 16h.01M10 16h.01',
  right: 'M9 18l6-6-6-6', left: 'M15 18l-6-6 6-6', down: 'M6 9l6 6 6-6', up: 'M18 15l-6-6-6 6',
  alert: 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01',
  info: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 16v-4M12 8h.01',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  menu: 'M4 6h16M4 12h16M4 18h16',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  clock: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 6v6l4 2',
  pin: 'M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0zM12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  repeat: 'M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3',
  users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  clip: 'M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48',
  tick: 'M20 6 9 17l-5-5', x: 'M18 6 6 18M6 6l12 12',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  spin: 'M21 12a9 9 0 1 1-6.2-8.56',
  tag: 'M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82zM7 7h.01',
  euro: 'M18 7a7 7 0 1 0 0 10M4 10h10M4 14h10',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  ext: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3',
  refresh: 'M23 4v6h-6M20.49 15a9 9 0 1 1-2.12-9.36L23 10',
  logo: 'M9.5 19V5h4.2a3.6 3.6 0 0 1 0 7.2H9.5M13.4 12.2 17.6 19',
  video: 'M23 7l-7 5 7 5zM1 5h15v14H1z',
  flag: 'M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  sun: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z',
  bolt: 'M13 2 3 14h9l-1 8 10-12h-9z',
  grip: 'M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01',
  eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  eyeoff: 'M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c5 0 9 4.5 10 7-.4 1-1.2 2.3-2.4 3.5M6.1 6.1C4 7.5 2.6 9.6 2 12c1 2.5 5 7 10 7 1.9 0 3.6-.6 5-1.5M9.9 9.9a3 3 0 0 0 4.2 4.2',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  copy: 'M9 9h11v11H9zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
  share: 'M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  play: 'M7 5l12 7-12 7z', stop: 'M6 6h12v12H6z', pause: 'M7 5h3v14H7zM14 5h3v14h-3z',
  hammer: 'M14 6l4 4M12 8l-8 8 3 3 8-8M13 4l3-1 5 5-1 3-3-1',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4',
  key: 'M8 11a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM11 12l9-9M17 6l3 3M15 8l2 2',
  wifi: 'M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01',
  power: 'M12 3v8M6.4 6.4a8 8 0 1 0 11.2 0',
  logout: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11',
  terminal: 'M4 17l6-6-6-6M12 19h8',
  zip: 'M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5M10 3v2M10 7v2M10 11v2M9 15h2v3H9z',
  file: 'M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5',
  rocket: 'M5 15c-1.5 1.3-2 4-2 4s2.7-.5 4-2M9 12l3 3M14.5 4.5C17 3 21 3 21 3s0 4-1.5 6.5L13 16l-5-5z',
  wrench: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z',
  sparkle: 'M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z',
  mic: 'M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v3',
  send: 'M22 2 11 13M22 2l-7 20-4-9-9-4z',
  face: 'M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3M9 9v1.5M15 9v1.5M12 9v4.5h-1M9 16c1.7 1.3 4.3 1.3 6 0',
  layout: 'M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z',
  bag: 'M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0',
  star: 'M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z',
  pinned: 'M12 17v5M9 10.76V6h6v4.76l2 3.24H7z M8 6h8',
  check2: 'M5 12.5l4.5 4.5L19 7.5',
  speed: 'M12 14l4-4M3.34 19a10 10 0 1 1 17.32 0',
  cloud: 'M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z',
  activity: 'M22 12h-4l-3 9L9 3l-3 9H2',
  thumbup: 'M7 10v11M7 10l4-8a3 3 0 0 1 3 3v4h5.5a2 2 0 0 1 2 2.3l-1.3 8a2 2 0 0 1-2 1.7H7M7 10H4a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h3',
  thumbdown: 'M17 14V3M17 14l-4 8a3 3 0 0 1-3-3v-4H4.5a2 2 0 0 1-2-2.3l1.3-8a2 2 0 0 1 2-1.7H17M17 14h3a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1h-3',
};
// het logo (R met serverlampjes)
let logoN = 0;
export function logo() { const id = `lg${++logoN}`; return `<svg viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0A1630"/><stop offset=".5" stop-color="#1D4ED8"/><stop offset="1" stop-color="#3B82F6"/></linearGradient></defs><rect width="64" height="64" fill="url(#${id})"/><path d="M23 47V17h11a9 9 0 0 1 0 18H23M32 35l11 12" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="14" cy="22" r="2.4" fill="#93C5FD"/><circle cx="14" cy="32" r="2.4" fill="#DCE8FF"/><circle cx="14" cy="42" r="2.4" fill="#93C5FD" fill-opacity=".6"/></svg>`; }
export function icon(name, cls = '') { return `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${P[name] || ''}"/></svg>`; }

// ---------------------------------------------------------------- opmaak
const MONTHS = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
const MON = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const DAYS = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
const DSH = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
export const T = { MONTHS, MON, DAYS, DSH };
export const pad = (n) => String(n).padStart(2, '0');
export const hm = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const ymd = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const sod = (t = Date.now()) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
export const addDays = (t, n) => { const d = new Date(t); d.setDate(d.getDate() + n); return d.getTime(); };
export const sow = (t, weekStart = 1) => { const d = new Date(sod(t)); const diff = (d.getDay() - weekStart + 7) % 7; d.setDate(d.getDate() - diff); return d.getTime(); };
export const sameDay = (a, b) => ymd(a) === ymd(b);
export const parseYmd = (s) => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d).getTime(); };
export function dayLabel(t, long = false) {
  const today = sod(); const d = sod(t);
  if (d === today) return 'Vandaag'; if (d === addDays(today, 1)) return 'Morgen'; if (d === addDays(today, -1)) return 'Gisteren';
  const dt = new Date(t);
  return long ? `${DAYS[dt.getDay()].replace(/^./, (c) => c.toUpperCase())} ${dt.getDate()} ${MONTHS[dt.getMonth()]}` : `${DSH[dt.getDay()]} ${dt.getDate()} ${MON[dt.getMonth()]}`;
}
export function longDate(t) { const d = new Date(t); return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`; }
export function fmtBytes(b, dec) { if (b == null || Number.isNaN(b)) return '–'; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; let v = b; while (v >= 1000 && i < u.length - 1) { v /= 1024; i++; } return `${v.toFixed(dec ?? (v < 10 && i ? 1 : 0)).replace('.', ',')} ${u[i]}`; }
export const euro = (c, dec = 2) => `€${(Number(c || 0) / 100).toFixed(dec).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
export function ago(t) {
  if (!t) return 'nog nooit';
  const s = (Date.now() - t) / 1000;
  if (s < 45) return 'zojuist'; if (s < 3600) return `${Math.round(s / 60)} min geleden`;
  if (s < 86400) return `${Math.round(s / 3600)} u geleden`; if (s < 172800) return 'gisteren';
  if (s < 7 * 86400) return `${Math.round(s / 86400)} dagen geleden`;
  return new Date(t).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', year: 'numeric' });
}
export function until(t) {
  const m = Math.round((t - Date.now()) / 60000);
  if (m < 0) return 'bezig'; if (m < 1) return 'nu'; if (m < 60) return `over ${m} min`;
  if (m < 24 * 60) { const hh = Math.floor(m / 60), mm = m % 60; return `over ${hh} u${mm ? ` ${mm}` : ''}`; }
  return `over ${Math.round(m / 1440)} dagen`;
}
export function fmtUptime(s) { const d = Math.floor(s / 86400), hh = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); return d ? `${d} d ${hh} u` : hh ? `${hh} u ${m} min` : `${m} min`; }
export const greet = () => { const hr = new Date().getHours(); return hr < 6 ? 'Goedenacht' : hr < 12 ? 'Goedemorgen' : hr < 18 ? 'Goedemiddag' : 'Goedenavond'; };
export const slug = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\.zip$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
export function hexA(hex, a) { const m = String(hex || '#6366F1').match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i); if (!m) return `rgba(99,102,241,${a})`; return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})`; }

// ---------------------------------------------------------------- gebeurtenissen tussen onderdelen
const handlers = new Map();
export const bus = {
  on(ev, fn) { if (!handlers.has(ev)) handlers.set(ev, new Set()); handlers.get(ev).add(fn); return () => handlers.get(ev).delete(fn); },
  emit(ev, data) { for (const fn of handlers.get(ev) || []) { try { fn(data); } catch (e) { console.error(e); } } },
};

// ---------------------------------------------------------------- API
export async function api(method, url, body, opt = {}) {
  let r;
  const isForm = body instanceof FormData;
  try {
    r = await fetch(url, { method, headers: body && !isForm ? { 'Content-Type': 'application/json' } : {}, body: body ? (isForm ? body : JSON.stringify(body)) : undefined, credentials: 'same-origin', signal: opt.signal });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    const err = new Error(navigator.onLine ? 'Geen verbinding met je server' : 'Je bent offline'); err.offline = true; throw err;
  }
  let data = {}; const ct = r.headers.get('content-type') || '';
  if (ct.includes('json')) { try { data = await r.json(); } catch { /* leeg */ } }
  if (r.status === 401 && !/\/api\/(login|me|passkey)/.test(url)) { bus.emit('logout'); throw new Error(data.error || 'Niet ingelogd'); }
  if (r.status === 403 && data.code === 'STEP_UP' && !opt.noStepUp) {
    const ok = await stepUp(data.error);
    if (ok) return api(method, url, body, { ...opt, noStepUp: true });
    const e = new Error('Niet bevestigd'); e.cancelled = true; throw e;
  }
  if (!r.ok) { const e = new Error(data.error || `Fout ${r.status}`); e.status = r.status; e.code = data.code; throw e; }
  return data;
}

// ---------------------------------------------------------------- meldingen onderaan (toast)
export function toast(msg, o = {}) {
  let box = $('.toasts'); if (!box) { box = h('<div class="toasts" role="status" aria-live="polite"></div>'); document.body.appendChild(box); }
  const t = h(`<div class="toast ${o.err ? 'err' : ''}">${o.err ? icon('alert', 'sm') : o.icon ? icon(o.icon, 'sm') : ''}<span>${esc(msg)}</span>${o.action ? `<button class="act">${esc(o.action)}</button>` : ''}</div>`);
  box.appendChild(t);
  const close = () => { t.style.opacity = '0'; t.style.transform = 'translateY(8px)'; t.style.transition = '.2s'; setTimeout(() => t.remove(), 220); };
  if (o.action) $('.act', t).onclick = () => { close(); o.onAction && o.onAction(); };
  setTimeout(close, o.ms || (o.action ? 6000 : 3200));
  return close;
}
export const fail = (e) => { if (e && (e.cancelled || e.name === 'AbortError')) return; toast(e.message || String(e), { err: true }); };

// ---------------------------------------------------------------- dialogen ("sheets")
let openSheets = 0;
export function sheet({ title = '', sub = '', body = '', foot = '', size = '', ios = false, onClose, cancelText = 'Annuleren', saveText = 'Bewaar', onSave } = {}) {
  const d = h(`<dialog class="sheet"><div class="sheet-box ${size}" role="document">
    <div class="grab"></div>
    <div class="sh-head ${ios ? 'ios' : ''}">${ios ? `<button class="btn ghost sh-act" data-cancel>${esc(cancelText)}</button>` : ''}<div class="grow">${title ? `<h2>${esc(title)}</h2>` : ''}${sub ? `<p>${sub}</p>` : ''}</div>${ios ? `<button class="btn pri sm sh-act" data-save>${esc(saveText)}</button>` : ''}<button class="btn ghost icon x" data-close aria-label="Sluiten">${icon('x')}</button></div>
    <div class="sh-body"></div>${foot ? `<div class="sh-foot ${ios ? 'ios' : ''}">${foot}</div>` : ''}</div></dialog>`);
  const b = $('.sh-body', d);
  if (typeof body === 'string') b.innerHTML = body; else if (body) b.appendChild(body);
  document.body.appendChild(d);
  let closed = false;
  const close = (v) => { if (closed) return; closed = true; d.close(); };
  d.addEventListener('close', () => { closed = true; openSheets--; d.remove(); onClose && onClose(); if (!openSheets) document.documentElement.style.overflow = ''; });
  d.addEventListener('click', (e) => { if (e.target === d && !d.dataset.busy) close(); });
  d.addEventListener('cancel', (e) => { if (d.dataset.busy) e.preventDefault(); });
  $$('[data-close], [data-cancel]', d).forEach((x) => x.addEventListener('click', (e) => { e.preventDefault(); if (d.dataset.busy && !confirm('Er is nog iets bezig. Toch sluiten? (Het gaat op de server gewoon verder.)')) return; close(); }));
  if (onSave) $$('[data-save]', d).forEach((x) => x.addEventListener('click', (e) => { e.preventDefault(); onSave(); }));
  // op de gsm naar beneden vegen om te sluiten
  const grab = $('.grab', d); const box = $('.sheet-box', d);
  let y0 = null;
  const start = (e) => { y0 = e.touches[0].clientY; };
  const move = (e) => { if (y0 == null) return; const dy = e.touches[0].clientY - y0; if (dy > 0) { box.style.transform = `translateY(${dy}px)`; box.style.transition = 'none'; } };
  const end = (e) => { if (y0 == null) return; const dy = (e.changedTouches[0].clientY - y0); y0 = null; box.style.transition = ''; if (dy > 110) close(); else box.style.transform = ''; };
  for (const el of [grab, $('.sh-head', d)]) { el.addEventListener('touchstart', start, { passive: true }); el.addEventListener('touchmove', move, { passive: true }); el.addEventListener('touchend', end); }
  d.showModal(); openSheets++;
  document.documentElement.style.overflow = 'hidden';
  if (!IS_TOUCH) setTimeout(() => { const f = $('[autofocus]', d) || $('input:not([type=hidden]):not([type=checkbox]), textarea', b); if (f && !f.closest('.no-autofocus')) f.focus(); }, 40);
  return { el: d, body: b, box, close, $: (s) => $(s, d), $$: (s) => $$(s, d) };
}
export function confirmSheet(text, { title = 'Zeker?', ok = 'Ja', danger = false, sub = '' } = {}) {
  return new Promise((resolve) => {
    let v = false;
    const s = sheet({ title, sub, body: `<p class="muted" style="font-size:14px;line-height:1.5">${text}</p>`, foot: `<button class="btn" data-close>Annuleren</button><button class="btn ${danger ? 'danger solid' : 'pri'}" data-ok>${esc(ok)}</button>`, onClose: () => resolve(v) });
    s.$('[data-ok]').onclick = () => { v = true; s.close(); };
  });
}
// keuze uit een paar opties (bv. "Alleen deze / Alle")
export function choose(title, options, sub = '') {
  return new Promise((resolve) => {
    let v = null;
    const s = sheet({ title, sub, body: `<div class="col">${options.map((o, i) => `<button class="btn ${o.danger ? 'danger' : ''} ${i === 0 ? 'pri' : ''} lg block" data-i="${i}">${esc(o.label)}</button>`).join('')}</div>`, onClose: () => resolve(v) });
    s.$$('[data-i]').forEach((b) => { b.onclick = () => { v = options[Number(b.dataset.i)].value; s.close(); }; });
  });
}
export function prompt(title, { value = '', label = '', placeholder = '', ok = 'Bewaar', type = 'text' } = {}) {
  return new Promise((resolve) => {
    let v = null;
    const s = sheet({ title, body: `<label class="field">${label ? `<span>${esc(label)}</span>` : ''}<input type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}" autofocus></label>`, foot: `<button class="btn" data-close>Annuleren</button><button class="btn pri" data-ok>${esc(ok)}</button>`, onClose: () => resolve(v) });
    const go = () => { v = s.$('input').value; s.close(); };
    s.$('[data-ok]').onclick = go;
    s.$('input').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  });
}

// ---------------------------------------------------------------- menu (drie puntjes)
let menuEl = null;
export function menu(anchor, items) {
  closeMenu();
  menuEl = h(`<div class="menu" role="menu">${items.map((it, i) => (it === '-' ? '<hr>' : `<button data-i="${i}" class="${it.danger ? 'danger' : ''}">${it.icon ? icon(it.icon, 'sm') : ''}${esc(it.label)}</button>`)).join('')}</div>`);
  document.body.appendChild(menuEl);
  const r = anchor.getBoundingClientRect(), mw = menuEl.offsetWidth, mh = menuEl.offsetHeight;
  menuEl.style.left = `${Math.max(8, Math.min(r.right - mw, innerWidth - mw - 8))}px`;
  menuEl.style.top = `${r.bottom + mh + 8 > innerHeight ? Math.max(8, r.top - mh - 6) : r.bottom + 6}px`;
  menuEl.onclick = (e) => { const b = e.target.closest('[data-i]'); if (!b) return; const it = items[Number(b.dataset.i)]; closeMenu(); it.onClick && it.onClick(); };
  setTimeout(() => document.addEventListener('click', closeMenu, { once: true }), 0);
}
export function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
addEventListener('scroll', closeMenu, { passive: true });
addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

// ---------------------------------------------------------------- even bevestigen dat jij het bent
let stepUpBusy = null;
export function stepUp(reason) {
  if (stepUpBusy) return stepUpBusy;
  stepUpBusy = (async () => {
    let info = {}; try { info = await api('GET', '/api/stepup', null, { noStepUp: true }); } catch { /* */ }
    if (info.ok) return true;
    return new Promise((resolve) => {
      let ok = false;
      const s = sheet({
        title: 'Bevestig dat jij het bent', sub: esc(reason || ''),
        body: `<div class="col">
          ${info.passkey ? `<button class="btn pri lg block" data-pk>${icon('face')}Bevestig met Face ID / vingerafdruk</button>` : ''}
          ${info.totp ? `<label class="field" style="margin-top:6px"><span>Of typ de 6 cijfers uit je authenticator-app</span><input class="code-input" inputmode="numeric" autocomplete="one-time-code" maxlength="6" data-code placeholder="••••••"></label>`
            : `<label class="field" style="margin-top:6px"><span>${info.passkey ? 'Of typ' : 'Typ'} je wachtwoord van het paneel</span><input type="password" data-pw autocomplete="current-password"></label>`}
          <p class="error" data-err></p></div>`,
        foot: `<button class="btn" data-close>Annuleren</button><button class="btn pri" data-go>Bevestigen</button>`,
        onClose: () => resolve(ok),
      });
      const err = s.$('[data-err]');
      const done = () => { ok = true; s.close(); };
      const send = async (payload) => { err.textContent = ''; try { await api('POST', '/api/stepup/verify', payload, { noStepUp: true }); done(); } catch (e) { err.textContent = e.message; } };
      const pk = s.$('[data-pk]');
      if (pk) pk.onclick = async () => { try { const o = await api('POST', '/api/stepup/options', {}, { noStepUp: true }); const resp = await window.SimpleWebAuthnBrowser.startAuthentication({ optionsJSON: o.options }); await send({ id: o.id, response: resp }); } catch (e) { if (e.name !== 'NotAllowedError') err.textContent = e.message; } };
      const code = s.$('[data-code]'); if (code) code.addEventListener('input', () => { if (/^\d{6}$/.test(code.value)) send({ code: code.value }); });
      s.$('[data-go]').onclick = () => { if (code) send({ code: code.value }); else send({ password: s.$('[data-pw]').value }); };
      const pw = s.$('[data-pw]'); if (pw) pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') send({ password: pw.value }); });
      if (pk && STANDALONE) setTimeout(() => pk.click(), 250);
    });
  })().finally(() => { stepUpBusy = null; });
  return stepUpBusy;
}

// ---------------------------------------------------------------- kleine bouwstenen
export function ring(pct, { color = 'var(--p2)', label, size = 62 } = {}) {
  const r = 26, C = 2 * Math.PI * r, v = Math.max(0, Math.min(100, pct || 0));
  return `<div class="ring" style="width:${size}px;height:${size}px"><svg viewBox="0 0 62 62"><circle cx="31" cy="31" r="${r}" fill="none" stroke="var(--line2)" stroke-width="6"/><circle cx="31" cy="31" r="${r}" fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round" stroke-dasharray="${(C * v) / 100} ${C}"/></svg><div class="v">${label ?? `${Math.round(v)}%`}</div></div>`;
}
export function setRing(el, pct, label) {
  const c = el.querySelectorAll('circle')[1]; if (!c) return;
  const C = 2 * Math.PI * 26; c.setAttribute('stroke-dasharray', `${(C * Math.max(0, Math.min(100, pct || 0))) / 100} ${C}`);
  const v = el.querySelector('.v'); if (v && label != null) v.textContent = label;
}
export function emptyState(ic, title, text, btn = '') { return `<div class="empty"><div class="ei">${icon(ic, 'lg')}</div><b>${esc(title)}</b><div class="small">${text}</div>${btn}</div>`; }
export function copyText(t, msg = 'Gekopieerd') {
  const done = () => toast(msg, { icon: 'copy' });
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(t).then(done).catch(() => fallbackCopy(t, done));
  fallbackCopy(t, done); return Promise.resolve();
}
function fallbackCopy(t, done) { const ta = h('<textarea style="position:fixed;opacity:0"></textarea>'); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch { toast('Kopiëren lukte niet', { err: true }); } ta.remove(); }
// kleur-tint voor afspraken
export function evColors(c) { return `--c:${c};--cS:${hexA(c, 0.16)}`; }
// eenvoudige markdown voor notities (veilig: alles eerst ge-escaped)
export function md(src) {
  const lines = esc(src || '').split('\n'); const out = []; let list = null; let code = false;
  const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|\W)\*(.+?)\*(?=\W|$)/g, '$1<i>$2</i>').replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/(https?:\/\/[^\s<]+)/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (let n = 0; n < lines.length; n++) {
    const l = lines[n];
    if (/^```/.test(l)) { closeList(); out.push(code ? '</pre>' : '<pre>'); code = !code; continue; }
    if (code) { out.push(`${l}\n`); continue; }
    let m;
    if ((m = l.match(/^(#{1,3})\s+(.*)/))) { closeList(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); continue; }
    if ((m = l.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.*)/))) { if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; } const on = m[1] !== ' '; out.push(`<li class="chk ${on ? 'on' : ''}" data-line="${n}"><span class="cb ${on ? 'on' : ''}">${icon('tick')}</span><span>${inline(m[2])}</span></li>`); continue; }
    if ((m = l.match(/^\s*[-*]\s+(.*)/))) { if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; } out.push(`<li>${inline(m[1])}</li>`); continue; }
    if ((m = l.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; } out.push(`<li>${inline(m[1])}</li>`); continue; }
    closeList();
    if ((m = l.match(/^&gt;\s?(.*)/))) { out.push(`<blockquote>${inline(m[1])}</blockquote>`); continue; }
    out.push(l.trim() ? `<p>${inline(l)}</p>` : '');
  }
  closeList(); if (code) out.push('</pre>');
  return out.join('');
}
