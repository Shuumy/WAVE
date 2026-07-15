"""Backend WAVE : recherche YouTube Music et téléchargement audio personnel.

La recherche utilise ytmusicapi. Le téléchargement utilise yt-dlp avec un
fournisseur local de PO Token bgutil. Les cookies YouTube sont lus uniquement
depuis un Secret File Render et ne sont jamais renvoyés ou journalisés.
"""

from __future__ import annotations

import mimetypes
import os
import re
import shutil
import socket
import tempfile
import threading
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.background import BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from yt_dlp import YoutubeDL
from yt_dlp.utils import DownloadError
from ytmusicapi import YTMusic

APP_VERSION = "1.3.0"
VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024
MAX_COOKIE_BYTES = 1024 * 1024
DOWNLOAD_SEMAPHORE = threading.BoundedSemaphore(value=1)
POT_PROVIDER_URL = os.getenv("POT_PROVIDER_URL", "http://127.0.0.1:4416").rstrip("/")
DEFAULT_FRONTEND_ORIGINS = (
    "https://shuumy.github.io",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
)
COOKIE_CANDIDATES = (
    Path("/etc/secrets/cookies.txt"),
    Path.cwd() / "cookies.txt",
)


def _allowed_origins() -> list[str]:
    configured = os.getenv("FRONTEND_ORIGINS", "")
    origins = [origin.strip().rstrip("/") for origin in configured.split(",") if origin.strip()]
    return origins or list(DEFAULT_FRONTEND_ORIGINS)


def _cookie_source() -> Path | None:
    """Retourne un Secret File cookies.txt valide sans exposer son contenu."""

    configured = os.getenv("YOUTUBE_COOKIES_FILE", "").strip()
    candidates = (Path(configured), *COOKIE_CANDIDATES) if configured else COOKIE_CANDIDATES

    for candidate in candidates:
        try:
            if not candidate.is_file():
                continue
            size = candidate.stat().st_size
            if size <= 0 or size > MAX_COOKIE_BYTES:
                continue
            with candidate.open("r", encoding="utf-8", errors="replace") as handle:
                first_line = handle.readline().strip()
                preview = handle.read(64 * 1024)
            if "Netscape HTTP Cookie File" not in first_line:
                continue
            if "youtube.com" not in preview and ".google.com" not in preview:
                continue
            return candidate
        except OSError:
            continue

    return None


def _private_cookie_copy(temp_dir: Path) -> Path | None:
    """Crée une copie privée et éphémère du Secret File pour yt-dlp."""

    source = _cookie_source()
    if source is None:
        return None

    destination = temp_dir / ".youtube-cookies.txt"
    shutil.copyfile(source, destination)
    try:
        destination.chmod(0o600)
    except OSError:
        pass
    return destination


def _pot_provider_ready(timeout: float = 0.35) -> bool:
    """Vérifie seulement que le serveur local bgutil écoute, sans exposer de secret."""

    parsed = urlparse(POT_PROVIDER_URL)
    host = parsed.hostname or "127.0.0.1"
    port = parsed.port or 4416
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


app = FastAPI(
    title="WAVE API",
    description="Recherche YouTube Music et téléchargement audio pour WAVE.",
    version=APP_VERSION,
    docs_url="/docs",
    redoc_url=None,
)

yt_music = YTMusic()

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins(),
    allow_credentials=False,
    allow_methods=["GET", "OPTIONS"],
    allow_headers=["Accept", "Content-Type"],
    expose_headers=["Content-Disposition", "Content-Length", "X-WAVE-Provider"],
    max_age=3600,
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Cache-Control"] = "no-store"
    return response


@app.exception_handler(Exception)
async def unhandled_exception_handler(_request: Request, _error: Exception) -> JSONResponse:
    return JSONResponse(status_code=500, content={"detail": "Erreur interne du service WAVE."})


@app.get("/", tags=["État"])
def root() -> dict[str, str]:
    return {"name": "WAVE API", "status": "online", "version": APP_VERSION}


@app.get("/api/health", tags=["État"])
def health() -> dict[str, str]:
    return {
        "status": "ok",
        "version": APP_VERSION,
        "youtubeCookies": "configured" if _cookie_source() else "missing",
        "poTokenProvider": "ready" if _pot_provider_ready() else "unavailable",
    }


def _artist_names(item: dict[str, Any]) -> list[str]:
    artists = item.get("artists") or []
    return [artist.get("name", "") for artist in artists if artist.get("name")]


def _normalize_song(item: dict[str, Any]) -> dict[str, Any]:
    thumbnails = item.get("thumbnails") or []
    album = item.get("album") or {}
    artists = _artist_names(item)
    return {
        "videoId": item.get("videoId"),
        "title": item.get("title") or "Titre inconnu",
        "artists": artists,
        "artist": ", ".join(artists) or "Artiste inconnu",
        "album": album.get("name") if isinstance(album, dict) else None,
        "duration": item.get("duration"),
        "durationSeconds": item.get("duration_seconds"),
        "thumbnail": thumbnails[-1].get("url") if thumbnails else None,
        "thumbnails": thumbnails,
        "isExplicit": bool(item.get("isExplicit")),
    }


