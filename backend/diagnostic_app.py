"""Routes de diagnostic non sensibles pour le backend WAVE.

Ce module réutilise l'application FastAPI principale et ajoute un test réel de
l'extracteur yt-dlp sans télécharger de fichier. Aucun cookie, jeton, en-tête
privé ou journal brut n'est renvoyé au client.
"""

from __future__ import annotations

import importlib.metadata
import shutil
import tempfile
from pathlib import Path
from typing import Any

from fastapi import HTTPException, Query
from yt_dlp import YoutubeDL
from yt_dlp.version import __version__ as YTDLP_VERSION

import main as wave

app = wave.app


class _DiagnosticLogger:
    """Capture en mémoire les messages nécessaires à la détection du plugin."""

    def __init__(self) -> None:
        self.lines: list[str] = []

    def debug(self, message: str) -> None:
        self.lines.append(str(message))

    def info(self, message: str) -> None:
        self.lines.append(str(message))

    def warning(self, message: str) -> None:
        self.lines.append(str(message))

    def error(self, message: str) -> None:
        self.lines.append(str(message))


def _plugin_version() -> str | None:
    try:
        return importlib.metadata.version("bgutil-ytdlp-pot-provider")
    except importlib.metadata.PackageNotFoundError:
        return None


def _error_category(message: str) -> str:
    lowered = message.lower()
    if "sign in to confirm" in lowered or "not a bot" in lowered:
        return "youtube_bot_check"
    if "requested format is not available" in lowered:
        return "no_compatible_format"
    if "po token" in lowered or "pot" in lowered:
        return "po_token_error"
    if "cookie" in lowered:
        return "cookies_error"
    if "timed out" in lowered or "timeout" in lowered:
        return "timeout"
    return "extractor_error"


def _run_diagnostic(video_id: str) -> dict[str, Any]:
    temp_dir = Path(tempfile.mkdtemp(prefix="wave-diagnostic-"))
    cookie_copy = wave._private_cookie_copy(temp_dir)
    logger = _DiagnosticLogger()
    source_url = f"https://www.youtube.com/watch?v={video_id}"

    options: dict[str, Any] = {
        "skip_download": True,
        "noplaylist": True,
        "quiet": False,
        "verbose": True,
        "no_warnings": False,
        "socket_timeout": 25,
        "retries": 1,
        "logger": logger,
        "extractor_args": {
            "youtube": {"player_client": ["mweb"]},
            "youtubepot-bgutilhttp": {"base_url": [wave.POT_PROVIDER_URL]},
        },
    }
    if cookie_copy is not None:
        options["cookiefile"] = str(cookie_copy)

    info: dict[str, Any] | None = None
    error_category: str | None = None
    try:
        with YoutubeDL(options) as downloader:
            extracted = downloader.extract_info(source_url, download=False)
            if isinstance(extracted, dict):
                info = extracted
    except Exception as error:
        error_category = _error_category(str(error))
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)

    debug_output = "\n".join(logger.lines)
    formats = (info.get("formats") or []) if info else []
    audio_formats = [
        item for item in formats if item.get("acodec") not in (None, "none")
    ]
    audio_only_formats = [
        item for item in audio_formats if item.get("vcodec") in (None, "none")
    ]
    plugin_version = _plugin_version()

    return {
        "videoId": video_id,
        "ytDlpVersion": YTDLP_VERSION,
        "pluginInstalled": plugin_version is not None,
        "pluginVersion": plugin_version,
        "providerServer": "ready" if wave._pot_provider_ready() else "unavailable",
        "providerDetected": (
            "PO Token Providers" in debug_output and "bgutil:http" in debug_output
        ),
        "cookiesConfigured": wave._cookie_source() is not None,
        "extractionSucceeded": info is not None,
        "availableFormats": len(formats),
        "audioFormats": len(audio_formats),
        "audioOnlyFormats": len(audio_only_formats),
        "errorCategory": error_category,
    }


@app.get("/api/diagnostics/ytdlp", tags=["Diagnostic"])
def diagnose_ytdlp(
    video_id: str = Query("dQw4w9WgXcQ", min_length=11, max_length=11),
) -> dict[str, Any]:
    """Teste yt-dlp sans télécharger et sans exposer cookies ou PO Tokens."""

    if not wave.VIDEO_ID_RE.fullmatch(video_id):
        raise HTTPException(status_code=400, detail="Identifiant vidéo invalide.")
    if not wave.DOWNLOAD_SEMAPHORE.acquire(blocking=False):
        raise HTTPException(
            status_code=429,
            detail="Un téléchargement ou diagnostic est déjà en cours.",
        )
    try:
        return _run_diagnostic(video_id)
    finally:
        wave.DOWNLOAD_SEMAPHORE.release()
