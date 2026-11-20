/* Instellingen: account en beveiliging, meldingen, agenda + gsm-synchronisatie, weergave. */
import { $, $$, esc, icon, api, toast, fail, sheet, confirmSheet, prompt, ago, fmtBytes, copyText, ls, IS_IOS, STANDALONE, emptyState, bus, debounce } from '../core.js';
import * as Live from '../live.js';
import { pushState, enablePush, disablePush, setTheme } from '../main.js';
import { loadCals, calendarSettings, addCalendar, alarmLabel } from './agenda.js';

const SECTIONS = [['account', 'Account', 'lock'], ['meldingen', 'Meldingen', 'bell'], ['agenda', 'Agenda', 'cal'], ['gsm', 'Gsm koppelen', 'repeat'], ['weergave', 'Weergave', 'sun']];

export default async function settings(root, ctx) {
  let sec = SECTIONS.some((s) => s[0] === ctx.params[0]) ? ctx.params[0] : 'account';
  root.innerHTML = `<div class="top"><a class="iconbtn back" href="#/meer" aria-label="Terug">${icon('left')}</a><div class="grow"><h1>Instellingen</h1><p class="small faint">versie ${esc(ctx.app.version)}</p></div></div>
    <div class="tabs">${SECTIONS.map(([k, l]) => `<button data-s="${k}" class="${k === sec ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div data-body style="max-width:760px"></div>`;
  ctx.setFab(null, { hide: true });
  let cleanup = null;
  function show(s) {
    if (cleanup) { cleanup(); cleanup = null; }
    sec = s; $$('[data-s]', root).forEach((b) => b.classList.toggle('on', b.dataset.s === s));
    history.replaceState(null, '', `#/instellingen/${s}`);
    const b = $('[data-body]', root); b.innerHTML = '<div class="row muted" style="padding:16px"><span class="spinner"></span></div>';
    Promise.resolve(({ account, meldingen, agenda, gsm, weergave })[s](b, ctx)).then((c) => { cleanup = typeof c === 'function' ? c : null; }).catch((e) => { b.innerHTML = `<p class="error">${esc(e.message)}</p>`; });
  }
  root.addEventListener('click', (e) => { const t = e.target.closest('[data-s]'); if (t) show(t.dataset.s); });
  show(sec);
  return { cleanup: () => cleanup && cleanup(), update: (r) => { if (r.params[0] && r.params[0] !== sec) show(r.params[0]); return true; } };
}
const row = (ic, label, val, attrs = '') => `<div class="rw ${attrs ? 'click' : ''}" ${attrs}>${icon(ic)}<span class="grow">${label}</span>${val ? `<span class="v">${val}</span>` : ''}</div>`;

