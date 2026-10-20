/* ================================================================
   sw.js — Service Worker do Portal MSB (PWA)
   Estratégia:
   - Navegações (HTML): network-first → cache → offline.html
   - Assets estáticos: cache-first com atualização em background
   - Ignora outras origens (MSAL/Power BI/CDN) e rotas /api e /.auth
   ================================================================ */
const VERSION = 'bm-comest-v4';   // portal Comercial + Estoque (cache próprio) · v2 = recorte MSB · v3 = identidade visual MSB · v4 = recorte de empresa MSB (20/10/26)
const STATIC_CACHE  = VERSION + '-static';
const RUNTIME_CACHE = VERSION + '-runtime';

const PRECACHE = [
  '/index.html',
  '/styles.css',
  '/nav-sidebar.js',
  '/portal-catalogo.js',
  '/perfil-sheet.js',
  '/pwa.js',
  '/manifest.webmanifest',
  '/offline.html',
  '/icons/icon-512.png',
  '/icons/icon-192.png',
  '/icons/apple-touch-icon.png',
  '/icons/logo-msb.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.indexOf(VERSION) !== 0).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // só intercepta a própria origem; deixa MSAL/Power BI/CDN passarem direto
  if (url.origin !== self.location.origin) return;
  // nunca interfere em autenticação/API
  if (url.pathname.startsWith('/.auth') || url.pathname.startsWith('/api')) return;

  // Navegações (páginas HTML): rede primeiro, cai pro cache, depois offline
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('/offline.html')))
    );
    return;
  }

  // Assets estáticos: cache primeiro, revalida em background
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
