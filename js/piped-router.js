/*
 * WAVE — Pont de téléchargement yt-dlp
 *
 * L'application historique appelle encore une route Piped `/streams/{videoId}`.
 * Ce module la remplace par le backend WAVE et corrige aussi les libellés visibles
 * afin que l'interface indique clairement le véritable fournisseur utilisé.
 */
(() => {
  'use strict';

  const API_BASE_URL = window.WAVE_API_BASE_URL || 'https://wave-jc53.onrender.com';
  const nativeFetch = window.fetch.bind(window);

  function parseLegacyStreamsRequest(resource) {
    try {
      const raw = typeof resource === 'string' ? resource : resource?.url;
      const url = new URL(raw, window.location.href);
      const match = url.pathname.match(/\/streams\/([A-Za-z0-9_-]{11})$/);
      return match ? { videoId: match[1] } : null;
    } catch {
      return null;
    }
  }

  function parseWaveDownloadRequest(resource) {
    try {
      const raw = typeof resource === 'string' ? resource : resource?.url;
      const url = new URL(raw, window.location.href);
      if (url.origin !== new URL(API_BASE_URL).origin) return null;
      const match = url.pathname.match(/\/api\/download\/([A-Za-z0-9_-]{11})$/);
      return match ? { videoId: match[1], url } : null;
    } catch {
      return null;
    }
  }

  function buildCompatibilityPayload(videoId) {
    const downloadUrl = new URL(`/api/download/${encodeURIComponent(videoId)}`, API_BASE_URL);
    return {
      title: '',
      uploader: '',
      duration: 0,
      thumbnailUrl: `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`,
      audioStreams: [{
        url: downloadUrl.toString(),
        mimeType: 'application/octet-stream',
        bitrate: 128000,
        quality: 'WAVE yt-dlp',
        format: 'M4A/WebM',
      }],
      waveProvider: 'yt-dlp',
    };
  }

  function replaceLegacyLabels(root = document.body) {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const value = node.nodeValue || '';
      if (!value.includes('Piped') && !value.includes('Invidious')) continue;
      node.nodeValue = value
        .replaceAll('Piped indisponible, essai Invidious...', 'WAVE yt-dlp indisponible')
        .replaceAll('Piped', 'WAVE yt-dlp')
        .replaceAll('Invidious', 'secours');
    }
  }

  window.fetch = async function waveYtDlpFetch(resource, options) {
    const legacy = parseLegacyStreamsRequest(resource);
    if (legacy) {
      console.info(`[WAVE/yt-dlp] Flux préparé pour ${legacy.videoId}`);
      return new Response(JSON.stringify(buildCompatibilityPayload(legacy.videoId)), {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-WAVE-Download-Provider': 'yt-dlp',
        },
      });
    }

    const download = parseWaveDownloadRequest(resource);
    if (!download) return nativeFetch(resource, options);

    const response = await nativeFetch(resource, {
      ...options,
      cache: 'no-store',
      credentials: 'omit',
      headers: {
        Accept: 'application/octet-stream,audio/*,video/*,*/*',
        ...(options?.headers || {}),
      },
    });

    if (!response.ok) {
      let detail = `WAVE yt-dlp indisponible (${response.status})`;
      try {
        const payload = await response.clone().json();
        if (payload?.detail) detail = payload.detail;
      } catch {}
      throw new Error(detail);
    }

    console.info(`[WAVE/yt-dlp] Téléchargement démarré pour ${download.videoId}`);
    return response;
  };

  const observer = new MutationObserver(() => replaceLegacyLabels());
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      replaceLegacyLabels();
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    }, { once: true });
  } else {
    replaceLegacyLabels();
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  window.WAVE_DOWNLOAD_PROVIDER = 'yt-dlp';
})();
