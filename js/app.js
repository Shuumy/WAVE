/**
 * WAVE — Main Application
 * Fixes: YT blob-download playback, search clear, delete confirm, showDelete in home
 */
(async () => {
  await DB.open();

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const navBtns           = $$('.nav-btn');
  const views             = $$('.view');
  const homeSearchInput   = $('#homeSearchInput');
  const playerTitle       = $('#playerTitle');
  const playerArtist      = $('#playerArtist');
  const playerArtwork     = $('#playerArtwork');
  const playerFavorite    = $('#playerFavorite');
  const btnPlay           = $('#btnPlay');
  const btnPrev           = $('#btnPrev');
  const btnNext           = $('#btnNext');
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
  let librarySort = 'date';

  // ===== Confirm Dialog =====
  function showConfirm(message) {
    return new Promise((resolve) => {
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
    toastMessage.textContent = msg;
    toast.hidden = false;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => { toast.hidden = true; }, 300);
    }, 2500);
  }

  // ===== Profile Picture =====
  async function loadProfilePicture() {
    const pic = await DB.getSetting('profilePicture');
    if (pic) profileAvatar.innerHTML = `<img src="${pic}" alt="Profil">`;
  }
  profileAvatar.addEventListener('click', () => profileInput.click());
  profileInput.addEventListener('change', async () => {
    const file = profileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      await DB.setSetting('profilePicture', e.target.result);
      profileAvatar.innerHTML = `<img src="${e.target.result}" alt="Profil">`;
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
      $$( `.track-item[data-track-id="${firstId}"]`).forEach(el => el.classList.add('selected'));
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
  function applySort(tracks) {
    const s = [...tracks];
    if (librarySort === 'title')  s.sort((a,b) => a.title.localeCompare(b.title));
    else if (librarySort === 'artist') s.sort((a,b) => a.artist.localeCompare(b.artist));
    else s.sort((a,b) => (b.importedAt||0) - (a.importedAt||0));
    return s;
  }
  function renderSortRow(container) {
    const row = document.createElement('div');
    row.className = 'sort-row';
    row.innerHTML = `
      <span class="sort-label">Trier :</span>
      <button class="sort-btn ${librarySort==='date'?'active':''}" data-sort="date">Date d'ajout</button>
      <button class="sort-btn ${librarySort==='title'?'active':''}" data-sort="title">Titre A→Z</button>
      <button class="sort-btn ${librarySort==='artist'?'active':''}" data-sort="artist">Artiste A→Z</button>`;
    row.querySelectorAll('.sort-btn').forEach(b => b.addEventListener('click', () => { librarySort = b.dataset.sort; refreshLibraryView(); }));
    container.insertBefore(row, container.firstChild);
  }

  // ===== Cover Art =====
  function extractCoverArt(file) {
    return new Promise((resolve) => {
      if (!window.jsmediatags) { resolve(null); return; }
      try {
        jsmediatags.read(file, {
          onSuccess: (tag) => {
            const pic = tag.tags?.picture;
            if (pic) {
              try {
                const bytes = new Uint8Array(pic.data);
                let b = '';
                bytes.forEach(c => b += String.fromCharCode(c));
                resolve(`data:${pic.format};base64,${btoa(b)}`);
              } catch { resolve(null); }
            } else resolve(null);
          },
          onError: () => resolve(null),
        });
      } catch { resolve(null); }
    });
  }

  // ===== Track Element =====
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
    const artSrc = generateArtwork(track);

    let actionBtn = '';
    if (playlistId) {
      actionBtn = `<button class="icon-btn remove-pl-btn" title="Retirer">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>`;
    } else {
      actionBtn = `<button class="icon-btn playlist-add-btn" title="Ajouter à une playlist">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
      </button>`;
    }
    const deleteBtn = showDelete ? `<button class="icon-btn delete-track-btn" title="Supprimer">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
    </button>` : '';

    div.innerHTML = `
      <div class="track-select-check"><div class="track-checkbox"></div></div>
      <div class="track-artwork">
        <img src="${artSrc}" alt="${track.title}">
        ${ct && ct.id === track.id && Player.getIsPlaying() ? `<div class="playing-indicator"><div class="bars"><div class="bar"></div><div class="bar"></div><div class="bar"></div></div></div>` : ''}
      </div>
      <div class="track-info">
        <div class="track-title">${track.title}</div>
        <div class="track-artist">${track.artist}${track.album ? ' — ' + track.album : ''}</div>
      </div>
      <div class="track-actions">
        <span class="track-duration">${formatDuration(track.duration)}</span>
        <button class="icon-btn fav-btn" title="Favori">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
        </button>
        ${actionBtn}${deleteBtn}
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

    if (playlistId) {
      div.querySelector('.remove-pl-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        await DB.removeTrackFromPlaylist(playlistId, track.id);
        wrap.style.cssText = 'transition:opacity .2s,transform .2s;opacity:0;transform:translateX(10px)';
        setTimeout(() => { wrap.remove(); onRemoveFromPlaylist?.(); }, 200);
        showToast('Retiré de la playlist');
      });
    } else {
      div.querySelector('.playlist-add-btn').addEventListener('click', (e) => {
        e.stopPropagation(); if (selectMode) return;
        openPlaylistModal(track.id);
      });
    }

    if (showDelete) {
      div.querySelector('.delete-track-btn').addEventListener('click', async (e) => {
        e.stopPropagation(); if (selectMode) return;
        const ok = await showConfirm(`Supprimer "${track.title}" ?`);
        if (!ok) return;
        wrap.style.cssText = 'transition:opacity .2s,transform .2s;opacity:0;transform:translateX(-10px)';
        setTimeout(async () => {
          await DB.removeUserTrack(track.id);
          userTracks = userTracks.filter(t => t.id !== track.id);
          wrap.remove();
          showToast(`"${track.title}" supprimé`);
          refreshAllViews();
        }, 200);
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
      if (e.target.closest('.fav-btn,.playlist-add-btn,.remove-pl-btn,.delete-track-btn')) return;
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
        const img = pl.coverImage ? `<div class="pl-color" style="background:${pl.coverColor};overflow:hidden"><img src="${pl.coverImage}" style="width:100%;height:100%;object-fit:cover;border-radius:3px"></div>` : `<div class="pl-color" style="background:${pl.coverColor}"></div>`;
        opt.innerHTML = `${img}<span>${pl.name}</span>`;
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
    const name = prompt('Nom de la playlist:');
    if (!name?.trim()) return;
    const pl = await DB.createPlaylist(name.trim());
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
    const query = homeSearchInput?.value.toLowerCase().trim() || '';
    const popSec   = $('#popularSection');
    const recSec   = $('#recentSection');
    const results  = $('#homeSearchResults');
    const all = getAllTracks();

    if (query) {
      if (popSec) popSec.hidden = true;
      if (recSec) recSec.hidden = true;
      if (results) {
        results.hidden = false;
        const filtered = all.filter(t =>
          t.title.toLowerCase().includes(query) ||
          t.artist.toLowerCase().includes(query) ||
          (t.album && t.album.toLowerCase().includes(query))
        );
        renderTrackList(results, filtered, { showDelete: true });
      }
    } else {
      if (popSec) popSec.hidden = false;
      if (recSec) recSec.hidden = false;
      if (results) { results.hidden = true; results.innerHTML = ''; }
      const pop = $('#popularTracks');
      if (pop) {
        if (!all.length) pop.innerHTML = '<p class="empty-state">Aucun morceau. Va dans Importer pour ajouter ta musique.</p>';
        else renderTrackList(pop, all, { showDelete: true });
      }
      const recentIds = await DB.getRecent();
      const rec = $('#recentTracks');
      if (rec) {
        const recentTracks = recentIds.map(r => findTrack(r.id)).filter(Boolean).slice(0, 8);
        if (!recentTracks.length) rec.innerHTML = '<p class="empty-state">Aucun morceau joué récemment.</p>';
        else renderTrackList(rec, recentTracks);
      }
    }
  }
  homeSearchInput?.addEventListener('input', () => refreshHomeView());

  // ===== Library View =====
  async function refreshLibraryView() {
    const tab = $('.library-tabs .tab-btn.active')?.dataset.tab;
    const content = $('#libraryContent');
    if (tab === 'all') {
      content.innerHTML = '<div class="track-list" id="libraryTracks"></div>';
      renderSortRow(content);
      const tracks = applySort(getAllTracks());
      const c = $('#libraryTracks');
      if (!tracks.length) c.innerHTML = '<p class="empty-state">Aucun morceau importé.</p>';
      else renderTrackList(c, tracks, { showDelete: true });
    } else if (tab === 'favorites') {
      content.innerHTML = '<div class="track-list" id="libraryTracks"></div>';
      renderSortRow(content);
      const favs = await DB.getFavorites();
      const tracks = applySort(favs.map(f => findTrack(f.id)).filter(Boolean));
      const c = $('#libraryTracks');
      if (!tracks.length) c.innerHTML = '<p class="empty-state">Aucun favori.</p>';
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
        const n = prompt('Nom de la playlist:');
        if (!n?.trim()) return;
        await DB.createPlaylist(n.trim()); showToast('Playlist créée'); renderPlaylistsGrid();
      });
      return;
    }
    let html = '<div class="playlists-grid">';
    pls.forEach(pl => {
      const tracks = pl.trackIds.map(id => findTrack(id)).filter(Boolean);
      const total = tracks.reduce((s,t) => s + (t.duration||0), 0);
      html += `<div class="playlist-card" style="background:${pl.coverColor}" data-playlist-id="${pl.id}">
        <button class="playlist-card-delete" data-pl-delete="${pl.id}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        ${pl.coverImage ? `<img class="playlist-card-cover-img" src="${pl.coverImage}" alt="${pl.name}">` : ''}
        <div class="playlist-card-name">${pl.name}</div>
        <div class="playlist-card-count">${pl.trackIds.length} morceau${pl.trackIds.length!==1?'x':''} · ${formatTotalDuration(total)}</div>
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
      const n = prompt('Nom de la playlist:');
      if (!n?.trim()) return;
      await DB.createPlaylist(n.trim()); showToast('Playlist créée'); renderPlaylistsGrid();
    });
  }

  async function renderPlaylistDetail(plId) {
    const pl = await DB.getPlaylist(plId);
    if (!pl) { currentPlaylistView = null; renderPlaylistsGrid(); return; }
    const content = $('#libraryContent');
    const tracks = pl.trackIds.map(id => findTrack(id)).filter(Boolean);
    const totalSec = tracks.reduce((s,t) => s + (t.duration||0), 0);
    content.innerHTML = `
      <button class="playlist-back-btn" id="playlistBack">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg> Retour
      </button>
      <div class="playlist-detail-header">
        <div class="playlist-detail-cover" style="background:${pl.coverColor}" id="playlistCoverBtn">
          ${pl.coverImage ? `<img src="${pl.coverImage}" alt="${pl.name}">` : '&#9835;'}
          <div class="playlist-cover-overlay"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></div>
        </div>
        <div class="playlist-detail-info">
          <h3>
            <span>${pl.name}</span>
            <button class="playlist-rename-btn" id="playlistRenameBtn" title="Renommer"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
          </h3>
          <p>${tracks.length} morceau${tracks.length!==1?'x':''} · ${formatTotalDuration(totalSec)}</p>
          <div class="playlist-detail-actions">
            <button class="playlist-action-btn" id="playlistAddTracksBtn">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Ajouter des morceaux
            </button>
          </div>
        </div>
      </div>
      <div class="track-list" id="playlistTracks"></div>`;
    if (!tracks.length) $('#playlistTracks').innerHTML = '<p class="empty-state">Aucun morceau. Clique sur "Ajouter des morceaux".</p>';
    else renderTrackList($('#playlistTracks'), tracks, { playlistId: plId, onRemoveFromPlaylist: () => renderPlaylistDetail(plId) });
    $('#playlistBack').addEventListener('click', () => { currentPlaylistView = null; refreshLibraryView(); });
    $('#playlistRenameBtn').addEventListener('click', async () => {
      const n = prompt('Nouveau nom:', pl.name);
      if (!n?.trim() || n.trim() === pl.name) return;
      pl.name = n.trim(); await DB.updatePlaylist(pl);
      showToast('Playlist renommée'); renderPlaylistDetail(plId);
    });
    $('#playlistCoverBtn').addEventListener('click', () => { playlistCoverInput.dataset.playlistId = plId; playlistCoverInput.click(); });
    $('#playlistAddTracksBtn').addEventListener('click', () => openPlaylistSearchModal(plId));
  }

  playlistCoverInput.addEventListener('change', async () => {
    const file = playlistCoverInput.files[0]; if (!file) return;
    const plId = playlistCoverInput.dataset.playlistId; if (!plId) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      const pl = await DB.getPlaylist(plId); if (!pl) return;
      pl.coverImage = e.target.result; await DB.updatePlaylist(pl);
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
      opt.innerHTML = `<div class="track-thumb"><img src="${generateArtwork(track)}" alt=""></div><div class="track-meta"><div class="track-meta-title">${track.title}</div><div class="track-meta-artist">${track.artist}</div></div><div class="track-add-icon">${already?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>'}</div>`;
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

  async function refreshImportView() {
    const section = $('#importedSection');
    const container = $('#importedTracks');
    if (!userTracks.length) { section.hidden = true; return; }
    section.hidden = false;
    renderTrackList(container, userTracks, { showDelete: true });
  }

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

  // ===== Player Events =====
  Player.on('trackchange', async (track) => {
    playerTitle.textContent = track.title;
    playerArtist.textContent = track.artist;
    playerArtwork.innerHTML = `<img src="${generateArtwork(track)}" alt="">`;
    const isFav = await DB.isFavorite(track.id);
    playerFavorite.classList.toggle('active', isFav);
    playerFavorite.querySelector('svg').setAttribute('fill', isFav ? 'currentColor' : 'none');
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
  Player.on('statechange', ({ playing }) => { btnPlay.classList.toggle('is-playing', playing); });
  let isDragging = false;
  Player.on('timeupdate', ({ currentTime, duration }) => {
    if (isDragging || !duration) return;
    progressFill.style.width = `${(currentTime/duration)*100}%`;
    currentTimeEl.textContent = formatDuration(currentTime);
    totalTimeEl.textContent = formatDuration(duration);
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
  btnShuffle.addEventListener('click', () => {
    const a = Player.toggleShuffle(); btnShuffle.classList.toggle('active', a);
    showToast(a ? 'Lecture aléatoire activée' : 'Lecture aléatoire désactivée');
  });
  btnRepeat.addEventListener('click', () => {
    const mode = Player.toggleRepeat(); btnRepeat.classList.toggle('active', mode !== 'none');
    const base = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>`;
    btnRepeat.innerHTML = mode==='one' ? base+`<text x="12" y="16" font-size="8" fill="currentColor" text-anchor="middle" font-weight="bold">1</text></svg>` : base+`</svg>`;
    showToast({ none:'Répétition désactivée', all:'Répéter tout', one:'Répéter un seul' }[mode]);
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
    $$(`.fav-btn[data-track-id="${track.id}"]`).forEach(btn => {
      btn.classList.toggle('fav-active', isFav);
      btn.querySelector('svg').setAttribute('fill', isFav ? 'currentColor' : 'none');
    });
  });

  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play',          () => Player.togglePlay());
    navigator.mediaSession.setActionHandler('pause',         () => Player.pause());
    navigator.mediaSession.setActionHandler('previoustrack', () => btnPrev.click());
    navigator.mediaSession.setActionHandler('nexttrack',     () => btnNext.click());
  }

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Space')     { e.preventDefault(); Player.togglePlay(); }
    if (e.code === 'ArrowLeft') { e.preventDefault(); Player.seekRelative(-5); }
    if (e.code === 'ArrowRight'){ e.preventDefault(); Player.seekRelative(5); }
  });

  // ===== File Import =====
  const importDropzone    = $('#importDropzone');
  const fileInput         = $('#fileInput');
  const importProgress    = $('#importProgress');
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
      const { title, artist } = parseName(file.name);
      const { valid, duration } = await validateAudio(file);
      if (!valid) { fail++; continue; }
      const coverArt = await extractCoverArt(file);
      const meta = {
        id: 'user-'+Date.now()+'-'+Math.random().toString(36).slice(2,8),
        title, artist, album:'', duration:Math.round(duration),
        genre:'', color:randColor(), userImported:true,
        fileName:file.name, importedAt:Date.now(), coverArt:coverArt||null,
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
  importDropzone.addEventListener('dragover', (e) => { e.preventDefault(); importDropzone.classList.add('dragover'); });
  importDropzone.addEventListener('dragleave', () => importDropzone.classList.remove('dragover'));
  importDropzone.addEventListener('drop', (e) => { e.preventDefault(); importDropzone.classList.remove('dragover'); if(e.dataTransfer.files.length) importFiles(e.dataTransfer.files); });

  // ===== YouTube =====
  const ytSearchInput      = $('#ytSearchInput');
  const ytSearchBtn        = $('#ytSearchBtn');
  const ytResultsContainer = $('#ytResults');

  let ytPlayer      = null;
  let ytAPIReady    = false;
  let ytMode        = false;
  let ytCurrentVideo = null;
  let ytSearchResults = [];
  let ytCurrentIndex  = -1;
  let ytProgressInterval = null;
  let currentYTBlobUrl   = null;

  window.onYouTubeIframeAPIReady = () => { ytAPIReady = true; };

  const PIPED_INSTANCES = [
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
    'https://api.piped.private.coffee',
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
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    return fetch(url, { ...opts, signal:ctrl.signal }).finally(() => clearTimeout(t));
  }
  function escapeHTML(s) { const d=document.createElement('div'); d.textContent=s; return d.innerHTML; }

  async function searchYouTube(q) {
    for (const inst of PIPED_INSTANCES) {
      try {
        const r = await fetchWithTimeout(`${inst}/search?q=${encodeURIComponent(q)}&filter=music_songs`, {}, 8000);
        if (!r.ok) continue;
        const data = await r.json();
        const items = (data.items||[]).filter(i => i.type==='stream'&&i.url);
        if (items.length) return items.slice(0,12);
      } catch(e) { console.warn('Piped search',inst,e.name==='AbortError'?'timeout':e.message); }
    }
    throw new Error('Aucun serveur disponible');
  }

  async function downloadYouTubeAsBlobUrl(videoId) {
    for (const inst of PIPED_INSTANCES) {
      try {
        const r = await fetchWithTimeout(`${inst}/streams/${videoId}`, {}, 8000);
        if (!r.ok) continue;
        const data = await r.json();
        if (!data.audioStreams?.length) continue;
        const sorted = data.audioStreams.filter(s=>s.url&&s.mimeType).sort((a,b)=>(b.bitrate||0)-(a.bitrate||0));
        for (const stream of sorted.slice(0,3)) {
          try {
            const ar = await fetchWithTimeout(stream.url, {}, 30000);
            if (!ar.ok) continue;
            const blob = await ar.blob();
            if (blob.size > 5000) return URL.createObjectURL(blob);
          } catch {}
        }
      } catch(e) { console.warn('Piped blob',inst,e.name==='AbortError'?'timeout':e.message); }
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
            const url = `${inst}/latest_version?id=${videoId}&itag=${fmt.itag}&local=true`;
            const ar = await fetchWithTimeout(url, {}, 30000);
            if (!ar.ok) continue;
            const blob = await ar.blob();
            if (blob.size > 5000) return URL.createObjectURL(blob);
          } catch {}
        }
      } catch(e) { console.warn('Invidious blob',inst,e.name==='AbortError'?'timeout':e.message); }
    }
    return null;
  }

  async function playYouTubeVideo(index) {
    const item = ytSearchResults[index]; if (!item) return;
    const videoId = getVideoId(item);
    const thumb = item.thumbnail || '';
    if (currentYTBlobUrl) { URL.revokeObjectURL(currentYTBlobUrl); currentYTBlobUrl = null; }
    ytCurrentIndex = index;
    ytCurrentVideo = { videoId, title:item.title||'', artist:item.uploaderName||'', thumbnail:thumb };
    ytMode = true;
    Player.pause();
    playerTitle.textContent  = item.title || '';
    playerArtist.textContent = item.uploaderName || '';
    playerArtwork.innerHTML  = `<img src="${thumb}" alt="">`;
    btnPlay.classList.add('is-playing');
    playerFavorite.style.display = 'none';
    $$('.yt-result-item').forEach(el => el.classList.remove('yt-playing'));
    const el = document.querySelector(`.yt-result-item[data-index="${index}"]`);
    if (el) el.classList.add('yt-playing');
    showToast('Chargement...');
    try {
      const blobUrl = await downloadYouTubeAsBlobUrl(videoId);
      if (blobUrl) {
        currentYTBlobUrl = blobUrl;
        const ok = await Player.playExternal(blobUrl);
        if (ok) { updateYTMediaSession(); showToast(''); return; }
      }
    } catch(e) { console.error('Blob download failed:', e); }
    showToast('Lecture via YouTube...');
    playYouTubeIFrame(videoId, index);
  }

  function playYouTubeIFrame(videoId, index) {
    stopYTProgress();
    if (ytPlayer && typeof ytPlayer.loadVideoById === 'function') {
      ytPlayer.loadVideoById(videoId);
    } else {
      const container = document.getElementById('ytPlayerContainer');
      const old = document.getElementById('ytPlayer');
      if (old) old.remove();
      const div = document.createElement('div');
      div.id = 'ytPlayer';
      container.appendChild(div);
      if (!ytAPIReady) { showToast('YouTube API non prête'); return; }
      ytPlayer = new YT.Player('ytPlayer', {
        height:'1', width:'1', videoId,
        playerVars: { autoplay:1, controls:0, playsinline:1, disablekb:1 },
        events: { onReady:(e)=>e.target.playVideo(), onStateChange:onYTStateChange },
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
    navigator.mediaSession.setActionHandler('nexttrack', () => btnNext.click());
  }

  function exitYTMode() {
    ytMode = false; ytCurrentVideo = null;
    stopYTProgress();
    if (ytPlayer && typeof ytPlayer.stopVideo === 'function') ytPlayer.stopVideo();
    playerFavorite.style.display = '';
    $$('.yt-result-item').forEach(el => el.classList.remove('yt-playing'));
    if (currentYTBlobUrl) { URL.revokeObjectURL(currentYTBlobUrl); currentYTBlobUrl = null; }
  }

  function renderYTResults(items) {
    ytSearchResults = items;
    if (!items.length) { ytResultsContainer.innerHTML = '<p class="empty-state">Aucun résultat.</p>'; return; }
    ytResultsContainer.innerHTML = items.map((item,i) => {
      const videoId = getVideoId(item), thumb = item.thumbnail||'';
      const saved = userTracks.some(t => t.youtubeId===videoId);
      return `<div class="yt-result-item${ytCurrentVideo?.videoId===videoId?' yt-playing':''}" data-index="${i}">
        <div class="yt-result-thumb">
          <img src="${thumb}" alt="" loading="lazy">
          <div class="yt-play-overlay"><svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg></div>
        </div>
        <div class="yt-result-info">
          <div class="yt-result-title">${escapeHTML(item.title||'')}</div>
          <div class="yt-result-channel">${escapeHTML(item.uploaderName||'')}</div>
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
        try { await navigator.clipboard.writeText(`https://www.youtube.com/watch?v=${videoId}`); btn.classList.add('yt-copied'); setTimeout(()=>btn.classList.remove('yt-copied'),1000); showToast('Lien copié'); }
        catch { showToast('Impossible de copier'); }
      });
    });
  }

  async function saveYouTubeOffline(index, btn) {
    const item = ytSearchResults[index]; if (!item) return;
    const videoId = getVideoId(item), thumb = item.thumbnail||'';
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
      let coverArt = null;
      try { const tr=await fetch(thumb); if(tr.ok){const tb=await tr.blob();coverArt=await new Promise(r=>{const rd=new FileReader();rd.onload=()=>r(rd.result);rd.onerror=()=>r(null);rd.readAsDataURL(tb);}); } } catch {}
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
        const r = await fetchWithTimeout(`${inst}/streams/${videoId}`, {}, 12000);
        if(!r.ok) continue;
        const data = await r.json();
        if(!data.audioStreams?.length) continue;
        const sorted = data.audioStreams.filter(s=>s.url&&s.mimeType).sort((a,b)=>(b.bitrate||0)-(a.bitrate||0));
        if(!sorted.length) continue;
        const stream = sorted[0];
        let audioUrl = stream.url;
        try { const t=await fetchWithTimeout(audioUrl,{method:'HEAD'},8000); if(!t.ok) throw new Error(); }
        catch { audioUrl=`${inst}/proxy?url=${encodeURIComponent(audioUrl)}`; }
        const ar = await fetchWithTimeout(audioUrl, {}, 30000); if(!ar.ok) continue;
        const blob = await ar.blob(); if(!blob||blob.size<10000) continue;
        return { blob, mimeType:stream.mimeType, pipedTitle:data.title, pipedUploader:data.uploader, pipedDuration:data.duration };
      } catch(e) { console.warn('Piped',inst,e.name==='AbortError'?'timeout':e.message); }
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
        const url = `${inst}/latest_version?id=${videoId}&itag=${fmts[0].itag}&local=true`;
        const ar = await fetchWithTimeout(url, {}, 35000); if(!ar.ok) continue;
        const blob = await ar.blob(); if(!blob||blob.size<10000) continue;
        return { blob, mimeType:fmts[0].type.split(';')[0], pipedTitle:data.title, pipedUploader:data.author, pipedDuration:data.lengthSeconds };
      } catch(e) { console.warn('Invidious',inst,e.name==='AbortError'?'timeout':e.message); }
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
      ytResultsContainer.innerHTML = `<p class="empty-state" style="color:var(--danger)">${escapeHTML(err.message)}</p>`;
      showToast('Erreur: '+err.message);
    }
  }
  ytSearchBtn.addEventListener('click', doYTSearch);
  ytSearchInput.addEventListener('keydown', (e) => { if(e.key==='Enter'){e.preventDefault();doYTSearch();} });

  // ===== Service Worker =====
  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('./sw.js'); }
    catch(e) { console.warn('SW failed:', e); }
  }

  // ===== Init =====
  await loadUserTracks();
  await loadProfilePicture();
  refreshHomeView();
  refreshImportView();
  volumeFill.style.width = `${Player.getVolume()*100}%`;
  console.log('WAVE ready');
})();
