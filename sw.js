// Service worker: la app funciona sin conexión después de la primera carga.
// Cachea el código propio y el motor/modelos de la carpeta mp/ a medida que se piden.
importScripts('version.js'); // define APP_VERSION
const CACHE = 'appsign-' + self.APP_VERSION;
const SHELL = ['./', 'index.html', 'version.js', 'theme.js', 'fonts/atkinson-hyperlegible-latin-400-normal.woff2', 'fonts/atkinson-hyperlegible-latin-700-normal.woff2', 'fonts/outfit-latin-wght-normal.woff2', 'instalar.js', 'app.js', 'core.js', 'config.js', 'library.json', 'manifest.webmanifest', 'icon.svg', 'privacy.html', 'instalar.html', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'icon-180.png'];

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
  if (url.origin !== location.origin) return; // nada de otros sitios: solo se cachea lo propio
  const put = r => { if (r.ok) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(req, cp)); } return r; };
  if (url.pathname.startsWith('/mp/')) {
    // motor y modelos (pesados e inmutables): caché primero
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(put)));
  } else {
    // código propio: red primero (así se actualiza), caché como respaldo
    e.respondWith(fetch(req).then(put).catch(() => caches.match(req)));
  }
});
