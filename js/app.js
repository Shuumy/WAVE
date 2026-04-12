/**
 * WAVE — Main Application
 * SÉCURITÉ : XSS échappé, URLs sanitisées, tailles limitées, types validés.
 */
(async () => {
  await DB.open();

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // ═══════════════════════════════════════════════════
  // HELPERS SÉCURITÉ
  // ═══════════════════════════════════════════════════

  /**
   * Échappe toutes les données utilisateur avant injection dans le DOM.
   * Couvre les contextes texte ET attribut HTML (échappe ", ', <, >, &).
   */
  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Valide les URLs externes utilisées dans src/href.
   * Bloque javascript:, data: arbitraires, et tout protocole non autorisé.
   */
  function sanitizeURL(url) {
    if (!url || typeof url !== 'string') return '';
    try {
      const u = new URL(url);
      if (!['https:', 'http:', 'data:', 'blob:'].includes(u.protocol)) return '';
      // Bloquer les data: URLs autres qu'image (pour les thumbnails externes)
      if (u.protocol === 'data:' && !url.startsWith('data:image/')) return '';
      return url;
    } catch {
      return '';
    }
  }

  /**
   * Valide qu'un nom de playlist ne contient pas de caractères de contrôle.
   * Retourne le nom nettoyé ou null si invalide.
   */
  function validatePlaylistName(name) {
    if (!name || typeof name !== 'string') return null;
    const trimmed = name.trim().replace(/[\x00-\x1F\x7F]/g, '');
    if (trimmed.length === 0 || trimmed.length > 100) return null;
    return trimmed;
  }

  // ═══════════════════════════════════════════════════
  // LIMITES DE SÉCURITÉ
  // ═══════════════════════════════════════════════════
  const MAX_AUDIO_SIZE  = 500 * 1024 * 1024; // 500 Mo par fichier audio
  const MAX_IMAGE_SIZE  =   5 * 1024 * 1024; // 5 Mo pour les images (cover/profil)
  const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

  // ═══════════════════════════════════════════════════
  // REFS DOM
  // ═══════════════════════════════════════════════════
  const navBtns           = $$('.nav-btn');
  const views             = $$('.view');
  const playerTitle       = $('#playerTitle');
  const playerArtist      = $('#playerArtist');
  const playerArtwork     = $('#playerArtwork');
  const playerFavorite    = $('#playerFavorite');
  const btnPlay           = $('#btnPlay');
  const btnPrev           = $('#btnPrev');
  const btnNext           = $('#btnNext');
  const btnSkipBack       = $('#btnSkipBack');
  const btnSkipFwd        = $('#btnSkipFwd');
  const btnShuffle        = $('#btnShuffle');
  const btnRepeat         = $('#btnRepeat');
  const progressBar       = $('#progressBar');
  const progressFill      = $('#progressFill');
  const currentTimeEl     = $('#currentTime');
  const totalTimeEl       = $('#totalTime');
  const volumeBar         = $('#volumeBar');
  const volumeFill        = $('#volumeFill');
  const btnVolume         = $('#btnVolume');
  const toast             = $('#toast');
  const toastMessage      = $('#toastMessage');
  const profileAvatar     = $('#profileAvatar');
  const profileInput      = $('#profileInput');
  const playlistModal         = $('#playlistModal');
  const playlistModalBody     = $('#playlistModalBody');
  const closePlaylistModal    = $('#closePlaylistModal');
  const createPlaylistBtn     = $('#createPlaylistBtn');
  const playlistSearchModal       = $('#playlistSearchModal');
  const playlistSearchInput       = $('#playlistSearchInput');
  const playlistSearchResults     = $('#playlistSearchResults');
  const closePlaylistSearchModal  = $('#closePlaylistSearchModal');
  const playlistCoverInput    = $('#playlistCoverInput');
  const multiselectBar        = $('#multiselectBar');
  const multiselectCount      = $('#multiselectCount');
  const multiselectCancel     = $('#multiselectCancel');
  const multiselectFav        = $('#multiselectFav');
  const multiselectPlaylist   = $('#multiselectPlaylist');
  const multiselectDelete     = $('#multiselectDelete');
  const confirmModal          = $('#confirmModal');
  const confirmMessage        = $('#confirmMessage');
  const confirmYes            = $('#confirmYes');
  const confirmNo             = $('#confirmNo');

  let userTracks = [];
  let currentPlaylistView = null;
  let selectMode = false;
  let selectedTrackIds = new Set();
  let librarySort = { key: 'date', dir: 'desc' };
  let librarySearchQuery = '';
  let playlistSort = { key: 'default', dir: 'asc' };
  let shuffleActive = false;
  let repeatMode = 'none';

  // ===== Confirm Dialog =====
  function showConfirm(message) {
    return new Promise((resolve) => {
      // Utilise textContent pour éviter toute injection dans le message de confirmation
      confirmMessage.textContent = message;
      confirmModal.hidden = false;
      const cleanup = (result) => {
        confirmModal.hidden = true;
        confirmYes.onclick = null;
        confirmNo.onclick  = null;
        resolve(result);
      };
      confirmYes.onclick = () => cleanup(true);
      confirmNo.onclick  = () => cleanup(false);
    });
  }
  confirmModal.addEventListener('click', (e) => {
    if (e.target === confirmModal) { confirmModal.hidden = true; }
  });

  function formatTotalDuration(s) {
    if (!s || s <= 0) return '0 min';
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h} h ${m} min` : `${m} min`;
  }

  async function loadUserTracks() { userTracks = await DB.getUserTracks(); }
  function getAllTracks()          { return [...userTracks]; }
  function findTrack(id)          { return userTracks.find(t => t.id === id); }

  // ===== Shuffle Play =====
  function shufflePlay(tracks) {
    if (!tracks || !tracks.length) { showToast('Aucun morceau à lire'); return; }
    if (!shuffleActive) {
      shuffleActive = Player.toggleShuffle();
      btnShuffle.classList.toggle('active', shuffleActive);
      npBtnShuffle.classList.toggle('active', shuffleActive);
    }
    const idx = Math.floor(Math.random() * tracks.length);
    Player.setQueue(tracks, idx);
    Player.play(tracks[idx]);
    showToast('Lecture aléatoire');
  }

  // ===== Navigation =====
  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      navBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      views.forEach(v => v.classList.remove('active'));
      $(`#view${btn.dataset.view.charAt(0).toUpperCase() + btn.dataset.view.slice(1)}`).classList.add('active');
      currentPlaylistView = null;
      if (btn.dataset.view === 'library') refreshLibraryView();
      if (btn.dataset.view === 'home')    refreshHomeView();
      if (btn.dataset.view === 'import')  refreshImportView();
    });
  });

  // ===== Toast =====
  let toastTimer = null;
  function showToast(msg) {
    if (!msg) { toast.classList.remove('show'); return; }
    // textContent pour éviter XSS dans les messages de toast
    toastMessage.textContent = msg;
    toast.hidden = false;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => { toast.hidden = true; }, 300);
    }, 2500);
  }

  // ===== Settings =====
  const settingsBtn     = $('#settingsBtn');
  const settingsOverlay = $('#settingsOverlay');
  const closeSettingsBtn= $('#closeSettingsBtn');
  settingsBtn.addEventListener('click', () => { settingsOverlay.hidden = false; });
  closeSettingsBtn.addEventListener('click', () => { settingsOverlay.hidden = true; });
  settingsOverlay.addEventListener('click', (e) => { if (e.target === settingsOverlay) settingsOverlay.hidden = true; });

  // ===== Profile Picture =====
  async function loadProfilePicture() {
    const pic = await DB.getSetting('profilePicture');
    if (pic) {
      const img = document.createElement('img');
      img.src = sanitizeURL(pic) || pic; // data: URLs internes acceptées
      img.alt = 'Profil';
      profileAvatar.innerHTML = '';
      profileAvatar.appendChild(img);
    }
  }

  profileAvatar.addEventListener('click', () => profileInput.click());

  profileInput.addEventListener('change', async () => {
    const file = profileInput.files[0];
    if (!file) return;

    // Validation du type MIME réel (pas seulement l'extension)
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      showToast('Format non supporté. Utilise JPG, PNG, GIF ou WebP.');
      profileInput.value = '';
      return;
    }

    // Validation de la taille
    if (file.size > MAX_IMAGE_SIZE) {
      showToast('Image trop volumineuse (max 5 Mo).');
      profileInput.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target.result;
      // Vérifier que c'est bien une data:image/ URL
      if (!dataUrl.startsWith('data:image/')) {
        showToast('Format d\'image invalide.');
        return;
      }
      await DB.setSetting('profilePicture', dataUrl);
      const img = document.createElement('img');
      img.src = dataUrl;
      img.alt = 'Profil';
      profileAvatar.innerHTML = '';
      profileAvatar.appendChild(img);
      showToast('Photo mise à jour');
    };
    reader.readAsDataURL(file);
    profileInput.value = '';
  });

  // ===== Multi-select =====
  function enterSelectMode(firstId) {
    selectMode = true;
    document.body.classList.add('select-mode');
    multiselectBar.hidden = false;
    if (firstId) {
      selectedTrackIds.add(firstId);
      $$( `.track-item[data-track-id="${CSS.escape(firstId)}"]`).forEach(el => el.classList.add('selected'));
    }
    updateMultiselectCount();
  }
  function exitSelectMode() {
    selectMode = false;
    selectedTrackIds.clear();
    document.body.classList.remove('select-mode');
    multiselectBar.hidden = true;
    $$('.track-item.selected').forEach(el => el.classList.remove('selected'));
  }
  function updateMultiselectCount() {
    const n = selectedTrackIds.size;
    multiselectCount.textContent = `${n} sélectionné${n !== 1 ? 's' : ''}`;
  }
  function toggleTrackSelect(id, el) {
    if (selectedTrackIds.has(id)) { selectedTrackIds.delete(id); el.classList.remove('selected'); }
    else { selectedTrackIds.add(id); el.classList.add('selected'); }
    updateMultiselectCount();
  }

  multiselectCancel.addEventListener('click', exitSelectMode);
  multiselectFav.addEventListener('click', async () => {
    if (!selectedTrackIds.size) return;
    let added = 0;
    for (const id of selectedTrackIds) { if (!(await DB.isFavorite(id))) { await DB.toggleFavorite(id); added++; } }
    showToast(`${added} morceau${added !== 1 ? 'x' : ''} ajouté${added !== 1 ? 's' : ''} aux favoris`);
    exitSelectMode(); refreshAllViews();
  });
  multiselectPlaylist.addEventListener('click', () => {
    if (!selectedTrackIds.size) return;
    openPlaylistModal([...selectedTrackIds]);
    exitSelectMode();
  });
  multiselectDelete.addEventListener('click', async () => {
    if (!selectedTrackIds.size) return;
    const ids = [...selectedTrackIds];
    const ok = await showConfirm(`Supprimer ${ids.length} morceau${ids.length !== 1 ? 'x' : ''} ?`);
    if (!ok) return;
    for (const id of ids) { await DB.removeUserTrack(id); userTracks = userTracks.filter(t => t.id !== id); }
    showToast(`${ids.length} morceau${ids.length !== 1 ? 'x' : ''} supprimé${ids.length !== 1 ? 's' : ''}`);
    exitSelectMode(); refreshAllViews();
  });

  // ===== Sort =====
  const SORT_OPTIONS = [
    { key:'date',     label:"Date d'ajout" },
    { key:'year',     label:'Date de sortie' },
    { key:'duration', label:'Durée' },
    { key:'title',    label:'Titre' },
    { key:'artist',   label:'Artiste' },
  ];
  function applySort(tracks, sortState) {
    const st = sortState || librarySort;
    if (st.key === 'default') return [...tracks]; // ordre original de la playlist
    const s = [...tracks];
    const asc = st.dir === 'asc';
    s.sort((a, b) => {
      let va, vb;
      switch (st.key) {
        case 'title':    va = transliterate(a.title);  vb = transliterate(b.title);  break;
        case 'artist':   va = transliterate(a.artist); vb = transliterate(b.artist); break;
        case 'duration': va = a.duration || 0;         vb = b.duration || 0;         break;
        case 'year':     va = a.releaseYear || 0;      vb = b.releaseYear || 0;      break;
        default:         va = a.importedAt || 0;       vb = b.importedAt || 0;       break;
      }
      if (typeof va === 'string') return asc ? va.localeCompare(vb) : vb.localeCompare(va);
      return asc ? va - vb : vb - va;
    });
    return s;
  }
  function renderSortRow(container, sortState, onSortChange) {
    const st = sortState || librarySort;
    const onChange = onSortChange || (() => refreshLibraryView());
    const row = document.createElement('div');
    row.className = 'sort-row';
    const label = document.createElement('span');
    label.className = 'sort-label';
    label.textContent = 'Trier :';
    row.appendChild(label);
    SORT_OPTIONS.forEach(({ key, label: lbl }) => {
      const btn = document.createElement('button');
      const isActive = st.key === key;
      btn.className = 'sort-btn' + (isActive ? ' active' : '');
      btn.dataset.sort = key;
      if (isActive) {
        const dir = document.createElement('span');
        dir.className = 'sort-dir';
        dir.textContent = st.dir === 'asc' ? '↑' : '↓';
        btn.textContent = lbl;
        btn.appendChild(dir);
      } else {
        btn.textContent = lbl;
      }
      btn.addEventListener('click', () => {
        if (st.key === key) {
          st.dir = st.dir === 'asc' ? 'desc' : 'asc';
        } else {
          st.key = key;
          st.dir = (key === 'title' || key === 'artist') ? 'asc' : 'desc';
        }
        onChange();
      });
      row.appendChild(btn);
    });
    container.insertBefore(row, container.firstChild);
  }

  // ===== Translitération pour recherche multilingue =====
  function transliterate(str) {
    return (str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }
  function searchFilter(tracks, query) {
    if (!query) return tracks;
    const q = transliterate(query);
    return tracks.filter(t =>
      transliterate(t.title).includes(q) ||
      transliterate(t.artist).includes(q) ||
      transliterate(t.album || '').includes(q)
    );
  }

  // ===== Extraction complète des métadonnées (ID3 + fallback nom de fichier) =====
  function extractAllMetadata(file) {
    const { title: nameTitle, artist: nameArtist } = parseName(file.name);
    return new Promise((resolve) => {
      const fallback = { title: nameTitle, artist: nameArtist, album: '', genre: '', releaseYear: null, coverArt: null };
      if (!window.jsmediatags) { resolve(fallback); return; }
      try {
        jsmediatags.read(file, {
          onSuccess: (tag) => {
            const t = tag.tags || {};
            const title  = (t.title  || '').trim() || nameTitle;
            const artist = (t.artist || '').trim() || nameArtist;
            const album  = (t.album  || '').trim();
            // Nettoyer le genre ID3v1 (ex: "(17)" → "Rock")
            const rawGenre = (t.genre || '').trim();
            const genre = rawGenre.replace(/^\(?\d+\)?\s*/, '').trim();
            // Année — ID3v2.3 (TYER) ou ID3v2.4 (TDRC)
            const yearRaw = (t.year || (t.TDRC && t.TDRC.data) || '').toString().trim();
            const releaseYear = yearRaw ? (parseInt(yearRaw.slice(0, 4)) || null) : null;
            // Jaquette
            let coverArt = null;
            const pic = t.picture;
            if (pic) {
              try {
                const bytes = new Uint8Array(pic.data);
                let b = '';
                bytes.forEach(c => b += String.fromCharCode(c));
                const dataUrl = `data:${pic.format};base64,${btoa(b)}`;
                if (dataUrl.startsWith('data:image/')) coverArt = dataUrl;
              } catch {}
            }
            resolve({ title, artist, album, genre, releaseYear, coverArt });
          },
          onError: () => resolve(fallback),
        });
      } catch { resolve(fallback); }
    });
  }

  // ===== Options Sheet =====
  const optionsOverlay = $('#optionsOverlay');
  const optionsList    = $('#optionsList');
  const optionsArtwork = $('#optionsArtwork');
  const optionsTitle   = $('#optionsTitle');
  const optionsArtist  = $('#optionsArtist');

  function showTrackOptions(track, ctx = {}) {
    // Artwork
    const artSrc = sanitizeURL(generateArtwork(track)) || generateArtwork(track);
    optionsArtwork.innerHTML = '';
    const img = document.createElement('img');
    img.src = artSrc; img.alt = '';
    optionsArtwork.appendChild(img);
    optionsTitle.textContent  = track.title;
    optionsArtist.textContent = track.artist;

    optionsList.innerHTML = '';
    const addItem = (icon, label, cls, handler) => {
      const btn = document.createElement('button');
      btn.className = 'options-item' + (cls ? ' ' + cls : '');
      btn.innerHTML = icon;
      const span = document.createElement('span');
      span.textContent = label;
      btn.appendChild(span);
      btn.addEventListener('click', () => { closeOptionsSheet(); handler(); });
      optionsList.appendChild(btn);
    };

    // Retirer de la playlist / Supprimer
    if (ctx.playlistId) {
      addItem('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
        'Retirer de la playlist', '', async () => {
          await DB.removeTrackFromPlaylist(ctx.playlistId, track.id);
          showToast('Retiré de la playlist');
          ctx.onRemove?.();
        });
    } else {
      addItem('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
        'Supprimer', 'danger', async () => {
          const ok = await showConfirm(`Supprimer "${track.title}" ?`);
          if (!ok) return;
          await DB.removeUserTrack(track.id);
          userTracks = userTracks.filter(t => t.id !== track.id);
          showToast(`"${track.title}" supprimé`);
          refreshAllViews();
        });
    }

    // Télécharger
    addItem('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
      'Télécharger le fichier', '', async () => {
        try {
          const blob = await DB.getUserAudioBlob(track.id);
          if (!blob) { showToast('Fichier introuvable'); return; }
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = track.fileName || (track.title + '.mp3');
          document.body.appendChild(a); a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(url), 5000);
          showToast('Téléchargement lancé');
        } catch { showToast('Erreur lors du téléchargement'); }
      });

    // Copier le lien YouTube (uniquement pour les morceaux YouTube)
    if (track.youtubeId) {
      addItem('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
        'Copier le lien YouTube', '', async () => {
          const ytUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(track.youtubeId)}`;
          try { await navigator.clipboard.writeText(ytUrl); showToast('Lien copié'); }
          catch { showToast('Impossible de copier'); }
        });
    }

    // Partager
    if (navigator.share) {
      addItem('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>',
        'Partager', '', async () => {
          try {
            const shareData = { title: track.title, text: `${track.artist} — ${track.title}` };
            if (track.youtubeId) shareData.url = `https://www.youtube.com/watch?v=${encodeURIComponent(track.youtubeId)}`;
            await navigator.share(shareData);
          } catch (err) { if (err.name !== 'AbortError') showToast('Partage non disponible'); }
        });
    }

    optionsOverlay.hidden = false;
  }

  function closeOptionsSheet() { optionsOverlay.hidden = true; }
  optionsOverlay.addEventListener('click', (e) => { if (e.target === optionsOverlay) closeOptionsSheet(); });

  // ===== Track Element =====
  /**
   * Crée un élément de piste audio.
   * SÉCURITÉ : toutes les données utilisateur sont échappées via esc() ou textContent.
   */
  function createTrackElement(track, index, list, opts = {}) {
    const { playlistId, onRemoveFromPlaylist, showDelete } = opts;
    const wrap = document.createElement('div');
    wrap.className = 'track-item-wrap';
    const div = document.createElement('div');
    div.className = 'track-item';
    div.dataset.trackId = track.id;
    const ct = Player.getCurrentTrack();
    if (ct && ct.id === track.id) div.classList.add('playing');
    if (selectMode && selectedTrackIds.has(track.id)) div.classList.add('selected');

    const artSrc = sanitizeURL(generateArtwork(track)) || generateArtwork(track);

    // Dans une playlist : pas de bouton "ajouter à playlist" (le menu options gère "retirer")
    const actionBtn = playlistId ? '' : `<button class="icon-btn playlist-add-btn" title="Ajouter à une playlist">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
      </button>`;
    // Bouton options (3 points) remplace l'icône poubelle
    const optionsBtn = (showDelete || playlistId) ? `<button class="icon-btn track-options-btn" title="Options">
      <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
    </button>` : '';

    // ⚠️ SÉCURITÉ : esc() appliqué sur toutes les données dynamiques
    div.innerHTML = `
      <div class="track-select-check"><div class="track-checkbox"></div></div>
      <div class="track-artwork">
        <img src="${esc(artSrc)}" alt="${esc(track.title)}">
        ${ct && ct.id === track.id && Player.getIsPlaying() ? `<div class="playing-indicator"><div class="bars"><div class="bar"></div><div class="bar"></div><div class="bar"></div></div></div>` : ''}
      </div>
      <div class="track-info">
        <div class="track-title">${esc(track.title)}</div>
        <div class="track-artist">${esc(track.artist)}${track.album ? ' — ' + esc(track.album) : ''}</div>
      </div>
      <div class="track-actions">
        <span class="track-duration">${formatDuration(track.duration)}</span>
        <button class="icon-btn fav-btn" title="Favori">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
        </button>
        ${actionBtn}${optionsBtn}
      </div>`;

    DB.isFavorite(track.id).then(isFav => {
      const fb = div.querySelector('.fav-btn');
      if (isFav) { fb.classList.add('fav-active'); fb.querySelector('svg').setAttribute('fill', 'currentColor'); }
    });

    div.querySelector('.fav-btn').addEventListener('click', async (e) => {
      e.stopPropagation(); if (selectMode) return;
      const btn = e.currentTarget;
      const isFav = await DB.toggleFavorite(track.id);
      btn.classList.toggle('fav-active', isFav);
      btn.querySelector('svg').setAttribute('fill', isFav ? 'currentColor' : 'none');
      showToast(isFav ? 'Ajouté aux favoris' : 'Retiré des favoris');
      const cur = Player.getCurrentTrack();
      if (cur && cur.id === track.id) {
        playerFavorite.classList.toggle('active', isFav);
        playerFavorite.querySelector('svg').setAttribute('fill', isFav ? 'currentColor' : 'none');
      }
    });

    div.querySelector('.playlist-add-btn')?.addEventListener('click', (e) => {
      e.stopPropagation(); if (selectMode) return;
      openPlaylistModal(track.id);
    });

    if (showDelete || playlistId) {
      div.querySelector('.track-options-btn').addEventListener('click', (e) => {
        e.stopPropagation(); if (selectMode) return;
        showTrackOptions(track, {
          playlistId,
          onRemove: () => {
            wrap.style.cssText = 'transition:opacity .2s,transform .2s;opacity:0;transform:translateX(10px)';
            setTimeout(() => { wrap.remove(); onRemoveFromPlaylist?.(); }, 200);
          },
        });
      });
    }

    let lpTimer = null;
    div.addEventListener('touchstart', () => {
      lpTimer = setTimeout(() => {
        if (!selectMode) enterSelectMode(track.id); else toggleTrackSelect(track.id, div);
      }, 500);
    }, { passive: true });
    div.addEventListener('touchend',  () => clearTimeout(lpTimer));
    div.addEventListener('touchmove', () => clearTimeout(lpTimer));

    div.addEventListener('click', (e) => {
      if (e.target.closest('.fav-btn,.playlist-add-btn,.track-options-btn')) return;
      if (selectMode) { toggleTrackSelect(track.id, div); return; }
      if (ytMode) exitYTMode();
      Player.setQueue(list, index);
      Player.play(track);
    });

    wrap.appendChild(div);
    return wrap;
  }

  // ===== Playlist Modal =====
  let modalTrackIds = null;
  async function openPlaylistModal(idOrIds) {
    modalTrackIds = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
    const pls = await DB.getPlaylists();
    playlistModalBody.innerHTML = '';
    if (!pls.length) {
      playlistModalBody.innerHTML = '<p class="empty-state" style="padding:20px 0;">Aucune playlist.</p>';
    } else {
      pls.forEach(pl => {
        const opt = document.createElement('div');
        opt.className = 'playlist-option';
        // ⚠️ SÉCURITÉ : pl.name échappé via esc()
        const coverSrc = pl.coverImage ? sanitizeURL(pl.coverImage) || '' : '';
        const imgHtml = pl.coverImage
          ? `<div class="pl-color" style="background:${esc(pl.coverColor)};overflow:hidden"><img src="${esc(coverSrc)}" style="width:100%;height:100%;object-fit:cover;border-radius:3px" alt=""></div>`
          : `<div class="pl-color" style="background:${esc(pl.coverColor)}"></div>`;
        const nameSpan = document.createElement('span');
        nameSpan.textContent = pl.name; // textContent = sûr
        opt.innerHTML = imgHtml;
        opt.appendChild(nameSpan);
        opt.addEventListener('click', async () => {
          for (const tid of modalTrackIds) await DB.addTrackToPlaylist(pl.id, tid);
          showToast(`${modalTrackIds.length > 1 ? modalTrackIds.length + ' morceaux ajoutés' : 'Ajouté'} à "${pl.name}"`);
          playlistModal.hidden = true;
        });
        playlistModalBody.appendChild(opt);
      });
    }
    playlistModal.hidden = false;
  }
  closePlaylistModal.addEventListener('click', () => { playlistModal.hidden = true; });
  playlistModal.addEventListener('click', (e) => { if (e.target === playlistModal) playlistModal.hidden = true; });
  createPlaylistBtn.addEventListener('click', async () => {
    const raw = prompt('Nom de la playlist:');
    const name = validatePlaylistName(raw);
    if (!name) return;
    const pl = await DB.createPlaylist(name);
    if (modalTrackIds?.length) {
      for (const tid of modalTrackIds) await DB.addTrackToPlaylist(pl.id, tid);
      showToast(`"${pl.name}" créée avec ${modalTrackIds.length} morceau${modalTrackIds.length !== 1 ? 'x' : ''}`);
    } else { showToast(`"${pl.name}" créée`); }
    playlistModal.hidden = true;
    const at = $('.library-tabs .tab-btn.active');
    if (at?.dataset.tab === 'playlists') refreshLibraryView();
  });

  // ===== Track List =====
  function renderTrackList(container, tracks, opts = {}) {
    container.innerHTML = '';
    if (!tracks.length) { container.innerHTML = '<p class="empty-state">Aucun morceau trouvé.</p>'; return; }
    tracks.forEach((t, i) => container.appendChild(createTrackElement(t, i, tracks, opts)));
  }

  // ===== Home View =====
  async function refreshHomeView() {
    const recentIds = await DB.getRecent();
    const rec = $('#recentTracks');
    if (rec) {
      const recentTracks = recentIds.map(r => findTrack(r.id)).filter(Boolean).slice(0, 8);
      if (!recentTracks.length) rec.innerHTML = '<p class="empty-state">Aucun morceau joué récemment.</p>';
      else renderTrackList(rec, recentTracks);
    }
    // Bouton aléatoire dans le titre de section (ajouté une seule fois)
    const sTitle = document.querySelector('#recentSection .section-title');
    if (sTitle && !sTitle.querySelector('.shuffle-section-btn')) {
      const sb = document.createElement('button');
      sb.className = 'shuffle-section-btn';
      sb.title = 'Lire en aléatoire';
      sb.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg> Aléatoire';
      sb.addEventListener('click', () => shufflePlay(getAllTracks()));
      sTitle.appendChild(sb);
    }
  }

  // ===== Library View =====
  // Wiring search bar
  const libSearchInput = $('#librarySearchInput');
  const libSearchClear = $('#librarySearchClear');
  const libSearchBar   = $('#librarySearchBar');

  libSearchInput?.addEventListener('input', () => {
    librarySearchQuery = libSearchInput.value;
    libSearchClear.hidden = !librarySearchQuery;
    const tab = $('.library-tabs .tab-btn.active')?.dataset.tab;
    if (tab !== 'playlists') refreshLibraryView();
  });
  libSearchClear?.addEventListener('click', () => {
    libSearchInput.value = ''; librarySearchQuery = '';
    libSearchClear.hidden = true;
    refreshLibraryView();
  });

  async function refreshLibraryView() {
    const tab = $('.library-tabs .tab-btn.active')?.dataset.tab;
    const content = $('#libraryContent');
    // Masquer la searchbar pour les playlists
    if (libSearchBar) libSearchBar.hidden = (tab === 'playlists');
    if (tab === 'all') {
      content.innerHTML = '<div class="track-list" id="libraryTracks"></div>';
      renderSortRow(content);
      const tracks = searchFilter(applySort(getAllTracks()), librarySearchQuery);
      if (tracks.length) {
        const sb = document.createElement('button');
        sb.className = 'shuffle-section-btn';
        sb.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg> Lire en aléatoire';
        sb.style.marginBottom = '12px';
        sb.addEventListener('click', () => shufflePlay(tracks));
        content.insertBefore(sb, $('#libraryTracks'));
      }
      const c = $('#libraryTracks');
      if (!tracks.length) c.innerHTML = `<p class="empty-state">${librarySearchQuery ? 'Aucun résultat.' : 'Aucun morceau importé.'}</p>`;
      else renderTrackList(c, tracks, { showDelete: true });
    } else if (tab === 'favorites') {
      content.innerHTML = '<div class="track-list" id="libraryTracks"></div>';
      renderSortRow(content);
      const favs = await DB.getFavorites();
      const tracks = searchFilter(applySort(favs.map(f => findTrack(f.id)).filter(Boolean)), librarySearchQuery);
      if (tracks.length) {
        const sb = document.createElement('button');
        sb.className = 'shuffle-section-btn';
        sb.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg> Lire en aléatoire';
        sb.style.marginBottom = '12px';
        sb.addEventListener('click', () => shufflePlay(tracks));
        content.insertBefore(sb, $('#libraryTracks'));
      }
      const c = $('#libraryTracks');
      if (!tracks.length) c.innerHTML = `<p class="empty-state">${librarySearchQuery ? 'Aucun résultat.' : 'Aucun favori.'}</p>`;
      else renderTrackList(c, tracks, { showDelete: true });
    } else if (tab === 'playlists') {
      if (currentPlaylistView) await renderPlaylistDetail(currentPlaylistView);
      else await renderPlaylistsGrid();
    }
  }

  async function renderPlaylistsGrid() {
    const content = $('#libraryContent');
    const pls = await DB.getPlaylists();
    if (!pls.length) {
      content.innerHTML = `<div style="text-align:center;padding:40px 20px"><p class="empty-state">Aucune playlist.</p><button class="import-btn" id="createPlaylistFromLib" style="margin-top:16px">+ Nouvelle playlist</button></div>`;
      $('#createPlaylistFromLib').addEventListener('click', async () => {
        const raw = prompt('Nom de la playlist:');
        const n = validatePlaylistName(raw);
        if (!n) return;
        await DB.createPlaylist(n); showToast('Playlist créée'); renderPlaylistsGrid();
      });
      return;
    }

    // ⚠️ SÉCURITÉ : pl.name et pl.coverColor passent par esc()
    let html = '<div class="playlists-grid">';
    pls.forEach(pl => {
      const tracks = pl.trackIds.map(id => findTrack(id)).filter(Boolean);
      const total = tracks.reduce((s,t) => s + (t.duration||0), 0);
      const coverSrc = pl.coverImage ? sanitizeURL(pl.coverImage) || '' : '';
      const hasCover = !!coverSrc;
      html += `<div class="playlist-card${hasCover ? ' has-cover' : ''}" style="background:${esc(pl.coverColor)}" data-playlist-id="${esc(pl.id)}">
        <button class="playlist-card-delete" data-pl-delete="${esc(pl.id)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        ${hasCover ? `<img class="playlist-card-cover-img" src="${esc(coverSrc)}" alt="">` : ''}
        <div class="playlist-card-info">
          <div class="playlist-card-name">${esc(pl.name)}</div>
          <div class="playlist-card-count">${pl.trackIds.length} morceau${pl.trackIds.length!==1?'x':''} · ${formatTotalDuration(total)}</div>
        </div>
      </div>`;
    });
    html += '</div><div style="text-align:center;margin-top:20px"><button class="import-btn" id="createPlaylistFromLib">+ Nouvelle playlist</button></div>';
    content.innerHTML = html;
    content.querySelectorAll('.playlist-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.playlist-card-delete')) return;
        currentPlaylistView = card.dataset.playlistId; refreshLibraryView();
      });
    });
    content.querySelectorAll('[data-pl-delete]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const ok = await showConfirm('Supprimer cette playlist ?');
        if (!ok) return;
        await DB.deletePlaylist(btn.dataset.plDelete);
        showToast('Playlist supprimée'); renderPlaylistsGrid();
      });
    });
    $('#createPlaylistFromLib').addEventListener('click', async () => {
      const raw = prompt('Nom de la playlist:');
      const n = validatePlaylistName(raw);
      if (!n) return;
      await DB.createPlaylist(n); showToast('Playlist créée'); renderPlaylistsGrid();
    });
  }

  async function renderPlaylistDetail(plId) {
    const pl = await DB.getPlaylist(plId);
    if (!pl) { currentPlaylistView = null; renderPlaylistsGrid(); return; }
    const content = $('#libraryContent');
    const tracks = pl.trackIds.map(id => findTrack(id)).filter(Boolean);
    const totalSec = tracks.reduce((s,t) => s + (t.duration||0), 0);
    const coverSrc = pl.coverImage ? sanitizeURL(pl.coverImage) || '' : '';

    // ⚠️ SÉCURITÉ : esc() sur pl.name, esc() sur coverSrc
    content.innerHTML = `
      <button class="playlist-back-btn" id="playlistBack">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg> Retour
      </button>
      <div class="playlist-detail-header">
        <div class="playlist-detail-cover" style="background:${esc(pl.coverColor)}" id="playlistCoverBtn">
          ${coverSrc ? `<img src="${esc(coverSrc)}" alt="">` : '&#9835;'}
          <div class="playlist-cover-overlay"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></div>
        </div>
        <div class="playlist-detail-info">
          <h3>
            <span id="playlistNameSpan"></span>
            <button class="playlist-rename-btn" id="playlistRenameBtn" title="Renommer"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
          </h3>
          <p>${tracks.length} morceau${tracks.length!==1?'x':''} · ${formatTotalDuration(totalSec)}</p>
          <div class="playlist-detail-actions">
            <button class="playlist-action-btn" id="playlistShuffleBtn">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg> Aléatoire
            </button>
            <button class="playlist-action-btn" id="playlistAddTracksBtn">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Ajouter des morceaux
            </button>
          </div>
        </div>
      </div>
      <div id="playlistSortZone"></div>
      <div class="track-list" id="playlistTracks"></div>`;

    // Injection sécurisée du nom via textContent
    $('#playlistNameSpan').textContent = pl.name;

    const plTracksContainer = $('#playlistTracks');
    if (!tracks.length) {
      plTracksContainer.innerHTML = '<p class="empty-state">Aucun morceau. Clique sur "Ajouter des morceaux".</p>';
    } else {
      const sorted = applySort(tracks, playlistSort);
      renderTrackList(plTracksContainer, sorted, { playlistId: plId, onRemoveFromPlaylist: () => renderPlaylistDetail(plId) });
      renderSortRow($('#playlistSortZone'), playlistSort, () => renderPlaylistDetail(plId));
    }
    $('#playlistBack').addEventListener('click', () => { currentPlaylistView = null; refreshLibraryView(); });
    $('#playlistRenameBtn').addEventListener('click', async () => {
      const raw = prompt('Nouveau nom:', pl.name);
      const n = validatePlaylistName(raw);
      if (!n || n === pl.name) return;
      pl.name = n; await DB.updatePlaylist(pl);
      showToast('Playlist renommée'); renderPlaylistDetail(plId);
    });
    $('#playlistCoverBtn').addEventListener('click', () => { playlistCoverInput.dataset.playlistId = plId; playlistCoverInput.click(); });
    $('#playlistShuffleBtn').addEventListener('click', () => shufflePlay(tracks));
    $('#playlistAddTracksBtn').addEventListener('click', () => openPlaylistSearchModal(plId));
  }

  playlistCoverInput.addEventListener('change', async () => {
    const file = playlistCoverInput.files[0]; if (!file) return;
    const plId = playlistCoverInput.dataset.playlistId; if (!plId) return;

    // Validation type et taille pour la cover de playlist
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      showToast('Format non supporté. Utilise JPG, PNG, GIF ou WebP.');
      playlistCoverInput.value = ''; return;
    }
    if (file.size > MAX_IMAGE_SIZE) {
      showToast('Image trop volumineuse (max 5 Mo).');
      playlistCoverInput.value = ''; return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target.result;
      if (!dataUrl.startsWith('data:image/')) {
        showToast('Format d\'image invalide.'); return;
      }
      const pl = await DB.getPlaylist(plId); if (!pl) return;
      pl.coverImage = dataUrl; await DB.updatePlaylist(pl);
      showToast('Image mise à jour');
      if (currentPlaylistView === plId) renderPlaylistDetail(plId);
    };
    reader.readAsDataURL(file); playlistCoverInput.value = '';
  });

  function openPlaylistSearchModal(plId) {
    playlistSearchModal.hidden = false;
    playlistSearchModal.dataset.playlistId = plId;
    playlistSearchInput.value = '';
    renderPlaylistSearchResults(plId, '');
    setTimeout(() => playlistSearchInput.focus(), 100);
  }

  async function renderPlaylistSearchResults(plId, q) {
    const pl = await DB.getPlaylist(plId); if (!pl) return;
    const all = getAllTracks();
    const filtered = q ? all.filter(t => t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q) || t.album?.toLowerCase().includes(q)) : all;
    playlistSearchResults.innerHTML = '';
    if (!filtered.length) { playlistSearchResults.innerHTML = '<p class="empty-state">Aucun morceau.</p>'; return; }
    filtered.forEach(track => {
      const already = pl.trackIds.includes(track.id);
      const opt = document.createElement('div');
      opt.className = 'modal-track-option' + (already ? ' already-added' : '');
      const artSrc = sanitizeURL(generateArtwork(track)) || generateArtwork(track);
      // ⚠️ SÉCURITÉ : esc() sur title et artist
      opt.innerHTML = `
        <div class="track-thumb"><img src="${esc(artSrc)}" alt=""></div>
        <div class="track-meta">
          <div class="track-meta-title">${esc(track.title)}</div>
          <div class="track-meta-artist">${esc(track.artist)}</div>
        </div>
        <div class="track-add-icon">${already
          ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>'
          : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>'
        }</div>`;
      if (!already) {
        opt.addEventListener('click', async () => {
          await DB.addTrackToPlaylist(plId, track.id);
          pl.trackIds.push(track.id);
          showToast(`"${track.title}" ajouté`);
          opt.classList.add('already-added');
          opt.querySelector('.track-add-icon').innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>';
          if (currentPlaylistView === plId) renderPlaylistDetail(plId);
        });
      }
      playlistSearchResults.appendChild(opt);
    });
  }
  playlistSearchInput.addEventListener('input', () => {
    const plId = playlistSearchModal.dataset.playlistId; if (!plId) return;
    renderPlaylistSearchResults(plId, playlistSearchInput.value.toLowerCase().trim());
  });
  closePlaylistSearchModal.addEventListener('click', () => { playlistSearchModal.hidden = true; });
  playlistSearchModal.addEventListener('click', (e) => { if (e.target === playlistSearchModal) playlistSearchModal.hidden = true; });

  function refreshImportView() { /* section "Mes fichiers importés" supprimée */ }

  function refreshAllViews() {
    refreshHomeView();
    const at = $('.library-tabs .tab-btn.active');
    if (at) refreshLibraryView();
    refreshImportView();
    if (ytSearchResults.length) renderYTResults(ytSearchResults);
  }

  $$('.library-tabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.library-tabs .tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentPlaylistView = null;
      refreshLibraryView();
    });
  });

  // ===== Now Playing Screen =====
  const nowPlayingScreen = $('#nowPlayingScreen');
  const nowPlayingClose  = $('#nowPlayingClose');
  const nowPlayingArtwork= $('#nowPlayingArtwork');
  const nowPlayingTitle  = $('#nowPlayingTitle');
  const nowPlayingArtist = $('#nowPlayingArtist');
  const nowPlayingFav    = $('#nowPlayingFav');
  const npProgressBar    = $('#npProgressBar');
  const npProgressFill   = $('#npProgressFill');
  const npCurrentTime    = $('#npCurrentTime');
  const npTotalTime      = $('#npTotalTime');
  const npBtnShuffle     = $('#npBtnShuffle');
  const npBtnPrev        = $('#npBtnPrev');
  const npBtnSkipBack    = $('#npBtnSkipBack');
  const npBtnPlay        = $('#npBtnPlay');
  const npBtnSkipFwd     = $('#npBtnSkipFwd');
  const npBtnNext        = $('#npBtnNext');
  const npBtnRepeat      = $('#npBtnRepeat');

  function openNowPlaying() {
    nowPlayingScreen.hidden = false;
    document.body.classList.add('np-open');
    // Sync current state into NP screen
    const track = Player.getCurrentTrack();
    if (track) {
      nowPlayingTitle.textContent  = track.title;
      nowPlayingArtist.textContent = track.artist;
      const artImg = document.createElement('img');
      artImg.src = sanitizeURL(generateArtwork(track)) || generateArtwork(track);
      artImg.alt = '';
      nowPlayingArtwork.innerHTML = '';
      nowPlayingArtwork.appendChild(artImg);
      DB.isFavorite(track.id).then(isFav => {
        nowPlayingFav.classList.toggle('active', isFav);
        nowPlayingFav.querySelector('svg').setAttribute('fill', isFav ? 'currentColor' : 'none');
      });
    }
    npBtnPlay.classList.toggle('is-playing', Player.getIsPlaying());
    npBtnShuffle.classList.toggle('active', shuffleActive);
    updateRepeatButtons(repeatMode);
  }
  function closeNowPlaying() {
    nowPlayingScreen.hidden = true;
    document.body.classList.remove('np-open');
  }
  nowPlayingClose.addEventListener('click', closeNowPlaying);

  // Swipe-up on player bar → open Now Playing
  const playerBar = $('#playerBar');
  let swipeStartY = null;
  playerBar.addEventListener('touchstart', (e) => {
    swipeStartY = e.touches[0].clientY;
  }, { passive: true });
  playerBar.addEventListener('touchend', (e) => {
    if (swipeStartY === null) return;
    const dy = swipeStartY - e.changedTouches[0].clientY;
    if (dy > 35) openNowPlaying();
    swipeStartY = null;
  }, { passive: true });

  // Swipe-down on NP screen → close
  let npSwipeY = null;
  nowPlayingScreen.addEventListener('touchstart', (e) => {
    if (e.target.closest('.np-progress-bar,.now-playing-controls')) return;
    npSwipeY = e.touches[0].clientY;
  }, { passive: true });
  nowPlayingScreen.addEventListener('touchend', (e) => {
    if (npSwipeY === null) return;
    const dy = e.changedTouches[0].clientY - npSwipeY;
    if (dy > 60) closeNowPlaying();
    npSwipeY = null;
  }, { passive: true });

  // Click on track info in mini-player → open Now Playing
  const playerTrackInfoArea = $('.player-track-info');
  playerTrackInfoArea.addEventListener('click', (e) => {
    if (e.target.closest('.favorite-btn')) return;
    openNowPlaying();
  });

  // NP screen controls mirror main player
  npBtnPlay.addEventListener('click', () => btnPlay.click());
  npBtnPrev.addEventListener('click', () => btnPrev.click());
  npBtnNext.addEventListener('click', () => btnNext.click());
  npBtnShuffle.addEventListener('click', () => btnShuffle.click());
  npBtnRepeat.addEventListener('click', () => btnRepeat.click());
  npBtnSkipBack.addEventListener('click', () => Player.seekRelative(-10));
  npBtnSkipFwd.addEventListener('click',  () => Player.seekRelative(10));

  // NP screen favorite button
  nowPlayingFav.addEventListener('click', async () => {
    const track = Player.getCurrentTrack(); if (!track) return;
    const isFav = await DB.toggleFavorite(track.id);
    nowPlayingFav.classList.toggle('active', isFav);
    nowPlayingFav.querySelector('svg').setAttribute('fill', isFav ? 'currentColor' : 'none');
    playerFavorite.classList.toggle('active', isFav);
    playerFavorite.querySelector('svg').setAttribute('fill', isFav ? 'currentColor' : 'none');
    showToast(isFav ? 'Ajouté aux favoris' : 'Retiré des favoris');
  });

  // NP progress bar seek
  let npDragging = false;
  function npSeekFrac(e) {
    const r = npProgressBar.getBoundingClientRect();
    const x = e.touches ? e.touches[0].clientX : e.clientX;
    const f = Math.max(0, Math.min(1, (x - r.left) / r.width));
    npProgressFill.style.width = `${f * 100}%`;
    return f;
  }
  npProgressBar.addEventListener('mousedown', (e) => {
    npDragging = true; npProgressBar.classList.add('dragging'); Player.seek(npSeekFrac(e));
    const mv = (ev) => Player.seek(npSeekFrac(ev));
    const up = () => { npDragging = false; npProgressBar.classList.remove('dragging'); document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
  });
  npProgressBar.addEventListener('touchstart', (e) => { e.preventDefault(); npDragging = true; npProgressBar.classList.add('dragging'); Player.seek(npSeekFrac(e)); }, { passive: false });
  npProgressBar.addEventListener('touchmove',  (e) => { e.preventDefault(); if (npDragging) Player.seek(npSeekFrac(e)); }, { passive: false });
  npProgressBar.addEventListener('touchend',   () => { npDragging = false; npProgressBar.classList.remove('dragging'); });

  // ===== Player Events =====
  Player.on('trackchange', async (track) => {
    // textContent pour title et artist : sûr sans esc()
    playerTitle.textContent  = track.title;
    playerArtist.textContent = track.artist;

    // Artwork via DOM API (pas innerHTML avec données brutes)
    const img = document.createElement('img');
    img.src = sanitizeURL(generateArtwork(track)) || generateArtwork(track);
    img.alt = '';
    playerArtwork.innerHTML = '';
    playerArtwork.appendChild(img);

    // Sync NP screen if open
    nowPlayingTitle.textContent  = track.title;
    nowPlayingArtist.textContent = track.artist;
    const npImg = document.createElement('img');
    npImg.src = sanitizeURL(generateArtwork(track)) || generateArtwork(track);
    npImg.alt = '';
    nowPlayingArtwork.innerHTML = '';
    nowPlayingArtwork.appendChild(npImg);

    const isFav = await DB.isFavorite(track.id);
    playerFavorite.classList.toggle('active', isFav);
    playerFavorite.querySelector('svg').setAttribute('fill', isFav ? 'currentColor' : 'none');
    nowPlayingFav.classList.toggle('active', isFav);
    nowPlayingFav.querySelector('svg').setAttribute('fill', isFav ? 'currentColor' : 'none');

    $$('.track-item').forEach(el => {
      const isThis = el.dataset.trackId === track.id;
      el.classList.toggle('playing', isThis);
      const aw = el.querySelector('.track-artwork');
      if (!aw) return;
      const ind = aw.querySelector('.playing-indicator');
      if (isThis && !ind) aw.insertAdjacentHTML('beforeend', `<div class="playing-indicator"><div class="bars"><div class="bar"></div><div class="bar"></div><div class="bar"></div></div></div>`);
      else if (!isThis && ind) ind.remove();
    });
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: track.title, artist: track.artist, album: track.album||'' });
    }
  });
  Player.on('statechange', ({ playing }) => {
    btnPlay.classList.toggle('is-playing', playing);
    npBtnPlay.classList.toggle('is-playing', playing);
  });
  let isDragging = false;
  Player.on('timeupdate', ({ currentTime, duration }) => {
    if (!duration) return;
    const pct = `${(currentTime / duration) * 100}%`;
    if (!isDragging) {
      progressFill.style.width = pct;
      currentTimeEl.textContent = formatDuration(currentTime);
      totalTimeEl.textContent   = formatDuration(duration);
    }
    if (!npDragging) {
      npProgressFill.style.width = pct;
      npCurrentTime.textContent  = formatDuration(currentTime);
      npTotalTime.textContent    = formatDuration(duration);
    }
  });
  Player.on('error', ({ message }) => showToast(message));

  // ===== Player Controls =====
  btnPlay.addEventListener('click', () => {
    if (ytMode) {
      if (currentYTBlobUrl) {
        Player.togglePlay();
        return;
      }

      if (ytPlayer && typeof ytPlayer.getPlayerState === 'function') {
        const s = ytPlayer.getPlayerState();
        if (s === YT.PlayerState.PLAYING) ytPlayer.pauseVideo();
        else ytPlayer.playVideo();
        return;
      }
    }

    const all = getAllTracks();

    if (!Player.getCurrentTrack() && !ytMode && all.length) {
      Player.setQueue(all, 0);
      Player.play(all[0]);
    } else {
      Player.togglePlay();
    }
  });
  btnPrev.addEventListener('click', () => {
    if (ytMode) { if (ytCurrentIndex > 0) playYouTubeVideo(ytCurrentIndex - 1); return; }
    Player.prev();
  });
  btnNext.addEventListener('click', () => {
    if (ytMode) { if (ytCurrentIndex < ytSearchResults.length - 1) playYouTubeVideo(ytCurrentIndex + 1); return; }
    Player.next();
  });
  btnSkipBack.addEventListener('click', () => Player.seekRelative(-10));
  btnSkipFwd.addEventListener('click',  () => Player.seekRelative(10));
  btnShuffle.addEventListener('click', () => {
    shuffleActive = Player.toggleShuffle();
    btnShuffle.classList.toggle('active', shuffleActive);
    npBtnShuffle.classList.toggle('active', shuffleActive);
    showToast(shuffleActive ? 'Lecture aléatoire activée' : 'Lecture aléatoire désactivée');
  });
  function updateRepeatButtons(mode) {
    const active = mode !== 'none';
    btnRepeat.classList.toggle('active', active);
    npBtnRepeat.classList.toggle('active', active);
    const base = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>`;
    const svg = mode === 'one' ? base + `<text x="12" y="16" font-size="8" fill="currentColor" text-anchor="middle" font-weight="bold">1</text></svg>` : base + `</svg>`;
    btnRepeat.innerHTML = svg;
    npBtnRepeat.innerHTML = svg;
  }
  btnRepeat.addEventListener('click', () => {
    repeatMode = Player.toggleRepeat();
    updateRepeatButtons(repeatMode);
    showToast({ none:'Répétition désactivée', all:'Répéter tout', one:'Répéter un seul' }[repeatMode]);
  });

  // Progress
  function seekFrac(e) {
    const r = progressBar.getBoundingClientRect();
    const x = e.touches ? e.touches[0].clientX : e.clientX;
    const f = Math.max(0, Math.min(1, (x-r.left)/r.width));
    progressFill.style.width = `${f*100}%`;
    return f;
  }
  progressBar.addEventListener('mousedown', (e) => {
    isDragging = true; progressBar.classList.add('dragging'); Player.seek(seekFrac(e));
    const mv = (ev) => Player.seek(seekFrac(ev));
    const up = () => { isDragging = false; progressBar.classList.remove('dragging'); document.removeEventListener('mousemove',mv); document.removeEventListener('mouseup',up); };
    document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
  });
  progressBar.addEventListener('touchstart', (e) => { e.preventDefault(); isDragging = true; progressBar.classList.add('dragging'); Player.seek(seekFrac(e)); }, { passive:false });
  progressBar.addEventListener('touchmove',  (e) => { e.preventDefault(); if(isDragging) Player.seek(seekFrac(e)); }, { passive:false });
  progressBar.addEventListener('touchend',   () => { isDragging = false; progressBar.classList.remove('dragging'); });

  // Volume
  function setVolFrac(e) {
    const r = volumeBar.getBoundingClientRect();
    const x = e.touches ? e.touches[0].clientX : e.clientX;
    const f = Math.max(0, Math.min(1, (x-r.left)/r.width));
    Player.setVolume(f); volumeFill.style.width = `${f*100}%`;
  }
  volumeBar.addEventListener('click', setVolFrac);
  volumeBar.addEventListener('touchstart', (e) => { e.preventDefault(); setVolFrac(e); }, { passive:false });
  volumeBar.addEventListener('touchmove',  (e) => { e.preventDefault(); setVolFrac(e); }, { passive:false });
  let savedVol = 1;
  btnVolume.addEventListener('click', () => {
    const v = Player.getVolume();
    if (v > 0) { savedVol = v; Player.setVolume(0); volumeFill.style.width='0%'; }
    else { Player.setVolume(savedVol); volumeFill.style.width=`${savedVol*100}%`; }
  });

  playerFavorite.addEventListener('click', async () => {
    const track = Player.getCurrentTrack(); if (!track) return;
    const isFav = await DB.toggleFavorite(track.id);
    playerFavorite.classList.toggle('active', isFav);
    playerFavorite.querySelector('svg').setAttribute('fill', isFav ? 'currentColor' : 'none');
    showToast(isFav ? 'Ajouté aux favoris' : 'Retiré des favoris');
    $$(`.fav-btn[data-track-id="${CSS.escape(track.id)}"]`).forEach(btn => {
      btn.classList.toggle('fav-active', isFav);
      btn.querySelector('svg').setAttribute('fill', isFav ? 'currentColor' : 'none');
    });
  });

  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play',           () => Player.togglePlay());
    navigator.mediaSession.setActionHandler('pause',          () => Player.pause());
    navigator.mediaSession.setActionHandler('previoustrack',  () => btnPrev.click());
    navigator.mediaSession.setActionHandler('nexttrack',      () => btnNext.click());
    navigator.mediaSession.setActionHandler('seekbackward',   (d) => Player.seekRelative(-(d && d.seekOffset ? d.seekOffset : 10)));
    navigator.mediaSession.setActionHandler('seekforward',    (d) => Player.seekRelative(d && d.seekOffset ? d.seekOffset : 10));
  }

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Space')     { e.preventDefault(); Player.togglePlay(); }
    if (e.code === 'ArrowLeft') { e.preventDefault(); Player.seekRelative(-5); }
    if (e.code === 'ArrowRight'){ e.preventDefault(); Player.seekRelative(5); }
  });

  // ===== File Import =====
  const importDropzone     = $('#importDropzone');
  const fileInput          = $('#fileInput');
  const importProgress     = $('#importProgress');
  const importProgressFill = $('#importProgressFill');
  const importProgressText = $('#importProgressText');

  const AUDIO_EXT = /\.(mp3|wav|ogg|flac|aac|m4a|webm|opus|mp4|mpeg|wma|wave|3gp|amr|aif|aiff|caf)$/i;
  function isAudio(file) {
    return (file.type?.startsWith('audio/') || file.type?.startsWith('video/') || AUDIO_EXT.test(file.name) || !file.type || file.type === 'application/octet-stream');
  }
  function validateAudio(blob) {
    return new Promise(resolve => {
      const url = URL.createObjectURL(blob), a = new Audio();
      a.preload = 'metadata';
      a.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve({ valid:true, duration: isFinite(a.duration)?a.duration:0 }); };
      a.onerror = () => { URL.revokeObjectURL(url); resolve({ valid:false, duration:0 }); };
      setTimeout(() => { URL.revokeObjectURL(url); resolve({ valid:true, duration:0 }); }, 5000);
      a.src = url;
    });
  }
  function parseName(name) {
    const base = name.replace(/\.[^.]+$/, '');
    const m = base.match(/^(.+?)\s*[-–—]\s*(.+)$/);
    return m ? { artist:m[1].trim(), title:m[2].trim() } : { artist:'Artiste inconnu', title:base.trim() };
  }
  function randColor() {
    return ['#e94560','#7b2ff7','#00b4d8','#ff9800','#4caf50','#ff5722','#9c27b0','#3f51b5','#00e676','#f44336'][Math.floor(Math.random()*10)];
  }

  async function importFiles(files) {
    const candidates = Array.from(files).filter(isAudio);
    const list = candidates.length ? candidates : Array.from(files);
    if (!list.length) { showToast('Aucun fichier sélectionné'); return; }
    importProgress.hidden = false;
    let ok = 0, fail = 0;
    for (const file of list) {
      // ⚠️ SÉCURITÉ : Limite de taille
      if (file.size > MAX_AUDIO_SIZE) {
        showToast(`"${file.name.slice(0, 40)}" trop volumineux (max 500 Mo)`);
        fail++; continue;
      }

      const { title, artist, album, genre, releaseYear, coverArt } = await extractAllMetadata(file);
      const { valid, duration } = await validateAudio(file);
      if (!valid) { fail++; continue; }

      // Valider que la coverArt extraite est bien une image
      const safeCoverArt = coverArt?.startsWith('data:image/') ? coverArt : null;

      const meta = {
        id: 'user-'+Date.now()+'-'+Math.random().toString(36).slice(2,8),
        title, artist, album, duration:Math.round(duration),
        genre, releaseYear, color:randColor(), userImported:true,
        fileName:file.name, importedAt:Date.now(), coverArt:safeCoverArt,
      };
      await DB.saveUserTrack(meta, file);
      userTracks.push(meta); ok++;
      const pct = Math.round(((ok+fail)/list.length)*100);
      importProgressFill.style.width = `${pct}%`;
      importProgressText.textContent = `${ok} / ${list.length} fichier${list.length>1?'s':''} importé${list.length>1?'s':''}`;
    }
    showToast(ok > 0 ? `${ok} morceau${ok>1?'x':''} importé${ok>1?'s':''}` : 'Format non supporté');
    setTimeout(() => { importProgress.hidden=true; importProgressFill.style.width='0%'; }, 2000);
    refreshImportView(); refreshHomeView();
  }
  fileInput.addEventListener('change', () => { if(fileInput.files.length) { importFiles(fileInput.files); fileInput.value=''; } });
  importDropzone.addEventListener('click', (e) => { if(!e.target.closest('.import-btn') && e.target.tagName!=='LABEL') fileInput.click(); });

  // ===== notube.lol intégré en iframe — pas de JS spécifique nécessaire =====

  function extractYouTubeVideoId(input) {
    input = (input || '').trim();
    if (!input) return null;
    if (/^[a-zA-Z0-9_-]{11}$/.test(input)) return input;
    try {
      const u = new URL(input);
      if (u.hostname.includes('youtube.com')) {
        if (u.pathname.startsWith('/shorts/')) return u.pathname.split('/')[2]?.slice(0, 11) || null;
        return u.searchParams.get('v');
      }
      if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('?')[0].slice(0, 11) || null;
    } catch {}
    const m = input.match(/(?:v=|youtu\.be\/|shorts\/)([a-zA-Z0-9_-]{11})/);
    return m ? m[1] : null;
  }


  importDropzone.addEventListener('dragover', (e) => { e.preventDefault(); importDropzone.classList.add('dragover'); });
  importDropzone.addEventListener('dragleave', () => importDropzone.classList.remove('dragover'));
  importDropzone.addEventListener('drop', (e) => { e.preventDefault(); importDropzone.classList.remove('dragover'); if(e.dataTransfer.files.length) importFiles(e.dataTransfer.files); });

  // ===== YouTube =====
  const ytSearchInput      = $('#ytSearchInput');
  const ytSearchBtn        = $('#ytSearchBtn');
  const ytResultsContainer = $('#ytResults');

  let ytPlayer       = null;
  let ytAPIReady     = false;
  let ytMode         = false;
  let ytCurrentVideo = null;
  let ytSearchResults  = [];
  let ytCurrentIndex   = -1;
  let ytProgressInterval = null;
  let currentYTBlobUrl   = null;

  function syncYTAPIState() {
    if (window.YT && typeof window.YT.Player === 'function') {
      ytAPIReady = true;
      return true;
    }
    return false;
  }

  function ensureYTAPIScript() {
    if (syncYTAPIState()) return;

    const alreadyThere = document.querySelector('script[data-yt-iframe-api]');
    if (alreadyThere) return;

    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    s.dataset.ytIframeApi = '1';
    document.head.appendChild(s);
  }

  function isIOSDevice() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent);
  }

  function isStandalonePWA() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function shouldPreferDirectYouTubePlayback() {
    return isIOSDevice() && isStandalonePWA();
  }

  window.onYouTubeIframeAPIReady = () => {
    ytAPIReady = true;
  };

  window.addEventListener('pageshow', () => {
    syncYTAPIState();
    ensureYTAPIScript();
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      syncYTAPIState();
      ensureYTAPIScript();
    }
  });

  const PIPED_INSTANCES = [
    'https://api.piped.private.coffee',
    'https://pipedapi.kavin.rocks',
    'https://api.piped.projectsegfau.lt',
    'https://pipedapi.adminforge.de',
    'https://pipedapi.tokhmi.xyz',
    'https://piped-api.garudalinux.org',
    'https://api.piped.yt',
    'https://pipedapi.syncpundit.io',
    'https://pipedapi-libre.kavin.rocks',
    'https://piped-api.privacy.com.de',
    'https://pipedapi.leptons.xyz',
    'https://pipedapi.drgns.space',
    'https://pipedapi.owo.si',
    'https://piped-api.codespace.cz',
    'https://pipedapi.darkness.services',
    'https://pipedapi.ducks.party',
  ];
  const INVIDIOUS_FALLBACK = [
    'https://yewtu.be','https://invidious.nerdvpn.de','https://invidious.privacydev.net',
    'https://inv.tux.pizza','https://invidious.flokinet.to','https://invidious.fdn.fr',
    'https://yt.artemislena.eu','https://invidious.private.coffee','https://invidious.protokolla.fi',
    'https://invidious.privacyredirect.com',
  ];
  let cachedInvidious = null;
  async function getInvidiousInstances() {
    if (cachedInvidious) return cachedInvidious;
    try {
      const r = await fetchWithTimeout('https://api.invidious.io/instances.json?sort_by=health', {}, 5000);
      if (!r.ok) throw new Error();
      const data = await r.json();
      const live = data.filter(([,i]) => i.cors&&i.api&&i.type==='https').map(([d]) => `https://${d}`).slice(0,8);
      if (live.length) { cachedInvidious = live; return live; }
    } catch {}
    return INVIDIOUS_FALLBACK;
  }

  function getVideoId(item) {
    if (!item.url) return null;
    try { return new URLSearchParams(item.url.split('?')[1]).get('v'); } catch { return null; }
  }

  function fetchWithTimeout(url, opts={}, ms=15000) {
    // ⚠️ SÉCURITÉ : Valider que l'URL cible est bien HTTPS
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:') return Promise.reject(new Error('HTTPS requis'));
    } catch {
      return Promise.reject(new Error('URL invalide'));
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    return fetch(url, { ...opts, signal:ctrl.signal }).finally(() => clearTimeout(t));
  }

  async function searchYouTube(q) {
    // Limiter la longueur de la requête
    const safeQ = q.slice(0, 200);
    for (const inst of PIPED_INSTANCES) {
      try {
        const r = await fetchWithTimeout(`${inst}/search?q=${encodeURIComponent(safeQ)}&filter=music_songs`, {}, 8000);
        if (!r.ok) continue;
        const data = await r.json();
        const items = (data.items||[]).filter(i => i.type==='stream'&&i.url);
        if (items.length) return items.slice(0,12);
      } catch(e) {
        if (e.name !== 'AbortError') console.error('Piped search error:', inst);
      }
    }
    throw new Error('Aucun serveur disponible');
  }

  async function downloadYouTubeAsBlobUrl(videoId) {
    for (const inst of PIPED_INSTANCES) {
      try {
        const r = await fetchWithTimeout(`${inst}/streams/${videoId}`, { cache:'no-cache' }, 8000);
        if (!r.ok) continue;
        const data = await r.json();
        if (!data.audioStreams?.length) continue;
        const sorted = data.audioStreams.filter(s=>s.url&&s.mimeType).sort((a,b)=>(b.bitrate||0)-(a.bitrate||0));
        let instHost = '';
        try { instHost = new URL(inst).hostname; } catch {}
        for (const stream of sorted.slice(0,3)) {
          try {
            const rawUrl = sanitizeURL(stream.url);
            if (!rawUrl) continue;
            // URLs CDN externes : pas de CORS → skip ; on ne garde que les URLs proxifiées par l'instance
            const isExternal = instHost && !rawUrl.includes(instHost);
            if (isExternal) continue;
            try {
              const ar = await fetchWithTimeout(rawUrl, {}, 120000);
              if (!ar.ok) continue;
              const contentType = ar.headers.get('content-type') || '';
              if (contentType && !contentType.startsWith('audio/') && !contentType.startsWith('video/') && !contentType.includes('octet-stream')) continue;
              const blob = await ar.blob();
              if (blob.size > 5000) return URL.createObjectURL(blob);
            } catch {}
          } catch {}
        }
      } catch(e) {
        if (e.name !== 'AbortError') console.error('Piped blob error:', inst);
      }
    }
    const invs = await getInvidiousInstances();
    for (const inst of invs) {
      try {
        const r = await fetchWithTimeout(`${inst}/api/v1/videos/${videoId}?fields=adaptiveFormats`, {}, 8000);
        if (!r.ok) continue;
        const data = await r.json();
        const fmts = (data.adaptiveFormats||[]).filter(f=>f.type?.startsWith('audio/')&&f.itag).sort((a,b)=>(parseInt(b.bitrate)||0)-(parseInt(a.bitrate)||0));
        for (const fmt of fmts.slice(0,2)) {
          try {
            const url = `${inst}/latest_version?id=${videoId}&itag=${encodeURIComponent(fmt.itag)}&local=true`;
            const ar = await fetchWithTimeout(url, {}, 120000);
            if (!ar.ok) continue;
            const blob = await ar.blob();
            if (blob.size > 5000) return URL.createObjectURL(blob);
          } catch {}
        }
      } catch(e) {
        if (e.name !== 'AbortError') console.error('Invidious blob error:', inst);
      }
    }
    return null;
  }

  async function playYouTubeVideo(index) {
    const item = ytSearchResults[index]; if (!item) return;
    const videoId = getVideoId(item);
    // ⚠️ SÉCURITÉ : Sanitiser le thumbnail avant utilisation
    const rawThumb = item.thumbnail || '';
    const thumb = sanitizeURL(rawThumb) || '';

    if (currentYTBlobUrl) { URL.revokeObjectURL(currentYTBlobUrl); currentYTBlobUrl = null; }
    ytCurrentIndex = index;
    ytCurrentVideo = { videoId, title:item.title||'', artist:item.uploaderName||'', thumbnail:thumb };
    ytMode = true;
    Player.pause();

    // textContent pour title et artist : sûr
    playerTitle.textContent  = item.title || '';
    playerArtist.textContent = item.uploaderName || '';

    // Artwork via DOM API
    if (thumb) {
      const img = document.createElement('img');
      img.src = thumb;
      img.alt = '';
      playerArtwork.innerHTML = '';
      playerArtwork.appendChild(img);
    }

    btnPlay.classList.add('is-playing');
    playerFavorite.style.display = 'none';
    $$('.yt-result-item').forEach(el => el.classList.remove('yt-playing'));
    const el = document.querySelector(`.yt-result-item[data-index="${index}"]`);
    if (el) el.classList.add('yt-playing');
    showToast('Chargement...');

    if (shouldPreferDirectYouTubePlayback()) {
      showToast('Lecture via YouTube...');
      playYouTubeIFrame(videoId, index);
      return;
    }

    try {
      const blobUrl = await downloadYouTubeAsBlobUrl(videoId);
      if (blobUrl) {
        currentYTBlobUrl = blobUrl;
        const ok = await Player.playExternal(blobUrl);
        if (ok) {
          if (ytPlayer && typeof ytPlayer.stopVideo === 'function') {
            ytPlayer.stopVideo();
          }
          updateYTMediaSession();
          showToast('');
          return;
        }
      }
    } catch(e) { console.error('Blob download failed:', e); }
    showToast('Lecture via YouTube...');
    playYouTubeIFrame(videoId, index);
  }

  function playYouTubeIFrame(videoId, index) {
    stopYTProgress();
    syncYTAPIState();

    if (ytPlayer && typeof ytPlayer.loadVideoById === 'function') {
      ytPlayer.loadVideoById(videoId);
      setTimeout(() => {
        try { ytPlayer.playVideo(); } catch (_) {}
      }, 150);
    } else {
      const container = document.getElementById('ytPlayerContainer');
      const old = document.getElementById('ytPlayer');
      if (old) old.remove();
      const div = document.createElement('div');
      div.id = 'ytPlayer';
      container.appendChild(div);
      if (!ytAPIReady && !syncYTAPIState()) { showToast('YouTube API non prête'); return; }
      ytPlayer = new YT.Player('ytPlayer', {
        height: '1',
        width: '1',
        videoId,
        playerVars: {
          autoplay: 1,
          controls: 0,
          playsinline: 1,
          disablekb: 1,
          origin: window.location.origin
        },
        events: {
          onReady: (e) => {
            try {
              e.target.playVideo();
              setTimeout(() => {
                try { e.target.playVideo(); } catch (_) {}
              }, 250);
            } catch (_) {}
          },
          onStateChange: onYTStateChange
        },
      });
    }
    startYTProgress();
    updateYTMediaSession();
  }

  function onYTStateChange(event) {
    if (!ytMode) return;
    if (event.data === YT.PlayerState.PLAYING) { btnPlay.classList.add('is-playing'); startYTProgress(); }
    else if (event.data === YT.PlayerState.PAUSED) { btnPlay.classList.remove('is-playing'); stopYTProgress(); }
    else if (event.data === YT.PlayerState.ENDED) {
      if (ytCurrentIndex < ytSearchResults.length-1) playYouTubeVideo(ytCurrentIndex+1);
      else { btnPlay.classList.remove('is-playing'); stopYTProgress(); }
    }
  }
  function startYTProgress() {
    stopYTProgress();
    ytProgressInterval = setInterval(() => {
      if (!ytPlayer || typeof ytPlayer.getCurrentTime !== 'function') return;
      const ct = ytPlayer.getCurrentTime(), dur = ytPlayer.getDuration();
      if (dur > 0) { progressFill.style.width=`${(ct/dur)*100}%`; currentTimeEl.textContent=formatDuration(ct); totalTimeEl.textContent=formatDuration(dur); }
    }, 500);
  }
  function stopYTProgress() { if(ytProgressInterval){clearInterval(ytProgressInterval);ytProgressInterval=null;} }

  function updateYTMediaSession() {
    if (!ytCurrentVideo || !('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: ytCurrentVideo.title, artist: ytCurrentVideo.artist,
      artwork: ytCurrentVideo.thumbnail ? [{ src:ytCurrentVideo.thumbnail, sizes:'320x180', type:'image/jpeg' }] : [],
    });
    navigator.mediaSession.setActionHandler('previoustrack', () => btnPrev.click());
    navigator.mediaSession.setActionHandler('nexttrack',     () => btnNext.click());
    navigator.mediaSession.setActionHandler('seekbackward',  (d) => Player.seekRelative(-(d && d.seekOffset ? d.seekOffset : 10)));
    navigator.mediaSession.setActionHandler('seekforward',   (d) => Player.seekRelative(d && d.seekOffset ? d.seekOffset : 10));
  }

  function exitYTMode() {
    ytMode = false; ytCurrentVideo = null;
    stopYTProgress();
    if (ytPlayer && typeof ytPlayer.stopVideo === 'function') ytPlayer.stopVideo();
    playerFavorite.style.display = '';
    $$('.yt-result-item').forEach(el => el.classList.remove('yt-playing'));
    if (currentYTBlobUrl) { URL.revokeObjectURL(currentYTBlobUrl); currentYTBlobUrl = null; }
  }

  /**
   * Rendu des résultats YouTube.
   * ⚠️ SÉCURITÉ : esc() sur title, channel, thumbnails sanitisées
   */
  function renderYTResults(items) {
    ytSearchResults = items;
    if (!items.length) { ytResultsContainer.innerHTML = '<p class="empty-state">Aucun résultat.</p>'; return; }
    ytResultsContainer.innerHTML = items.map((item,i) => {
      const videoId = getVideoId(item);
      // ⚠️ SÉCURITÉ : Sanitiser l'URL du thumbnail externe
      const thumb = sanitizeURL(item.thumbnail||'') || '';
      const saved = userTracks.some(t => t.youtubeId===videoId);
      const isPlaying = ytCurrentVideo?.videoId===videoId;
      return `<div class="yt-result-item${isPlaying?' yt-playing':''}" data-index="${i}">
        <div class="yt-result-thumb">
          ${thumb ? `<img src="${esc(thumb)}" alt="" loading="lazy">` : ''}
          <div class="yt-play-overlay"><svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg></div>
        </div>
        <div class="yt-result-info">
          <div class="yt-result-title">${esc(item.title||'')}</div>
          <div class="yt-result-channel">${esc(item.uploaderName||'')}</div>
        </div>
        <div class="yt-result-actions">
          <button class="yt-save-btn${saved?' yt-saved':''}" data-index="${i}" title="${saved?'Déjà sauvegardé':'Sauvegarder hors-ligne'}">
            ${saved ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>'
                    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>'}
          </button>
          <button class="yt-copy-btn" data-index="${i}" title="Copier le lien">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          </button>
        </div>
      </div>`;
    }).join('');

    ytResultsContainer.querySelectorAll('.yt-result-item').forEach(el => {
      el.addEventListener('click', (e) => { if(e.target.closest('.yt-save-btn,.yt-copy-btn')) return; playYouTubeVideo(parseInt(el.dataset.index)); });
    });
    ytResultsContainer.querySelectorAll('.yt-save-btn:not(.yt-saved)').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); saveYouTubeOffline(parseInt(btn.dataset.index), btn); });
    });
    ytResultsContainer.querySelectorAll('.yt-copy-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const videoId = getVideoId(ytSearchResults[parseInt(btn.dataset.index)]);
        if (!videoId) { showToast('Lien introuvable'); return; }
        // ⚠️ SÉCURITÉ : Construction sûre de l'URL YouTube (encodeURIComponent)
        const ytUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
        try { await navigator.clipboard.writeText(ytUrl); btn.classList.add('yt-copied'); setTimeout(()=>btn.classList.remove('yt-copied'),1000); showToast('Lien copié'); }
        catch { showToast('Impossible de copier'); }
      });
    });
  }

  async function saveYouTubeOffline(index, btn) {
    const item = ytSearchResults[index]; if (!item) return;
    const videoId = getVideoId(item);
    // ⚠️ SÉCURITÉ : Sanitiser thumbnail
    const thumb = sanitizeURL(item.thumbnail||'') || '';
    if (userTracks.some(t=>t.youtubeId===videoId)) { showToast('Déjà dans la bibliothèque'); return; }
    btn.classList.add('yt-saving'); btn.innerHTML='<div class="spinner"></div>'; btn.disabled=true;
    try {
      showToast('Téléchargement en cours...');
      let res;
      try {
        res = await downloadFromPiped(videoId, (c,t)=>{if(c>1)showToast(`Piped ${c}/${t}...`);});
      } catch {
        showToast('Piped indisponible, essai Invidious...');
        res = await downloadFromInvidious(videoId, (c,t)=>showToast(`Invidious ${c}/${t}...`));
      }
      const { blob, mimeType, pipedTitle, pipedUploader, pipedDuration } = res;
      const mime = (mimeType||'').split(';')[0];
      const ext = mime.includes('opus')?'opus':mime.includes('mp4')?'m4a':mime.includes('webm')?'webm':'mp3';
      const { duration } = await validateAudio(blob);
      let title = pipedTitle||item.title||'', artist = pipedUploader||item.uploaderName||'';
      const dm = title.match(/^(.+?)\s*[-–—]\s*(.+)$/);
      if (dm) { artist=dm[1].trim(); title=dm[2].trim(); }

      // ⚠️ SÉCURITÉ : Valider la cover thumbnail avant stockage
      let coverArt = null;
      if (thumb) {
        try {
          const tr = await fetchWithTimeout(thumb, {}, 10000);
          if (tr.ok) {
            const contentType = tr.headers.get('content-type') || '';
            if (contentType.startsWith('image/')) {
              const tb = await tr.blob();
              coverArt = await new Promise(r=>{const rd=new FileReader();rd.onload=()=>r(rd.result);rd.onerror=()=>r(null);rd.readAsDataURL(tb);});
              // Vérifier que c'est bien data:image/
              if (coverArt && !coverArt.startsWith('data:image/')) coverArt = null;
            }
          }
        } catch {}
      }

      const meta = { id:'yt-'+videoId+'-'+Date.now(), title, artist, album:'', duration:Math.round(duration||pipedDuration||0), genre:'', color:randColor(), userImported:true, fileName:`${videoId}.${ext}`, importedAt:Date.now(), coverArt, youtubeId:videoId };
      await DB.saveUserTrack(meta, blob); userTracks.push(meta);
      btn.classList.remove('yt-saving'); btn.classList.add('yt-saved');
      btn.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>';
      showToast(`"${meta.title}" sauvegardé`); refreshAllViews();
    } catch(err) {
      btn.classList.remove('yt-saving'); btn.disabled=false;
      btn.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
      showToast('Erreur: '+(err.message||'Échec'));
    }
  }

  async function downloadFromPiped(videoId, onProgress) {
    for (let i=0; i<PIPED_INSTANCES.length; i++) {
      const inst = PIPED_INSTANCES[i];
      try {
        if(onProgress) onProgress(i+1, PIPED_INSTANCES.length);
        // cache:'no-cache' évite les URLs de streams expirées en cache navigateur
        const r = await fetchWithTimeout(`${inst}/streams/${videoId}`, { cache:'no-cache' }, 12000);
        if(!r.ok) continue;
        const data = await r.json();
        if(!data.audioStreams?.length) continue;
        const sorted = data.audioStreams.filter(s=>s.url&&s.mimeType).sort((a,b)=>(b.bitrate||0)-(a.bitrate||0));
        if(!sorted.length) continue;

        // Hostname de l'instance pour détecter si l'URL est déjà proxifiée
        let instHost = '';
        try { instHost = new URL(inst).hostname; } catch {}

        // Essayer les 3 meilleures qualités
        for (const stream of sorted.slice(0, 3)) {
          const rawUrl = sanitizeURL(stream.url);
          if (!rawUrl) continue;

          // Les URLs externes (CDN YouTube) ne fonctionnent pas via fetch() JS car
          // YouTube ne retourne pas Access-Control-Allow-Origin. On ne garde que
          // les URLs déjà proxifiées par l'instance Piped (qui elles ont les bons headers CORS).
          const isExternal = instHost && !rawUrl.includes(instHost);
          if (isExternal) continue;

          try {
            // Timeout long (120 s) : un fichier audio de 4-8 Mo sur mobile peut dépasser 35 s
            const ar = await fetchWithTimeout(rawUrl, {}, 120000);
            if (!ar.ok) continue;
            const contentType = ar.headers.get('content-type') || '';
            // Accepter aussi content-type vide (certains proxies ne le définissent pas)
            if (contentType && !contentType.startsWith('audio/') && !contentType.startsWith('video/') && !contentType.includes('octet-stream')) continue;
            const blob = await ar.blob();
            if (!blob || blob.size < 10000) continue;
            return { blob, mimeType:stream.mimeType, pipedTitle:data.title, pipedUploader:data.uploader, pipedDuration:data.duration, thumbnailUrl:data.thumbnailUrl||'' };
          } catch { /* essayer le stream suivant */ }
        }
      } catch(e) {
        if (e.name !== 'AbortError') console.error('Piped download error:', inst);
      }
    }
    throw new Error('Piped: aucun serveur disponible');
  }

  async function downloadFromInvidious(videoId, onProgress) {
    const invs = await getInvidiousInstances();
    for (let i=0; i<invs.length; i++) {
      const inst = invs[i];
      try {
        if(onProgress) onProgress(i+1, invs.length);
        const r = await fetchWithTimeout(`${inst}/api/v1/videos/${videoId}?fields=adaptiveFormats,title,author,lengthSeconds`, {}, 12000);
        if(!r.ok) continue;
        const data = await r.json();
        const fmts = (data.adaptiveFormats||[]).filter(f=>f.type?.startsWith('audio/')&&f.itag).sort((a,b)=>(parseInt(b.bitrate)||0)-(parseInt(a.bitrate)||0));
        if(!fmts.length) continue;
        const url = `${inst}/latest_version?id=${encodeURIComponent(videoId)}&itag=${encodeURIComponent(fmts[0].itag)}&local=true`;
        const ar = await fetchWithTimeout(url, {}, 120000); if(!ar.ok) continue;
        const blob = await ar.blob(); if(!blob||blob.size<10000) continue;
        return { blob, mimeType:fmts[0].type.split(';')[0], pipedTitle:data.title, pipedUploader:data.author, pipedDuration:data.lengthSeconds };
      } catch(e) {
        if (e.name !== 'AbortError') console.error('Invidious download error:', inst);
      }
    }
    throw new Error('Aucun serveur disponible');
  }

  ytSearchInput.addEventListener('input', () => {
    if (!ytSearchInput.value.trim()) {
      ytResultsContainer.innerHTML = '';
      ytSearchResults = [];
    }
  });

  async function doYTSearch() {
    const q = ytSearchInput.value.trim();
    if (!q) { showToast('Tape quelque chose à rechercher'); return; }
    ytResultsContainer.innerHTML = '<div class="yt-loading"><div class="spinner"></div></div>';
    try { renderYTResults(await searchYouTube(q)); }
    catch(err) {
      ytResultsContainer.innerHTML = `<p class="empty-state" style="color:var(--danger)">${esc(err.message)}</p>`;
      showToast('Erreur: '+err.message.slice(0,60));
    }
  }
  ytSearchBtn.addEventListener('click', doYTSearch);
  ytSearchInput.addEventListener('keydown', (e) => { if(e.key==='Enter'){e.preventDefault();doYTSearch();} });

  // ===== Service Worker =====
  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('./sw.js'); }
    catch(e) { /* SW optionnel — échec silencieux */ }
  }

  // ===== Portrait Lock =====
  // iOS ne supporte pas screen.orientation.lock() — on utilise JS pur.
  // On cible uniquement les appareils mobiles (plus petite dimension ≤ 600px).
  const _plOverlay = document.getElementById('portraitLockOverlay');
  const _appEl     = document.getElementById('app');

  function _isMobile() {
    return Math.min(screen.width, screen.height) <= 600;
  }
  function _applyPortraitLock() {
    if (!_isMobile()) return;
    const landscape = window.innerWidth > window.innerHeight;
    _plOverlay.style.display         = landscape ? 'flex'   : '';
    if (_appEl) _appEl.style.visibility = landscape ? 'hidden' : '';
    // Bloquer le scroll quand l'overlay est actif
    document.body.style.overflow = landscape ? 'hidden' : '';
  }

  window.addEventListener('resize', _applyPortraitLock, { passive: true });
  // orientationchange est parfois décalé sur iOS → petit délai
  window.addEventListener('orientationchange', () => {
    setTimeout(_applyPortraitLock, 80);
  }, { passive: true });
  _applyPortraitLock(); // vérification immédiate au chargement

  // Verrouillage natif (Android Chrome PWA installée, ignoré silencieusement sur iOS)
  if (screen.orientation && screen.orientation.lock) {
    screen.orientation.lock('portrait').catch(() => {});
  }
  document.addEventListener('touchstart', function retryLock() {
    if (screen.orientation && screen.orientation.lock) {
      screen.orientation.lock('portrait').catch(() => {});
    }
  }, { once: true, passive: true });

  // ===== Init =====
  syncYTAPIState();
  ensureYTAPIScript();
  await loadUserTracks();
  await loadProfilePicture();
  refreshHomeView();
  volumeFill.style.width = `${Player.getVolume()*100}%`;
})();
