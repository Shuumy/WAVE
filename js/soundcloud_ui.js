/** WAVE — SoundCloud UI + search */
(() => {
  const W = window.WaveSC = window.WaveSC || {
    SOUNDCLOUD_CLIENT_IDS: [],
    currentSearchProvider: 'youtube',
    scMode: false,
    scWidget: null,
    scCurrentTrack: null,
    scSearchResults: [],
    scCurrentIndex: -1,
    scProgressInterval: null,
    isDragging: false,
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);
  W.$ = $;
  W.$$ = $$;

  W.esc = function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  W.sanitizeURL = function sanitizeURL(url) {
    if (!url || typeof url !== 'string') return '';
    try {
      const u = new URL(url);
      if (!['https:', 'http:', 'data:', 'blob:'].includes(u.protocol)) return '';
      if (u.protocol === 'data:' && !url.startsWith('data:image/')) return '';
      return url;
    } catch {
      return '';
    }
  };

  W.formatDuration = function formatDuration(seconds) {
    const value = Number(seconds) || 0;
    if (value <= 0) return '0:00';
    const m = Math.floor(value / 60);
    const s = Math.floor(value % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  W.showToast = function showToast(msg) {
    const toast = $('#toast');
    const toastMessage = $('#toastMessage');
    if (!toast || !toastMessage) return;
    if (!msg) {
      toast.classList.remove('show');
      return;
    }
    toastMessage.textContent = msg;
    toast.hidden = false;
    toast.classList.add('show');
    clearTimeout(W.showToastTimer);
    W.showToastTimer = setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => { toast.hidden = true; }, 300);
    }, 2500);
  };

  W.fetchWithTimeout = function fetchWithTimeout(url, opts = {}, ms = 15000) {
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:') return Promise.reject(new Error('HTTPS requis'));
    } catch {
      return Promise.reject(new Error('URL invalide'));
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(t));
  };

  W.ensureSCWidgetScript = function ensureSCWidgetScript() {
    if (window.SC && typeof window.SC.Widget === 'function') return;
    const alreadyThere = document.querySelector('script[data-sc-widget-api]');
    if (alreadyThere) return;
    const s = document.createElement('script');
    s.src = 'https://w.soundcloud.com/player/api.js';
    s.async = true;
    s.dataset.scWidgetApi = '1';
    document.head.appendChild(s);
  };

  W.isSoundCloudUrl = function isSoundCloudUrl(value) {
    try {
      const u = new URL(value);
      return /(^|\.)soundcloud\.com$/i.test(u.hostname) || /(^|\.)on\.soundcloud\.com$/i.test(u.hostname);
    } catch {
      return false;
    }
  };

  W.normalizeSoundCloudArtwork = function normalizeSoundCloudArtwork(url) {
    const safe = W.sanitizeURL(url || '');
    if (!safe) return '';
    return safe.replace('-large.', '-t500x500.');
  };

  W.buildSoundCloudSearchUrl = function buildSoundCloudSearchUrl(query) {
    return `https://soundcloud.com/search?q=${encodeURIComponent(query)}`;
  };

  W.resolveSoundCloudUrl = async function resolveSoundCloudUrl(trackUrl) {
    const safeUrl = W.sanitizeURL(trackUrl);
    if (!safeUrl) throw new Error('Lien SoundCloud invalide');
    const endpoint = `https://soundcloud.com/oembed?format=json&maxheight=166&url=${encodeURIComponent(safeUrl)}`;
    const r = await W.fetchWithTimeout(endpoint, {}, 10000);
    if (!r.ok) throw new Error('Impossible de lire ce lien SoundCloud');
    const data = await r.json();
    return {
      type: 'track',
      permalinkUrl: safeUrl,
      title: data.title || 'SoundCloud',
      artist: data.author_name || 'SoundCloud',
      thumbnail: W.normalizeSoundCloudArtwork(data.thumbnail_url || ''),
    };
  };

  W.searchSoundCloud = async function searchSoundCloud(query) {
    const safeQ = query.trim().slice(0, 200);
    if (!safeQ) return [];

    if (W.isSoundCloudUrl(safeQ)) {
      return [await W.resolveSoundCloudUrl(safeQ)];
    }

    for (const clientId of W.SOUNDCLOUD_CLIENT_IDS.filter(Boolean)) {
      try {
        const endpoint = `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(safeQ)}&client_id=${encodeURIComponent(clientId)}&limit=12`;
        const r = await W.fetchWithTimeout(endpoint, {}, 10000);
        if (!r.ok) continue;
        const data = await r.json();
        const items = (data.collection || [])
          .filter(item => item && item.permalink_url)
          .slice(0, 12)
          .map(item => ({
            type: 'track',
            permalinkUrl: W.sanitizeURL(item.permalink_url) || '',
            title: item.title || 'Sans titre',
            artist: item.user?.username || 'SoundCloud',
            thumbnail: W.normalizeSoundCloudArtwork(item.artwork_url || item.user?.avatar_url || ''),
          }))
          .filter(item => item.permalinkUrl);
        if (items.length) return items;
      } catch {}
    }

    return [{
      type: 'external_search',
      query: safeQ,
      title: `Ouvrir la recherche SoundCloud pour « ${safeQ} »`,
      artist: 'Recherche externe',
      thumbnail: '',
    }];
  };

  W.renderSCResults = function renderSCResults(items) {
    const scResultsContainer = $('#scResults');
    if (!scResultsContainer) return;
    W.scSearchResults = items;
    if (!items.length) {
      scResultsContainer.innerHTML = '<p class="empty-state">Aucun résultat.</p>';
      return;
    }

    scResultsContainer.innerHTML = items.map((item, i) => {
      const thumb = W.sanitizeURL(item.thumbnail || '') || '';
      const isPlaying = item.type === 'track' && W.scCurrentTrack?.permalinkUrl === item.permalinkUrl;
      const buttonTitle = item.type === 'external_search' ? 'Ouvrir SoundCloud' : 'Copier le lien';
      const buttonIcon = item.type === 'external_search'
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 17L17 7"/><polyline points="7 7 17 7 17 17"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
      return `<div class="yt-result-item sc-result-item${isPlaying ? ' yt-playing' : ''}" data-index="${i}">
        <div class="yt-result-thumb">
          ${thumb ? `<img src="${W.esc(thumb)}" alt="" loading="lazy">` : ''}
          <div class="yt-play-overlay"><svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg></div>
        </div>
        <div class="yt-result-info">
          <div class="yt-result-title">${W.esc(item.title || '')}</div>
          <div class="yt-result-channel">${W.esc(item.artist || '')}</div>
        </div>
        <div class="yt-result-actions">
          <button class="yt-copy-btn sc-link-btn" data-index="${i}" title="${buttonTitle}">${buttonIcon}</button>
        </div>
      </div>`;
    }).join('');

    scResultsContainer.querySelectorAll('.sc-result-item').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.sc-link-btn')) return;
        W.playSoundCloudResult(parseInt(el.dataset.index, 10));
      });
    });

    scResultsContainer.querySelectorAll('.sc-link-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const item = W.scSearchResults[parseInt(btn.dataset.index, 10)];
        if (!item) return;
        if (item.type === 'external_search') {
          window.open(W.buildSoundCloudSearchUrl(item.query), '_blank', 'noopener');
          return;
        }
        try {
          await navigator.clipboard.writeText(item.permalinkUrl);
          btn.classList.add('yt-copied');
          setTimeout(() => btn.classList.remove('yt-copied'), 1000);
          W.showToast('Lien copié');
        } catch {
          W.showToast('Impossible de copier');
        }
      });
    });
  };

  W.doSCSearch = async function doSCSearch() {
    const scSearchInput = $('#scSearchInput');
    const scResultsContainer = $('#scResults');
    if (!scSearchInput || !scResultsContainer) return;
    const q = scSearchInput.value.trim();
    if (!q) {
      W.showToast('Tape quelque chose à rechercher');
      return;
    }
    scResultsContainer.innerHTML = '<div class="yt-loading"><div class="spinner"></div></div>';
    try {
      const results = await W.searchSoundCloud(q);
      W.renderSCResults(results);
      if (!W.isSoundCloudUrl(q) && !W.SOUNDCLOUD_CLIENT_IDS.filter(Boolean).length) {
        W.showToast('Astuce : colle un lien SoundCloud pour lecture directe');
      }
    } catch (err) {
      scResultsContainer.innerHTML = `<p class="empty-state" style="color:var(--danger)">${W.esc(err.message || 'Erreur SoundCloud')}</p>`;
      W.showToast('Erreur: ' + String(err.message || 'SoundCloud').slice(0, 60));
    }
  };

  W.injectSoundCloudUI = function injectSoundCloudUI() {
    const searchView = $('#viewSearch');
    const subtitle = searchView?.querySelector('.view-subtitle');
    const ytSearchBar = searchView?.querySelector('.yt-search-bar');
    const ytResults = $('#ytResults');
    if (!searchView || !subtitle || !ytSearchBar || !ytResults) return false;
    if ($('#searchProviderSoundCloud')) return true;

    subtitle.textContent = 'Recherche et écoute sur YouTube et SoundCloud';

    const tabs = document.createElement('div');
    tabs.className = 'library-tabs search-provider-tabs';
    tabs.innerHTML = `
      <button class="tab-btn search-provider-tab active" data-provider="youtube">YouTube</button>
      <button class="tab-btn search-provider-tab" data-provider="soundcloud">SoundCloud</button>`;
    subtitle.insertAdjacentElement('afterend', tabs);

    const ytPanel = document.createElement('div');
    ytPanel.className = 'search-provider-panel active';
    ytPanel.id = 'searchProviderYouTube';
    searchView.insertBefore(ytPanel, ytSearchBar);
    ytPanel.appendChild(ytSearchBar);
    ytPanel.appendChild(ytResults);

    const scPanel = document.createElement('div');
    scPanel.className = 'search-provider-panel';
    scPanel.id = 'searchProviderSoundCloud';
    scPanel.hidden = true;
    scPanel.innerHTML = `
      <div class="yt-search-bar">
        <svg viewBox="0 0 24 24" fill="#ff5500" width="16" height="16" style="flex-shrink:0">
          <path d="M6.1 18h11.1a4.3 4.3 0 0 0 .5-8.5 6.3 6.3 0 0 0-12.1 1.6A3.5 3.5 0 0 0 6.1 18zm-.8-5.5h.8v4.3h-.8zm-1.8 1.2h.8v3.1h-.8zm3.5-2.6h.8v5.7H7zm1.8-1.4h.8v7.1h-.8zm1.8-.8h.8v7.9h-.8zm1.8.8h.8v7.1h-.8zm1.8 1h.8v6.1h-.8zm1.8 1.6h.8v4.5h-.8z"/>
        </svg>
        <input type="text" id="scSearchInput" placeholder="Colle un lien SoundCloud ou cherche (client_id requis)" autocomplete="off" maxlength="200">
        <button class="yt-search-btn" id="scSearchBtn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        </button>
      </div>
      <p class="view-subtitle" style="margin-top:10px">Lecture directe des liens SoundCloud. Pour la vraie recherche texte, ajoute un client_id SoundCloud dans le code.</p>
      <div id="scResults" class="yt-results"></div>`;
    searchView.appendChild(scPanel);

    let scPlayerContainer = $('#scPlayerContainer');
    if (!scPlayerContainer) {
      scPlayerContainer = document.createElement('div');
      scPlayerContainer.id = 'scPlayerContainer';
      scPlayerContainer.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;';
      const iframe = document.createElement('iframe');
      iframe.id = 'scPlayer';
      iframe.title = 'SoundCloud player';
      iframe.allow = 'autoplay';
      iframe.frameBorder = '0';
      scPlayerContainer.appendChild(iframe);
      document.body.appendChild(scPlayerContainer);
    }

    tabs.querySelectorAll('.search-provider-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        W.currentSearchProvider = btn.dataset.provider === 'soundcloud' ? 'soundcloud' : 'youtube';
        tabs.querySelectorAll('.search-provider-tab').forEach(tab => tab.classList.toggle('active', tab === btn));
        ytPanel.hidden = W.currentSearchProvider !== 'youtube';
        scPanel.hidden = W.currentSearchProvider !== 'soundcloud';
      });
    });

    scPanel.querySelector('#scSearchInput').addEventListener('input', () => {
      if (!$('#scSearchInput').value.trim()) {
        $('#scResults').innerHTML = '';
        W.scSearchResults = [];
      }
    });
    scPanel.querySelector('#scSearchBtn').addEventListener('click', W.doSCSearch);
    scPanel.querySelector('#scSearchInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        W.doSCSearch();
      }
    });

    return true;
  };
})();
