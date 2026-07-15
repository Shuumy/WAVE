/*
 * WAVE — Routeur dynamique Piped
 *
 * Intercepte les requêtes /streams/{videoId} de l'ancien téléchargeur et teste
 * la liste officielle des instances Piped. Seules les réponses contenant au
 * moins un flux audio HTTPS proxifié sont acceptées.
 */
(() => {
  'use strict';

  const nativeFetch = window.fetch.bind(window);
  const OFFICIAL_PIPED_INSTANCES = [
    'https://pipedapi.kavin.rocks',
    'https://pipedapi-libre.kavin.rocks',
    'https://pipedapi.leptons.xyz',
    'https://pipedapi.nosebs.ru',
    'https://piped-api.privacy.com.de',
    'https://pipedapi.adminforge.de',
    'https://api.piped.yt',
    'https://pipedapi.drgns.space',
    'https://pipedapi.owo.si',
    'https://pipedapi.ducks.party',
    'https://piped-api.codespace.cz',
    'https://pipedapi.reallyaweso.me',
    'https://api.piped.private.coffee',
    'https://pipedapi.darkness.services',
    'https://pipedapi.orangenet.cc',
  ];

  const preferred = [];
  const failedUntil = new Map();
  const FAILURE_TTL = 10 * 60 * 1000;

  function parseStreamsRequest(resource) {
    try {
      const raw = typeof resource === 'string' ? resource : resource?.url;
      const url = new URL(raw, window.location.href);
      const match = url.pathname.match(/\/streams\/([A-Za-z0-9_-]{11})$/);
      return match ? { url, videoId: match[1] } : null;
    } catch {
      return null;
    }
  }

  function isDirectGoogleVideo(url) {
    try {
      return new URL(url).hostname.endsWith('googlevideo.com');
    } catch {
      return true;
    }
  }

  function hasUsableAudio(data) {
    return Array.isArray(data?.audioStreams) && data.audioStreams.some(stream =>
      typeof stream?.url === 'string'
      && stream.url.startsWith('https://')
      && !isDirectGoogleVideo(stream.url)
      && typeof stream?.mimeType === 'string'
    );
  }

  function orderedInstances() {
    const now = Date.now();
    const available = OFFICIAL_PIPED_INSTANCES.filter(instance =>
      !failedUntil.has(instance) || failedUntil.get(instance) <= now
    );
    return [
      ...preferred.filter(instance => available.includes(instance)),
      ...available.filter(instance => !preferred.includes(instance)),
    ];
  }

  async function fetchWithDeadline(url, timeoutMs = 9000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await nativeFetch(url, {
        method: 'GET',
        cache: 'no-store',
        credentials: 'omit',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async function checkInstance(instance, videoId) {
    try {
      const response = await fetchWithDeadline(`${instance}/streams/${encodeURIComponent(videoId)}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!hasUsableAudio(data)) throw new Error('Aucun flux audio proxifié');
      failedUntil.delete(instance);
      const oldIndex = preferred.indexOf(instance);
      if (oldIndex !== -1) preferred.splice(oldIndex, 1);
      preferred.unshift(instance);
      preferred.splice(4);
      return { instance, data };
    } catch (error) {
      failedUntil.set(instance, Date.now() + FAILURE_TTL);
      throw error;
    }
  }

  async function findWorkingInstance(videoId) {
    const candidates = orderedInstances();
    const batchSize = 4;

    for (let offset = 0; offset < candidates.length; offset += batchSize) {
      const batch = candidates.slice(offset, offset + batchSize);
      const winner = await Promise.any(batch.map(instance => checkInstance(instance, videoId)))
        .catch(() => null);
      if (winner) return winner;
    }

    throw new Error('Aucune instance Piped avec flux audio proxifié');
  }

  window.fetch = async function wavePipedFetch(resource, options) {
    const request = parseStreamsRequest(resource);
    if (!request) return nativeFetch(resource, options);

    try {
      const { instance, data } = await findWorkingInstance(request.videoId);
      console.info(`[WAVE/Piped] Instance active : ${instance}`);
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-WAVE-Piped-Instance': instance,
        },
      });
    } catch (error) {
      console.warn('[WAVE/Piped] Aucun serveur utilisable :', error);
      return nativeFetch(resource, options);
    }
  };

  window.WAVE_PIPED_INSTANCES = Object.freeze([...OFFICIAL_PIPED_INSTANCES]);
})();
