/*
 * WAVE — Pont local Samsung / Termux
 *
 * La recherche reste servie par le backend WAVE. Seules les requêtes de
 * téléchargement sont redirigées vers le service local qui écoute exclusivement
 * sur le téléphone, à l'adresse http://127.0.0.1:8765.
 */
(() => {
  'use strict';

  const REMOTE_API_ORIGIN = 'https://wave-docker.onrender.com';
  const LOCAL_BRIDGE_ORIGIN = 'http://127.0.0.1:8765';
  const DOWNLOAD_PATH = /^\/api\/download\/([A-Za-z0-9_-]{11})$/;
  const nativeFetch = window.fetch.bind(window);

  let bridgeState = 'unknown';
  let statusText = 'Vérification du Samsung…';
  let card = null;
  let cardCopy = null;
  let cardDot = null;

  function requestUrl(resource) {
    try {
      const raw = typeof resource === 'string' ? resource : resource?.url;
      return new URL(raw, window.location.href);
    } catch {
      return null;
    }
  }

  function localDownloadUrl(videoId) {
    return `${LOCAL_BRIDGE_ORIGIN}/api/download/${encodeURIComponent(videoId)}`;
  }

  function updateCard() {
    if (!card || !cardCopy || !cardDot) return;
    card.dataset.state = bridgeState;
    cardCopy.textContent = statusText;
    cardDot.dataset.state = bridgeState;
  }

  function setBridgeState(state, text) {
    bridgeState = state;
    statusText = text;
    updateCard();
    window.dispatchEvent(new CustomEvent('wave:samsung-bridge', {
      detail: { state, text, origin: LOCAL_BRIDGE_ORIGIN },
    }));
  }

  async function checkBridge() {
    setBridgeState('checking', 'Vérification du Samsung…');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    try {
      const response = await nativeFetch(`${LOCAL_BRIDGE_ORIGIN}/api/health`, {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (payload?.status !== 'ok') throw new Error('Service non prêt');
      setBridgeState('ready', `Samsung connecté · yt-dlp ${payload.ytDlpVersion || 'prêt'}`);
      return payload;
    } catch {
      setBridgeState('offline', 'Termux arrêté · lance la commande wave-start');
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  window.fetch = async function waveSamsungFetch(resource, options) {
    const url = requestUrl(resource);
    const match = url && url.origin === REMOTE_API_ORIGIN
      ? url.pathname.match(DOWNLOAD_PATH)
      : null;

    if (!match) return nativeFetch(resource, options);

    const videoId = match[1];
    setBridgeState('downloading', 'Téléchargement en cours sur le Samsung…');
    try {
      const response = await nativeFetch(localDownloadUrl(videoId), {
        ...(options || {}),
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
      });
      setBridgeState('ready', response.ok
        ? 'Samsung connecté · téléchargement local'
        : `Samsung connecté · erreur ${response.status}`);
      return response;
    } catch (error) {
      setBridgeState('offline', 'Termux arrêté · lance la commande wave-start');
      throw new Error('Pont Samsung hors ligne. Ouvre Termux puis lance wave-start.', { cause: error });
    }
  };

  function installBridgeCard() {
    const oldCard = document.querySelector('.notube-external-card');
    if (!oldCard) return;

    const style = document.createElement('style');
    style.textContent = `
      .notube-external-card#waveSamsungBridgeCard {
        width:100%; cursor:pointer; font:inherit; text-align:left;
      }
      #waveSamsungBridgeCard[data-state='ready'] { border-color:rgba(34,197,94,.55); }
      #waveSamsungBridgeCard[data-state='offline'] { border-color:rgba(239,68,68,.45); }
      #waveSamsungBridgeCard[data-state='checking'],
      #waveSamsungBridgeCard[data-state='downloading'] { border-color:rgba(255,204,0,.55); }
      .wave-local-dot {
        width:10px; height:10px; border-radius:50%; flex-shrink:0;
        background:#777; box-shadow:0 0 0 4px rgba(255,255,255,.04);
      }
      .wave-local-dot[data-state='ready'] { background:#22c55e; box-shadow:0 0 9px rgba(34,197,94,.8); }
      .wave-local-dot[data-state='offline'] { background:#ef4444; box-shadow:0 0 9px rgba(239,68,68,.55); }
      .wave-local-dot[data-state='checking'],
      .wave-local-dot[data-state='downloading'] { background:#ffcc00; animation:waveLocalPulse 1s infinite alternate; }
      @keyframes waveLocalPulse { from { opacity:.45; } to { opacity:1; } }
    `;
    document.head.appendChild(style);

    const divider = document.querySelector('.external-download-divider');
    if (divider) divider.textContent = 'Téléchargement local Samsung';

    card = document.createElement('button');
    card.type = 'button';
    card.id = 'waveSamsungBridgeCard';
    card.className = oldCard.className;
    card.setAttribute('aria-label', 'Vérifier le pont local Samsung');
    card.innerHTML = `
      <span class="notube-external-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <rect x="6" y="2" width="12" height="20" rx="2"/>
          <path d="M10 18h4"/>
          <path d="M9 7h6M9 11h6"/>
        </svg>
      </span>
      <span class="notube-external-copy">
        <strong>Pont Samsung</strong>
        <small id="waveSamsungBridgeCopy">Vérification du Samsung…</small>
      </span>
      <span class="wave-local-dot" id="waveSamsungBridgeDot" aria-hidden="true"></span>
    `;
    oldCard.replaceWith(card);
    cardCopy = card.querySelector('#waveSamsungBridgeCopy');
    cardDot = card.querySelector('#waveSamsungBridgeDot');
    card.addEventListener('click', checkBridge);
    updateCard();
    checkBridge();
  }

  window.WAVE_SAMSUNG_BRIDGE = {
    origin: LOCAL_BRIDGE_ORIGIN,
    check: checkBridge,
    get state() { return bridgeState; },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installBridgeCard, { once: true });
  } else {
    installBridgeCard();
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkBridge();
  });
})();
