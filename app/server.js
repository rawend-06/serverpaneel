'use strict';
/*
 * Serverpaneel - beheer je websites en apps op je eigen server via de browser.
 * Draait zelf in Docker op de server. Alles is in het Nederlands.
 */
const express = require('express');
const multer = require('multer');
const QRCode = require('qrcode');
const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');

// ---------------------------------------------------------------- config
const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);
// Demo (nepgegevens) kan ENKEL op je eigen pc via start-demo.cmd. In Docker (op je server) staat ze altijd uit.
const IN_DOCKER = fs.existsSync('/.dockerenv');
const DEMO = !IN_DOCKER && env('DEMO', '') === '1';
const DEMO_DIR = path.join(__dirname, '..', 'demo-data');
if (DEMO) {
  // Demo op je eigen pc: alles in de map demo-data, Docker wordt nagebootst
  const d = (k, v) => { if (!process.env[k]) process.env[k] = v; };
  d('DATA_DIR', path.join(DEMO_DIR, 'paneel'));
  d('SITES_ROOT', path.join(DEMO_DIR, 'sites'));
  d('ALLOWED_ROOT', DEMO_DIR);
  d('BACKUP_ROOT', path.join(DEMO_DIR, '.backups'));
  d('CADDY_SITES_DIR', path.join(DEMO_DIR, 'caddy'));
  d('CADDY_CONTAINER', 'caddy');
  d('PANEL_DOMAIN', 'paneel-demo.duckdns.org');
  d('HOST_NAME', 'jouwserver');
  d('CADDYFILE_HOST', path.join(DEMO_DIR, 'duckdns', 'Caddyfile'));
}
function detectLanIp() {
  for (const list of Object.values(os.networkInterfaces())) for (const i of list || []) if (i.family === 'IPv4' && !i.internal) return i.address;
  return '';
}
const CFG = {
  port: Number(env('PORT', 3000)),
  hostPort: Number(env('PANEL_PORT', env('PORT', 3000))), // poort op de server zelf
  dataDir: env('DATA_DIR', '/data'),
  sitesRoot: env('SITES_ROOT', '/srv/sites'),            // nieuwe sites komen hier
  allowedRoot: env('ALLOWED_ROOT', env('SITES_ROOT', '/srv/sites')), // bestaande mappen importeren mag enkel hieronder
  backupRoot: env('BACKUP_ROOT', '/srv/serverpaneel/backups'),
  caddyDir: env('CADDY_SITES_DIR', ''),                    // map met gegenereerde *.caddy bestanden
  caddyContainer: env('CADDY_CONTAINER', ''),
  caddyConfig: env('CADDY_CONFIG', '/etc/caddy/Caddyfile'),
  upstreamHost: env('UPSTREAM_HOST', '172.17.0.1'),        // hoe Caddy de host bereikt
  hostLanIp: env('HOST_LAN_IP', '') || detectLanIp(),
  hostName: env('HOST_NAME', os.hostname()),
  panelDomain: env('PANEL_DOMAIN', ''),
  panelDir: env('PANEL_DIR', ''),                       // map van het paneel zelf op de server (bv. /home/rawend/serverpaneel)
  keepBackups: Number(env('KEEP_BACKUPS', 5)),
  caddyfileHost: env('CADDYFILE_HOST', ''),
  caddyInline: env('CADDY_INLINE', '') === '1',           // domeinen rechtstreeks in je eigen Caddyfile (eigen blok)
  extraRoots: env('EXTRA_ROOTS', '').split(':').filter(Boolean),            // je eigen Caddyfile (alleen lezen), om bestaande domeinen te herkennen
};
const DEFAULT_KEEP = ['.env', 'data', 'uploads', 'Caddyfile'];
const ALWAYS_EXCLUDE = ['node_modules', '.git', '.DS_Store', 'Thumbs.db', '__pycache__'];
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const COMPOSE_FILES = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];

CFG.buildRoot = env('BUILD_ROOT', path.join(path.dirname(CFG.backupRoot), 'build'));
CFG.hostUser = env('HOST_USER', 'rawend');
for (const d of [CFG.dataDir, path.join(CFG.dataDir, 'tmp'), CFG.sitesRoot, CFG.backupRoot, CFG.buildRoot]) fs.mkdirSync(d, { recursive: true });
const store = require('./lib/store')(path.join(CFG.dataDir, 'db'));
const Build = require('./lib/build');
if (CFG.caddyDir) fs.mkdirSync(CFG.caddyDir, { recursive: true });

// ---------------------------------------------------------------- opslag
const AUTH_FILE = path.join(CFG.dataDir, 'auth.json');
const SITES_FILE = path.join(CFG.dataDir, 'sites.json');
function readJson(f, d) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } }
function writeJson(f, v) { const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(v, null, 2), { mode: 0o600 }); fs.renameSync(t, f); }
let auth = readJson(AUTH_FILE, null);
let sites = readJson(SITES_FILE, []);
const saveAuth = () => writeJson(AUTH_FILE, auth);
const saveSites = () => writeJson(SITES_FILE, sites);
const getSite = (n) => sites.find((s) => s.name === n);

// ---------------------------------------------------------------- wachtwoord + 2FA
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
function checkPassword(pw, stored) {
  try {
    const [, s, h] = stored.split('$');
    const calc = crypto.scryptSync(String(pw), Buffer.from(s, 'hex'), 64, { N: 16384, r: 8, p: 1 });
    return crypto.timingSafeEqual(calc, Buffer.from(h, 'hex'));
  } catch { return false; }
}
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32encode(buf) {
  let bits = 0, val = 0, out = '';
  for (const b of buf) { val = ((val << 8) | b) & 0xffff; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}
function b32decode(str) {
  let bits = 0, val = 0; const out = [];
  for (const c of str.replace(/=+$/, '').toUpperCase()) {
    const i = B32.indexOf(c); if (i < 0) continue;
    val = ((val << 5) | i) & 0xffff; bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
function totp(secret, time = Date.now()) {
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(Math.floor(time / 30000)));
  const h = crypto.createHmac('sha1', b32decode(secret)).update(buf).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}
function verifyTotp(secret, code) {
  code = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(code)) return false;
  return [-1, 0, 1].some((w) => totp(secret, Date.now() + w * 30000) === code);
}

// ---------------------------------------------------------------- sessies
const sessions = new Map(); // token -> { last }
const SESSION_IDLE = 14 * 24 * 3600 * 1000; // 2 weken niet gebruikt = uitgelogd (gevaarlijke acties vragen altijd opnieuw bevestiging)
function parseCookies(req) {
  const out = {};
  for (const p of (req.headers.cookie || '').split(';')) { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); }
  return out;
}
// sessies worden bewaard als hash van het cookie (wie het bestand ziet, kan er niet mee inloggen)
const sk = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
function currentSession(req) {
  const t = parseCookies(req).sp_session; if (!t) return null;
  const s = sessions.get(sk(t)); if (!s) return null;
  if (Date.now() - s.last > SESSION_IDLE) { sessions.delete(sk(t)); return null; }
  s.last = Date.now(); return t;
}
function sessionToken(req) { return parseCookies(req).sp_session || null; }
function sessionOf(req) { const t = sessionToken(req); if (!t) return null; const s = sessions.get(sk(t)); if (!s || Date.now() - s.last > SESSION_IDLE) return null; return s; }
function createSession(req, res, extra = {}) {
  const t = crypto.randomBytes(32).toString('hex');
  sessions.set(sk(t), { last: Date.now(), created: Date.now(), ua: String(req.headers['user-agent'] || '').slice(0, 160), ip: req.ip, ...extra });
  setSessionCookie(req, res, t, SESSION_IDLE / 1000);
  saveSessions();
  return t;
}
// sessies bewaren, zodat je na een update of herstart van het paneel ingelogd blijft
const SESSIONS_FILE = path.join(CFG.dataDir, 'sessions.json');
for (const [k, v] of Object.entries(readJson(SESSIONS_FILE, {}))) if (Date.now() - v.last < SESSION_IDLE) sessions.set(k, { ...v, stepUpAt: 0 });
let sessT = null;
function saveSessions() { clearTimeout(sessT); sessT = setTimeout(() => { const o = {}; for (const [k, v] of sessions) o[k] = { last: v.last, created: v.created, ua: v.ua, ip: v.ip }; writeJson(SESSIONS_FILE, o); }, 2000); }
setInterval(saveSessions, 5 * 60e3).unref();
function setSessionCookie(req, res, token, maxAge) {
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `sp_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`);
}
// login-bescherming: max 5 fouten per IP per 15 min
const failures = new Map();
function tooManyFailures(ip) { const f = failures.get(ip); return f && f.count >= 5 && Date.now() - f.first < 15 * 60 * 1000; }
function addFailure(ip) {
  const f = failures.get(ip);
  if (!f || Date.now() - f.first > 15 * 60 * 1000) failures.set(ip, { count: 1, first: Date.now() }); else f.count++;
}
// directe verbinding vanaf thuisnetwerk (niet via Caddy/internet)?
function isDirectLan(req) {
  if (req.headers['x-forwarded-for'] || req.headers['forwarded']) return false;
  const a = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(a) || a === '::1' || /^f[cd]/i.test(a);
}

// ---------------------------------------------------------------- processen + jobs
function fakeDocker(args, cwd) {
  const a = args.join(' ');
  const name = cwd ? path.basename(cwd) : 'app';
  if (args[0] === 'compose' && args[1] === 'ps') {
    const stopped = cwd && exists(path.join(cwd, '.demo-stopped'));
    return JSON.stringify({ Name: `${name}-web-1`, State: stopped ? 'exited' : 'running', Status: stopped ? 'Exited (0)' : 'Up 3 hours' });
  }
  if (args[0] === 'compose' && args[1] === 'stop' && cwd) fs.writeFileSync(path.join(cwd, '.demo-stopped'), '');
  if (args[0] === 'compose' && ['up', 'start', 'restart'].includes(args[1]) && cwd) fs.rmSync(path.join(cwd, '.demo-stopped'), { force: true });
  if (args[0] === 'compose' && args[1] === 'logs') {
    const t = Date.now();
    return [0, 1, 2, 3, 4].map((i) => `${name}-web-1  | ${new Date(t - (5 - i) * 60000).toISOString()} (demo) GET / 200 - ${12 + i} ms`).join('\n') + '\n';
  }
  if (args[0] === 'ps') return ['caddy|caddy:2|running|Up 3 days|0.0.0.0:80->80/tcp, 0.0.0.0:443->443/tcp', 'duckdns|linuxserver/duckdns|running|Up 3 days|', 'nextcloud|nextcloud:29|running|Up 3 days|0.0.0.0:8081->80/tcp', 'serverpaneel|serverpaneel:latest|running|Up 1 hour|0.0.0.0:3000->3000/tcp']
    .map((l) => { const [n, i, st, s2, p] = l.split('|'); return JSON.stringify({ Names: n, Image: i, State: st, Status: s2, Ports: p }); }).join('\n');
  if (args[0] === 'stats') {
    const t = Date.now() / 1000;
    return [['caddy', 0.3, '38.2MiB / 15.5GiB', 0.24], ['duckdns', 0.0, '6.1MiB / 15.5GiB', 0.04], ['nextcloud', 2.1, '412MiB / 15.5GiB', 2.6], ['serverpaneel', 0.6, '71.4MiB / 15.5GiB', 0.45]]
      .map(([n, c, m, mp], i) => JSON.stringify({ Name: n, CPUPerc: `${(c + Math.abs(Math.sin(t / 7 + i)) * c).toFixed(2)}%`, MemUsage: m, MemPerc: `${mp}%`, NetIO: '12.4MB / 3.1MB', BlockIO: '45MB / 12MB' })).join('\n');
  }
  if (args[0] === 'inspect') return 'true';
  if (args[0] === 'exec') return '(demo) caddy herladen';
  if (args[0] === 'compose' && args[1] === 'up') return `(demo) [+] Building ${name}\n(demo) [+] Running 1/1\n ✔ Container ${name}-web-1  Started\n`;
  return `(demo) docker ${a}\n`;
}
function run(cmd, args, { cwd, job, quiet, env, timeout } = {}) {
  if (DEMO && (cmd === 'docker' || cmd === 'docker-compose')) {
    const out = fakeDocker(args, cwd);
    if (job && !quiet) job.log += `$ ${cmd} ${args.join(' ')}\n${out}${out.endsWith('\n') ? '' : '\n'}`;
    return new Promise((r) => setTimeout(() => r({ code: 0, out }), args[1] === 'up' ? 1200 : 150));
  }
  return new Promise((resolve) => {
    if (job && !quiet) job.log += `$ ${cmd} ${args.join(' ')}\n`;
    let out = '';
    let p;
    try { p = spawn(cmd, args, { cwd, env: env || process.env, shell: process.platform === 'win32' && cmd === 'npm' }); } catch (e) { return resolve({ code: 127, out: String(e) }); }
    const onData = (d) => { out += d; if (out.length > 4e6) out = out.slice(-2e6); if (job && !quiet) { job.log += d; if (job.log.length > 2e6) job.log = job.log.slice(-1e6); } };
    p.stdout.on('data', onData); p.stderr.on('data', onData);
    const tmr = timeout ? setTimeout(() => { out += '\n[duurde te lang: gestopt]\n'; if (job) job.log += '\n[duurde te lang: gestopt]\n'; try { p.kill('SIGTERM'); } catch { /* */ } }, timeout) : null;
    p.on('error', (e) => { clearTimeout(tmr); out += String(e); if (job && !quiet) job.log += `${e}\n`; resolve({ code: 127, out }); });
    p.on('close', (code) => { clearTimeout(tmr); resolve({ code, out }); });
  });
}
async function mustRun(cmd, args, opts) {
  const r = await run(cmd, args, opts);
  if (r.code !== 0) throw new Error(`${cmd} ${args[0] || ''} mislukt (code ${r.code})`);
  return r;
}
const jobs = new Map();
const busy = new Set();
function startJob(site, action, fn) {
  if (busy.has(site)) { const e = new Error(`Er loopt al een actie voor "${site}". Wacht even.`); e.status = 409; throw e; }
  const job = { id: crypto.randomBytes(8).toString('hex'), site, action, status: 'running', log: '', started: Date.now() };
  jobs.set(job.id, job); busy.add(site);
  const say = (m) => { job.log += `\n==> ${m}\n`; };
  Promise.resolve().then(() => fn(job, say))
    .then(() => { job.status = 'ok'; say('Klaar.'); })
    .catch((e) => { job.status = 'error'; job.log += `\n!! FOUT: ${e.message}\n`; job.error = e.message; })
    .finally(() => {
      busy.delete(site); job.finished = Date.now(); notifySites();
      activity(site, { action, ok: job.status === 'ok', error: job.error || '', changes: countChanges(job.log), job: job.id });
      if (job.status === 'error' && ctxReady) ctx.notify.send('sites', { title: `${site}: ${action} mislukt`, body: job.error || '', url: `/#/sites/${site}`, inFeed: true, level: 'error' }).catch(() => {});
      if (jobs.size > 60) jobs.delete(jobs.keys().next().value);
    });
  return job;
}

