'use strict';
/*
 * Apps-winkel: kant-en-klare apps met één klik. Het paneel schrijft een docker-compose.yml (met eigen,
 * willekeurige wachtwoorden in .env), start de container en zet er desgewenst een domein met https op.
 * Daarna staat de app gewoon tussen je websites: bijwerken, logs, backups en herstarten werken zoals altijd.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const secret = () => crypto.randomBytes(18).toString('base64url');
const TZ = 'Europe/Brussels';
// p = poort op je server; elke app krijgt zijn gegevens in ./ (de map van de app)
const CATALOG = [
  { id: 'jellyfin', name: 'Jellyfin', cat: 'Media', ram: 400, port: 8096, img: 'jellyfin/jellyfin', desc: 'Je eigen Netflix: films en series streamen naar tv, gsm en laptop.', note: 'Zet je films in de map media van de app.',
    compose: (p) => `services:\n  jellyfin:\n    image: jellyfin/jellyfin:latest\n    restart: unless-stopped\n    ports:\n      - "${p}:8096"\n    volumes:\n      - ./config:/config\n      - ./cache:/cache\n      - ./media:/media\n    environment:\n      - TZ=${TZ}\n` },
  { id: 'vaultwarden', name: 'Vaultwarden', cat: 'Veiligheid', ram: 40, port: 8222, img: 'vaultwarden/server', desc: 'Je eigen wachtwoordkluis, werkt met de Bitwarden-apps op gsm en laptop.', note: 'Werkt enkel via https: geef het een domein.', needsDomain: true,
    env: () => `ADMIN_TOKEN=${secret()}\n`, compose: (p, d) => `services:\n  vaultwarden:\n    image: vaultwarden/server:latest\n    restart: unless-stopped\n    ports:\n      - "${p}:80"\n    volumes:\n      - ./data:/data\n    environment:\n      - TZ=${TZ}\n      - DOMAIN=${d ? `https://${d}` : ''}\n      - ADMIN_TOKEN=\${ADMIN_TOKEN}\n      - SIGNUPS_ALLOWED=true\n` },
  { id: 'uptime-kuma', name: 'Uptime Kuma', cat: 'Controle', ram: 90, port: 3001, img: 'louislam/uptime-kuma', desc: 'Houdt je sites en diensten in de gaten en stuurt een melding als iets plat ligt.',
    compose: (p) => `services:\n  uptime-kuma:\n    image: louislam/uptime-kuma:1\n    restart: unless-stopped\n    ports:\n      - "${p}:3001"\n    volumes:\n      - ./data:/app/data\n` },
  { id: 'home-assistant', name: 'Home Assistant', cat: 'Slim huis', ram: 350, port: 8123, fixedPort: true, img: 'home-assistant/home-assistant', desc: 'Lampen, stopcontacten en sensoren thuis op één plek bedienen en automatiseren.', note: 'Gebruikt het netwerk van de server zelf (poort 8123), zodat het je toestellen vindt.',
    compose: () => `services:\n  homeassistant:\n    image: ghcr.io/home-assistant/home-assistant:stable\n    restart: unless-stopped\n    network_mode: host\n    volumes:\n      - ./config:/config\n      - /etc/localtime:/etc/localtime:ro\n    environment:\n      - TZ=${TZ}\n` },
  { id: 'pihole', name: 'Pi-hole', cat: 'Netwerk', ram: 80, port: 8053, img: 'pihole/pihole', desc: 'Blokkeert reclame en trackers voor alle toestellen thuis.', note: 'Poort 53 (DNS) moet vrij zijn op je server. Zet daarna je router-DNS op het IP van je server.',
    env: () => `WEBPASSWORD=${secret().slice(0, 12)}\n`, compose: (p) => `services:\n  pihole:\n    image: pihole/pihole:latest\n    restart: unless-stopped\n    ports:\n      - "53:53/tcp"\n      - "53:53/udp"\n      - "${p}:80/tcp"\n    volumes:\n      - ./etc-pihole:/etc/pihole\n    environment:\n      - TZ=${TZ}\n      - FTLCONF_webserver_api_password=\${WEBPASSWORD}\n` },
  { id: 'nextcloud', name: 'Nextcloud', cat: 'Opslag', ram: 300, port: 8081, img: 'nextcloud', desc: 'Bestanden, agenda en contacten delen en synchroniseren tussen je toestellen.',
    compose: (p) => `services:\n  nextcloud:\n    image: nextcloud:latest\n    restart: unless-stopped\n    ports:\n      - "${p}:80"\n    volumes:\n      - ./data:/var/www/html\n` },
  { id: 'syncthing', name: 'Syncthing', cat: 'Opslag', ram: 60, port: 8384, img: 'syncthing/syncthing', desc: 'Mappen automatisch gelijk houden tussen je server, laptop en gsm.',
    compose: (p) => `services:\n  syncthing:\n    image: syncthing/syncthing:latest\n    restart: unless-stopped\n    ports:\n      - "${p}:8384"\n      - "22000:22000/tcp"\n      - "22000:22000/udp"\n    volumes:\n      - ./data:/var/syncthing\n` },
  { id: 'code-server', name: 'VS Code in je browser', cat: 'Ontwikkelen', ram: 250, port: 8443, img: 'codercom/code-server', desc: 'Programmeren op je server vanuit elke browser, ook op je tablet.',
    env: () => `PASSWORD=${secret().slice(0, 14)}\n`, compose: (p, d, home) => `services:\n  code:\n    image: codercom/code-server:latest\n    restart: unless-stopped\n    ports:\n      - "${p}:8080"\n    volumes:\n      - ./config:/home/coder/.config\n      - ${home}:/home/coder/project\n    environment:\n      - PASSWORD=\${PASSWORD}\n` },
  { id: 'postgres', name: 'PostgreSQL', cat: 'Database', ram: 60, port: 5432, img: 'postgres', desc: 'Een database voor je eigen apps. Beheer ze daarna onder Databases.', note: 'Enkel bereikbaar vanaf je server zelf (veilig).',
    env: () => `POSTGRES_USER=rawend\nPOSTGRES_PASSWORD=${secret()}\nPOSTGRES_DB=app\n`, compose: (p) => `services:\n  db:\n    image: postgres:16-alpine\n    restart: unless-stopped\n    ports:\n      - "127.0.0.1:${p}:5432"\n    env_file: .env\n    volumes:\n      - ./data:/var/lib/postgresql/data\n` },
  { id: 'mariadb', name: 'MariaDB (MySQL)', cat: 'Database', ram: 90, port: 3306, img: 'mariadb', desc: 'MySQL-database voor bv. WordPress of je eigen PHP-apps.', note: 'Enkel bereikbaar vanaf je server zelf (veilig).',
    env: () => `MARIADB_ROOT_PASSWORD=${secret()}\nMARIADB_DATABASE=app\n`, compose: (p) => `services:\n  db:\n    image: mariadb:11\n    restart: unless-stopped\n    ports:\n      - "127.0.0.1:${p}:3306"\n    env_file: .env\n    volumes:\n      - ./data:/var/lib/mysql\n` },
  { id: 'minecraft', name: 'Minecraft-server', cat: 'Spellen', ram: 2000, port: 25565, img: 'itzg/minecraft-server', desc: 'Een eigen Minecraft-wereld (Java-editie) voor jou en je vrienden.', note: 'Voor vrienden buiten je huis: poort 25565 doorsturen in je router.',
    compose: (p) => `services:\n  minecraft:\n    image: itzg/minecraft-server:latest\n    restart: unless-stopped\n    ports:\n      - "${p}:25565"\n    environment:\n      - EULA=TRUE\n      - MEMORY=2G\n      - TZ=${TZ}\n    volumes:\n      - ./data:/data\n` },
];

module.exports = function apps(ctx) {
  const { CFG, DEMO, wrap, bad, run, metrics } = ctx;
  const APPS_DIR = path.join(CFG.allowedRoot, 'apps');

  async function usedPorts() {
    const used = new Set([CFG.hostPort, 80, 443, 22]);
    for (const s of ctx.sites()) if (s.port) used.add(Number(s.port));
    const r = await run('docker', ['ps', '--format', '{{.Ports}}'], { quiet: true });
    for (const m of r.out.matchAll(/:(\d+)->/g)) used.add(Number(m[1]));
    return used;
  }
  async function images() {
    const r = await run('docker', ['ps', '-a', '--format', '{{.Image}}'], { quiet: true });
    return r.out.split('\n').map((x) => x.trim()).filter(Boolean);
  }
  async function catalog() {
    const [used, imgs] = await Promise.all([usedPorts(), images()]);
    const live = metrics.live();
    const freeRam = live.mem ? live.mem.total - live.mem.used : null;
    const disk = await fsp.statfs(CFG.allowedRoot).then((f) => f.bavail * f.bsize).catch(() => null);
    return {
      freeRam, freeDisk: disk, appsDir: APPS_DIR,
      apps: CATALOG.map((a) => {
        const site = ctx.sites().find((s) => s.appId === a.id || s.name === a.id);
        const running = !site && imgs.some((i) => i.includes(a.img));
        let port = a.port; if (!a.fixedPort) while (used.has(port) && !site) port++;
        return { id: a.id, name: a.name, cat: a.cat, ram: a.ram, desc: a.desc, note: a.note || '', needsDomain: !!a.needsDomain, fixedPort: !!a.fixedPort, image: a.img, port: site ? site.port || a.port : port, portFree: site || !used.has(port), installed: site ? site.name : running ? '(al aanwezig)' : null, domain: site ? site.domain : '' };
      }),
    };
  }
  async function install(b) {
    const a = CATALOG.find((x) => x.id === b.id); if (!a) throw bad('Onbekende app', 404);
    const name = String(b.name || a.id).trim().toLowerCase();
    const port = a.fixedPort ? a.port : Number(b.port || a.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw bad('Ongeldige poort');
    if (!a.fixedPort && (await usedPorts()).has(port)) throw bad(`Poort ${port} is al in gebruik. Kies een andere.`);
    const domain = String(b.domain || '').trim().toLowerCase();
    if (a.needsDomain && !domain) throw bad(`${a.name} werkt enkel via https: vul een domein in (bv. ${a.id}-jouwnaam.duckdns.org)`);
    const dir = path.join(APPS_DIR, name);
    if (fs.existsSync(dir) && fs.readdirSync(dir).length) throw bad(`De map ${dir} bestaat al. Kies een andere naam.`);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, 'docker-compose.yml'), `# gemaakt door de apps-winkel van Rawendpaneel (${a.name})\n${a.compose(port, domain, CFG.allowedRoot)}`);
    if (a.env) await fsp.writeFile(path.join(dir, '.env'), a.env(), { mode: 0o600 });
    try { return ctx.installApp({ name, dir, port: a.id === 'home-assistant' ? 8123 : port, domain, appId: a.id }); }
    catch (e) { if (!DEMO) await fsp.rm(dir, { recursive: true, force: true }); throw e; }
  }
  function routes(app) {
    app.get('/api/apps', wrap(async (req, res) => res.json(await catalog())));
    app.post('/api/apps/install', wrap(async (req, res) => { const job = await install(req.body); res.json({ job: job.id, name: job.site }); }));
  }
  return { routes, catalog };
};
