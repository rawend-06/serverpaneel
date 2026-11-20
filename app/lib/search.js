'use strict';
/* Zoeken overal (Ctrl K): sites, containers, databases, apparaten, notities en bestanden in één keer. */
module.exports = function search(ctx) {
  const { DEMO, store, wrap, run } = ctx;
  const has = (q, ...xs) => xs.some((x) => String(x || '').toLowerCase().includes(q));

  async function find(qRaw) {
    const q = String(qRaw || '').trim().toLowerCase(); if (q.length < 2) return [];
    const out = [];
    for (const s of ctx.sites()) if (has(q, s.name, s.domain)) out.push({ group: 'Websites', kind: 'Site', title: s.name, sub: s.domain || (s.type === 'docker' ? 'Docker' : 'website'), url: `#/sites/${encodeURIComponent(s.name)}` });
    const ps = DEMO ? { out: '' } : await run('docker', ['ps', '-a', '--format', '{{.Names}}\t{{.Image}}\t{{.State}}'], { quiet: true });
    const containers = DEMO ? [['caddy', 'caddy:2', 'running'], ['serverpaneel', 'serverpaneel:latest', 'running'], ['vakantie-planner', 'node:22-alpine', 'running'], ['opencloud', 'opencloudeu/opencloud', 'running']] : ps.out.split('\n').filter(Boolean).map((l) => l.split('\t'));
    for (const [name, image, state] of containers) if (has(q, name, image)) out.push({ group: 'Containers', kind: 'Container', title: name, sub: `${image} · ${state === 'running' ? 'draait' : 'gestopt'}`, url: '#/containers', shell: state === 'running' ? name : '' });
    try { for (const d of await ctx.databases.discover()) if (has(q, d.name, d.file)) out.push({ group: 'Databases', kind: 'Database', title: d.name, sub: d.engine, url: '#/databases' }); } catch { /* */ }
    const dev = store.read('devices', { names: {}, wol: [] });
    for (const w of dev.wol) if (has(q, w.name, w.mac)) out.push({ group: 'Apparaten', kind: 'Apparaat', title: w.name, sub: 'Wake-on-LAN', url: '#/apparaten' });
    for (const [mac, name] of Object.entries(dev.names || {})) if (has(q, name, mac)) out.push({ group: 'Apparaten', kind: 'Apparaat', title: name, sub: mac.toUpperCase(), url: '#/apparaten' });
    for (const n of store.read('notes', [])) if (has(q, n.title, n.body)) { out.push({ group: 'Notities', kind: 'Notitie', title: n.title || String(n.body || '').split('\n')[0].slice(0, 60) || 'Notitie', sub: n.folder || '', url: '#/notities' }); if (out.filter((x) => x.group === 'Notities').length >= 6) break; }
    try { for (const f of await ctx.files.search(q, 8)) out.push({ group: 'Bestanden', kind: f.dir ? 'Map' : 'Bestand', title: f.name, sub: f.path, url: `#/bestanden?p=${encodeURIComponent(f.dir ? f.path : f.path.slice(0, Math.max(f.path.lastIndexOf('/'), f.path.lastIndexOf('\\'))))}` }); } catch { /* */ }
    return out.slice(0, 40);
  }
  function routes(app) { app.get('/api/search', wrap(async (req, res) => res.json(await find(req.query.q)))); }
  return { routes, find };
};