// ======================================================================= account & beveiliging
async function account(b, ctx) {
  const [me, pk, st] = await Promise.all([api('GET', '/api/me'), api('GET', '/api/passkeys').catch(() => ({ list: [], secure: false })), api('GET', '/api/settings')]);
  b.innerHTML = `
    <div class="sec-title">Jij</div>
    <div class="grp"><div class="rw">${icon('users')}<span class="grow">Naam</span><div class="v"><input data-name value="${esc(st.name || 'Rawend')}" style="width:160px"></div></div></div>
    <div class="sec-title">Face ID / vingerafdruk</div>
    <div class="grp">
      ${pk.list.length ? pk.list.map((p) => `<div class="rw">${icon('face')}<span class="grow">${esc(p.name)}<br><small class="faint">${esc(p.rpID)} · ${p.lastUsed ? `laatst ${esc(ago(p.lastUsed))}` : `toegevoegd ${esc(ago(p.createdAt))}`}${p.here ? '' : ' · ander adres'}</small></span><button class="btn ghost icon sm" data-pkdel="${esc(p.id)}" aria-label="Verwijderen">${icon('trash', 'sm')}</button></div>`).join('') : ''}
      <div class="rw click" data-pkadd>${icon('plus')}<span class="grow">${pk.list.length ? 'Nog een toestel toevoegen' : 'Inloggen met Face ID instellen'}</span>${icon('right', 'sm')}</div>
    </div>
    ${pk.secure ? '' : `<p class="small faint" style="margin:-4px 4px 12px">Face ID werkt enkel via https (je domein), niet via het lokale IP.</p>`}
    <div class="sec-title">Tweestapsverificatie (2FA)</div>
    <div class="grp" data-2fa>${me.totp ? `<div class="rw">${icon('shield')}<span class="grow">Staat aan<br><small class="faint">Bij inloggen met wachtwoord vraagt het paneel ook een code</small></span><span class="tag ok">aan</span></div><div class="rw click" data-2faoff style="color:var(--bad)">${icon('x')}<span class="grow">2FA uitzetten</span></div>`
      : `<div class="rw click" data-2faon>${icon('shield')}<span class="grow">2FA instellen<br><small class="faint">Sterk aangeraden: je paneel is via internet bereikbaar</small></span>${icon('right', 'sm')}</div>`}</div>
    <div class="sec-title">Wachtwoord</div>
    <div class="card flat"><form data-pw>
      <label class="field"><span>Huidig wachtwoord</span><input type="password" name="old" autocomplete="current-password" required></label>
      <label class="field"><span>Nieuw wachtwoord (min. 10 tekens)</span><input type="password" name="new" autocomplete="new-password" minlength="10" required></label>
      <p class="error" data-err></p><button class="btn pri">Wijzigen</button></form></div>
    <div class="sec-title">Sessie</div>
    <div class="grp"><div class="rw click" data-logout style="color:var(--bad)">${icon('logout')}<span class="grow">Uitloggen op dit toestel</span></div></div>`;
  $('[data-name]', b).addEventListener('change', async (e) => { try { ctx.app.settings = await api('PUT', '/api/settings', { name: e.target.value }); toast('Bewaard'); } catch (x) { fail(x); } });
  $('[data-pw]', b).onsubmit = async (e) => { e.preventDefault(); const f = e.target; const err = $('[data-err]', f); err.textContent = ''; try { await api('POST', '/api/password', { old: f.old.value, new: f.new.value }); f.reset(); toast('Wachtwoord gewijzigd', { icon: 'tick' }); } catch (x) { err.textContent = x.message; } };
  $('[data-logout]', b).onclick = async () => { await api('POST', '/api/logout').catch(() => {}); location.hash = '#/'; location.reload(); };
  $('[data-pkadd]', b).onclick = async () => {
    try {
      const name = await prompt('Naam voor dit toestel', { value: IS_IOS ? 'iPhone' : /Android/.test(navigator.userAgent) ? 'Android' : 'Laptop', ok: 'Verder' }); if (name == null) return;
      const o = await api('POST', '/api/passkeys/options', {});
      const resp = await window.SimpleWebAuthnBrowser.startRegistration({ optionsJSON: o.options });
      await api('POST', '/api/passkeys/verify', { id: o.id, response: resp, name });
      toast('Face ID ingesteld! Volgende keer log je zo in.', { icon: 'face' }); account(b, ctx);
    } catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') fail(e); }
  };
  $$('[data-pkdel]', b).forEach((x) => { x.onclick = async () => { if (!(await confirmSheet('Dit toestel kan dan niet meer met Face ID inloggen.', { title: 'Verwijderen?', ok: 'Verwijderen', danger: true }))) return; try { await api('DELETE', `/api/passkeys/${encodeURIComponent(x.dataset.pkdel)}`); account(b, ctx); } catch (e) { fail(e); } }; });
  const on = $('[data-2faon]', b);
  if (on) on.onclick = async () => {
    try {
      const r = await api('POST', '/api/2fa/setup');
      const s = sheet({ title: '2FA instellen', body: `<p class="small"><b>1.</b> Scan deze code met Google Authenticator, Microsoft Authenticator of een andere app:</p><img class="qr" src="${r.qr}" alt="QR-code" width="200" height="200"><p class="small muted">Lukt scannen niet? Typ deze code: <code>${esc(r.secret)}</code></p><label class="field" style="margin-top:12px"><span><b>2.</b> Vul de 6 cijfers uit de app in</span><input class="code-input" data-code inputmode="numeric" maxlength="6" placeholder="••••••" autocomplete="one-time-code"></label><p class="error" data-err></p>`, foot: '<button class="btn" data-close>Annuleren</button><button class="btn pri" data-ok>Bevestigen</button>' });
      const go = async () => { try { await api('POST', '/api/2fa/enable', { code: s.$('[data-code]').value }); s.close(); toast('2FA staat aan', { icon: 'shield' }); account(b, ctx); } catch (x) { s.$('[data-err]').textContent = x.message; } };
      s.$('[data-ok]').onclick = go; s.$('[data-code]').addEventListener('input', (e) => { if (/^\d{6}$/.test(e.target.value)) go(); });
    } catch (e) { fail(e); }
  };
  const off = $('[data-2faoff]', b);
  if (off) off.onclick = async () => { const pw = await prompt('2FA uitzetten', { label: 'Je wachtwoord', type: 'password', ok: 'Uitzetten' }); if (pw == null) return; try { await api('POST', '/api/2fa/disable', { password: pw }); toast('2FA uitgezet'); account(b, ctx); } catch (e) { fail(e); } };
}

