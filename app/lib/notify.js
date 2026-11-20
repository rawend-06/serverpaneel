'use strict';
/*
 * Meldingen: pushmeldingen naar je gsm/laptop + een lijst met meldingen in het paneel.
 * Planner: herinneringen van afspraken/taken, het avondoverzicht (21:00) en waarschuwingen over je server en sites.
 */
const fs = require('fs');
const path = require('path');
const webpush = require('web-push');

module.exports = function notify(ctx) {
  const { CFG, DEMO, store, wrap, bad, broadcast } = ctx;
  let vapid = store.read('vapid', null);
  if (!vapid) { vapid = webpush.generateVAPIDKeys(); store.write('vapid', vapid); }
  webpush.setVapidDetails(`mailto:paneel@${CFG.panelDomain || 'jouwserver.local'}`, vapid.publicKey, vapid.privateKey);
  const subs = store.list('pushSubs');
  const feed = store.list('notifications');

  // ------------------------------------------------------------ versturen
  async function push(payload) {
    const list = subs.all();
    await Promise.all(list.map(async (s) => {
      try { await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify(payload), { TTL: 6 * 3600, urgency: payload.urgency || 'normal' }); subs.patch(s.id, { lastOk: Date.now(), fails: 0 }); }
      catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) subs.remove(s.id);
        else { const f = (s.fails || 0) + 1; if (f > 20) subs.remove(s.id); else subs.patch(s.id, { fails: f, lastError: String(e.statusCode || e.message).slice(0, 100) }); }
      }
    }));
  }
  /**
   * kind: reminders | evening | tasks | sites | server | countdown | info
   * inFeed: ook in de lijst "Meldingen" in het paneel zetten
   */
  async function send(kind, { title, body = '', url = '/', tag, inFeed = false, level = 'info' }) {
    const prefs = ctx.personal.settings().push || {};
    if (inFeed) {
      const n = feed.add({ kind, title, body, url, level, read: false, at: Date.now() });
      const all = feed.all(); if (all.length > 120) feed.replace(all.slice(-120));
      broadcast('notifications', { id: n.id });
    }
    if (prefs[kind] === false) return;
    await push({ title, body, url, tag: tag || `${kind}-${Date.now()}`, kind });
  }

  // ------------------------------------------------------------ herinneringen + avondoverzicht
  const sent = () => store.read('sentReminders', {});
  function markSent(key) { store.update('sentReminders', {}, (m) => { m[key] = Date.now(); for (const k of Object.keys(m)) if (Date.now() - m[k] > 4 * 864e5) delete m[k]; }); }
  const pad = (n) => String(n).padStart(2, '0');
  const hm = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const DAYS = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
  const MONTHS = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
  let lastTick = Date.now() - 60000;
  async function tick() {
    const now = Date.now();
    const from = lastTick; lastTick = now;
    try {
      // afspraken
      const occ = ctx.calendar.occurrences(now - 3 * 3600e3, now + 8 * 864e5);
      const done = sent();
      for (const o of occ) {
        for (const a of o.alarms || []) {
          const at = o.start - a.min * 60000;
          if (at > now || at <= from - 5 * 60000) continue; // enkel wat sinds de vorige ronde moest (met 5 min speling)
          if (now - at > 30 * 60000) continue; // te laat, niet meer sturen
          const key = `${o.uid}|${o.recurrenceId || ''}|${a.min}`;
          if (done[key]) continue;
          markSent(key);
          const when = o.allDay ? 'hele dag' : a.min <= 0 ? `nu (${hm(o.start)})` : a.min < 60 ? `over ${a.min} min · ${hm(o.start)}` : `om ${hm(o.start)}${new Date(o.start).toDateString() !== new Date().toDateString() ? ` (${DAYS[new Date(o.start).getDay()]})` : ''}`;
          const bring = o.bring && o.bring.length ? `\nMeenemen: ${o.bring.join(', ')}` : '';
          await send('reminders', { title: o.title, body: `${when}${o.location ? ` · ${o.location}` : ''}${o.travel ? ` · ${o.travel} min reistijd` : ''}${bring}`, url: '/#/agenda', tag: key });
        }
      }
      // taken met een herinnering
      for (const t of ctx.calendar.todos({ includeDone: false })) {
        if (!t.dueMs) continue;
        const base = t.dueAllDay ? t.dueMs + 9 * 3600e3 : t.dueMs; // hele-dag-taken: om 9:00
        for (const a of t.alarms.length ? t.alarms : t.dueAllDay ? [] : [{ min: 0 }]) {
          const at = base - a.min * 60000;
          if (at > now || at <= from - 5 * 60000 || now - at > 30 * 60000) continue;
          const key = `todo|${t.uid}|${t.due}|${a.min}`; if (done[key]) continue; markSent(key);
          await send('tasks', { title: t.title, body: t.dueAllDay ? 'Vandaag' : `Om ${hm(t.dueMs)}`, url: '/#/taken', tag: key });
        }
      }
      // avondoverzicht
      const st = ctx.personal.settings();
      if (st.evening.enabled) {
        const [h, m] = st.evening.time.split(':').map(Number);
        const d = new Date(now); const target = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).getTime();
        const key = `evening|${d.toDateString()}`;
        if (now >= target && now - target < 2 * 3600e3 && !done[key]) { markSent(key); await sendEvening(); }
      }
    } catch (e) { console.log(`Planner: ${e.message}`); }
  }
  function tomorrowSummary() {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + 1);
    const start = d.getTime(), end = start + 864e5;
    const events = ctx.calendar.occurrences(start, end).filter((o) => o.transp !== 'TRANSPARENT' || !o.allDay || o.bring.length);
    const tasks = ctx.calendar.todos({ includeDone: false }).filter((t) => t.dueMs && t.dueMs < end);
    const bring = [...new Set(events.flatMap((o) => o.bring || []))];
    const countdowns = ctx.personal.countdowns.all().map((c) => ({ ...c, days: Math.round((new Date(`${c.date}T00:00:00`).getTime() - (start - 864e5)) / 864e5) })).filter((c) => c.days > 0 && c.days <= 14).sort((a, b) => a.days - b.days);
    return { date: d, events, tasks, bring, countdowns };
  }
  async function sendEvening() {
    const s = tomorrowSummary();
    const lines = [];
    for (const o of s.events.slice(0, 6)) lines.push(`${o.allDay ? 'Hele dag' : hm(o.start)} ${o.title}${o.location ? ` · ${o.location}` : ''}`);
    if (s.events.length > 6) lines.push(`+ ${s.events.length - 6} meer`);
    if (!s.events.length) lines.push('Geen afspraken');
    const overdue = s.tasks.filter((t) => t.dueMs < s.date.getTime()).length;
    const tmr = s.tasks.length - overdue;
    if (tmr || overdue) lines.push(`${tmr ? `${tmr} ${tmr === 1 ? 'taak' : 'taken'}` : ''}${tmr && overdue ? ', ' : ''}${overdue ? `${overdue} te laat` : ''}`);
    if (s.bring.length) lines.push(`Meenemen: ${s.bring.join(', ')}`);
    if (s.countdowns[0]) lines.push(`Nog ${s.countdowns[0].days} ${s.countdowns[0].days === 1 ? 'dag' : 'dagen'}: ${s.countdowns[0].title}`);
    await send('evening', { title: `Morgen · ${DAYS[s.date.getDay()]} ${s.date.getDate()} ${MONTHS[s.date.getMonth()]}`, body: lines.join('\n'), url: '/#/morgen', tag: 'evening' });
  }
  if (!DEMO || process.env.PUSH_IN_DEMO === '1') { setInterval(tick, 30000).unref(); setTimeout(tick, 5000).unref(); }

  // ------------------------------------------------------------ server- en sitebewaking
  const watch = { hot: 0, lastHot: 0, lastDisk: 0, site: new Map() };
  async function watchServer() {
    try {
      const live = ctx.metrics.live();
      const t = live.now && live.now.temp;
      if (t != null && t >= 80) { watch.hot++; if (watch.hot === 3 && Date.now() - watch.lastHot > 3 * 3600e3) { watch.lastHot = Date.now(); await send('server', { title: 'Je server is heet', body: `Processor: ${Math.round(t)} °C. Kijk of de ventilator vrij is.`, url: '/#/server', inFeed: true, level: 'warn' }); } } else watch.hot = 0;
      for (const d of live.disks || []) {
        const p = d.total ? (d.used / d.total) * 100 : 0;
        if (p >= 90 && Date.now() - watch.lastDisk > 24 * 3600e3) { watch.lastDisk = Date.now(); await send('server', { title: 'Schijf bijna vol', body: `${d.mount === '/' ? 'Systeem' : d.mount}: nog ${(d.free / 1024 ** 3).toFixed(1)} GB vrij (${Math.round(p)}% vol).`, url: '/#/server', inFeed: true, level: 'warn' }); }
      }
      const statuses = await ctx.siteStatuses();
      for (const { site, status } of statuses) {
        const prev = watch.site.get(site.name);
        const state = status.state;
        watch.site.set(site.name, state);
        if (!prev || prev === state || ctx.isBusy(site.name)) continue;
        if (prev === 'up' && (state === 'down' || state === 'missing')) await send('sites', { title: `${site.name} is offline`, body: status.text || 'De site antwoordt niet meer.', url: `/#/sites/${site.name}`, inFeed: true, level: 'error', tag: `site-${site.name}` });
        if ((prev === 'down' || prev === 'missing') && state === 'up') await send('sites', { title: `${site.name} is weer online`, body: 'Alles werkt opnieuw.', url: `/#/sites/${site.name}`, inFeed: true, level: 'ok', tag: `site-${site.name}` });
      }
    } catch (e) { /* volgende keer opnieuw */ }
  }
  if (!DEMO) { setInterval(watchServer, 60000).unref(); setTimeout(watchServer, 15000).unref(); }
  // na een herstart via het paneel: melden dat de server terug is
  const REBOOT_FLAG = path.join(CFG.dataDir, 'reboot-pending');
  setTimeout(() => {
    if (fs.existsSync(REBOOT_FLAG)) { fs.rmSync(REBOOT_FLAG, { force: true }); send('server', { title: 'Je server is terug online', body: 'De herstart is gelukt. Alles start nu automatisch op.', url: '/#/server', inFeed: true, level: 'ok' }); }
  }, 20000).unref();

  function routes(app) {
    app.get('/api/push/key', (req, res) => res.json({ key: vapid.publicKey, count: subs.all().length }));
    app.post('/api/push/subscribe', wrap(async (req, res) => {
      const s = req.body && req.body.subscription;
      if (!s || !/^https:\/\//.test(s.endpoint || '') || !s.keys || !s.keys.p256dh || !s.keys.auth) throw bad('Ongeldige inschrijving');
      const existing = subs.all().find((x) => x.endpoint === s.endpoint);
      const name = String(req.body.name || '').slice(0, 60) || (/iPhone|iPad/.test(req.headers['user-agent'] || '') ? 'iPhone' : /Android/.test(req.headers['user-agent'] || '') ? 'Android' : 'Computer');
      if (existing) subs.patch(existing.id, { keys: s.keys, name }); else subs.add({ endpoint: s.endpoint, keys: s.keys, name, ua: String(req.headers['user-agent'] || '').slice(0, 200) });
      res.json({ ok: true });
    }));
    app.post('/api/push/unsubscribe', wrap(async (req, res) => { const e = req.body.endpoint; const s = subs.all().find((x) => x.endpoint === e); if (s) subs.remove(s.id); res.json({ ok: true }); }));
    app.get('/api/push/devices', (req, res) => res.json(subs.all().map((s) => ({ id: s.id, name: s.name, createdAt: s.createdAt, lastOk: s.lastOk || 0, lastError: s.lastError || '' }))));
    app.delete('/api/push/devices/:id', (req, res) => { subs.remove(req.params.id); res.json({ ok: true }); });
    app.post('/api/push/test', wrap(async (req, res) => {
      if (!subs.all().length) throw bad('Nog geen toestel ingeschreven voor meldingen');
      await push({ title: 'Het werkt!', body: 'Je krijgt meldingen van je Rawendpaneel.', url: '/', tag: 'test' });
      res.json({ ok: true });
    }));
    app.post('/api/push/evening-test', wrap(async (req, res) => { await sendEvening(); res.json({ ok: true }); }));
    app.get('/api/notifications', (req, res) => res.json(feed.all().slice().reverse().slice(0, 60)));
    app.post('/api/notifications/read', wrap(async (req, res) => { const ids = req.body.ids; feed.replace(feed.all().map((n) => (!ids || ids.includes(n.id) ? { ...n, read: true } : n))); broadcast('notifications', {}); res.json({ ok: true }); }));
    app.delete('/api/notifications', wrap(async (req, res) => { feed.replace([]); broadcast('notifications', {}); res.json({ ok: true }); }));
    app.get('/api/agenda/tomorrow', wrap(async (req, res) => { const s = tomorrowSummary(); res.json({ ...s, date: s.date.getTime() }); }));
  }
  return { routes, send, push, tomorrowSummary };
};
