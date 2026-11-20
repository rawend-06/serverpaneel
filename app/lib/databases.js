'use strict';
/*
 * Databases: PostgreSQL en MySQL/MariaDB die in Docker draaien, en SQLite-bestanden van je sites.
 * Tabellen bekijken, query's uitvoeren (standaard alleen lezen) en backups maken (.sql.gz).
 * Wachtwoorden haalt het paneel zelf uit de instellingen van de container; ze komen nooit in je browser.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const zlib = require('zlib');
const { spawn } = require('child_process');

module.exports = function databases(ctx) {
  const { CFG, DEMO, wrap, bad, run } = ctx;
  const BK = path.join(path.resolve(CFG.backupRoot), '_databases');
  const MAX_ROWS = 500;
  const NAME = /^[\w.-]{1,128}$/;
  let sqlite = null; try { sqlite = require('node:sqlite'); } catch { /* oudere Node: geen SQLite */ }

  // ------------------------------------------------------------ zoeken
  let cache = { t: 0, list: null };
  async function discover() {
    if (cache.list && Date.now() - cache.t < 15000) return cache.list;
    const out = [];
    if (DEMO) {
      out.push({ id: 'c:vakantie-db', kind: 'container', engine: 'postgres', name: 'vakantie-db', container: 'vakantie-db', running: true, user: 'rawend', image: 'postgres:16-alpine' });
      out.push({ id: 'c:wordpress-db', kind: 'container', engine: 'mysql', name: 'wordpress-db', container: 'wordpress-db', running: true, user: 'root', image: 'mariadb:11' });
    } else {
      const r = await run('docker', ['ps', '-a', '--format', '{{json .}}'], { quiet: true });
      for (const l of r.out.split('\n')) {
        let j; try { j = JSON.parse(l); } catch { continue; }
        const img = String(j.Image).toLowerCase();
        const engine = /postgres|postgis|pgvecto|timescale/.test(img) ? 'postgres' : /mariadb|mysql/.test(img) ? 'mysql' : null;
        if (!engine) continue;
        out.push({ id: `c:${j.Names}`, kind: 'container', engine, name: j.Names, container: j.Names, running: j.State === 'running', image: j.Image });
      }
    }
    // SQLite-bestanden in je sites en apps
    for (const f of await findSqlite()) out.push({ id: `f:${f}`, kind: 'file', engine: 'sqlite', name: path.basename(f), file: f, running: true, site: siteOf(f) });
    cache = { t: Date.now(), list: out };
    return out;
  }
  const siteOf = (f) => { const s = ctx.sites().find((x) => x.path && (f === x.path || f.startsWith(x.path + path.sep))); return s ? s.name : ''; };
  async function findSqlite() {
    const roots = [...new Set([...ctx.sites().map((s) => s.path).filter(Boolean), path.join(CFG.allowedRoot, 'apps')])];
    const out = [];
    const walk = async (d, depth) => {
      if (depth > 4 || out.length > 30) return;
      let ents; try { ents = await fsp.readdir(d, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        if (['node_modules', '.git', 'cache', '.cache'].includes(e.name)) continue;
        const p = path.join(d, e.name);
        if (e.isDirectory()) await walk(p, depth + 1);
        else if (/\.(sqlite3?|db)$/i.test(e.name)) { const st = await fsp.stat(p).catch(() => null); if (st && st.size > 0 && st.size < 2e9) out.push(p); }
      }
    };
    for (const r of roots) await walk(r, 0);
    return out;
  }
  async function find(id) { const d = (await discover()).find((x) => x.id === id); if (!d) throw bad('Onbekende database', 404); return d; }

  // inloggegevens uit de container (nooit naar de browser)
  async function creds(d) {
    if (d.creds) return d.creds;
    const r = await run('docker', ['inspect', '-f', '{{json .Config.Env}}', d.container], { quiet: true });
    let env = []; try { env = JSON.parse(r.out); } catch { /* */ }
    const e = Object.fromEntries(env.map((x) => [x.slice(0, x.indexOf('=')), x.slice(x.indexOf('=') + 1)]));
    d.creds = d.engine === 'postgres'
      ? { user: e.POSTGRES_USER || 'postgres', db: e.POSTGRES_DB || e.POSTGRES_USER || 'postgres' }
      : { user: e.MARIADB_ROOT_PASSWORD || e.MYSQL_ROOT_PASSWORD ? 'root' : (e.MARIADB_USER || e.MYSQL_USER || 'root'), pw: e.MARIADB_ROOT_PASSWORD || e.MYSQL_ROOT_PASSWORD || e.MARIADB_PASSWORD || e.MYSQL_PASSWORD || '', db: e.MARIADB_DATABASE || e.MYSQL_DATABASE || '' };
    return d.creds;
  }
  function execArgs(d, c, cmd, { readOnly } = {}) {
    if (d.engine === 'postgres') return ['exec', ...(readOnly ? ['-e', 'PGOPTIONS=-c default_transaction_read_only=on'] : []), d.container, ...cmd];
    return ['exec', '-e', `MYSQL_PWD=${c.pw}`, d.container, ...cmd];
  }
  const mysqlBin = async (d) => { const r = await run('docker', ['exec', d.container, 'sh', '-c', 'command -v mariadb || command -v mysql'], { quiet: true }); return r.out.trim().split('\n').pop() || 'mysql'; };
  function parseCsv(txt) {
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < txt.length; i++) {
      const ch = txt[i];
      if (q) { if (ch === '"') { if (txt[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
      else if (ch === '"') q = true; else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else if (ch !== '\r') cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }
  const parseTsv = (txt) => txt.split('\n').filter((l) => l.length).map((l) => l.split('\t').map((v) => (v === 'NULL' ? null : v.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\\\/g, '\\'))));

  // ------------------------------------------------------------ demo-gegevens
  const DEMO_T = { reizen: [['id', 'naam', 'land', 'van', 'tot'], ['128', 'Zomer Kroatië', 'HR', '2027-07-12', '2027-07-26'], ['127', 'Skiën Oostenrijk', 'AT', '2027-02-20', '2027-02-27'], ['126', 'Weekend Parijs', 'FR', '2026-11-06', '2026-11-08'], ['125', 'Citytrip Lissabon', 'PT', '2026-04-14', '2026-04-18']], deelnemers: [['id', 'reis_id', 'naam'], ['1', '128', 'Sam'], ['2', '128', 'Noor']], kosten: [['id', 'reis_id', 'omschrijving', 'bedrag'], ['1', '128', 'Vlucht', '412.50']] };

  async function databasesOf(d) {
    if (DEMO) return d.engine === 'postgres' ? [{ name: 'vakantie', size: 24e6 }, { name: 'postgres', size: 7.5e6 }] : [{ name: 'wordpress', size: 41e6 }];
    if (d.engine === 'sqlite') { const st = await fsp.stat(d.file); return [{ name: 'main', size: st.size }]; }
    if (!d.running) return [];
    const c = await creds(d);
    if (d.engine === 'postgres') {
      const r = await run('docker', execArgs(d, c, ['psql', '-U', c.user, '-d', c.db, '-At', '-F', '\t', '-c', 'select datname, pg_database_size(datname) from pg_database where not datistemplate order by 1']), { quiet: true });
      if (r.code !== 0) throw bad(`Kon de databases niet lezen: ${r.out.slice(-200)}`);
      return parseTsv(r.out).map(([name, size]) => ({ name, size: Number(size) }));
    }
    const bin = await mysqlBin(d);
    const r = await run('docker', execArgs(d, c, [bin, `-u${c.user}`, '-N', '-B', '-e', "select s.schema_name, coalesce(sum(t.data_length+t.index_length),0) from information_schema.schemata s left join information_schema.tables t on t.table_schema=s.schema_name where s.schema_name not in ('mysql','information_schema','performance_schema','sys') group by s.schema_name"]), { quiet: true });
    if (r.code !== 0) throw bad(`Kon de databases niet lezen: ${r.out.slice(-200)}`);
    return parseTsv(r.out).map(([name, size]) => ({ name, size: Number(size) }));
  }
  async function tables(d, db) {
    if (DEMO) return Object.entries(DEMO_T).map(([name, rows]) => ({ name, rows: rows.length - 1 }));
    if (d.engine === 'sqlite') {
      if (!sqlite) throw bad('SQLite wordt niet ondersteund door deze Node-versie');
      const h = new sqlite.DatabaseSync(d.file, { readOnly: true });
      try { return h.prepare("select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name").all().map((t) => ({ name: t.name, rows: h.prepare(`select count(*) as n from "${t.name.replace(/"/g, '""')}"`).get().n })); } finally { h.close(); }
    }
    const c = await creds(d);
    if (d.engine === 'postgres') {
      const r = await run('docker', execArgs(d, c, ['psql', '-U', c.user, '-d', db, '-At', '-F', '\t', '-c', "select case when n.nspname='public' then c.relname else n.nspname||'.'||c.relname end, greatest(c.reltuples,0)::bigint from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p') and n.nspname not in ('pg_catalog','information_schema') order by 1"]), { quiet: true });
      if (r.code !== 0) throw bad(r.out.slice(-200));
      return parseTsv(r.out).map(([name, rows]) => ({ name, rows: Number(rows), approx: true }));
    }
    const bin = await mysqlBin(d);
    const r = await run('docker', execArgs(d, c, [bin, `-u${c.user}`, '-N', '-B', '-e', `select table_name, coalesce(table_rows,0) from information_schema.tables where table_schema='${db.replace(/'/g, "''")}' order by 1`]), { quiet: true });
    if (r.code !== 0) throw bad(r.out.slice(-200));
    return parseTsv(r.out).map(([name, rows]) => ({ name, rows: Number(rows), approx: true }));
  }
  async function query(d, db, sql, write) {
    sql = String(sql || '').trim().replace(/;+\s*$/, ''); if (!sql) throw bad('Typ een query');
    if (sql.length > 20000) throw bad('Query te lang');
    const t0 = Date.now();
    if (DEMO) {
      const m = sql.match(/from\s+"?(\w+)"?/i); const rows = DEMO_T[m && m[1]] || DEMO_T.reizen;
      if (!write && !/^\s*(select|with|show|explain|pragma)/i.test(sql)) throw bad('Alleen-lezen modus staat aan: zet "Wijzigen toestaan" aan om dit uit te voeren.');
      return { columns: rows[0], rows: rows.slice(1), ms: 6, truncated: false };
    }
    if (d.engine === 'sqlite') {
      if (!sqlite) throw bad('SQLite wordt niet ondersteund door deze Node-versie');
      const h = new sqlite.DatabaseSync(d.file, { readOnly: !write });
      try {
        const st = h.prepare(sql);
        if (/^\s*(select|with|pragma|explain)/i.test(sql)) { const all = st.all(); const cols = all.length ? Object.keys(all[0]) : []; return { columns: cols, rows: all.slice(0, MAX_ROWS).map((r) => cols.map((c) => r[c])), ms: Date.now() - t0, truncated: all.length > MAX_ROWS, total: all.length }; }
        const r = st.run(); return { columns: ['resultaat'], rows: [[`${r.changes} rij(en) gewijzigd`]], ms: Date.now() - t0 };
      } catch (e) { throw bad(e.message); } finally { h.close(); }
    }
    const c = await creds(d);
    let r;
    if (d.engine === 'postgres') r = await run('docker', execArgs(d, c, ['psql', '-U', c.user, '-d', db, '-v', 'ON_ERROR_STOP=1', '--csv', '-c', sql], { readOnly: !write }), { quiet: true, timeout: 60000 });
    else { const bin = await mysqlBin(d); r = await run('docker', execArgs(d, c, [bin, `-u${c.user}`, '-B', db, '-e', write ? sql : `SET SESSION TRANSACTION READ ONLY; START TRANSACTION; ${sql}; ROLLBACK;`]), { quiet: true, timeout: 60000 }); }
    if (r.code !== 0) throw bad(r.out.replace(/^psql:.*?ERROR:\s*/m, '').trim().slice(-400) || 'Query mislukt');
    const rows = d.engine === 'postgres' ? parseCsv(r.out) : parseTsv(r.out);
    if (!rows.length) return { columns: ['resultaat'], rows: [['OK']], ms: Date.now() - t0 };
    const [columns, ...data] = rows;
    return { columns, rows: data.slice(0, MAX_ROWS), total: data.length, truncated: data.length > MAX_ROWS, ms: Date.now() - t0 };
  }
  async function backup(d, db) {
    await fsp.mkdir(BK, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
    const file = path.join(BK, `${d.name.replace(/[^\w.-]/g, '_')}-${db.replace(/[^\w.-]/g, '_')}-${stamp}.${d.engine === 'sqlite' ? 'sqlite.gz' : 'sql.gz'}`);
    if (DEMO) { await fsp.writeFile(file, zlib.gzipSync('-- demo backup\n')); return path.basename(file); }
    if (d.engine === 'sqlite') {
      if (!sqlite) throw bad('SQLite wordt niet ondersteund door deze Node-versie');
      const tmp = `${file}.tmp`; const h = new sqlite.DatabaseSync(d.file, { readOnly: true });
      try { h.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`); } finally { h.close(); }
      await new Promise((res, rej) => fs.createReadStream(tmp).pipe(zlib.createGzip()).pipe(fs.createWriteStream(file)).on('finish', res).on('error', rej));
      await fsp.rm(tmp, { force: true });
      return path.basename(file);
    }
    const c = await creds(d);
    const cmd = d.engine === 'postgres' ? ['pg_dump', '-U', c.user, '--clean', '--if-exists', db] : [await mysqlBin(d) === 'mariadb' ? 'mariadb-dump' : 'mysqldump', `-u${c.user}`, '--single-transaction', '--routines', db];
    await new Promise((resolve, reject) => {
      const p = spawn('docker', execArgs(d, c, cmd));
      const out = fs.createWriteStream(file); let err = '';
      p.stdout.pipe(zlib.createGzip()).pipe(out);
      p.stderr.on('data', (x) => { err += x; });
      p.on('error', reject);
      p.on('close', (code) => { if (code !== 0) { fs.rm(file, { force: true }, () => {}); reject(bad(`Backup mislukt: ${err.slice(-200)}`)); } else out.on('finish', resolve); });
    });
    return path.basename(file);
  }
  async function backups() {
    const files = await fsp.readdir(BK).catch(() => []);
    const out = [];
    for (const f of files) { const st = await fsp.stat(path.join(BK, f)).catch(() => null); if (st && st.isFile()) out.push({ file: f, size: st.size, at: st.mtimeMs }); }
    return out.sort((a, b) => b.at - a.at).slice(0, 50);
  }

  function routes(app) {
    app.get('/api/databases', wrap(async (req, res) => {
      const list = await discover();
      res.json({ list: list.map(({ creds: _c, ...d }) => d), backups: await backups(), sqlite: !!sqlite });
    }));
    app.get('/api/databases/info', wrap(async (req, res) => {
      const d = await find(String(req.query.id));
      const dbs = await databasesOf(d);
      const c = d.kind === 'container' && !DEMO ? await creds(d) : {};
      const db = String(req.query.db || (dbs.find((x) => x.name === c.db) || dbs.find((x) => !['postgres'].includes(x.name)) || dbs[0] || {}).name || '');
      res.json({ dbs, db, tables: db ? await tables(d, db) : [], user: c.user || d.user || '' });
    }));
    app.post('/api/databases/query', wrap(async (req, res) => {
      const d = await find(String(req.body.id));
      const db = String(req.body.db || 'main'); if (!NAME.test(db)) throw bad('Ongeldige databasenaam');
      if (req.body.write) await ctx.requireStepUp(req, 'een database wijzigen');
      res.json(await query(d, db, req.body.sql, !!req.body.write));
    }));
    app.post('/api/databases/backup', wrap(async (req, res) => {
      const d = await find(String(req.body.id));
      const db = String(req.body.db || 'main'); if (!NAME.test(db)) throw bad('Ongeldige databasenaam');
      res.json({ file: await backup(d, db), backups: await backups() });
    }));
    app.get('/api/databases/backups/:file', wrap(async (req, res) => {
      const f = path.basename(req.params.file); const p = path.join(BK, f);
      if (!fs.existsSync(p)) throw bad('Bestaat niet (meer)', 404);
      res.download(p, f);
    }));
  }
  return { routes, discover };
};
