/* Datum- en uurvakjes in Belgisch formaat: 14/10/2026 en 14:30 (geen AM/PM).
   De ingebouwde vakjes van de browser volgen de taal van Windows of de gsm, dus die vervangen we overal door eigen vakjes.
   Voor de rest van de code verandert er niets: .value blijft "2026-10-14" en "14:30". */
import { T, pad, ymd, IS_TOUCH } from './core.js';

const NATIVE = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
const HAS_POPOVER = typeof HTMLElement.prototype.showPopover === 'function';

// ---------------------------------------------------------------- omzetten
const toBe = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };
// "14/10/2026", "14-10-26", "14.10", "141026", "14102026" en "2026-10-14" → "2026-10-14" (null = ongeldig)
export function parseDate(t) {
  t = String(t ?? '').trim();
  if (!t) return '';
  let d, m, y, x;
  if ((x = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t))) [y, m, d] = [+x[1], +x[2], +x[3]];
  else if ((x = /^(\d{1,2})[/.\-\s](\d{1,2})(?:[/.\-\s](\d{2}|\d{4}))?$/.exec(t))) [d, m, y] = [+x[1], +x[2], x[3]];
  else if ((x = /^(\d{2})(\d{2})(\d{2}|\d{4})?$/.exec(t))) [d, m, y] = [+x[1], +x[2], x[3]];
  else return null;
  if (y == null) y = new Date().getFullYear(); else if (String(y).length === 2) y = 2000 + +y; else y = +y;
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}
// "14:30", "14u30", "14.30", "1430", "930", "14", "14u" → "14:30" / "09:30" / "14:00" (null = ongeldig)
export function parseTime(t) {
  t = String(t ?? '').trim().toLowerCase().replace(/\s+/g, '');
  if (!t) return '';
  let h, mi, x;
  if ((x = /^(\d{1,2})(?:[:.hu](\d{1,2})?)?(?:u)?$/.exec(t))) [h, mi] = [+x[1], x[2] ? +x[2] : 0];
  else if ((x = /^(\d{1,2})(\d{2})$/.exec(t))) [h, mi] = [+x[1], +x[2]];
  else return null;
  if (h > 23 || mi > 59) return null;
  return `${pad(h)}:${pad(mi)}`;
}

