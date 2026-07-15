from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "js" / "app.js"
INDEX = ROOT / "index.html"
SW = ROOT / "sw.js"

API_BASE = "https://wave-docker.onrender.com"


def replace_once(text: str, pattern: str, replacement: str, label: str) -> str:
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"Bloc introuvable ou ambigu: {label} (count={count})")
    return updated


app = APP.read_text(encoding="utf-8")

# 1) Remplacer l'import URL YouTube historique (Piped/Invidious) par WAVE API direct.
import_block = r'''  // ===== Import YouTube via WAVE API =====
  const ytImportInput    = $('#ytImportInput');
  const ytImportBtn      = $('#ytImportBtn');
  const ytPreviewCard    = $('#ytPreviewCard');
  const ytPreviewThumb   = $('#ytPreviewThumb');
  const ytPreviewTitleEl = $('#ytPreviewTitle');
  const ytPreviewMetaEl  = $('#ytPreviewMeta');
  const ytPreviewSaveBtn = $('#ytPreviewSaveBtn');
  const ytPreviewDlBtn   = $('#ytPreviewDlBtn');
  const ytImportProgress = $('#ytImportProgress');
  const ytImportFill     = $('#ytImportFill');
  const ytImportText     = $('#ytImportText');

  let _ytPreviewData = null;

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

  async function analyzeYouTubeUrl() {
    const videoId = extractYouTubeVideoId(ytImportInput.value);
    if (!videoId) { showToast('URL YouTube invalide'); return; }
    _ytPreviewData = { videoId, title: `YouTube ${videoId}`, artist: '', duration: 0, thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` };
    ytPreviewCard.hidden = false;
    ytPreviewThumb.src = _ytPreviewData.thumbnailUrl;
    ytPreviewTitleEl.textContent = _ytPreviewData.title;
    ytPreviewMetaEl.textContent = 'Téléchargement via WAVE API';
    ytPreviewSaveBtn.hidden = false;
    ytPreviewDlBtn.hidden = false;
    ytPreviewSaveBtn.disabled = userTracks.some(t => t.youtubeId === videoId);
    ytPreviewDlBtn.disabled = false;
  }

  async function saveFromYouTube() {
    if (!_ytPreviewData) return;
    const { videoId, title, artist, thumbnailUrl } = _ytPreviewData;
    ytPreviewSaveBtn.disabled = true; ytPreviewDlBtn.disabled = true;
    ytImportProgress.hidden = false; ytImportFill.style.width = '20%'; ytImportText.textContent = 'WAVE API...';
    try {
      const { blob, mimeType, fileName } = await downloadWaveAudio(videoId);
      ytImportFill.style.width = '80%'; ytImportText.textContent = 'Validation...';
      const { duration } = await validateAudio(blob);
      const ext = fileName.includes('.') ? fileName.split('.').pop() : (mimeType.includes('mp4') ? 'm4a' : 'webm');
      const meta = {
        id: `yt-${videoId}-${Date.now()}`, title, artist: artist || 'Artiste inconnu', album: '',
        duration: Math.round(duration || 0), genre: '', color: randColor(), userImported: true,
        fileName: `${videoId}.${ext}`, importedAt: Date.now(), coverArt: thumbnailUrl, youtubeId: videoId,
      };
      await DB.saveUserTrack(meta, blob); userTracks.push(meta);
      ytImportFill.style.width = '100%'; ytImportText.textContent = 'Ajouté à la bibliothèque';
      showToast(`"${meta.title}" sauvegardé`); refreshAllViews();
    } catch (err) {
      ytImportFill.style.width = '0%'; ytImportText.textContent = `Erreur : ${(err.message || 'Échec').slice(0, 100)}`;
      ytPreviewSaveBtn.disabled = false; showToast(`Erreur : ${(err.message || 'Échec').slice(0, 70)}`);
    } finally { ytPreviewDlBtn.disabled = false; }
  }

  async function downloadToDevice() {
    if (!_ytPreviewData) return;
    const { videoId, title } = _ytPreviewData;
    ytPreviewDlBtn.disabled = true; ytPreviewSaveBtn.disabled = true;
    ytImportProgress.hidden = false; ytImportFill.style.width = '20%'; ytImportText.textContent = 'WAVE API...';
    try {
      const { blob, fileName } = await downloadWaveAudio(videoId);
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = blobUrl; a.download = fileName || title; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
      ytImportFill.style.width = '100%'; ytImportText.textContent = 'Téléchargement lancé'; showToast('Téléchargement lancé');
    } catch (err) {
      ytImportFill.style.width = '0%'; ytImportText.textContent = `Erreur : ${(err.message || 'Échec').slice(0, 100)}`;
      showToast(`Erreur : ${(err.message || 'Échec').slice(0, 70)}`);
    } finally { ytPreviewDlBtn.disabled = false; ytPreviewSaveBtn.disabled = false; }
  }

  ytImportBtn.addEventListener('click', analyzeYouTubeUrl);
  ytImportInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); analyzeYouTubeUrl(); } });
  ytImportInput.addEventListener('input', () => { if (!ytImportInput.value.trim()) { ytPreviewCard.hidden = true; _ytPreviewData = null; } });
  ytPreviewSaveBtn.addEventListener('click', saveFromYouTube);
  ytPreviewDlBtn.addEventListener('click', downloadToDevice);

'''
app = replace_once(
    app,
    r"  // ===== Import YouTube \(Piped → Invidious\) =====.*?(?=  importDropzone\.addEventListener\('dragover')",
    import_block,
    "import YouTube",
)

