/* Kleine grafiekbibliotheek (SVG, geen externe code). */
/* Kleine grafiekbibliotheek (SVG, geen externe code). Lijn/vlak-grafieken met kruisdraad + tooltip, en sparklines. */

  const NS = 'http://www.w3.org/2000/svg';
  const mk = (tag, attrs = {}, parent) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (parent) parent.appendChild(e); return e; };
  const clockFmt = (t, withDay) => new Date(t).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit', ...(withDay ? {} : {}) });
  function niceMax(v) {
    if (!(v > 0)) return 1;
    const p = 10 ** Math.floor(Math.log10(v)), n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  }
  // lijn opdelen in stukken zonder lege waarden
  function segments(t, vals, x, y) {
    const segs = []; let cur = [];
    vals.forEach((v, i) => { if (v == null || Number.isNaN(v)) { if (cur.length) segs.push(cur); cur = []; } else cur.push([x(t[i]), y(v)]); });
    if (cur.length) segs.push(cur);
    return segs;
  }
  const pathOf = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');

  /**
   * line(el, { t:[ms], series:[{ name, values, cls }], fmt(v), yMax?, height?, area? })
   * - één y-as, recessieve rasterlijnen, 2px lijnen
   * - kruisdraad + tooltip met alle reeksen (ook met pijltjestoetsen)
   */