function countChanges(log) { const c = (re) => (String(log).match(re) || []).length; return { added: c(/^ {2}\+ nieuw:/gm), changed: c(/^ {2}~ gewijzigd:/gm), removed: c(/^ {2}- verwijderd:/gm) }; }
function activity(name, entry) { store.update('siteActivity', {}, (a) => { const l = a[name] || []; l.push({ at: Date.now(), ...entry }); a[name] = l.slice(-40); }); }
let ctxReady = false;

// ---------------------------------------------------------------- hulpfuncties sites
const pad = (n) => String(n).padStart(2, '0');
const stamp = () => { const d = new Date(); return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`; };
const exists = (p) => fs.existsSync(p);
const hasCompose = (dir) => COMPOSE_FILES.some((f) => exists(path.join(dir, f)));
function inside(root, p) { const r = path.resolve(root) + path.sep; const q = path.resolve(p); return q + path.sep === r || q.startsWith(r); }
function safeRel(rel) {
  const n = path.posix.normalize(String(rel).replace(/\\/g, '/')).replace(/^\/+/, '');
  if (!n || n === '.' || n.split('/').some((seg) => seg === '..')) return null;
  return n;
}
const SELF_KEEP = ['.env', 'data', 'caddy', 'docker-compose.override.yml'];
const SELF_SKIP = ['demo-data', 'start-demo.cmd', 'start-demo.sh']; // enkel voor de demo op je pc
function keepList(site) { return [...new Set([...DEFAULT_KEEP, ...(site.self ? SELF_KEEP : []), ...(site.keep || [])].map((k) => k.replace(/^\/+|\/+$/g, '')).filter(Boolean))]; }
function rsyncExcludes(site) {
  return [...keepList(site).map((k) => `--exclude=/${k}`), ...(site.self ? SELF_SKIP.map((k) => `--exclude=/${k}`) : []), ...ALWAYS_EXCLUDE.map((e) => `--exclude=${e}`)];
}
function publicSite(s) {
  return { name: s.name, type: s.type, path: s.path, domain: s.domain || '', port: s.port || '', keep: s.keep || [], managed: !!s.managed, self: !!s.self, container: s.container || '', domainExternal: !!s.domainExternal, createdAt: s.createdAt, updatedAt: s.updatedAt, spa: !!s.spa, framework: s.framework || '', maintenance: s.maintenance ? { mode: s.maintenance.mode, since: s.maintenance.since } : null };
}
async function compose(site, args, job) {
  // eerst "docker compose" (v2), anders "docker-compose"
  let r = await run('docker', ['compose', ...args], { cwd: site.path, job });
  if (r.code !== 0 && /is not a docker command|unknown command/i.test(r.out)) r = await run('docker-compose', args, { cwd: site.path, job });
  return r;
}

// Na upload/extractie: als alles in één map zit, die map als root nemen
async function unwrapSingleFolder(stage) {
  const entries = (await fsp.readdir(stage)).filter((e) => e !== '__MACOSX');
  if (entries.length === 1) {
    const only = path.join(stage, entries[0]);
    if ((await fsp.stat(only)).isDirectory() && !exists(path.join(stage, 'index.html')) && !hasCompose(stage)) return only;
  }
  return stage;
}

async function buildStage(req, job, say) {
  const stageBase = path.join(CFG.dataDir, 'tmp', `stage-${crypto.randomBytes(6).toString('hex')}`);
  await fsp.mkdir(stageBase, { recursive: true });
  const files = req.files || [];
  if (!files.length) throw new Error('Geen bestanden ontvangen.');
  if (files.length === 1 && /\.zip$/i.test(files[0].originalname)) {
    say('Zip uitpakken');
    const u = await run('unzip', ['-q', '-o', files[0].path, '-d', stageBase], { job, quiet: true });
    if (u.code !== 0) extractZipJs(files[0].path, stageBase); // bv. op Windows
  } else {
    let paths = [];
    try { paths = JSON.parse(req.body.paths || '[]'); } catch { paths = []; }
    say(`${files.length} bestanden ontvangen`);
    for (let i = 0; i < files.length; i++) {
      let rel = paths[i] || files[i].originalname;
      rel = safeRel(rel);
      if (!rel) continue;
      if (paths.length && req.body.stripTop === '1') rel = rel.split('/').slice(1).join('/') || rel;
      const dest = path.join(stageBase, rel);
      if (!inside(stageBase, dest)) continue;
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await fsp.copyFile(files[i].path, dest);
    }
  }
  return { stageBase, stage: await unwrapSingleFolder(stageBase) };
}
function extractZipJs(zipFile, dest) {
  const AdmZip = require('adm-zip');
  let zip; try { zip = new AdmZip(zipFile); } catch { throw new Error('Dit is geen geldig zip-bestand.'); }
  for (const e of zip.getEntries()) {
    const rel = safeRel(e.entryName); if (!rel) continue;
    const to = path.join(dest, rel); if (!inside(dest, to)) continue;
    if (e.isDirectory) { fs.mkdirSync(to, { recursive: true }); continue; }
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, e.getData());
  }
}
async function cleanupUploads(req) { for (const f of req.files || []) await fsp.rm(f.path, { force: true }).catch(() => {}); }

const HAS_RSYNC = (() => { try { return spawnSync('rsync', ['--version']).status === 0; } catch { return false; } })();
function excludedRel(rel, anchored, any) {
  if (anchored.some((k) => rel === k || rel.startsWith(`${k}/`))) return true;
  return rel.split('/').some((seg) => any.includes(seg));
}
async function listTree(root, anchored, any) {
  const out = new Map();
  const rec = async (dirRel) => {
    let ents; try { ents = await fsp.readdir(path.join(root, dirRel), { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const rel = dirRel ? `${dirRel}/${e.name}` : e.name;
      if (excludedRel(rel, anchored, any)) continue;
      if (e.isDirectory()) { out.set(rel, 'd'); await rec(rel); } else if (e.isFile()) out.set(rel, 'f');
    }
  };
  await rec(''); return out;
}
async function sameFile(a, b) {
  const [sa, sb] = await Promise.all([fsp.stat(a), fsp.stat(b)]);
  if (sa.size !== sb.size) return false;
  const [ba, bb] = await Promise.all([fsp.readFile(a), fsp.readFile(b)]);
  return ba.equals(bb);
}
// zelfde gedrag als "rsync -a --checksum [--delete] --itemize-changes"
async function jsSync(src, dst, { anchored, any, del }) {
  const lines = [];
  const s = await listTree(src, anchored, any), d = await listTree(dst, anchored, any);
  await fsp.mkdir(dst, { recursive: true });
  for (const [rel, t] of [...s].sort()) {
    const from = path.join(src, rel), to = path.join(dst, rel);
    if (t === 'd') {
      if (d.get(rel) === 'f') await fsp.rm(to, { force: true });
      if (d.get(rel) !== 'd') { await fsp.mkdir(to, { recursive: true }); lines.push(`cd+++++++++ ${rel}/`); }
      continue;
    }
    if (d.get(rel) === 'd') await fsp.rm(to, { recursive: true, force: true });
    if (d.get(rel) !== 'f') { await fsp.mkdir(path.dirname(to), { recursive: true }); await fsp.copyFile(from, to); lines.push(`>f+++++++++ ${rel}`); }
    else if (!(await sameFile(from, to))) { await fsp.copyFile(from, to); lines.push(`>fc.t...... ${rel}`); }
  }
  if (del) {
    for (const rel of [...d.keys()].filter((r) => !s.has(r)).sort().reverse()) {
      await fsp.rm(path.join(dst, rel), { recursive: true, force: true });
      lines.push(`*deleting   ${rel}${d.get(rel) === 'd' ? '/' : ''}`);
    }
  }
  return lines.join('\n');
}
async function copyTree(src, dst, site, del, job) {
  if (HAS_RSYNC) {
    return run('rsync', ['-a', '--checksum', ...(del ? ['--delete'] : []), '--itemize-changes', ...rsyncExcludes(site), `${src}/`, `${dst}/`], { job, quiet: true });
  }
  try { return { code: 0, out: await jsSync(src, dst, { anchored: [...keepList(site), ...(site.self ? SELF_SKIP : [])], any: ALWAYS_EXCLUDE, del }) }; }
  catch (e) { return { code: 1, out: String(e.message) }; }
}

async function makeBackup(site, job, say, protectId) {
  if (!exists(site.path) || !(await fsp.readdir(site.path)).length) return null;
  const base = stamp(); let id = base, n = 1;
  while (exists(path.join(CFG.backupRoot, site.name, id))) id = `${base}-${++n}`;
  const dir = path.join(CFG.backupRoot, site.name, id);
  say(`Backup maken van huidige versie (${path.basename(dir)})`);
  await fsp.mkdir(dir, { recursive: true });
  await copyTree(site.path, dir, site, false, job);
  // oude backups opruimen
  const all = (await listBackups(site)).map((b) => b.id).filter((b) => b !== protectId);
  for (const old of all.slice(CFG.keepBackups)) await fsp.rm(path.join(CFG.backupRoot, site.name, old), { recursive: true, force: true });
  return dir;
}
async function listBackups(site) {
  const dir = path.join(CFG.backupRoot, site.name);
  if (!exists(dir)) return [];
  const names = (await fsp.readdir(dir)).filter((n) => /^\d{8}-\d{6}(-\d+)?$/.test(n)).sort().reverse();
  return names.map((id) => ({ id, date: `${id.slice(6, 8)}/${id.slice(4, 6)}/${id.slice(0, 4)} ${id.slice(9, 11)}:${id.slice(11, 13)}` }));
}
async function syncInto(src, site, job, say) {
  say('Alleen gewijzigde bestanden vervangen (je .env, data en uploads blijven staan)');
  await fsp.mkdir(site.path, { recursive: true });
  // beschermde bestanden: bestaan ze nog niet op de server, neem dan wel de versie uit de upload
  for (const k of keepList(site)) {
    const from = path.join(src, k), to = path.join(site.path, k);
    if (exists(from) && !exists(to) && inside(site.path, to)) {
      await fsp.mkdir(path.dirname(to), { recursive: true });
      await fsp.cp(from, to, { recursive: true, preserveTimestamps: true });
      job.log += `  + nieuw:     ${k}\n`;
    }
  }
  const r = await copyTree(src, site.path, site, true, job);
  if (r.code !== 0) { job.log += r.out; throw new Error('Bestanden kopieren mislukt'); }
  const lines = r.out.split('\n').filter((l) => l && !/^[.c]d/.test(l) && !/^\.[fL]/.test(l) && !/ \.\/$/.test(l)); // .f = enkel datum anders, geen echte wijziging
  const nice = lines.map((l) => (l.startsWith('*deleting') ? `  - verwijderd: ${l.slice(12).trim()}` : /^>f\+/.test(l) ? `  + nieuw:     ${l.slice(12)}` : /^>f/.test(l) ? `  ~ gewijzigd: ${l.slice(12)}` : `    ${l}`));
  job.log += nice.length ? nice.join('\n') + '\n' : '  (geen wijzigingen)\n';
}
async function afterDeploy(site, job, say) {
  if (site.type === 'docker' && site.maintenance) {
    say('Onderhoudsmodus staat aan: enkel bouwen, de app start als je de onderhoudsmodus uitzet');
    const r = await compose(site, ['build'], job);
    if (r.code !== 0) throw new Error('docker compose build mislukt');
    return;
  }
  if (site.type === 'docker') {
    if (!hasCompose(site.path)) throw new Error('Geen docker-compose.yml gevonden in deze site.');
    say('Docker: gewijzigde containers opnieuw bouwen en starten');
    const r = await compose(site, ['up', '-d', '--build', '--remove-orphans'], job);
    if (r.code !== 0) throw new Error('docker compose up mislukt');
  } else {
    if (!exists(path.join(site.path, 'index.html'))) job.log += '  let op: geen index.html gevonden in de hoofdmap\n';
    say('Statische site is meteen live');
  }
}

// ---------------------------------------------------------------- Caddy (domeinen + https)
function caddyFile(site) { return path.join(CFG.caddyDir, `site-${site.name}.caddy`); }
function caddyBlock(site) {
  const port = site.type === 'docker' || site.type === 'container' ? site.port : CFG.hostPort;
  return `# automatisch gemaakt door serverpaneel - niet handmatig aanpassen\n${site.domain} {\n\tencode gzip\n\treverse_proxy ${CFG.upstreamHost}:${port}\n}\n`;
}
async function caddyReload(job) {
  if (!CFG.caddyContainer) return { ok: false, out: 'CADDY_CONTAINER niet ingesteld' };
  const r = await run('docker', ['exec', CFG.caddyContainer, 'caddy', 'reload', '--config', CFG.caddyConfig, '--adapter', 'caddyfile'], { job });
  return { ok: r.code === 0, out: r.out };
}
const INLINE_START = '# >>> SERVERPANEEL – automatisch beheerd, niet met de hand aanpassen >>>';
const INLINE_END = '# <<< SERVERPANEEL <<<';
async function inlineSection() {
  const files = (await fsp.readdir(CFG.caddyDir).catch(() => [])).filter((f) => f.endsWith('.caddy')).sort();
  const parts = []; for (const f of files) parts.push((await fsp.readFile(path.join(CFG.caddyDir, f), 'utf8')).trim());
  return `${INLINE_START}\n${parts.filter((x) => x && !/^#[^\n]*$/.test(x)).join('\n\n')}\n${INLINE_END}`;
}
// Caddyfile herschrijven OP DEZELFDE PLEK (zelfde bestand), anders ziet de Caddy-container de wijziging niet
async function writeInline() {
  const cf = CFG.caddyfileHost; const before = await fsp.readFile(cf, 'utf8');
  const sec = await inlineSection();
  const i = before.indexOf(INLINE_START), j = before.indexOf(INLINE_END);
  const after = i >= 0 && j > i
    ? `${before.slice(0, i).replace(/\s*$/, '')}\n\n${sec}\n${before.slice(j + INLINE_END.length).replace(/^\s*/, '')}`
    : `${before.replace(/\s*$/, '')}\n\n${sec}\n`;
  if (after !== before) { const fd = await fsp.open(cf, 'r+'); try { await fd.truncate(0); await fd.write(after, 0, 'utf8'); } finally { await fd.close(); } }
  return { before, changed: after !== before };
}
async function restoreCaddyfile(content) { const fd = await fsp.open(CFG.caddyfileHost, 'r+'); try { await fd.truncate(0); await fd.write(content, 0, 'utf8'); } finally { await fd.close(); } }
async function syncInlineAtStart() {
  if (!CFG.caddyInline || !CFG.caddyfileHost || !CFG.caddyDir || !CFG.caddyContainer || DEMO) return;
  try {
    const { before, changed } = await writeInline();
    if (changed) { const r = await caddyReload(null); if (!r.ok) { await restoreCaddyfile(before); await caddyReload(null); console.log('Caddy weigerde de instellingen van het paneel; je oude Caddyfile is teruggezet.'); } else console.log('Caddy bijgewerkt met de domeinen van het paneel.'); }
  } catch (e) { console.log(`Caddyfile kon niet bijgewerkt worden: ${e.message}`); }
}
async function applyCaddy(site, job, say) {
  if (site.domainExternal) return; // domein staat in je eigen Caddyfile: niet aankomen
  if (!CFG.caddyDir || !CFG.caddyContainer) { if (site.domain) job && (job.log += '  (Caddy-koppeling niet ingesteld: domein wordt niet automatisch geconfigureerd)\n'); return; }
  const f = caddyFile(site);
  const before = exists(f) ? await fsp.readFile(f, 'utf8') : null;
  const want = site.domain && (site.type === 'static' || site.port) ? caddyBlock(site) : null;
  if (before === want) return;
  say && say(want ? `Caddy instellen voor https://${site.domain}` : 'Domein verwijderen uit Caddy');
  if (want) await fsp.writeFile(f, want); else await fsp.rm(f, { force: true });
  let cfBefore = null;
  if (CFG.caddyInline && CFG.caddyfileHost) { try { cfBefore = (await writeInline()).before; } catch (e) { if (before) await fsp.writeFile(f, before); else await fsp.rm(f, { force: true }); throw new Error(`Kan je Caddyfile niet aanpassen: ${e.message}`); } }
  const r = await caddyReload(job);
  if (!r.ok) {
    if (before) await fsp.writeFile(f, before); else await fsp.rm(f, { force: true });
    if (cfBefore !== null) await restoreCaddyfile(cfBefore);
    await caddyReload(null);
    throw new Error('Caddy weigerde de nieuwe instelling; oude instelling teruggezet.');
  }
}