# 2) Remplacer les listes Piped/Invidious et la recherche historique par un appel direct.
search_block = f'''  const WAVE_API_BASE_URL = '{API_BASE}';

  function getVideoId(item) {{
    if (item.videoId) return item.videoId;
    if (!item.url) return null;
    try {{ return new URLSearchParams(item.url.split('?')[1]).get('v'); }} catch {{ return null; }}
  }}

  function fetchWithTimeout(url, opts={{}}, ms=15000) {{
    try {{ const u = new URL(url); if (u.protocol !== 'https:') return Promise.reject(new Error('HTTPS requis')); }}
    catch {{ return Promise.reject(new Error('URL invalide')); }}
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), ms);
    return fetch(url, {{ ...opts, signal: ctrl.signal }}).finally(() => clearTimeout(t));
  }}

  async function searchYouTube(q) {{
    const url = new URL('/api/search', WAVE_API_BASE_URL);
    url.searchParams.set('query', q.slice(0, 200)); url.searchParams.set('limit', '12');
    const response = await fetchWithTimeout(url.toString(), {{ cache: 'no-store', credentials: 'omit', headers: {{ Accept: 'application/json' }} }}, 30000);
    if (!response.ok) throw new Error(`WAVE API indisponible (${{response.status}})`);
    const payload = await response.json();
    return (payload.results || []).filter(x => x.videoId).map(x => ({{
      type: 'stream', videoId: x.videoId, url: `/watch?v=${{x.videoId}}`, title: x.title || '',
      uploaderName: x.artist || (x.artists || []).map(a => a.name || a).filter(Boolean).join(', '),
      thumbnail: x.thumbnail || x.thumbnails?.at(-1)?.url || '', duration: x.durationSeconds || 0,
    }}));
  }}

'''
app = replace_once(
    app,
    r"  // Instances confirmées comme proxifiant leurs streams.*?(?=  async function playYouTubeVideo\(index\))",
    search_block,
    "recherche Piped/Invidious",
)

# 3) Remplacer le téléchargement hors-ligne et supprimer les fonctions Piped/Invidious.
save_block = r'''  async function saveYouTubeOffline(index, btn) {
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

'''
app = replace_once(
    app,
    r"  async function saveYouTubeOffline\(index, btn\).*?(?=  ytSearchInput\.addEventListener\('input')",
    save_block,
    "téléchargement Piped/Invidious",
)

# Vérification stricte : aucune dépendance Piped/Invidious ne doit rester dans le code actif.
for forbidden in ("PIPED_INSTANCES", "INVIDIOUS_FALLBACK", "downloadFromPiped", "downloadFromInvidious", "api.invidious.io"):
    if forbidden in app:
        raise RuntimeError(f"Référence historique restante: {forbidden}")
app = app.replace("Piped → Invidious", "WAVE API")
APP.write_text(app, encoding="utf-8")

# 4) CSP explicite et chargement direct de l'application, sans injection du service worker.
index = INDEX.read_text(encoding="utf-8")
index = re.sub(r"frame-src\s+https://www\.youtube\.com\s+https://www\.youtube-nocookie\.com\s+https://notube\.lol;",
               "frame-src https://www.youtube.com https://www.youtube-nocookie.com;", index, flags=re.S)
index = re.sub(r"connect-src 'self'.*?https://fonts\.googleapis\.com;",
               f"connect-src 'self' {API_BASE} https://fonts.googleapis.com;", index, flags=re.S)
index = index.replace('  <script src="./js/ytmusic-api.js"></script>\n', '')
index = index.replace('  <script src="./js/download-router.js"></script>\n', '')
INDEX.write_text(index, encoding="utf-8")

# 5) Service worker simple : aucun HTML réécrit et aucune injection de scripts.
SW.write_text("""// WAVE service worker — cache applicatif uniquement\nconst CACHE_NAME = 'wave-v14';\nconst ASSETS = [\n  './', './index.html', './css/style.css', './js/db.js', './js/tracks.js',\n  './js/player.js', './js/app.js', './manifest.json',\n];\n\nself.addEventListener('install', event => {\n  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));\n  self.skipWaiting();\n});\n\nself.addEventListener('activate', event => {\n  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))));\n  self.clients.claim();\n});\n\nself.addEventListener('fetch', event => {\n  const request = event.request;\n  const url = new URL(request.url);\n  if (url.origin !== self.location.origin) {\n    event.respondWith(fetch(request));\n    return;\n  }\n  if (request.mode === 'navigate') {\n    event.respondWith(fetch(request, { cache: 'no-cache' }).catch(() => caches.match('./index.html')));\n    return;\n  }\n  event.respondWith(\n    fetch(request, { cache: 'no-cache' }).then(response => {\n      if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));\n      return response;\n    }).catch(() => caches.match(request))\n  );\n});\n""", encoding="utf-8")

# 6) Supprimer les anciens adaptateurs et le script lui-même après exécution.
for relative in ("js/ytmusic-api.js", "js/download-router.js", "js/piped-router.js"):
    path = ROOT / relative
    if path.exists(): path.unlink()

print("Refactor WAVE API direct terminé")
