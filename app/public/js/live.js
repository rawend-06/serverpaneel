/* Live-verbinding met de server (Server-Sent Events): de server duwt zelf alles door wat verandert. */
const EVENTS = ['stats', 'containers', 'sites', 'agenda', 'notes', 'expenses', 'countdowns', 'clipboard', 'shares', 'notifications', 'settings', 'speedtest', 'opencloud'];
let es = null, retryT = null, connected = false, wanted = false;
const handlers = new Map();
export const last = {};
function setStatus(v) { if (connected === v) return; connected = v; for (const fn of handlers.get('status') || []) fn(v); }
export function start() {
  wanted = true; if (es) return;
  es = new EventSource('/api/live');
  es.onopen = () => setStatus(true);
  es.onerror = () => {
    setStatus(false);
    if (es && es.readyState === EventSource.CLOSED) { es = null; clearTimeout(retryT); if (wanted) retryT = setTimeout(start, 3000); }
  };
  for (const ev of EVENTS) {
    es.addEventListener(ev, (e) => {
      let d; try { d = JSON.parse(e.data); } catch { return; }
      last[ev] = d; setStatus(true);
      for (const fn of handlers.get(ev) || []) { try { fn(d); } catch (err) { console.error(err); } }
    });
  }
}
export function stop() { wanted = false; clearTimeout(retryT); if (es) es.close(); es = null; setStatus(false); }
export function on(ev, fn) {
  if (!handlers.has(ev)) handlers.set(ev, new Set());
  handlers.get(ev).add(fn);
  if ((ev === 'stats' || ev === 'containers') && last[ev]) fn(last[ev]);
  return () => handlers.get(ev).delete(fn);
}
export const isConnected = () => connected;
// gsm uit slaapstand / tabblad terug: meteen opnieuw verbinden
document.addEventListener('visibilitychange', () => { if (!document.hidden && wanted && !es) start(); });
