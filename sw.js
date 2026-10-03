// WAVE service worker — fichiers de l'application disponibles hors ligne.
const CACHE_NAME = 'wave-v38';
const ASSETS = [
  './js/mobile-interactions.js',
  './js/identify.js',
  './js/locales.js', './js/i18n.js',
  './', './index.html', './css/style.css', './css/ratings.css', './js/db.js', './js/tracks.js',
  './js/player.js', './js/samsung-bridge.js', './js/playlist-colors.js', './js/organizer-drag.js', './js/navigation-motion.js', './js/app.js', './js/ratings.js', './manifest.json',
  './assets/icons/icon-192-v2.png', './assets/icons/icon-512-v2.png', './assets/icons/favicon.svg',
  './confidentialite.html', './conditions.html', './css/info.css', './404.html',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith('wave-v') && key !== CACHE_NAME).map(key => caches.delete(key))
  )));
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);

  if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return;

  if (url.origin !== self.location.origin) {
    if (url.href === 'https://cdnjs.cloudflare.com/ajax/libs/jsmediatags/3.9.5/jsmediatags.min.js') {
      event.respondWith(caches.open(CACHE_NAME).then(async cache => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) await cache.put(request,response.clone());
        return response;
      }));
      return;
    }
    event.respondWith(fetch(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(loadAppShell(request));
    return;
  }

  event.respondWith(
    fetch(request, { cache: 'no-cache' }).then(response => {
      if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
      return response;
    }).catch(() => caches.match(request))
  );
});

async function loadAppShell(request) {
  try {
    const response = await fetch(request, { cache: 'no-cache' });
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    return await caches.match(request) || await caches.match('./index.html') ||
      new Response('WAVE indisponible hors ligne', { status: 503 });
  }
}
