'use strict';
/*
 * Projectmap herkennen en zelf bouwen.
 * Je mag gewoon je hele projectmap uploaden (Angular, React, Vite, Vue, ...). Het paneel:
 *   1. ziet wat voor project het is,
 *   2. doet "npm ci" + "npm run build" op de server,
 *   3. zoekt de map met de gebouwde site (index.html) en zet enkel die online.
 * Gewone websites (index.html, maar geen bouwstap) gaan meteen online. Staat de site in een submap (dist/, build/, ...),
 * dan wordt die gevonden.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const OUT_DIRS = ['dist', 'build', 'out', 'public', 'docs', 'site', '_site', 'www', 'html', 'web'];
const SKIP = new Set(['node_modules', '.git', 'src', '.angular', '.next', '.nuxt', '.svelte-kit', '.cache', 'coverage', 'test', 'tests', 'e2e', 'cypress']);

function readJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }
const exists = (p) => fs.existsSync(p);

function detect(dir) {
  const pkg = readJson(path.join(dir, 'package.json'));
  const deps = pkg ? { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) } : {};
  const has = (n) => Object.prototype.hasOwnProperty.call(deps, n);
  let framework = null;
  if (exists(path.join(dir, 'angular.json')) || has('@angular/core')) framework = 'Angular';
  else if (has('next')) framework = 'Next.js';
  else if (has('nuxt')) framework = 'Nuxt';
  else if (has('@sveltejs/kit')) framework = 'SvelteKit';
  else if (has('astro')) framework = 'Astro';
  else if (has('vite')) framework = has('react') ? 'React (Vite)' : has('vue') ? 'Vue (Vite)' : has('svelte') ? 'Svelte (Vite)' : 'Vite';
  else if (has('react-scripts')) framework = 'React';
  else if (has('@vue/cli-service')) framework = 'Vue';
  else if (has('parcel')) framework = 'Parcel';
  else if (has('gatsby')) framework = 'Gatsby';
  const buildScript = pkg && pkg.scripts && pkg.scripts.build ? pkg.scripts.build : null;
  return { pkg: !!pkg, name: pkg && pkg.name, framework, buildScript, lock: exists(path.join(dir, 'package-lock.json')) ? 'npm' : exists(path.join(dir, 'yarn.lock')) ? 'yarn' : exists(path.join(dir, 'pnpm-lock.yaml')) ? 'pnpm' : null, spa: !!framework && !['Next.js', 'Astro', 'Gatsby'].includes(framework) };
}
// verwachte uitvoermap volgens de projectinstellingen
function expectedOut(dir, info) {
  const c = [];
  if (info.framework === 'Angular') {
    const a = readJson(path.join(dir, 'angular.json'));
    if (a && a.projects) {
      const name = a.defaultProject || Object.keys(a.projects)[0];
      const opt = (((a.projects[name] || {}).architect || {}).build || {}).options || {};
      const builder = (((a.projects[name] || {}).architect || {}).build || {}).builder || '';
      let out = opt.outputPath;
      if (out && typeof out === 'object') out = out.base ? path.join(out.base, out.browser === undefined ? 'browser' : out.browser) : null;
      if (typeof out === 'string') { if (/application|browser-esbuild/.test(builder)) c.push(path.join(out, 'browser')); c.push(out); }
      c.push(path.join('dist', name, 'browser'), path.join('dist', name));
    }
  }
  if (info.framework === 'Next.js') c.push('out');
  if (info.framework === 'React') c.push('build');
  if (info.framework === 'SvelteKit') c.push('build');
  if (info.framework === 'Nuxt') c.push('.output/public', 'dist');
  c.push('dist', 'build', 'out', 'public');
  return [...new Set(c)];
}
// zoek de ondiepste map met een index.html (maar niet in node_modules/src/...)
async function findIndexDir(root, maxDepth = 4) {
  const q = [[root, 0]];
  const hits = [];
  while (q.length) {
    const [d, depth] = q.shift();
    let ents; try { ents = await fsp.readdir(d, { withFileTypes: true }); } catch { continue; }
    if (ents.some((e) => e.isFile() && e.name.toLowerCase() === 'index.html')) { hits.push([d, depth]); if (depth === 0) break; continue; }
    if (depth >= maxDepth) continue;
    for (const e of ents) if (e.isDirectory() && !SKIP.has(e.name) && !e.name.startsWith('.')) q.push([path.join(d, e.name), depth + 1]);
  }
  if (!hits.length) return null;
  // voorkeur: bekende uitvoermappen, daarna de ondiepste
  hits.sort((a, b) => {
    const sa = OUT_DIRS.some((o) => path.relative(root, a[0]).split(path.sep)[0] === o) ? 0 : 1;
    const sb = OUT_DIRS.some((o) => path.relative(root, b[0]).split(path.sep)[0] === o) ? 0 : 1;
    return a[1] - b[1] || sa - sb;
  });
  return hits[0][0];
}
// Vite-projecten hebben een index.html in de hoofdmap die NIET de gebouwde site is
function rootIndexIsSource(dir, info) {
  if (!info.buildScript || !exists(path.join(dir, 'index.html'))) return false;
  if (/vite/.test(info.framework || '')) return true;
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  return /<script[^>]+type=["']module["'][^>]+src=["']\/?src\//i.test(html) || /src\/main\.(t|j)sx?/.test(html);
}

/**
 * Bepaalt wat er online moet. Geeft { dir, built, framework, note, spa } terug.
 * run(cmd, args, opts) = de run-functie van het paneel (logt naar de taak)
 */
