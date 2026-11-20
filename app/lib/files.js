'use strict';
/*
 * Bestandsbeheer: bladeren, bekijken, bewerken, uploaden en downloaden – enkel binnen je eigen home-map
 * (en de extra mappen die je bij de installatie opgaf). Verwijderen gaat naar een prullenbak, en vóór elke
 * bewerking wordt een kopie bewaard. Zo kan je nooit per ongeluk iets kwijtraken.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

module.exports = function files(ctx) {
  const { CFG, wrap, bad, uploadDisk } = ctx;
  const ROOTS = [CFG.allowedRoot, ...CFG.extraRoots].map((r) => path.resolve(r));
  const META = path.join(path.dirname(path.resolve(CFG.backupRoot)));          // ~/.serverpaneel
  const TRASH = path.join(META, 'prullenbak');
  const EDITS = path.join(path.resolve(CFG.backupRoot), '_bestanden');
  const MAX_TEXT = 2 * 1024 * 1024;
  const inside = (root, p) => p === root || p.startsWith(root + path.sep);

  // pad controleren: binnen een toegelaten map, ook na het volgen van snelkoppelingen (symlinks)
  async function safe(p, { mustExist = true } = {}) {
    const abs = path.resolve(String(p || ROOTS[0]));
    if (!ROOTS.some((r) => inside(r, abs))) throw bad('Die map ligt buiten je home-map', 403);
    if (!mustExist) {
      const parent = await fsp.realpath(path.dirname(abs)).catch(() => null);
      if (!parent || !ROOTS.some((r) => inside(r, parent))) throw bad('Die map bestaat niet', 404);
      return path.join(parent, path.basename(abs));
    }
    const real = await fsp.realpath(abs).catch(() => null);
    if (!real) throw bad('Bestaat niet (meer)', 404);
    if (!ROOTS.some((r) => inside(r, real))) throw bad('Die snelkoppeling wijst buiten je home-map', 403);
    return abs;
  }
  const cleanName = (n) => { const s = String(n || '').trim(); if (!s || s === '.' || s === '..' || /[/\\\0]/.test(s) || s.length > 200) throw bad('Ongeldige naam'); return s; };
  const stamp = () => new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);

  async function list(dir) {
    const abs = await safe(dir);
    const st = await fsp.stat(abs); if (!st.isDirectory()) throw bad('Dat is geen map');
    const out = [];
    for (const d of await fsp.readdir(abs, { withFileTypes: true })) {
      const p = path.join(abs, d.name);
      let s; try { s = await fsp.stat(p); } catch { continue; } // kapotte snelkoppeling
      out.push({ name: d.name, dir: s.isDirectory(), size: s.isDirectory() ? null : s.size, mtime: s.mtimeMs, link: d.isSymbolicLink(), mode: (s.mode & 0o777).toString(8), uid: s.uid });
    }
    out.sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, 'nl', { numeric: true }));
    const disk = await fsp.statfs(abs).then((f) => ({ free: f.bavail * f.bsize, total: f.blocks * f.bsize })).catch(() => null);
    return { path: abs, parent: ROOTS.includes(abs) ? null : path.dirname(abs), roots: ROOTS, entries: out, disk };
  }
  const isText = (buf) => !buf.subarray(0, 8000).includes(0);

  function routes(app) {
    app.get('/api/files', wrap(async (req, res) => res.json(await list(req.query.path))));
    app.get('/api/files/read', wrap(async (req, res) => {
      const abs = await safe(req.query.path);
      const st = await fsp.stat(abs);
      if (st.isDirectory()) throw bad('Dat is een map');
      if (st.size > MAX_TEXT) return res.json({ path: abs, size: st.size, tooBig: true });
      const buf = await fsp.readFile(abs);
      if (!isText(buf)) return res.json({ path: abs, size: st.size, binary: true });
      res.json({ path: abs, size: st.size, mtime: st.mtimeMs, text: buf.toString('utf8') });
    }));
    app.post('/api/files/write', wrap(async (req, res) => {
      const abs = await safe(req.body.path, { mustExist: false });
      const text = String(req.body.text ?? '');
      if (Buffer.byteLength(text) > MAX_TEXT) throw bad('Te groot om hier te bewaren (max 2 MB)');
      const cur = await fsp.stat(abs).catch(() => null);
      if (cur && req.body.mtime && Math.abs(cur.mtimeMs - Number(req.body.mtime)) > 1) throw bad('Dit bestand is ondertussen ergens anders gewijzigd. Laad het opnieuw.', 409);
      if (cur) { await fsp.mkdir(EDITS, { recursive: true }); await fsp.copyFile(abs, path.join(EDITS, `${stamp()}-${path.basename(abs)}`)); }
      await fsp.writeFile(abs, text);
      const st = await fsp.stat(abs);
      res.json({ ok: true, mtime: st.mtimeMs, size: st.size });
    }));
    app.post('/api/files/mkdir', wrap(async (req, res) => {
      const dir = await safe(req.body.path);
      const p = path.join(dir, cleanName(req.body.name));
      await fsp.mkdir(p);
      res.json({ ok: true, path: p });
    }));
    app.post('/api/files/rename', wrap(async (req, res) => {
      const from = await safe(req.body.path);
      if (ROOTS.includes(from)) throw bad('Deze map kan je niet hernoemen');
      const to = path.join(path.dirname(from), cleanName(req.body.name));
      if (fs.existsSync(to)) throw bad('Er bestaat al iets met die naam', 409);
      await fsp.rename(from, to);
      res.json({ ok: true, path: to });
    }));
    app.post('/api/files/chmod', wrap(async (req, res) => {
      const abs = await safe(req.body.path);
      const mode = String(req.body.mode || '');
      if (!/^[0-7]{3}$/.test(mode)) throw bad('Rechten zijn 3 cijfers, bv. 644 of 755');
      await fsp.chmod(abs, parseInt(mode, 8));
      res.json({ ok: true });
    }));
    // verwijderen = naar de prullenbak (kan je zelf leegmaken)
    app.post('/api/files/delete', wrap(async (req, res) => {
      const paths = Array.isArray(req.body.paths) ? req.body.paths.slice(0, 200) : [];
      const dest = path.join(TRASH, stamp());
      await fsp.mkdir(dest, { recursive: true });
      let n = 0;
      for (const p of paths) {
        const abs = await safe(p);
        if (ROOTS.includes(abs) || (!ROOTS.includes(META) && (inside(abs, META) || inside(META, abs))) || inside(TRASH, abs)) throw bad(`"${path.basename(abs)}" kan je hier niet verwijderen`);
        await fsp.rename(abs, path.join(dest, path.basename(abs))).catch(async (e) => {
          if (e.code !== 'EXDEV') throw e; // andere schijf: kopiëren en dan wissen
          await fsp.cp(abs, path.join(dest, path.basename(abs)), { recursive: true }); await fsp.rm(abs, { recursive: true, force: true });
        });
        n++;
      }
      res.json({ ok: true, moved: n, trash: dest });
    }));
    app.get('/api/files/trash', wrap(async (req, res) => {
      let size = 0, count = 0;
      const walk = async (d) => { for (const e of await fsp.readdir(d, { withFileTypes: true }).catch(() => [])) { const p = path.join(d, e.name); if (e.isDirectory()) await walk(p); else { count++; size += (await fsp.stat(p).catch(() => ({ size: 0 }))).size; } } };
      await walk(TRASH);
      res.json({ path: TRASH, size, count });
    }));
    app.post('/api/files/trash/empty', wrap(async (req, res) => {
      await ctx.requireStepUp(req, 'de prullenbak leegmaken');
      await fsp.rm(TRASH, { recursive: true, force: true });
      res.json({ ok: true });
    }));
    app.get('/api/files/download', wrap(async (req, res) => {
      const abs = await safe(req.query.path);
      const st = await fsp.stat(abs);
      if (!st.isDirectory()) return res.download(abs, path.basename(abs));
      // een map: als zip (zonder node_modules en .git)
      const AdmZip = require('adm-zip');
      const zip = new AdmZip(); let total = 0;
      const walk = async (d, rel) => {
        for (const e of await fsp.readdir(d, { withFileTypes: true })) {
          if (['node_modules', '.git'].includes(e.name)) continue;
          const p = path.join(d, e.name), r = rel ? `${rel}/${e.name}` : e.name;
          if (e.isDirectory()) await walk(p, r);
          else if (e.isFile()) { const s = await fsp.stat(p); total += s.size; if (total > 1024 ** 3) throw bad('Deze map is te groot om als zip te downloaden (max 1 GB)'); zip.addLocalFile(p, path.posix.dirname(r) === '.' ? '' : path.posix.dirname(r)); }
        }
      };
      await walk(abs, '');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(path.basename(abs))}.zip"`);
      res.type('application/zip').send(zip.toBuffer());
    }));
    app.post('/api/files/upload', uploadDisk.array('files', 200), wrap(async (req, res) => {
      const dir = await safe(req.query.path);
      let n = 0;
      for (const f of req.files || []) {
        const rel = String(f.originalname || 'bestand').split(/[\\/]/).filter((x) => x && x !== '..' && x !== '.');
        const dest = path.join(dir, ...rel);
        if (!inside(dir, dest)) continue;
        await fsp.mkdir(path.dirname(dest), { recursive: true });
        await fsp.rename(f.path, dest).catch(async () => { await fsp.copyFile(f.path, dest); await fsp.rm(f.path, { force: true }); });
        n++;
      }
      res.json({ ok: true, uploaded: n });
    }));
  }

  // zoeken op naam (voor "Zoeken overal"): niet te diep, slaat zware mappen over
  async function search(q, max = 12) {
    const needle = String(q || '').toLowerCase(); if (needle.length < 2) return [];
    const out = []; let seen = 0;
    const walk = async (d, depth) => {
      if (out.length >= max || depth > 4 || seen > 6000) return;
      let ents; try { ents = await fsp.readdir(d, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        seen++;
        if (e.name.startsWith('.') && depth > 0) continue;
        if (['node_modules', '.git', '__pycache__', 'proc'].includes(e.name)) continue;
        const p = path.join(d, e.name);
        if (e.name.toLowerCase().includes(needle)) out.push({ path: p, name: e.name, dir: e.isDirectory() });
        if (out.length >= max) return;
        if (e.isDirectory()) await walk(p, depth + 1);
      }
    };
    for (const r of ROOTS) await walk(r, 0);
    return out;
  }
  return { routes, search, roots: ROOTS };
};
