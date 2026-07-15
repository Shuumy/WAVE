/**
 * WAVE — Service Worker
 *
 * Met en cache les assets locaux, charge l'adaptateur ytmusicapi avant
 * l'application principale et relaie les recherches vers le backend Render.
 */

const CACHE_NAME = 'wave-v7';
const API_ORIGIN = 'https://wave-jc53.onrender.com';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/db.js',
  './js/tracks.js',
  './js/player.js',
  './js/ytmusic-api.js',
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

  // Endpoint local virtuel utilisé par ytmusic-api.js.
  if (url.origin === self.location.origin && url.pathname.endsWith('/__wave_api/search')) {
    event.respondWith(proxySearchToRender(url));
    return;
  }

  // Garantir que l'adaptateur est exécuté avant app.js, même si index.html
  // provient d'un ancien cache ou si la page n'a pas encore été actualisée.
  if (url.origin === self.location.origin && url.pathname.endsWith('/js/app.js')) {
    event.respondWith(loadCombinedApp(request));
    return;
  }

  if (request.mode === 'navigate' && url.origin === self.location.origin) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (url.origin !== self.location.origin) {
    event.respondWith(fetch(request).catch(() => new Response('', { status: 503 })));
    return;
  }

  if (ASSETS.some(asset => url.pathname.endsWith(asset.replace('./', '/')))) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  event.respondWith(fetch(request).catch(() => caches.match(request)));
});

async function proxySearchToRender(localUrl) {
  const query = (localUrl.searchParams.get('query') || '').trim().slice(0, 200);
  const limit = Math.min(25, Math.max(1, Number(localUrl.searchParams.get('limit')) || 12));

  if (!query) {
    return jsonResponse({ query: '', count: 0, results: [] }, 200);
  }

  const upstream = new URL('/api/search', API_ORIGIN);
  upstream.searchParams.set('query', query);
  upstream.searchParams.set('limit', String(limit));

  try {
    const response = await fetch(upstream.toString(), {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });

    const body = await response.text();
    const headers = new Headers({
      'Content-Type': response.headers.get('content-type') || 'application/json',
      'Cache-Control': 'no-store',
      'X-WAVE-Source': 'ytmusicapi',
    });

    return new Response(body, { status: response.status, headers });
  } catch {
    return jsonResponse({ detail: 'WAVE API indisponible' }, 503);
  }
}

async function loadCombinedApp(request) {
  const cache = await caches.open(CACHE_NAME);
  const adapterRequest = new Request(new URL('./js/ytmusic-api.js', self.location.href));

  const [adapterResponse, appResponse] = await Promise.all([
    fetch(adapterRequest, { cache: 'no-cache' }).catch(() => cache.match(adapterRequest)),
    fetch(request, { cache: 'no-cache' }).catch(() => cache.match(request)),
  ]);

  if (!appResponse) return new Response('app.js indisponible', { status: 503 });

  const adapter = adapterResponse ? await adapterResponse.text() : '';
  const app = await appResponse.text();
  const combined = `${adapter}\n\n${app}`;

  return new Response(combined, {
    status: 200,
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-cache',
    },
  });
}

async function networkFirst(request) {
  try {
    const response = await fetch(request, { cache: 'no-cache' });
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return (await caches.match(request)) || new Response('WAVE indisponible hors ligne', { status: 503 });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request).then(response => {
    if (response && response.status === 200) {
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => null);

  return cached || fetchPromise;
}

function jsonResponse(payload, status) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-WAVE-Source': 'ytmusicapi',
    },
  });
}