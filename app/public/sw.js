/* Rawendpaneel – service worker: werkt ook zonder internet (laatst bekende gegevens) en toont pushmeldingen. */
const VERSION = '__VERSION__';
const ASSETS = __ASSETS__;
const SHELL = `shell-${VERSION}`;
const DATA = 'data-v1';
const OFFLINE_API = /^\/api\/(me|settings|overview|agenda\/(events|calendars|prepare|tomorrow)|tasks|notes|expenses|countdowns|clipboard|shares|notifications|stats|containers)(\?|$|\/quick$)/;

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    await Promise.all(['/', ...ASSETS].map((u) => c.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('shell-') && k !== SHELL) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/dav') || url.pathname.startsWith('/d/') || url.pathname.startsWith('/ics/') || url.pathname.startsWith('/view/') || url.pathname === '/api/live' || url.pathname.includes('/stream')) return;
  // paginabestanden met versie in de naam: eerst uit de cache
  if (url.pathname.startsWith('/v/')) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => { if (r.ok) { const cl = r.clone(); caches.open(SHELL).then((c) => c.put(req, cl)); } return r; })));
    return;
  }
  // de app zelf: eerst online, anders de bewaarde versie
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((r) => { if (r.ok && url.pathname === '/') { const cl = r.clone(); caches.open(SHELL).then((c) => c.put('/', cl)); } return r; }).catch(() => caches.match('/', { ignoreSearch: true })));
    return;
  }
  // gegevens: eerst online, bij geen verbinding de laatst bekende
  if (OFFLINE_API.test(url.pathname)) {
    e.respondWith(fetch(req).then((r) => { if (r.ok) { const cl = r.clone(); caches.open(DATA).then((c) => c.put(req, cl)); } return r; })
      .catch(() => caches.match(req).then((hit) => hit || caches.match(req, { ignoreSearch: true })).then((hit) => hit || new Response(JSON.stringify({ error: 'Je bent offline' }), { status: 503, headers: { 'Content-Type': 'application/json' } }))));
  }
});

// ---------------------------------------------------------------- pushmeldingen
self.addEventListener('push', (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'Rawendpaneel', body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Rawendpaneel', {
    body: d.body || '', tag: d.tag || undefined, renotify: !!d.tag, icon: '/icon-192.png', badge: '/icon-192.png',
    data: { url: d.url || '/' }, timestamp: Date.now(),
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) { if ('focus' in c) { await c.focus(); c.postMessage({ type: 'navigate', url }); return; } }
    await self.clients.openWindow(url);
  })());
});
