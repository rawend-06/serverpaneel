/* Stroom en energie: wat je server verbruikt en wat dat kost. Gemeten met een slimme stekker, of geschat. */
import { $, esc, icon, api, toast, fail, euro } from '../core.js';
import { line } from '../charts.js';

const RANGES = [['dag', 'Vandaag'], ['week', 'Week'], ['maand', 'Maand'], ['jaar', 'Jaar']];
const nl = (n, d = 1) => (n == null ? '–' : Number(n).toLocaleString('nl-BE', { minimumFractionDigits: d, maximumFractionDigits: d }));

export default async function energyPage(root, ctx) {
  let range = 'dag', data = null;
  root.innerHTML = `
    <div class="top"><a class="iconbtn back" href="#/meer" aria-label="Terug">${icon('left')}</a><div class="grow"><h1>Stroom en energie</h1><p data-how>&nbsp;</p></div>
      <div class="actions"><div class="seg" role="group" aria-label="Periode">${RANGES.map(([k, l]) => `<button data-range="${k}" class="${k === range ? 'on' : ''}" aria-pressed="${k === range}">${l}</button>`).join('')}</div></div></div>
    <div data-body><div class="row muted" style="padding:20px"><span class="spinner"></span>Laden…</div></div>`;
  ctx.setFab(null, { hide: true });

  async function load() {
    try { data = await api('GET', `/api/energy?range=${range}`); } catch (e) { fail(e); return; }
    draw();
  }
  function draw() {
    const c = data.cfg; const kwh = data.kwh[range];
    const label = { dag: 'Vandaag', week: 'Deze week', maand: 'Deze maand', jaar: 'Dit jaar' }[range];
    $('[data-how]', root).textContent = `Bron: ${data.how} · gemeten sinds ${new Date(data.since).toLocaleDateString('nl-BE')}`;
    $('[data-body]', root).innerHTML = `
      <div class="kv">
        <div class="card dark"><div class="l">Nu</div><div class="v">${data.now == null ? '…' : `${Math.round(data.now)} W`}</div><div class="s">piek vandaag ${Math.round(data.peakToday || 0)} W · gemiddeld ${Math.round(data.avgW)} W</div></div>
        <div class="card"><div class="l">${label}</div><div class="v">${nl(kwh, kwh < 10 ? 2 : 1)} kWh</div><div class="s">${range === 'dag' ? 'sinds middernacht' : 'tot nu'}</div></div>
        <div class="card"><div class="l">Kost ${label.toLowerCase()}</div><div class="v" style="color:var(--p)">${euro(kwh * c.price * 100)}</div><div class="s">aan € ${nl(c.price, 2)} per kWh</div></div>
        <div class="card"><div class="l">Per jaar (schatting)</div><div class="v">${euro(data.yearKwh * c.price * 100, 0)}</div><div class="s">${nl(data.yearKwh, 0)} kWh · ± ${nl(data.yearKwh * 0.17, 0)} kg CO₂</div></div>
      </div>
      <div class="card" style="margin-bottom:12px"><h3>${icon('bolt')}${range === 'dag' ? 'Verbruik in watt (laatste 24 uur)' : 'Gemiddeld verbruik per dag (watt)'}</h3><div data-chart style="margin-top:8px"></div></div>
      <div class="grid en-grid">
        <div class="card"><h3>${icon('box')}Wie verbruikt het meest?</h3><p class="sub">Geschat uit het processorgebruik van je containers</p>
          <div class="col" style="margin-top:10px;gap:8px">${data.users.map((u) => `<div><div class="row small"><span class="grow ellipsis">${esc(u.name)}</span><b class="num">${nl(u.w)} W</b></div><div class="meter" style="margin-top:3px"><span style="width:${Math.max(2, Math.round((u.w / Math.max(1, ...data.users.map((x) => x.w))) * 100))}%"></span></div></div>`).join('') || '<p class="muted small">Nog geen gegevens.</p>'}</div></div>
        <div class="card"><h3>${icon('sparkle')}Besparen</h3>
          <div class="list-rows" style="margin-top:6px">
            <div class="lr"><div class="grow"><b>Ongebruikte containers stoppen</b><div class="small muted">Elke draaiende app kost een beetje stroom, ook als niemand ze gebruikt.</div></div><a class="btn sm" href="#/containers">Bekijken</a></div>
            <div class="lr"><div class="grow"><b>Opruimen</b><div class="small muted">Oude images en bouwcache nemen plaats en schijfwerk in.</div></div><a class="btn sm" href="#/server?tab=onderhoud">Opruimen</a></div>
            <div class="lr"><div class="grow"><b>Andere pc's niet de hele nacht aan</b><div class="small muted">Zet ze uit en wek ze met Wake-on-LAN wanneer nodig.</div></div><a class="btn sm" href="#/apparaten">Apparaten</a></div>
          </div></div>
        <form class="card" data-cfg><h3>${icon('sliders')}Instellingen</h3>
          <label class="field" style="margin-top:8px"><span>Stroomprijs (€ per kWh)</span><input name="price" inputmode="decimal" value="${String(c.price).replace('.', ',')}"></label>
          <label class="field"><span>Hoe meten</span><select name="source">
            <option value="estimate" ${c.source === 'estimate' ? 'selected' : ''}>Schatting via processor (geen extra toestel)</option>
            <option value="rapl" ${c.source === 'rapl' ? 'selected' : ''} ${data.raplAvailable ? '' : 'disabled'}>Processor gemeten (Intel RAPL)${data.raplAvailable ? '' : ' – niet leesbaar'}</option>
            <option value="shelly" ${c.source === 'shelly' ? 'selected' : ''}>Slimme stekker – Shelly (exact)</option>
            <option value="tasmota" ${c.source === 'tasmota' ? 'selected' : ''}>Slimme stekker – Tasmota (exact)</option></select></label>
          <label class="field ${c.source === 'shelly' || c.source === 'tasmota' ? '' : 'hidden'}" data-plug><span>IP-adres van de stekker</span><input name="plug" value="${esc(c.plug)}" placeholder="192.168.50.50"></label>
          <div class="row" data-est style="gap:10px"><label class="field grow"><span>Watt in rust</span><input name="idleW" inputmode="decimal" value="${c.idleW}"></label><label class="field grow"><span>Watt bij volle last</span><input name="maxW" inputmode="decimal" value="${c.maxW}"></label></div>
          <label class="field"><span>Melding boven (watt, 0 = uit)</span><input name="alertW" inputmode="numeric" value="${c.alertW}"></label>
          <button class="btn pri block">Bewaren</button>
        </form>
      </div>`;
    const ch = $('[data-chart]', root);
    if (range === 'dag') {
      if (data.chart.length > 1) line(ch, { t: data.chart.map((x) => x[0]), series: [{ name: 'Verbruik', values: data.chart.map((x) => x[1]), cls: 's1' }], fmt: (v) => `${Math.round(v)} W`, area: true, height: 200 });
      else ch.innerHTML = '<p class="muted small">De eerste metingen komen binnen een minuut binnen.</p>';
    } else {
      const max = Math.max(1, ...data.chart.map((x) => x[1] || 0));
      ch.innerHTML = `<div class="bars ${data.chart.length > 40 ? 'dense' : ''}">${data.chart.map(([t, w]) => `<div class="bar" title="${new Date(t).toLocaleDateString('nl-BE')}: ${w == null ? 'geen meting' : `${nl(w)} W gemiddeld`}"><span style="height:${w == null ? 0 : Math.max(3, Math.round((w / max) * 100))}%"></span></div>`).join('')}</div><div class="row tiny faint" style="justify-content:space-between;margin-top:4px"><span>${new Date(data.chart[0][0]).toLocaleDateString('nl-BE')}</span><span>vandaag</span></div>`;
    }
    const f = $('[data-cfg]', root);
    f.source.onchange = () => $('[data-plug]', root).classList.toggle('hidden', !['shelly', 'tasmota'].includes(f.source.value));
    f.onsubmit = async (e) => { e.preventDefault(); try { await api('POST', '/api/energy/config', Object.fromEntries(new FormData(f))); toast('Bewaard'); load(); } catch (er) { fail(er); } };
  }
  root.addEventListener('click', (e) => {
    const r = e.target.closest('[data-range]'); if (!r) return;
    range = r.dataset.range;
    for (const b of root.querySelectorAll('[data-range]')) { b.classList.toggle('on', b === r); b.setAttribute('aria-pressed', b === r); }
    load();
  });
  await load();
  const iv = setInterval(load, 60000);
  return () => clearInterval(iv);
}
