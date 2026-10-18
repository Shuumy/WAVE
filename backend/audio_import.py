"""Bounded, ephemeral YouTube audio jobs. Run with one ASGI worker."""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from dataclasses import dataclass
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import signal
import sys
import tempfile
import time
from urllib.parse import parse_qs, urlsplit
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/imports", tags=["Import audio"])
TTL = 1200
MAX_BYTES = 100 * 1024 * 1024
MAX_JOBS = 4  # Includes completed files: bounds temporary disk consumption.
JOB_TIMEOUT = 240
ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")


def youtube_id(url: str) -> str:
    try:
        parsed = urlsplit(url.strip())
        if parsed.scheme != "https" or parsed.username or parsed.password or parsed.port not in (None, 443):
            raise ValueError()
        host = parsed.hostname
        parts = parsed.path.strip("/").split("/")
        if host == "youtu.be" and len(parts) == 1:
            video = parts[0]
        elif host in {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"}:
            if parsed.path == "/watch":
                video = parse_qs(parsed.query).get("v", [""])[0]
            elif len(parts) == 2 and parts[0] in {"shorts", "embed", "live"}:
                video = parts[1]
            else:
                raise ValueError()
        else:
            raise ValueError()
        if not ID_RE.fullmatch(video):
            raise ValueError()
        return video
    except ValueError as exc:
        raise HTTPException(422, "Colle un lien HTTPS vers une vidéo YouTube (pas une playlist).") from exc


class ImportRequest(BaseModel):
    url: str = Field(min_length=1, max_length=2048)
    format: Literal["mp3", "m4a"] = "mp3"


@dataclass
class Job:
    token: str
    video_id: str
    format: str
    directory: Path
    state: str = "queued"
    message: str = "En attente…"
    title: str = "Audio YouTube"
    artist: str = ""
    expires: float = 0
    task: asyncio.Task | None = None


jobs: dict[str, Job] = {}
# One conversion at a time; capacity checked before allocating a job.
worker = asyncio.Semaphore(1)


def enabled() -> bool:
    return os.getenv("AUDIO_IMPORT_ENABLED", "false").lower() == "true"


def require_enabled():
    if not enabled():
        raise HTTPException(503, "L’import par lien n’est pas encore activé sur le serveur WAVE.")


def purge():
    now = time.time()
    for token, job in list(jobs.items()):
        if job.expires and job.expires <= now:
            shutil.rmtree(job.directory, ignore_errors=True)
            del jobs[token]


def get_job(token: str) -> Job:
    purge()
    if token not in jobs:
        raise HTTPException(404, "Import introuvable ou expiré. Relance la conversion.")
    return jobs[token]


async def run_process(args: list[str], directory: Path, timeout: int = JOB_TIMEOUT):
    """No shell; kill the entire process group (including FFmpeg) on failure."""
    process = await asyncio.create_subprocess_exec(
        *args, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
        cwd=directory, start_new_session=True,
    )
    try:
        async with asyncio.timeout(timeout):
            while process.returncode is None:
                try:
                    await asyncio.wait_for(process.wait(), timeout=0.25)
                except asyncio.TimeoutError:
                    pass
                if sum(p.stat().st_size for p in directory.iterdir() if p.is_file()) > 2 * MAX_BYTES:
                    raise RuntimeError("Le média dépasse la limite de taille autorisée.")
        if process.returncode:
            raise RuntimeError("Impossible de récupérer cette vidéo. Elle peut être privée, indisponible ou refusée par YouTube depuis ce serveur.")
    finally:
        if process.returncode is None:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            await process.wait()


async def process_job(job: Job):
    try:
        async with worker:
            job.state, job.message = "extracting", "Récupération de la piste audio…"
            # Canonical URL only: never pass arbitrary user URLs to the extractor.
            await run_process([
                sys.executable, "-m", "yt_dlp", "--ignore-config", "--no-plugin-dirs",
                "--no-playlist", "--no-progress", "--quiet", "--no-warnings",
                "--js-runtimes", "node", "--socket-timeout", "15", "--retries", "1",
                "--fragment-retries", "1", "--extractor-retries", "1", "--max-filesize", str(MAX_BYTES),
                "--match-filters", "!is_live & duration <= 1800", "--write-info-json",
                "-f", "bestaudio", "-o", str(job.directory / "source.%(ext)s"),
                "--", f"https://www.youtube.com/watch?v={job.video_id}",
            ], job.directory)
            candidates = [p for p in job.directory.glob("source.*") if p.suffix not in {".json", ".part", ".ytdl"}]
            if len(candidates) != 1 or not 0 < candidates[0].stat().st_size <= MAX_BYTES:
                raise RuntimeError("Aucune piste audio disponible (maximum 30 minutes et 100 Mo).")
            metadata = json.loads((job.directory / "source.info.json").read_text())
            job.title = str(metadata.get("track") or metadata.get("title") or job.title)[:200]
            job.artist = str(metadata.get("artist") or metadata.get("uploader") or "")[:200]
            job.state, job.message = "converting", f"Conversion en {job.format.upper()}…"
            codec = ["-c:a", "libmp3lame", "-b:a", "192k"] if job.format == "mp3" else ["-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"]
            await run_process([
                "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
                "-protocol_whitelist", "file,pipe", "-i", str(candidates[0]),
                "-map", "0:a:0", "-vn", *codec, "-threads", "1",
                "-metadata", f"title={job.title}", "-metadata", f"artist={job.artist}",
                str(job.directory / f"audio.{job.format}"),
            ], job.directory, timeout=120)
            output = job.directory / f"audio.{job.format}"
            if not output.is_file() or not 0 < output.stat().st_size <= MAX_BYTES:
                raise RuntimeError("Le fichier audio produit est vide ou trop volumineux.")
            for path in job.directory.iterdir():
                if path != output:
                    path.unlink()
            job.state, job.message = "ready", "Audio prêt."
    except asyncio.CancelledError:
        shutil.rmtree(job.directory, ignore_errors=True)
        raise
    except Exception as exc:
        job.state = "failed"
        job.message = str(exc) if isinstance(exc, RuntimeError) else "Le traitement a échoué ou dépassé le délai. Réessaie avec une vidéo plus courte."
        shutil.rmtree(job.directory, ignore_errors=True)
    finally:
        job.expires = time.time() + TTL


async def cleanup_loop():
    while True:
        await asyncio.sleep(30)
        purge()


@asynccontextmanager
async def lifespan(_app):
    cleaner = asyncio.create_task(cleanup_loop())
    try:
        yield
    finally:
        tasks = [cleaner] + [job.task for job in jobs.values() if job.task]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        for job in jobs.values():
            shutil.rmtree(job.directory, ignore_errors=True)
        jobs.clear()


@router.post("", status_code=202)
async def create_import(body: ImportRequest, request: Request):
    require_enabled()
    # CORS alone does not reject side effects from an untrusted browser origin.
    origin = request.headers.get("origin")
    allowed = os.getenv("FRONTEND_ORIGINS", "https://shuumy.github.io,http://localhost:8000,http://127.0.0.1:8000").split(",")
    if origin and origin not in {o.strip().rstrip("/") for o in allowed}:
        raise HTTPException(403, "Origine non autorisée.")
    video = youtube_id(body.url)
    purge()
    if len(jobs) >= MAX_JOBS:
        raise HTTPException(429, "Le service est occupé. Réessaie après quelques minutes.")
    if not shutil.which("ffmpeg") or not shutil.which("node"):
        raise HTTPException(503, "Le moteur audio n’est pas disponible sur ce serveur.")
    token = secrets.token_urlsafe(32)
    job = Job(token, video, body.format, Path(tempfile.mkdtemp(prefix="wave-import-")))
    jobs[token] = job
    job.task = asyncio.create_task(process_job(job))
    return {"id": token, "state": job.state}


@router.get("/{token}")
async def import_status(token: str):
    job = get_job(token)
    return {"id": job.token, "state": job.state, "message": job.message,
            "title": job.title, "artist": job.artist, "videoId": job.video_id,
            "format": job.format, "expiresAt": job.expires or None}


@router.get("/{token}/file")
async def import_file(token: str):
    job = get_job(token)
    if job.state != "ready":
        raise HTTPException(409, "Le fichier n’est pas encore prêt.")
    # User-visible title is never used as a filesystem path.
    filename = re.sub(r'[^\w .()-]', '_', job.title).strip(' .')[:100] or "audio"
    return FileResponse(job.directory / f"audio.{job.format}",
                        media_type="audio/mpeg" if job.format == "mp3" else "audio/mp4",
                        filename=f"{filename}.{job.format}", headers={"Cache-Control": "no-store"})


@router.delete('/{token}', status_code=204)
async def release_import(token: str):
    job = get_job(token)
    if job.task and not job.task.done():
        job.task.cancel()
        await asyncio.gather(job.task, return_exceptions=True)
    shutil.rmtree(job.directory, ignore_errors=True)
    jobs.pop(token, None)
