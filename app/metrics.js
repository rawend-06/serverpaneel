'use strict';
/*
 * Serverpaneel - metingen van je server (CPU, temperatuur, geheugen, schijven, netwerk).
 * Leest rechtstreeks uit /proc en /sys van de server. In Docker wordt de host gemount op /hostfs.
 * Alleen in de demo op je eigen pc worden nepwaarden gemaakt; op je server altijd echte metingen.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const SHORT_EVERY = 1000;     // elke seconde een meting (live)
const SHORT_KEEP = 3600;      // = 1 uur
const MAX_POINTS = 600;       // grafieken krijgen maximaal zoveel punten (gemiddelden), sneller en even nauwkeurig op scherm
const LONG_EVERY = 60000;     // elke minuut een gemiddelde
const LONG_KEEP = 1440;       // = 24 uur
const FIELDS = ['cpu', 'temp', 'mem', 'rx', 'tx', 'rd', 'wr'];
const REAL_FS = new Set(['ext2', 'ext3', 'ext4', 'xfs', 'btrfs', 'zfs', 'vfat', 'exfat', 'ntfs', 'ntfs3', 'fuseblk', 'f2fs', 'jfs', 'reiserfs', 'nfs', 'nfs4', 'cifs', 'smb3', 'mergerfs', 'fuse.mergerfs']);

module.exports = function createMetrics({ demo = false, hostRoot = '' } = {}) {
  const HR = hostRoot && fs.existsSync(path.join(hostRoot, 'proc')) ? hostRoot : '';
  const hasProc = fs.existsSync('/proc/stat');
  const fake = !!demo; // nooit nepwaarden buiten de demo: ontbreekt iets, dan toont het paneel gewoon '–'
  const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };

  // ------------------------------------------------------------ echte bronnen
  function cpuTimes() {
    const out = {};
    for (const line of read('/proc/stat').split('\n')) {
      const m = line.match(/^(cpu\d*)\s+(.*)/); if (!m) continue;
      const v = m[2].trim().split(/\s+/).map(Number);
      const idle = v[3] + (v[4] || 0);
      const total = v.slice(0, 8).reduce((a, b) => a + b, 0);
      out[m[1]] = { idle, total };
    }
    return out;
  }
  function memInfo() {
    const m = {};
    for (const line of read('/proc/meminfo').split('\n')) { const x = line.match(/^(\w+):\s+(\d+)/); if (x) m[x[1]] = Number(x[2]) * 1024; }
    const total = m.MemTotal || os.totalmem();
    const avail = m.MemAvailable ?? os.freemem();
    return { total, used: total - avail, available: avail, cached: (m.Cached || 0) + (m.Buffers || 0), swapTotal: m.SwapTotal || 0, swapUsed: (m.SwapTotal || 0) - (m.SwapFree || 0) };
  }
  function netBytes() {
    const txt = (HR && read(path.join(HR, 'proc/1/net/dev'))) || read('/proc/net/dev');
    let rx = 0, tx = 0; const ifaces = [];
    for (const line of txt.split('\n').slice(2)) {
      const m = line.match(/^\s*([^:]+):\s*(.*)/); if (!m) continue;
      const name = m[1].trim();
      if (/^(lo|veth|docker|br-|virbr|vnet|cni|flannel|kube)/.test(name)) continue;
      const v = m[2].trim().split(/\s+/).map(Number);
      rx += v[0]; tx += v[8]; ifaces.push(name);
    }
    return { rx, tx, ifaces };
  }
  function diskIo() {
    let rd = 0, wr = 0;
    for (const line of read('/proc/diskstats').split('\n')) {
      const v = line.trim().split(/\s+/); if (v.length < 10) continue;
      if (!/^(sd[a-z]+|vd[a-z]+|xvd[a-z]+|hd[a-z]+|nvme\d+n\d+|mmcblk\d+)$/.test(v[2])) continue;
      rd += Number(v[5]) * 512; wr += Number(v[9]) * 512;
    }
    return { rd, wr };
  }
  function temps() {
    const out = [];
    const roots = ['/sys/class/hwmon', HR && path.join(HR, 'sys/class/hwmon')].filter(Boolean);
    for (const root of roots) {
      let dirs = []; try { dirs = fs.readdirSync(root); } catch { continue; }
      for (const d of dirs) {
        const base = path.join(root, d); const chip = read(path.join(base, 'name')).trim();
        let files = []; try { files = fs.readdirSync(base); } catch { continue; }
        for (const f of files.filter((x) => /^temp\d+_input$/.test(x))) {
          const v = Number(read(path.join(base, f))) / 1000; if (!(v > 0 && v < 130)) continue;
          const label = read(path.join(base, f.replace('_input', '_label'))).trim();
          out.push({ chip, label: label || chip, value: Math.round(v * 10) / 10 });
        }
      }
      if (out.length) break;
    }
    if (!out.length) {
      let zones = []; try { zones = fs.readdirSync('/sys/class/thermal').filter((z) => z.startsWith('thermal_zone')); } catch { /* */ }
      for (const z of zones) {
        const v = Number(read(`/sys/class/thermal/${z}/temp`)) / 1000; if (!(v > 0 && v < 130)) continue;
        out.push({ chip: 'thermal', label: read(`/sys/class/thermal/${z}/type`).trim() || z, value: Math.round(v * 10) / 10 });
      }
    }
    return out;
  }
  // de "CPU-temperatuur": package/Tctl als die er is, anders het hoogste cpu-gerelateerde getal
  function cpuTemp(list) {
    const pick = list.find((t) => /package id|tctl|tdie|cpu temp/i.test(t.label))
      || list.filter((t) => /coretemp|k10temp|zenpower|cpu|soc|x86_pkg/i.test(`${t.chip} ${t.label}`)).sort((a, b) => b.value - a.value)[0]
      || list.slice().sort((a, b) => b.value - a.value)[0];
    return pick ? pick.value : null;
  }
  function disks() {
    const mountsTxt = (HR && read(path.join(HR, 'proc/1/mounts'))) || read('/proc/mounts');
    const seen = new Set(); const out = [];
    for (const line of mountsTxt.split('\n')) {
      const [dev, mnt, type] = line.split(' '); if (!dev || !REAL_FS.has(type)) continue;
      const mp = mnt.replace(/\\040/g, ' ');
      if (/^\/(boot\/efi|snap|var\/lib\/docker|run|proc|sys|hostfs)(\/|$)/.test(mp)) continue;
      if (seen.has(dev)) continue; seen.add(dev);
      try {
        const s = fs.statfsSync(HR ? path.join(HR, mp) : mp);
        const total = s.blocks * s.bsize; if (total < 512 * 1024 ** 2) continue;
        const free = s.bavail * s.bsize, used = total - s.bfree * s.bsize;
        out.push({ mount: mp, device: dev.replace('/dev/', ''), type, total, used, free });
      } catch { /* */ }
    }
    return out.sort((a, b) => (a.mount === '/' ? -1 : b.mount === '/' ? 1 : b.total - a.total));
  }
  let staticInfo = null;
  function sysInfo() {
    if (staticInfo) { const upSec = Number(read('/proc/uptime').split(' ')[0]) || os.uptime(); const mhz = [...read('/proc/cpuinfo').matchAll(/^cpu MHz\s*:\s*([\d.]+)/gm)].map((m) => Number(m[1])); return { ...staticInfo, uptime: upSec, load: os.loadavg(), mhz: mhz.length ? Math.round(mhz.reduce((a, b) => a + b, 0) / mhz.length) : staticInfo.mhz }; }
    const osr = read(path.join(HR || '/', 'etc/os-release'));
    const pretty = (osr.match(/^PRETTY_NAME="?([^"\n]+)/m) || [])[1] || `${os.type()} ${os.release()}`;
    const cpuinfo = read('/proc/cpuinfo');
    const model = (cpuinfo.match(/^model name\s*:\s*(.+)$/m) || cpuinfo.match(/^Hardware\s*:\s*(.+)$/m) || cpuinfo.match(/^Model\s*:\s*(.+)$/m) || [])[1] || (os.cpus()[0] || {}).model || 'onbekend';
    const mhz = [...cpuinfo.matchAll(/^cpu MHz\s*:\s*([\d.]+)/gm)].map((m) => Number(m[1]));
    let upSec = Number(read('/proc/uptime').split(' ')[0]) || os.uptime();
    staticInfo = { os: pretty, kernel: os.release(), arch: os.arch(), cpuModel: model.replace(/\s+/g, ' ').trim(), cores: os.cpus().length || 1, mhz: mhz.length ? Math.round(mhz.reduce((a, b) => a + b, 0) / mhz.length) : null };
    return { ...staticInfo, uptime: upSec, load: os.loadavg() };
  }

  // ------------------------------------------------------------ nep (demo / Windows)
  const fakeCores = 8; let fakeT = 0; const fakeCounters = { rx: 0, tx: 0, rd: 0, wr: 0 };
  function fakeSample(t) {
    const h = new Date(t).getHours() + new Date(t).getMinutes() / 60;
    const day = 0.55 + 0.45 * Math.sin(((h - 8) / 24) * 2 * Math.PI);
    const n = (a) => (Math.sin(t / 37000 + a) + Math.sin(t / 11000 + a * 2) + Math.sin(t / 5300 + a * 3)) / 3;
    const j = (k) => (Math.sin(t * 0.0137 + k) * Math.cos(t * 0.0071 + k * 3)) * 4; // kleine schommelingen per seconde, zoals een echte server
    const cpu = Math.max(2, Math.min(96, 8 + 22 * day + 10 * n(1) + j(1) + (Math.sin(t / 900000) > 0.93 ? 35 : 0)));
    return {
      cpu, temp: 38 + cpu * 0.32 + 2 * n(4) + j(4) / 4, mem: 41 + 6 * day + 2 * n(2) + j(2) / 8,
      rx: Math.max(2e3, (180e3 + 900e3 * Math.max(0, n(5))) * day), tx: Math.max(1e3, (40e3 + 300e3 * Math.max(0, n(6))) * day),
      rd: Math.max(0, 120e3 + 800e3 * Math.max(0, n(7))), wr: Math.max(0, 200e3 + 1.2e6 * Math.max(0, n(8))),
      coreLoads: Array.from({ length: fakeCores }, (_, i) => Math.max(1, Math.min(100, cpu + 18 * n(10 + i)))),
    };
  }

  // ------------------------------------------------------------ meten + geschiedenis
  const listeners = new Set();
  const short = [], long = []; let prev = null; let current = null; let lastLong = 0; let acc = [];
  function sample() {
    const t = Date.now();
    let s;
    if (fake) {
      s = fakeSample(t);
      fakeCounters.rx += s.rx; fakeCounters.tx += s.tx; fakeCounters.rd += s.rd; fakeCounters.wr += s.wr;
      fakeT = t;
    } else {
      const c = cpuTimes(), n = netBytes(), io = diskIo(), m = memInfo(), tl = temps();
      const snap = { t, c, n, io };
      s = { cpu: null, temp: cpuTemp(tl), mem: (m.used / m.total) * 100, rx: null, tx: null, rd: null, wr: null, coreLoads: [] };
      if (prev && t - prev.t < 500) return; // te kort na de vorige meting
      if (prev) {
        const dt = (t - prev.t) / 1000;
        const pct = (a, b) => (a && b && a.total > b.total ? (1 - (a.idle - b.idle) / (a.total - b.total)) * 100 : 0);
        s.cpu = pct(c.cpu, prev.c.cpu);
        s.coreLoads = Object.keys(c).filter((k) => k !== 'cpu').sort((a, b) => Number(a.slice(3)) - Number(b.slice(3))).map((k) => pct(c[k], prev.c[k]));
        s.rx = Math.max(0, (n.rx - prev.n.rx) / dt); s.tx = Math.max(0, (n.tx - prev.n.tx) / dt);
        s.rd = Math.max(0, (io.rd - prev.io.rd) / dt); s.wr = Math.max(0, (io.wr - prev.io.wr) / dt);
      }
      prev = snap;
      if (s.cpu === null) return; // eerste meting: nog geen verschil
    }
    current = { t, ...s };
    if (listeners.size) { const payload = live(); for (const fn of listeners) { try { fn(payload); } catch { /* */ } } }
    const row = { t }; for (const f of FIELDS) row[f] = s[f] == null ? null : Math.round(s[f] * 10) / 10;
    short.push(row); if (short.length > SHORT_KEEP) short.shift();
    acc.push(row);
    if (t - lastLong >= LONG_EVERY) {
      const avg = { t }; for (const f of FIELDS) { const v = acc.map((r) => r[f]).filter((x) => x != null); avg[f] = v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null; }
      long.push(avg); if (long.length > LONG_KEEP) long.shift();
      acc = []; lastLong = t;
    }
  }
  // demo: geschiedenis vooraf vullen zodat de grafieken meteen gevuld zijn
  if (fake) {
    const now = Date.now();
    for (let t = now - LONG_KEEP * LONG_EVERY; t < now - SHORT_KEEP * SHORT_EVERY; t += LONG_EVERY) {
      const s = fakeSample(t); const r = { t }; for (const f of FIELDS) r[f] = Math.round(s[f] * 10) / 10; long.push(r);
    }
    for (let t = now - SHORT_KEEP * SHORT_EVERY; t < now; t += SHORT_EVERY) {
      const s = fakeSample(t); const r = { t }; for (const f of FIELDS) r[f] = Math.round(s[f] * 10) / 10; short.push(r);
      if (t - lastLong >= LONG_EVERY) { long.push(r); lastLong = t; }
    }
  }
  sample();
  setInterval(sample, SHORT_EVERY).unref();

  function history(range) {
    const src = range === '24h' ? long : short;
    const from = Date.now() - (range === '15m' ? 15 * 60e3 : range === '24h' ? 24 * 3600e3 : 3600e3);
    let rows = src.filter((r) => r.t >= from);
    if (rows.length > MAX_POINTS) { // gemiddelden per groepje, zodat pieken niet verdwijnen in de lijn
      const size = Math.ceil(rows.length / MAX_POINTS); const out = [];
      for (let i = 0; i < rows.length; i += size) {
        const grp = rows.slice(i, i + size); const r = { t: grp[grp.length - 1].t };
        for (const f of FIELDS) { const v = grp.map((x) => x[f]).filter((x) => x != null); r[f] = v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null; }
        out.push(r);
      }
      rows = out;
    }
    const h = { t: rows.map((r) => r.t) }; for (const f of FIELDS) h[f] = rows.map((r) => r[f]);
    return h;
  }

  function snapshot(range) {
    const info = fake ? {
      os: 'Ubuntu 24.04.1 LTS', kernel: '6.8.0-45-generic', arch: 'x64', cpuModel: 'Intel(R) Core(TM) i5-8500T CPU @ 2.10GHz', cores: fakeCores, mhz: 2800,
      uptime: 1234567 + (Date.now() % 1e6) / 1000, load: [0.42, 0.55, 0.61],
    } : sysInfo();
    const m = fake ? { total: 16 * 1024 ** 3, used: 16 * 1024 ** 3 * ((current?.mem || 45) / 100), available: 0, cached: 4.2 * 1024 ** 3, swapTotal: 2 * 1024 ** 3, swapUsed: 0.1 * 1024 ** 3 } : memInfo();
    if (fake) m.available = m.total - m.used;
    const tl = fake
      ? [{ chip: 'coretemp', label: 'CPU (package)', value: Math.round((current?.temp || 50) * 10) / 10 }, ...Array.from({ length: 6 }, (_, i) => ({ chip: 'coretemp', label: `Core ${i}`, value: Math.round(((current?.temp || 50) - 2 + (i % 3)) * 10) / 10 })), { chip: 'nvme', label: 'NVMe SSD', value: 41.9 }, { chip: 'acpitz', label: 'Moederbord', value: 34 }]
      : temps();
    const dl = fake
      ? [{ mount: '/', device: 'nvme0n1p2', type: 'ext4', total: 233e9, used: 98.4e9, free: 122.7e9 }, { mount: '/mnt/nas', device: 'sda1', type: 'ext4', total: 3.64e12, used: 2.18e12, free: 1.46e12 }, { mount: '/mnt/backup', device: 'sdb1', type: 'ext4', total: 1.82e12, used: 0.61e12, free: 1.21e12 }]
      : disks();
    const n = fake ? { ifaces: ['enp2s0', 'tailscale0'] } : netBytes();
    return {
      demo: fake, info, mem: m, temps: tl, disks: dl, net: { ifaces: n.ifaces },
      now: current ? { t: current.t, cpu: current.cpu, temp: current.temp ?? cpuTemp(tl), mem: current.mem, rx: current.rx, tx: current.tx, rd: current.rd, wr: current.wr, cores: (current.coreLoads || []).map((v) => Math.round(v)) } : null,
      history: range === 'now' ? null : history(range),
    };
  }
  // live-pakketje (zonder geschiedenis) voor wie meeluistert
  function live() { const s = snapshot('now'); return { t: s.now && s.now.t, now: s.now, mem: s.mem, temps: s.temps, disks: s.disks, info: { uptime: s.info.uptime, load: s.info.load, mhz: s.info.mhz } }; }
  function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  return { snapshot, subscribe, live, fake, interval: SHORT_EVERY };
};