// ======================================================================= meldingen
async function meldingen(b, ctx) {
  const [st, ps, devs] = await Promise.all([api('GET', '/api/settings'), pushState().catch(() => ({ supported: false })), api('GET', '/api/push/devices').catch(() => [])]);
  const P = [['reminders', 'Herinneringen van afspraken', 'cal'], ['tasks', 'Taken die vandaag af moeten', 'tasks'], ['evening', 'Elke avond: je dag van morgen + meenemen', 'bag'], ['countdown', 'Aftellen (nog 1 dag, vandaag)', 'flag'], ['sites', 'Een site gaat offline of komt terug', 'globe'], ['server', 'Server: te warm, schijf bijna vol, herstart', 'server']];
  b.innerHTML = `
    <div class="sec-title">Dit toestel</div>
    <div class="grp">${!ps.supported ? `<div class="rw">${icon('info')}<span class="grow">${ps.noSw ? 'Meldingen werken pas als het paneel via https geopend is (je domein), niet via het lokale IP.' : ps.iosNeedsInstall ? 'Op iPhone: open Safari → Deel → <b>Zet op beginscherm</b>, en open het paneel van daar. Dan kan je meldingen aanzetten.' : 'Deze browser ondersteunt geen meldingen.'}</span></div>`
      : `<div class="rw">${icon('bell')}<span class="grow">Meldingen op dit toestel<br><small class="faint">${ps.enabled ? 'Staan aan' : ps.permission === 'denied' ? 'Geweigerd in je browser – zet ze aan bij de site-instellingen' : 'Staan uit'}</small></span><button class="tog ${ps.enabled ? 'on' : ''}" data-push></button></div>`}
      <div class="rw click" data-test>${icon('send')}<span class="grow">Testmelding sturen</span></div>
      <div class="rw click" data-etest>${icon('bag')}<span class="grow">Avondoverzicht nu sturen (test)</span></div></div>
    <div class="sec-title">Avondoverzicht</div>
    <div class="grp"><div class="rw">${icon('moon')}<span class="grow">Elke avond een melding met je dag van morgen en wat je moet meenemen</span><button class="tog ${st.evening.enabled ? 'on' : ''}" data-even></button></div>
      <div class="rw">${icon('clock')}<span class="grow">Om</span><div class="v"><input type="time" data-etime value="${esc(st.evening.time)}"></div></div></div>
    <div class="sec-title">Waarover?</div>
    <div class="grp">${P.map(([k, l, ic]) => `<div class="rw">${icon(ic)}<span class="grow">${l}</span><button class="tog ${st.push[k] !== false ? 'on' : ''}" data-pk="${k}"></button></div>`).join('')}</div>
    <div class="sec-title">Toestellen met meldingen</div>
    <div class="grp">${devs.length ? devs.map((d) => `<div class="rw">${icon(/iPhone|Android/.test(d.name) ? 'bell' : 'layout')}<span class="grow">${esc(d.name)}<br><small class="faint">${d.lastError ? `<span class="late">${esc(d.lastError)}</span>` : d.lastOk ? `laatste melding ${esc(ago(d.lastOk))}` : `toegevoegd ${esc(ago(d.createdAt))}`}</small></span><button class="btn ghost icon sm" data-ddel="${esc(d.id)}">${icon('trash', 'sm')}</button></div>`).join('') : `<div class="rw faint">Nog geen toestellen</div>`}</div>`;
  const save = async (patch) => { try { await api('PUT', '/api/settings', patch); } catch (e) { fail(e); } };
  const pt = $('[data-push]', b);
  if (pt) pt.onclick = async () => { try { if (pt.classList.contains('on')) { await disablePush(); toast('Meldingen uit op dit toestel'); } else { await enablePush(); toast('Meldingen staan aan', { icon: 'bell' }); } meldingen(b, ctx); } catch (e) { fail(e); } };
  $('[data-test]', b).onclick = async () => { try { await api('POST', '/api/push/test'); toast('Verstuurd – kijk op je toestel(len)', { icon: 'send' }); } catch (e) { fail(e); } };
  $('[data-etest]', b).onclick = async () => { try { await api('POST', '/api/push/evening-test'); toast('Avondoverzicht verstuurd', { icon: 'bag' }); } catch (e) { fail(e); } };
  $('[data-even]', b).onclick = (e) => { const t = e.currentTarget; t.classList.toggle('on'); save({ evening: { ...st.evening, enabled: t.classList.contains('on'), time: $('[data-etime]', b).value } }); };
  $('[data-etime]', b).onchange = (e) => save({ evening: { ...st.evening, enabled: $('[data-even]', b).classList.contains('on'), time: e.target.value } });
  $$('[data-pk]', b).forEach((t) => { t.onclick = () => { t.classList.toggle('on'); st.push[t.dataset.pk] = t.classList.contains('on'); save({ push: st.push }); }; });
  $$('[data-ddel]', b).forEach((x) => { x.onclick = async () => { try { await api('DELETE', `/api/push/devices/${x.dataset.ddel}`); meldingen(b, ctx); } catch (e) { fail(e); } }; });
}

