/* Firewall: welke poorten open staan, wie erbij mag, en wat er tegengehouden wordt (ufw op je server). */
import { $, esc, icon, api, toast, fail, confirmSheet, sheet, emptyState } from '../core.js';

const FROM_LABEL = { lan: 'Alleen thuisnetwerk', tailscale: 'Alleen Tailscale', any: 'Iedereen (internet)', ip: 'Eén IP-adres…' };

export default async function firewallPage(root, ctx) {
  let fw = null;
  root.innerHTML = `
    <div class="top"><a class="iconbtn back" href="#/meer" aria-label="Terug">${icon('left')}</a><div class="grow"><h1>Firewall en poorten</h1><p>Alles dicht, behalve wat jij openzet</p></div>
      <div class="actions"><button class="btn keep" data-r>${icon('refresh', 'sm')}<span class="desk-only">Vernieuwen</span></button><button class="btn keep" data-toggle>…</button></div></div>
    <div data-body><div class="row muted" style="padding:20px"><span class="spinner"></span>Firewall uitlezen op je server…</div></div>`;
  ctx.setFab(null, { hide: true });

  async function load(fresh) {
    try { fw = await api('GET', `/api/firewall${fresh ? '?fresh=1' : ''}`); } catch (e) { $('[data-body]', root).innerHTML = `<div class="card">${emptyState('shield', 'Kon de firewall niet uitlezen', esc(e.message))}</div>`; return; }
    draw();
  }
  const isPublic = (from) => /anywhere|^any$/i.test(from);
  const fromNice = (from) => (isPublic(from) ? 'Iedereen (internet)' : from === fw.lan ? 'Thuisnetwerk' : /^100\.64\./.test(from) ? 'Tailscale' : from);
  function draw() {
    const b = $('[data-body]', root);
    const tg = $('[data-toggle]', root);
    if (!fw.installed) {
      tg.className = 'btn pri keep'; tg.innerHTML = `${icon('shield', 'sm')}Firewall instellen`;
      b.innerHTML = `<div class="card">${emptyState('shield', 'Er staat nog geen firewall aan', 'Met één klik installeert het paneel ufw en zet het alles dicht behalve je websites (80/443), Tailscale, en SSH + het paneel vanaf thuis. Zo sluit je jezelf nooit buiten.')}</div>`;
      return;
    }
    tg.className = `btn keep ${fw.active ? '' : 'pri'}`; tg.innerHTML = fw.active ? `${icon('power', 'sm')}Uitzetten…` : `${icon('shield', 'sm')}Aanzetten`;
    const rules = fw.rules.filter((r) => !r.v6);
    const pub = rules.filter((r) => r.action === 'ALLOW' && isPublic(r.from)).length;
    const ruled = new Set(); for (const r of rules) for (const m of String(r.to).matchAll(/\d+/g)) ruled.add(Number(m[0]));
    b.innerHTML = `
      <div class="kv">
        <div class="card dark"><div class="l">Status</div><div class="v">${fw.active ? 'Aan' : 'Uit'}</div><div class="s">${fw.active ? 'inkomend standaard geweigerd' : 'alles staat open'}</div></div>
        <div class="card"><div class="l">Open naar internet</div><div class="v">${pub} regel${pub === 1 ? '' : 's'}</div><div class="s">de rest enkel thuis / Tailscale</div></div>
        <div class="card"><div class="l">Tegengehouden (24 u)</div><div class="v num">${fw.blocked24h.toLocaleString('nl-BE')}</div><div class="s">${fw.recent.length ? `laatst: poort ${fw.recent[0].port || '?'}` : 'niets gelogd'}</div></div>
        <div class="card"><div class="l">Thuisnetwerk</div><div class="v mono" style="font-size:16px;margin-top:4px">${esc(fw.lan)}</div><div class="s">Tailscale: 100.64.0.0/10</div></div>
      </div>
      <div class="grid fw-grid">
        <div class="card">
          <h3>${icon('shield')}Poorten en regels</h3>
          <div class="tbl-wrap"><table class="tbl fw-tbl"><thead><tr><th>#</th><th>Poort</th><th>Waarvoor</th><th>Toegang van</th><th>Actie</th><th></th></tr></thead><tbody>
            ${rules.length ? rules.map((r) => `<tr><td class="faint">${r.num}</td><td class="mono"><b>${esc(r.to)}</b></td><td>${esc(r.comment || '–')}</td><td><span class="tag ${isPublic(r.from) ? 'dark' : ''}">${esc(fromNice(r.from))}</span></td><td class="small">${r.action === 'ALLOW' ? 'toelaten' : r.action === 'LIMIT' ? 'beperken' : 'weigeren'}</td><td style="text-align:right"><button class="btn icon sm ghost" data-del="${r.num}" aria-label="Regel ${r.num} verwijderen">${icon('trash', 'sm')}</button></td></tr>`).join('') : '<tr><td colspan="6" class="muted">Nog geen regels.</td></tr>'}
          </tbody></table></div>
          <form class="fw-add" data-add>
            <label class="field"><span>Poort</span><input name="port" inputmode="numeric" placeholder="8096" required></label>
            <label class="field"><span>Type</span><select name="proto"><option value="tcp">TCP</option><option value="udp">UDP</option><option value="">beide</option></select></label>
            <label class="field"><span>Toegang van</span><select name="from">${Object.entries(FROM_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
            <label class="field hidden" data-ip><span>IP-adres</span><input name="ip" placeholder="203.0.113.10"></label>
            <label class="field grow"><span>Omschrijving</span><input name="comment" placeholder="bv. Jellyfin"></label>
            <button class="btn pri">${icon('plus', 'sm')}Regel toevoegen</button>
          </form>
          <p class="faint small" style="margin-top:8px">Let op: poorten die Docker zelf publiceert (bv. <code>"8080:80"</code>) gaan buiten ufw om. Wil je die niet op internet, stuur ze dan niet door in je router of zet <code>127.0.0.1:</code> ervoor.</p>
        </div>
        <div class="col">
          <div class="card"><h3>${icon('activity')}Luistert nu op je server</h3><p class="sub">Programma's die een poort gebruiken</p>
            <div class="list-rows" style="margin-top:6px">${(fw.listening || []).filter((l) => l.port < 32768).slice(0, 14).map((l) => `<div class="lr"><span class="mono num" style="width:52px">${l.port}</span><span class="grow ellipsis">${esc(l.proc || '?')} <span class="faint small">${l.proto}</span></span>${ruled.has(l.port) ? '<span class="tag">regel</span>' : `<button class="link small" data-quick="${l.port}" data-proc="${esc(l.proc)}">+ regel</button>`}</div>`).join('') || '<p class="muted small">Niets gevonden.</p>'}</div></div>
          <div class="card"><h3>${icon('alert')}Laatst tegengehouden</h3>
            <div class="list-rows" style="margin-top:6px">${fw.recent.length ? fw.recent.map((x) => `<div class="lr small"><span class="muted" style="width:96px">${esc(x.t || '')}</span><span class="grow mono">${esc(x.src)}</span><span class="num">:${x.port || '?'}</span></div>`).join('') : '<p class="muted small">Niets tegengehouden (of logging staat uit).</p>'}</div>
            <p class="faint small" style="margin-top:8px">SSH en het paneel blijven altijd bereikbaar van thuis en via Tailscale, zodat je jezelf nooit buitensluit.</p></div>
        </div>
      </div>`;
    const form = $('[data-add]', b);
    form.from.onchange = () => $('[data-ip]', b).classList.toggle('hidden', form.from.value !== 'ip');
    form.onsubmit = async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(form));
      if (body.from === 'any' && !(await confirmSheet(`Poort <b>${esc(body.port)}</b> wordt bereikbaar voor <b>iedereen op internet</b> (als je router hem doorstuurt). Zeker?`, { title: 'Open naar internet', ok: 'Ja, openzetten' }))) return;
      try { await api('POST', '/api/firewall/rule', body); toast('Regel toegevoegd'); load(true); } catch (er) { fail(er); }
    };
  }
  root.addEventListener('click', async (e) => {
    const d = e.target.closest('[data-del]');
    if (d) {
      const r = fw.rules.find((x) => String(x.num) === d.dataset.del);
      if (!(await confirmSheet(`Regel <b>${esc(r ? `${r.to} – ${r.comment || fromNice(r.from)}` : d.dataset.del)}</b> verwijderen?`, { title: 'Regel verwijderen', ok: 'Verwijderen', danger: true }))) return;
      try { await api('POST', '/api/firewall/delete', { num: Number(d.dataset.del) }); toast('Verwijderd'); load(true); } catch (er) { fail(er); }
      return;
    }
    const qk = e.target.closest('[data-quick]');
    if (qk) { const f = $('[data-add]', root); f.port.value = qk.dataset.quick; f.comment.value = qk.dataset.proc || ''; f.port.focus(); f.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  });
  $('[data-r]', root).onclick = () => load(true);
  $('[data-toggle]', root).onclick = async () => {
    if (!fw) return;
    const on = !fw.installed || !fw.active;
    const msg = on
      ? 'De firewall gaat aan: alles inkomend wordt geweigerd, <b>behalve</b> je websites (80 en 443), Tailscale, en SSH + het paneel vanaf thuis en via Tailscale.'
      : 'Zonder firewall staat elke poort op je server open voor je netwerk. Toch uitzetten?';
    if (!(await confirmSheet(msg, { title: on ? 'Firewall aanzetten' : 'Firewall uitzetten', ok: on ? 'Aanzetten' : 'Uitzetten', danger: !on }))) return;
    try { await api('POST', '/api/firewall/toggle', { on }); toast(on ? 'Firewall staat aan' : 'Firewall staat uit'); load(true); } catch (er) { fail(er); }
  };
  await load();
}
