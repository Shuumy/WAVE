/*
 * WAVE — Recherche YouTube Music via le backend FastAPI.
 *
 * Ce module est chargé avant app.js. Il intercepte uniquement la requête de
 * recherche musicale historique (Piped) et la remplace par un appel au backend
 * WAVE fondé sur ytmusicapi. La lecture et le téléchargement restent gérés par
 * les mécanismes existants de WAVE.
 */
(() => {
  'use strict';

  const API_BASE_URL = 'https://wave-docker.onrender.com';
  const nativeFetch = window.fetch.bind(window);

  function setStatus(state, text) {
    window.WAVE_SEARCH_PROVIDER = state;
    window.dispatchEvent(new CustomEvent('wave:search-provider', {
      detail: { state, text, apiBaseUrl: API_BASE_URL },
    }));

    const badge = document.getElementById('waveApiStatus');
    if (!badge) return;
    badge.dataset.state = state;
    badge.textContent = text;
  }

  function installStatusBadge() {
    if (document.getElementById('waveApiStatus')) return;

    const subtitle = document.querySelector('#viewSearch .view-subtitle');
    if (!subtitle) return;

    const style = document.createElement('style');
    style.textContent = `
      #waveApiStatus {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin-left: 8px;
        padding: 3px 8px;
        border: 1px solid rgba(255,255,255,.14);
        border-radius: 999px;
        font-size: 11px;
        line-height: 1.2;
        vertical-align: middle;
        color: #b7b7b7;
        background: rgba(255,255,255,.04);
      }
      #waveApiStatus::before {
        content: '';
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #777;
      }
      #waveApiStatus[data-state='online'] { color: #b9f6ca; border-color: rgba(105,240,174,.28); }
      #waveApiStatus[data-state='online']::before { background: #69f0ae; box-shadow: 0 0 7px rgba(105,240,174,.8); }
      #waveApiStatus[data-state='loading'] { color: #ffe082; border-color: rgba(255,224,130,.28); }
      #waveApiStatus[data-state='loading']::before { background: #ffd54f; }
      #waveApiStatus[data-state='error'] { color: #ff8a80; border-color: rgba(255,138,128,.28); }
      #waveApiStatus[data-state='error']::before { background: #ff5252; }
    `;
    document.head.appendChild(style);

    const badge = document.createElement('span');
    badge.id = 'waveApiStatus';
    badge.dataset.state = 'ready';
    badge.textContent = 'WAVE API prête';
    subtitle.appendChild(badge);
  }

  function isLegacyMusicSearch(resource) {
    try {
      const rawUrl = typeof resource === 'string' ? resource : resource?.url;
      const parsed = new URL(rawUrl, window.location.href);
      return parsed.pathname.endsWith('/search')
        && parsed.searchParams.get('filter') === 'music_songs';
    } catch {
      return false;
    }
  }

  function selectThumbnail(thumbnails) {
    if (!Array.isArray(thumbnails)) return '';
    return thumbnails
      .filter(item => item && typeof item.url === 'string' && item.url.startsWith('https://'))
      .sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url || '';
  }

  function normalizeArtist(track) {
    if (typeof track.artist === 'string' && track.artist.trim()) return track.artist.trim();
    if (!Array.isArray(track.artists)) return '';
    return track.artists
      .map(artist => typeof artist === 'string' ? artist : artist?.name)
      .filter(Boolean)
      .join(', ');
  }

  function toLegacyItem(track) {
    const videoId = typeof track.videoId === 'string' ? track.videoId : '';
    return {
      type: 'stream',
      url: `/watch?v=${encodeURIComponent(videoId)}`,
      title: typeof track.title === 'string' ? track.title : '',
      uploaderName: normalizeArtist(track),
      thumbnail: selectThumbnail(track.thumbnails),
      duration: Number.isFinite(track.durationSeconds) ? track.durationSeconds : 0,
      album: typeof track.album === 'string' ? track.album : track.album?.name || '',
      waveProvider: 'ytmusicapi',
    };
  }

  async function searchWithWaveApi(query) {
    const apiUrl = new URL('/api/search', API_BASE_URL);
    apiUrl.searchParams.set('query', query);
    apiUrl.searchParams.set('limit', '12');

    setStatus('loading', 'Recherche via WAVE API…');

    const response = await nativeFetch(apiUrl.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      credentials: 'omit',
    });

    if (!response.ok) {
      throw new Error(`WAVE API indisponible (${response.status})`);
    }

    const payload = await response.json();
    const items = Array.isArray(payload.results)
      ? payload.results.filter(track => track && track.videoId).map(toLegacyItem)
      : [];

    setStatus('online', `WAVE API · ${items.length} résultat${items.length === 1 ? '' : 's'}`);
    console.info(`[WAVE API] Recherche « ${query} » : ${items.length} résultat(s)`);
    return items;
  }

  window.fetch = async function waveFetch(resource, options) {
    if (!isLegacyMusicSearch(resource)) {
      return nativeFetch(resource, options);
    }

    const sourceUrl = new URL(
      typeof resource === 'string' ? resource : resource.url,
      window.location.href,
    );
    const query = (sourceUrl.searchParams.get('q') || '').trim().slice(0, 200);

    if (!query) {
      return new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    try {
      const items = await searchWithWaveApi(query);
      return new Response(JSON.stringify({ items }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-WAVE-Search-Provider': 'ytmusicapi',
        },
      });
    } catch (error) {
      setStatus('error', 'WAVE API indisponible');
      console.error('[WAVE API] Échec de la recherche :', error);
      throw error;
    }
  };

  window.WAVE_API_BASE_URL = API_BASE_URL;
  window.WAVE_API_SEARCH = searchWithWaveApi;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installStatusBadge, { once: true });
  } else {
    installStatusBadge();
  }
})();