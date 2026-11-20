'use strict';
/* Onderhoud van de server: opruimen, snelheidstest, OpenCloud, herstarten, processen en de indeling van je schijven. */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');

module.exports = function servertools(ctx) {
  const { CFG, DEMO, store, wrap, bad, run, broadcast } = ctx;
  const HR = process.env.HOST_ROOT && fs.existsSync(path.join(process.env.HOST_ROOT, 'proc')) ? process.env.HOST_ROOT : '';
  const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
  const parseSize = (s) => { const m = String(s || '').match(/([\d.]+)\s*([kKMGT]?B)/); if (!m) return 0; return Math.round(parseFloat(m[1]) * ({ B: 1, kB: 1e3, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12 }[m[2]] || 1)); };

  // ------------------------------------------------------------ opruimen
  async function cleanupInfo() {
    if (DEMO) return { reclaimable: 4.2e9, parts: [{ type: 'Oude images', size: 3.6e9, count: 7 }, { type: 'Bouwcache', size: 0.6e9, count: 23 }] };
    const r = await run('docker', ['system', 'df', '--format', '{{json .}}'], { quiet: true });
    const parts = [];
    for (const l of r.out.split('\n')) {
      let j; try { j = JSON.parse(l); } catch { continue; }
      if (j.Type === 'Images') parts.push({ type: 'Oude images', size: parseSize(j.Reclaimable), count: Number(j.TotalCount) - Number(j.Active) });
      if (j.Type === 'Build Cache') parts.push({ type: 'Bouwcache', size: parseSize(j.Reclaimable), count: Number(j.TotalCount) });
    }
    return { reclaimable: parts.reduce((a, p) => a + p.size, 0), parts };
  }
  // ------------------------------------------------------------ snelheidstest
  const speeds = () => store.read('speedtests', []);
  let speedBusy = false;
  async function speedtest() {
    if (speedBusy) throw bad('De snelheidstest loopt al');
    speedBusy = true;
    try {
      let res;
      if (DEMO) { await new Promise((r) => setTimeout(r, 2500)); res = { down: 380e6 + Math.random() * 60e6, up: 34e6 + Math.random() * 8e6, ping: 8 + Math.random() * 4 }; }
      else {
        const base = 'https://speed.cloudflare.com';
        // ping: kleinste van 5 kleine verzoeken
        const pings = [];
        for (let i = 0; i < 5; i++) { const t = performance.now(); try { const r = await fetch(`${base}/__down?bytes=0`, { cache: 'no-store', signal: AbortSignal.timeout(5000) }); await r.arrayBuffer(); pings.push(performance.now() - t); } catch { /* */ } }
        // download: 4 x 25 MB tegelijk, max 12 s
        const dl = async () => {
          const t = performance.now(); let bytes = 0;
          await Promise.all([0, 1, 2, 3].map(async () => {
            try { const r = await fetch(`${base}/__down?bytes=25000000`, { cache: 'no-store', signal: AbortSignal.timeout(12000) }); for await (const c of r.body) bytes += c.length; } catch { /* timeout = genoeg gemeten */ }
          }));
          return (bytes * 8) / ((performance.now() - t) / 1000);
        };
        const ul = async () => {
          const chunk = Buffer.alloc(8e6, 'a'); const t = performance.now(); let bytes = 0;
          await Promise.all([0, 1].map(async () => { try { await fetch(`${base}/__up`, { method: 'POST', body: chunk, signal: AbortSignal.timeout(15000) }); bytes += chunk.length; } catch { /* */ } }));
          return (bytes * 8) / ((performance.now() - t) / 1000);
        };
        const down = await dl(); const up = await ul();
        if (!down && !up) throw bad('De snelheidstest lukte niet (geen internet?)');
        res = { down, up, ping: pings.length ? Math.min(...pings) : null };
      }
      const entry = { at: Date.now(), down: Math.round(res.down), up: Math.round(res.up), ping: res.ping == null ? null : Math.round(res.ping * 10) / 10 };
      store.update('speedtests', [], (l) => { l.push(entry); if (l.length > 30) l.splice(0, l.length - 30); });
      broadcast('speedtest', entry);
      return entry;
    } finally { speedBusy = false; }
  }
  // ------------------------------------------------------------ OpenCloud
  let ocCache = { t: 0, data: null };
  async function opencloud() {
    if (Date.now() - ocCache.t < 60000 && ocCache.data) return ocCache.data;
    if (DEMO) { ocCache = { t: Date.now(), data: { found: true, name: 'opencloud', running: true, status: 'Up 12 days', image: 'opencloudeu/opencloud-rolling:latest', dataDir: '/home/rawend/opencloud/data', size: 183e6, files: 412, domain: 'cloud-demo.duckdns.org', port: 9200 } }; return ocCache.data; }
    const ps = await run('docker', ['ps', '-a', '--format', '{{json .}}'], { quiet: true });
    let c = null;
    for (const l of ps.out.split('\n')) { try { const j = JSON.parse(l); if (/opencloud/i.test(j.Image) || /^opencloud/i.test(j.Names)) { c = j; break; } } catch { /* */ } }
    if (!c) { ocCache = { t: Date.now(), data: { found: false } }; return ocCache.data; }
    const ins = await run('docker', ['inspect', c.Names], { quiet: true });
    let info = {}; try { info = JSON.parse(ins.out)[0]; } catch { /* */ }
    const mount = (info.Mounts || []).find((m) => m.Destination === '/var/lib/opencloud') || (info.Mounts || []).find((m) => /data/.test(m.Destination));
    const site = ctx.sites().find((s) => s.container === c.Names || s.name === 'opencloud');
    const data = { found: true, name: c.Names, running: c.State === 'running', status: c.Status, image: c.Image, dataDir: mount ? mount.Source : '', size: null, files: null, domain: site ? site.domain : '', port: (String(c.Ports).match(/:(\d+)->/) || [])[1] || null, site: site ? site.name : null };
    // grootte van de gegevens (kan even duren, daarom op de achtergrond en een uur bewaard)
    const sz = store.read('ocSize', null);
    if (sz && Date.now() - sz.t < 3600e3 && sz.dir === data.dataDir) { data.size = sz.size; data.files = sz.files; }
    else if (data.dataDir && !ocCache.sizing) {
      ocCache.sizing = true;
      run('du', ['-sb', data.dataDir], { quiet: true }).then(async (r) => {
        const size = Number((r.out.match(/^(\d+)/) || [])[1]) || null;
        const cnt = await run('sh', ['-c', `find "${data.dataDir.replace(/"/g, '')}" -type f 2>/dev/null | wc -l`], { quiet: true });
        store.write('ocSize', { t: Date.now(), dir: data.dataDir, size, files: Number(cnt.out.trim()) || null });
        ocCache = { t: 0, data: null };
        broadcast('opencloud', {});
      }).finally(() => { ocCache.sizing = false; });
    }
    ocCache = { ...ocCache, t: Date.now(), data };
    return data;
  }
  // ------------------------------------------------------------ herstarten
  async function reboot() {
    fs.writeFileSync(path.join(CFG.dataDir, 'reboot-pending'), String(Date.now()));
    if (DEMO) return;
    const img = await ctx.selfImage();
    await run('docker', ['rm', '-f', 'serverpaneel-herstart'], { quiet: true });
    const r = await run('docker', ['run', '-d', '--rm', '--name', 'serverpaneel-herstart', '--privileged', '--pid=host', '--entrypoint', 'nsenter', img, '-t', '1', '-m', '-u', '-n', '-i', '--', 'sh', '-c', 'sleep 3; systemctl reboot'], { quiet: true });
    if (r.code !== 0) { fs.rmSync(path.join(CFG.dataDir, 'reboot-pending'), { force: true }); throw bad(`Herstarten lukte niet: ${r.out.slice(-200)}`); }
  }
  // ------------------------------------------------------------ processen
  const users = () => { const m = {}; for (const l of read(path.join(HR || '/', 'etc/passwd')).split('\n')) { const p = l.split(':'); if (p.length > 2) m[p[2]] = p[0]; } return m; };
  function procSnapshot() {
    const base = path.join(HR || '/', 'proc');
    const out = new Map();
    let pids = []; try { pids = fs.readdirSync(base).filter((x) => /^\d+$/.test(x)); } catch { return out; }
    for (const pid of pids) {
      const stat = read(path.join(base, pid, 'stat')); if (!stat) continue;
      const r = stat.lastIndexOf(')'); const f = stat.slice(r + 2).split(' ');
      const status = read(path.join(base, pid, 'status'));
      const rss = Number((status.match(/^VmRSS:\s+(\d+)/m) || [])[1] || 0) * 1024;
      const uid = (status.match(/^Uid:\s+(\d+)/m) || [])[1];
      let cmd = read(path.join(base, pid, 'cmdline')).replace(/\0/g, ' ').trim();
      const name = stat.slice(stat.indexOf('(') + 1, r);
      if (!cmd) cmd = `[${name}]`;
      out.set(pid, { pid: Number(pid), name, cmd: cmd.slice(0, 200), cpuTicks: Number(f[11]) + Number(f[12]), rss, uid, threads: Number(f[17]) || 1 });
    }
    return out;
  }
  async function processes() {
    if (DEMO) {
      const names = [['node', 'node server.js', 'rawend', 2.4, 92e6], ['opencloud', 'opencloud server', 'rawend', 1.1, 310e6], ['caddy', 'caddy run --config /etc/caddy/Caddyfile', 'root', 0.4, 41e6], ['dockerd', '/usr/bin/dockerd -H fd://', 'root', 0.9, 88e6], ['containerd', '/usr/bin/containerd', 'root', 0.3, 52e6], ['python3', 'python3 app.py', 'rawend', 0.8, 64e6], ['sshd', 'sshd: /usr/sbin/sshd -D', 'root', 0, 8e6], ['systemd', '/sbin/init', 'root', 0, 12e6]];
      return names.map(([n, c, u, cpu, mem], i) => ({ pid: 100 + i * 37, name: n, cmd: c, user: u, cpu: Math.max(0, cpu + Math.sin(Date.now() / 3000 + i)), mem })).sort((a, b) => b.cpu - a.cpu);
    }
    const a = procSnapshot(); const t0 = Date.now();
    await new Promise((r) => setTimeout(r, 700));
    const b = procSnapshot(); const dt = (Date.now() - t0) / 1000;
    const hz = 100; const u = users();
    const list = [];
    for (const [pid, p] of b) {
      const prev = a.get(pid);
      const cpu = prev ? Math.max(0, ((p.cpuTicks - prev.cpuTicks) / hz / dt) * 100) : 0;
      list.push({ pid: p.pid, name: p.name, cmd: p.cmd, user: u[p.uid] || p.uid, cpu: Math.round(cpu * 10) / 10, mem: p.rss });
    }
    return list.sort((x, y) => y.cpu - x.cpu || y.mem - x.mem).slice(0, 60);
  }
  // ------------------------------------------------------------ indeling van de schijven (elk deel apart)
  function diskLayout() {
    if (DEMO) {
      return [{ name: 'sda', model: 'Samsung SSD 860 EVO 250GB', size: 250059350016, rotational: false, parts: [
        { name: 'sda1', size: 1.07e9, fs: 'vfat', mount: '/boot/efi', label: 'EFI', used: 6.2e6, free: 1.06e9, role: 'Opstarten (EFI)' },
        { name: 'sda2', size: 2.15e9, fs: 'ext4', mount: '/boot', label: '', used: 0.21e9, free: 1.75e9, role: 'Opstarten' },
        { name: 'sda3', size: 246.8e9, fs: 'LVM2_member', mount: '', role: 'LVM', lvm: { volumes: [{ name: 'ubuntu-vg/ubuntu-lv', size: 246.8e9, mount: '/', fs: 'ext4', used: 19e9, free: 214e9 }], free: 0 } },
      ] }, { name: 'sdb', model: 'WDC WD20EZAZ 2TB', size: 2000398934016, rotational: true, parts: [
        { name: 'sdb1', size: 1500e9, fs: 'ext4', mount: '/mnt/nas', label: 'nas', used: 812e9, free: 610e9, role: '' },
        { name: 'sdb2', size: 500e9, fs: 'ext4', mount: '', label: 'reserve', role: '', unused: true },
      ] }];
    }
    const sys = fs.existsSync(path.join(HR || '/', 'sys/block')) ? path.join(HR || '/', 'sys/block') : '/sys/block';
    const mountsTxt = read(path.join(HR || '/', 'proc/1/mounts')) || read('/proc/mounts');
    const mounts = mountsTxt.split('\n').map((l) => l.split(' ')).filter((x) => x.length > 2 && x[0].startsWith('/dev/'));
    const statfs = (mp) => { try { const s = fs.statfsSync(HR ? path.join(HR, mp) : mp); return { used: (s.blocks - s.bfree) * s.bsize, free: s.bavail * s.bsize, total: s.blocks * s.bsize }; } catch { return {}; } };
    const udev = (dev) => {
      const devno = read(path.join(sys, '..', 'class', 'block', dev, 'dev')).trim() || read(path.join(sys, dev, 'dev')).trim();
      const txt = read(path.join(HR || '/', 'run/udev/data', `b${devno}`));
      const g = (k) => (txt.match(new RegExp(`^E:${k}=(.*)$`, 'm')) || [])[1] || '';
      return { fs: g('ID_FS_TYPE'), label: g('ID_FS_LABEL'), partName: g('ID_PART_ENTRY_NAME') };
    };
    const mountOf = (dev, dmName) => {
      const m = mounts.find((x) => x[0] === `/dev/${dev}` || (dmName && (x[0] === `/dev/mapper/${dmName}` || x[0] === `/dev/${dmName.replace('-', '/')}`)));
      return m ? { mount: m[1].replace(/\\040/g, ' '), fs: m[2] } : null;
    };
    const size = (p) => Number(read(path.join(p, 'size'))) * 512;
    const out = [];
    let devs = []; try { devs = fs.readdirSync(sys); } catch { return out; }
    for (const d of devs.filter((x) => !/^(loop|ram|zram|dm-|sr|fd|md|nbd)/.test(x))) {
      const base = path.join(sys, d);
      const disk = { name: d, model: read(path.join(base, 'device', 'model')).trim() || read(path.join(base, 'device', 'name')).trim(), size: size(base), rotational: read(path.join(base, 'queue', 'rotational')).trim() === '1', removable: read(path.join(base, 'removable')).trim() === '1', parts: [] };
      if (!disk.size) continue;
      let ents = []; try { ents = fs.readdirSync(base); } catch { /* */ }
      const parts = ents.filter((x) => x.startsWith(d) && fs.existsSync(path.join(base, x, 'partition'))).sort((a, b) => Number(read(path.join(base, a, 'partition'))) - Number(read(path.join(base, b, 'partition'))));
      const handle = (pname, pbase) => {
        const p = { name: pname, size: size(pbase), ...udev(pname) };
        const holders = (() => { try { return fs.readdirSync(path.join(pbase, 'holders')); } catch { return []; } })();
        if (holders.length) {
          const vols = holders.map((h) => {
            const dm = read(path.join(sys, h, 'dm', 'name')).trim();
            const mo = mountOf(h, dm); const st = mo ? statfs(mo.mount) : {};
            const pretty = dm.replace(/--/g, '\u0000').split('-').map((x) => x.replace(/\u0000/g, '-')).join('/');
            return { name: pretty || h, size: size(path.join(sys, h)), mount: mo ? mo.mount : '', fs: mo ? mo.fs : udev(h).fs, used: st.used, free: st.free };
          });
          const usedByVols = vols.reduce((a, v) => a + v.size, 0);
          p.role = /crypto/i.test(p.fs) ? 'Versleuteld' : 'LVM';
          p.lvm = { volumes: vols, free: Math.max(0, p.size - usedByVols - 4 * 1024 ** 2) };
        } else {
          const mo = mountOf(pname); const st = mo ? statfs(mo.mount) : {};
          p.mount = mo ? mo.mount : ''; if (mo) p.fs = mo.fs; p.used = st.used; p.free = st.free;
          p.role = p.mount === '/boot/efi' ? 'Opstarten (EFI)' : p.mount === '/boot' ? 'Opstarten' : p.fs === 'swap' ? 'Swap' : '';
          if (!p.mount && p.fs !== 'swap') p.unused = true;
        }
        disk.parts.push(p);
      };
      for (const pn of parts) handle(pn, path.join(base, pn));
      // schijf zonder partities maar wel rechtstreeks gebruikt
      if (!parts.length) { const mo = mountOf(d); if (mo) { const st = statfs(mo.mount); disk.parts.push({ name: d, size: disk.size, fs: mo.fs, mount: mo.mount, used: st.used, free: st.free, role: '' }); } }
      // niet ingedeelde ruimte op de schijf
      const assigned = disk.parts.reduce((a, p) => a + p.size, 0);
      disk.unallocated = Math.max(0, disk.size - assigned - 8 * 1024 ** 2);
      out.push(disk);
    }
    return out;
  }

  function routes(app) {
    app.get('/api/server/cleanup', wrap(async (req, res) => res.json(await cleanupInfo())));
    app.post('/api/server/cleanup', wrap(async (req, res) => {
      const before = await cleanupInfo();
      if (DEMO) { await new Promise((r) => setTimeout(r, 1500)); return res.json({ freed: before.reclaimable, text: '(demo) opgeruimd' }); }
      const a = await run('docker', ['image', 'prune', '-af'], { quiet: true });
      const b = await run('docker', ['builder', 'prune', '-af'], { quiet: true });
      const freed = parseSize((a.out.match(/Total reclaimed space:\s*([\d.]+\s*\w+)/) || [])[1]) + parseSize((b.out.match(/Total(?: reclaimed space)?:\s*([\d.]+\s*\w+)/) || [])[1]);
      ctx.notify.send('server', { title: 'Opgeruimd', body: `${(freed / 1e9).toFixed(1)} GB vrijgemaakt`, inFeed: true, level: 'ok' }).catch(() => {});
      res.json({ freed });
    }));
    app.get('/api/server/speedtest', (req, res) => res.json({ busy: speedBusy, history: speeds() }));
    app.post('/api/server/speedtest', wrap(async (req, res) => res.json(await speedtest())));
    app.get('/api/server/opencloud', wrap(async (req, res) => res.json(await opencloud())));
    app.get('/api/server/processes', wrap(async (req, res) => res.json(await processes())));
    app.get('/api/server/disks', wrap(async (req, res) => res.json(diskLayout())));
    app.post('/api/server/reboot', wrap(async (req, res) => {
      await ctx.requireStepUp(req, 'de server herstarten');
      await reboot();
      ctx.notify.send('server', { title: 'Server wordt herstart', body: 'Over 1 à 2 minuten is alles terug.', inFeed: true, level: 'info' }).catch(() => {});
      res.json({ ok: true, demo: DEMO });
    }));
    app.get('/api/server/summary', wrap(async (req, res) => {
      const live = ctx.metrics.live();
      res.json({ hostname: CFG.hostName, uptime: os.uptime(), ...live });
    }));
  }
  return { routes, cleanupInfo, speedtest, opencloud, processes, diskLayout, reboot };
};