// ---------------------------------------------------------------- server-info
let publicIpCache = { ip: '', t: 0 };
async function publicIp() {
  if (DEMO) return '203.0.113.10';
  if (Date.now() - publicIpCache.t < 10 * 60 * 1000) return publicIpCache.ip;
  try {
    const r = await fetch('https://api.ipify.org', { signal: AbortSignal.timeout(3000) });
    const ip = (await r.text()).trim();
    if (!r.ok || !/^[0-9a-f.:]{3,45}$/i.test(ip)) throw new Error('geen ip');
    publicIpCache = { ip, t: Date.now() };
  } catch { publicIpCache.t = Date.now() - 9 * 60 * 1000; }
  return publicIpCache.ip;
}
async function diskInfo(p) {
  try {
    const s = await fsp.statfs(p);
    const total = s.blocks * s.bsize, free = s.bavail * s.bsize;
    return { total, used: total - s.bfree * s.bsize, free };
  } catch { return null; }
}
function parseComposePs(out) {
  const t = out.trim(); if (!t) return [];
  try { const j = JSON.parse(t); return Array.isArray(j) ? j : [j]; } catch { /* ndjson */ }
  return t.split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
async function siteStatus(site) {
  if (site.type === 'container') {
    const r = await run('docker', ['inspect', '-f', '{{.State.Status}}', site.container], { quiet: true });
    if (r.code !== 0) return { state: 'missing', text: /no such (object|container)/i.test(r.out) ? 'container niet gevonden' : 'docker niet bereikbaar' };
    const st = r.out.trim();
    return st === 'running' ? { state: 'up', text: 'online' } : { state: 'down', text: st === 'exited' ? 'gestopt' : st };
  }
  if (!exists(site.path)) return { state: 'missing', text: 'map niet gevonden' };
  if (site.type === 'static') return exists(path.join(site.path, 'index.html')) ? { state: 'up', text: 'online' } : { state: 'warn', text: 'geen index.html' };
  const r = await run('docker', ['compose', 'ps', '-a', '--format', 'json'], { cwd: site.path });
  if (r.code !== 0) return { state: 'warn', text: 'docker niet bereikbaar' };
  const cs = parseComposePs(r.out);
  if (!cs.length) return { state: 'down', text: 'gestopt' };
  const up = cs.filter((c) => (c.State || '').toLowerCase() === 'running').length;
  return { state: up === cs.length ? 'up' : up ? 'warn' : 'down', text: up === cs.length ? 'online' : up ? `${up}/${cs.length} online` : 'gestopt', containers: cs.map((c) => ({ name: c.Name, state: c.State, status: c.Status })) };
}

// ---------------------------------------------------------------- metingen
const metrics = require('./metrics')({ demo: DEMO, hostRoot: env('HOST_ROOT', '/hostfs') });
let dockerStatsCache = { t: 0, data: {} };
async function dockerStats() {
  if (Date.now() - dockerStatsCache.t < 8000) return dockerStatsCache.data;
  const r = await run('docker', ['stats', '--no-stream', '--format', '{{json .}}']);
  const data = {};
  for (const c of parseComposePs(r.out)) data[c.Name] = { cpu: parseFloat(c.CPUPerc) || 0, mem: c.MemUsage, memPct: parseFloat(c.MemPerc) || 0, net: c.NetIO, block: c.BlockIO };
  dockerStatsCache = { t: Date.now(), data };
  return data;
}

// ---------------------------------------------------------------- app
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback, uniquelocal');

// 1) Statische sites op hun eigen domein (via Caddy). Nooit het paneel tonen op een site-domein.
const staticServers = new Map();
app.use((req, res, next) => {
  const host = (req.hostname || '').toLowerCase();
  const site = host && sites.find((s) => s.domain === host && (s.type === 'static' || s.maintenance));
  if (!site) return next();
  const t0 = Date.now();
  res.on('finish', () => logAccess(site.name, req, res.statusCode, Date.now() - t0));
  if (site.maintenance) return res.status(503).set('Retry-After', '300').set('Cache-Control', 'no-store').type('html').send(maintenancePage(site.name));
  let srv = staticServers.get(site.path);
  if (!srv) { srv = express.static(site.path, { dotfiles: 'deny', index: 'index.html', extensions: ['html'] }); staticServers.set(site.path, srv); }
  srv(req, res, () => {
    if (site.spa && exists(path.join(site.path, 'index.html'))) return res.sendFile(path.join(site.path, 'index.html'));
    const nf = path.join(site.path, '404.html');
    return exists(nf) ? res.status(404).sendFile(nf) : res.status(404).send('Pagina niet gevonden');
  });
});

// 2) Beveiligingsheaders voor het paneel
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', req.path.startsWith('/view/') ? 'SAMEORIGIN' : 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (!req.path.startsWith('/view/') && !req.path.startsWith('/d/')) res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'");
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(self), geolocation=()');
  next();
});
// 3) CSRF: POST/DELETE enkel vanaf het paneel zelf
app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (origin) {
    let h; try { h = new URL(origin).host; } catch { h = ''; }
    const allowed = [req.headers.host, req.headers['x-forwarded-host']].filter(Boolean);
    if (!allowed.includes(h)) return res.status(403).json({ error: 'Verzoek geweigerd (andere herkomst)' });
  }
  next();
});
app.use(express.json({ limit: '100kb' }));
// Versie = vingerafdruk van alle paneelbestanden. Verandert er iets, dan laadt elke browser meteen de nieuwe versie.
// Alle bestanden staan onder /v/<versie>/..., zodat de browser ze lang mag bewaren (sneller) en toch nooit een oude versie toont.
const PUBLIC_DIR = path.join(__dirname, 'public');
const VERSION = (() => {
  const h = crypto.createHash('sha1');
  const walk = (dir) => { for (const f of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const p = path.join(dir, f.name); if (f.isDirectory()) walk(p); else h.update(p.slice(__dirname.length)).update(fs.readFileSync(p)); } };
  walk(PUBLIC_DIR); walk(path.join(__dirname, 'lib'));
  h.update(fs.readFileSync(__filename)); h.update(fs.readFileSync(path.join(__dirname, 'metrics.js')));
  return h.digest('hex').slice(0, 8);
})();
const INDEX_HTML = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8').replace(/__V__/g, `/v/${VERSION}`).replace(/__VERSION__/g, VERSION);
app.use('/v/:ver', express.static(PUBLIC_DIR, { index: false, immutable: true, maxAge: '365d' }));
// service worker en manifest: altijd vers (bepalen welke versie actief is)
const SW_ASSETS = (() => { const out = []; const walk = (dir) => { for (const f of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, f.name); if (f.isDirectory()) walk(p); else if (/\.(js|css|woff2)$/.test(f.name) && !/xterm/.test(f.name)) out.push(`/v/${VERSION}/${path.relative(PUBLIC_DIR, p).split(path.sep).join('/')}`); } }; for (const d of ['css', 'js', 'fonts', 'vendor']) if (fs.existsSync(path.join(PUBLIC_DIR, d))) walk(path.join(PUBLIC_DIR, d)); return out; })();
const SW_JS = () => fs.readFileSync(path.join(PUBLIC_DIR, 'sw.js'), 'utf8').replace(/__VERSION__/g, VERSION).replace('__ASSETS__', JSON.stringify(['/manifest.webmanifest', '/icon-192.png', ...SW_ASSETS]));
app.get('/sw.js', (req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.setHeader('Service-Worker-Allowed', '/'); res.type('js').send(SW_JS()); });
app.use(express.static(PUBLIC_DIR, { index: false, setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch((e) => { if (!res.headersSent) res.status(e.status || 500).json({ error: e.message, code: e.code }); });
const bad = (msg, status = 400) => { const e = new Error(msg); e.status = status; return e; };

// ---- auth
app.get('/api/me', (req, res) => {
  res.json({ setupNeeded: !auth, setupAllowed: !auth && isDirectLan(req), loggedIn: !!currentSession(req), totp: !!(auth && auth.totpEnabled), demo: DEMO });
});
app.post('/api/setup', wrap(async (req, res) => {
  if (auth) throw bad('Al ingesteld', 409);
  if (!isDirectLan(req)) throw bad('Het eerste wachtwoord instellen kan enkel vanaf je thuisnetwerk (via het lokale IP).', 403);
  const pw = String(req.body.password || '');
  if (pw.length < 10) throw bad('Wachtwoord moet minstens 10 tekens zijn.');
  auth = { passwordHash: hashPassword(pw), totpEnabled: false, totpSecret: null };
  saveAuth();
  createSession(req, res);
  res.json({ ok: true });
}));
app.post('/api/login', wrap(async (req, res) => {
  const ip = req.ip;
  if (!auth) throw bad('Nog geen wachtwoord ingesteld.', 409);
  if (tooManyFailures(ip)) throw bad('Te veel foute pogingen. Probeer over 15 minuten opnieuw.', 429);
  const okPw = checkPassword(req.body.password || '', auth.passwordHash);
  if (okPw && auth.totpEnabled && !req.body.code) return res.json({ needCode: true });
  const okCode = !auth.totpEnabled || verifyTotp(auth.totpSecret, req.body.code);
  if (!okPw || !okCode) {
    addFailure(ip);
    await new Promise((r) => setTimeout(r, 600));
    throw bad(okPw ? 'Verkeerde 2FA-code.' : 'Verkeerd wachtwoord.', 401);
  }
  failures.delete(ip);
  createSession(req, res, { stepUpAt: Date.now() });
  res.json({ ok: true });
}));
app.post('/api/logout', (req, res) => {
  const t = parseCookies(req).sp_session; if (t) sessions.delete(sk(t)); saveSessions();
  setSessionCookie(req, res, '', 0); res.json({ ok: true });
});

// alles hieronder vereist inloggen
function requireAuth(req, res, next) {
  if (currentSession(req)) return next();
  if (req.originalUrl.startsWith('/api/')) return res.status(401).json({ error: 'Niet ingelogd' });
  return res.redirect('/');
}
app.get('/', (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.type('html').send(INDEX_HTML); });
app.get('/api/version', (req, res) => res.json({ version: VERSION }));

// ---------------------------------------------------------------- onderdelen: agenda, meldingen, ...
const uploadMem = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 ** 2 } });
const uploadDisk = multer({ dest: path.join(CFG.dataDir, 'tmp'), limits: { fileSize: 4 * 1024 ** 3 } });
const ctx = {
  CFG, DEMO, store, wrap, bad, run, metrics, uploadMem, uploadDisk,
  broadcast: (e, d) => { try { broadcast(e, d); } catch { /* nog niet klaar */ } },
  auth: () => auth, saveAuth, checkPassword, hashPassword, verifyTotp, tooManyFailures, addFailure,
  sessionOf, sessionToken, createSession, selfImage, sites: () => sites, isBusy: (n) => busy.has(n),
  siteStatuses: (...a) => siteStatuses(...a), restartSite: (...a) => restartSite(...a),
};
ctx.calendar = require('./lib/calendar')(ctx);
ctx.personal = require('./lib/personal')(ctx);
ctx.notify = require('./lib/notify')(ctx);
ctx.servertools = require('./lib/servertools')(ctx);
ctx.security = require('./lib/security')(ctx);
ctx.requireStepUp = ctx.security.requireStepUp;
ctx.terminal = require('./lib/terminal')(ctx);
ctx.files = require('./lib/files')(ctx);
// apps-winkel: een kant-en-klare docker-compose als nieuwe site installeren en starten
ctx.installApp = function installApp({ name, dir, port, domain, appId }) {
  if (!NAME_RE.test(name)) throw bad('Naam: enkel kleine letters, cijfers en -, max 40 tekens');
  if (getSite(name)) throw bad('Er bestaat al een site met die naam', 409);
  const settings = validateSettings({ domain: domain || '', port: port || '' });
  const site = { name, path: dir, type: 'docker', domain: '', port: null, keep: ['data', '.env'], spa: false, managed: true, app: true, appId: appId || '', createdAt: Date.now(), updatedAt: Date.now(), ...settings };
  sites.push(site); saveSites();
  return startJob(name, 'installeren', async (job, say) => {
    say(`${name} installeren in ${dir}`);
    await afterDeploy(site, job, say);
    await applyCaddy(site, job, say);
  });
};
ctx.dockerStats = dockerStats;
ctx.hosttools = require('./lib/hosttools')(ctx);
ctx.apps = require('./lib/apps')(ctx);
ctx.databases = require('./lib/databases')(ctx);
ctx.search = require('./lib/search')(ctx);
ctxReady = true;
ctx.calendar.early(app);
ctx.personal.early(app);
ctx.security.routes(app, { publicRoutes: true });

