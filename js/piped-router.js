/*
 * WAVE — Pont de téléchargement yt-dlp
 *
 * L'ancien code de WAVE demande d'abord /streams/{videoId} à une instance
 * Piped. Ce pont intercepte cette requête et renvoie une réponse compatible
 * pointant vers le backend WAVE. Le reste de l'application peut donc rester
 * inchangé, tandis que le fichier audio est produit par yt-dlp sur Render.
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

  function buildCompatibilityPayload(videoId) {
    const downloadUrl = new URL(`/api/download/${encodeURIComponent(videoId)}`, API_BASE_URL);

    return {
      title: '',
      uploader: '',
      duration: 0,
      thumbnailUrl: `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`,
      audioStreams: [
        {
          url: downloadUrl.toString(),
          mimeType: 'audio/mp4',
          bitrate: 128000,
          quality: 'WAVE yt-dlp',
          format: 'M4A/WebM',
        },
      ],
      waveProvider: 'yt-dlp',
    };
  }

  window.fetch = async function waveYtDlpFetch(resource, options) {
    const request = parseLegacyStreamsRequest(resource);
    if (!request) return nativeFetch(resource, options);

    console.info(`[WAVE/yt-dlp] Téléchargement préparé pour ${request.videoId}`);
    return new Response(JSON.stringify(buildCompatibilityPayload(request.videoId)), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-WAVE-Download-Provider': 'yt-dlp',
      },
    });
  };

  window.WAVE_DOWNLOAD_PROVIDER = 'yt-dlp';
})();
