// p0pc0rn 3.8 service worker. ONE job: on iOS 27 Safari, part of Juli runs in a second process (engine/llm/split.js), and Safari gives a
// shared worker a process of its own when its script comes with the header Cross-Origin-Embedder-Policy: require-corp. A static host
// can't set that header; this service worker can. It answers exactly one request, engine/llm/lworker_coep.js, with the app's own
// engine/llm/lworker.js plus that header. Every other request goes to the network untouched. It stores nothing and caches nothing
// itself (offline, it uses the browser's own cached copy of lworker.js).
const ONE = /\/engine\/llm\/lworker_coep\.js$/;
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (u.origin !== self.location.origin || !ONE.test(u.pathname)) return;
  e.respondWith((async () => {
    const src = new URL(u.pathname.replace(/lworker_coep\.js$/, 'lworker.js') + u.search, u.origin);
    let r;
    try { r = await fetch(src, { cache: 'no-cache', credentials: 'same-origin' }); }   // checked with the server each time
    catch (x) { r = await fetch(src, { cache: 'force-cache', credentials: 'same-origin' }); }   // offline: the copy the browser has
    if (!r.ok) return r;
    const body = (await r.text()) + '\nself.__SW_SERVED = "require-corp";\n';
    return new Response(body, { status: 200, headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cache-Control': 'no-store' } });
  })());
});
