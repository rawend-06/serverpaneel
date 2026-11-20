#!/usr/bin/env node
'use strict';
/*
 * Controleert vóór elke commit of er geen geheimen in de code sluipen: sleutels, wachtwoorden,
 * echte IP-adressen, je eigen domeinen of e-mailadressen. Vindt het iets, dan stopt de commit.
 * Zelf draaien op alle bestanden:  node .githooks/check-geheimen.js --alles
 * Echt nodig (bv. een voorbeeld)? Zet "geheim-ok" in een commentaar op dezelfde regel.
 */
const { execSync } = require('child_process');

const alles = process.argv.includes('--alles');
const files = execSync(alles ? 'git ls-files' : 'git diff --cached --name-only --diff-filter=ACMR', { encoding: 'utf8' })
  .split('\n').filter(Boolean).filter((f) => !/(^|\/)(package-lock\.json|vendor\/|\.githooks\/check-geheimen\.js$)/.test(f) && !/\.(png|jpe?g|gif|webp|ico|woff2?|ttf|zip|gz)$/i.test(f));

// toegelaten: voorbeeldadressen (RFC 5737), localhost, Docker/Tailscale-reeksen, bekende DNS, voorbeeldnetwerk 192.168.50.x
const OK_IP = /^(127\.|0\.0\.0\.0$|255\.255\.255\.255$|203\.0\.113\.|198\.51\.100\.|192\.0\.2\.|1\.1\.1\.1$|8\.8\.8\.8$|172\.(1[6-9]|2\d|3[01])\.|100\.64\.|192\.168\.50\.|192\.168\.0\.0$|10\.0\.0\.0$)/;
const RULES = [
  ['privésleutel', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['GitHub-token', /\b(ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}/],
  ['AWS-sleutel', /\bAKIA[0-9A-Z]{16}\b/],
  ['Slack-token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['Stripe-sleutel', /\b[sr]k_live_[A-Za-z0-9]{16,}/],
  ['Google-sleutel', /\bAIza[0-9A-Za-z_-]{30,}/],
  ['DuckDNS-token', /\btoken=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i],
  ['wachtwoord of sleutel in de code', /\b(password|passwd|wachtwoord|secret|api[_-]?key|token)\b\s*[:=]\s*['"`][^'"`\s$]{8,}['"`]/i],
  ['e-mailadres', /\b[A-Za-z0-9._%+-]+@(?!users\.noreply\.github\.com|anthropic\.com|example\.(com|org))[A-Za-z0-9.-]+\.[a-z]{2,}\b/i],
];
// Eigen woorden (je domeinen, servernaam, …) staan in .githooks/eigen-woorden.txt: één per regel.
// Dat bestand blijft op je laptop (staat in .gitignore), zodat ook de controle zelf niets verklapt.
try {
  const eigen = require('fs').readFileSync(require('path').join(__dirname, 'eigen-woorden.txt'), 'utf8')
    .split('\n').map((w) => w.trim()).filter((w) => w && !w.startsWith('#'));
  for (const w of eigen) RULES.push(['eigen woord', new RegExp(w.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[a-z0-9-]*'), 'i')]);
} catch { /* geen eigen woorden ingesteld */ }
const IP = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;

const hits = [];
for (const f of files) {
  let txt;
  try { txt = alles ? require('fs').readFileSync(f, 'utf8') : execSync(`git show ":${f}"`, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 }); } catch { continue; }
  txt.split('\n').forEach((line, i) => {
    if (/geheim-ok/.test(line)) return;
    for (const [naam, re] of RULES) if (re.test(line)) hits.push(`${f}:${i + 1}  ${naam}: ${line.trim().slice(0, 120)}`);
    for (const ip of line.match(IP) || []) {
      const parts = ip.split('.').map(Number);
      if (parts.some((p) => p > 255) || OK_IP.test(ip)) continue;
      if (/\d\.\d+\.\d+\.\d/.test(ip) && /version|v\d|@\d/.test(line)) continue; // versienummers
      hits.push(`${f}:${i + 1}  IP-adres ${ip}: ${line.trim().slice(0, 120)}`);
    }
  });
}
if (hits.length) {
  console.error('\n  STOP: mogelijk geheime gegevens gevonden. De commit gaat niet door.\n');
  for (const h of hits) console.error(`  - ${h}`);
  console.error('\n  Haal ze weg (of zet "geheim-ok" op die regel als het echt een voorbeeld is) en probeer opnieuw.\n');
  process.exit(1);
}
if (alles) console.log(`OK: ${files.length} bestanden gecontroleerd, niets gevonden.`);