// ======================================================================= agenda
async function agenda(b, ctx) {
  const [cals, st] = await Promise.all([loadCals(true), api('GET', '/api/settings')]);
  const dav = cals.filter((c) => c.kind === 'dav');
  const ALARMS = [[0, 'Op het moment zelf'], [5, '5 min'], [10, '10 min'], [15, '15 min'], [30, '30 min'], [60, '1 uur'], [1440, '1 dag']];
  b.innerHTML = `
    <div class="sec-title">Agenda's en takenlijsten</div>
    <div class="grp">${cals.map((c) => `<div class="rw click" data-cal="${esc(c.id)}"><span style="width:14px;height:14px;border-radius:5px;background:${esc(c.color)};flex:none"></span><span class="grow">${esc(c.name)}<br><small class="faint">${c.kind === 'holidays' ? 'automatisch' : c.kind === 'subscription' ? 'abonnement' : c.todos && !c.events ? 'takenlijst' : 'agenda'}${c.bring && c.bring.length ? ` · meenemen: ${esc(c.bring.join(', '))}` : ''}${c.shareToken ? ' · gedeeld' : ''}</small></span>${icon('right', 'sm')}</div>`).join('')}
      <div class="rw click" data-addcal>${icon('plus')}<span class="grow">Agenda, takenlijst of abonnement toevoegen</span></div></div>
    <div class="sec-title">Standaard</div>
    <div class="grp">
      <div class="rw">${icon('cal')}<span class="grow">Nieuwe afspraken in</span><div class="v"><select data-k="defaultCal">${dav.filter((c) => c.events).map((c) => `<option value="${esc(c.id)}" ${c.id === st.defaultCal ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div></div>
      <div class="rw">${icon('bell')}<span class="grow">Herinnering</span><div class="v"><select data-k="defaultAlarm">${ALARMS.map(([m, l]) => `<option value="${m}" ${m === st.defaultAlarm ? 'selected' : ''}>${l}${m ? ' vooraf' : ''}</option>`).join('')}<option value="-1" ${st.defaultAlarm === -1 ? 'selected' : ''}>Geen</option></select></div></div>
      <div class="rw">${icon('layout')}<span class="grow">Beginweergave</span><div class="v"><select data-k="agendaView">${[['day', 'Dag'], ['3day', '3 dagen'], ['week', 'Week'], ['month', 'Maand'], ['list', 'Lijst']].map(([v, l]) => `<option value="${v}" ${v === st.agendaView ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
      <div class="rw">${icon('cal')}<span class="grow">Week begint op</span><div class="v"><select data-k="weekStart"><option value="1" ${st.weekStart === 1 ? 'selected' : ''}>maandag</option><option value="0" ${st.weekStart === 0 ? 'selected' : ''}>zondag</option></select></div></div>
    </div>
    <div class="sec-title">Werkdiensten (snel invullen)</div>
    <p class="small muted" style="margin:-4px 4px 10px">Typ ze in of kies ze in het afspraak-venster.</p>
    <div class="grp" data-shifts></div>
    <button class="btn sm" data-addshift>${icon('plus', 'sm')}Dienst toevoegen</button>`;
  $$('[data-cal]', b).forEach((r) => { r.onclick = () => calendarSettings(cals.find((c) => c.id === r.dataset.cal), () => agenda(b, ctx)); });
  $('[data-addcal]', b).onclick = () => addCalendar(() => agenda(b, ctx));
  $$('[data-k]', b).forEach((s) => { s.onchange = async () => { const v = s.dataset.k === 'defaultAlarm' || s.dataset.k === 'weekStart' ? Number(s.value) : s.value; try { ctx.app.settings = await api('PUT', '/api/settings', { [s.dataset.k]: v }); bus.emit('settings', ctx.app.settings); toast('Bewaard'); } catch (e) { fail(e); } }; });
  let shifts = (st.shiftTemplates || []).map((x) => ({ ...x }));
  const drawShifts = () => {
    $('[data-shifts]', b).innerHTML = shifts.length ? shifts.map((x, i) => `<div class="rw" data-i="${i}" style="flex-wrap:wrap;gap:8px"><input data-f="name" value="${esc(x.name)}" placeholder="Naam" style="flex:1;min-width:120px"><input type="time" data-f="start" value="${esc(x.start)}" style="width:110px"><span class="faint">–</span><input type="time" data-f="end" value="${esc(x.end)}" style="width:110px"><select data-f="cal" style="width:auto">${dav.filter((c) => c.events).map((c) => `<option value="${esc(c.id)}" ${c.id === x.cal ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select><button class="btn ghost icon sm" data-sdel>${icon('trash', 'sm')}</button></div>`).join('') : '<div class="rw faint">Nog geen diensten</div>';
  };
  const saveShifts = async () => { try { await api('PUT', '/api/settings', { shiftTemplates: shifts.map((x) => ({ ...x, title: x.title && x.title !== x.name ? x.title : `Werk · ${x.name.toLowerCase()}` })) }); toast('Bewaard'); } catch (e) { fail(e); } };
  drawShifts();
  $('[data-shifts]', b).addEventListener('change', (e) => { const r = e.target.closest('[data-i]'); if (!r) return; shifts[Number(r.dataset.i)][e.target.dataset.f] = e.target.value; saveShifts(); });
  $('[data-shifts]', b).addEventListener('click', (e) => { const d = e.target.closest('[data-sdel]'); if (!d) return; shifts.splice(Number(d.closest('[data-i]').dataset.i), 1); drawShifts(); saveShifts(); });
  $('[data-addshift]', b).onclick = () => { shifts.push({ name: 'Nieuwe dienst', start: '09:00', end: '17:00', cal: 'werk' }); drawShifts(); saveShifts(); };
}

// ======================================================================= gsm koppelen (CalDAV)
function lastRow(s) {
  const l = s.last;
  if (!l) return `<div class="rw">${icon('info')}<span class="grow">Nog geen enkel toestel geprobeerd<br><small class="faint">Probeer nu te verbinden op je gsm – deze pagina ververst vanzelf. Blijft dit staan? Dan komt je gsm niet tot bij je server: controleer het serveradres.</small></span></div>`;
  const when = esc(ago(l.at)), dev = esc(l.dev || 'Toestel');
  const why = {
    user: `verkeerde gebruikersnaam${l.user ? ` „${esc(l.user)}”` : ''} – gebruik <code>${esc(s.user)}</code>`,
    pass: 'verkeerd wachtwoord – maak hieronder een nieuw app-wachtwoord en typ het precies over (je paneel-wachtwoord werkt hier niet)',
    nopw: 'je hebt nog geen app-wachtwoord – maak er hieronder een',
    locked: 'even geblokkeerd na te veel foute pogingen – probeer over een kwartier opnieuw',
    down: 'ingelogd, maar de agenda-dienst draait niet',
  }[l.reason] || 'geweigerd';
  return l.ok
    ? `<div class="rw">${icon('tick')}<span class="grow"><b>${dev} is verbonden</b><br><small class="faint">${when}${l.name ? ` · wachtwoord „${esc(l.name)}”` : ''}</small></span></div>`
    : `<div class="rw">${icon('alert')}<span class="grow"><b>${dev} geweigerd</b><br><small class="faint">${when} · ${why}</small></span></div>`;
}
async function gsm(b) {
  const s = await api('GET', '/api/agenda/sync');
  const host = s.domain || location.host;
  const url = `https://${host}/dav/`;
  b.innerHTML = `
    ${s.ok ? '' : `<div class="note w">${icon('alert')}<span><b>De agenda-dienst draait niet.</b> ${esc(s.error || 'Werk het paneel bij met de nieuwste versie.')}</span></div>`}
    <p class="muted" style="margin:4px 4px 14px;font-size:13.5px">Je agenda en taken staan op je eigen server en verschijnen ook in de agenda-app van je gsm. Wat je daar verandert, zie je hier meteen – en omgekeerd.</p>
    <div class="sec-title">Gegevens</div>
    <div class="grp">
      <div class="rw">${icon('globe')}<span class="grow">Server</span><span class="v"><code>${esc(host)}</code><button class="btn ghost icon sm" data-cp="${esc(host)}">${icon('copy', 'sm')}</button></span></div>
      <div class="rw wrapm">${icon('link')}<span class="grow">Volledige link</span><span class="v"><code>${esc(url)}</code><button class="btn ghost icon sm" data-cp="${esc(url)}">${icon('copy', 'sm')}</button></span></div>
      <div class="rw">${icon('users')}<span class="grow">Gebruikersnaam</span><span class="v"><code>${esc(s.user)}</code><button class="btn ghost icon sm" data-cp="${esc(s.user)}">${icon('copy', 'sm')}</button></span></div>
    </div>
    <div class="sec-title">Laatste verbinding</div>
    <div class="grp">${lastRow(s)}</div>
    <div class="sec-title">App-wachtwoorden</div>
    <p class="small muted" style="margin:-4px 4px 10px">Gebruik een apart wachtwoord per toestel (niet je paneel-wachtwoord). Kwijt of gsm weg? Verwijder het hier.</p>
    <div class="grp">${s.passwords.map((p) => `<div class="rw">${icon('key')}<span class="grow">${esc(p.name)}<br><small class="faint">${p.lastUsed ? `laatst gebruikt ${esc(ago(p.lastUsed))}` : 'nog niet gebruikt'}</small></span><button class="btn ghost icon sm" data-pdel="${esc(p.id)}">${icon('trash', 'sm')}</button></div>`).join('')}
      <div class="rw click" data-pnew>${icon('plus')}<span class="grow">Nieuw app-wachtwoord maken</span>${icon('right', 'sm')}</div></div>
    <div class="sec-title">iPhone</div>
    <div class="card flat"><ol style="padding-left:20px;line-height:1.75;font-size:14px">
      <li>Open <b>Instellingen</b> → <b>Agenda</b> → <b>Accounts</b> → <b>Voeg account toe</b> → <b>Andere</b></li>
      <li>Kies <b>Voeg CalDAV-account toe</b></li>
      <li>Server: <code>${esc(host)}</code> · Gebruikersnaam: <code>${esc(s.user)}</code> · Wachtwoord: een app-wachtwoord van hierboven</li>
      <li>Tik <b>Volgende</b> en zet <b>Agenda's</b> en <b>Herinneringen</b> aan. Je takenlijsten komen dan in Herinneringen.</li></ol></div>
    <div class="sec-title">Android</div>
    <div class="card flat"><ol style="padding-left:20px;line-height:1.75;font-size:14px">
      <li>Installeer de app <b>DAVx⁵</b> (Play Store of F-Droid) en voor taken <b>jtx Board</b> of <b>Tasks.org</b></li>
      <li>In DAVx⁵: <b>+</b> → <b>Inloggen met URL en gebruikersnaam</b></li>
      <li>URL: <code>${esc(url)}</code> · Gebruikersnaam: <code>${esc(s.user)}</code> · Wachtwoord: een app-wachtwoord</li>
      <li>Vink de agenda's en takenlijsten aan. Ze verschijnen in Google Agenda (of je eigen agenda-app).</li></ol></div>
    <div class="sec-title">Laptop</div>
    <div class="card flat small muted">Thunderbird: <b>Nieuwe agenda</b> → <b>Op het netwerk</b> → plak <code>${esc(url)}</code>. Op een Mac: <b>Agenda</b> → <b>Accounts</b> → <b>Andere CalDAV-account</b>.</div>`;
  $$('[data-cp]', b).forEach((x) => { x.onclick = () => copyText(x.dataset.cp); });
  clearInterval(gsm.timer);
  const lastKey = JSON.stringify(s.last || null);
  gsm.timer = setInterval(async () => {
    if (!b.isConnected || document.querySelector('dialog[open]')) { if (!b.isConnected) clearInterval(gsm.timer); return; }
    try { const n = await api('GET', '/api/agenda/sync'); if (JSON.stringify(n.last || null) !== lastKey) gsm(b); } catch { /* */ }
  }, 4000);
  $$('[data-pdel]', b).forEach((x) => { x.onclick = async () => { if (!(await confirmSheet('Een toestel dat dit wachtwoord gebruikt, synchroniseert dan niet meer.', { title: 'Verwijderen?', ok: 'Verwijderen', danger: true }))) return; try { await api('DELETE', `/api/agenda/sync/password/${x.dataset.pdel}`); gsm(b); } catch (e) { fail(e); } }; });
  $('[data-pnew]', b).onclick = async () => {
    const name = await prompt('Voor welk toestel?', { value: IS_IOS ? 'iPhone' : /Android/.test(navigator.userAgent) ? 'Android' : 'Laptop', ok: 'Maken' }); if (name == null) return;
    try {
      const r = await api('POST', '/api/agenda/sync/password', { name });
      const sh = sheet({ title: 'Je app-wachtwoord', sub: 'Je ziet het maar één keer – typ of plak het nu op je toestel.', body: `<div class="card flat" style="text-align:center;padding:22px"><div class="mono" style="font-size:24px;font-weight:700;letter-spacing:.04em" data-pw>${esc(r.password)}</div></div><div class="grp" style="margin-top:12px"><div class="rw"><span class="grow">Gebruikersnaam</span><span class="v"><code>${esc(r.user)}</code></span></div><div class="rw"><span class="grow">Server</span><span class="v"><code>${esc(host)}</code></span></div></div>`, foot: `<button class="btn" data-cpw>${icon('copy', 'sm')}Kopieer</button><button class="btn pri" data-close>Klaar</button>`, onClose: () => gsm(b) });
      sh.$('[data-cpw]').onclick = () => copyText(r.password, 'Wachtwoord gekopieerd');
    } catch (e) { fail(e); }
  };
}

// ======================================================================= weergave
function weergave(b) {
  const cur = ls.get('theme', 'auto');
  b.innerHTML = `<div class="sec-title">Thema</div>
    <div class="seg block" data-theme>${[['auto', 'Zoals mijn toestel'], ['light', 'Licht'], ['dark', 'Donker']].map(([k, l]) => `<button data-v="${k}" class="${k === cur ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="sec-title">Op je beginscherm</div>
    <div class="card flat small muted" style="line-height:1.6">${STANDALONE ? `${icon('tick', 'xs')} Je gebruikt het paneel als app.` : IS_IOS ? 'Safari → <b>Deel</b> → <b>Zet op beginscherm</b>. Dan opent het als een echte app, met meldingen en Face ID.' : 'Chrome/Edge → menu (⋮) → <b>App installeren</b> of <b>Toevoegen aan startscherm</b>.'}</div>
    <div class="sec-title">Sneltoetsen (laptop)</div>
    <div class="grp"><div class="rw"><span class="grow">Snel toevoegen</span><span class="v"><span class="kbd">Ctrl</span> <span class="kbd">K</span></span></div><div class="rw"><span class="grow">Agenda: vandaag / vorige / volgende</span><span class="v"><span class="kbd">T</span> <span class="kbd">←</span> <span class="kbd">→</span></span></div><div class="rw"><span class="grow">Agenda: dag / week / maand</span><span class="v"><span class="kbd">D</span> <span class="kbd">W</span> <span class="kbd">M</span></span></div><div class="rw"><span class="grow">Agenda: nieuwe afspraak</span><span class="v"><span class="kbd">N</span></span></div></div>`;
  $$('[data-v]', b).forEach((x) => { x.onclick = () => { setTheme(x.dataset.v); $$('[data-v]', b).forEach((y) => y.classList.toggle('on', y === x)); }; });
}
export { emptyState, alarmLabel };
