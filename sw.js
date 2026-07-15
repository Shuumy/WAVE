// WAVE service worker — cache applicatif et injection du pont Samsung
const CACHE_NAME = 'wave-v19';
const LOCAL_BRIDGE_ORIGINS = ['http://127.0.0.1:8765', 'http://localhost:8765'];
const ASSETS = [
  './', './index.html', './css/style.css', './js/db.js', './js/tracks.js',
  './js/player.js', './js/samsung-bridge.js', './js/app.js', './manifest.json',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
  )));
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);

  // Laisse Chrome contacter directement le serveur loopback de Termux.
  // Le pont répond lui-même aux vérifications CORS et Private Network Access.
  if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return;

  if (url.origin !== self.location.origin) {
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
  let response;
  try {
    response = await fetch(request, { cache: 'no-cache' });
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put('./index.html', response.clone());
    }
  } catch {
    response = await caches.match('./index.html');
  }

  if (!response) return new Response('WAVE indisponible hors ligne', { status: 503 });
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;

  let html = await response.text();
  const localSources = LOCAL_BRIDGE_ORIGINS.join(' ');

  if (!LOCAL_BRIDGE_ORIGINS.every(origin => html.includes(origin))) {
    html = html.replace(
      "connect-src 'self' https://wave-docker.onrender.com https://fonts.googleapis.com;",
      `connect-src 'self' https://wave-docker.onrender.com https://fonts.googleapis.com ${localSources};`
    );
  }

  if (!html.includes('./js/samsung-bridge.js')) {
    html = html.replace(
      '<script src="./js/app.js"></script>',
      '<script src="./js/samsung-bridge.js"></script>\n  <script src="./js/app.js"></script>'
    );
  }

  const headers = new Headers(response.headers);
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.delete('content-length');

  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