@app.get("/api/search", tags=["YouTube Music"])
def search_songs(
    query: str = Query(..., min_length=1, max_length=200),
    limit: int = Query(10, ge=1, le=25),
) -> dict[str, Any]:
    cleaned_query = " ".join(query.split())
    if not cleaned_query:
        raise HTTPException(status_code=400, detail="La recherche est vide.")

    try:
        raw_results = yt_music.search(
            cleaned_query,
            filter="songs",
            limit=limit,
            ignore_spelling=False,
        )
    except Exception as error:
        raise HTTPException(
            status_code=502,
            detail="YouTube Music ne répond pas pour le moment.",
        ) from error

    results = [
        _normalize_song(item)
        for item in raw_results
        if item.get("videoId") and item.get("title")
    ]
    return {"query": cleaned_query, "count": len(results), "results": results}


def _safe_filename(title: str, extension: str) -> str:
    cleaned = re.sub(r"[^\w\-. ()\[\]]+", "_", title, flags=re.UNICODE).strip(" ._")
    cleaned = cleaned[:120] or "audio"
    return f"{cleaned}.{extension}"


def _download_audio(video_id: str) -> tuple[Path, Path, dict[str, Any]]:
    if not _pot_provider_ready():
        raise RuntimeError("Le fournisseur de PO Token n'est pas disponible.")

    temp_dir = Path(tempfile.mkdtemp(prefix="wave-audio-"))
    output_template = str(temp_dir / "%(id)s.%(ext)s")
    source_url = f"https://www.youtube.com/watch?v={video_id}"
    cookie_copy = _private_cookie_copy(temp_dir)

    options: dict[str, Any] = {
        "format": "bestaudio/best",
        "outtmpl": output_template,
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "restrictfilenames": True,
        "socket_timeout": 30,
        "retries": 3,
        "fragment_retries": 3,
        "max_filesize": MAX_DOWNLOAD_BYTES,
        "overwrites": True,
        "extractor_args": {
            "youtube": {
                "player_client": ["mweb"],
            },
            "youtubepot-bgutilhttp": {
                "base_url": [POT_PROVIDER_URL],
            },
        },
    }
    if cookie_copy is not None:
        options["cookiefile"] = str(cookie_copy)

    try:
        with YoutubeDL(options) as downloader:
            info = downloader.extract_info(source_url, download=True)
            requested = info.get("requested_downloads") or []
            candidate = requested[0].get("filepath") if requested else None
            file_path = Path(candidate or downloader.prepare_filename(info))
    except Exception:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise

    if not file_path.is_file():
        files = [
            path
            for path in temp_dir.iterdir()
            if path.is_file() and path.name != ".youtube-cookies.txt"
        ]
        file_path = files[0] if files else file_path

    if not file_path.is_file() or file_path.stat().st_size < 10_000:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise RuntimeError("Le flux audio téléchargé est vide.")
    if file_path.stat().st_size > MAX_DOWNLOAD_BYTES:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise RuntimeError("Le fichier audio dépasse la limite de 100 Mo.")

    return temp_dir, file_path, info


@app.get("/api/download/{video_id}", tags=["Téléchargement"])
def download_audio(video_id: str, background_tasks: BackgroundTasks) -> FileResponse:
    """Télécharge le meilleur flux audio disponible pour un identifiant YouTube."""

    if not VIDEO_ID_RE.fullmatch(video_id):
        raise HTTPException(status_code=400, detail="Identifiant vidéo invalide.")
    if not DOWNLOAD_SEMAPHORE.acquire(blocking=False):
        raise HTTPException(
            status_code=429,
            detail="Un téléchargement est déjà en cours. Réessaie dans quelques instants.",
        )

    try:
        temp_dir, file_path, info = _download_audio(video_id)
    except DownloadError as error:
        message = str(error).lower()
        if "sign in to confirm" in message or "not a bot" in message:
            detail = "YouTube refuse la session actuelle : réexporte les cookies YouTube."
        elif "requested format is not available" in message:
            detail = "YouTube n'a fourni aucun flux compatible, même avec le PO Token."
        elif "po token" in message or "pot" in message:
            detail = "Le fournisseur de PO Token n'a pas pu produire un jeton valide."
        elif "cookies" in message:
            detail = "Les cookies YouTube sont absents, invalides ou expirés."
        else:
            detail = "yt-dlp n'a pas pu récupérer ce média."
        raise HTTPException(status_code=502, detail=detail) from error
    except RuntimeError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    finally:
        DOWNLOAD_SEMAPHORE.release()

    extension = file_path.suffix.lstrip(".") or "bin"
    title = str(info.get("title") or video_id)
    filename = _safe_filename(title, extension)
    media_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"

    background_tasks.add_task(shutil.rmtree, temp_dir, True)
    response = FileResponse(
        path=file_path,
        media_type=media_type,
        filename=filename,
        background=background_tasks,
    )
    response.headers["X-WAVE-Provider"] = "yt-dlp+bgutil"
    return response
