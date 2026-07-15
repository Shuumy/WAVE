// WAVE service worker
const CACHE_NAME = 'wave-v11';
const API_ORIGIN = 'https://wave-jc53.onrender.com';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/db.js',
  './js/tracks.js',
  './js/player.js',
  './js/ytmusic-api.js',
  './js/piped-router.js',
  './js/app.js',
  './manifest.json',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .catch(error => console.error('[SW] Cache install failed:', error))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.mode === 'navigate' && url.origin === self.location.origin) {
    event.respondWith(loadAppShell(request));
    return;
  }

  // Recherche et téléchargement yt-dlp restent toujours côté réseau.
  if (url.origin !== self.location.origin) {
    event.respondWith(fetch(request).catch(() => new Response('', { status: 503 })));
    return;
  }

  if (ASSETS.some(asset => url.pathname.endsWith(asset.replace('./', '/')))) {
    event.respondWith(networkFirstAsset(request));
    return;
  }

  event.respondWith(fetch(request).catch(() => caches.match(request)));
});

async function loadAppShell(request) {
  let response;

  try {
    response = await fetch(request, { cache: 'no-cache' });
    const cache = await caches.open(CACHE_NAME);
    if (response.ok) await cache.put('./index.html', response.clone());
  } catch {
    response = await caches.match('./index.html');
  }

  if (!response) return new Response('WAVE indisponible hors ligne', { status: 503 });

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;

  let html = await response.text();

  if (!html.includes(API_ORIGIN)) {
    html = html.replace(
      "connect-src 'self'",
      `connect-src 'self'\n      ${API_ORIGIN}`
    );
  }

  if (!html.includes('./js/ytmusic-api.js')) {
    html = html.replace(
      '<script src="./js/app.js"></script>',
      '<script src="./js/ytmusic-api.js"></script>\n  <script src="./js/piped-router.js"></script>\n  <script src="./js/app.js"></script>'
    );
  } else if (!html.includes('./js/piped-router.js')) {
    html = html.replace(
      '<script src="./js/app.js"></script>',
      '<script src="./js/piped-router.js"></script>\n  <script src="./js/app.js"></script>'
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

async function networkFirstAsset(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request, { cache: 'no-cache' });
    if (response && response.status === 200) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    return (await cache.match(request)) || new Response('', { status: 503 });
  }
}
