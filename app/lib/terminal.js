'use strict';
/*
 * Terminal in je browser. Werkt als SSH, maar dan via het paneel (achter je wachtwoord + 2FA/Face ID).
 * Op de server: een klein hulpcontainertje stapt in je server (nsenter) en start een shell als jouw gebruiker.
 * sudo vraagt gewoon je serverwachtwoord, zoals bij SSH.
 */
const crypto = require('crypto');
const os = require('os');
let pty = null; try { pty = require('node-pty'); } catch { /* niet geïnstalleerd (bv. demo op Windows) */ }
const { WebSocketServer } = require('ws');

module.exports = function terminal(ctx) {
  const { DEMO, run, store, wrap, bad } = ctx;
  const HOST_USER = (process.env.HOST_USER || 'rawend').replace(/[^a-z0-9._-]/gi, '') || 'rawend';
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
  const sessions = new Map();

  function available() { return !!pty; }
  // snelle commando's: één tik = uitvoeren in de open sessie
  const DEFAULT_SNIPPETS = [
    { label: 'Wat draait er?', cmd: 'docker ps --format "table {{.Names}}\t{{.Status}}"' },
    { label: 'Schijfruimte', cmd: 'df -h -x tmpfs -x overlay' },
    { label: 'Live processen', cmd: 'htop || top' },
    { label: 'Geheugen', cmd: 'free -h' },
    { label: 'Temperatuur', cmd: 'sensors' },
    { label: 'Updates installeren', cmd: 'sudo apt update && sudo apt upgrade' },
  ];
  const snippets = () => store.read('terminal-snippets', DEFAULT_SNIPPETS);
  async function containerNames() {
    const r = await run('docker', ['ps', '--format', '{{.Names}}'], { quiet: true });
    return r.out.split('\n').map((x) => x.trim()).filter(Boolean);
  }
  async function spawnShell(cols, rows, container) {
    const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', LANG: 'C.UTF-8' };
    if (container) {
      // shell in een container: bash als die er is, anders sh
      if (DEMO) return { p: pty.spawn(process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || '/bin/bash'), [], { name: 'xterm-256color', cols, rows, cwd: os.homedir(), env }), name: null };
      return { p: pty.spawn('docker', ['exec', '-it', '-e', 'TERM=xterm-256color', container, 'sh', '-c', 'command -v bash >/dev/null && exec bash || exec sh'], { name: 'xterm-256color', cols, rows, env }), name: null };
    }
    if (DEMO || process.env.TERMINAL_LOCAL === '1') {
      const shell = process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || '/bin/bash');
      return { p: pty.spawn(shell, [], { name: 'xterm-256color', cols, rows, cwd: os.homedir(), env }), name: null };
    }
    const img = await ctx.selfImage();
    const name = `serverpaneel-term-${crypto.randomBytes(4).toString('hex')}`;
    const args = ['run', '--rm', '-it', '--name', name, '--privileged', '--pid=host', '--net=host', '-e', 'TERM=xterm-256color', '-e', 'LANG=C.UTF-8', '--entrypoint', 'nsenter', img, '-t', '1', '-m', '-u', '-i', '-n', '-p', '--', 'su', '-', HOST_USER];
    return { p: pty.spawn('docker', args, { name: 'xterm-256color', cols, rows, env }), name };
  }

  // upgrade van http naar websocket op /api/terminal
  function attach(server) {
    server.on('upgrade', (req, socket, head) => {
      if (!req.url.startsWith('/api/terminal')) return; // andere websockets niet onze zaak
      const fail = (code, msg) => { socket.write(`HTTP/1.1 ${code} ${msg}\r\nConnection: close\r\n\r\n`); socket.destroy(); };
      // zelfde herkomst + ingelogd + recent bevestigd
      const origin = req.headers.origin; let oh = ''; try { oh = new URL(origin).host; } catch { /* */ }
      if (!origin || ![req.headers.host, req.headers['x-forwarded-host']].includes(oh)) return fail(403, 'Forbidden');
      const fakeReq = { headers: req.headers };
      if (!ctx.sessionOf(fakeReq)) return fail(401, 'Unauthorized');
      if (!DEMO && !ctx.security.stepUpOk(fakeReq)) return fail(403, 'StepUp');
      if (!pty) return fail(501, 'Not Implemented');
      wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, req));
    });
  }
  async function onConnection(ws, req) {
    const u = new URL(req.url, 'http://x');
    const cols = Math.max(20, Math.min(400, Number(u.searchParams.get('cols')) || 100));
    const rows = Math.max(5, Math.min(200, Number(u.searchParams.get('rows')) || 30));
    const container = u.searchParams.get('container') || '';
    if (container && (!/^[\w.-]{1,128}$/.test(container) || (!DEMO && !(await containerNames()).includes(container)))) { ws.send(JSON.stringify({ t: 'o', d: `\r\nContainer "${container.slice(0, 60)}" draait niet.\r\n` })); ws.close(); return; }
    let s;
    try { s = await spawnShell(cols, rows, container); } catch (e) { ws.send(JSON.stringify({ t: 'o', d: `\r\nTerminal starten mislukt: ${e.message}\r\n` })); ws.close(); return; }
    const id = crypto.randomBytes(6).toString('hex');
    sessions.set(id, s);
    let idle = Date.now();
    s.p.onData((d) => { if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'o', d })); });
    s.p.onExit(({ exitCode }) => { if (ws.readyState === 1) { ws.send(JSON.stringify({ t: 'x', code: exitCode })); ws.close(); } cleanup(); });
    ws.on('message', (m) => {
      let msg; try { msg = JSON.parse(String(m)); } catch { return; }
      idle = Date.now();
      if (msg.t === 'i' && typeof msg.d === 'string') s.p.write(msg.d);
      else if (msg.t === 'r') { try { s.p.resize(Math.max(20, Math.min(400, msg.c | 0)), Math.max(5, Math.min(200, msg.r | 0))); } catch { /* */ } }
    });
    const iv = setInterval(() => { if (Date.now() - idle > 30 * 60e3) { try { ws.send(JSON.stringify({ t: 'o', d: '\r\n[30 minuten niets gedaan: terminal gesloten]\r\n' })); } catch { /* */ } ws.close(); } }, 60e3);
    let cleaned = false;
    function cleanup() {
      if (cleaned) return; cleaned = true; clearInterval(iv); sessions.delete(id);
      try { s.p.kill(); } catch { /* */ }
      if (s.name) run('docker', ['rm', '-f', s.name], { quiet: true }).catch(() => {});
    }
    ws.on('close', cleanup); ws.on('error', cleanup);
  }
  function routes(app) {
    app.get('/api/terminal/info', wrap(async (req, res) => res.json({ available: available(), user: DEMO ? os.userInfo().username : HOST_USER, needsStepUp: !DEMO && !ctx.security.stepUpOk(req), open: sessions.size, snippets: snippets(), containers: DEMO ? ['caddy', 'serverpaneel', 'vakantie-planner', 'opencloud'] : await containerNames() })));
    app.post('/api/terminal/snippets', wrap(async (req, res) => {
      const list = Array.isArray(req.body.snippets) ? req.body.snippets : null;
      if (!list || list.length > 40) throw bad('Ongeldige lijst');
      const clean = list.map((x) => ({ label: String(x.label || '').trim().slice(0, 60), cmd: String(x.cmd || '').trim().slice(0, 500) })).filter((x) => x.label && x.cmd);
      store.write('terminal-snippets', clean);
      res.json(clean);
    }));
  }
  return { attach, routes, available };
};