// ---------------------------------------------------------------- een vakje omzetten
function upgrade(el) {
  if (el._be) return;
  const kind = el.getAttribute('type');
  el._be = kind;
  const parse = kind === 'date' ? parseDate : parseTime;
  const show = kind === 'date' ? toBe : (v) => v;
  let val = parse(NATIVE.get.call(el)) || '';
  el.type = 'text';
  el.classList.add(`be-${kind}`);
  el.autocomplete = 'off';
  el.spellcheck = false;
  el.inputMode = 'numeric';
  el.maxLength = kind === 'date' ? 10 : 5;
  if (!el.getAttribute('placeholder')) el.placeholder = kind === 'date' ? 'dd/mm/jjjj' : 'uu:mm';
  if (kind === 'date' && IS_TOUCH) el.readOnly = true; // op de gsm: kalendertje in plaats van toetsenbord
  Object.defineProperty(el, 'value', {
    configurable: true,
    get: () => val,
    set: (v) => { val = parse(v) || ''; NATIVE.set.call(el, show(val)); el.classList.remove('bad'); },
  });
  NATIVE.set.call(el, show(val));

  // tijdens het typen: / of : vanzelf toevoegen, en de waarde meteen bijwerken als ze klopt
  el.addEventListener('input', (e) => {
    let t = NATIVE.get.call(el);
    if (e.inputType === 'insertText' && el.selectionStart === t.length && /\d$/.test(t)) {
      if (kind === 'date' && (/^\d{2}$/.test(t) || /^\d{1,2}\/\d{2}$/.test(t))) t += '/';
      if (kind === 'time' && /^\d{2}$/.test(t) && +t <= 23) t += ':';
      if (kind === 'time' && /^\d{3}$/.test(t) && +t.slice(0, 2) > 23) t = `0${t[0]}:${t.slice(1)}`;
      NATIVE.set.call(el, t);
    }
    const p = parse(t);
    if (p !== null && (kind === 'time' ? /^\d{1,2}[:.u]\d{2}$|^$/.test(t) : /\d{4}$|^$/.test(t))) val = p;
    el.classList.remove('bad');
  });
  // bij verlaten: netjes zetten, of terug naar de vorige waarde als het niet klopt
  const commit = () => {
    const p = parse(NATIVE.get.call(el));
    if (p === null) { el.classList.add('bad'); setTimeout(() => el.classList.remove('bad'), 1200); } else val = p;
    NATIVE.set.call(el, show(val));
  };
  el.addEventListener('change', commit, true);
  el.addEventListener('blur', commit);
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commit();
    if (kind === 'date' && (e.key === 'F4' || (e.altKey && e.key === 'ArrowDown'))) { e.preventDefault(); openCal(el); }
    if (kind === 'date' && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.altKey && val) { e.preventDefault(); const d = new Date(`${val}T12:00`); d.setDate(d.getDate() + (e.key === 'ArrowUp' ? 1 : -1)); setAndFire(el, ymd(d)); }
    if (kind === 'time' && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && val) {
      e.preventDefault();
      const step = Math.max(1, Math.round((Number(el.getAttribute('step')) || 300) / 60));
      let [h, m] = val.split(':').map(Number); let tot = h * 60 + m + (e.key === 'ArrowUp' ? step : -step);
      tot = ((tot % 1440) + 1440) % 1440; h = Math.floor(tot / 60); m = tot % 60;
      setAndFire(el, `${pad(h)}:${pad(m)}`);
    }
  });
  if (kind === 'date') el.addEventListener('click', () => openCal(el));
}
function setAndFire(el, v) {
  el.value = v;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

// ---------------------------------------------------------------- kalendertje
let cal = null;
function closeCal() {
  if (!cal) return;
  const c = cal; cal = null;
  document.removeEventListener('pointerdown', c.outside, true);
  window.removeEventListener('resize', closeCal);
  document.removeEventListener('scroll', c.onScroll, true);
  try { if (HAS_POPOVER) c.box.hidePopover(); } catch { /* */ }
  c.box.remove();
}
function openCal(el) {
  if (cal && cal.el === el) return;
  closeCal();
  const sel = el.value;
  const today = ymd(Date.now());
  let view = new Date(`${sel || today}T00:00`); view.setDate(1);
  const box = document.createElement('div');
  box.className = 'dp';
  if (HAS_POPOVER) box.popover = 'manual';
  box.addEventListener('pointerdown', (e) => { if (!IS_TOUCH) e.preventDefault(); }); // focus blijft in het vakje
  const draw = () => {
    const y = view.getFullYear(), m = view.getMonth();
    const first = (new Date(y, m, 1).getDay() + 6) % 7; // maandag eerst
    const n = new Date(y, m + 1, 0).getDate();
    let cells = '';
    for (let i = 0; i < first; i++) cells += '<span></span>';
    for (let d = 1; d <= n; d++) {
      const iso = `${y}-${pad(m + 1)}-${pad(d)}`;
      cells += `<button type="button" data-d="${iso}" class="${iso === el.value ? 'sel' : ''} ${iso === today ? 'td' : ''}">${d}</button>`;
    }
    box.innerHTML = `<div class="dp-head"><button type="button" data-m="-1" aria-label="Vorige maand">‹</button><b>${T.MONTHS[m]} ${y}</b><button type="button" data-m="1" aria-label="Volgende maand">›</button></div>
      <div class="dp-days">${['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'].map((x) => `<i>${x}</i>`).join('')}${cells}</div>
      <div class="dp-foot">${el.required ? '' : '<button type="button" data-clear>Wissen</button>'}<button type="button" data-today>Vandaag</button></div>`;
  };
  box.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.m) { view.setMonth(view.getMonth() + Number(b.dataset.m)); draw(); place(); return; }
    if (b.dataset.d) { setAndFire(el, b.dataset.d); closeCal(); return; }
    if ('today' in b.dataset) { setAndFire(el, today); closeCal(); return; }
    if ('clear' in b.dataset) { setAndFire(el, ''); closeCal(); }
  });
  draw();
  (el.closest('dialog') || document.body).appendChild(box);
  if (HAS_POPOVER) { try { box.showPopover(); } catch { /* */ } }
  const place = () => {
    const r = el.getBoundingClientRect(), w = box.offsetWidth, hgt = box.offsetHeight;
    let top = r.bottom + 6; if (top + hgt > innerHeight - 8 && r.top - hgt - 6 > 8) top = r.top - hgt - 6;
    const left = Math.max(8, Math.min(r.left, innerWidth - w - 8));
    box.style.top = `${Math.max(8, top)}px`; box.style.left = `${left}px`;
  };
  place();
  const outside = (e) => { if (!box.contains(e.target) && e.target !== el) closeCal(); };
  const onScroll = (e) => { if (!box.contains(e.target)) closeCal(); };
  cal = { el, box, outside, onScroll };
  setTimeout(() => {
    if (cal && cal.box === box) { document.addEventListener('pointerdown', outside, true); window.addEventListener('resize', closeCal); document.addEventListener('scroll', onScroll, true); }
  }, 0);
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && cal) { e.preventDefault(); e.stopPropagation(); closeCal(); } }, true);
document.addEventListener('focusin', (e) => { if (cal && e.target !== cal.el && !cal.box.contains(e.target)) closeCal(); });

// ---------------------------------------------------------------- overal toepassen, ook op vensters die later openen
const SEL = 'input[type=date], input[type=time]';
const scan = (root) => { if (root.matches && root.matches(SEL)) upgrade(root); if (root.querySelectorAll) root.querySelectorAll(SEL).forEach(upgrade); };
new MutationObserver((list) => { for (const r of list) for (const n of r.addedNodes) if (n.nodeType === 1) scan(n); })
  .observe(document.documentElement, { childList: true, subtree: true });
scan(document);