async function prepare(stage, { job, say, run, buildRoot, siteName, allowBuild = true }) {
  const info = detect(stage);
  const rootIndex = exists(path.join(stage, 'index.html'));
  const needsBuild = info.pkg && info.buildScript && (!rootIndex || rootIndexIsSource(stage, info));
  if (!needsBuild) {
    if (rootIndex) return { dir: stage, built: false, framework: info.framework, spa: false };
    const found = await findIndexDir(stage);
    if (found) {
      say(`Website gevonden in de map "${path.relative(stage, found) || '.'}"`);
      return { dir: found, built: false, framework: info.framework, spa: info.spa };
    }
    throw new Error('Geen index.html gevonden in wat je uploadde. Kies de map van je website (waar index.html in staat), of je projectmap met package.json.');
  }
  if (!allowBuild) throw new Error('Dit project moet eerst gebouwd worden.');
  say(`${info.framework || 'Node'}-project herkend: de server bouwt je site`);
  // vaste bouwmap per site: node_modules blijft bewaard, zodat de volgende keer veel sneller gaat
  const work = path.join(buildRoot, siteName);
  await fsp.mkdir(work, { recursive: true });
  // projectbestanden in de bouwmap zetten (node_modules en oude build laten we staan)
  const r = await run('rsync', ['-a', '--delete', '--exclude=/node_modules', `${stage}/`, `${work}/`], { job, quiet: true });
  if (r.code !== 0) { await fsp.cp(stage, work, { recursive: true, force: true }); }
  const lockFile = info.lock === 'npm' ? 'package-lock.json' : info.lock === 'yarn' ? 'yarn.lock' : info.lock === 'pnpm' ? 'pnpm-lock.yaml' : 'package.json';
  const hash = crypto.createHash('sha1').update(fs.readFileSync(path.join(work, lockFile))).digest('hex');
  const hashFile = path.join(work, 'node_modules', '.paneel-lock');
  const env = { ...process.env, CI: 'true', NODE_ENV: 'development', npm_config_update_notifier: 'false', npm_config_fund: 'false', npm_config_audit: 'false', npm_config_cache: path.join(buildRoot, '.npm'), NG_CLI_ANALYTICS: 'false', NEXT_TELEMETRY_DISABLED: '1' };
  if (exists(hashFile) && fs.readFileSync(hashFile, 'utf8') === hash) say('Pakketten zijn al geïnstalleerd (sneller)');
  else {
    say(info.lock === 'npm' ? 'Pakketten installeren (npm ci)' : 'Pakketten installeren (npm install)');
    const args = info.lock === 'npm' ? ['ci', '--no-audit', '--no-fund', '--loglevel=error'] : ['install', '--no-audit', '--no-fund', '--loglevel=error'];
    const ins = await run('npm', args, { cwd: work, job, env, timeout: 20 * 60e3 });
    if (ins.code !== 0) throw new Error('Pakketten installeren mislukt. Bekijk de technische details.');
    fs.mkdirSync(path.dirname(hashFile), { recursive: true }); fs.writeFileSync(hashFile, hash);
  }
  say(`Site bouwen (npm run build)`);
  // oude build weg, zodat we zeker de nieuwe nemen
  for (const o of expectedOut(work, info)) if (!o.startsWith('public') && o.split(path.sep)[0] !== 'src') await fsp.rm(path.join(work, o), { recursive: true, force: true }).catch(() => {});
  const b = await run('npm', ['run', 'build'], { cwd: work, job, env: { ...env, NODE_ENV: 'production' }, timeout: 20 * 60e3 });
  if (b.code !== 0) throw new Error('Bouwen mislukt. Bekijk de technische details: daar staat de fout uit je project.');
  let out = null;
  for (const o of expectedOut(work, info)) { const p = path.join(work, o); if (exists(path.join(p, 'index.html')) && !(o === 'public' && info.framework && /vite/i.test(info.framework))) { out = p; break; } }
  if (!out) {
    const f = await findIndexDir(work);
    if (f && f !== work) out = f;
  }
  if (!out) throw new Error('De site is gebouwd, maar ik vind geen index.html in de uitvoer (dist/, build/, out/).');
  say(`Gebouwde site gevonden in "${path.relative(work, out)}"`);
  return { dir: out, built: true, framework: info.framework, spa: info.spa };
}

module.exports = { detect, prepare, findIndexDir };
