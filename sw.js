// WAVE service worker — cache applicatif uniquement
const CACHE_NAME = 'wave-v15';
const ASSETS = [
  './', './index.html', './css/style.css', './js/db.js', './js/tracks.js',
  './js/player.js', './js/app.js', './manifest.json',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    event.respondWith(fetch(request));
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request, { cache: 'no-cache' }).catch(() => caches.match('./index.html')));
    return;
  }
  event.respondWith(
    fetch(request, { cache: 'no-cache' }).then(response => {
      if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
      return response;
    }).catch(() => caches.match(request))
  );
});