app.use('/api', requireAuth);

// voorbeeld van een statische site bekijken (ook zonder domein, bv. thuis)
app.use('/view/:name', requireAuth, (req, res, next) => {
  const site = getSite(req.params.name);
  if (!site || site.type !== 'static') return res.status(404).send('Onbekende site');
  if (req.originalUrl === `/view/${site.name}`) return res.redirect(`/view/${site.name}/`);
  express.static(site.path, { dotfiles: 'deny', extensions: ['html'] })(req, res, next);
});

// ---- instellingen
app.post('/api/password', wrap(async (req, res) => {
  if (!checkPassword(req.body.old || '', auth.passwordHash)) throw bad('Huidig wachtwoord klopt niet.', 401);
  const pw = String(req.body.new || '');
  if (pw.length < 10) throw bad('Nieuw wachtwoord moet minstens 10 tekens zijn.');
  auth.passwordHash = hashPassword(pw); saveAuth();
  const mine = sk(parseCookies(req).sp_session);
  for (const k of [...sessions.keys()]) if (k !== mine) sessions.delete(k); // andere toestellen uitloggen
  saveSessions();
  res.json({ ok: true });
}));
app.post('/api/2fa/setup', wrap(async (req, res) => {
  const secret = b32encode(crypto.randomBytes(20));
  auth.pendingTotp = secret; saveAuth();
  const label = encodeURIComponent(`Serverpaneel:${CFG.hostName}`);
  const url = `otpauth://totp/${label}?secret=${secret}&issuer=Serverpaneel&digits=6&period=30`;
  res.json({ secret, qr: await QRCode.toDataURL(url, { margin: 1, width: 220 }) });
}));
app.post('/api/2fa/enable', wrap(async (req, res) => {
  if (!auth.pendingTotp) throw bad('Start eerst de 2FA-instelling.');
  if (!verifyTotp(auth.pendingTotp, req.body.code)) throw bad('Code klopt niet. Controleer de tijd op je gsm en probeer opnieuw.');
  auth.totpSecret = auth.pendingTotp; auth.totpEnabled = true; delete auth.pendingTotp; saveAuth();
  res.json({ ok: true });
}));
app.post('/api/2fa/disable', wrap(async (req, res) => {
  if (!checkPassword(req.body.password || '', auth.passwordHash)) throw bad('Wachtwoord klopt niet.', 401);
  auth.totpEnabled = false; auth.totpSecret = null; saveAuth();
  res.json({ ok: true });
}));

