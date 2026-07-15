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
  let statusButton = null;
  let statusCopy = null;
  let statusDot = null;

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

  function updateStatus() {
    if (!statusButton || !statusCopy || !statusDot) return;
    statusButton.dataset.state = bridgeState;
    statusButton.setAttribute('aria-label', statusText);
    statusCopy.textContent = statusText;
    statusDot.dataset.state = bridgeState;
  }

  function setBridgeState(state, text) {
    bridgeState = state;
    statusText = text;
    updateStatus();
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
      setBridgeState('offline', 'Samsung déconnecté · lance wave-start dans Termux');
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
      setBridgeState('offline', 'Samsung déconnecté · lance wave-start dans Termux');
      throw new Error('Pont Samsung hors ligne. Ouvre Termux puis lance wave-start.', { cause: error });
    }
  };

  function installSearchStatus() {
    const searchView = document.querySelector('#viewSearch');
    const searchBar = searchView?.querySelector('.yt-search-bar');
    if (!searchView || !searchBar || document.querySelector('#waveSamsungStatus')) return;

    const style = document.createElement('style');
    style.textContent = `
      #waveSamsungStatus {
        width:100%; display:flex; align-items:center; gap:10px;
        margin:12px 0 14px; padding:10px 12px;
        border:1px solid var(--border); border-radius:var(--radius-sm);
        background:var(--bg-secondary); color:var(--text-secondary);
        font:inherit; font-size:.74rem; text-align:left; cursor:pointer;
        transition:border-color var(--transition), background var(--transition);
      }
      #waveSamsungStatus:hover,
      #waveSamsungStatus:focus-visible { background:var(--bg-hover); outline:none; }
      #waveSamsungStatus[data-state='ready'] { border-color:rgba(34,197,94,.5); color:var(--text-primary); }
      #waveSamsungStatus[data-state='offline'] { border-color:rgba(239,68,68,.38); }
      #waveSamsungStatus[data-state='checking'],
      #waveSamsungStatus[data-state='downloading'] { border-color:rgba(255,204,0,.5); }
      .wave-local-dot {
        width:9px; height:9px; border-radius:50%; flex-shrink:0;
        background:#777; box-shadow:0 0 0 4px rgba(255,255,255,.04);
      }
      .wave-local-dot[data-state='ready'] { background:#22c55e; box-shadow:0 0 9px rgba(34,197,94,.8); }
      .wave-local-dot[data-state='offline'] { background:#ef4444; box-shadow:0 0 8px rgba(239,68,68,.5); }
      .wave-local-dot[data-state='checking'],
      .wave-local-dot[data-state='downloading'] { background:#ffcc00; animation:waveLocalPulse 1s infinite alternate; }
      .wave-samsung-status-copy { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      @keyframes waveLocalPulse { from { opacity:.45; } to { opacity:1; } }
    `;
    document.head.appendChild(style);

    statusButton = document.createElement('button');
    statusButton.type = 'button';
    statusButton.id = 'waveSamsungStatus';
    statusButton.innerHTML = `
      <span class="wave-local-dot" id="waveSamsungStatusDot" aria-hidden="true"></span>
      <span class="wave-samsung-status-copy" id="waveSamsungStatusCopy">Vérification du Samsung…</span>
    `;
    searchBar.before(statusButton);
    statusCopy = statusButton.querySelector('#waveSamsungStatusCopy');
    statusDot = statusButton.querySelector('#waveSamsungStatusDot');
    statusButton.addEventListener('click', checkBridge);
    updateStatus();
    checkBridge();
  }

  window.WAVE_SAMSUNG_BRIDGE = {
    origin: LOCAL_BRIDGE_ORIGIN,
    check: checkBridge,
    get state() { return bridgeState; },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installSearchStatus, { once: true });
  } else {
    installSearchStatus();
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkBridge();
  });
})();
