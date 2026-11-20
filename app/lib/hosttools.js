'use strict';
/*
 * Dingen die op de server zelf moeten gebeuren (niet in de paneel-container):
 *  - Firewall (ufw): poorten open/dicht, wie erbij mag, wat er tegengehouden wordt
 *  - Apparaten thuis: wie zit er op je netwerk, en pc's aanzetten met Wake-on-LAN
 *  - Stroom en energie: verbruik meten of schatten, en wat dat kost
 * Voor root-acties start het paneel kort een hulpje (zelfde image) dat via nsenter op de server werkt,
 * net zoals bij herstarten en de terminal. Elke wijziging vraagt eerst nog eens wie je bent.
 */
const fs = require('fs');
const path = require('path');
const dns = require('dns').promises;
const crypto = require('crypto');

module.exports = function hosttools(ctx) {
  const { CFG, DEMO, store, wrap, bad, run, metrics } = ctx;
  const HR = process.env.HOST_ROOT && fs.existsSync(path.join(process.env.HOST_ROOT, 'proc')) ? process.env.HOST_ROOT : '';
  const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
  const lanNet = () => { const m = String(CFG.hostLanIp || '').match(/^(\d+\.\d+\.\d+)\.\d+$/); return m ? `${m[1]}.0/24` : '192.168.50.0/16'; };
  const TAILSCALE = '100.64.0.0/10';

  // een shell-script als root op de server zelf uitvoeren
  async function hostRun(script, { timeout = 60000 } = {}) {
    const img = await ctx.selfImage();
    const name = `serverpaneel-host-${crypto.randomBytes(3).toString('hex')}`;
    const r = await run('docker', ['run', '--rm', '--name', name, '--privileged', '--pid=host', '--net=host', '--entrypoint', 'nsenter', img, '-t', '1', '-m', '-u', '-n', '-i', '--', 'sh', '-c', script], { quiet: true, timeout });
    return r;
  }
  const q = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

  // ================================================================ firewall
  let fwCache = { t: 0, data: null };
  const demoFw = () => store.read('demo-firewall', { active: true, rules: [
    { num: 1, to: '22/tcp', action: 'ALLOW', dir: 'IN', from: '192.168.50.0/24', comment: 'SSH' },
    { num: 2, to: '80,443/tcp', action: 'ALLOW', dir: 'IN', from: 'Anywhere', comment: 'Websites (Caddy)' },
    { num: 3, to: '3000/tcp', action: 'ALLOW', dir: 'IN', from: '192.168.50.0/24', comment: 'Rawendpaneel' },
    { num: 4, to: '3000/tcp', action: 'ALLOW', dir: 'IN', from: TAILSCALE, comment: 'Rawendpaneel (Tailscale)' },
    { num: 5, to: '41641/udp', action: 'ALLOW', dir: 'IN', from: 'Anywhere', comment: 'Tailscale' },
  ] });
  function parseFw(out) {
    const [verbose = '', numbered = '', listen = '', blocked = '', count = ''] = out.split('\n===\n');
    if (/NOUFW/.test(verbose)) return { installed: false };
    const active = /Status:\s*active/i.test(verbose);
    const def = (verbose.match(/Default:\s*(.+)/) || [])[1] || '';
    const rules = [];
    for (const l of numbered.split('\n')) {
      const m = l.match(/^\[\s*(\d+)\]\s+(.+?)\s{2,}(ALLOW|DENY|REJECT|LIMIT)\s*(IN|OUT|FWD)?\s+(.+?)(?:\s+#\s*(.*))?$/);
      if (m) rules.push({ num: Number(m[1]), to: m[2].trim(), action: m[3], dir: m[4] || 'IN', from: m[5].trim(), comment: (m[6] || '').trim(), v6: /\(v6\)/.test(m[2]) });
    }
    const listening = [];
    for (const l of listen.split('\n')) {
      const m = l.match(/^(tcp|udp)\s+\S+\s+\d+\s+\d+\s+(\S+):(\d+)\s+\S+\s*(?:users:\(\("([^"]+)")?/);
      if (m && !listening.some((x) => x.port === Number(m[3]) && x.proto === m[1])) listening.push({ proto: m[1], addr: m[2], port: Number(m[3]), proc: m[4] || '' });
    }
    listening.sort((a, b) => a.port - b.port);
    const recent = blocked.split('\n').map((l) => { const src = (l.match(/SRC=(\S+)/) || [])[1]; const dpt = (l.match(/DPT=(\d+)/) || [])[1]; const t = (l.match(/^(\S+\s+\S+\s+\S+)/) || [])[1]; return src ? { src, port: dpt ? Number(dpt) : null, t } : null; }).filter(Boolean).reverse();
    return { installed: true, active, defaults: def, rules, listening, blocked24h: Number(count.trim()) || 0, recent };
  }
  async function firewall(force) {
    if (DEMO) {
      const d = demoFw();
      return { installed: true, active: d.active, defaults: 'deny (incoming), allow (outgoing), deny (routed)', rules: d.rules, blocked24h: 1284, lan: lanNet(),
        listening: [{ proto: 'tcp', port: 22, proc: 'sshd' }, { proto: 'tcp', port: 80, proc: 'caddy' }, { proto: 'tcp', port: 443, proc: 'caddy' }, { proto: 'tcp', port: 3000, proc: 'node' }, { proto: 'tcp', port: 8080, proc: 'docker-proxy' }, { proto: 'tcp', port: 9200, proc: 'docker-proxy' }],
        recent: [{ src: '203.0.113.14', port: 22, t: 'okt 28 14:31' }, { src: '203.0.113.92', port: 3389, t: 'okt 28 14:29' }, { src: '203.0.113.11', port: 22, t: 'okt 28 14:22' }] };
    }
    if (!force && fwCache.data && Date.now() - fwCache.t < 20000) return fwCache.data;
    const script = [
      'command -v ufw >/dev/null 2>&1 || { echo NOUFW; exit 0; }',
      'ufw status verbose', 'echo ===', 'ufw status numbered', 'echo ===',
      'ss -tulnpH 2>/dev/null', 'echo ===',
      "journalctl -k -n 3000 --no-pager 2>/dev/null | grep 'UFW BLOCK' | tail -8", 'echo ===',
      "journalctl -k --since '24 hours ago' --no-pager 2>/dev/null | grep -c 'UFW BLOCK'",
    ].join('\n');
    const r = await hostRun(script, { timeout: 30000 });
    if (r.code !== 0 && !/NOUFW/.test(r.out)) throw bad(`Firewall uitlezen lukte niet: ${r.out.slice(-200)}`);
    fwCache = { t: Date.now(), data: { ...parseFw(r.out), lan: lanNet() } };
    return fwCache.data;
  }
  const FROM = { lan: () => lanNet(), tailscale: () => TAILSCALE, any: () => 'any' };
  function ruleCmd(b) {
    const port = String(b.port || '').trim();
    if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw bad('Poort: een getal van 1 tot 65535');
    const proto = ['tcp', 'udp'].includes(b.proto) ? b.proto : '';
    let from;
    if (b.from === 'ip') { from = String(b.ip || '').trim(); if (!/^\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?$/.test(from)) throw bad('Ongeldig IP-adres (bv. 203.0.113.10)'); }
    else from = (FROM[b.from] || FROM.lan)();
    const comment = String(b.comment || '').replace(/[^\w .,()+-]/g, '').slice(0, 60);
    const action = b.action === 'deny' ? 'deny' : 'allow';
    return `ufw ${action} from ${from} to any port ${port}${proto ? ` proto ${proto}` : ''}${comment ? ` comment ${q(comment)}` : ''}`;
  }
  // nooit jezelf buitensluiten: SSH en het paneel blijven bereikbaar van thuis en via Tailscale
  const SAFE = () => [`ufw allow from ${lanNet()} to any port 22 proto tcp comment 'SSH (thuis)'`, `ufw allow from ${TAILSCALE} to any port 22 proto tcp comment 'SSH (Tailscale)'`,
    `ufw allow from ${lanNet()} to any port ${CFG.hostPort} proto tcp comment 'Rawendpaneel (thuis)'`, `ufw allow from ${TAILSCALE} to any port ${CFG.hostPort} proto tcp comment 'Rawendpaneel (Tailscale)'`,
    "ufw allow 80/tcp comment 'Websites (http)'", "ufw allow 443/tcp comment 'Websites (https)'", "ufw allow 41641/udp comment 'Tailscale'"];
  async function fwChange(script) {
    const r = await hostRun(script, { timeout: 60000 });
    fwCache = { t: 0, data: null };
    if (r.code !== 0) throw bad(`Lukte niet: ${r.out.trim().split('\n').slice(-2).join(' ')}`);
    return r.out;
  }

  // ================================================================ apparaten thuis
  const devCfg = () => store.read('devices', { names: {}, wol: [], seen: {}, notifyNew: true });
  const MAC_RE = /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i;
  const normMac = (m) => String(m || '').trim().toLowerCase().replace(/-/g, ':');
  function arpTable() {
    if (DEMO) {
      return [['192.168.50.1', 'a4:91:b1:00:12:01', 'router'], ['192.168.50.24', 'd8:9e:f3:12:4a:01', 'jouwserver'], ['192.168.50.23', '5e:31:aa:09:7c:42', ''], ['192.168.50.31', 'a4:83:e7:0b:22:5d', ''], ['192.168.50.40', '78:bd:bc:3f:10:e2', ''], ['192.168.50.57', 'f0:18:98:5c:cc:03', ''],
        ...(store.read('demo-awake', {})['2c:f0:5d:a1:77:9c'] ? [['192.168.50.30', '2c:f0:5d:a1:77:9c', '']] : [])].map(([ip, mac, host]) => ({ ip, mac, host, state: 'ok', dev: 'eth0' }));
    }
    const txt = read(path.join(HR || '/', 'proc/1/net/arp')) || read('/proc/net/arp');
    return txt.split('\n').slice(1).map((l) => l.trim().split(/\s+/)).filter((p) => p.length >= 6 && p[3] !== '00:00:00:00:00:00')
      .map(([ip, , flags, mac, , dev]) => ({ ip, mac: normMac(mac), state: flags === '0x2' ? 'ok' : 'stale', dev }))
      .filter((d) => !/^(docker|br-|veth|tailscale)/.test(d.dev));
  }
  async function devices() {
    const cfg = devCfg();
    const list = arpTable();
    await Promise.all(list.map(async (d) => { if (d.host) return; try { const n = await Promise.race([dns.reverse(d.ip), new Promise((_, rj) => setTimeout(() => rj(new Error('t')), 400))]); d.host = (n[0] || '').replace(/\.(lan|home|local|fritz\.box)$/, ''); } catch { d.host = ''; } }));
    let changed = false;
    for (const d of list) {
      d.name = cfg.names[d.mac] || ''; d.self = d.ip === CFG.hostLanIp;
      d.firstSeen = cfg.seen[d.mac] || null;
      if (!cfg.seen[d.mac]) { cfg.seen[d.mac] = Date.now(); d.firstSeen = Date.now(); d.isNew = Object.keys(cfg.seen).length > list.length; changed = true; }
      else d.isNew = Date.now() - cfg.seen[d.mac] < 86400e3 && !d.name;
    }
    if (changed) store.write('devices', cfg);
    const online = new Set(list.filter((d) => d.state === 'ok').map((d) => d.mac));
    const wol = cfg.wol.map((w) => ({ ...w, online: online.has(normMac(w.mac)), ip: (list.find((d) => d.mac === normMac(w.mac)) || {}).ip || w.ip || '' }));
    list.sort((a, b) => (b.self - a.self) || a.ip.localeCompare(b.ip, undefined, { numeric: true }));
    return { lan: lanNet(), devices: list, wol, notifyNew: cfg.notifyNew };
  }
  async function scan() {
    if (DEMO) { await new Promise((r) => setTimeout(r, 1500)); return; }
    const m = String(CFG.hostLanIp || '').match(/^(\d+\.\d+\.\d+)\./); if (!m) throw bad('Het netwerk van je server is niet gekend (HOST_LAN_IP)');
    await hostRun(`for i in $(seq 1 254); do (ping -c1 -W1 ${m[1]}.$i >/dev/null 2>&1 &) ; done; sleep 2`, { timeout: 30000 });
  }
  async function wake(mac) {
    mac = normMac(mac); if (!MAC_RE.test(mac)) throw bad('Ongeldig MAC-adres');
    if (DEMO) { store.update('demo-awake', {}, (a) => { a[mac] = Date.now(); }); return; }
    // magisch pakket: 6x FF + 16x het MAC-adres, als broadcast op poort 9 (vanop het netwerk van de server zelf)
    const js = `const d=require('dgram').createSocket('udp4');const m=Buffer.from(process.argv[1].replace(/:/g,''),'hex');const p=Buffer.concat([Buffer.alloc(6,255),...Array(16).fill(m)]);d.bind(()=>{d.setBroadcast(true);let n=0;const s=()=>d.send(p,9,'255.255.255.255',()=>{if(++n<3)setTimeout(s,200);else d.close();});s();});`;
    const img = await ctx.selfImage();
    const r = await run('docker', ['run', '--rm', '--net=host', '--entrypoint', 'node', img, '-e', js, mac], { quiet: true, timeout: 30000 });
    if (r.code !== 0) throw bad(`Aanzetten lukte niet: ${r.out.slice(-200)}`);
  }
  // nieuwe apparaten op je netwerk melden (elke 10 minuten kijken)
  if (!DEMO) setInterval(async () => {
    try {
      const cfg = devCfg(); if (!cfg.notifyNew) return;
      const before = new Set(Object.keys(cfg.seen)); if (!before.size) { await devices(); return; }
      const { devices: list } = await devices();
      for (const d of list) if (!before.has(d.mac)) ctx.notify.send('server', { title: 'Nieuw apparaat op je netwerk', body: `${d.host || 'Onbekend'} · ${d.ip} · ${d.mac}`, url: '/#/apparaten', inFeed: true, level: 'warn' }).catch(() => {});
    } catch { /* */ }
  }, 10 * 60e3).unref();

  // ================================================================ stroom en energie
  const enCfg = () => store.read('energy-cfg', { source: 'estimate', idleW: 12, maxW: 45, price: 0.30, plug: '', alertW: 80 });
  const RAPL = path.join(HR || '/', 'sys/class/powercap/intel-rapl:0/energy_uj');
  let rapl = null; // { uj, t }
  let lastW = null, highSince = 0, lastAlert = 0;
  const minutes = store.read('energy-min', []); // [t, W] van de laatste 24 uur
  async function measure() {
    const cfg = enCfg();
    const cpu = (metrics.live().now || {}).cpu;
    if (cfg.source === 'shelly' || cfg.source === 'tasmota') {
      try {
        const base = /^https?:\/\//.test(cfg.plug) ? cfg.plug.replace(/\/+$/, '') : `http://${cfg.plug}`;
        if (cfg.source === 'tasmota') { const j = await (await fetch(`${base}/cm?cmnd=Status%208`, { signal: AbortSignal.timeout(4000) })).json(); return { w: j.StatusSNS.ENERGY.Power, how: 'Tasmota-stekker' }; }
        let j = await (await fetch(`${base}/rpc/Switch.GetStatus?id=0`, { signal: AbortSignal.timeout(4000) }).catch(() => null))?.json().catch(() => null);
        if (j && typeof j.apower === 'number') return { w: j.apower, how: 'Shelly-stekker' };
        j = await (await fetch(`${base}/status`, { signal: AbortSignal.timeout(4000) })).json();
        return { w: j.meters[0].power, how: 'Shelly-stekker' };
      } catch { /* stekker niet bereikbaar: schatten */ }
    }
    if (cfg.source !== 'estimate' && !DEMO) {
      const uj = Number(read(RAPL));
      if (uj) {
        const now = Date.now(); const prev = rapl; rapl = { uj, t: now };
        if (prev && uj >= prev.uj) { const pkg = (uj - prev.uj) / 1e6 / ((now - prev.t) / 1000); return { w: pkg + cfg.idleW * 0.6, how: 'processor gemeten + rest geschat' }; }
      }
    }
    const c = cpu == null ? 5 : cpu;
    return { w: cfg.idleW + (cfg.maxW - cfg.idleW) * Math.min(1, c / 100) ** 0.9, how: 'schatting via processor' };
  }
  let how = 'schatting via processor';
  async function tick() {
    const m = await measure().catch(() => null); if (!m || !Number.isFinite(m.w)) return;
    const w = Math.round(m.w * 10) / 10; lastW = w; how = m.how;
    const t = Date.now();
    minutes.push([t, w]); while (minutes.length && minutes[0][0] < t - 24 * 3600e3) minutes.shift();
    const key = new Date(t).toISOString().slice(0, 13); // per uur (UTC)
    store.update('energy-hours', {}, (h) => { const e = h[key] || (h[key] = [0, 0, 0]); e[0] += w / 60; e[1]++; e[2] = Math.max(e[2], w); });
    if (minutes.length % 10 === 0) store.write('energy-min', minutes);
    const cfg = enCfg();
    if (cfg.alertW && w > cfg.alertW) { if (!highSince) highSince = t; if (t - highSince > 10 * 60e3 && t - lastAlert > 3600e3) { lastAlert = t; ctx.notify.send('server', { title: 'Server verbruikt veel stroom', body: `${Math.round(w)} W, al meer dan 10 minuten`, url: '/#/energie', inFeed: true, level: 'warn' }).catch(() => {}); } }
    else highSince = 0;
  }
  if (DEMO && !Object.keys(store.read('energy-hours', {})).length) {
    // demo: 40 dagen voorbeeldverbruik, met een piek om 3 uur 's nachts (backup)
    const h = {}; const now = Date.now();
    for (let t = now - 40 * 864e5; t < now; t += 3600e3) { const hr = new Date(t).getHours(); const w = 14 + (hr === 3 ? 30 : 0) + (hr >= 9 && hr <= 23 ? 6 : 0) + Math.random() * 4; h[new Date(t).toISOString().slice(0, 13)] = [w, 60, w + 8]; }
    store.write('energy-hours', h);
    for (let t = now - 24 * 3600e3; t < now; t += 60e3) { const hr = new Date(t).getHours(); minutes.push([t, Math.round((14 + (hr === 3 ? 34 : 0) + (hr >= 9 ? 6 : 0) + Math.random() * 5) * 10) / 10]); }
  }
  setInterval(tick, 60e3).unref(); setTimeout(tick, 5000).unref();
  function sumKwh(fromMs) { const h = store.read('energy-hours', {}); let wh = 0; for (const [k, v] of Object.entries(h)) if (new Date(`${k}:00:00Z`).getTime() >= fromMs) wh += v[0]; return wh / 1000; }
  async function energy(range) {
    const cfg = enCfg();
    const now = new Date(); const sod = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const sow = sod - ((now.getDay() + 6) % 7) * 864e5;
    const som = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const soy = new Date(now.getFullYear(), 0, 1).getTime();
    const h = store.read('energy-hours', {});
    const hoursKnown = Object.keys(h).length;
    const avgW = hoursKnown ? Object.values(h).reduce((a, v) => a + v[0], 0) / hoursKnown : lastW || cfg.idleW;
    const today = Object.entries(h).filter(([k]) => new Date(`${k}:00:00Z`).getTime() >= sod);
    // grafiek
    let chart;
    if (range === 'dag') chart = minutes.filter((_, i) => i % 5 === 0 || i === minutes.length - 1);
    else {
      const days = range === 'jaar' ? 365 : range === 'maand' ? 31 : 7; const out = [];
      for (let i = days - 1; i >= 0; i--) {
        const d0 = sod - i * 864e5, d1 = d0 + 864e5; let wh = 0, n = 0;
        for (const [k, v] of Object.entries(h)) { const ts = new Date(`${k}:00:00Z`).getTime(); if (ts >= d0 && ts < d1) { wh += v[0]; n++; } }
        out.push([d0, n ? Math.round((wh / n) * 10) / 10 : null]);
      }
      chart = out;
    }
    // wie verbruikt het meest (verdeling volgens processorgebruik van de containers)
    let users = [];
    try {
      const st = await ctx.dockerStats(); const tot = Object.values(st).reduce((a, s) => a + s.cpu, 0);
      const dyn = Math.max(0, (lastW || cfg.idleW) - cfg.idleW);
      users = Object.entries(st).map(([name, s]) => ({ name, w: tot ? (s.cpu / tot) * dyn : 0 })).sort((a, b) => b.w - a.w).slice(0, 5);
      users.unshift({ name: 'Systeem en schijven (rust)', w: cfg.idleW });
    } catch { /* */ }
    return {
      now: lastW, how, cfg, peakToday: today.reduce((a, [, v]) => Math.max(a, v[2]), 0) || lastW,
      kwh: { dag: sumKwh(sod), week: sumKwh(sow), maand: sumKwh(som), jaar: sumKwh(soy) },
      yearKwh: (avgW * 24 * 365) / 1000, avgW, since: hoursKnown ? Math.min(...Object.keys(h).map((k) => new Date(`${k}:00:00Z`).getTime())) : Date.now(),
      chart, users, raplAvailable: !!Number(read(RAPL)),
    };
  }

  // ================================================================ routes
  function routes(app) {
    app.get('/api/firewall', wrap(async (req, res) => res.json(await firewall(req.query.fresh === '1'))));
    app.post('/api/firewall/rule', wrap(async (req, res) => {
      await ctx.requireStepUp(req, 'een firewallregel toevoegen');
      const cmd = ruleCmd(req.body);
      if (DEMO) { store.update('demo-firewall', demoFw(), (d) => { d.rules.push({ num: d.rules.length + 1, to: `${req.body.port}${req.body.proto ? `/${req.body.proto}` : ''}`, action: req.body.action === 'deny' ? 'DENY' : 'ALLOW', dir: 'IN', from: req.body.from === 'any' ? 'Anywhere' : req.body.from === 'tailscale' ? TAILSCALE : req.body.from === 'ip' ? req.body.ip : lanNet(), comment: req.body.comment || '' }); }); return res.json({ ok: true, cmd }); }
      await fwChange(cmd);
      res.json({ ok: true, cmd });
    }));
    app.post('/api/firewall/delete', wrap(async (req, res) => {
      await ctx.requireStepUp(req, 'een firewallregel verwijderen');
      const n = Number(req.body.num); if (!Number.isInteger(n) || n < 1) throw bad('Ongeldige regel');
      if (DEMO) { store.update('demo-firewall', demoFw(), (d) => { d.rules = d.rules.filter((r) => r.num !== n).map((r, i) => ({ ...r, num: i + 1 })); }); return res.json({ ok: true }); }
      await fwChange(`ufw --force delete ${n}`);
      res.json({ ok: true });
    }));
    app.post('/api/firewall/toggle', wrap(async (req, res) => {
      const on = !!req.body.on;
      await ctx.requireStepUp(req, on ? 'de firewall aanzetten' : 'de firewall uitzetten');
      if (DEMO) { store.update('demo-firewall', demoFw(), (d) => { d.active = on; }); return res.json({ ok: true }); }
      if (on) await fwChange(['command -v ufw >/dev/null 2>&1 || (apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ufw)', 'ufw default deny incoming', 'ufw default allow outgoing', ...SAFE(), 'ufw logging low', 'ufw --force enable'].join(' && '));
      else await fwChange('ufw disable');
      res.json({ ok: true });
    }));

    app.get('/api/devices', wrap(async (req, res) => res.json(await devices())));
    app.post('/api/devices/scan', wrap(async (req, res) => { await scan(); res.json(await devices()); }));
    app.post('/api/devices/name', wrap(async (req, res) => {
      const mac = normMac(req.body.mac); if (!MAC_RE.test(mac)) throw bad('Ongeldig MAC-adres');
      store.update('devices', devCfg(), (c) => { const n = String(req.body.name || '').trim().slice(0, 60); if (n) c.names[mac] = n; else delete c.names[mac]; });
      res.json({ ok: true });
    }));
    app.post('/api/devices/settings', wrap(async (req, res) => { store.update('devices', devCfg(), (c) => { c.notifyNew = !!req.body.notifyNew; }); res.json({ ok: true }); }));
    app.post('/api/devices/wol', wrap(async (req, res) => {
      const mac = normMac(req.body.mac); if (!MAC_RE.test(mac)) throw bad('Ongeldig MAC-adres (bv. 2C:F0:5D:A1:77:9C)');
      const name = String(req.body.name || '').trim().slice(0, 60) || 'Computer';
      const item = { id: crypto.randomBytes(4).toString('hex'), name, mac };
      store.update('devices', devCfg(), (c) => { c.wol = c.wol.filter((w) => normMac(w.mac) !== mac); c.wol.push(item); });
      res.json(item);
    }));
    app.post('/api/devices/wol/:id/delete', wrap(async (req, res) => { store.update('devices', devCfg(), (c) => { c.wol = c.wol.filter((w) => w.id !== req.params.id); }); res.json({ ok: true }); }));
    app.post('/api/devices/wol/:id/wake', wrap(async (req, res) => {
      const w = devCfg().wol.find((x) => x.id === req.params.id); if (!w) throw bad('Onbekend apparaat', 404);
      await wake(w.mac);
      res.json({ ok: true });
    }));

    app.get('/api/energy', wrap(async (req, res) => res.json(await energy(['dag', 'week', 'maand', 'jaar'].includes(req.query.range) ? req.query.range : 'dag'))));
    app.post('/api/energy/config', wrap(async (req, res) => {
      const b = req.body; const c = enCfg();
      const num = (v, lo, hi, d) => { const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) && n >= lo && n <= hi ? n : d; };
      const next = { source: ['estimate', 'rapl', 'shelly', 'tasmota'].includes(b.source) ? b.source : c.source, idleW: num(b.idleW, 1, 500, c.idleW), maxW: num(b.maxW, 2, 2000, c.maxW), price: num(b.price, 0, 5, c.price), plug: String(b.plug ?? c.plug).trim().slice(0, 200), alertW: num(b.alertW, 0, 5000, c.alertW) };
      if (next.maxW <= next.idleW) next.maxW = next.idleW + 1;
      if ((next.source === 'shelly' || next.source === 'tasmota') && !next.plug) throw bad('Vul het IP-adres van je slimme stekker in');
      store.write('energy-cfg', next); rapl = null;
      res.json(next);
    }));
  }
  return { routes, hostRun, firewall, devices, energy, lastWatt: () => lastW };
};
