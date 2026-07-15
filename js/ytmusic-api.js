/*
 * WAVE — Adaptateur ytmusicapi
 *
 * Intercepte uniquement les recherches musicales envoyées par l'application
 * aux instances Piped et les redirige vers un endpoint virtuel local. Le
 * service worker relaie ensuite la requête vers le backend Render.
 */
(() => {
  'use strict';

  const API_BASE_URL = 'https://wave-jc53.onrender.com';
  const nativeFetch = window.fetch.bind(window);

  function isPipedMusicSearch(url) {
    try {
      const parsed = new URL(typeof url === 'string' ? url : url.url, window.location.href);
      return parsed.pathname.endsWith('/search') && parsed.searchParams.get('filter') === 'music_songs';
    } catch {
      return false;
    }
  }

  function toPipedItem(track) {
    const videoId = typeof track.videoId === 'string' ? track.videoId : '';
    const thumbnails = Array.isArray(track.thumbnails) ? track.thumbnails : [];
    const thumbnail = thumbnails
      .filter(item => item && typeof item.url === 'string' && item.url.startsWith('https://'))
      .sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url || '';

    return {
      type: 'stream',
      url: `/watch?v=${encodeURIComponent(videoId)}`,
      title: typeof track.title === 'string' ? track.title : '',
      uploaderName: typeof track.artist === 'string'
        ? track.artist
        : Array.isArray(track.artists)
          ? track.artists.map(artist => typeof artist === 'string' ? artist : artist?.name).filter(Boolean).join(', ')
          : '',
      thumbnail,
      duration: Number.isFinite(track.durationSeconds) ? track.durationSeconds : 0,
      waveSource: 'ytmusicapi',
    };
  }

  window.fetch = async function waveFetch(resource, options) {
    if (!isPipedMusicSearch(resource)) {
      return nativeFetch(resource, options);
    }

    const sourceUrl = new URL(typeof resource === 'string' ? resource : resource.url, window.location.href);
    const query = (sourceUrl.searchParams.get('q') || '').trim().slice(0, 200);

    if (!query) {
      return new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Endpoint local virtuel, intercepté par le service worker. Cela évite les
    // problèmes de CSP et garantit que la recherche passe bien par Render.
    const apiUrl = new URL('./__wave_api/search', window.location.href);
    apiUrl.searchParams.set('query', query);
    apiUrl.searchParams.set('limit', '12');

    const response = await nativeFetch(apiUrl.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`WAVE API indisponible (${response.status})`);
    }

    const payload = await response.json();
    const items = Array.isArray(payload.results)
      ? payload.results.filter(track => track && track.videoId).map(toPipedItem)
      : [];

    return new Response(JSON.stringify({ items }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'X-WAVE-Source': 'ytmusicapi' },
    });
  };

  window.WAVE_API_BASE_URL = API_BASE_URL;
  window.WAVE_SEARCH_SOURCE = 'ytmusicapi';
})();