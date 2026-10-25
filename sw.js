// Service worker: la app funciona sin conexión después de la primera carga.
// Cachea el código propio y los archivos de MediaPipe (CDN + modelo) a medida que se piden.
const CACHE = 'appsign-v11';
const SHELL = ['./', 'index.html', 'app.js', 'core.js', 'config.js', 'library.json', 'manifest.webmanifest', 'icon.svg', 'privacy.html', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'icon-180.png'];
const EXTERNAL = ['cdn.jsdelivr.net', 'storage.googleapis.com'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const same = url.origin === location.origin;
  if (!same && !EXTERNAL.includes(url.hostname)) return;
  if (same) {
    // red primero para el código propio (así se actualiza), caché como respaldo
    e.respondWith(fetch(req).then(r => { const cp = r.clone(); caches.open(CACHE).then(c => c.put(req, cp)); return r; }).catch(() => caches.match(req)));
  } else {
    // archivos pesados e inmutables: caché primero
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => {
      if (r.ok) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(req, cp)); }
      return r;
    })));
  }
});
