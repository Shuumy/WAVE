/**
 * WAVE — IndexedDB Layer
 */
const DB = (() => {
  const DB_NAME = 'wave-db';
  const DB_VERSION = 1;
  let db = null;

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => { db = req.result; resolve(); };
      req.onupgradeneeded = (e) => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains('tracks'))    d.createObjectStore('tracks',    { keyPath: 'id' });
        if (!d.objectStoreNames.contains('audio'))     d.createObjectStore('audio',     { keyPath: 'id' });
        if (!d.objectStoreNames.contains('settings'))  d.createObjectStore('settings',  { keyPath: 'key' });
        if (!d.objectStoreNames.contains('favorites')) d.createObjectStore('favorites', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('recent'))    d.createObjectStore('recent',    { keyPath: 'id' });
        if (!d.objectStoreNames.contains('playlists')) d.createObjectStore('playlists', { keyPath: 'id' });
      };
    });
  }

  function store(name, mode = 'readonly') {
    return db.transaction(name, mode).objectStore(name);
  }

  function getAll(name) {
    return new Promise((res, rej) => {
      const r = store(name).getAll();
      r.onsuccess = () => res(r.result);
      r.onerror   = () => rej(r.error);
    });
  }

  function get(name, key) {
    return new Promise((res, rej) => {
      const r = store(name).get(key);
      r.onsuccess = () => res(r.result);
      r.onerror   = () => rej(r.error);
    });
  }

  function put(name, value) {
    return new Promise((res, rej) => {
      const r = store(name, 'readwrite').put(value);
      r.onsuccess = () => res(r.result);
      r.onerror   = () => rej(r.error);
    });
  }

  function del(name, key) {
    return new Promise((res, rej) => {
      const r = store(name, 'readwrite').delete(key);
      r.onsuccess = () => res();
      r.onerror   = () => rej(r.error);
    });
  }

  async function getUserTracks() {
    const all = await getAll('tracks');
    return all.filter(t => t.userImported).sort((a, b) => (b.importedAt || 0) - (a.importedAt || 0));
  }

  async function saveUserTrack(meta, blob) {
    await put('tracks', meta);
    await put('audio', { id: meta.id, blob });
  }

  async function removeUserTrack(id) {
    await del('tracks', id);
    await del('audio', id);
    await del('favorites', id);
    const pls = await getAll('playlists');
    for (const pl of pls) {
      if (pl.trackIds.includes(id)) {
        pl.trackIds = pl.trackIds.filter(tid => tid !== id);
        await put('playlists', pl);
      }
    }
  }

  async function getUserAudioBlob(id) {
    const rec = await get('audio', id);
    return rec ? rec.blob : null;
  }

  async function getSetting(key) {
    const rec = await get('settings', key);
    return rec ? rec.value : null;
  }

  async function setSetting(key, value) {
    await put('settings', { key, value });
  }

  async function isFavorite(id) {
    const rec = await get('favorites', id);
    return !!rec;
  }

  async function toggleFavorite(id) {
    const fav = await isFavorite(id);
    if (fav) { await del('favorites', id); return false; }
    else      { await put('favorites', { id, addedAt: Date.now() }); return true; }
  }

  async function getFavorites() {
    return await getAll('favorites');
  }

  async function addRecent(id) {
    await put('recent', { id, timestamp: Date.now() });
  }

  async function getRecent() {
    const recs = await getAll('recent');
    return recs.sort((a, b) => b.timestamp - a.timestamp);
  }

  const PLAYLIST_COLORS = ['#e94560','#7b2ff7','#00b4d8','#ff9800','#4caf50','#ff5722','#9c27b0','#3f51b5','#00e676','#f44336'];

  async function getPlaylists() {
    return await getAll('playlists');
  }

  async function getPlaylist(id) {
    return await get('playlists', id);
  }

  async function createPlaylist(name) {
    const pl = {
      id: 'pl-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      name,
      trackIds: [],
      coverColor: PLAYLIST_COLORS[Math.floor(Math.random() * PLAYLIST_COLORS.length)],
      coverImage: null,
      createdAt: Date.now(),
    };
    await put('playlists', pl);
    return pl;
  }

  async function updatePlaylist(pl) {
    await put('playlists', pl);
  }

  async function deletePlaylist(id) {
    await del('playlists', id);
  }

  async function addTrackToPlaylist(plId, trackId) {
    const pl = await getPlaylist(plId);
    if (!pl) return;
    if (!pl.trackIds.includes(trackId)) {
      pl.trackIds.push(trackId);
      await put('playlists', pl);
    }
  }

  async function removeTrackFromPlaylist(plId, trackId) {
    const pl = await getPlaylist(plId);
    if (!pl) return;
    pl.trackIds = pl.trackIds.filter(id => id !== trackId);
    await put('playlists', pl);
  }

  return {
    open,
    getUserTracks,
    saveUserTrack,
    removeUserTrack,
    getUserAudioBlob,
    getSetting,
    setSetting,
    isFavorite,
    toggleFavorite,
    getFavorites,
    addRecent,
    getRecent,
    getPlaylists,
    getPlaylist,
    createPlaylist,
    updatePlaylist,
    deletePlaylist,
    addTrackToPlaylist,
    removeTrackFromPlaylist,
  };
})();