function line(el, o) {
    const W = Math.max(240, el.clientWidth), H = o.height || 190;
    const P = { l: 48, r: 12, t: 10, b: 26 };
    let t = o.t || [];
    // meer punten dan pixels? dan gemiddelden per groepje (sneller, en je ziet exact hetzelfde)
    const maxPts = Math.max(60, Math.floor((W - P.l - P.r) / 1.5));
    if (t.length > maxPts) {
      const size = Math.ceil(t.length / maxPts), nt = [];
      const ns = o.series.map((sr) => ({ ...sr, values: [] }));
      for (let i = 0; i < t.length; i += size) {
        nt.push(t[Math.min(t.length - 1, i + size - 1)]);
        o.series.forEach((sr, k) => { const v = sr.values.slice(i, i + size).filter((x) => x != null); ns[k].values.push(v.length ? v.reduce((a, b) => a + b, 0) / v.length : null); });
      }
      t = nt; o = { ...o, series: ns };
    }
    el.classList.add('chart'); el.tabIndex = 0;
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', o.label || o.series.map((s) => s.name).join(', '));
    el.textContent = '';
    if (t.length < 2) { const e = document.createElement('div'); e.className = 'chart-empty'; e.textContent = 'Nog te weinig metingen – even geduld…'; el.appendChild(e); return; }
    const all = o.series.flatMap((s) => s.values).filter((v) => v != null);
    const top = Math.max(...all, o.minMax || 0) * 1.1;
    let yMax = o.yMax;
    if (!yMax && o.bytes) { const k = top > 0 ? Math.floor(Math.log(top) / Math.log(1024)) : 0; const u = 1024 ** Math.max(0, k); yMax = niceMax(top / u) * u; }
    if (!yMax) yMax = niceMax(top);
    const t0 = t[0], t1 = t[t.length - 1];
    const x = (v) => P.l + ((v - t0) / Math.max(1, t1 - t0)) * (W - P.l - P.r);
    const y = (v) => P.t + (1 - Math.min(v, yMax) / yMax) * (H - P.t - P.b);
    const svg = mk('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'chart-svg' }, el);
    // raster + y-labels
    const g = mk('g', { class: 'grid' }, svg);
    for (let i = 0; i <= 4; i++) {
      const v = (yMax / 4) * i, yy = y(v);
      mk('line', { x1: P.l, x2: W - P.r, y1: yy, y2: yy, class: i === 0 ? 'base' : 'hair' }, g);
      const lab = mk('text', { x: P.l - 8, y: yy + 4, class: 'tick', 'text-anchor': 'end' }, g); lab.textContent = o.fmt(v, true);
    }
    // x-labels
    const nx = Math.max(2, Math.min(6, Math.floor((W - P.l - P.r) / 110)));
    for (let i = 0; i <= nx; i++) {
      const tt = t0 + ((t1 - t0) / nx) * i;
      const lab = mk('text', { x: x(tt), y: H - 6, class: 'tick', 'text-anchor': i === 0 ? 'start' : i === nx ? 'end' : 'middle' }, g);
      lab.textContent = clockFmt(tt);
    }
    // reeksen
    for (const s of o.series) {
      const segs = segments(t, s.values, x, y);
      if (o.area && o.series.length === 1) for (const seg of segs) {
        mk('path', { d: `${pathOf(seg)}L${seg[seg.length - 1][0]},${y(0)}L${seg[0][0]},${y(0)}Z`, class: `area ${s.cls}` }, svg);
      }
      for (const seg of segs) mk('path', { d: pathOf(seg), class: `stroke ${s.cls}` }, svg);
    }
    // hover-laag
    const cross = mk('line', { y1: P.t, y2: H - P.b, class: 'cross', visibility: 'hidden' }, svg);
    const dots = o.series.map((s) => mk('circle', { r: 4.5, class: `dot ${s.cls}`, visibility: 'hidden' }, svg));
    const tip = document.createElement('div'); tip.className = 'chart-tip hidden'; el.appendChild(tip);
    const hit = mk('rect', { x: P.l, y: 0, width: W - P.l - P.r, height: H, fill: 'transparent' }, svg);
    let idx = -1;
    const nearest = (px) => {
      const tv = t0 + ((px - P.l) / (W - P.l - P.r)) * (t1 - t0);
      let lo = 0, hi = t.length - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (t[mid] < tv) lo = mid; else hi = mid; }
      return Math.abs(t[lo] - tv) < Math.abs(t[hi] - tv) ? lo : hi;
    };
    const show = (i) => {
      idx = Math.max(0, Math.min(t.length - 1, i)); const cx = x(t[idx]);
      cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('visibility', 'visible');
      tip.textContent = '';
      const head = document.createElement('div'); head.className = 'tip-time'; head.textContent = new Date(t[idx]).toLocaleString('nl-BE', { weekday: 'short', hour: '2-digit', minute: '2-digit', second: o.seconds ? '2-digit' : undefined }); tip.appendChild(head);
      o.series.forEach((s, k) => {
        const v = s.values[idx];
        if (v == null) { dots[k].setAttribute('visibility', 'hidden'); } else { dots[k].setAttribute('cx', cx); dots[k].setAttribute('cy', y(v)); dots[k].setAttribute('visibility', 'visible'); }
        const row = document.createElement('div'); row.className = 'tip-row';
        const key = document.createElement('span'); key.className = `tip-key ${s.cls}`;
        const val = document.createElement('b'); val.textContent = v == null ? '–' : o.fmt(v);
        const nm = document.createElement('span'); nm.className = 'tip-name'; nm.textContent = s.name;
        row.append(key, val, nm); tip.appendChild(row);
      });
      tip.classList.remove('hidden');
      const tw = tip.offsetWidth; let left = cx + 12; if (left + tw > W - 4) left = cx - tw - 12;
      tip.style.left = `${Math.max(4, left)}px`; tip.style.top = `${P.t + 4}px`;
      el._hoverT = t[idx];
    };
    const hide = () => { cross.setAttribute('visibility', 'hidden'); dots.forEach((d) => d.setAttribute('visibility', 'hidden')); tip.classList.add('hidden'); idx = -1; el._hoverT = null; };
    const at = (e) => { const r = svg.getBoundingClientRect(); show(nearest(((e.clientX - r.left) / r.width) * W)); };
    hit.addEventListener('pointermove', at);
    hit.addEventListener('pointerdown', at);
    hit.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });
    hit.style.touchAction = 'pan-y';
    if (!el._outside) { el._outside = true; document.addEventListener('pointerdown', (e) => { if (!el.contains(e.target) && el._hide) el._hide(); }, { passive: true }); }
    el._hide = hide;
    el.onfocus = () => show(t.length - 1);
    el.onblur = hide;
    el.onkeydown = (e) => { if (e.key === 'ArrowLeft') { show((idx < 0 ? t.length - 1 : idx) - 1); e.preventDefault(); } if (e.key === 'ArrowRight') { show((idx < 0 ? t.length - 1 : idx) + 1); e.preventDefault(); } if (e.key === 'Escape') hide(); };
    // hover behouden bij verversen
    if (o.keepHoverT) { const i = t.findIndex((v) => v >= o.keepHoverT); if (i >= 0) show(i); }
  }

  // sparkline: enkel de vorm van de laatste tijd, zonder assen
function spark(el, values, cls, yMax, H0) {
    const W = Math.max(80, el.clientWidth), H = H0 || 38;
    el.textContent = '';
    const v = values.filter((x) => x != null); if (v.length < 2) return;
    const max = yMax || Math.max(...v) * 1.15 || 1;
    const svg = mk('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'spark', 'aria-hidden': 'true' }, el);
    const pts = v.map((val, i) => [(i / (v.length - 1)) * (W - 5) + 1, H - 3 - (Math.min(val, max) / max) * (H - 8)]);
    mk('path', { d: `${pathOf(pts)}L${pts[pts.length - 1][0]},${H}L${pts[0][0]},${H}Z`, class: `area ${cls}` }, svg);
    mk('path', { d: pathOf(pts), class: `stroke ${cls}` }, svg);
    const last = pts[pts.length - 1]; mk('circle', { cx: last[0], cy: last[1], r: 3, class: `dot ${cls}` }, svg);
  }
export { line, spark, niceMax };
