/* Apparaten thuis: wie zit er op je netwerk, en computers van op afstand aanzetten (Wake-on-LAN). */
import { $, esc, icon, api, toast, fail, ago, prompt, sheet, confirmSheet, emptyState, debounce } from '../core.js';

export default async function devicesPage(root, ctx) {
  let data = null, q = '';
  root.innerHTML = `
    <div class="top"><a class="iconbtn back" href="#/meer" aria-label="Terug">${icon('left')}</a><div class="grow"><h1>Apparaten thuis</h1><p>Wie zit er op je netwerk · computers van op afstand aanzetten</p></div>
      <div class="actions"><button class="btn keep" data-scan>${icon('wifi', 'sm')}<span class="desk-only">Netwerk scannen</span></button><button class="btn pri keep" data-addwol>${icon('plus', 'sm')}<span class="desk-only">Wake-on-LAN-apparaat</span></button></div></div>
    <div class="grid wol-grid" data-wol></div>
    <div class="card pad0" style="margin-top:12px">
      <div class="files-bar"><h3 class="grow" style="margin:0">${icon('wifi')}Op je netwerk <span class="muted small" data-count></span></h3><label class="sbox sm">${icon('search', 'sm')}<input data-q placeholder="Zoek op naam, IP of MAC" aria-label="Zoek apparaat"></label><button class="row small" data-notify style="gap:8px"><span class="switch" data-sw></span>Melding bij nieuw apparaat</button></div>
      <div data-list><div class="row muted" style="padding:20px"><span class="spinner"></span>Laden…</div></div>
    </div>`;
  ctx.setFab(null, { hide: true });

  async function load(scan) {
    try { data = await api(scan ? 'POST' : 'GET', scan ? '/api/devices/scan' : '/api/devices'); } catch (e) { fail(e); return; }
    draw();
  }
  function draw() {
    $('[data-wol]', root).innerHTML = data.wol.length ? data.wol.map((w) => `
      <div class="card wol ${w.online ? 'on' : ''}">
        <div class="wol-ic">${icon('power')}</div>
        <div class="grow" style="min-width:0"><b class="ellipsis" style="display:block">${esc(w.name)}</b><div class="small muted">${w.online ? `Aan${w.ip ? ` · ${esc(w.ip)}` : ''}` : 'Uit (of slaapt)'}</div><div class="tiny faint mono">${esc(w.mac.toUpperCase())}</div></div>
        <div class="col" style="gap:4px;align-items:flex-end"><button class="btn sm ${w.online ? '' : 'pri'}" data-wake="${w.id}" ${w.online ? 'disabled' : ''}>${w.online ? 'Staat aan' : 'Aanzetten'}</button><button class="link tiny" data-delwol="${w.id}">verwijderen</button></div>
      </div>`).join('') : `<div class="card wol-empty">${emptyState('power', 'Nog geen computers om aan te zetten', 'Voeg je pc of NAS toe met zijn MAC-adres. Zet in de BIOS van die pc "Wake on LAN" aan.')}</div>`;
    const sw = $('[data-sw]', root); sw.classList.toggle('on', data.notifyNew);
    const list = data.devices.filter((d) => !q || `${d.name} ${d.host} ${d.ip} ${d.mac}`.toLowerCase().includes(q));
    $('[data-count]', root).textContent = `· ${data.devices.length} apparaten · ${esc(data.lan)}`;
    $('[data-list]', root).innerHTML = list.length ? `<table class="tbl"><thead><tr><th>Apparaat</th><th>IP</th><th>MAC</th><th>Status</th><th>Eerst gezien</th><th></th></tr></thead><tbody>${list.map((d) => `
      <tr><td><div class="row">${d.isNew ? '<span class="tag dark">NIEUW</span>' : ''}<b>${esc(d.name || d.host || (d.self ? 'Deze server' : 'Onbekend apparaat'))}</b>${d.self ? ' <span class="faint small">(deze server)</span>' : ''}</div>${d.name && d.host ? `<div class="faint small">${esc(d.host)}</div>` : ''}</td>
        <td data-l="IP" class="mono num">${esc(d.ip)}</td><td data-l="MAC" class="mono small muted">${esc(d.mac.toUpperCase())}</td>
        <td data-l="Status"><span class="pill ${d.state === 'ok' ? 'up' : ''}">${d.state === 'ok' ? 'actief' : 'even niet gezien'}</span></td>
        <td data-l="Eerst gezien" class="small muted">${d.firstSeen ? ago(d.firstSeen) : '–'}</td>
        <td style="text-align:right;white-space:nowrap"><button class="btn sm ghost" data-name="${esc(d.mac)}">${icon('edit', 'sm')}Naam</button><button class="btn sm ghost" data-mkwol="${esc(d.mac)}" title="Toevoegen aan Wake-on-LAN">${icon('power', 'sm')}</button></td></tr>`).join('')}</tbody></table>`
      : `<div style="padding:12px">${emptyState('wifi', q ? 'Niets gevonden' : 'Nog geen apparaten gezien', 'Klik op Netwerk scannen.')}</div>`;
  }
  async function addWol(mac = '', name = '') {
    const s = sheet({ title: 'Computer toevoegen', sub: 'Om van op afstand aan te zetten (Wake-on-LAN)', body: `<label class="field"><span>Naam</span><input data-n value="${esc(name)}" placeholder="Gaming-pc"></label><label class="field"><span>MAC-adres</span><input data-m class="mono" value="${esc(mac.toUpperCase())}" placeholder="2C:F0:5D:A1:77:9C"><span class="hint">Op Windows: <code>ipconfig /all</code> → "Fysiek adres". Zet in de BIOS/UEFI "Wake on LAN" aan.</span></label>`, foot: '<button class="btn" data-close>Annuleren</button><button class="btn pri" data-ok>Toevoegen</button>' });
    s.$('[data-ok]').onclick = async () => { try { await api('POST', '/api/devices/wol', { name: s.$('[data-n]').value, mac: s.$('[data-m]').value }); s.close(); toast('Toegevoegd'); load(); } catch (e) { fail(e); } };
  }
  root.addEventListener('click', async (e) => {
    const w = e.target.closest('[data-wake]');
    if (w) {
      w.disabled = true; w.innerHTML = '<span class="spinner"></span>Bezig…';
      try { await api('POST', `/api/devices/wol/${w.dataset.wake}/wake`); toast('Signaal verstuurd – de computer start binnen ± 30 seconden'); setTimeout(() => load(), 20000); setTimeout(() => load(), 5000); } catch (er) { fail(er); load(); }
      return;
    }
    const dw = e.target.closest('[data-delwol]');
    if (dw) { if (!(await confirmSheet('Dit apparaat uit de lijst halen?', { ok: 'Verwijderen', danger: true }))) return; try { await api('POST', `/api/devices/wol/${dw.dataset.delwol}/delete`); load(); } catch (er) { fail(er); } return; }
    const n = e.target.closest('[data-name]');
    if (n) { const d = data.devices.find((x) => x.mac === n.dataset.name); const v = await prompt('Naam geven', { value: d.name || d.host || '', label: `${d.ip} · ${d.mac.toUpperCase()}`, placeholder: 'bv. iPhone van Sam' }); if (v === null) return; try { await api('POST', '/api/devices/name', { mac: d.mac, name: v }); load(); } catch (er) { fail(er); } return; }
    const mk = e.target.closest('[data-mkwol]');
    if (mk) { const d = data.devices.find((x) => x.mac === mk.dataset.mkwol); addWol(d.mac, d.name || d.host); return; }
    if (e.target.closest('[data-notify]')) { try { await api('POST', '/api/devices/settings', { notifyNew: !data.notifyNew }); data.notifyNew = !data.notifyNew; draw(); } catch (er) { fail(er); } }
  });
  $('[data-addwol]', root).onclick = () => addWol();
  $('[data-scan]', root).onclick = async (e) => { const b = e.currentTarget; b.disabled = true; const h = b.innerHTML; b.innerHTML = '<span class="spinner"></span><span class="desk-only">Scannen…</span>'; await load(true); b.disabled = false; b.innerHTML = h; };
  $('[data-q]', root).addEventListener('input', debounce((e) => { q = e.target.value.toLowerCase(); draw(); }, 100));
  await load();
  const iv = setInterval(() => load(), 30000);
  return () => clearInterval(iv);
}