// ---- overzicht
app.get('/api/overview', wrap(async (req, res) => {
  const [disk, pub, statuses, caddyOk] = await Promise.all([
    diskInfo(CFG.sitesRoot), publicIp(),
    Promise.all(sites.map(siteStatus)),
    CFG.caddyContainer ? run('docker', ['inspect', '-f', '{{.State.Running}}', CFG.caddyContainer]).then((r) => r.out.trim() === 'true') : Promise.resolve(null),
  ]);
  res.json({
    server: {
      demo: DEMO, name: CFG.hostName, lanIp: CFG.hostLanIp, publicIp: pub, panelDomain: CFG.panelDomain, port: CFG.hostPort,
      uptime: os.uptime(), load: os.loadavg(), memTotal: os.totalmem(), memFree: os.freemem(), disk,
      caddy: CFG.caddyContainer ? { container: CFG.caddyContainer, running: caddyOk, linked: !!CFG.caddyDir } : null,
      dockerAtBoot: DEMO ? true : dockerStartsAtBoot(),
      sitesRoot: CFG.sitesRoot, allowedRoot: CFG.allowedRoot,
    },
    sites: sites.map((s, i) => ({ ...publicSite(s), status: s.maintenance ? { state: 'maint', text: 'onderhoud' } : statuses[i], busy: busy.has(s.name), autostart: DEMO ? (s.type !== 'static' ? { ok: true } : null) : autostart.get(s.name) || null })),
  });
}));
// bestaande projecten op de server zoeken (mappen met docker-compose.yml of index.html)
function composePort(dir) {
  for (const f of COMPOSE_FILES) {
    const p = path.join(dir, f); if (!exists(p)) continue;
    const m = fs.readFileSync(p, 'utf8').match(/["'\s-](?:\d+\.\d+\.\d+\.\d+:)?(\d{2,5}):\d{2,5}(?:\/tcp)?["'\s]/);
    return m ? Number(m[1]) : null;
  }
  return null;
}
function composeText(dir) {
  for (const f of COMPOSE_FILES) { const p = path.join(dir, f); if (exists(p)) return fs.readFileSync(p, 'utf8'); }
  return '';
}
// Caddyfile lezen: welke domeinen sturen door naar welke container/poort?
function parseCaddyfile() {
  if (!CFG.caddyfileHost || !exists(CFG.caddyfileHost)) return [];
  const out = []; let depth = 0, cur = null;
  let inPanel = false;
  for (const raw of fs.readFileSync(CFG.caddyfileHost, 'utf8').split('\n')) {
    if (raw.startsWith(INLINE_START)) { inPanel = true; continue; }
    if (raw.startsWith(INLINE_END)) { inPanel = false; continue; }
    if (inPanel) continue;
    const line = raw.replace(/#.*/, '').trim(); if (!line) continue;
    if (depth === 0 && line.endsWith('{') && !line.startsWith('(') && line !== '{') {
      const domains = line.slice(0, -1).split(/[\s,]+/).map((d) => d.replace(/^https?:\/\//, '').replace(/:\d+$/, '').toLowerCase()).filter((d) => DOMAIN_RE.test(d));
      cur = domains.length ? { domains, upstreams: [], roots: [] } : null; if (cur) out.push(cur);
    } else if (cur && depth >= 1) {
      const m = line.match(/^reverse_proxy\s+(.+)/);
      if (m) for (const u of m[1].split(/\s+/)) if (!u.startsWith('{')) cur.upstreams.push(u.replace(/^https?:\/\//, ''));
      const r = line.match(/^root\s+(?:\*\s+)?(\/\S+)/); if (r) cur.roots.push(r[1].replace(/\/+$/, ''));
    }
    depth += (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
    if (depth <= 0) { depth = 0; cur = null; }
  }
  return out;
}
function composeServiceNames(txt) {
  const out = []; let inServices = false, level = null;
  for (const raw of txt.replace(/\t/g, '  ').split('\n')) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const indent = raw.length - raw.trimStart().length;
    if (indent === 0) { inServices = /^services\s*:/.test(raw); level = null; continue; }
    if (!inServices) continue;
    if (level === null) level = indent;
    const m = indent === level && raw.trim().match(/^["']?([\w.-]+)["']?\s*:/);
    if (m) out.push(m[1].toLowerCase());
  }
  return out;
}
// Staat dit domein al in je eigen Caddyfile? En wijst het dan naar deze site?
function caddyfileDomainInfo(domain, site) {
  const blocks = parseCaddyfile();
  const b = blocks.find((x) => x.domains.includes(domain));
  if (!b) return { exists: false };
  const pointsHere = (site.type === 'container' ? findDomainContainer({ name: site.container, hostPorts: [site.port].filter(Boolean) }, [b]) : findDomain(site.path, site.port, [b])) === domain;
  return { exists: true, pointsHere, target: [...b.upstreams, ...(b.roots || [])].join(', ') };
}
function findDomainContainer(c, blocks) {
  const names = new Set([c.name.toLowerCase(), ...(c.aliases || [])]);
  const ports = new Set((c.hostPorts || []).map(String));
  for (const b of blocks) for (const u of b.upstreams) {
    const [h, pt] = u.split(':');
    if (names.has(h.toLowerCase())) return b.domains[0];
    if (['localhost', '127.0.0.1', 'host.docker.internal', '172.17.0.1', CFG.upstreamHost, CFG.hostLanIp].includes(h) && ports.has(pt)) return b.domains[0];
  }
  return '';
}
function hostPortsOf(portsText) { return [...String(portsText || '').matchAll(/:(\d+)->/g)].map((m) => Number(m[1])).filter((v, i, a) => a.indexOf(v) === i); }
const SKIP_CONTAINERS = /^(serverpaneel|serverpaneel-updater)$/;
function isInfraImage(img) { return /(^|\/)(caddy|duckdns|watchtower)(:|$)|linuxserver\/duckdns/i.test(img); }
function findDomain(dir, port, blocks) {
  const clean = path.resolve(dir);
  for (const b of blocks) for (const r of b.roots || []) if (path.resolve(r) === clean || inside(clean, r)) return b.domains[0];
  const txt = composeText(dir);
  if (!txt) return '';
  const names = new Set([path.basename(dir).toLowerCase()]);
  for (const m of txt.matchAll(/container_name:\s*["']?([\w.-]+)/g)) names.add(m[1].toLowerCase());
  for (const n of composeServiceNames(txt)) names.add(n);
  for (const m of txt.matchAll(/hostname:\s*["']?([\w.-]+)/g)) names.add(m[1].toLowerCase());
  for (const m of txt.matchAll(/aliases:\s*\n((?:\s+-\s*[\w.-]+\s*\n?)+)/g)) for (const a of m[1].matchAll(/-\s*([\w.-]+)/g)) names.add(a[1].toLowerCase());
  const ports = new Set([...txt.matchAll(/(?:\d+\.\d+\.\d+\.\d+:)?(\d{2,5}):\d{2,5}/g)].map((m) => m[1]));
  if (port) ports.add(String(port));
  for (const b of blocks) for (const u of b.upstreams) {
    const [h, pt] = u.split(':');
    if (names.has(h.toLowerCase())) return b.domains[0];
    if (['localhost', '127.0.0.1', 'host.docker.internal', '172.17.0.1', CFG.upstreamHost, CFG.hostLanIp].includes(h) && ports.has(pt)) return b.domains[0];
  }
  return '';
}
// "systeem" = een map met ENKEL hulpprogramma's (Caddy, DuckDNS, …), geen eigen app
function isInfraDir(dir) {
  const txt = composeText(dir); if (/^\s*build\s*:/m.test(txt)) return false;
  const images = [...txt.matchAll(/image:\s*["']?([^\s"']+)/g)].map((m) => m[1]);
  return images.length > 0 && images.every((i) => /(caddy|duckdns|nextcloud|portainer|watchtower|opencloud|seafile)/i.test(i));
}
function isPanelDir(dir) {
  if (CFG.panelDir && path.resolve(dir) === path.resolve(CFG.panelDir)) return true;
  return COMPOSE_FILES.some((f) => { const p = path.join(dir, f); return exists(p) && /container_name:\s*serverpaneel\b/.test(fs.readFileSync(p, 'utf8')); });
}
app.get('/api/discover', wrap(async (req, res) => {
  const found = []; const known = new Set(sites.map((s) => path.resolve(s.path)));
  const blocks = parseCaddyfile();
  const skip = /^(\.|node_modules$|snap$|Downloads$|Documents$|Music$|Pictures$|Videos$)/;
  const scan = async (dir, depth) => {
    let entries; try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory() || skip.test(e.name)) continue;
      const p = path.join(dir, e.name);
      if (known.has(path.resolve(p)) || path.resolve(p) === path.resolve(CFG.backupRoot)) continue;
      if (hasCompose(p)) {
        if (isPanelDir(p)) { found.unshift({ path: p, name: 'serverpaneel', type: 'docker', port: CFG.hostPort, domain: CFG.panelDomain, self: true }); continue; }
        { const port = composePort(p); found.push({ path: p, name: e.name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40), type: 'docker', port, domain: findDomain(p, port, blocks), infra: isInfraDir(p) }); }
        continue;
      }
      if (exists(path.join(p, 'index.html'))) { found.push({ path: p, name: e.name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40), type: 'static', port: null, domain: findDomain(p, null, blocks) }); continue; }
      if (depth < 2) await scan(p, depth + 1);
    }
  };
  for (const r of CFG.extraRoots) {
    if (known.has(path.resolve(r))) continue;
    const nm = path.basename(r).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    if (hasCompose(r)) found.push({ path: r, name: nm, type: 'docker', port: composePort(r), domain: findDomain(r, composePort(r), blocks), infra: isInfraDir(r) });
    else if (exists(path.join(r, 'index.html'))) found.push({ path: r, name: nm, type: 'static', port: null, domain: findDomain(r, null, blocks) });
  }
  for (const r of [CFG.allowedRoot, ...CFG.extraRoots]) await scan(r, 1);
  // losse containers die niet bij een map/compose-project horen
  try {
    const known = new Set(sites.filter((x) => x.type === 'container').map((x) => x.container));
    const r = await run('docker', ['ps', '-a', '--format', '{{json .}}'], { quiet: true });
    for (const c of parseComposePs(r.out)) {
      const labels = String(c.Labels || '');
      if (/com\.docker\.compose\.project=/.test(labels) || SKIP_CONTAINERS.test(c.Names) || known.has(c.Names)) continue;
      const ports = hostPortsOf(c.Ports);
      found.push({ container: c.Names, path: '', name: c.Names.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40), type: 'container', port: ports[0] || null, image: c.Image, domain: findDomainContainer({ name: c.Names, hostPorts: ports }, blocks), infra: isInfraImage(c.Image) });
    }
  } catch { /* docker niet bereikbaar */ }
  found.sort((a, b) => (!!b.self - !!a.self) || (a.infra - b.infra) || (!!b.domain - !!a.domain));
  res.json(found.slice(0, 50));
}));

app.get('/api/containers', wrap(async (req, res) => {
  const [r, st] = await Promise.all([run('docker', ['ps', '-a', '--format', '{{json .}}']), dockerStats()]);
  res.json(parseComposePs(r.out).map((c) => ({ name: c.Names, image: c.Image, state: c.State, status: c.Status, ports: c.Ports, stats: st[c.Names] || null })));
}));
// indeling van de server-pagina (widgets), bewaard op de server zodat ze op elk toestel hetzelfde is
const LAYOUT_FILE = path.join(CFG.dataDir, 'layout.json');
app.get('/api/layout', (req, res) => res.json(readJson(LAYOUT_FILE, null)));
app.put('/api/layout', wrap(async (req, res) => {
  const list = Array.isArray(req.body) ? req.body : null;
  if (!list || list.length > 60) throw bad('Ongeldige indeling');
  const clean = list.filter((w) => w && /^[a-z0-9-]{1,30}$/.test(w.id)).map((w) => ({ id: w.id, size: [1, 2, 4].includes(Number(w.size)) ? Number(w.size) : 2, hidden: !!w.hidden }));
  writeJson(LAYOUT_FILE, clean); res.json({ ok: true });
}));
app.delete('/api/layout', (req, res) => { fs.rmSync(LAYOUT_FILE, { force: true }); res.json({ ok: true }); });

// ---------------------------------------------------------------- AUTOMATISCH OPSTARTEN
// Na een stroomonderbreking start Docker enkel containers met een herstartregel opnieuw.
// Het paneel zorgt dat elke container van je sites "unless-stopped" heeft (= altijd terug aan, tenzij jij hem zelf stopte).
const autostart = new Map(); // site -> { ok, containers: [{name, policy}] }
async function containersOfSite(site) {
  if (site.type === 'container') return [site.container];
  if (site.type !== 'docker' || !site.path) return [];
  const r = await run('docker', ['ps', '-a', '--filter', `label=com.docker.compose.project.working_dir=${site.path}`, '--format', '{{.Names}}'], { quiet: true });
  return r.code === 0 ? r.out.split('\n').map((x) => x.trim()).filter(Boolean) : [];
}
async function ensureAutostart(site, job) {
  const names = await containersOfSite(site);
  if (!names.length) { autostart.delete(site.name); return null; }
  const r = await run('docker', ['inspect', '-f', '{{.Name}}|{{.HostConfig.RestartPolicy.Name}}|{{.State.Status}}', ...names], { quiet: true });
  const list = r.out.split('\n').filter((l) => l.includes('|')).map((l) => { const [n, pol, st] = l.split('|'); return { name: n.replace(/^\//, ''), policy: pol, state: st }; });
  // gestopte containers laten we met rust (die heb je bewust gestopt); draaiende zonder regel krijgen er een
  const fix = list.filter((c) => (c.policy === 'no' || c.policy === '') && c.state === 'running').map((c) => c.name);
  if (fix.length) {
    const u = await run('docker', ['update', '--restart', 'unless-stopped', ...fix], { quiet: true });
    if (u.code === 0) { for (const c of list) if (fix.includes(c.name)) c.policy = 'unless-stopped'; if (job) job.log += `  automatisch opstarten ingesteld voor: ${fix.join(', ')}\n`; console.log(`Automatisch opstarten ingesteld voor ${fix.join(', ')}`); }
  }
  const ok = list.length > 0 && list.every((c) => c.policy !== 'no' && c.policy !== '');
  autostart.set(site.name, { ok, containers: list.map(({ name, policy }) => ({ name, policy })) });
  return autostart.get(site.name);
}
let autoT = null;
function ensureAutostartAll() { clearTimeout(autoT); autoT = setTimeout(async () => { if (DEMO) return; for (const site of sites) { try { await ensureAutostart(site); } catch { /* */ } } }, 1500); }
function dockerStartsAtBoot() {
  const hr = env('HOST_ROOT', '/hostfs');
  const base = fs.existsSync(path.join(hr, 'etc')) ? hr : '/';
  const want = ['etc/systemd/system/multi-user.target.wants/docker.service', 'etc/systemd/system/sockets.target.wants/docker.socket'];
  if (!fs.existsSync(path.join(base, 'etc/systemd/system'))) return null; // onbekend (bv. demo op Windows)
  // Dit zijn symlinks met een absoluut doel (/usr/lib/systemd/...). In de container wijst dat doel
  // niet naar de host, dus existsSync (dat de link volgt) zegt ten onrechte "nee".
  // Daarom kijken we alleen of de link zelf bestaat.
  const linkExists = (p) => { try { fs.lstatSync(p); return true; } catch { return false; } };
  return want.some((w) => linkExists(path.join(base, w)));
}

// ---------------------------------------------------------------- LIVE (Server-Sent Events)
// Eén open verbinding per browser. De server duwt zelf nieuwe gegevens door:
//   stats      -> elke seconde (processor, temperatuur, geheugen, netwerk, schijven)
//   containers -> zodra Docker nieuwe cijfers heeft (±1-2 s)
//   sites      -> meteen als er een container start/stopt of een actie klaar is
const liveClients = new Set();
function broadcast(event, data) {
  if (!liveClients.size) return;
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of liveClients) { try { res.write(msg); } catch { /* */ } }
}
let sitesT = null;
function notifySites() { clearTimeout(sitesT); sitesT = setTimeout(() => broadcast('sites', { t: Date.now() }), 300); ensureAutostartAll(); }
function statsFromJson(c) { return { cpu: parseFloat(c.CPUPerc) || 0, mem: c.MemUsage, memPct: parseFloat(c.MemPerc) || 0, net: c.NetIO, block: c.BlockIO }; }
const live = { unsub: null, statsProc: null, eventsProc: null, demoTimer: null, restartT: null };
function startDockerStreams() {
  if (!liveClients.size) return;
  if (!live.statsProc) {
    // "docker stats" zonder --no-stream blijft draaien en geeft continu nieuwe cijfers
    const p = spawn('docker', ['stats', '--format', '{{json .}}']); live.statsProc = p;
    let buf = '', frame = {}, lastSend = 0;
    p.stdout.on('data', (d) => {
      buf += d.toString().replace(/\x1b\[[0-9;]*[A-Za-z]/g, '\n');
      const lines = buf.split('\n'); buf = lines.pop();
      for (const l of lines) { const i = l.indexOf('{'); if (i < 0) continue; try { const c = JSON.parse(l.slice(i)); frame[c.Name] = statsFromJson(c); } catch { /* */ } }
      if (Object.keys(frame).length && Date.now() - lastSend > 900) {
        dockerStatsCache = { t: Date.now(), data: { ...frame } }; broadcast('containers', dockerStatsCache.data); lastSend = Date.now();
      }
    });
    p.on('error', () => {}); p.stderr.on('data', () => {});
    p.on('close', () => { if (live.statsProc === p) live.statsProc = null; scheduleRestart(); });
  }
  if (!live.eventsProc) {
    const p = spawn('docker', ['events', '--format', '{{json .}}', '--filter', 'type=container']); live.eventsProc = p;
    p.stdout.on('data', (d) => { if (/"(?:status|Action)":"(?:start|stop|die|restart|create|destroy|pause|unpause|kill|health_status[^"]*)"/.test(String(d))) notifySites(); });
    p.on('error', () => {}); p.stderr.on('data', () => {});
    p.on('close', () => { if (live.eventsProc === p) live.eventsProc = null; scheduleRestart(); });
  }
}
function scheduleRestart() { clearTimeout(live.restartT); if (liveClients.size) live.restartT = setTimeout(startDockerStreams, 5000); }
function startLive() {
  live.unsub = metrics.subscribe((p) => broadcast('stats', p));
  if (DEMO) { live.demoTimer = setInterval(() => { const data = {}; for (const c of parseComposePs(fakeDocker(['stats']))) data[c.Name] = statsFromJson(c); dockerStatsCache = { t: Date.now(), data }; broadcast('containers', data); }, 1500); return; }
  startDockerStreams();
}
function stopLive() {
  if (live.unsub) live.unsub(); live.unsub = null;
  clearInterval(live.demoTimer); clearTimeout(live.restartT);
  for (const k of ['statsProc', 'eventsProc']) { if (live[k]) { const p = live[k]; live[k] = null; try { p.kill(); } catch { /* */ } } }
}
app.get('/api/live', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 2000\n\n');
  res.write(`event: stats\ndata: ${JSON.stringify(metrics.live())}\n\n`);
  if (dockerStatsCache.data && Object.keys(dockerStatsCache.data).length) res.write(`event: containers\ndata: ${JSON.stringify(dockerStatsCache.data)}\n\n`);
  liveClients.add(res);
  if (liveClients.size === 1) startLive();
  const hb = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => { clearInterval(hb); liveClients.delete(res); if (!liveClients.size) stopLive(); });
});

app.get('/api/stats', wrap(async (req, res) => {
  const range = ['15m', '1h', '24h', 'now'].includes(req.query.range) ? req.query.range : '1h';
  res.json({ ...metrics.snapshot(range), name: CFG.hostName, lanIp: CFG.hostLanIp, publicIp: range === 'now' ? undefined : await publicIp() });
}));
app.get('/api/jobs/:id', (req, res) => {
  const j = jobs.get(req.params.id); if (!j) return res.status(404).json({ error: 'Onbekende taak' });
  res.json(j);
});

// ---- sites
const upload = multer({ dest: path.join(CFG.dataDir, 'tmp'), limits: { fileSize: 2 * 1024 ** 3, files: 50000, fields: 20, fieldSize: 20 * 1024 * 1024 } });

function validateSettings(b, site) {
  const out = {};
  if (b.type !== undefined) { if (!['static', 'docker', 'auto'].includes(b.type)) throw bad('Onbekend type'); out.type = b.type; }
  if (b.domain !== undefined) {
    const d = String(b.domain).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (d && !DOMAIN_RE.test(d)) throw bad('Ongeldig domein (bv. mijnsite.duckdns.org)');
    if (d && sites.some((s) => s.domain === d && (!site || s.name !== site.name))) throw bad('Dat domein wordt al door een andere site gebruikt');
    if (d && CFG.panelDomain && d === CFG.panelDomain.toLowerCase()) throw bad('Dat is het domein van het paneel zelf');
    out.domain = d;
  }
  if (b.port !== undefined && b.port !== '') {
    const p = Number(b.port); if (!Number.isInteger(p) || p < 1 || p > 65535 || p === CFG.hostPort) throw bad('Ongeldige poort'); out.port = p;
  } else if (b.port === '') out.port = null;
  if (b.keep !== undefined) {
    const arr = Array.isArray(b.keep) ? b.keep : String(b.keep).split(/[,\n]/);
    out.keep = arr.map((k) => safeRel(String(k).trim())).filter(Boolean).slice(0, 30);
  }
  if (b.spa !== undefined) { out.spa = b.spa === true || b.spa === '1' || b.spa === 'true'; if (site && out.spa !== !!site.spa) out.spaManual = true; }
  return out;
}

// nieuwe site maken met upload
app.post('/api/sites', upload.any(), wrap(async (req, res) => {
  const name = String(req.body.name || '').trim().toLowerCase();
  if (!NAME_RE.test(name)) { await cleanupUploads(req); throw bad('Naam: enkel kleine letters, cijfers en -, max 40 tekens'); }
  if (getSite(name)) { await cleanupUploads(req); throw bad('Er bestaat al een site met die naam', 409); }
  let settings;
  try { settings = validateSettings(req.body); } catch (e) { await cleanupUploads(req); throw e; }
  const target = path.join(CFG.sitesRoot, name);
  if (exists(target) && fs.readdirSync(target).length) { await cleanupUploads(req); throw bad(`Map ${target} bestaat al. Gebruik "Bestaande map toevoegen".`, 409); }
  const site = { name, path: target, type: 'static', domain: '', port: null, keep: [], spa: false, managed: true, createdAt: Date.now(), updatedAt: Date.now(), ...settings };
  const job = startJob(name, 'nieuw', async (job, say) => {
    let st;
    try {
      st = await buildStage(req, job, say);
      if (site.type === 'auto' || !site.type) site.type = hasCompose(st.stage) ? 'docker' : 'static';
      if (site.type === 'docker') say('Herkend: deze site draait in Docker');
      else {
        const prep = await Build.prepare(st.stage, { job, say, run, buildRoot: CFG.buildRoot, siteName: name });
        if (!prep.built && !prep.framework) say('Herkend: gewone website');
        st.stage = prep.dir; if (prep.framework) site.framework = prep.framework; if (prep.spa && !site.spaManual) site.spa = true;
      }
      if (site.type === 'docker' && site.domain && !site.port) throw new Error('Ik vond geen poort in je docker-compose.yml. Vul de poort in bij Geavanceerd.');
      await syncInto(st.stage, site, job, say);
      sites.push(site); saveSites();
      await afterDeploy(site, job, say);
      await applyCaddy(site, job, say);
    } finally {
      if (st) await fsp.rm(st.stageBase, { recursive: true, force: true });
      await cleanupUploads(req);
    }
  });
  res.json({ job: job.id });
}));

// bestaande map op de server toevoegen (bv. ~/vakantie-planner)
app.post('/api/sites/import', wrap(async (req, res) => {
  const name = String(req.body.name || '').trim().toLowerCase();
  if (!NAME_RE.test(name)) throw bad('Naam: enkel kleine letters, cijfers en -, max 40 tekens');
  if (getSite(name)) throw bad('Er bestaat al een site met die naam', 409);
  if (req.body.container) {
    const cname = String(req.body.container);
    if (!/^[\w.-]{1,128}$/.test(cname)) throw bad('Ongeldige containernaam');
    const r = await run('docker', ['inspect', '-f', '{{json .NetworkSettings.Ports}}', cname], { quiet: true });
    if (r.code !== 0) throw bad('Die container bestaat niet (meer)');
    if (sites.some((x) => x.container === cname)) throw bad('Die container is al toegevoegd');
    let ports = []; try { ports = Object.values(JSON.parse(r.out) || {}).flat().filter(Boolean).map((b) => Number(b.HostPort)).filter(Boolean); } catch { /* */ }
    ports = [...new Set(ports)];
    const site = { name, path: '', type: 'container', container: cname, domain: '', port: ports[0] || null, keep: [], spa: false, managed: false, createdAt: Date.now(), updatedAt: Date.now() };
    const d = findDomainContainer({ name: cname, hostPorts: ports }, parseCaddyfile());
    if (d && !sites.some((x) => x.domain === d)) { site.domain = d; site.domainExternal = true; }
    sites.push(site); saveSites();
    const job = startJob(name, 'toevoegen', async (job, say) => {
      say(`${name} toegevoegd (losse container "${cname}")`);
      if (site.domainExternal) say(`Online op https://${site.domain} (uit je eigen Caddyfile, blijft zoals het is)`);
    });
    return res.json({ job: job.id });
  }
  const p = path.resolve(String(req.body.path || ''));
  const roots = [CFG.allowedRoot, ...CFG.extraRoots];
  const okHome = inside(CFG.allowedRoot, p) && p !== path.resolve(CFG.allowedRoot);
  const okExtra = CFG.extraRoots.some((r) => inside(r, p)); // een extra map (bv. /var/www/portfolio) mag ook zelf
  if (!okHome && !okExtra) throw bad(`Map moet binnen ${roots.join(' of ')} liggen`);
  if (isPanelDir(p)) delete req.body.port; // het paneel zelf: poort komt uit de installatie
  if (!exists(p) || !fs.statSync(p).isDirectory()) throw bad('Die map bestaat niet op de server');
  if (sites.some((s) => path.resolve(s.path) === p)) throw bad('Die map is al toegevoegd');
  const settings = validateSettings(req.body);
  const site = { name, path: p, type: 'static', domain: '', port: null, keep: [], spa: false, managed: false, createdAt: Date.now(), updatedAt: Date.now(), ...settings };
  if (site.type === 'auto') site.type = hasCompose(p) ? 'docker' : 'static';
  if (isPanelDir(p)) { Object.assign(site, { self: true, type: 'docker', port: CFG.hostPort, domain: CFG.panelDomain || '', domainExternal: !!CFG.panelDomain }); }
  if (!site.domain) {
    const d = findDomain(p, site.port, parseCaddyfile());
    if (d && !sites.some((x) => x.domain === d)) { site.domain = d; site.domainExternal = true; }
  }
  sites.push(site); saveSites();
  const job = startJob(name, 'toevoegen', async (job, say) => {
    say(`${name} toegevoegd (${site.type === 'docker' ? 'draait in Docker' : 'website'})`);
    if (site.domainExternal) say(`Online op https://${site.domain} (uit je eigen Caddyfile, blijft zoals het is)`);
    await applyCaddy(site, job, say);
  });
  res.json({ job: job.id });
}));

// update: nieuwe versie uploaden
// Het paneel kan zichzelf niet herstarten terwijl het werkt. Daarom start het een klein hulpje (met hetzelfde image)
// dat het paneel opnieuw bouwt, nakijkt of het goed opstart, en anders de vorige versie terugzet.
async function selfImage() {
  const r = await run('docker', ['inspect', '-f', '{{.Config.Image}}', 'serverpaneel'], { quiet: true });
  return r.code === 0 && r.out.trim() ? r.out.trim() : 'serverpaneel:latest';
}
async function selfRebuild(site, job, say, backupDir) {
  const dir = site.path, img = await selfImage();
  const ex = keepList(site).map((k) => `--exclude=/${k}`).join(' ');
  const script = [
    'sleep 3',
    'echo "$(date) update gestart" > data/laatste-update.log',
    'docker compose up -d --build --remove-orphans >> data/laatste-update.log 2>&1',
    'ok=0; for i in $(seq 1 90); do sleep 2; if docker exec serverpaneel wget -qO- http://127.0.0.1:3000/api/version >/dev/null 2>&1; then ok=1; break; fi; done',
    'if [ $ok = 1 ]; then echo "$(date) OK: nieuwe versie draait" >> data/laatste-update.log; exit 0; fi',
    'echo "$(date) FOUT: nieuwe versie start niet, vorige versie wordt teruggezet" >> data/laatste-update.log',
    backupDir ? `rsync -a --delete ${ex} "${backupDir}/" "${dir}/" && docker compose up -d --build >> data/laatste-update.log 2>&1` : 'true',
  ].join('\n');
  await run('docker', ['rm', '-f', 'serverpaneel-updater'], { quiet: true });
  const mounts = ['-v', '/var/run/docker.sock:/var/run/docker.sock', '-v', `${dir}:${dir}`];
  if (backupDir) mounts.push('-v', `${backupDir}:${backupDir}:ro`);
  const r = await run('docker', ['run', '-d', '--rm', '--name', 'serverpaneel-updater', ...mounts, '-w', dir, '--entrypoint', 'sh', img, '-c', script], { job, quiet: true });
  if (r.code !== 0) { job.log += r.out; throw new Error('Kon de update van het paneel niet starten'); }
  say('Het paneel bouwt zichzelf nu opnieuw en herstart (1 à 2 minuten). Deze pagina laadt daarna vanzelf de nieuwe versie.');
  job.selfRestart = true;
}

app.post('/api/sites/:name/deploy', upload.any(), wrap(async (req, res) => {
  const site = getSite(req.params.name);
  if (!site) { await cleanupUploads(req); throw bad('Onbekende site', 404); }
  if (site.type === 'container') { await cleanupUploads(req); throw bad('Dit is een losse container zonder map: bijwerken met bestanden kan hier niet. Herstarten en logs kan wel.'); }
  let job;
  try {
    job = startJob(site.name, 'update', async (job, say) => {
      let st;
      try {
        st = await buildStage(req, job, say);
        if (site.type === 'docker' && !hasCompose(st.stage)) job.log += '  let op: geen docker-compose.yml in de upload, de bestaande blijft gebruikt\n';
        if (site.self && !hasCompose(st.stage)) throw new Error('Dit lijkt geen serverpaneel-map (geen docker-compose.yml). Kies de map "serverpaneel".');
        if (site.self && !exists(path.join(st.stage, 'app', 'server.js'))) throw new Error('Dit lijkt geen serverpaneel-map (geen app/server.js). Kies de map "serverpaneel".');
        if (site.type === 'static') {
          const prep = await Build.prepare(st.stage, { job, say, run, buildRoot: CFG.buildRoot, siteName: site.name });
          st.stage = prep.dir; if (prep.framework) site.framework = prep.framework; if (prep.spa && !site.spaManual) site.spa = true;
        }
        const fileSite = filesTarget(site);
        const bk = await makeBackup(fileSite, job, say);
        await syncInto(st.stage, fileSite, job, say);
        site.updatedAt = Date.now(); saveSites(); staticServers.clear();
        if (fileSite !== site) say('Onderhoudsmodus staat aan: de nieuwe versie komt online zodra je hem uitzet');
        if (site.self) await selfRebuild(site, job, say, bk); else await afterDeploy(site, job, say);
      } finally {
        if (st) await fsp.rm(st.stageBase, { recursive: true, force: true });
        await cleanupUploads(req);
      }
    });
  } catch (e) { await cleanupUploads(req); throw e; }
  res.json({ job: job.id });
}));

// git pull (als de site een git-repo is)
app.post('/api/sites/:name/pull', wrap(async (req, res) => {
  const site = getSite(req.params.name); if (!site) throw bad('Onbekende site', 404);
  if (!exists(path.join(site.path, '.git'))) throw bad('Deze map is geen git-repo');
  const job = startJob(site.name, 'git pull', async (job, say) => {
    await makeBackup(site, job, say);
    say('git pull');
    await mustRun('git', ['-c', `safe.directory=${site.path}`, 'pull', '--ff-only'], { cwd: site.path, job });
    await afterDeploy(site, job, say);
    site.updatedAt = Date.now(); saveSites();
  });
  res.json({ job: job.id });
}));

app.patch('/api/sites/:name', wrap(async (req, res) => {
  const site = getSite(req.params.name); if (!site) throw bad('Onbekende site', 404);
  const s = validateSettings(req.body, site);
  if (site.domainExternal && s.domain !== undefined && s.domain !== site.domain) throw bad('Dit domein staat in je eigen Caddyfile. Pas het daar aan.');
  if (site.domainExternal) delete s.domain;
  if (s.domain) {
    const info = caddyfileDomainInfo(s.domain, { ...site, ...s });
    if (info.exists && !info.pointsHere) throw bad(`${s.domain} staat al in je eigen Caddyfile en wijst naar ${info.target || 'een andere site'}. Kies een ander domein of pas je Caddyfile aan.`);
    if (info.exists && info.pointsHere) {
      // domein bestaat al en wijst naar deze site: enkel koppelen, niets aan Caddy veranderen
      const job = startJob(site.name, 'instellingen', async (job, say) => {
        Object.assign(site, s, { domainExternal: true }); site.updatedAt = Date.now(); saveSites(); staticServers.clear();
        say(`${s.domain} staat al in je Caddyfile en wijst naar deze site: gekoppeld`);
      });
      return res.json({ job: job.id });
    }
  }
  if (s.type === 'auto') s.type = hasCompose(site.path) ? 'docker' : 'static';
  if (site.type === 'container') delete s.type;
  const next = { ...site, ...s };
  if ((next.type === 'docker' || next.type === 'container') && next.domain && !next.domainExternal && !next.port) throw bad('Vul de poort in.');
  const job = startJob(site.name, 'instellingen', async (job, say) => {
    await applyCaddy(next, job, say);
    Object.assign(site, s); site.updatedAt = Date.now(); saveSites(); staticServers.clear();
    say('Instellingen opgeslagen');
  });
  res.json({ job: job.id });
}));

app.get('/api/sites/:name/backups', wrap(async (req, res) => {
  const site = getSite(req.params.name); if (!site) throw bad('Onbekende site', 404);
  if (site.type === 'container') return res.json([]);
  res.json(await listBackups(site));
}));
app.post('/api/sites/:name/rollback', wrap(async (req, res) => {
  const site = getSite(req.params.name); if (!site) throw bad('Onbekende site', 404);
  const list = await listBackups(site);
  const id = req.body.backup || (list[0] && list[0].id);
  if (!id || !list.some((b) => b.id === id)) throw bad('Geen backup gevonden');
  const job = startJob(site.name, 'terugzetten', async (job, say) => {
    const src = path.join(CFG.backupRoot, site.name, id);
    const fileSite = filesTarget(site);
    const safety = await makeBackup(fileSite, job, say, id); // huidige versie ook bewaren
    say(`Versie van ${id} terugzetten`);
    await syncInto(src, fileSite, job, say);
    staticServers.clear();
    if (safety && path.basename(safety) !== id) job.log += `  (de versie van voor het terugzetten staat in backup ${path.basename(safety)})\n`;
    site.updatedAt = Date.now(); saveSites();
    if (site.self) await selfRebuild(site, job, say, safety); else await afterDeploy(site, job, say);
  });
  res.json({ job: job.id });
}));

for (const [action, args, label] of [['restart', ['restart'], 'herstarten'], ['stop', ['stop'], 'stoppen'], ['start', ['up', '-d'], 'starten'], ['rebuild', ['up', '-d', '--build', '--force-recreate', '--remove-orphans'], 'opnieuw bouwen']]) {
  app.post(`/api/sites/:name/${action}`, wrap(async (req, res) => {
    const site = getSite(req.params.name); if (!site) throw bad('Onbekende site', 404);
    if (site.type !== 'docker' && site.type !== 'container') throw bad('Dit kan enkel bij sites die in Docker draaien');
    if (site.self && (action === 'stop' || action === 'start')) throw bad('Het paneel kan zichzelf niet stoppen: dan kan je er niet meer in.');
    if (site.type === 'container') {
      const cmd = { restart: 'restart', stop: 'stop', start: 'start', rebuild: 'restart' }[action];
      const job = startJob(site.name, label, async (job, say) => {
        say(`Container ${site.container} ${label}`);
        const r = await run('docker', [cmd, site.container], { job });
        if (r.code !== 0) throw new Error(`${label} mislukt`);
      });
      return res.json({ job: job.id });
    }
    if (site.self) { const job = startJob(site.name, label, async (job, say) => selfRebuild(site, job, say, null)); return res.json({ job: job.id }); }
    const job = startJob(site.name, label, async (job, say) => {
      say(`Containers ${label}`);
      const r = await compose(site, args, job);
      if (r.code !== 0) throw new Error(`${label} mislukt`);
    });
    res.json({ job: job.id });
  }));
}

app.get('/api/sites/:name/logs', wrap(async (req, res) => {
  const site = getSite(req.params.name); if (!site) throw bad('Onbekende site', 404);
  if (site.type === 'container') { const r = await run('docker', ['logs', '--tail', '300', '--timestamps', site.container]); return res.json({ logs: r.out || '(leeg)' }); }
  if (site.type !== 'docker') return res.json({ logs: 'Statische sites hebben geen logs.' });
  const r = await compose(site, ['logs', '--no-color', '--tail', '300', '--timestamps']);
  res.json({ logs: r.out || '(leeg)' });
}));

app.delete('/api/sites/:name', wrap(async (req, res) => {
  const site = getSite(req.params.name); if (!site) throw bad('Onbekende site', 404);
  const removeFiles = req.query.files === '1';
  if (removeFiles && site.self) throw bad('Het paneel zelf kan je niet offline halen vanuit het paneel.');
  if (removeFiles && !site.managed) throw bad('Bestanden van een toegevoegde (bestaande) map worden niet verwijderd. Verwijder zonder "bestanden" aan te vinken.');
  const job = startJob(site.name, 'verwijderen', async (job, say) => {
    if (site.type === 'docker' && removeFiles) { say('Containers stoppen en verwijderen'); await compose(site, ['down', '--remove-orphans'], job); }
    await applyCaddy({ ...site, domain: '' }, job, say);
    if (removeFiles && exists(site.path)) {
      const trash = path.join(CFG.backupRoot, '_verwijderd', `${site.name}-${stamp()}`);
      say(`Bestanden verplaatsen naar ${trash} (kan je later zelf wissen)`);
      await fsp.mkdir(path.dirname(trash), { recursive: true });
      try { await fsp.rename(site.path, trash); } catch { await fsp.cp(site.path, trash, { recursive: true }); await fsp.rm(site.path, { recursive: true, force: true }); }
    }
    sites = sites.filter((s) => s.name !== site.name); saveSites();
    say(`Site ${site.name} verwijderd uit het paneel`);
  });
  res.json({ job: job.id });
}));

// ---------------------------------------------------------------- ONDERHOUDSMODUS, DOMEIN-CHECK, LIVE LOGS
// Bij een statische site die ergens anders vandaan komt (bv. Caddy met "root"), worden de bestanden even aan de kant gezet.
function filesTarget(site) { return site.maintenance && site.maintenance.mode === 'swap' ? { ...site, path: site.maintenance.stash } : site; }
function maintenancePage(name) {
  const n = String(name).replace(/[<>&"]/g, '');
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="60"><title>Even bezig</title><meta name="robots" content="noindex">
<style>:root{color-scheme:light dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;background:#F3F5FB;color:#0D1326;padding:24px}
@media (prefers-color-scheme:dark){body{background:#080C18;color:#E9ECF7}.c{background:#10172C!important;border-color:rgba(150,165,220,.14)!important}p{color:#8C94B4!important}}
.c{max-width:440px;width:100%;background:#fff;border:1px solid #E4E8F2;border-radius:24px;padding:36px 28px;text-align:center;box-shadow:0 20px 50px -24px rgba(16,24,64,.35)}
.i{width:64px;height:64px;margin:0 auto 18px;border-radius:20px;background:linear-gradient(135deg,#6366F1,#38BDF8);display:grid;place-items:center}
.i svg{width:30px;height:30px;stroke:#fff;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
h1{font-size:22px;margin:0 0 8px;letter-spacing:-.02em}p{margin:0;color:#5A6382}.d{display:flex;gap:6px;justify-content:center;margin-top:22px}.d i{width:8px;height:8px;border-radius:50%;background:#6366F1;opacity:.35;animation:b 1.2s infinite}.d i:nth-child(2){animation-delay:.2s}.d i:nth-child(3){animation-delay:.4s}
@keyframes b{50%{opacity:1}}</style></head><body><main class="c"><div class="i"><svg viewBox="0 0 24 24"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg></div>
<h1>Even bezig</h1><p>${n} wordt bijgewerkt en is zo terug. Probeer het over een paar minuten opnieuw.</p><div class="d"><i></i><i></i><i></i></div></main></body></html>`;
}
// bezoekers van statische sites die het paneel zelf toont (voor de live logs)
const accessLogs = new Map(); const accessSubs = new Map();
function logAccess(name, req, status, ms) {
  const ua = String(req.headers['user-agent'] || '');
  const browser = /bot|crawl|spider|curl|wget|python/i.test(ua) ? 'bot' : /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Firefox\//.test(ua) ? 'Firefox' : 'onbekend';
  const dev = /iPhone|Android|Mobile/i.test(ua) ? 'gsm' : 'computer';
  const e = { t: Date.now(), status, method: req.method, path: req.originalUrl.slice(0, 200), ms, who: browser === 'bot' ? 'bot' : `${browser} · ${dev}` };
  const l = accessLogs.get(name) || []; l.push(e); if (l.length > 300) l.shift(); accessLogs.set(name, l);
  for (const fn of accessSubs.get(name) || []) fn(e);
}
function fmtAccess(e) { const d = new Date(e.t); return `${d.toTimeString().slice(0, 8)} ${e.status} ${e.method} ${e.path}  ${e.ms} ms  ${e.who}`; }

// welke container(s) bedient dit domein? (voor onderhoudsmodus bij sites die in Docker draaien)
async function upstreamOf(site) {
  if (site.domain && site.domainExternal) {
    const b = parseCaddyfile().find((x) => x.domains.includes(site.domain));
    if (b && b.upstreams[0]) { const [h, p] = b.upstreams[0].split(':'); return { host: h, port: Number(p) || 80 }; }
    if (b && b.roots.length) return { root: b.roots[0] };
  }
  if (site.port) return { host: CFG.upstreamHost, port: site.port };
  return null;
}
async function targetsFor(up) {
  const hostMode = /^(localhost|127\.0\.0\.1|host\.docker\.internal|\d+\.\d+\.\d+\.\d+)$/.test(up.host);
  if (hostMode) {
    const r = await run('docker', ['ps', '--filter', `publish=${up.port}`, '--format', '{{.Names}}'], { quiet: true });
    return { mode: 'port', containers: r.out.split('\n').map((x) => x.trim()).filter(Boolean) };
  }
  const ps = await run('docker', ['ps', '--format', '{{.Names}}'], { quiet: true });
  const names = ps.out.split('\n').map((x) => x.trim()).filter(Boolean);
  if (!names.length) return { mode: 'alias', containers: [] };
  const ins = await run('docker', ['inspect', ...names], { quiet: true });
  let list = []; try { list = JSON.parse(ins.out); } catch { /* */ }
  const hit = []; let network = '';
  for (const c of list) {
    const nm = String(c.Name || '').replace(/^\//, '');
    for (const [net, v] of Object.entries((c.NetworkSettings || {}).Networks || {})) {
      const al = [...(v.Aliases || []), ...(v.DNSNames || [])];
      if (nm === up.host || al.includes(up.host)) { hit.push(nm); network = network || net; }
    }
  }
  return { mode: 'alias', containers: [...new Set(hit)], network };
}
async function setMaintenance(site, on, job, say) {
  if (site.self) throw bad('Het paneel zelf kan niet in onderhoudsmodus.');
  if (on && site.maintenance) return say('Onderhoudsmodus stond al aan');
  if (!on && !site.maintenance) return say('Onderhoudsmodus stond al uit');
  if (site.type === 'static') {
    if (!site.domainExternal) {
      // het paneel toont de site zelf: gewoon een vlag
      if (on) { site.maintenance = { mode: 'flag', since: Date.now() }; say('Bezoekers zien nu "Even bezig"'); }
      else { delete site.maintenance; say('Site staat terug online'); }
      saveSites(); return;
    }
    // site komt van ergens anders (bv. Caddy met root): bestanden even aan de kant zetten
    const stash = path.join(CFG.backupRoot, site.name, '_onderhoud');
    if (on) {
      if (exists(stash) && (await fsp.readdir(stash)).length) throw bad('Er staat nog een oude onderhouds-map. Zet de onderhoudsmodus eerst uit.');
      await fsp.mkdir(stash, { recursive: true });
      say('Bestanden even aan de kant zetten');
      const keep = keepList(site);
      for (const e of await fsp.readdir(site.path)) {
        if (keep.includes(e)) continue;
        const from = path.join(site.path, e), to = path.join(stash, e);
        try { await fsp.rename(from, to); } catch { await fsp.cp(from, to, { recursive: true }); await fsp.rm(from, { recursive: true, force: true }); }
      }
      const html = maintenancePage(site.name).replace('<head>', '<head><!-- paneel-onderhoud -->');
      await fsp.writeFile(path.join(site.path, 'index.html'), html); await fsp.writeFile(path.join(site.path, '404.html'), html);
      site.maintenance = { mode: 'swap', stash, since: Date.now() }; saveSites();
      say('Bezoekers zien nu "Even bezig"');
    } else {
      say('Site terugzetten');
      for (const f of ['index.html', '404.html']) { const p = path.join(site.path, f); if (exists(p) && /paneel-onderhoud/.test(fs.readFileSync(p, 'utf8'))) await fsp.rm(p, { force: true }); }
      for (const e of await fsp.readdir(stash)) {
        const from = path.join(stash, e), to = path.join(site.path, e);
        await fsp.rm(to, { recursive: true, force: true });
        try { await fsp.rename(from, to); } catch { await fsp.cp(from, to, { recursive: true }); await fsp.rm(from, { recursive: true, force: true }); }
      }
      await fsp.rm(stash, { recursive: true, force: true });
      delete site.maintenance; saveSites(); say('Site staat terug online');
    }
    return;
  }
  // site in Docker: de app even stoppen en een klein "Even bezig"-containertje op dezelfde plek zetten
  const helper = `onderhoud-${site.name}`;
  if (on) {
    const up = await upstreamOf(site);
    if (!up || up.root) throw bad('Ik weet niet langs waar bezoekers deze site bereiken (geen domein of poort).');
    const t = await targetsFor(up);
    if (!t.containers.length) throw bad(`Ik vind de container achter ${up.host}:${up.port} niet.`);
    say(`App even stoppen (${t.containers.join(', ')})`);
    if (DEMO) { site.maintenance = { mode: 'helper', helper, targets: t.containers, since: Date.now() }; saveSites(); return say('(demo) Bezoekers zien nu "Even bezig"'); }
    const st = await run('docker', ['stop', ...t.containers], { job });
    if (st.code !== 0) throw new Error('Stoppen mislukt');
    const img = await selfImage();
    await run('docker', ['rm', '-f', helper], { quiet: true });
    const net = t.mode === 'alias' ? ['--network', t.network, '--network-alias', up.host] : ['-p', `${up.port}:${up.port}`];
    const script = "const h=process.env.HTML;require('http').createServer((q,r)=>{r.writeHead(503,{'Content-Type':'text/html; charset=utf-8','Retry-After':'300','Cache-Control':'no-store'});r.end(h)}).listen(+process.env.PORT,'0.0.0.0')";
    say('"Even bezig"-pagina starten');
    const r = await run('docker', ['run', '-d', '--name', helper, '--restart', 'unless-stopped', ...net, '-e', `PORT=${up.port}`, '-e', `HTML=${maintenancePage(site.name)}`, '--user', 'root', '--entrypoint', 'node', img, '-e', script], { quiet: true });
    if (r.code !== 0) { await run('docker', ['start', ...t.containers], { quiet: true }); throw new Error(`Onderhoudspagina starten mislukt: ${r.out.slice(-200)}`); }
    site.maintenance = { mode: 'helper', helper, targets: t.containers, since: Date.now() }; saveSites();
    say('Bezoekers zien nu "Even bezig"');
  } else {
    const m = site.maintenance;
    if (!DEMO) {
      await run('docker', ['rm', '-f', m.helper || helper], { quiet: true });
      say('App terug starten');
      if (site.type === 'docker') { const r = await compose(site, ['up', '-d', '--remove-orphans'], job); if (r.code !== 0) throw new Error('Starten mislukt'); }
      else { const r = await run('docker', ['start', ...(m.targets || [site.container])], { job }); if (r.code !== 0) throw new Error('Starten mislukt'); }
    }
    delete site.maintenance; saveSites(); say('Site staat terug online');
  }
}
// domein-check: wijst DuckDNS naar je server, is het certificaat geldig, antwoordt de site?
async function domainCheck(site) {
  const d = site.domain; if (!d) return { domain: '', checks: [] };
  if (DEMO) return { domain: d, at: Date.now(), checks: [
    { id: 'dns', ok: true, title: 'DuckDNS wijst naar je server', detail: `${d} → 81.82.x.x` },
    { id: 'tls', ok: true, title: 'https-certificaat geldig', detail: "Let's Encrypt · tot 5 januari 2027", days: 90 },
    { id: 'http', ok: true, title: 'Site reageert', detail: '200 OK · 84 ms' } ] };
  const dns = require('dns').promises; const tls = require('tls'); const https = require('https');
  const out = [];
  const pub = await publicIp();
  try {
    const ips = await dns.resolve4(d);
    const ok = !pub || ips.includes(pub);
    out.push({ id: 'dns', ok, title: ok ? 'Domein wijst naar je server' : 'Domein wijst naar een ander adres', detail: `${d} → ${ips.join(', ')}${!ok && pub ? ` (je server is ${pub}; controleer je DuckDNS-updater)` : ''}` });
  } catch (e) { out.push({ id: 'dns', ok: false, title: 'Domein bestaat niet (of DNS antwoordt niet)', detail: e.code === 'ENOTFOUND' ? 'Maak de naam aan op duckdns.org' : e.message }); }
  // certificaat + site via Caddy op je eigen server (werkt ook als je router geen "NAT loopback" doet)
  const host = CFG.caddyContainer ? CFG.upstreamHost : d;
  await new Promise((resolve) => {
    const sock = tls.connect({ host, port: 443, servername: d, rejectUnauthorized: false, timeout: 6000 }, () => {
      const c = sock.getPeerCertificate(); const valid = sock.authorized || (c && c.subjectaltname && c.subjectaltname.includes(d) && new Date(c.valid_to) > new Date());
      const days = c && c.valid_to ? Math.round((new Date(c.valid_to) - Date.now()) / 864e5) : null;
      out.push({ id: 'tls', ok: !!valid && days > 7, warn: days != null && days <= 14, title: valid ? 'https-certificaat geldig' : 'Geen geldig https-certificaat', detail: c && c.valid_to ? `${(c.issuer && (c.issuer.O || c.issuer.CN)) || ''} · tot ${new Date(c.valid_to).toLocaleDateString('nl-BE', { day: 'numeric', month: 'long', year: 'numeric' })}` : (sock.authorizationError || 'geen certificaat'), days });
      sock.end(); resolve();
    });
    sock.on('error', (e) => { out.push({ id: 'tls', ok: false, title: 'https werkt niet', detail: e.code === 'ECONNREFUSED' ? 'Caddy luistert niet op poort 443' : e.message }); resolve(); });
    sock.on('timeout', () => { sock.destroy(); out.push({ id: 'tls', ok: false, title: 'https antwoordt niet', detail: 'time-out' }); resolve(); });
  });
  await new Promise((resolve) => {
    const t0 = Date.now();
    const rq = https.request({ host, port: 443, servername: d, path: '/', method: 'GET', headers: { Host: d, 'User-Agent': 'Rawendpaneel-check' }, rejectUnauthorized: false, timeout: 8000 }, (r) => {
      r.resume(); const ms = Date.now() - t0;
      const ok = r.statusCode < 400 || r.statusCode === 401;
      out.push({ id: 'http', ok, title: ok ? 'Site reageert' : `Site geeft een fout (${r.statusCode})`, detail: `${r.statusCode} ${r.statusMessage || ''} · ${ms} ms`.trim() });
      resolve();
    });
    rq.on('error', (e) => { out.push({ id: 'http', ok: false, title: 'Site antwoordt niet', detail: e.message }); resolve(); });
    rq.on('timeout', () => { rq.destroy(); out.push({ id: 'http', ok: false, title: 'Site antwoordt niet', detail: 'time-out' }); resolve(); });
    rq.end();
  });
  return { domain: d, at: Date.now(), checks: out };
}
let statusCache = { t: 0, data: null };
async function siteStatuses(maxAge = 20000) {
  if (statusCache.data && Date.now() - statusCache.t < maxAge) return statusCache.data;
  const st = await Promise.all(sites.map((s) => siteStatus(s).catch(() => ({ state: 'warn', text: '?' }))));
  statusCache = { t: Date.now(), data: sites.map((s, i) => ({ site: s, status: s.maintenance ? { state: 'maint', text: 'onderhoud' } : st[i] })) };
  return statusCache.data;
}
function restartSite(name) {
  const site = getSite(name); if (!site) throw bad('Onbekende site', 404);
  if (site.type === 'static') throw bad('Een gewone website moet je niet herstarten');
  if (site.self) return startJob(site.name, 'herstarten', async (job, say) => selfRebuild(site, job, say, null));
  return startJob(site.name, 'herstarten', async (job, say) => {
    say('Herstarten');
    const r = site.type === 'container' ? await run('docker', ['restart', site.container], { job }) : await compose(site, ['restart'], job);
    if (r.code !== 0) throw new Error('Herstarten mislukt');
  });
}

app.post('/api/sites/:name/maintenance', wrap(async (req, res) => {
  const site = getSite(req.params.name); if (!site) throw bad('Onbekende site', 404);
  const on = !!req.body.on;
  const job = startJob(site.name, on ? 'onderhoud aan' : 'onderhoud uit', async (job, say) => { await setMaintenance(site, on, job, say); staticServers.clear(); statusCache.t = 0; });
  res.json({ job: job.id });
}));
app.get('/api/sites/:name/check', wrap(async (req, res) => {
  const site = getSite(req.params.name); if (!site) throw bad('Onbekende site', 404);
  res.json(await domainCheck(site));
}));
app.get('/api/sites/:name/activity', wrap(async (req, res) => {
  if (!getSite(req.params.name)) throw bad('Onbekende site', 404);
  res.json((store.read('siteActivity', {})[req.params.name] || []).slice().reverse());
}));
app.get('/api/sites/:name/details', wrap(async (req, res) => {
  const site = getSite(req.params.name); if (!site) throw bad('Onbekende site', 404);
  const [status, backups] = await Promise.all([siteStatus(site), site.type === 'container' ? [] : listBackups(site)]);
  let size = null;
  if (site.path && exists(site.path)) { const r = await run('du', ['-sb', site.path], { quiet: true }); size = Number((r.out.match(/^(\d+)/) || [])[1]) || null; }
  const visits = (accessLogs.get(site.name) || []).filter((e) => e.who !== 'bot' && Date.now() - e.t < 864e5 && !/\.(js|css|png|jpe?g|svg|ico|webp|woff2?|map)(\?|$)/.test(e.path)).length;
  res.json({ ...publicSite(site), status: site.maintenance ? { state: 'maint', text: 'onderhoud' } : status, backups, size, busy: busy.has(site.name), autostart: autostart.get(site.name) || null, visits24h: visits, lanUrl: site.type === 'static' ? `/view/${site.name}/` : site.port && CFG.hostLanIp ? `http://${CFG.hostLanIp}:${site.port}` : '' });
}));
// live logs (Server-Sent Events)
app.get('/api/sites/:name/logs/stream', (req, res) => {
  const site = getSite(req.params.name); if (!site) return res.status(404).end();
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  const send = (line, kind = 'line') => { for (const l of String(line).split('\n')) if (l.trim()) res.write(`event: ${kind}\ndata: ${JSON.stringify(l)}\n\n`); };
  const cleanup = [];
  req.on('close', () => cleanup.forEach((f) => { try { f(); } catch { /* */ } }));
  const hb = setInterval(() => res.write(': ping\n\n'), 15000); cleanup.push(() => clearInterval(hb));
  const stream = (cmd, args, opts = {}, filter = null) => {
    const p = spawn(cmd, args, { cwd: opts.cwd, env: process.env });
    let buf = '';
    const on = (d) => { buf += d.toString(); const lines = buf.split('\n'); buf = lines.pop(); for (const l of lines) { const x = filter ? filter(l) : l; if (x) send(x); } };
    p.stdout.on('data', on); p.stderr.on('data', on); p.on('error', (e) => send(`(logs niet beschikbaar: ${e.message})`, 'info'));
    cleanup.push(() => p.kill());
  };
  if (DEMO) {
    send(`Dit is de demo: de logs hieronder zijn nagemaakt.`, 'info');
    const paths = ['/', '/style.css', '/projecten', '/img/foto.jpg', '/contact', '/favicon.ico'];
    const iv = setInterval(() => { const st = Math.random() < 0.08 ? 404 : 200; send(fmtAccess({ t: Date.now(), status: st, method: 'GET', path: paths[Math.floor(Math.random() * paths.length)], ms: 5 + Math.floor(Math.random() * 90), who: ['Chrome · computer', 'Safari · gsm', 'Edge · computer', 'bot'][Math.floor(Math.random() * 4)] })); }, 1800);
    cleanup.push(() => clearInterval(iv));
    return;
  }
  if (site.self) return stream('docker', ['logs', '-f', '--tail', '200', '--timestamps', 'serverpaneel']);
  if (site.type === 'container') return stream('docker', ['logs', '-f', '--tail', '200', '--timestamps', site.container]);
  if (site.type === 'docker') return stream('docker', ['compose', 'logs', '-f', '--no-color', '--tail', '200', '--timestamps'], { cwd: site.path });
  // statische site
  if (!site.domainExternal) {
    for (const e of accessLogs.get(site.name) || []) send(fmtAccess(e));
    if (!(accessLogs.get(site.name) || []).length) send('Nog geen bezoekers sinds het paneel (her)startte. Nieuwe bezoeken verschijnen hier live.', 'info');
    const fn = (e) => send(fmtAccess(e));
    const subs = accessSubs.get(site.name) || new Set(); subs.add(fn); accessSubs.set(site.name, subs);
    cleanup.push(() => subs.delete(fn));
    return;
  }
  // site via je eigen Caddyfile: bezoekers uit Caddy halen (als Caddy logt)
  if (!CFG.caddyContainer) return send('Geen logs beschikbaar voor deze site.', 'info');
  send(`Bezoekers van ${site.domain} uit de logs van Caddy. Zie je niets? Zet dan "log" aan in het blok van ${site.domain} in je Caddyfile.`, 'info');
  stream('docker', ['logs', '-f', '--tail', '2000', CFG.caddyContainer], {}, (l) => {
    const i = l.indexOf('{'); if (i < 0) return null;
    let j; try { j = JSON.parse(l.slice(i)); } catch { return null; }
    const r = j.request || {}; if ((r.host || '').toLowerCase() !== site.domain) return null;
    const ua = ((r.headers || {})['User-Agent'] || [''])[0];
    return fmtAccess({ t: (j.ts || Date.now() / 1000) * 1000, status: j.status || 0, method: r.method || '', path: r.uri || '', ms: Math.round((j.duration || 0) * 1000), who: /bot|crawl|spider/i.test(ua) ? 'bot' : /iPhone|Android|Mobile/.test(ua) ? 'gsm' : 'computer' });
  });
});

// ---- routes van de onderdelen (allemaal achter inloggen)
for (const m of ['calendar', 'personal', 'notify', 'servertools', 'security', 'terminal', 'files', 'hosttools', 'apps', 'databases', 'search']) ctx[m].routes(app);

// multer/andere fouten netjes als JSON
app.use((err, req, res, next) => {
  if (!err) return next();
  res.status(err.status || 400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Bestand te groot (max 2 GB)' : err.message });
});

// ---------------------------------------------------------------- demo-inhoud
function seedDemo() {
  if (!auth) { auth = { passwordHash: hashPassword('demo123456'), totpEnabled: false, totpSecret: null }; saveAuth(); }
  if (exists(path.join(CFG.dataDir, '.demo-seeded-v2'))) return;
  // oude demo-versie opruimen (alleen binnen de demo-map)
  fs.rmSync(path.join(DEMO_DIR, 'projecten'), { recursive: true, force: true });
  fs.rmSync(path.join(CFG.dataDir, '.demo-seeded'), { force: true });
  const w = (f, c) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, c); };
  const page = (title, sub, c1, c2) => `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><link rel="stylesheet" href="style.css"></head>
<body><header><b>${title}</b><nav><a href="#">Projecten</a><a href="#">Over mij</a><a href="#">Contact</a></nav></header>
<main><h1>${sub}</h1><p>Welkom op mijn website. Deze pagina draait op mijn eigen server.</p><a class="cta" href="#">Bekijk mijn werk</a>
<section><div></div><div></div><div></div></section></main></body></html>`;
  const css = (c1, c2) => `*{box-sizing:border-box}body{margin:0;font-family:system-ui,sans-serif;background:linear-gradient(135deg,${c1},${c2});color:#fff;min-height:100vh}
header{display:flex;justify-content:space-between;padding:24px 48px;font-size:20px}nav a{color:#fff;margin-left:28px;text-decoration:none;opacity:.85}
main{padding:80px 48px}h1{font-size:64px;margin:0 0 16px;max-width:800px;line-height:1.05}p{font-size:22px;opacity:.9}
.cta{display:inline-block;margin-top:24px;background:#fff;color:#222;padding:16px 28px;border-radius:14px;text-decoration:none;font-weight:600}
section{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;margin-top:64px}section div{height:220px;border-radius:20px;background:rgba(255,255,255,.18)}`;
  // 1) een statische website met een oudere backup
  const v = path.join(CFG.sitesRoot, 'portfolio');
  w(path.join(v, 'index.html'), page('Portfolio', 'Hoi, welkom op mijn site 👋', '#6d5dfc', '#4f9dff')); w(path.join(v, 'style.css'), css('#6d5dfc', '#4f9dff'));
  const bk = path.join(CFG.backupRoot, 'portfolio', '20260901-180000');
  w(path.join(bk, 'index.html'), page('Portfolio', 'Mijn oude portfolio', '#334155', '#0f172a')); w(path.join(bk, 'style.css'), css('#334155', '#0f172a'));
  // 2) een tweede website zonder domein
  const a = path.join(CFG.sitesRoot, 'fotoalbum');
  w(path.join(a, 'index.html'), page('Fotoalbum', 'Mijn mooiste momenten 📸', '#f472b6', '#fb923c')); w(path.join(a, 'style.css'), css('#f472b6', '#fb923c'));
  // 3) een Docker-app
  const n = path.join(CFG.sitesRoot, 'notities');
  w(path.join(n, 'docker-compose.yml'), 'services:\n  web:\n    image: nginx:alpine\n    ports:\n      - "8085:80"\n');
  // 4) zoals op je echte server: sites die al online staan in Docker, met een eigen Caddyfile
  const vp = path.join(DEMO_DIR, 'vakantie-planner');
  w(path.join(vp, 'docker-compose.yml'), 'services:\n  vakantie-planner:\n    build: .\n    container_name: vakantie-planner\n    ports:\n      - "8080:3000"\n    volumes:\n      - ./data:/app/data\n');
  w(path.join(vp, 'Dockerfile'), 'FROM node:22-alpine\nWORKDIR /app\nCOPY . .\nCMD ["node", "server.js"]\n');
  w(path.join(vp, 'server.js'), '// jouw app\n'); w(path.join(vp, 'data', 'reizen.json'), '[]');
  const pt = path.join(DEMO_DIR, 'portfolio-tmp');
  w(path.join(pt, 'docker-compose.yml'), 'services:\n  web:\n    image: nginx:alpine\n    container_name: portfolio\n    volumes:\n      - ./html:/usr/share/nginx/html:ro\n    ports:\n      - "8090:80"\n');
  w(path.join(pt, 'html', 'index.html'), page('Portfolio', 'Mijn portfolio (in Docker)', '#0ea5e9', '#6366f1'));
  const dd = path.join(DEMO_DIR, 'duckdns');
  w(path.join(dd, 'docker-compose.yml'), 'services:\n  caddy:\n    image: caddy:2\n    container_name: caddy\n  duckdns:\n    image: lscr.io/linuxserver/duckdns\n');
  w(path.join(dd, 'Caddyfile'), 'vakantie-demo.duckdns.org {\n\treverse_proxy vakantie-planner:3000\n}\n\nportfolio-oud.duckdns.org {\n\treverse_proxy 172.17.0.1:8090\n}\n\nimport /etc/caddy/serverpaneel/*.caddy\n');
  const now = Date.now();
  sites = [
    { name: 'portfolio', path: v, type: 'static', domain: 'portfolio-demo.duckdns.org', port: null, keep: [], spa: false, managed: true, createdAt: now - 20 * 864e5, updatedAt: now - 2 * 3600e3 },
    { name: 'fotoalbum', path: a, type: 'static', domain: '', port: null, keep: [], spa: false, managed: true, createdAt: now - 9 * 864e5, updatedAt: now - 3 * 864e5 },
    { name: 'notities', path: n, type: 'docker', domain: 'notities-demo.duckdns.org', port: 8085, keep: [], spa: false, managed: true, createdAt: now - 5 * 864e5, updatedAt: now - 26 * 3600e3 },
  ];
  saveSites();
  for (const site of sites) if (site.domain) w(path.join(CFG.caddyDir, `site-${site.name}.caddy`), caddyBlock(site));
  w(path.join(CFG.dataDir, '.demo-seeded-v2'), '');
}
if (DEMO) seedDemo();

// tijdelijke uploads van vorige keer opruimen
fs.rmSync(path.join(CFG.dataDir, 'tmp'), { recursive: true, force: true });
fs.mkdirSync(path.join(CFG.dataDir, 'tmp'), { recursive: true });

syncInlineAtStart();
setTimeout(ensureAutostartAll, 4000);
setInterval(ensureAutostartAll, 10 * 60 * 1000).unref();
// sites die al een domein in je eigen Caddyfile hebben, maar nog zonder domein in het paneel staan: koppelen
try {
  const blocks = parseCaddyfile(); let changed = false;
  for (const site of sites) {
    if (site.domain) continue;
    const d = site.type === 'container' ? findDomainContainer({ name: site.container, hostPorts: [site.port].filter(Boolean) }, blocks) : site.path ? findDomain(site.path, site.port, blocks) : '';
    if (d && !sites.some((x) => x.domain === d)) { site.domain = d; site.domainExternal = true; changed = true; console.log(`${site.name} gekoppeld aan ${d} (uit je Caddyfile)`); }
  }
  if (changed) saveSites();
} catch (e) { console.log(`Domeinen koppelen mislukt: ${e.message}`); }
const server = app.listen(CFG.port, '0.0.0.0', () => {
  console.log(`Serverpaneel draait op poort ${CFG.port} (versie ${VERSION})`);
  if (DEMO) console.log(`\n  DEMO-MODUS  ->  open http://localhost:${CFG.port}   (wachtwoord: demo123456)\n  Alles gebeurt in de map demo-data. Je echte server wordt niet aangeraakt.\n`);
  if (!auth) console.log('Nog geen wachtwoord: open het paneel via je lokale IP om er een in te stellen.');
});
ctx.terminal.attach(server);
server.requestTimeout = 0; // grote uploads niet afbreken
server.headersTimeout = 120000;

for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { try { ctx.calendar.stop(); } catch { /* */ } process.exit(0); });
