"""Backend WAVE : recherche YouTube Music et téléchargement audio personnel.

La recherche utilise ytmusicapi. Le téléchargement utilise yt-dlp et renvoie le
meilleur flux audio disponible sans conversion FFmpeg, afin de rester léger sur
un petit service Render.
"""

from __future__ import annotations

import mimetypes
import os
import re
import shutil
import tempfile
import threading
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.background import BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from yt_dlp import YoutubeDL
from yt_dlp.utils import DownloadError
from ytmusicapi import YTMusic

APP_VERSION = "1.1.0"
VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024
DOWNLOAD_SEMAPHORE = threading.BoundedSemaphore(value=1)
DEFAULT_FRONTEND_ORIGINS = (
    "https://shuumy.github.io",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
)


def _allowed_origins() -> list[str]:
    configured = os.getenv("FRONTEND_ORIGINS", "")
    origins = [origin.strip().rstrip("/") for origin in configured.split(",") if origin.strip()]
    return origins or list(DEFAULT_FRONTEND_ORIGINS)


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
    return JSONResponse(
        status_code=500,
        content={"detail": "Erreur interne du service WAVE."},
    )


@app.get("/", tags=["État"])
def root() -> dict[str, str]:
    return {
        "name": "WAVE API",
        "status": "online",
        "version": APP_VERSION,
    }


@app.get("/api/health", tags=["État"])
def health() -> dict[str, str]:
    return {"status": "ok", "version": APP_VERSION}


def _artist_names(item: dict[str, Any]) -> list[str]:
    artists = item.get("artists") or []
    return [artist.get("name", "") for artist in artists if artist.get("name")]


def _normalize_song(item: dict[str, Any]) -> dict[str, Any]:
    thumbnails = item.get("thumbnails") or []
    album = item.get("album") or {}

    return {
        "videoId": item.get("videoId"),
        "title": item.get("title") or "Titre inconnu",
        "artists": _artist_names(item),
        "artist": ", ".join(_artist_names(item)) or "Artiste inconnu",
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

    return {
        "query": cleaned_query,
        "count": len(results),
        "results": results,
    }


def _safe_filename(title: str, extension: str) -> str:
    cleaned = re.sub(r"[^\w\-. ()\[\]]+", "_", title, flags=re.UNICODE).strip(" ._")
    cleaned = cleaned[:120] or "audio"
    return f"{cleaned}.{extension}"


def _download_audio(video_id: str) -> tuple[Path, Path, dict[str, Any]]:
    temp_dir = Path(tempfile.mkdtemp(prefix="wave-audio-"))
    output_template = str(temp_dir / "%(id)s.%(ext)s")
    source_url = f"https://www.youtube.com/watch?v={video_id}"

    options: dict[str, Any] = {
        "format": "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best",
        "outtmpl": output_template,
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "restrictfilenames": True,
        "socket_timeout": 20,
        "retries": 2,
        "fragment_retries": 2,
        "max_filesize": MAX_DOWNLOAD_BYTES,
        "overwrites": True,
    }

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
        files = [path for path in temp_dir.iterdir() if path.is_file()]
        file_path = files[0] if files else file_path

    if not file_path.is_file() or file_path.stat().st_size < 10_000:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise RuntimeError("Le flux audio téléchargé est vide.")

    if file_path.stat().st_size > MAX_DOWNLOAD_BYTES:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise RuntimeError("Le fichier audio dépasse la limite de 100 Mo.")

    return temp_dir, file_path, info


@app.get("/api/download/{video_id}", tags=["Téléchargement"])
def download_audio(
    video_id: str,
    background_tasks: BackgroundTasks,
) -> FileResponse:
    """Télécharge le meilleur flux audio disponible pour un identifiant YouTube.

    Aucun MP3 n'est fabriqué : le fichier reste en M4A, WebM ou autre format audio
    fourni par YouTube. Cela évite FFmpeg et réduit l'utilisation CPU/mémoire.
    """

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
        raise HTTPException(
            status_code=502,
            detail="yt-dlp n'a pas pu récupérer ce média.",
        ) from error
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
    response.headers["X-WAVE-Provider"] = "yt-dlp"
    return response
