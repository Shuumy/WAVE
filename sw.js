/**
 * WAVE — Service Worker
 * SÉCURITÉ : Stratégie cache améliorée avec revalidation réseau.
 * Les assets de l'app sont servis depuis le cache avec mise à jour en arrière-plan.
 */

const CACHE_NAME = 'wave-v4';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/db.js',
  './js/tracks.js',
  './js/player.js',
  './js/app.js',
  './js/soundcloud_ui.js',
  './js/soundcloud_player.js',
  './manifest.json',
];

// ── Install : mise en cache initiale ─────────────────────────────────────────
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .catch(err => console.error('[SW] Cache install failed:', err))
  );
  self.skipWaiting();
});

// ── Activate : suppression des anciens caches ──────────────────────────────────────────────────── 
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ── Fetch : stratégie différenciée par type de ressource ─────────────────────────────────
self.addEventListener('fetch', (e) => {
  const { request } = e;
  const url = new URL(request.url);

  // Ne pas intercepter les requêtes vers des serveurs externes (Piped, Invidious, YouTube)
  // Ces ressources ne doivent pas être mises en cache par le SW
  if (url.origin !== self.location.origin) {
    e.respondWith(fetch(request).catch(() => new Response('', { status: 503 })));
    return;
  }

  // Pour les assets de l'app : stale-while-revalidate
  // ₒ Servir depuis le cache immédiatement, puis mettre à jour en arrière-plan
  if (ASSETS.some(asset => url.pathname.endsWith(asset.replace('./', '/')))) {
    e.respondWith(staleWhileRevalidate(request));
    return;
  }

  // Pour tout le reste (IndexedDB, blob:, etc.) : réseau en priorité
  e.respondWith(
    fetch(request).catch(() => caches.match(request))
  );
});

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  // Lancer la mise à jour réseau en arrière-plan
  const fetchPromise = fetch(request).then(response => {
    if (response && response.status === 200) {
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => null);

  // Retourner le cache immédiatement s'il existe, sinon attendre le réseau
  return cached || fetchPromise;
}
