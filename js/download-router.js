/*
 * WAVE — Routeur de téléchargement yt-dlp
 *
 * L'interface historique demande des métadonnées de flux avant de télécharger.
 * Ce module conserve ce contrat interne, mais toutes les données et le fichier
 * audio proviennent exclusivement du backend WAVE.
 */
(() => {
  'use strict';

  const API_BASE_URL = window.WAVE_API_BASE_URL || 'https://wave-docker.onrender.com';
  const nativeFetch = window.fetch.bind(window);

  function parseLegacyStreamRequest(resource) {
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
      return match ? { videoId: match[1] } : null;
    } catch {
      return null;
    }
  }

  function compatibilityPayload(videoId) {
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
        quality: 'WAVE yt-dlp + PO Token',
        format: 'M4A/WebM',
      }],
      waveProvider: 'yt-dlp+bgutil',
    };
  }

  function replaceOldProviderLabels(root = document.body) {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    for (const node of nodes) {
      const value = node.nodeValue || '';
      if (!/Piped|Invidious/i.test(value)) continue;
      node.nodeValue = value
        .replace(/Piped indisponible, essai Invidious\.\.\./gi, 'WAVE yt-dlp indisponible')
        .replace(/Recherche via Piped/gi, 'Préparation via WAVE yt-dlp')
        .replace(/Piped/gi, 'WAVE yt-dlp')
        .replace(/Invidious/gi, 'service de secours');
    }
  }

  window.fetch = async function waveDownloadFetch(resource, options) {
    const legacy = parseLegacyStreamRequest(resource);
    if (legacy) {
      console.info(`[WAVE/yt-dlp] Préparation du téléchargement ${legacy.videoId}`);
      return new Response(JSON.stringify(compatibilityPayload(legacy.videoId)), {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-WAVE-Download-Provider': 'yt-dlp+bgutil',
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

    console.info(`[WAVE/yt-dlp] Téléchargement reçu pour ${download.videoId}`);
    return response;
  };

  const observer = new MutationObserver(() => replaceOldProviderLabels());
  const start = () => {
    replaceOldProviderLabels();
    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }

  window.WAVE_DOWNLOAD_PROVIDER = 'yt-dlp+bgutil';
})();