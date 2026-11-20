'use strict';
/*
 * Agenda + taken.
 * - Opslag: Radicale (CalDAV-server) draait mee in het paneel, zodat je gsm (iPhone/Android) kan synchroniseren via /dav.
 *   Het paneel leest de .ics-bestanden rechtstreeks van schijf (snel) en schrijft via Radicale (zodat je gsm alles meteen ziet).
 * - Zonder Radicale (demo op je pc) schrijft het paneel de bestanden zelf.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const I = require('./ical');

module.exports = function calendar(ctx) {
  const { CFG, DEMO, store, wrap, bad, broadcast, auth } = ctx;
  const USER = (process.env.DAV_USER || process.env.HOST_USER || 'rawend').toLowerCase().replace(/[^a-z0-9._-]/g, '') || 'rawend';
  const RAD_DIR = path.join(CFG.dataDir, 'radicale');
  const COL_ROOT = path.join(RAD_DIR, 'collections');
  const BASE = path.join(COL_ROOT, 'collection-root', USER);
  const RAD_PORT = Number(process.env.RADICALE_PORT || 5232);
  fs.mkdirSync(BASE, { recursive: true });

  // ------------------------------------------------------------ Radicale starten
  const rad = { proc: null, ok: false, cmd: null, restarts: 0, lastError: '' };
  function findRadicale() {
    if (process.env.RADICALE_CMD) return process.env.RADICALE_CMD.split(' ');
    for (const c of [['radicale'], ['/opt/radicale/bin/radicale'], ['python3', '-m', 'radicale']]) {
      try { const r = spawnSync(c[0], [...c.slice(1), '--version'], { timeout: 8000 }); if (r.status === 0) return c; } catch { /* */ }
    }
    return null;
  }
  function startRadicale() {
    if (rad.proc) return;
    if (!rad.cmd) rad.cmd = findRadicale();
    if (!rad.cmd) { rad.lastError = 'Radicale niet gevonden'; return; }
    const conf = path.join(RAD_DIR, 'config');
    fs.writeFileSync(conf, [
      '[server]', `hosts = 127.0.0.1:${RAD_PORT}`, 'max_content_length = 104857600', '',
      '[auth]', 'type = http_x_remote_user', '',
      '[rights]', 'type = owner_only', '',
      '[storage]', `filesystem_folder = ${COL_ROOT}`, '',
      '[web]', 'type = none', '',
      '[logging]', 'level = warning', '',
    ].join('\n'));
    const p = spawn(rad.cmd[0], [...rad.cmd.slice(1), '--config', conf], { stdio: ['ignore', 'ignore', 'pipe'] });
    rad.proc = p;
    p.stderr.on('data', (d) => { const s = String(d).split('\n').filter((l) => /ERROR|CRITICAL|Traceback|Error:/.test(l)).pop(); if (s) rad.lastError = s.slice(0, 300); });
    p.on('error', (e) => { rad.lastError = e.message; });
    p.on('exit', () => {
      rad.proc = null; rad.ok = false;
      if (rad.restarts++ < 20) setTimeout(startRadicale, Math.min(30000, 1000 * rad.restarts));
    });
    // wachten tot hij antwoordt
    let tries = 0;
    const check = () => davRequest('PROPFIND', `/${USER}/`, null, { Depth: '0' }).then((r) => {
      if (r.status < 500) { rad.ok = true; rad.restarts = 0; rad.lastError = ''; ensureDefaults().catch((e) => console.log(`Agenda's maken mislukt: ${e.message}`)); } else throw new Error(String(r.status));
    }).catch(() => { if (++tries < 40 && rad.proc) setTimeout(check, 500); });
    setTimeout(check, 400);
  }
  function davRequest(method, p, body, headers = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: RAD_PORT, method, path: p, headers: { 'X-Remote-User': USER, ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}), ...headers }, timeout: 15000 }, (res) => {
        let data = ''; res.on('data', (d) => { data += d; }); res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
      });
      req.on('error', reject); req.on('timeout', () => req.destroy(new Error('timeout')));
      if (body) req.write(body); req.end();
    });
  }
  const useRadicale = () => rad.ok;

  // ------------------------------------------------------------ verzamelingen (agenda's / takenlijsten)
  const PROPS = '.Radicale.props';
  const xmlEsc = (s) => String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
  function readProps(dir) { try { return JSON.parse(fs.readFileSync(path.join(dir, PROPS), 'utf8')); } catch { return null; } }
  function collections() {
    let names = []; try { names = fs.readdirSync(BASE, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name); } catch { /* */ }
    const meta = store.read('calmeta', {});
    const out = [];
    for (const n of names) {
      const props = readProps(path.join(BASE, n)); if (!props || props.tag !== 'VCALENDAR') continue;
      const comps = String(props['C:supported-calendar-component-set'] || 'VEVENT,VTODO').toUpperCase();
      const m = meta[n] || {};
      out.push({
        id: n, name: props['D:displayname'] || n, color: normColor(props['ICAL:calendar-color']) || '#6366F1',
        events: comps.includes('VEVENT'), todos: comps.includes('VTODO') && !comps.includes('VEVENT') ? true : comps.includes('VTODO') && !!m.todos,
        hidden: !!m.hidden, bring: m.bring || [], shareToken: m.shareToken || null, order: m.order ?? 99, readOnly: false, kind: 'dav',
      });
    }
    return out.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  }
  function normColor(c) { const m = String(c || '').match(/^#?([0-9a-f]{6})/i); return m ? `#${m[1].toUpperCase()}` : ''; }
  async function createCollection(id, name, color, kind = 'VEVENT') {
    id = id || crypto.randomUUID();
    if (!/^[\w.-]{1,80}$/.test(id)) throw bad('Ongeldige naam');
    if (useRadicale()) {
      const body = `<?xml version="1.0" encoding="utf-8"?><C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:I="http://apple.com/ns/ical/"><D:set><D:prop><D:displayname>${xmlEsc(name)}</D:displayname><I:calendar-color>${xmlEsc(color)}FF</I:calendar-color><C:supported-calendar-component-set><C:comp name="${kind}"/></C:supported-calendar-component-set></D:prop></D:set></C:mkcalendar>`;
      const r = await davRequest('MKCALENDAR', `/${USER}/${id}/`, body, { 'Content-Type': 'application/xml; charset=utf-8' });
      if (r.status >= 300) throw bad(`Agenda maken mislukt (${r.status})`);
    } else {
      const dir = path.join(BASE, id); fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, PROPS), JSON.stringify({ 'C:supported-calendar-component-set': kind, 'D:displayname': name, 'ICAL:calendar-color': `${color}FF`, tag: 'VCALENDAR' }));
    }
    return id;
  }
  async function patchCollection(id, { name, color }) {
    const dir = path.join(BASE, id); if (!readProps(dir)) throw bad('Onbekende agenda', 404);
    if (useRadicale()) {
      const props = `${name ? `<D:displayname>${xmlEsc(name)}</D:displayname>` : ''}${color ? `<I:calendar-color>${xmlEsc(color)}FF</I:calendar-color>` : ''}`;
      const r = await davRequest('PROPPATCH', `/${USER}/${id}/`, `<?xml version="1.0" encoding="utf-8"?><D:propertyupdate xmlns:D="DAV:" xmlns:I="http://apple.com/ns/ical/"><D:set><D:prop>${props}</D:prop></D:set></D:propertyupdate>`, { 'Content-Type': 'application/xml; charset=utf-8' });
      if (r.status >= 300) throw bad(`Opslaan mislukt (${r.status})`);
    } else {
      const p = readProps(dir); if (name) p['D:displayname'] = name; if (color) p['ICAL:calendar-color'] = `${color}FF`;
      fs.writeFileSync(path.join(dir, PROPS), JSON.stringify(p));
    }
  }
  async function deleteCollection(id) {
    const dir = path.join(BASE, id); if (!readProps(dir)) throw bad('Onbekende agenda', 404);
    if (useRadicale()) { const r = await davRequest('DELETE', `/${USER}/${id}/`); if (r.status >= 300) throw bad(`Verwijderen mislukt (${r.status})`); }
    else fs.rmSync(dir, { recursive: true, force: true });
    store.update('calmeta', {}, (m) => { delete m[id]; });
  }

  // ------------------------------------------------------------ items lezen (met cache)
  const cache = new Map(); // file -> { mtime, size, root, uids, kind, text }
  function items(colId) {
    const dir = path.join(BASE, colId);
    let files = []; try { files = fs.readdirSync(dir).filter((f) => !f.startsWith('.') && f.endsWith('.ics')); } catch { return []; }
    const out = [];
    for (const f of files) {
      const full = path.join(dir, f);
      let st; try { st = fs.statSync(full); } catch { continue; }
      let c = cache.get(full);
      if (!c || c.mtime !== st.mtimeMs || c.size !== st.size) {
        try {
          const text = fs.readFileSync(full, 'utf8');
          const root = I.parse(text);
          const comps = [...root.getAllSubcomponents('vevent'), ...root.getAllSubcomponents('vtodo')];
          c = { mtime: st.mtimeMs, size: st.size, root, text, uids: [...new Set(comps.map((x) => x.getFirstPropertyValue('uid')))], kind: comps[0] ? comps[0].name : '' };
        } catch { c = { mtime: st.mtimeMs, size: st.size, root: null, text: '', uids: [], kind: '' }; }
        cache.set(full, c);
      }
      if (c.root) out.push({ href: f, ...c });
    }
    return out;
  }
  function readItem(colId, href) {
    if (!/^[^/\\]{1,200}$/.test(href) || href.startsWith('.')) throw bad('Ongeldig item');
    const full = path.join(BASE, colId, href);
    try { return fs.readFileSync(full, 'utf8'); } catch { throw bad('Niet gevonden (misschien net op je gsm verwijderd)', 404); }
  }
  async function putItem(colId, href, text) {
    if (!/^[\w@.%+-]{1,200}\.ics$/.test(href)) throw bad('Ongeldige bestandsnaam');
    if (useRadicale()) {
      const r = await davRequest('PUT', `/${USER}/${colId}/${encodeURIComponent(href)}`, text, { 'Content-Type': 'text/calendar; charset=utf-8' });
      if (r.status >= 300) throw bad(`Opslaan mislukt (${r.status}${r.body ? `: ${r.body.slice(0, 120)}` : ''})`);
    } else {
      const dir = path.join(BASE, colId); if (!fs.existsSync(dir)) throw bad('Onbekende agenda', 404);
      const f = path.join(dir, href); fs.writeFileSync(`${f}.tmp`, text); fs.renameSync(`${f}.tmp`, f);
    }
    changed();
  }
  async function deleteItem(colId, href) {
    if (useRadicale()) { const r = await davRequest('DELETE', `/${USER}/${colId}/${encodeURIComponent(href)}`); if (r.status >= 300 && r.status !== 404) throw bad(`Verwijderen mislukt (${r.status})`); }
    else fs.rmSync(path.join(BASE, colId, href), { force: true });
    changed();
  }
  const hrefFor = (uid) => `${String(uid).replace(/[^\w@.-]/g, '_').slice(0, 150)}.ics`;
  let changedT = null;
  function changed() { clearTimeout(changedT); changedT = setTimeout(() => { broadcast('agenda', { t: Date.now() }); ctx.emit && ctx.emit('agenda-changed'); }, 150); }

  // ------------------------------------------------------------ virtuele agenda's (feestdagen, abonnementen)
  const subs = store.list('subscriptions');
  const SUB_DIR = path.join(CFG.dataDir, 'subscriptions'); fs.mkdirSync(SUB_DIR, { recursive: true });
  const subCache = new Map();
  function virtualCals() {
    const meta = store.read('calmeta', {});
    const out = [{ id: 'feestdagen', name: 'Feestdagen België', color: '#94A3B8', events: true, todos: false, hidden: !!(meta.feestdagen && meta.feestdagen.hidden), readOnly: true, kind: 'holidays', order: 200, bring: [] }];
    for (const s of subs.all()) out.push({ id: `sub-${s.id}`, name: s.name, color: s.color || '#38BDF8', events: true, todos: false, hidden: !!(meta[`sub-${s.id}`] && meta[`sub-${s.id}`].hidden), readOnly: true, kind: 'subscription', url: s.url, error: s.error || '', lastFetch: s.lastFetch || 0, order: 150, bring: (meta[`sub-${s.id}`] || {}).bring || [] });
    return out;
  }
  async function fetchSub(s) {
    try {
      const url = s.url.replace(/^webcal:/i, 'https:');
      const r = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'Rawendpaneel' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const text = await r.text();
      if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('Geen agenda (.ics) op die link');
      I.parse(text);
      fs.writeFileSync(path.join(SUB_DIR, `${s.id}.ics`), text);
      subs.patch(s.id, { lastFetch: Date.now(), error: '' }); subCache.delete(s.id); changed();
    } catch (e) { subs.patch(s.id, { error: e.message, lastFetch: Date.now() }); }
  }
  function subRoot(id) {
    const f = path.join(SUB_DIR, `${id}.ics`);
    let st; try { st = fs.statSync(f); } catch { return null; }
    const c = subCache.get(id);
    if (c && c.mtime === st.mtimeMs) return c.root;
    try { const root = I.parse(fs.readFileSync(f, 'utf8')); subCache.set(id, { mtime: st.mtimeMs, root }); return root; } catch { return null; }
  }
  setInterval(() => { for (const s of subs.all()) if (Date.now() - (s.lastFetch || 0) > 30 * 60e3) fetchSub(s); }, 5 * 60e3).unref();
  setTimeout(() => { for (const s of subs.all()) fetchSub(s); }, 8000).unref();

  function allCalendars() { return [...collections(), ...virtualCals()]; }

  // ------------------------------------------------------------ voorkomens in een periode
  function occurrences(from, to, { includeHidden = false } = {}) {
    const extras = store.read('extras', {});
    const out = [];
    for (const cal of allCalendars()) {
      if (!cal.events || (cal.hidden && !includeHidden)) continue;
      const push = (o, href) => {
        const ex = extras[o.uid] || {};
        out.push({ ...o, cal: cal.id, calName: cal.name, calColor: cal.color, color: o.color || cal.color, href, readOnly: cal.readOnly, travel: ex.travel || 0, bring: [...(cal.bring || []), ...(ex.bring || [])].filter((v, i, a) => a.indexOf(v) === i), hasNotes: !!o.description, key: `${cal.id}|${o.uid}|${o.recurrenceId || ''}` });
      };
      if (cal.kind === 'dav') {
        for (const it of items(cal.id)) {
          if (it.kind !== 'vevent') continue;
          let list; try { list = I.expandEvents(it.root, from, to); } catch { continue; }
          for (const o of list) push(o, it.href);
        }
      } else if (cal.kind === 'holidays') {
        const y0 = new Date(from).getFullYear(), y1 = new Date(to).getFullYear();
        for (let y = y0; y <= y1; y++) for (const h of I.holidaysBE(y)) {
          const s = I.ms(I.toTime(h.date, true)), e = s + 86400000;
          if (e <= from || s >= to) continue;
          push({ uid: `be-${h.date}`, title: h.title, start: s, end: e, allDay: true, startLocal: h.date, endLocal: h.date, location: '', description: '', categories: [], alarms: [], transp: 'TRANSPARENT', status: 'CONFIRMED', recurring: false, recurrenceId: null, attendees: [], url: '', color: '' }, null);
        }
      } else if (cal.kind === 'subscription') {
        const root = subRoot(cal.id.slice(4)); if (!root) continue;
        let list; try { list = I.expandEvents(root, from, to); } catch { continue; }
        for (const o of list) push({ ...o, alarms: [] }, null);
      }
    }
    return out.sort((a, b) => a.start - b.start || b.allDay - a.allDay);
  }
  function findItemByUid(colId, uid) { return items(colId).find((it) => it.uids.includes(uid)); }
  function davCal(id) { const c = collections().find((x) => x.id === id); if (!c) throw bad('Onbekende agenda', 404); return c; }

  // ------------------------------------------------------------ taken
  function todos({ includeDone = true } = {}) {
    const out = [];
    for (const cal of collections()) {
      if (!cal.todos) continue;
      for (const it of items(cal.id)) {
        if (it.kind !== 'vtodo') continue;
        for (const t of I.readTodos(it.root)) {
          if (!includeDone && t.done) continue;
          out.push({ ...t, list: cal.id, listName: cal.name, color: cal.color, href: it.href });
        }
      }
    }
    return out;
  }

  // ------------------------------------------------------------ standaard-agenda's
  async function ensureDefaults() {
    const have = collections();
    const meta = store.read('calmeta', {});
    if (meta._seeded) return;
    const defs = [
      ['werk', 'Werk', '#6366F1', 'VEVENT', ['Werkkleding', 'Badge']],
      ['school', 'School', '#38BDF8', 'VEVENT', ['Laptop', 'Lader', 'Studentenkaart']],
      ['persoonlijk', 'Persoonlijk', '#818CF8', 'VEVENT', []],
      ['verjaardagen', 'Verjaardagen', '#7DD3FC', 'VEVENT', []],
      ['taken', 'Taken', '#6366F1', 'VTODO', []],
    ];
    let order = 0;
    for (const [id, name, color, kind, bring] of defs) {
      if (!have.some((c) => c.id === id)) await createCollection(id, name, color, kind);
      store.update('calmeta', {}, (m) => { m[id] = { ...(m[id] || {}), order: order++, bring: (m[id] && m[id].bring) || bring }; });
    }
    store.update('calmeta', {}, (m) => { m._seeded = true; });
    changed();
  }

  // ------------------------------------------------------------ CalDAV voor je gsm (/dav), achter het paneel
  const davFail = new Map();
  const davOkCache = new Map();
  let davLast = null; // laatste poging van een toestel (om te tonen in Instellingen → Gsm)
  const PW_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789'; // geen i/l/o/0/1: niet te verwarren bij overtypen
  // wat mensen op een gsm intypen gelijk trekken: hoofdletters, spaties, "slimme" streepjes, zonder streepjes getypt
  function pwVariants(pw) {
    const raw = String(pw || '');
    const norm = raw.normalize('NFKC').replace(/[\u2010-\u2015\u2212]/g, '-').replace(/\s+/g, '').toLowerCase();
    const out = new Set([raw, norm]);
    const bare = norm.replace(/-/g, '');
    if (/^[a-z0-9]{12,16}$/.test(bare)) out.add(bare.match(/.{1,4}/g).join('-'));
    return [...out];
  }
  function checkDavAuth(req) {
    const h = req.headers.authorization || '';
    const m = h.match(/^Basic\s+(.+)$/i); if (!m) return { ok: false, reason: 'none' };
    let dec = ''; try { dec = Buffer.from(m[1], 'base64').toString('utf8'); } catch { return { ok: false, reason: 'pass' }; }
    const i = dec.indexOf(':'); if (i < 0) return { ok: false, reason: 'pass' };
    const u = dec.slice(0, i).trim().toLowerCase().replace(/@.*$/, ''), pw = dec.slice(i + 1);
    if (u !== USER) return { ok: false, reason: 'user', user: dec.slice(0, i).slice(0, 40) };
    const list = (auth() && auth().davPasswords) || [];
    for (const v of pwVariants(pw)) {
      const key = crypto.createHash('sha256').update(v).digest('hex');
      const c = davOkCache.get(key); if (c && Date.now() - c.t < 10 * 60e3) return { ok: true, name: c.name };
      const hit = list.find((p) => ctx.checkPassword(v, p.hash));
      if (hit) { davOkCache.set(key, { t: Date.now(), name: hit.name }); hit.lastUsed = Date.now(); ctx.saveAuth(); return { ok: true, name: hit.name }; }
    }
    return { ok: false, reason: list.length ? 'pass' : 'nopw' };
  }
  const devName = (ua) => (/iPhone|iOS|dataaccessd/i.test(ua) ? 'iPhone' : /iPad/i.test(ua) ? 'iPad' : /DAVx5|DAVdroid|Android/i.test(ua) ? 'Android' : /Mac OS|macOS|CalendarAgent/i.test(ua) ? 'Mac' : /Thunderbird/i.test(ua) ? 'Thunderbird' : 'Toestel');
  function early(app) {
    app.all(['/.well-known/caldav', '/.well-known/carddav'], (req, res) => res.redirect(301, '/dav/'));
    app.use('/dav', (req, res) => {
      const ip = req.ip;
      const f = davFail.get(ip);
      const a = checkDavAuth(req);
      // een juist wachtwoord komt altijd binnen; alleen foute pogingen worden afgeremd (de app-wachtwoorden zijn lang en willekeurig)
      if (!a.ok && f && f.n >= 30 && Date.now() - f.t < 15 * 60e3) { davLast = { at: Date.now(), ok: false, reason: 'locked', dev: devName(req.headers['user-agent'] || '') }; return res.status(429).send('Te veel foute pogingen, probeer over een kwartier opnieuw'); }
      if (!a.ok) {
        if (a.reason !== 'none') {
          const x = davFail.get(ip) || { n: 0, t: Date.now() }; if (Date.now() - x.t > 15 * 60e3) { x.n = 0; x.t = Date.now(); } x.n++; davFail.set(ip, x);
          davLast = { at: Date.now(), ok: false, reason: a.reason, user: a.user || '', dev: devName(req.headers['user-agent'] || '') };
        }
        res.setHeader('WWW-Authenticate', 'Basic realm="Rawendpaneel agenda", charset="UTF-8"');
        return res.status(401).send('Inloggen nodig');
      }
      davFail.delete(ip);
      if (!davLast || !davLast.ok || Date.now() - davLast.at > 60e3) davLast = { at: Date.now(), ok: useRadicale(), reason: useRadicale() ? '' : 'down', name: a.name, dev: devName(req.headers['user-agent'] || '') };
      if (!useRadicale()) return res.status(503).send('Agenda-synchronisatie is nog aan het opstarten');
      const headers = { ...req.headers };
      for (const k of ['authorization', 'connection', 'keep-alive', 'proxy-authorization', 'te', 'trailer', 'upgrade', 'x-remote-user', 'x-script-name']) delete headers[k];
      headers['x-remote-user'] = USER; headers['x-script-name'] = '/dav'; headers.host = `127.0.0.1:${RAD_PORT}`;
      const p = http.request({ host: '127.0.0.1', port: RAD_PORT, method: req.method, path: req.url || '/', headers }, (pr) => {
        res.writeHead(pr.statusCode, pr.headers);
        pr.pipe(res);
        if (['PUT', 'DELETE', 'MOVE', 'PROPPATCH', 'MKCALENDAR', 'MKCOL'].includes(req.method) && pr.statusCode < 300) { changed(); }
      });
      p.on('error', () => { if (!res.headersSent) res.status(502).send('Agenda niet bereikbaar'); else res.end(); });
      req.pipe(p);
    });
    // openbare (alleen-lezen) link van een gedeelde agenda
    app.get('/ics/:token', (req, res) => {
      const token = String(req.params.token).replace(/\.ics$/, '');
      const meta = store.read('calmeta', {});
      const id = Object.keys(meta).find((k) => meta[k] && meta[k].shareToken && crypto.timingSafeEqual(Buffer.from(meta[k].shareToken.padEnd(64)), Buffer.from(token.padEnd(64).slice(0, 64))) && meta[k].shareToken === token);
      if (!id) return res.status(404).send('Deze link bestaat niet (meer).');
      const cal = collections().find((c) => c.id === id); if (!cal) return res.status(404).send('Niet gevonden');
      const texts = items(id).map((it) => it.text);
      // details weglaten als dat zo ingesteld is
      let body = I.feed(cal.name, cal.color, texts);
      if (meta[id].shareBusyOnly) body = body.replace(/^(SUMMARY:).*$/gm, '$1Bezet').replace(/^(DESCRIPTION|LOCATION|URL|ATTENDEE)[;:].*(\r?\n[ \t].*)*\r?\n/gm, '');
      res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.send(body);
    });
  }

  // ------------------------------------------------------------ API
  const validDate = (s) => /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(String(s || ''));
  function cleanEventInput(b) {
    if (!validDate(b.start)) throw bad('Kies een begin');
    if (b.end && !validDate(b.end)) throw bad('Ongeldig einde');
    const o = {
      title: String(b.title || '').trim() || 'Nieuwe afspraak', start: b.start, end: b.end || null, allDay: !!b.allDay,
      location: b.location || '', description: b.description || '', url: b.url || '', color: b.color || '',
      categories: Array.isArray(b.categories) ? b.categories : [], transp: b.transp, status: b.status,
      alarms: Array.isArray(b.alarms) ? b.alarms.slice(0, 10) : [], attendees: Array.isArray(b.attendees) ? b.attendees : [],
    };
    if (b.repeat !== undefined) o.repeat = b.repeat && b.repeat.freq ? b.repeat : null;
    return o;
  }
  function saveExtras(uid, b) {
    if (b.bring === undefined && b.travel === undefined) return;
    store.update('extras', {}, (x) => {
      const e = x[uid] || {};
      if (b.bring !== undefined) e.bring = (Array.isArray(b.bring) ? b.bring : String(b.bring).split(/[,\n]/)).map((s) => String(s).trim()).filter(Boolean).slice(0, 40);
      if (b.travel !== undefined) e.travel = Math.max(0, Math.min(600, Number(b.travel) || 0));
      x[uid] = e;
    });
  }
  async function createEvent(b) {
    const cal = davCal(b.cal || 'persoonlijk');
    const o = cleanEventInput(b);
    const { uid, text } = I.newEvent(o);
    await putItem(cal.id, hrefFor(uid), text);
    saveExtras(uid, b);
    return { uid, cal: cal.id, href: hrefFor(uid) };
  }

  function routes(app) {
    app.get('/api/agenda/calendars', wrap(async (req, res) => {
      res.json({ calendars: allCalendars(), sync: { ok: useRadicale(), user: USER, error: useRadicale() ? '' : rad.lastError, path: '/dav/' } });
    }));
    app.post('/api/agenda/calendars', wrap(async (req, res) => {
      const name = String(req.body.name || '').trim().slice(0, 60); if (!name) throw bad('Geef een naam');
      const color = normColor(req.body.color) || '#6366F1';
      const kind = req.body.kind === 'VTODO' ? 'VTODO' : 'VEVENT';
      const id = await createCollection(name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) + '-' + crypto.randomBytes(2).toString('hex'), name, color, kind);
      store.update('calmeta', {}, (m) => { m[id] = { order: 50 }; });
      changed(); res.json({ id });
    }));
    app.patch('/api/agenda/calendars/:id', wrap(async (req, res) => {
      const id = req.params.id, b = req.body;
      const isVirtual = id === 'feestdagen' || id.startsWith('sub-');
      if (!isVirtual && (b.name || b.color)) await patchCollection(id, { name: b.name ? String(b.name).slice(0, 60) : undefined, color: normColor(b.color) || undefined });
      if (id.startsWith('sub-') && (b.name || b.color)) subs.patch(id.slice(4), { ...(b.name ? { name: String(b.name).slice(0, 60) } : {}), ...(b.color ? { color: normColor(b.color) } : {}) });
      store.update('calmeta', {}, (m) => {
        const x = m[id] || {};
        if (b.hidden !== undefined) x.hidden = !!b.hidden;
        if (b.bring !== undefined) x.bring = (Array.isArray(b.bring) ? b.bring : String(b.bring).split(/[,\n]/)).map((s) => String(s).trim()).filter(Boolean).slice(0, 40);
        if (b.order !== undefined) x.order = Number(b.order) || 0;
        if (b.share === true && !x.shareToken) x.shareToken = crypto.randomBytes(18).toString('base64url');
        if (b.share === false) delete x.shareToken;
        if (b.shareBusyOnly !== undefined) x.shareBusyOnly = !!b.shareBusyOnly;
        m[id] = x;
      });
      changed(); res.json({ ok: true, meta: store.read('calmeta', {})[id] });
    }));
    app.delete('/api/agenda/calendars/:id', wrap(async (req, res) => {
      const id = req.params.id;
      if (id.startsWith('sub-')) { subs.remove(id.slice(4)); fs.rmSync(path.join(SUB_DIR, `${id.slice(4)}.ics`), { force: true }); changed(); return res.json({ ok: true }); }
      if (id === 'feestdagen') throw bad('Verberg de feestdagen in plaats van ze te verwijderen');
      await ctx.requireStepUp(req, 'agenda verwijderen');
      await deleteCollection(id); changed(); res.json({ ok: true });
    }));
    app.post('/api/agenda/subscriptions', wrap(async (req, res) => {
      const url = String(req.body.url || '').trim();
      if (!/^(https?|webcal):\/\/[^\s]+$/i.test(url)) throw bad('Plak een geldige link (https:// of webcal://)');
      const s = subs.add({ name: String(req.body.name || '').trim().slice(0, 60) || 'Abonnement', url, color: normColor(req.body.color) || '#38BDF8' });
      await fetchSub(s);
      const fresh = subs.get(s.id);
      res.json({ id: `sub-${s.id}`, error: fresh.error || '' });
    }));
    app.post('/api/agenda/subscriptions/:id/refresh', wrap(async (req, res) => { const s = subs.get(req.params.id.replace(/^sub-/, '')); if (!s) throw bad('Niet gevonden', 404); await fetchSub(s); res.json({ ok: true, error: subs.get(s.id).error || '' }); }));

    app.get('/api/agenda/events', wrap(async (req, res) => {
      const from = Number(req.query.from) || Date.now() - 7 * 864e5, to = Number(req.query.to) || from + 42 * 864e5;
      if (to - from > 400 * 864e5) throw bad('Periode te lang');
      res.json(occurrences(from, to));
    }));
    app.get('/api/agenda/search', wrap(async (req, res) => {
      const q = String(req.query.q || '').trim().toLowerCase(); if (q.length < 2) return res.json([]);
      const now = Date.now();
      const list = occurrences(now - 365 * 864e5, now + 2 * 365 * 864e5).filter((o) => `${o.title} ${o.location} ${o.description} ${o.categories.join(' ')}`.toLowerCase().includes(q));
      // per reeks enkel het eerstvolgende voorkomen
      const seen = new Set(); const out = [];
      for (const o of list.sort((a, b) => Math.abs(a.start - now) - Math.abs(b.start - now))) { if (seen.has(o.uid)) continue; seen.add(o.uid); out.push(o); if (out.length >= 40) break; }
      res.json(out.sort((a, b) => a.start - b.start));
    }));
    app.get('/api/agenda/event/:cal/:href', wrap(async (req, res) => {
      const text = readItem(req.params.cal, req.params.href);
      const uid = String(req.query.uid || '');
      const d = I.eventDetails(text, uid); if (!d) throw bad('Niet gevonden', 404);
      const ex = store.read('extras', {})[uid] || {};
      res.json({ ...d, cal: req.params.cal, href: req.params.href, bring: ex.bring || [], travel: ex.travel || 0 });
    }));
    app.post('/api/agenda/events', wrap(async (req, res) => { res.json(await createEvent(req.body)); }));
    app.put('/api/agenda/event/:cal/:href', wrap(async (req, res) => {
      const b = req.body; const uid = String(b.uid || ''); const scope = ['all', 'this', 'future'].includes(b.scope) ? b.scope : 'all';
      const cal = davCal(req.params.cal);
      const text = readItem(cal.id, req.params.href);
      const o = cleanEventInput(b);
      // naar een andere agenda verplaatsen
      if (b.cal && b.cal !== cal.id && scope === 'all') {
        const target = davCal(b.cal);
        const r = I.editEvent(text, uid, o, 'all', b.recurrenceId || null);
        await putItem(target.id, req.params.href, r.text);
        await deleteItem(cal.id, req.params.href);
        saveExtras(uid, b);
        return res.json({ ok: true, cal: target.id });
      }
      const r = I.editEvent(text, uid, o, scope, b.recurrenceId || null);
      await putItem(cal.id, req.params.href, r.text);
      if (r.extra) { await putItem(cal.id, hrefFor(r.extra.uid), r.extra.text); const ex = store.read('extras', {})[uid]; if (ex) store.update('extras', {}, (x) => { x[r.extra.uid] = { ...ex }; }); }
      saveExtras(uid, b);
      res.json({ ok: true });
    }));
    app.delete('/api/agenda/event/:cal/:href', wrap(async (req, res) => {
      const cal = davCal(req.params.cal); const uid = String(req.query.uid || ''); const scope = String(req.query.scope || 'all');
      const text = readItem(cal.id, req.params.href);
      const next = I.deleteEvent(text, uid, scope, req.query.recurrenceId || null);
      if (next === null) { await deleteItem(cal.id, req.params.href); store.update('extras', {}, (x) => { delete x[uid]; }); }
      else await putItem(cal.id, req.params.href, next);
      res.json({ ok: true });
    }));
    // "Morgen klaarleggen": afspraken van een dag + wat je moet meenemen
    app.get('/api/agenda/prepare', wrap(async (req, res) => {
      const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : null;
      const day = date ? I.ms(I.toTime(date, true)) : (() => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + 1); return d.getTime(); })();
      const list = occurrences(day, day + 864e5).filter((o) => !o.allDay || o.bring.length);
      const dkey = new Date(day + 3600e3).toISOString().slice(0, 10);
      const checks = store.read('bringChecks', {});
      res.json({ date: dkey, items: list.map((o) => ({ ...o, checked: checks[`${o.uid}|${dkey}`] || [] })) });
    }));
    app.post('/api/agenda/prepare/check', wrap(async (req, res) => {
      const { uid, date, item, checked } = req.body;
      if (!uid || !/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw bad('Ongeldig');
      store.update('bringChecks', {}, (c) => {
        const k = `${uid}|${date}`; const s = new Set(c[k] || []);
        if (checked) s.add(String(item)); else s.delete(String(item));
        c[k] = [...s];
        // oude dagen opruimen
        const cutoff = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
        for (const key of Object.keys(c)) if (key.split('|')[1] < cutoff) delete c[key];
      });
      res.json({ ok: true });
    }));
    app.post('/api/agenda/prepare/add', wrap(async (req, res) => {
      const { uid, item } = req.body; if (!uid || !String(item || '').trim()) throw bad('Ongeldig');
      store.update('extras', {}, (x) => { const e = x[uid] || {}; e.bring = [...new Set([...(e.bring || []), String(item).trim().slice(0, 80)])]; x[uid] = e; });
      res.json({ ok: true });
    }));
    // importeren / exporteren
    app.post('/api/agenda/import', ctx.uploadMem.single('file'), wrap(async (req, res) => {
      const cal = davCal(req.body.cal || 'persoonlijk');
      const text = req.file ? req.file.buffer.toString('utf8') : String(req.body.text || '');
      if (!/BEGIN:VCALENDAR/i.test(text)) throw bad('Dit is geen .ics-bestand');
      const list = I.splitIcs(text).filter((x) => (cal.events && x.kind === 'vevent') || (cal.todos && x.kind === 'vtodo'));
      let n = 0;
      for (const it of list.slice(0, 5000)) { await putItem(cal.id, hrefFor(it.uid), it.text); n++; }
      res.json({ imported: n });
    }));
    app.get('/api/agenda/export/:cal', wrap(async (req, res) => {
      const cal = davCal(req.params.cal.replace(/\.ics$/, ''));
      res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${cal.id}.ics"`);
      res.send(I.feed(cal.name, cal.color, items(cal.id).map((x) => x.text)));
    }));
    // instellingen voor synchroniseren met je gsm: app-wachtwoorden
    app.get('/api/agenda/sync', wrap(async (req, res) => {
      const list = (auth().davPasswords || []).map((p) => ({ id: p.id, name: p.name, createdAt: p.createdAt, lastUsed: p.lastUsed || 0 }));
      res.json({ ok: useRadicale(), user: USER, error: rad.lastError, passwords: list, domain: CFG.panelDomain, last: davLast });
    }));
    app.post('/api/agenda/sync/password', wrap(async (req, res) => {
      const name = String(req.body.name || 'Gsm').trim().slice(0, 40) || 'Gsm';
      const bytes = crypto.randomBytes(16);
      const pw = [...bytes].map((b) => PW_CHARS[b % PW_CHARS.length]).join('').match(/.{4}/g).join('-');
      const a = auth(); a.davPasswords = a.davPasswords || [];
      a.davPasswords.push({ id: crypto.randomBytes(6).toString('hex'), name, hash: ctx.hashPassword(pw), createdAt: Date.now() });
      ctx.saveAuth(); res.json({ password: pw, user: USER });
    }));
    app.delete('/api/agenda/sync/password/:id', wrap(async (req, res) => {
      const a = auth(); a.davPasswords = (a.davPasswords || []).filter((p) => p.id !== req.params.id); ctx.saveAuth(); davOkCache.clear(); res.json({ ok: true });
    }));

    // ---- taken
    app.get('/api/tasks', wrap(async (req, res) => {
      res.json({ lists: collections().filter((c) => c.todos), tasks: todos() });
    }));
    app.post('/api/tasks', wrap(async (req, res) => {
      const b = req.body; const lists = collections().filter((c) => c.todos);
      const list = lists.find((c) => c.id === b.list) || lists.find((c) => c.id === 'taken') || lists[0];
      if (!list) throw bad('Er is nog geen takenlijst');
      if (b.due && !validDate(b.due)) throw bad('Ongeldige datum');
      const { uid, text } = I.newTodo({ title: String(b.title || '').trim() || 'Nieuwe taak', description: b.description || '', due: b.due || null, priority: b.priority || 0, categories: b.categories || [], repeat: b.repeat && b.repeat.freq ? b.repeat : null, alarms: Array.isArray(b.alarms) ? b.alarms : [], parent: b.parent || '' });
      await putItem(list.id, hrefFor(uid), text);
      res.json({ uid, list: list.id, href: hrefFor(uid) });
    }));
    app.put('/api/tasks/:list/:href', wrap(async (req, res) => {
      const b = req.body; const list = davCal(req.params.list);
      const text = readItem(list.id, req.params.href);
      const o = {};
      for (const k of ['title', 'description', 'due', 'priority', 'categories', 'repeat', 'alarms', 'done', 'parent']) if (b[k] !== undefined) o[k] = b[k];
      if (o.due && !validDate(o.due)) throw bad('Ongeldige datum');
      if (o.repeat !== undefined && !(o.repeat && o.repeat.freq)) o.repeat = null;
      const r = I.editTodo(text, String(b.uid || ''), o);
      if (b.list && b.list !== list.id) { const target = davCal(b.list); await putItem(target.id, req.params.href, r.text); await deleteItem(list.id, req.params.href); }
      else await putItem(list.id, req.params.href, r.text);
      res.json({ ok: true, advanced: r.advanced || null });
    }));
    app.delete('/api/tasks/:list/:href', wrap(async (req, res) => {
      const list = davCal(req.params.list);
      // subtaken mee weg
      const uid = String(req.query.uid || '');
      for (const t of todos()) if (t.parent === uid && t.list === list.id) await deleteItem(list.id, t.href);
      await deleteItem(list.id, req.params.href); res.json({ ok: true });
    }));
  }

  if (!DEMO || process.env.RADICALE_IN_DEMO === '1') startRadicale();
  // zonder Radicale (demo): meteen standaard-agenda's maken
  setTimeout(() => { if (!useRadicale()) ensureDefaults().catch(() => {}); }, DEMO ? 10 : 20000);

  return { early, routes, occurrences, todos, collections, allCalendars, createEvent, putItem, readItem, deleteItem, davCal, items, hrefFor, USER, status: () => ({ ok: useRadicale(), error: rad.lastError }), stop: () => { if (rad.proc) { rad.restarts = 99; rad.proc.kill(); } } };
};
