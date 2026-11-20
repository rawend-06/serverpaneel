'use strict';
/*
 * Netwerk: hoe je server met internet verbonden is (kabelsnelheid, fouten, DNS) en wie er op je netwerk zit,
 * met een echte naam per apparaat in plaats van enkel een adres.
 *
 * Namen zoeken we op vier manieren, de beste wint:
 *   1. de naam die jij zelf gaf
 *   2. de naam die het toestel zelf doorgeeft (mDNS: iPhones, Macs, Android, Linux, printers, tv's)
 *   3. de Windows-naam (NetBIOS) of de naam die je router kent (omgekeerde DNS)
 *   4. het merk, uit het begin van het MAC-adres (officiële IEEE-lijst, één keer gedownload)
 */
const fs = require('fs');
const path = require('path');
const dgram = require('dgram');
const dns = require('dns').promises;

module.exports = function network(ctx) {
  const { CFG, DEMO, store, wrap } = ctx;
  const HR = process.env.HOST_ROOT && fs.existsSync(path.join(process.env.HOST_ROOT, 'proc')) ? process.env.HOST_ROOT : '';
  const read = (p) => { try { return fs.readFileSync(p, 'utf8').trim(); } catch { return ''; } };

  // ------------------------------------------------------------ verbinding van de server zelf
  function links() {
    if (DEMO) return [{ name: 'eno1', kind: 'kabel', up: true, speed: 1000, duplex: 'full', mtu: 1500, rxErrors: 0, txErrors: 0, drops: 3, mac: 'd8:9e:f3:12:4a:01' }];
    const base = path.join(HR || '/', 'sys/class/net');
    let names = []; try { names = fs.readdirSync(base); } catch { return []; }
    return names.filter((n) => n !== 'lo' && !/^(docker|br-|veth|virbr|tailscale|tun|wg)/.test(n)).map((n) => {
      const d = path.join(base, n); const stat = (k) => Number(read(path.join(d, 'statistics', k))) || 0;
      const speed = Number(read(path.join(d, 'speed')));
      return { name: n, kind: fs.existsSync(path.join(d, 'wireless')) ? 'wifi' : 'kabel', up: read(path.join(d, 'operstate')) === 'up', speed: speed > 0 ? speed : null,
        duplex: read(path.join(d, 'duplex')) || null, mtu: Number(read(path.join(d, 'mtu'))) || null, mac: read(path.join(d, 'address')),
        rxErrors: stat('rx_errors'), txErrors: stat('tx_errors'), drops: stat('rx_dropped') + stat('tx_dropped') };
    }).sort((a, b) => b.up - a.up || (b.speed || 0) - (a.speed || 0));
  }
  async function dnsMs() {
    const t = performance.now();
    try { await dns.resolve4(`check-${Date.now() % 100000}.cloudflare.com`).catch(() => dns.resolve4('cloudflare.com')); return Math.round(performance.now() - t); } catch { return null; }
  }

  // ------------------------------------------------------------ merk uit het MAC-adres (IEEE-lijst)
  const OUI_FILE = path.join(CFG.dataDir, 'oui.txt');
  let oui = null, ouiLoading = null;
  const shortVendor = (v) => v.replace(/,?\s*(inc|ltd|llc|co|corp|corporation|limited|gmbh|s\.?a|b\.?v|technologies|technology|electronics|communications?|international|holdings?|group)\.?\b/gi, '').replace(/\(.*?\)/g, '').replace(/[,.\s]+$/, '').replace(/\s{2,}/g, ' ').trim();
  function parseOui(txt) { const m = new Map(); for (const l of txt.split('\n')) { const r = l.match(/^([0-9A-F]{2})-([0-9A-F]{2})-([0-9A-F]{2})\s+\(hex\)\s+(.+)$/); if (r) m.set(`${r[1]}${r[2]}${r[3]}`.toLowerCase(), shortVendor(r[4].trim())); } return m; }
  function loadOui() {
    if (oui || ouiLoading) return;
    ouiLoading = (async () => {
      try {
        const st = fs.statSync(OUI_FILE, { throwIfNoEntry: false });
        if (!st || Date.now() - st.mtimeMs > 60 * 864e5) {
          const r = await fetch('https://standards-oui.ieee.org/oui/oui.txt', { signal: AbortSignal.timeout(60000) });
          if (r.ok) fs.writeFileSync(OUI_FILE, await r.text());
        }
        oui = parseOui(read(OUI_FILE));
      } catch { oui = oui || new Map(); } finally { ouiLoading = null; }
    })();
  }
  const randomMac = (mac) => /^.[26ae]/i.test(mac);
  const vendorOf = (mac) => (oui && !randomMac(mac) ? oui.get(mac.replace(/:/g, '').slice(0, 6).toLowerCase()) || '' : '');

  // ------------------------------------------------------------ naam die het toestel zelf doorgeeft
  function readName(buf, off) {
    const labels = []; let jumped = false, end = off, guard = 0;
    while (off < buf.length && guard++ < 64) {
      const len = buf[off];
      if (len === 0) { if (!jumped) end = off + 1; break; }
      if ((len & 0xc0) === 0xc0) { if (!jumped) end = off + 2; off = ((len & 0x3f) << 8) | buf[off + 1]; jumped = true; continue; }
      labels.push(buf.slice(off + 1, off + 1 + len).toString('utf8')); off += 1 + len;
    }
    return { name: labels.join('.'), end };
  }
  function udpQuery(ip, port, packet, parse, timeout = 700) {
    return new Promise((resolve) => {
      const s = dgram.createSocket('udp4'); let done = false;
      const fin = (v) => { if (done) return; done = true; clearTimeout(t); try { s.close(); } catch { /* */ } resolve(v); };
      const t = setTimeout(() => fin(''), timeout);
      s.on('error', () => fin(''));
      s.on('message', (msg) => { try { fin(parse(msg) || ''); } catch { fin(''); } });
      s.send(packet, port, ip, (e) => { if (e) fin(''); });
    });
  }
  // mDNS: "wie ben jij?" rechtstreeks aan het toestel vragen (PTR van zijn adres)
  function mdnsName(ip) {
    const q = Buffer.concat([Buffer.from([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]),
      ...[...ip.split('.').reverse(), 'in-addr', 'arpa'].map((l) => Buffer.concat([Buffer.from([l.length]), Buffer.from(l)])), Buffer.from([0, 0, 12, 0x80, 1])]);
    return udpQuery(ip, 5353, q, (m) => {
      const an = m.readUInt16BE(6); if (!an) return '';
      let off = 12; const qd = m.readUInt16BE(4);
      for (let i = 0; i < qd; i++) off = readName(m, off).end + 4;
      for (let i = 0; i < an; i++) { const r = readName(m, off); off = r.end; const type = m.readUInt16BE(off); const rdl = m.readUInt16BE(off + 8); if (type === 12) return readName(m, off + 10).name.replace(/\.local\.?$/, ''); off += 10 + rdl; }
      return '';
    });
  }
  // NetBIOS: de naam van Windows-pc's
  function netbiosName(ip) {
    const enc = Buffer.alloc(32); const raw = Buffer.alloc(16, 0); raw[0] = 0x2a;
    for (let i = 0; i < 16; i++) { enc[i * 2] = 0x41 + (raw[i] >> 4); enc[i * 2 + 1] = 0x41 + (raw[i] & 0xf); }
    const q = Buffer.concat([Buffer.from([0x13, 0x37, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0x20]), enc, Buffer.from([0, 0, 0x21, 0, 1])]);
    return udpQuery(ip, 137, q, (m) => {
      const n = m[56]; for (let i = 0; i < n; i++) { const o = 57 + i * 18; const name = m.slice(o, o + 15).toString('latin1').trim(); const suffix = m[o + 15]; const group = m[o + 16] & 0x80; if (suffix === 0 && !group && name) return name; }
      return '';
    });
  }
  async function reverseDns(ip) { try { const n = await Promise.race([dns.reverse(ip), new Promise((_, rj) => setTimeout(() => rj(new Error('t')), 600))]); return (n[0] || '').replace(/\.(lan|home|local|localdomain|fritz\.box|telenet\.be|proximus\.be)$/i, ''); } catch { return ''; } }

  // ------------------------------------------------------------ soort toestel raden
  const TYPES = [
    ['phone', /iphone|android|galaxy|pixel|oneplus|redmi|xiaomi.*phone|huawei|oppo|motorola|nokia/i], ['tablet', /ipad|tab|tablet|kindle/i],
    ['laptop', /macbook|laptop|notebook|thinkpad|ideapad|xps|zenbook|surface/i], ['tv', /tv|bravia|chromecast|roku|fire.?stick|apple-?tv|webos|tizen|android-?tv/i],
    ['game', /playstation|ps[45]|xbox|nintendo|switch/i], ['speaker', /sonos|nest|echo|alexa|homepod|google-?home|speaker/i],
    ['printer', /printer|epson|canon|brother|hp-?(laser|desk|office)|officejet|laserjet/i], ['router', /router|fritz|modem|gateway|tp-?link|netgear|ubiquiti|unifi|mikrotik|technicolor|sagemcom|zyxel/i],
    ['iot', /espressif|esp32|esp8266|shelly|tasmota|tuya|sonoff|philips.?hue|hue-?bridge|ring|raspberry/i], ['pc', /desktop|pc|windows|workstation|asus|msi|gigabyte|dell|lenovo|acer|intel/i],
  ];
  const guessType = (s) => (TYPES.find(([, re]) => re.test(s)) || ['unknown'])[0];
  const pretty = (h) => h.replace(/\.(local|lan)$/i, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^./, (c) => c.toUpperCase());

  // ------------------------------------------------------------ alles samen
  const names = () => store.read('net-names', {}); // mac → { host, src, at }
  let busy = false;
  async function lookup(list) {
    if (busy) return; busy = true;
    try {
      const cache = names(); const now = Date.now(); let changed = false;
      for (const d of list) {
        const c = cache[d.mac];
        if (c && now - c.at < 6 * 3600e3) continue;
        let host = '', src = '';
        const m = await mdnsName(d.ip); if (m) { host = m; src = 'toestel'; }
        if (!host) { const n = await netbiosName(d.ip); if (n) { host = n; src = 'windows'; } }
        if (!host) { const r = await reverseDns(d.ip); if (r && !/^\d+[-.]\d+/.test(r)) { host = r; src = 'router'; } }
        cache[d.mac] = { host, src, at: now }; changed = true;
      }
      if (changed) store.write('net-names', cache);
    } finally { busy = false; }
  }
  const DEMO_NAMES = { 'a4:91:b1:00:12:01': ['Router', 'router', 'Technicolor'], 'd8:9e:f3:12:4a:01': ['jouwserver', 'toestel', 'Intel'], '5e:31:aa:09:7c:42': ['iPhone van Sam', 'toestel', ''], 'a4:83:e7:0b:22:5d': ['Laptop van Noor', 'windows', 'Lenovo'], '78:bd:bc:3f:10:e2': ['Samsung TV woonkamer', 'toestel', 'Samsung'], 'f0:18:98:5c:cc:03': ['', '', 'Xiaomi'], '2c:f0:5d:a1:77:9c': ['GAMING-PC', 'windows', 'ASUSTek'] };
  async function devices() {
    loadOui();
    const base = await ctx.hosttools.devices();
    if (!DEMO) lookup(base.devices).catch(() => {});
    const cache = names(); const own = store.read('devices', { names: {} }).names || {};
    const out = base.devices.map((d) => {
      const dn = DEMO ? DEMO_NAMES[d.mac] || ['', '', ''] : null;
      const found = DEMO ? (dn[0] ? { host: dn[0], src: dn[1] } : null) : cache[d.mac];
      const vendor = DEMO ? dn[2] : vendorOf(d.mac);
      const host = found && found.host ? pretty(found.host) : '';
      const name = own[d.mac] || host || (d.self ? 'Deze server' : vendor ? `${vendor}-toestel` : 'Onbekend apparaat');
      const type = d.self ? 'server' : guessType(`${own[d.mac] || ''} ${host} ${vendor}`);
      return { ...d, name, givenName: own[d.mac] || '', host, nameFrom: own[d.mac] ? 'jij' : found && found.host ? found.src : '', vendor, type, randomMac: randomMac(d.mac), unknown: !own[d.mac] && !host };
    });
    return { lan: base.lan, devices: out, wol: base.wol, notifyNew: base.notifyNew, ouiReady: DEMO || !!(oui && oui.size) };
  }
  async function overview() {
    const sp = store.read('speedtests', []);
    return { links: links(), dnsMs: await dnsMs(), speed: sp[sp.length - 1] || null, history: sp.slice(-20) };
  }

  function routes(app) {
    app.get('/api/network', wrap(async (req, res) => res.json(await overview())));
    app.get('/api/network/devices', wrap(async (req, res) => res.json(await devices())));
    app.post('/api/network/devices/refresh', wrap(async (req, res) => { store.write('net-names', {}); res.json(await devices()); }));
  }
  return { routes, links, devices };
};
