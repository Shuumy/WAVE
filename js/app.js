/**
 * WAVE — Main Application
 * SÉCURITÉ : XSS échappé, URLs sanitisées, tailles limitées, types validés.
 */
(async () => {
  // Safari iOS peut signaler une hauteur dvh réduite pour une web app installée.
  if (navigator.standalone === true) document.documentElement.classList.add('ios-standalone');
  await DB.open();
  await WaveI18n.init(DB);

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
      if (!['https:', 'data:', 'blob:'].includes(u.protocol)) return '';
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
  let librarySort = { key: 'title', dir: 'asc' };
  let librarySearchQuery = '';
  let playlistSort = { key: 'default', dir: 'asc' };
  let cleanupPlaylistCoverAction = null;
  let cleanupPlaylistScroll = null;
  let cleanupPlaylistSwipe = null;
  let playlistGridScroll = 0;
  let playlistGridFrame = null;
  const viewScrollPositions = new Map();
  let libraryCustomOrder = (await DB.getSetting('libraryCustomOrder')) || [];
  if (!Array.isArray(libraryCustomOrder)) libraryCustomOrder = [];
  let shuffleActive = false;
  let repeatMode = 'none';

  // ===== Confirm Dialog =====
  function showConfirm(message) {
    return new Promise((resolve) => {
      // Utilise textContent pour éviter toute injection dans le message de confirmation
      confirmMessage.textContent = message;
      WaveMotion.open(confirmModal);
      const cleanup = (result) => {
        WaveMotion.close(confirmModal);
        confirmYes.onclick = null;
        confirmNo.onclick  = null;
        resolve(result);
      };
      confirmYes.onclick = () => cleanup(true);
      confirmNo.onclick  = () => cleanup(false);
    });
  }
  confirmModal.addEventListener('click', (e) => {
    if (e.target === confirmModal) { WaveMotion.close(confirmModal); }
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
  WaveMobile.preventZoom(document);
  const tabTap = WaveMobile.tabTap();
  let scrollToTopView = null;
  const scrollPageTop = () => $('.main-content').scrollTo({top:0,
    behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      if(tabTap(btn.dataset.view)) {
        viewScrollPositions.set(btn.dataset.view,0);
        if(btn.classList.contains('active')) scrollPageTop();
        else scrollToTopView=btn.dataset.view;
        return;
      }
      if (btn.classList.contains('active')) return;
      const scroller = $('.main-content');
      WaveMotion.navigate(scroller, async () => {
        const previous = $('.nav-btn.active')?.dataset.view;
        if (previous) viewScrollPositions.set(previous, scroller.scrollTop);
        navBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        views.forEach(v => v.classList.remove('active'));
        $(`#view${btn.dataset.view.charAt(0).toUpperCase() + btn.dataset.view.slice(1)}`).classList.add('active');
        currentPlaylistView = null;
        cleanupPlaylistCoverAction?.();
        cleanupPlaylistScroll?.(); cleanupPlaylistSwipe?.();
        scroller.classList.remove('playlist-open');
        setTheme(document.documentElement.dataset.theme || 'dark');
        if (btn.dataset.view === 'library') await refreshLibraryView();
        if (btn.dataset.view === 'home') await refreshHomeView();
        if (btn.dataset.view === 'import') refreshImportView();
        if(scrollToTopView===btn.dataset.view) {
          scroller.scrollTop=0;scrollToTopView=null;
        } else scroller.scrollTop = viewScrollPositions.get(btn.dataset.view) || 0;
      });
    });
  });

  // ===== Toast =====
  let toastTimer = null;
  function showToast(msg) {
    if (!msg) { toast.classList.remove('show'); return; }
    // textContent pour éviter XSS dans les messages de toast
    toastMessage.textContent = WaveI18n.t(msg);
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
  const settingsMain = $('#settingsMain');
  const settingsPanel = $('#settingsPanel');
  const settingsPanelTitle = $('#settingsPanelTitle');
  const settingsPanelContent = $('#settingsPanelContent');
  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    if (!$('.main-content')?.classList.contains('playlist-open')) {
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#fafafa' : '#0a0a0a');
    }
    $$('.settings-theme-choice').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.theme === theme)));
  }
  DB.getSetting('theme').then(theme => setTheme(theme === 'light' ? 'light' : 'dark'));
  settingsBtn.addEventListener('click', () => {
    settingsMain.hidden = false; settingsPanel.hidden = true;
    WaveMotion.open(settingsOverlay);
  });
  closeSettingsBtn.addEventListener('click', () => { WaveMotion.close(settingsOverlay); });
  settingsOverlay.addEventListener('click', (e) => { if (e.target === settingsOverlay) WaveMotion.close(settingsOverlay); });
  $('#settingsBack').addEventListener('click', () => { settingsPanel.hidden = true; settingsMain.hidden = false; WaveMotion.enter(settingsMain, -1); });
  $$('.settings-entry').forEach(entry => entry.addEventListener('click', () => {
    const panel = entry.dataset.settingsPanel;
    settingsPanelTitle.textContent = {account:'Compte',appearance:'Affichage',languages:'Langues',legal:'Mentions légales'}[panel];
    settingsPanelContent.innerHTML = '';
    if (panel === 'appearance') {
      for (const [theme, label] of [['light','Jour (clair)'], ['dark','Nuit (sombre)']]) {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'settings-theme-choice';
        button.dataset.theme = theme; button.textContent = label;
        button.addEventListener('click', async () => { setTheme(theme); await DB.setSetting('theme', theme); });
        settingsPanelContent.appendChild(button);
      }
      setTheme(document.documentElement.dataset.theme || 'dark');
    } else if (panel === 'languages') {
      WaveI18n.renderPicker(settingsPanelContent);
    } else if (panel === 'legal') {
      for (const [label, href] of [['Confidentialité', './confidentialite.html'], ['Informations légales et conditions d’utilisation', './conditions.html']]) {
        const link = document.createElement('a'); link.className = 'settings-legal-link';
        link.href = href; link.textContent = label; settingsPanelContent.appendChild(link);
      }
    }
    settingsMain.hidden = true; settingsPanel.hidden = false; WaveMotion.enter(settingsPanel);
  }));

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

  const cropOverlay = $('#profileCropOverlay');
  const cropStage = $('#cropStage');
  const cropImage = $('#cropImage');
  const cropZoom = $('#cropZoom');
  let cropSource = null;
  let cropOffset = { x:0, y:0 };
  let cropRotation = 0;
  function cropScale() {
    if (!cropSource) return 1;
    const turned = cropRotation % 180 !== 0;
    return cropStage.clientWidth / Math.min(turned ? cropSource.naturalHeight : cropSource.naturalWidth, turned ? cropSource.naturalWidth : cropSource.naturalHeight) * Number(cropZoom.value);
  }
  function updateCrop() {
    if (!cropSource) return;
    const scale = cropScale();
    const side = cropStage.clientWidth;
    const turned = cropRotation % 180 !== 0;
    const width = (turned ? cropSource.naturalHeight : cropSource.naturalWidth) * scale;
    const height = (turned ? cropSource.naturalWidth : cropSource.naturalHeight) * scale;
    cropOffset.x = Math.max((side-width)/2, Math.min((width-side)/2, cropOffset.x));
    cropOffset.y = Math.max((side-height)/2, Math.min((height-side)/2, cropOffset.y));
    cropImage.style.width = `${cropSource.naturalWidth * scale}px`;
    cropImage.style.height = `${cropSource.naturalHeight * scale}px`;
    cropImage.style.transform = `translate(-50%, -50%) translate(${cropOffset.x}px, ${cropOffset.y}px) rotate(${cropRotation}deg)`;
  }
  function closeCrop() { WaveMotion.close(cropOverlay); cropSource = null; }
  $('#cropCancel').addEventListener('click', closeCrop);
  $('#cropRotate').addEventListener('click', () => { cropRotation = (cropRotation + 90) % 360; cropOffset = { x:0, y:0 }; updateCrop(); });
  cropZoom.addEventListener('input', updateCrop);
  let lastPointer = null;
  cropStage.addEventListener('pointerdown', e => {
    if (!cropSource) return;
    lastPointer = { id:e.pointerId, x:e.clientX, y:e.clientY };
    cropStage.setPointerCapture(e.pointerId);
  });
  cropStage.addEventListener('pointermove', e => {
    if (!lastPointer || lastPointer.id !== e.pointerId) return;
    cropOffset.x += e.clientX - lastPointer.x; cropOffset.y += e.clientY - lastPointer.y;
    lastPointer.x = e.clientX; lastPointer.y = e.clientY; updateCrop();
  });
  cropStage.addEventListener('pointerup', () => { lastPointer = null; });
  cropStage.addEventListener('pointercancel', () => { lastPointer = null; });
  $('#cropSave').addEventListener('click', async () => {
    if (!cropSource) return;
    const side = cropStage.clientWidth;
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
    const ctx = canvas.getContext('2d');
    ctx.beginPath(); ctx.arc(256,256,256,0,Math.PI*2); ctx.clip();
    ctx.translate(256 + cropOffset.x * 512/side, 256 + cropOffset.y * 512/side);
    ctx.rotate(cropRotation * Math.PI/180);
    ctx.scale(cropScale() * 512/side, cropScale() * 512/side);
    ctx.drawImage(cropSource, -cropSource.naturalWidth/2, -cropSource.naturalHeight/2);
    const dataUrl = canvas.toDataURL('image/png');
    try {
      await DB.setSetting('profilePicture', dataUrl);
      const img = document.createElement('img'); img.src = dataUrl; img.alt = 'Profil';
      profileAvatar.replaceChildren(img);
      closeCrop(); showToast('Photo mise à jour');
    } catch { showToast('Impossible d’enregistrer la photo'); }
  });

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
    reader.onload = (e) => {
      const dataUrl = e.target.result;
      // Vérifier que c'est bien une data:image/ URL
      if (!dataUrl.startsWith('data:image/')) {
        showToast('Format d\'image invalide.');
        return;
      }
      const img = new Image();
      img.onload = () => {
        cropSource = img; cropImage.src = dataUrl;
        cropRotation = 0; cropOffset = { x:0, y:0 }; cropZoom.value = '1';
        WaveMotion.open(cropOverlay); updateCrop();
      };
      img.onerror = () => showToast('Image illisible');
      img.src = dataUrl;
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
    { key:'custom',   label:'Tri personnalisé' },
    { key:'duration', label:'Durée' },
    { key:'title',    label:'Titre' },
    { key:'artist',   label:'Artiste' },
    { key:'rating',   label:'Note' },
  ];
  function applySort(tracks, sortState) {
    const st = sortState || librarySort;
    if (st.key === 'default') return [...tracks]; // ordre original de la playlist
    if (st.key === 'custom') {
      if (st === playlistSort) return [...tracks];
      const positions = new Map(libraryCustomOrder.map((id, i) => [id, i]));
      return [...tracks].sort((a, b) => (positions.get(a.id) ?? Infinity) - (positions.get(b.id) ?? Infinity));
    }
    const s = [...tracks];
    const asc = st.dir === 'asc';
    s.sort((a, b) => {
      if (st.key === 'rating') {
        const ra = window.WaveRatings?.getValue(a.id);
        const rb = window.WaveRatings?.getValue(b.id);
        if (ra == null) return rb == null ? 0 : 1;
        if (rb == null) return -1;
        return asc ? ra - rb : rb - ra;
      }
      let va, vb;
      switch (st.key) {
        case 'title':    va = transliterate(a.title);  vb = transliterate(b.title);  break;
        case 'artist':   va = transliterate(a.artist); vb = transliterate(b.artist); break;
        case 'duration': va = a.duration || 0;         vb = b.duration || 0;         break;
        default:         va = transliterate(a.title); vb = transliterate(b.title); break;
      }
      if (typeof va === 'string') return asc ? va.localeCompare(vb) : vb.localeCompare(va);
      return asc ? va - vb : vb - va;
    });
    return s;
  }
  window.addEventListener('wave:ratings-changed', () => {
    if (librarySort.key === 'rating' || playlistSort.key === 'rating') refreshLibraryView();
  });
  function renderSortRow(container, sortState, onSortChange, playlist = null, visibleTracks = []) {
    const st = sortState || librarySort;
    const onChange = onSortChange || (() => refreshLibraryView());
    const row = document.createElement('div');
    row.className = 'sort-row';
    const edit = document.createElement('button');
    edit.className = 'sort-pill'; edit.type = 'button';
    edit.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M9 6h12M9 12h12M9 18h12M3 6h2M3 12h2M3 18h2"/></svg><span>Modifier</span>';
    edit.addEventListener('click', () => openTrackOrganizer(playlist, visibleTracks));
    row.appendChild(edit);
    const sort = document.createElement('button');
    sort.className = 'sort-pill'; sort.type = 'button';
    sort.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M7 12h10M10 17h4"/><path d="m17 4 3 3-3 3"/></svg><span>Trier</span>';
    sort.setAttribute('aria-label', 'Trier les morceaux');
    sort.addEventListener('click', () => {
      const overlay = document.createElement('div');
      overlay.className = 'sort-sheet-backdrop';
      const sheet = document.createElement('div'); sheet.className = 'sort-sheet';
      sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-label', 'Trier les morceaux');
      sheet.innerHTML = '<h3>Trier par</h3>';
      SORT_OPTIONS.forEach(({ key, label }) => {
        const option = document.createElement('button'); option.type = 'button';
        option.className = 'sort-sheet-option' + (st.key === key || (key === 'custom' && st.key === 'default') ? ' active' : '');
        option.textContent = label + (st.key === key && key !== 'custom' ? (st.dir === 'asc' ? ' ↑' : ' ↓') : '');
        option.addEventListener('click', () => {
          if (st.key === key && key !== 'custom') st.dir = st.dir === 'asc' ? 'desc' : 'asc';
          else { st.key = key; st.dir = key === 'title' || key === 'artist' || key === 'custom' ? 'asc' : 'desc'; }
          WaveMotion.close(overlay, true); onChange();
        });
        sheet.appendChild(option);
      });
      overlay.appendChild(sheet);
      overlay.addEventListener('click', e => { if (e.target === overlay) WaveMotion.close(overlay, true); });
      overlay.addEventListener('keydown', e => { if (e.key === 'Escape') WaveMotion.close(overlay, true); });
      document.body.appendChild(overlay);
      sheet.querySelector('button')?.focus();
    });
    row.appendChild(sort);
    container.insertBefore(row, container.firstChild);
  }

  // L'éditeur travaille sur une copie et enregistre seulement à « Sauvegarder ».
  function openTrackOrganizer(playlist, tracks) {
    const favoritesView = !playlist && $('.library-tabs .tab-btn.active')?.dataset.tab === 'favorites';
    const allIds = playlist ? playlist.trackIds.filter(id => findTrack(id)) : favoritesView ? tracks.map(t => t.id) :
      applySort(getAllTracks(), { key:'custom' }).map(t => t.id);
    const ids = [...allIds];
    const selected = new Set();
    const overlay = document.createElement('div'); overlay.className = 'organizer-overlay';
    overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', playlist ? 'Modifier la playlist' : 'Modifier la bibliothèque');
    overlay.innerHTML = `<div class="organizer-panel"><div class="organizer-head">
      <button type="button" class="organizer-cancel">Annuler</button><h3>${playlist ? 'Modifier la playlist' : 'Modifier les morceaux'}</h3>
      <button type="button" class="organizer-save">Sauvegarder</button></div>
      <p class="organizer-hint">Glisse ☰ pour changer l’ordre. Sélectionne des morceaux pour les retirer.</p>
      <div class="organizer-list"></div><div class="organizer-foot">
      <button type="button" class="organizer-all">Tout sélectionner</button>
      <button type="button" class="organizer-remove" disabled>${playlist || favoritesView ? 'Retirer' : 'Supprimer'} (0)</button></div></div>`;
    const list = overlay.querySelector('.organizer-list');
    const remove = overlay.querySelector('.organizer-remove');
    const dragController = WaveOrganizerDrag.attach(list, overlay, order => {
      ids.splice(0, ids.length, ...order);
    });
    const closeOrganizer = () => { dragController.destroy(); WaveMotion.close(overlay, true); };
    const updateSelected = () => {
      remove.disabled = !selected.size;
      remove.textContent = `${playlist || favoritesView ? 'Retirer' : 'Supprimer'} (${selected.size})`;
      overlay.querySelector('.organizer-all').textContent = selected.size === ids.length && ids.length ? 'Tout désélectionner' : 'Tout sélectionner';
    };
    const render = () => {
      dragController.cancel();
      list.innerHTML = '';
      ids.forEach((id, index) => {
        const track = findTrack(id); if (!track) return;
        const row = document.createElement('div'); row.className = 'organizer-track';
        row.dataset.trackId = id;
        const cover = sanitizeURL(generateArtwork(track)) || generateArtwork(track);
        row.innerHTML = `<button type="button" class="organizer-check" aria-label="Sélectionner ${esc(track.title)}" aria-pressed="${selected.has(id)}">${selected.has(id) ? '✓' : '○'}</button>
          <img src="${esc(cover)}" alt=""><div class="organizer-meta"><strong>${esc(track.title)}</strong><small>${esc(track.artist)}</small></div>
          <button type="button" class="organizer-handle" aria-label="Déplacer ${esc(track.title)}. Flèches haut et bas au clavier"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>`;
        row.addEventListener('click', e => {
          if (e.target.closest('.organizer-handle')) return;
          if (selected.has(id)) selected.delete(id); else selected.add(id);
          render();
        });
        const handle = row.querySelector('.organizer-handle');
        handle.addEventListener('click', e => e.stopPropagation());
        handle.addEventListener('keydown', e => {
          if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
          e.preventDefault(); const index = ids.indexOf(id), next = index + (e.key === 'ArrowUp' ? -1 : 1);
          if (next < 0 || next >= ids.length) return;
          ids.splice(index, 1); ids.splice(next, 0, id); render();
          list.children[next]?.querySelector('.organizer-handle')?.focus();
        });
        list.appendChild(row);
      });
      updateSelected();
    };
    overlay.querySelector('.organizer-cancel').addEventListener('click', () => closeOrganizer());
    overlay.querySelector('.organizer-all').addEventListener('click', () => {
      if (selected.size === ids.length) selected.clear(); else ids.forEach(id => selected.add(id)); render();
    });
    overlay.querySelector('.organizer-remove').addEventListener('click', async () => {
      if (!selected.size) return;
      if (!playlist && !favoritesView && !await showConfirm(`Supprimer définitivement ${selected.size} morceau${selected.size > 1 ? 'x' : ''} de la bibliothèque ?`)) return;
      // La suppression de la bibliothèque est appliquée à la sauvegarde.
      selected.forEach(id => ids.splice(ids.indexOf(id), 1));
      selected.clear(); render();
    });
    overlay.querySelector('.organizer-save').addEventListener('click', async () => {
      dragController.cancel();
      if (playlist) {
        const latest = await DB.getPlaylist(playlist.id);
        if (!latest) { closeOrganizer(); return; }
        latest.trackIds = [...ids, ...latest.trackIds.filter(id => !allIds.includes(id))];
        await DB.updatePlaylist(latest); playlistSort.key = 'custom';
      } else {
        const removed = allIds.filter(id => !ids.includes(id));
        for (const id of removed) {
          if (favoritesView) { if (await DB.isFavorite(id)) await DB.toggleFavorite(id); }
          else await DB.removeUserTrack(id);
        }
        if (removed.length && !favoritesView) await loadUserTracks();
        libraryCustomOrder = [...ids, ...getAllTracks().map(t => t.id).filter(id => !ids.includes(id))];
        await DB.setSetting('libraryCustomOrder', libraryCustomOrder);
        librarySort.key = 'custom';
      }
      closeOrganizer(); refreshAllViews();
      showToast('Ordre enregistré');
    });
    overlay.addEventListener('click', e => { if (e.target === overlay) closeOrganizer(); });
    overlay.addEventListener('keydown', e => { if (e.key === 'Escape') closeOrganizer(); });
    document.body.appendChild(overlay); render();
    overlay.querySelector('.organizer-cancel').focus();
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
  let metadataScriptPromise;
  function loadMetadataReader() {
    if (window.jsmediatags) return Promise.resolve();
    if (!metadataScriptPromise) metadataScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jsmediatags/3.9.5/jsmediatags.min.js';
      script.integrity = 'sha384-JpTt7qxVx1X/pHeYiCfqFdKRu2HF1MBGr1kEXtbNIGwwryGWMbbW78onU3bdkAHZ';
      script.crossOrigin = 'anonymous';
      script.referrerPolicy = 'no-referrer';
      const deadline = setTimeout(() => { script.remove(); reject(new Error('Metadata timeout')); }, 8000);
      script.onload = () => { clearTimeout(deadline); resolve(); };
      script.onerror = () => { clearTimeout(deadline); reject(new Error('Metadata unavailable')); };
      document.head.appendChild(script);
    }).catch(() => { metadataScriptPromise = null; });
    return metadataScriptPromise;
  }

  async function extractAllMetadata(file) {
    await loadMetadataReader();
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
            resolve({ title, artist, album, genre, releaseYear, coverArt, tagged:!!(t.title && t.artist) });
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
    optionsOverlay.dataset.context = 'track';
    optionsOverlay.dataset.trackId = track.id;
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
      span.dataset.i18n = '';
      span.textContent = label;
      btn.appendChild(span);
      btn.addEventListener('click', () => { closeOptionsSheet(); handler(); });
      optionsList.appendChild(btn);
      return btn;
    };

    addItem('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
      'Ajouter à une playlist', '', () => openPlaylistModal(track.id));

    addItem('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
      'Modifier les informations', '', () => openTrackEdit(track));

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

    if (track.userImported) {
      if(WaveIdentify.canIdentify(track)) {
      const identifyButton=addItem('', 'Rechercher et corriger les informations', '', async () => {
        const snapshot={...track};
        if(!await showConfirm('Rechercher ce morceau et remplacer automatiquement son titre et son artiste par le meilleur résultat fiable ? Tu pourras rétablir les informations d’origine.')) return;
        const queued=await WaveIdentify.retry(snapshot,true);
        showToast(queued ? (navigator.onLine===false ? 'Recherche en attente de connexion' : 'Recherche demandée. Le résultat sera signalé ici.') : 'Le morceau a changé. Rouvre son menu pour réessayer.');
      });
      identifyButton.dataset.identifyAction='true';
      }
      if(track.originalMetadata) addItem('', 'Rétablir les informations d’origine', '', async () => {
        const updated=await DB.updateUserTrack(track.id,{...track.originalMetadata,metadataLocked:true,identification:{status:'restored'}});
        if(updated) await refreshIdentifiedTrack(updated);
      });
    }
    WaveMotion.open(optionsOverlay);
  }

  function showPlaylistOptions(pl) {
    optionsOverlay.dataset.context = 'playlist';
    optionsArtwork.innerHTML = '';
    if (pl.coverImage) {
      const img = document.createElement('img'); img.src = sanitizeURL(pl.coverImage); img.alt = '';
      optionsArtwork.appendChild(img);
    }
    optionsTitle.textContent = pl.name;
    optionsArtist.textContent = 'Playlist';
    optionsList.innerHTML = '';
    const option = (label, icon, action, danger = false) => {
      const button = document.createElement('button');
      button.className = 'options-item' + (danger ? ' danger' : '');
      button.innerHTML = icon;
      const span = document.createElement('span'); span.dataset.i18n = ''; span.textContent = label; button.appendChild(span);
      button.addEventListener('click', () => { closeOptionsSheet(); action(); });
      optionsList.appendChild(button);
    };
    option('Renommer la playlist', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>', async () => {
      const name = validatePlaylistName(prompt('Nouveau nom :', pl.name));
      if (!name || name === pl.name) return;
      pl.name = name; await DB.updatePlaylist(pl);
      showToast('Playlist renommée'); renderPlaylistDetail(pl.id);
    });
    option('Supprimer la playlist', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>', async () => {
      if (!await showConfirm(`Supprimer la playlist « ${pl.name} » ?`)) return;
      await DB.deletePlaylist(pl.id);
      currentPlaylistView = null; showToast('Playlist supprimée'); refreshLibraryView();
    }, true);
    WaveMotion.open(optionsOverlay);
  }

  function closeOptionsSheet() { WaveMotion.close(optionsOverlay); }
  optionsOverlay.addEventListener('click', (e) => { if (e.target === optionsOverlay) closeOptionsSheet(); });

  const trackEditModal = $('#trackEditModal');
  const trackEditForm = $('#trackEditForm');
  const trackEditCover = $('#trackEditCover');
  const trackEditPreview = $('#trackEditPreview');
  let editingTrack = null;
  let editedCover = null;
  let coverReadPromise = null;
  let coverToken = 0;
  function closeTrackEdit() {
    coverToken++;
    WaveMotion.close(trackEditModal); editingTrack = null;
    trackEditForm.reset();
  }
  function openTrackEdit(track) {
    coverToken++;
    editingTrack = track;
    editedCover = track.coverArt || null;
    coverReadPromise = null;
    $('#trackEditTitle').value = track.title;
    $('#trackEditArtist').value = track.artist;
    trackEditCover.value = '';
    trackEditPreview.src = sanitizeURL(generateArtwork(track));
    WaveMotion.open(trackEditModal);
    $('#trackEditTitle').focus();
  }
  $('#trackEditClose').addEventListener('click', closeTrackEdit);
  trackEditModal.addEventListener('click', e => { if (e.target === trackEditModal) closeTrackEdit(); });
  $('#trackEditRemoveCover').addEventListener('click', () => {
    if (!editingTrack) return;
    coverToken++; coverReadPromise = null;
    editedCover = null; trackEditCover.value = '';
    trackEditPreview.src = sanitizeURL(generateArtwork({ ...editingTrack, coverArt:null }));
  });
  trackEditCover.addEventListener('change', async () => {
    const file = trackEditCover.files[0]; if (!file) return;
    const token = ++coverToken;
    if (!ALLOWED_IMAGE_TYPES.includes(file.type) || file.size > MAX_IMAGE_SIZE) {
      showToast('Utilise une image JPG, PNG, GIF ou WebP de moins de 5 Mo.');
      trackEditCover.value = ''; return;
    }
    try {
      coverReadPromise = new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result);
        reader.onerror = reject; reader.readAsDataURL(file);
      });
      const dataUrl = await coverReadPromise;
      if (!editingTrack || token !== coverToken) return;
      if (!dataUrl.startsWith('data:image/')) throw new Error('Image invalide');
      editedCover = dataUrl; trackEditPreview.src = dataUrl;
    } catch { if (token === coverToken) { coverReadPromise = null; showToast('Image illisible'); } }
  });
  trackEditForm.addEventListener('submit', async e => {
    e.preventDefault(); if (!editingTrack) return;
    if (coverReadPromise) {
      try { await coverReadPromise; } catch { showToast('Image illisible'); return; }
    }
    const title = $('#trackEditTitle').value.trim();
    const artist = $('#trackEditArtist').value.trim();
    if (!title || !artist) { showToast('Indique un titre et un artiste.'); return; }
    const changes = { title, artist, coverArt:editedCover, metadataLocked:true,identification:{status:'edited'},
      originalMetadata:editingTrack.originalMetadata||{title:editingTrack.title,artist:editingTrack.artist} };
    try {
      await DB.updateUserTrack(editingTrack.id, changes);
      Object.assign(editingTrack, changes);
      const current = Player.getCurrentTrack();
      if (current?.id === editingTrack.id) {
        Object.assign(current, changes);
        playerTitle.textContent = nowPlayingTitle.textContent = title;
        playerArtist.textContent = nowPlayingArtist.textContent = artist;
        for (const host of [playerArtwork, nowPlayingArtwork]) {
          const img = document.createElement('img'); img.src = sanitizeURL(generateArtwork(current)); img.alt = '';
          host.replaceChildren(img);
        }
        if ('mediaSession' in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title, artist, album:current.album || '' });
      }
      closeTrackEdit(); refreshAllViews(); showToast('Morceau mis à jour');
    } catch { showToast('Impossible de modifier le morceau'); }
  });

  // ===== Track Element =====
  /**
   * Crée un élément de piste audio.
   * SÉCURITÉ : toutes les données utilisateur sont échappées via esc() ou textContent.
   */
  function createTrackElement(track, index, list, opts = {}) {
    const { playlistId, onRemoveFromPlaylist } = opts;
    const wrap = document.createElement('div');
    wrap.className = 'track-item-wrap';
    const div = document.createElement('div');
    div.className = 'track-item';
    div.dataset.trackId = track.id;
    const ct = Player.getCurrentTrack();
    if (ct && ct.id === track.id) div.classList.add('playing');
    if (selectMode && selectedTrackIds.has(track.id)) div.classList.add('selected');

    const artSrc = sanitizeURL(generateArtwork(track)) || generateArtwork(track);

    const optionsBtn = `<button class="icon-btn track-options-btn" title="Options">
      <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
    </button>`;

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
        ${optionsBtn}
      </div>`;

    DB.isFavorite(track.id).then(isFav => {
      const fb = div.querySelector('.fav-btn');
      if (isFav) { fb.classList.add('fav-active'); fb.querySelector('svg').setAttribute('fill', 'currentColor'); }
      fb.setAttribute('aria-label', isFav ? 'Retirer des favoris' : 'Ajouter aux favoris');
    });

    div.querySelector('.fav-btn').addEventListener('click', async (e) => {
      e.stopPropagation(); if (selectMode) return;
      const btn = e.currentTarget;
      const isFav = await DB.toggleFavorite(track.id);
      btn.classList.toggle('fav-active', isFav);
      btn.querySelector('svg').setAttribute('fill', isFav ? 'currentColor' : 'none');
      btn.setAttribute('aria-label', isFav ? 'Retirer des favoris' : 'Ajouter aux favoris');
      showToast(isFav ? 'Ajouté aux favoris' : 'Retiré des favoris');
      const cur = Player.getCurrentTrack();
      if (cur && cur.id === track.id) {
        playerFavorite.classList.toggle('active', isFav);
        playerFavorite.querySelector('svg').setAttribute('fill', isFav ? 'currentColor' : 'none');
        playerFavorite.setAttribute('aria-label', isFav ? 'Retirer des favoris' : 'Ajouter aux favoris');
        nowPlayingFav.classList.toggle('active', isFav);
        nowPlayingFav.querySelector('svg').setAttribute('fill', isFav ? 'currentColor' : 'none');
      }
    });

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

    let lpTimer = null;
    div.addEventListener('touchstart', () => {
      lpTimer = setTimeout(() => {
        if (!selectMode) enterSelectMode(track.id); else toggleTrackSelect(track.id, div);
      }, 500);
    }, { passive: true });
    div.addEventListener('touchend',  () => clearTimeout(lpTimer));
    div.addEventListener('touchmove', () => clearTimeout(lpTimer));

    div.addEventListener('click', (e) => {
      if (e.target.closest('.fav-btn,.track-options-btn,.track-rating-badge')) return;
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
          WaveMotion.close(playlistModal);
        });
        playlistModalBody.appendChild(opt);
      });
    }
    WaveMotion.open(playlistModal);
  }
  closePlaylistModal.addEventListener('click', () => { WaveMotion.close(playlistModal); });
  playlistModal.addEventListener('click', (e) => { if (e.target === playlistModal) WaveMotion.close(playlistModal); });
  createPlaylistBtn.addEventListener('click', async () => {
    const raw = prompt('Nom de la playlist:');
    const name = validatePlaylistName(raw);
    if (!name) return;
    const pl = await DB.createPlaylist(name);
    if (modalTrackIds?.length) {
      for (const tid of modalTrackIds) await DB.addTrackToPlaylist(pl.id, tid);
      showToast(`"${pl.name}" créée avec ${modalTrackIds.length} morceau${modalTrackIds.length !== 1 ? 'x' : ''}`);
    } else { showToast(`"${pl.name}" créée`); }
    WaveMotion.close(playlistModal);
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
    $('.main-content')?.classList.toggle('playlist-open', tab === 'playlists' && !!currentPlaylistView);
    if (tab !== 'playlists' || !currentPlaylistView) { cleanupPlaylistCoverAction?.(); cleanupPlaylistScroll?.(); cleanupPlaylistSwipe?.(); }
    if (tab !== 'playlists' || !currentPlaylistView) setTheme(document.documentElement.dataset.theme || 'dark');
    // Masquer la searchbar pour les playlists
    if (libSearchBar) libSearchBar.hidden = (tab === 'playlists');
    if (tab === 'all') {
      content.innerHTML = '<div class="track-list" id="libraryTracks"></div>';
      const tracks = searchFilter(applySort(getAllTracks()), librarySearchQuery);
      renderSortRow(content, librarySort, () => refreshLibraryView(), null, tracks);
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
      else renderTrackList(c, tracks);
    } else if (tab === 'favorites') {
      content.innerHTML = '<div class="track-list" id="libraryTracks"></div>';
      const favs = await DB.getFavorites();
      const tracks = searchFilter(applySort(favs.map(f => findTrack(f.id)).filter(Boolean)), librarySearchQuery);
      renderSortRow(content, librarySort, () => refreshLibraryView(), null, tracks);
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
      else renderTrackList(c, tracks);
    } else if (tab === 'playlists') {
      if (currentPlaylistView) await renderPlaylistDetail(currentPlaylistView);
      else await renderPlaylistsGrid();
    }
  }

  async function renderPlaylistsGrid() {
    const content = $('#libraryContent');
    const pls = await DB.getPlaylists();
    if (currentPlaylistView || $('.library-tabs .tab-btn.active')?.dataset.tab !== 'playlists') return;
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
      card.addEventListener('click', async (e) => {
        const scroller = $('.main-content');
        await WaveMotion.navigate(scroller, async () => {
          playlistGridScroll = scroller.scrollTop;
          playlistGridFrame = WaveMotion.snapshot(scroller);
          currentPlaylistView = card.dataset.playlistId;
          await refreshLibraryView();
          scroller.scrollTop = 0;
          scroller.dispatchEvent(new Event('scroll'));
        }, 1);
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
    if (currentPlaylistView !== plId) return;
    if (!pl) { currentPlaylistView = null; refreshLibraryView(); return; }
    const content = $('#libraryContent');
    const tracks = pl.trackIds.map(id => findTrack(id)).filter(Boolean);
    const totalSec = tracks.reduce((s,t) => s + (t.duration||0), 0);
    const coverSrc = pl.coverImage ? sanitizeURL(pl.coverImage) || '' : '';
    const safeColor = /^#[0-9a-f]{6}$/i.test(pl.coverColor) ? pl.coverColor : '#555555';
    const palette = WavePlaylistColors.fromHex(safeColor);
    const scroller = content.closest('.main-content');
    const applyPalette = colors => {
      for (const [name, channels] of Object.entries(colors)) scroller.style.setProperty(`--playlist-${name}`, channels);
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', `rgb(${colors.vivid})`);
    };
    applyPalette(palette);
    cleanupPlaylistCoverAction?.();
    cleanupPlaylistScroll?.(); cleanupPlaylistSwipe?.();

    // ⚠️ SÉCURITÉ : esc() sur pl.name, esc() sur coverSrc
    content.innerHTML = `
      <div class="playlist-compact-header" id="playlistCompactHeader" aria-hidden="true">
        <button type="button" id="playlistCompactBack" aria-label="Retour aux playlists"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 18-6-6 6-6"/></svg></button>
        <span id="playlistCompactName"></span>
      </div>
      <div class="playlist-hero">
      <button class="playlist-back-btn" id="playlistBack">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg> Retour
      </button>
      <div class="playlist-detail-header">
        <button type="button" class="playlist-detail-cover" style="background:${safeColor}" id="playlistCoverBtn" aria-label="Changer la pochette de la playlist">
          ${coverSrc ? `<img src="${esc(coverSrc)}" alt="">` : '&#9835;'}
          <div class="playlist-cover-overlay"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></div>
        </button>
        <div class="playlist-detail-info">
          <h3>
            <span id="playlistNameSpan"></span>
            <button class="playlist-menu-btn icon-btn" id="playlistMenuBtn" aria-label="Options de la playlist" title="Options"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></svg></button>
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
      </div></div>
      <div id="playlistSortZone"></div>
      <div class="track-list" id="playlistTracks"></div>`;

    // Injection sécurisée du nom via textContent
    $('#playlistNameSpan').textContent = pl.name;
    $('#playlistCompactName').textContent = pl.name;

    const plTracksContainer = $('#playlistTracks');
    if (!tracks.length) {
      plTracksContainer.innerHTML = '<p class="empty-state">Aucun morceau. Clique sur "Ajouter des morceaux".</p>';
    } else {
      const sorted = applySort(tracks, playlistSort);
      renderTrackList(plTracksContainer, sorted, { playlistId: plId, onRemoveFromPlaylist: () => renderPlaylistDetail(plId) });
    }
    renderSortRow($('#playlistSortZone'), playlistSort, () => renderPlaylistDetail(plId), pl, tracks);
    const hero = content.querySelector('.playlist-hero');
    const compact = $('#playlistCompactHeader');
    const coverButton = $('#playlistCoverBtn');
    const hideCoverAction = () => coverButton.classList.remove('cover-actions-visible');
    const dismissOutside = e => {
      if (!hero.isConnected) { cleanupPlaylistCoverAction?.(); return; }
      if (!coverButton.contains(e.target)) hideCoverAction();
    };
    document.addEventListener('pointerdown', dismissOutside, true);
    scroller.addEventListener('touchmove', hideCoverAction, { passive:true });
    scroller.addEventListener('wheel', hideCoverAction, { passive:true });
    cleanupPlaylistCoverAction = () => {
      document.removeEventListener('pointerdown', dismissOutside, true);
      scroller.removeEventListener('touchmove', hideCoverAction);
      scroller.removeEventListener('wheel', hideCoverAction);
      hideCoverAction(); cleanupPlaylistCoverAction = null;
    };
    let scrollFrame = 0;
    const paintScroll = () => {
      scrollFrame = 0;
      if (!hero.isConnected) return;
      const distance = Math.max(0, scroller.scrollTop);
      hero.style.setProperty('--hero-opacity', Math.max(.18, 1 - distance / 380));
      hero.style.setProperty('--cover-shift', `${Math.min(125, distance * .48)}px`);
      hero.style.setProperty('--cover-alpha', Math.max(0, Math.min(1, (205 - distance) / 160)));
      compact.style.opacity = Math.max(0, Math.min(1, (distance - 240) / 80));
      compact.style.pointerEvents = distance > 290 ? 'auto' : 'none';
      compact.setAttribute('aria-hidden', distance <= 290 ? 'true' : 'false');
      compact.querySelector('button').tabIndex = distance > 290 ? 0 : -1;
      if (distance > 0) hideCoverAction();
    };
    const onScroll = () => {
      if (!hero.isConnected) { cleanupPlaylistScroll?.(); cleanupPlaylistSwipe?.(); return; }
      if (!scrollFrame) scrollFrame = requestAnimationFrame(paintScroll);
    };
    scroller.addEventListener('scroll', onScroll, { passive:true }); paintScroll();
    cleanupPlaylistScroll = () => {
      scroller.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(scrollFrame); cleanupPlaylistScroll = null;
    };
    if (coverSrc) {
      const cover = hero.querySelector('.playlist-detail-cover img');
      const sample = () => {
        if (!hero.isConnected) return;
        applyPalette(WavePlaylistColors.fromImage(cover, safeColor));
      };
      if (cover.complete && cover.naturalWidth) sample(); else cover.addEventListener('load', sample, { once:true });
    }
    const backToPlaylists = async (fromGesture = false) => {
      const render = async () => {
        currentPlaylistView = null;
        await refreshLibraryView();
        scroller.scrollTop = playlistGridScroll;
      };
      if (fromGesture) await render();
      else await WaveMotion.navigate(scroller, render, -1);
    };
    cleanupPlaylistSwipe = WaveMotion.edgeBack(scroller, content, () => backToPlaylists(true), () =>
      !!document.querySelector('.organizer-overlay, .sort-sheet-backdrop, .options-overlay:not([hidden]), .settings-overlay:not([hidden]), .modal-overlay:not([hidden]), .confirm-overlay:not([hidden]), .now-playing-screen:not([hidden])'),
      () => WaveMotion.swipeVisual(scroller, () => playlistGridFrame));

    $('#playlistBack').addEventListener('click', () => backToPlaylists());
    $('#playlistCompactBack').addEventListener('click', () => backToPlaylists());
    $('#playlistMenuBtn').addEventListener('click', () => showPlaylistOptions(pl));
    coverButton.addEventListener('click', () => {
      // Sur écran tactile, premier appui révèle l'action ; deuxième appui ouvre Fichiers.
      // Un appui extérieur ou le moindre défilement la referme immédiatement.
      if (matchMedia('(hover: none)').matches && !coverButton.classList.contains('cover-actions-visible')) {
        coverButton.classList.add('cover-actions-visible'); return;
      }
      hideCoverAction(); playlistCoverInput.dataset.playlistId = plId; playlistCoverInput.click();
    });
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
    WaveMotion.open(playlistSearchModal);
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
  closePlaylistSearchModal.addEventListener('click', () => { WaveMotion.close(playlistSearchModal); });
  playlistSearchModal.addEventListener('click', (e) => { if (e.target === playlistSearchModal) WaveMotion.close(playlistSearchModal); });

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
      if (btn.classList.contains('active')) return;
      const scroller = $('.main-content');
      WaveMotion.navigate(scroller, async () => {
        $$('.library-tabs .tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentPlaylistView = null;
        await refreshLibraryView();
        scroller.scrollTop = 0;
      });
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
    WaveMotion.open(nowPlayingScreen);
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
    WaveMotion.close(nowPlayingScreen);
    document.body.classList.remove('np-open');
  }
  nowPlayingClose.addEventListener('click', closeNowPlaying);

  // Swipe-up on player bar → open Now Playing
  const playerBar = $('#playerBar');
  function setMiniPlayerVisible(visible) {
    playerBar.hidden = !visible;
    $('#app').classList.toggle('no-player', !visible);
  }
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
    playerFavorite.setAttribute('aria-label', isFav ? 'Retirer des favoris' : 'Ajouter aux favoris');
    $$(`.track-item[data-track-id="${CSS.escape(track.id)}"] .fav-btn`).forEach(btn => {
      btn.classList.toggle('fav-active', isFav);
      btn.querySelector('svg').setAttribute('fill', isFav ? 'currentColor' : 'none');
      btn.setAttribute('aria-label', isFav ? 'Retirer des favoris' : 'Ajouter aux favoris');
    });
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
    setMiniPlayerVisible(true);
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
    playerFavorite.setAttribute('aria-label', isFav ? 'Retirer des favoris' : 'Ajouter aux favoris');
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
    const label = { none:'Répétition désactivée', all:'Répéter tout', one:'Répéter un seul morceau' }[mode];
    for (const button of [btnRepeat, npBtnRepeat]) {
      button.setAttribute('aria-label', label);
      button.title = label;
    }
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
    playerFavorite.setAttribute('aria-label', isFav ? 'Retirer des favoris' : 'Ajouter aux favoris');
    nowPlayingFav.classList.toggle('active', isFav);
    nowPlayingFav.querySelector('svg').setAttribute('fill', isFav ? 'currentColor' : 'none');
    showToast(isFav ? 'Ajouté aux favoris' : 'Retiré des favoris');
    $$(`.track-item[data-track-id="${CSS.escape(track.id)}"] .fav-btn`).forEach(btn => {
      btn.classList.toggle('fav-active', isFav);
      btn.querySelector('svg').setAttribute('fill', isFav ? 'currentColor' : 'none');
      btn.setAttribute('aria-label', isFav ? 'Retirer des favoris' : 'Ajouter aux favoris');
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
    return WaveIdentify.name(name);
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

      const { title, artist, album, genre, releaseYear, coverArt, tagged } = await extractAllMetadata(file);
      const { valid, duration } = await validateAudio(file);
      if (!valid) { fail++; continue; }

      // Valider que la coverArt extraite est bien une image
      const safeCoverArt = coverArt?.startsWith('data:image/') ? coverArt : null;

      const meta = {
        id: 'user-'+Date.now()+'-'+Math.random().toString(36).slice(2,8),
        title, artist, album, duration:Math.round(duration),
        genre, releaseYear, color:randColor(), userImported:true,
        fileName:file.name, importedAt:Date.now(), coverArt:safeCoverArt,
        metadataSource:tagged?'tags':'filename',
      };
      Object.assign(meta,WaveIdentify.initial(meta));
      await DB.saveUserTrack(meta, file);
      userTracks.push(meta); ok++;
      const pct = Math.round(((ok+fail)/list.length)*100);
      importProgressFill.style.width = `${pct}%`;
      importProgressText.textContent = `${ok} / ${list.length} fichier${list.length>1?'s':''} importé${list.length>1?'s':''}`;
    }
    showToast(ok > 0 ? `${ok} morceau${ok>1?'x':''} importé${ok>1?'s':''}` : 'Format non supporté');
    setTimeout(() => { importProgress.hidden=true; importProgressFill.style.width='0%'; }, 2000);
    refreshImportView(); refreshHomeView(); WaveIdentify.wake();
  }
  fileInput.addEventListener('change', () => { if(fileInput.files.length) { importFiles(fileInput.files); fileInput.value=''; } });
  importDropzone.addEventListener('click', (e) => { if(!e.target.closest('.import-btn') && e.target.tagName!=='LABEL') fileInput.click(); });

  // ===== Téléchargement WAVE API (utilisé depuis les résultats de recherche) =====
  function filenameFromDisposition(header, fallback) {
    if (!header) return fallback;
    const utf = header.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf) { try { return decodeURIComponent(utf[1]); } catch {} }
    const plain = header.match(/filename="?([^";]+)"?/i);
    return plain ? plain[1] : fallback;
  }

  async function downloadWaveAudio(videoId) {
    const response = await fetch(`${WAVE_API_BASE_URL}/api/download/${encodeURIComponent(videoId)}`, {
      method: 'GET', cache: 'no-store', credentials: 'omit',
      headers: { Accept: 'application/octet-stream,audio/*,video/*,*/*' },
    });
    if (!response.ok) {
      let message = `WAVE API indisponible (${response.status})`;
      try { const payload = await response.json(); if (payload?.detail) message = payload.detail; } catch {}
      throw new Error(message);
    }
    const blob = await response.blob();
    if (!blob || blob.size < 10000) throw new Error('Le fichier reçu est vide.');
    const mimeType = response.headers.get('content-type') || blob.type || 'application/octet-stream';
    const fallback = `${videoId}.${mimeType.includes('mp4') ? 'm4a' : mimeType.includes('webm') ? 'webm' : 'audio'}`;
    const fileName = filenameFromDisposition(response.headers.get('content-disposition'), fallback);
    return { blob, mimeType, fileName };
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

  window.onYouTubeIframeAPIReady = () => {
    ytAPIReady = true;
  };

  window.addEventListener('pageshow', () => {
    syncYTAPIState();
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      syncYTAPIState();
    }
  });

  const WAVE_API_BASE_URL = 'https://wave-docker.onrender.com';
  const canSaveYouTubeOffline = /Android/i.test(navigator.userAgent);

  function getVideoId(item) {
    if (item.videoId) return item.videoId;
    if (!item.url) return null;
    try { return new URLSearchParams(item.url.split('?')[1]).get('v'); } catch { return null; }
  }

  function fetchWithTimeout(url, opts={}, ms=15000) {
    try { const u = new URL(url); if (u.protocol !== 'https:') return Promise.reject(new Error('HTTPS requis')); }
    catch { return Promise.reject(new Error('URL invalide')); }
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), ms);
    return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(t));
  }

  async function searchYouTube(q) {
    const url = new URL('/api/search', WAVE_API_BASE_URL);
    url.searchParams.set('query', q.slice(0, 200)); url.searchParams.set('limit', '12');
    const response = await fetchWithTimeout(url.toString(), { cache: 'no-store', credentials: 'omit', headers: { Accept: 'application/json' } }, 30000);
    if (!response.ok) throw new Error(`WAVE API indisponible (${response.status})`);
    const payload = await response.json();
    return (payload.results || []).filter(x => x.videoId).map(x => ({
      type: 'stream', videoId: x.videoId, url: `/watch?v=${x.videoId}`, title: x.title || '',
      uploaderName: x.artist || (x.artists || []).map(a => a.name || a).filter(Boolean).join(', '),
      thumbnail: x.thumbnail || x.thumbnails?.at(-1)?.url || '', duration: x.durationSeconds || 0,
    }));
  }

  async function playYouTubeVideo(index) {
    const item = ytSearchResults[index]; if (!item) return;
    const videoId = getVideoId(item);
    if (!videoId) { showToast('Vidéo indisponible'); return; }
    if (!canSaveYouTubeOffline || !syncYTAPIState()) {
      // Le lecteur YouTube caché est peu fiable sur iOS : ouvrir la page officielle.
      window.open(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, '_blank', 'noopener,noreferrer');
      showToast('Lecture ouverte sur YouTube');
      return;
    }
    // ⚠️ SÉCURITÉ : Sanitiser le thumbnail avant utilisation
    const rawThumb = item.thumbnail || '';
    const thumb = sanitizeURL(rawThumb) || '';

    ytCurrentIndex = index;
    ytCurrentVideo = { videoId, title:item.title||'', artist:item.uploaderName||'', thumbnail:thumb };
    ytMode = true;
    Player.pause();
    setMiniPlayerVisible(true);

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

    // L'iframe YouTube est prioritaire pour la lecture simple (pas de téléchargement).
    // Le téléchargement reste disponible via les boutons « Sauvegarder » et « Télécharger ».
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
    if (!Player.getCurrentTrack()) setMiniPlayerVisible(false);
    stopYTProgress();
    if (ytPlayer && typeof ytPlayer.stopVideo === 'function') ytPlayer.stopVideo();
    playerFavorite.style.display = '';
    $$('.yt-result-item').forEach(el => el.classList.remove('yt-playing'));
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
          ${canSaveYouTubeOffline ? `<button class="yt-save-btn${saved?' yt-saved':''}" data-index="${i}" title="${saved?'Déjà sauvegardé':'Sauvegarder hors-ligne'}" aria-label="${saved?'Déjà sauvegardé':'Sauvegarder hors ligne'}">
            ${saved ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>'
                    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>'}
          </button>` : `<a class="yt-save-btn yt-external-btn" href="https://www.youtube.com/watch?v=${encodeURIComponent(videoId || '')}" target="_blank" rel="noopener noreferrer" aria-label="Ouvrir sur YouTube" title="Ouvrir sur YouTube">↗</a>`}
          <button class="yt-copy-btn" data-index="${i}" title="Copier le lien" aria-label="Copier le lien YouTube">
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
    const thumb = sanitizeURL(item.thumbnail || '') || '';
    if (!videoId) { showToast('Identifiant YouTube manquant'); return; }
    if (userTracks.some(t => t.youtubeId === videoId)) { showToast('Déjà dans la bibliothèque'); return; }
    btn.classList.add('yt-saving'); btn.innerHTML = '<div class="spinner"></div>'; btn.disabled = true;
    try {
      showToast('Téléchargement via WAVE API...');
      const { blob, mimeType, fileName } = await downloadWaveAudio(videoId);
      const { duration } = await validateAudio(blob);
      let title = item.title || 'Titre inconnu'; let artist = item.uploaderName || 'Artiste inconnu';
      const dm = title.match(/^(.+?)\s*[-–—]\s*(.+)$/); if (dm) { artist = dm[1].trim(); title = dm[2].trim(); }
      const ext = fileName.includes('.') ? fileName.split('.').pop() : (mimeType.includes('mp4') ? 'm4a' : 'webm');
      const meta = {
        id: `yt-${videoId}-${Date.now()}`, title, artist, album: '', duration: Math.round(duration || 0),
        genre: '', color: randColor(), userImported: true, fileName: `${videoId}.${ext}`,
        importedAt: Date.now(), coverArt: thumb || null, youtubeId: videoId,
      };
      await DB.saveUserTrack(meta, blob); userTracks.push(meta);
      btn.classList.remove('yt-saving'); btn.classList.add('yt-saved');
      btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>';
      showToast(`"${meta.title}" sauvegardé`); refreshAllViews();
    } catch (err) {
      btn.classList.remove('yt-saving'); btn.disabled = false;
      btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
      showToast(`Erreur : ${(err.message || 'Échec').slice(0, 80)}`);
    }
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
    // Le lecteur tiers ne se charge qu'après une recherche volontaire.
    if (canSaveYouTubeOffline) ensureYTAPIScript();
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

  // ===== Init =====
  async function refreshIdentifiedTrack(updated) {
    const previous=findTrack(updated.id);
    const resultArrived=updated.identification?.manual && updated.identification.checkedAt &&
      updated.identification.checkedAt!==previous?.identification?.checkedAt;
    if(previous) Object.assign(previous,updated);
    const current=Player.getCurrentTrack();
    if(current?.id===updated.id) {
      Object.assign(current,updated);
      playerTitle.textContent=nowPlayingTitle.textContent=updated.title;
      playerArtist.textContent=nowPlayingArtist.textContent=updated.artist;
      if('mediaSession' in navigator) navigator.mediaSession.metadata=new MediaMetadata({title:updated.title,artist:updated.artist,album:updated.album||''});
    }
    // Update just the labels: a background response must not rebuild a scrolling playlist.
    $$('.track-item').forEach(row=>{if(row.dataset.trackId===updated.id){
      row.querySelector('.track-title').textContent=updated.title;
      row.querySelector('.track-artist').textContent=updated.artist;
    }});
    if(optionsOverlay.dataset.context==='track' && optionsOverlay.dataset.trackId===String(updated.id)) {
      optionsTitle.textContent=updated.title;optionsArtist.textContent=updated.artist;
      if(!WaveIdentify.canIdentify(updated)) optionsList.querySelectorAll('.options-item').forEach(button=>{
        if(button.dataset.identifyAction==='true')button.remove();
      });
    }
    if(resultArrived) showToast(updated.identification.status==='matched'
      ? `Identifié : ${updated.artist} — ${updated.title}`
      : 'Aucune correspondance assez fiable. Le titre et l’artiste ont été conservés.');
  }
  syncYTAPIState();
  await loadUserTracks();
  await WaveIdentify.init(DB,WAVE_API_BASE_URL,refreshIdentifiedTrack,extractAllMetadata);
  await loadProfilePicture();
  refreshHomeView();
  volumeFill.style.width = `${Player.getVolume()*100}%`;
})();
