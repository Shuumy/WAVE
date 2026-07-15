#!/usr/bin/env python3
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def replace_regex(text: str, pattern: str, replacement: str, label: str, flags: int = 0) -> str:
    updated, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise RuntimeError(f"Remplacement impossible: {label} (occurrences={count})")
    return updated


# 1) Interface : supprimer la barre d’URL YouTube et sa fiche de prévisualisation,
# puis ajouter un lien externe qui s’ouvre dans le navigateur.
index_path = ROOT / "index.html"
index = index_path.read_text(encoding="utf-8")
notube_markup = '''        <!-- Téléchargement externe : aucune donnée ni cookie ne transite par WAVE -->
        <div class="external-download-divider">Télécharger depuis un lien</div>
        <a
          class="notube-external-card"
          href="https://notube.lol/fr/youtube-app-374"
          target="_blank"
          rel="noopener noreferrer external"
          aria-label="Ouvrir NoTube dans le navigateur"
        >
          <span class="notube-external-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M14 3h7v7"/>
              <path d="M10 14 21 3"/>
              <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>
            </svg>
          </span>
          <span class="notube-external-copy">
            <strong>Ouvrir NoTube</strong>
            <small>Colle ton lien YouTube sur le site, dans ton navigateur.</small>
          </span>
          <span class="notube-external-arrow" aria-hidden="true">›</span>
        </a>
'''
index = replace_regex(
    index,
    r'''        <!-- Import YouTube.*?\n        <div class="yt-url-divider">.*?\n        </div>\n      </section>''',
    notube_markup + "      </section>",
    "bloc HTML d’import YouTube",
    re.S,
)
for forbidden in ("ytImportInput", "ytImportBtn", "ytPreviewCard", "ytPreviewSaveBtn", "ytPreviewDlBtn"):
    if forbidden in index:
        raise RuntimeError(f"Référence HTML résiduelle: {forbidden}")
index_path.write_text(index, encoding="utf-8")

# 2) JavaScript : supprimer tout le contrôleur lié à la barre d’import par URL.
# Les deux helpers de téléchargement restent utilisés par le bouton de sauvegarde
# dans les résultats de recherche et ne doivent pas être retirés.
app_path = ROOT / "js" / "app.js"
app = app_path.read_text(encoding="utf-8")
start_marker = "  // ===== Import YouTube via WAVE API =====\n"
helper_marker = "  function filenameFromDisposition(header, fallback) {\n"
start = app.find(start_marker)
helper = app.find(helper_marker, start)
if start < 0 or helper < 0:
    raise RuntimeError("Début du contrôleur d’import YouTube introuvable")
app = (
    app[:start]
    + "  // ===== Téléchargement WAVE API (utilisé depuis les résultats de recherche) =====\n"
    + app[helper:]
)
app = replace_regex(
    app,
    r'''\n  async function analyzeYouTubeUrl\(\) \{.*?\n  ytPreviewDlBtn\.addEventListener\('click', downloadToDevice\);\n''',
    "\n",
    "fonctions et écouteurs de l’import YouTube",
    re.S,
)
for forbidden in (
    "ytImportInput", "ytImportBtn", "ytPreviewCard", "ytPreviewThumb",
    "ytPreviewTitleEl", "ytPreviewMetaEl", "ytPreviewSaveBtn", "ytPreviewDlBtn",
    "ytImportProgress", "ytImportFill", "ytImportText", "_ytPreviewData",
    "extractYouTubeVideoId", "analyzeYouTubeUrl", "saveFromYouTube", "downloadToDevice",
):
    if forbidden in app:
        raise RuntimeError(f"Référence JavaScript résiduelle: {forbidden}")
if "downloadWaveAudio(videoId)" not in app or "saveYouTubeOffline" not in app:
    raise RuntimeError("Le téléchargement depuis les résultats de recherche a été supprimé par erreur")
app_path.write_text(app, encoding="utf-8")

# 3) Styles : retirer les styles morts de la barre, de la preview et de l’ancien iframe,
# puis ajouter une carte accessible et adaptée au mobile.
css_path = ROOT / "css" / "style.css"
css = css_path.read_text(encoding="utf-8")
notube_css = '''/* ===== Lien externe NoTube ===== */
.external-download-divider {
  display:flex; align-items:center; gap:12px; margin:32px 0 16px;
  color:var(--text-muted); font-size:0.65rem; letter-spacing:0.2em; text-transform:uppercase;
}
.external-download-divider::before,
.external-download-divider::after { content:''; flex:1; height:1px; background:var(--border); }
.notube-external-card {
  display:flex; align-items:center; gap:14px;
  padding:16px; border:1px solid var(--border); border-radius:var(--radius);
  background:var(--bg-secondary); color:var(--text-primary); text-decoration:none;
  transition:border-color var(--transition), background var(--transition), transform var(--transition);
}
.notube-external-card:hover,
.notube-external-card:focus-visible {
  border-color:var(--accent); background:var(--bg-hover); transform:translateY(-1px); outline:none;
}
.notube-external-icon {
  width:42px; height:42px; flex-shrink:0; border-radius:50%;
  display:flex; align-items:center; justify-content:center;
  color:#000; background:var(--accent);
}
.notube-external-icon svg { width:20px; height:20px; }
.notube-external-copy { display:flex; flex-direction:column; gap:4px; min-width:0; flex:1; }
.notube-external-copy strong { font-size:0.9rem; font-weight:650; }
.notube-external-copy small { color:var(--text-muted); font-size:0.72rem; line-height:1.35; }
.notube-external-arrow { color:var(--text-muted); font-size:1.6rem; line-height:1; flex-shrink:0; }
'''
css = replace_regex(
    css,
    r'''/\* ===== YouTube URL Import \(notube-like\) ===== \*/.*?\.yt-preview-progress \{ padding:0 16px 16px; \}\n''',
    notube_css,
    "anciens styles d’import YouTube",
    re.S,
)
for forbidden in (".yt-url-bar", ".yt-url-btn", ".yt-preview-card", ".yt-preview-dl-btn", ".notube-frame"):
    if forbidden in css:
        raise RuntimeError(f"Style résiduel: {forbidden}")
css_path.write_text(css, encoding="utf-8")

# 4) Renouveler le cache de la PWA afin que la nouvelle interface arrive sur Android.
sw_path = ROOT / "sw.js"
sw = sw_path.read_text(encoding="utf-8")
sw = replace_regex(sw, r"const CACHE_NAME = 'wave-v\d+';", "const CACHE_NAME = 'wave-v15';", "version du cache")
sw_path.write_text(sw, encoding="utf-8")

# 5) Ce mécanisme est à usage unique : il ne doit pas rester dans le dépôt final.
for temporary in (
    ROOT / "tools" / "refactor_import_notube.py",
    ROOT / ".github" / "workflows" / "apply-import-notube-refactor.yml",
):
    if temporary.exists():
        temporary.unlink()
