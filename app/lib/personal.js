'use strict';
/* Persoonlijke onderdelen: instellingen, notities, uitgaven, aftellen, klembord, bestanden delen en snel typen. */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const Q = require('./quickparse');

const DEFAULT_SETTINGS = {
  name: 'Rawend',
  evening: { enabled: true, time: '21:00' },
  push: { reminders: true, evening: true, tasks: true, sites: true, server: true, countdown: true },
  shiftTemplates: [
    { name: 'Vroege dienst', title: 'Werk · vroege dienst', start: '07:00', end: '15:00', cal: 'werk' },
    { name: 'Dagdienst', title: 'Werk · dagdienst', start: '08:00', end: '16:00', cal: 'werk' },
    { name: 'Late dienst', title: 'Werk · late dienst', start: '16:00', end: '20:00', cal: 'werk' },
  ],
  budget: 45000, // in centen
  expenseCategories: Q.EXPENSE_CATS,
  defaultCal: 'persoonlijk',
  defaultAlarm: 15,
  agendaView: 'week',
  weekStart: 1,
  dashboard: null,
};

const NOTE_COLORS = ['', 'indigo', 'blauw', 'paars', 'groen', 'geel', 'roze', 'grijs'];
const noteColor = (c) => (NOTE_COLORS.includes(String(c || '')) ? String(c || '') : '');
module.exports = function personal(ctx) {
  const { CFG, store, wrap, bad, broadcast } = ctx;
  const notes = store.list('notes');
  const expenses = store.list('expenses');
  const recurring = store.list('recurringExpenses');
  const countdowns = store.list('countdowns');
  const clips = store.list('clipboard');
  const shares = store.list('shares');
  const SHARE_DIR = path.join(CFG.dataDir, 'shares'); fs.mkdirSync(SHARE_DIR, { recursive: true });

  function settings() {
    const s = store.read('settings', {});
    const out = { ...structuredClone(DEFAULT_SETTINGS), ...s };
    out.evening = { ...DEFAULT_SETTINGS.evening, ...(s.evening || {}) };
    out.push = { ...DEFAULT_SETTINGS.push, ...(s.push || {}) };
    if (!Array.isArray(out.expenseCategories) || out.expenseCategories.some((c) => typeof c !== 'string')) out.expenseCategories = structuredClone(DEFAULT_SETTINGS.expenseCategories);
    return out;
  }
  function saveSettings(patch) {
    const cur = store.read('settings', {});
    const allowed = ['name', 'evening', 'push', 'shiftTemplates', 'budget', 'expenseCategories', 'defaultCal', 'defaultAlarm', 'agendaView', 'weekStart', 'dashboard'];
    for (const k of Object.keys(patch)) if (allowed.includes(k)) cur[k] = patch[k];
    if (cur.evening && !/^\d{2}:\d{2}$/.test(cur.evening.time || '')) cur.evening.time = '21:00';
    if (Array.isArray(cur.shiftTemplates)) cur.shiftTemplates = cur.shiftTemplates.filter((t) => t && /^\d{2}:\d{2}$/.test(t.start) && /^\d{2}:\d{2}$/.test(t.end)).slice(0, 12).map((t) => ({ name: String(t.name || '').slice(0, 40), title: String(t.title || t.name || '').slice(0, 80), start: t.start, end: t.end, cal: String(t.cal || '') }));
    if (cur.name !== undefined) cur.name = String(cur.name || '').trim().slice(0, 40) || 'Rawend';
    if (cur.expenseCategories !== undefined) cur.expenseCategories = (Array.isArray(cur.expenseCategories) ? cur.expenseCategories : []).map((x) => String(x).trim().slice(0, 40)).filter((x) => x && typeof x === 'string').filter((v, i, a) => a.indexOf(v) === i).slice(0, 30);
    if (cur.budget !== undefined) cur.budget = Math.max(0, Math.round(Number(cur.budget) || 0));
    store.write('settings', cur);
    broadcast('settings', { t: Date.now() });
    return settings();
  }

  // ------------------------------------------------------------ uitgaven: vaste uitgaven elke maand toevoegen
  function runRecurring() {
    const now = new Date();
    for (const r of recurring.all()) {
      const day = Math.min(28, Math.max(1, Number(r.day) || 1));
      // elke maand vanaf de startmaand tot nu
      const start = r.lastMonth ? new Date(`${r.lastMonth}-01T00:00:00`) : new Date(now.getFullYear(), now.getMonth() - (now.getDate() >= day ? 0 : 1), 1);
      let cursor = r.lastMonth ? new Date(start.getFullYear(), start.getMonth() + 1, 1) : start;
      let last = r.lastMonth;
      while (cursor <= now) {
        const due = new Date(cursor.getFullYear(), cursor.getMonth(), day);
        if (due > now) break;
        const key = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}`;
        if (!expenses.all().some((e) => e.recurringId === r.id && e.date.startsWith(key))) {
          expenses.add({ amount: r.amount, category: r.category, description: r.description, date: `${key}-${String(day).padStart(2, '0')}`, recurringId: r.id });
        }
        last = key;
        cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
      }
      if (last !== r.lastMonth) recurring.patch(r.id, { lastMonth: last });
    }
  }
  setTimeout(runRecurring, 5000).unref();
  setInterval(runRecurring, 6 * 3600e3).unref();

  // ------------------------------------------------------------ gedeelde bestanden opruimen
  async function cleanShares() {
    for (const s of shares.all()) {
      if (s.expiresAt && s.expiresAt < Date.now()) { await fsp.rm(path.join(SHARE_DIR, s.id), { force: true }); shares.remove(s.id); }
    }
  }
  setInterval(cleanShares, 3600e3).unref(); setTimeout(cleanShares, 10000).unref();

  const isPhone = (req) => /Android|iPhone|iPad|Mobile/i.test(req.headers['user-agent'] || '');
  const money = (v) => { const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : Number(v); if (!Number.isFinite(n)) throw bad('Ongeldig bedrag'); return Math.round(n * 100); };
  const validDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

  // ------------------------------------------------------------ openbare download-links
  function early(app) {
    const page = (title, body) => `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>
      :root{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px/1.5 system-ui,sans-serif;background:#080C18;color:#E9ECF7}
      @media (prefers-color-scheme:light){body{background:#F3F5FB;color:#0D1326}.c{background:#fff!important;border-color:#E4E8F2!important}}
      .c{background:#10172C;border:1px solid rgba(150,165,220,.12);border-radius:22px;padding:28px;max-width:380px;width:calc(100% - 32px);text-align:center}
      .i{width:56px;height:56px;border-radius:16px;margin:0 auto 14px;background:linear-gradient(135deg,#6366F1,#38BDF8);display:grid;place-items:center;color:#fff;font-weight:800}
      h1{font-size:18px;margin:0 0 4px;word-break:break-all}p{opacity:.7;margin:0 0 20px;font-size:14px}a{display:block;background:#6366F1;color:#fff;text-decoration:none;padding:13px;border-radius:12px;font-weight:600}</style></head><body><div class="c">${body}</div></body></html>`;
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const find = (token) => shares.all().find((s) => s.token === token);
    app.get('/d/:token', (req, res) => {
      const s = find(req.params.token);
      res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'"); res.setHeader('X-Robots-Tag', 'noindex');
      if (!s || (s.expiresAt && s.expiresAt < Date.now()) || (s.maxDownloads && s.downloads >= s.maxDownloads)) return res.status(410).send(page('Link verlopen', '<div class="i">!</div><h1>Deze link is verlopen</h1><p>Vraag een nieuwe link aan de persoon die hem stuurde.</p>'));
      const ext = (path.extname(s.name).slice(1) || 'file').slice(0, 4).toUpperCase();
      res.send(page(esc(s.name), `<div class="i">${esc(ext)}</div><h1>${esc(s.name)}</h1><p>${(s.size / 1024 / 1024).toFixed(s.size > 1048576 ? 1 : 2)} MB</p><a href="/d/${esc(s.token)}/download">Downloaden</a>`));
    });
    app.get('/d/:token/download', (req, res) => {
      const s = find(req.params.token);
      if (!s || (s.expiresAt && s.expiresAt < Date.now()) || (s.maxDownloads && s.downloads >= s.maxDownloads)) return res.status(410).send('Verlopen');
      shares.patch(s.id, { downloads: (s.downloads || 0) + 1, lastDownload: Date.now() });
      broadcast('shares', { t: Date.now() });
      res.download(path.join(SHARE_DIR, s.id), s.name);
    });
  }

  function routes(app) {
    // ---- instellingen
    app.get('/api/settings', (req, res) => res.json(settings()));
    app.put('/api/settings', wrap(async (req, res) => res.json(saveSettings(req.body || {}))));

    // ---- snel typen
    app.post('/api/quick/parse', wrap(async (req, res) => {
      const cals = ctx.calendar.collections().filter((c) => c.events).map((c) => ({ id: c.id, name: c.name }));
      const text = String(req.body.text || '');
      const r = noExpense(Q.parse(text, { calendars: cals, templates: settings().shiftTemplates }));
      res.json(r);
    }));
    app.post('/api/quick/add', wrap(async (req, res) => {
      const r = req.body.parsed && req.body.parsed.kind ? req.body.parsed : parseWithHabits(String(req.body.text || ''));
      res.json(await addParsed(r));
    }));

    app.post('/api/quick/undo', wrap(async (req, res) => {
      const it = req.body.item || {};
      if (!['event', 'task', 'expense', 'note', 'countdown'].includes(it.kind)) throw bad('Kan dit niet ongedaan maken');
      if ((it.kind === 'event' || it.kind === 'task') && !(/^[\w.-]+$/.test(it.cal || it.list || '') && /^[\w@.%+-]+\.ics$/.test(it.href || ''))) throw bad('Ongeldig');
      await undo(it); res.json({ ok: true });
    }));

    // ---- notities
    app.get('/api/notes', (req, res) => res.json({ notes: notes.all().sort((a, b) => (b.pinned - a.pinned) || (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt)), folders: store.read('noteFolders', ['School', 'Werk', 'Persoonlijk']) }));
    app.post('/api/notes', wrap(async (req, res) => {
      const n = notes.add({ title: String(req.body.title || '').slice(0, 200), body: String(req.body.body || '').slice(0, 200000), folder: String(req.body.folder || '').slice(0, 40), color: noteColor(req.body.color), pinned: !!req.body.pinned, quick: !!req.body.quick, updatedAt: Date.now() });
      broadcast('notes', { id: n.id }); res.json(n);
    }));
    app.put('/api/notes/:id', wrap(async (req, res) => {
      const f = {}; for (const k of ['title', 'body', 'folder', 'pinned', 'color']) if (req.body[k] !== undefined) f[k] = k === 'pinned' ? !!req.body[k] : k === 'color' ? noteColor(req.body[k]) : String(req.body[k]).slice(0, k === 'body' ? 200000 : 200);
      if (req.body.updatedAt === false) delete f.updatedAt; else f.updatedAt = Date.now();
      const n = notes.patch(req.params.id, f); if (!n) throw bad('Niet gevonden', 404);
      broadcast('notes', { id: n.id, from: req.body.clientId || '' }); res.json(n);
    }));
    app.delete('/api/notes/:id', wrap(async (req, res) => { notes.remove(req.params.id); broadcast('notes', {}); res.json({ ok: true }); }));
    app.post('/api/notes-folders/rename', wrap(async (req, res) => {
      const from = String(req.body.from || '').trim(), to = String(req.body.to || '').trim().slice(0, 40);
      const list = store.read('noteFolders', ['School', 'Werk', 'Persoonlijk']);
      if (!from) throw bad('Geen map');
      const next = to ? list.map((x) => (x === from ? to : x)) : list.filter((x) => x !== from);
      store.write('noteFolders', [...new Set(next)]);
      for (const n of notes.all()) if (n.folder === from) notes.patch(n.id, { folder: to });
      broadcast('notes', {}); res.json(store.read('noteFolders', []));
    }));
    app.put('/api/notes-folders', wrap(async (req, res) => { const l = (req.body.folders || []).map((x) => String(x).trim().slice(0, 40)).filter(Boolean).slice(0, 40); store.write('noteFolders', [...new Set(l)]); res.json(l); }));
    // snelle notitie (het kladblok op het dashboard)
    app.get('/api/notes/quick', (req, res) => { let n = notes.all().find((x) => x.quick); if (!n) n = notes.add({ title: 'Snelle notitie', body: '', quick: true, pinned: false, folder: '', updatedAt: Date.now() }); res.json(n); });

    // ---- uitgaven
    app.get('/api/expenses', wrap(async (req, res) => {
      const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : new Date().toISOString().slice(0, 7);
      const list = expenses.all().filter((e) => e.date.startsWith(month)).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
      const total = list.reduce((a, e) => a + e.amount, 0);
      const byCat = {}; for (const e of list) byCat[e.category] = (byCat[e.category] || 0) + e.amount;
      // vorige 6 maanden voor de grafiek
      const months = []; const d = new Date(`${month}-01T12:00:00`);
      for (let i = 5; i >= 0; i--) { const m = new Date(d.getFullYear(), d.getMonth() - i, 1); const k = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`; months.push({ month: k, total: expenses.all().filter((e) => e.date.startsWith(k)).reduce((a, e) => a + e.amount, 0) }); }
      res.json({ month, total, budget: settings().budget, byCat, list, months, recurring: recurring.all(), categories: settings().expenseCategories });
    }));
    app.post('/api/expenses', wrap(async (req, res) => {
      const b = req.body; const date = validDay(b.date) ? b.date : new Date().toISOString().slice(0, 10);
      const e = expenses.add({ amount: money(b.amount), category: String(b.category || 'Overig').slice(0, 40), description: String(b.description || '').slice(0, 200), date });
      broadcast('expenses', {}); res.json(e);
    }));
    app.put('/api/expenses/:id', wrap(async (req, res) => {
      const b = req.body; const f = {};
      if (b.amount !== undefined) f.amount = money(b.amount); if (b.category !== undefined) f.category = String(b.category).slice(0, 40);
      if (b.description !== undefined) f.description = String(b.description).slice(0, 200); if (b.date !== undefined && validDay(b.date)) f.date = b.date;
      const e = expenses.patch(req.params.id, f); if (!e) throw bad('Niet gevonden', 404); broadcast('expenses', {}); res.json(e);
    }));
    app.delete('/api/expenses/:id', wrap(async (req, res) => { expenses.remove(req.params.id); broadcast('expenses', {}); res.json({ ok: true }); }));
    app.post('/api/expenses/recurring', wrap(async (req, res) => {
      const b = req.body; const r = recurring.add({ amount: money(b.amount), category: String(b.category || 'Abonnementen'), description: String(b.description || '').slice(0, 200), day: Math.min(28, Math.max(1, Number(b.day) || 1)) });
      runRecurring(); broadcast('expenses', {}); res.json(r);
    }));
    app.delete('/api/expenses/recurring/:id', wrap(async (req, res) => { recurring.remove(req.params.id); broadcast('expenses', {}); res.json({ ok: true }); }));

    // ---- aftellen
    app.get('/api/countdowns', (req, res) => res.json(countdowns.all().sort((a, b) => a.date.localeCompare(b.date))));
    app.post('/api/countdowns', wrap(async (req, res) => {
      if (!validDay(req.body.date)) throw bad('Kies een datum');
      const c = countdowns.add({ title: String(req.body.title || 'Aftellen').slice(0, 100), date: req.body.date, time: /^\d{2}:\d{2}$/.test(req.body.time || '') ? req.body.time : '', pinned: req.body.pinned !== false });
      broadcast('countdowns', {}); res.json(c);
    }));
    app.put('/api/countdowns/:id', wrap(async (req, res) => {
      const f = {}; if (req.body.title !== undefined) f.title = String(req.body.title).slice(0, 100); if (validDay(req.body.date)) f.date = req.body.date; if (req.body.pinned !== undefined) f.pinned = !!req.body.pinned;
      const c = countdowns.patch(req.params.id, f); if (!c) throw bad('Niet gevonden', 404); broadcast('countdowns', {}); res.json(c);
    }));
    app.delete('/api/countdowns/:id', wrap(async (req, res) => { countdowns.remove(req.params.id); broadcast('countdowns', {}); res.json({ ok: true }); }));

    // ---- klembord
    app.get('/api/clipboard', (req, res) => res.json(clips.all().sort((a, b) => (b.pinned - a.pinned) || b.createdAt - a.createdAt)));
    app.post('/api/clipboard', wrap(async (req, res) => {
      const text = String(req.body.text || '').slice(0, 100000); if (!text.trim()) throw bad('Leeg');
      const c = clips.add({ text, from: isPhone(req) ? 'gsm' : 'laptop', pinned: false });
      // max 50 (vastgepinde blijven)
      const all = clips.all().sort((a, b) => b.createdAt - a.createdAt); let n = 0;
      for (const x of all) { if (x.pinned) continue; if (++n > 50) clips.remove(x.id); }
      broadcast('clipboard', { id: c.id }); res.json(c);
    }));
    app.put('/api/clipboard/:id', wrap(async (req, res) => { const c = clips.patch(req.params.id, { pinned: !!req.body.pinned }); broadcast('clipboard', {}); res.json(c); }));
    app.delete('/api/clipboard/:id', wrap(async (req, res) => { clips.remove(req.params.id); broadcast('clipboard', {}); res.json({ ok: true }); }));
    app.delete('/api/clipboard', wrap(async (req, res) => { clips.replace(clips.all().filter((c) => c.pinned)); broadcast('clipboard', {}); res.json({ ok: true }); }));

    // ---- bestanden delen
    app.get('/api/shares', (req, res) => res.json(shares.all().sort((a, b) => b.createdAt - a.createdAt).map((s) => ({ ...s, url: `/d/${s.token}` }))));
    app.post('/api/shares', ctx.uploadDisk.single('file'), wrap(async (req, res) => {
      if (!req.file) throw bad('Kies een bestand');
      const hours = Math.min(24 * 30, Math.max(1, Number(req.body.hours) || 24));
      const id = crypto.randomBytes(8).toString('hex');
      await fsp.rename(req.file.path, path.join(SHARE_DIR, id)).catch(async () => { await fsp.copyFile(req.file.path, path.join(SHARE_DIR, id)); await fsp.rm(req.file.path, { force: true }); });
      const s = shares.add({ id, token: crypto.randomBytes(12).toString('base64url'), name: path.basename(req.file.originalname).slice(0, 200), size: req.file.size, mime: req.file.mimetype, expiresAt: Date.now() + hours * 3600e3, downloads: 0, maxDownloads: Number(req.body.maxDownloads) || 0 });
      broadcast('shares', {}); res.json({ ...s, url: `/d/${s.token}` });
    }));
    app.put('/api/shares/:id', wrap(async (req, res) => {
      const s = shares.get(req.params.id); if (!s) throw bad('Niet gevonden', 404);
      const f = {}; if (req.body.hours) f.expiresAt = Date.now() + Math.min(24 * 30, Math.max(1, Number(req.body.hours))) * 3600e3;
      res.json(shares.patch(s.id, f));
    }));
    app.delete('/api/shares/:id', wrap(async (req, res) => { await fsp.rm(path.join(SHARE_DIR, req.params.id), { force: true }); shares.remove(req.params.id); broadcast('shares', {}); res.json({ ok: true }); }));
  }

  // iets toevoegen dat uit "snel typen" komt
  async function addParsed(r) {
    if (r.kind === 'event') {
      const cal = r.cal || settings().defaultCal;
      const out = await ctx.calendar.createEvent({ cal, title: r.title, start: r.start, end: r.end, allDay: r.allDay, location: r.location || '', repeat: r.repeat || null, alarms: r.alarms || (settings().defaultAlarm >= 0 ? [{ min: settings().defaultAlarm }] : []), bring: r.bring });
      return { kind: 'event', ...out, title: r.title, summary: r.summary };
    }
    if (r.kind === 'task') {
      const lists = ctx.calendar.collections().filter((c) => c.todos);
      const list = lists.find((c) => c.id === 'taken') || lists[0]; if (!list) throw bad('Er is nog geen takenlijst');
      const I = require('./ical');
      const { uid, text } = I.newTodo({ title: r.title, due: r.due || null, repeat: r.repeat || null, alarms: r.alarms || [] });
      await ctx.calendar.putItem(list.id, ctx.calendar.hrefFor(uid), text);
      return { kind: 'task', uid, list: list.id, href: ctx.calendar.hrefFor(uid), title: r.title, summary: r.summary };
    }
    if (r.kind === 'expense') {
      if (!r.amount) throw bad('Geen bedrag gevonden');
      const e = expenses.add({ amount: r.amount, category: r.category || 'Overig', description: r.title || '', date: r.date || new Date().toISOString().slice(0, 10) });
      broadcast('expenses', {}); return { kind: 'expense', id: e.id, title: r.title, summary: r.summary };
    }
    if (r.kind === 'note') {
      const n = notes.add({ title: '', body: r.text || r.title || '', folder: '', pinned: false, updatedAt: Date.now() });
      broadcast('notes', {}); return { kind: 'note', id: n.id, summary: 'Notitie bewaard' };
    }
    if (r.kind === 'countdown') {
      if (!r.date) throw bad('Geen datum gevonden voor het aftellen');
      const c = countdowns.add({ title: r.title, date: r.date, time: '', pinned: true });
      broadcast('countdowns', {}); return { kind: 'countdown', id: c.id, title: r.title, summary: r.summary };
    }
    throw bad('Ik begreep niet wat je wil toevoegen');
  }
  // ongedaan maken (snel typen)
  async function undo(item) {
    if (item.kind === 'event' || item.kind === 'task') { await ctx.calendar.deleteItem(item.cal || item.list, item.href); return true; }
    if (item.kind === 'expense') { expenses.remove(item.id); broadcast('expenses', {}); return true; }
    if (item.kind === 'note') { notes.remove(item.id); broadcast('notes', {}); return true; }
    if (item.kind === 'countdown') { countdowns.remove(item.id); broadcast('countdowns', {}); return true; }
    return false;
  }

  // snel typen
  function parseWithHabits(t) {
    const r = noExpense(Q.parse(t, { calendars: ctx.calendar.collections().filter((c) => c.events).map((c) => ({ id: c.id, name: c.name })), templates: settings().shiftTemplates }));
    return r;
  }
  // uitgaven zitten niet meer in het paneel: een bedrag wordt gewoon een taak (bv. "spotify 11,99 betalen")
  function noExpense(r) {
    if (!r || r.kind !== 'expense') return r;
    const title = String(r.input || r.title || '').trim().replace(/^./, (c) => c.toUpperCase());
    return { kind: 'task', title, input: r.input, due: null, repeat: null, summary: 'taak zonder datum' };
  }
  return { early, routes, settings, saveSettings, addParsed, undo, notes, expenses, countdowns, clips, shares, parse: parseWithHabits };
};
