#!/usr/bin/env python3
"""Pont local WAVE pour Samsung/Termux.

Le serveur écoute uniquement sur 127.0.0.1. Il accepte les appels de la PWA WAVE,
télécharge l'audio avec yt-dlp depuis la connexion du téléphone, puis renvoie le
fichier à WAVE pour son stockage hors ligne dans IndexedDB.

Aucun cookie, compte ou secret n'est lu par ce service.
"""

from __future__ import annotations

import json
import mimetypes
import re
import shutil
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlparse

from yt_dlp import YoutubeDL
from yt_dlp.utils import DownloadError
from yt_dlp.version import __version__ as YTDLP_VERSION

HOST = "127.0.0.1"
PORT = 8765
APP_VERSION = "1.1.0"
MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024
VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
DOWNLOAD_ROUTE_RE = re.compile(r"^/api/download/([A-Za-z0-9_-]{11})$")
DOWNLOAD_LOCK = threading.BoundedSemaphore(value=1)
ALLOWED_ORIGINS = {
    "https://shuumy.github.io",
    "http://127.0.0.1:8000",
    "http://localhost:8000",
}


def safe_filename(title: str, extension: str) -> str:
    cleaned = re.sub(r"[^\w\-. ()\[\]]+", "_", title, flags=re.UNICODE).strip(" ._")
    return f"{(cleaned[:120] or 'audio')}.{extension}"


def download_error_message(error: Exception) -> str:
    message = str(error).lower()
    if "sign in to confirm" in message or "not a bot" in message:
        return "YouTube refuse cette requête. Mets yt-dlp à jour puis réessaie."
    if "requested format is not available" in message:
        return "YouTube n'a fourni aucun flux audio compatible pour cette vidéo."
    if "private video" in message:
        return "Cette vidéo est privée."
    if "video unavailable" in message:
        return "Cette vidéo n'est pas disponible."
    if "copyright" in message:
        return "Cette vidéo est indisponible pour des raisons de droits."
    return "yt-dlp n'a pas pu récupérer ce média depuis le téléphone."


def download_audio(video_id: str) -> tuple[Path, Path, dict[str, Any]]:
    temp_dir = Path(tempfile.mkdtemp(prefix="wave-samsung-"))
    output_template = str(temp_dir / "%(id)s.%(ext)s")
    source_url = f"https://www.youtube.com/watch?v={video_id}"

    options: dict[str, Any] = {
        "format": "bestaudio[ext=m4a]/bestaudio/best",
        "outtmpl": output_template,
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "restrictfilenames": True,
        "socket_timeout": 30,
        "retries": 3,
        "fragment_retries": 3,
        "concurrent_fragment_downloads": 1,
        "max_filesize": MAX_DOWNLOAD_BYTES,
        "overwrites": True,
    }

    try:
        with YoutubeDL(options) as downloader:
            info = downloader.extract_info(source_url, download=True)
            if not isinstance(info, dict):
                raise RuntimeError("Réponse yt-dlp invalide.")
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
        raise RuntimeError("Le fichier audio téléchargé est vide.")
    if file_path.stat().st_size > MAX_DOWNLOAD_BYTES:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise RuntimeError("Le fichier audio dépasse la limite de 100 Mo.")

    return temp_dir, file_path, info


class WaveBridgeHandler(BaseHTTPRequestHandler):
    server_version = f"WAVE-Samsung-Bridge/{APP_VERSION}"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args: object) -> None:
        print(f"[WAVE] {self.address_string()} - {fmt % args}", flush=True)

    def origin_allowed(self) -> bool:
        origin = self.headers.get("Origin")
        return origin is None or origin in ALLOWED_ORIGINS

    def send_cors_headers(self) -> None:
        origin = self.headers.get("Origin")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Accept, Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header(
            "Access-Control-Expose-Headers",
            "Content-Disposition, Content-Length, X-WAVE-Provider",
        )
        self.send_header("Access-Control-Max-Age", "600")
        self.send_header("Cross-Origin-Resource-Policy", "cross-origin")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store")

    def send_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_cors_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802
        if not self.origin_allowed():
            self.send_json(403, {"detail": "Origine refusée."})
            return
        self.send_response(204)
        self.send_cors_headers()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if not self.origin_allowed():
            self.send_json(403, {"detail": "Origine refusée."})
            return

        path = urlparse(self.path).path
        if path in {"/", "/api/health"}:
            self.send_json(
                200,
                {
                    "status": "ok",
                    "service": "WAVE Samsung Bridge",
                    "version": APP_VERSION,
                    "ytDlpVersion": YTDLP_VERSION,
                    "authentication": "none",
                },
            )
            return

        match = DOWNLOAD_ROUTE_RE.fullmatch(path)
        if not match:
            self.send_json(404, {"detail": "Route introuvable."})
            return

        video_id = match.group(1)
        if not VIDEO_ID_RE.fullmatch(video_id):
            self.send_json(400, {"detail": "Identifiant vidéo invalide."})
            return
        if not DOWNLOAD_LOCK.acquire(blocking=False):
            self.send_json(429, {"detail": "Un téléchargement est déjà en cours."})
            return

        temp_dir: Path | None = None
        try:
            print(f"[WAVE] Téléchargement local demandé : {video_id}", flush=True)
            temp_dir, file_path, info = download_audio(video_id)
            extension = file_path.suffix.lstrip(".") or "bin"
            filename = safe_filename(str(info.get("title") or video_id), extension)
            media_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
            size = file_path.stat().st_size

            self.send_response(200)
            self.send_cors_headers()
            self.send_header("Content-Type", media_type)
            self.send_header("Content-Length", str(size))
            self.send_header("Content-Disposition", f"attachment; filename*=UTF-8''{quote(filename)}")
            self.send_header("X-WAVE-Provider", "yt-dlp-local-samsung")
            self.end_headers()

            with file_path.open("rb") as handle:
                while chunk := handle.read(256 * 1024):
                    self.wfile.write(chunk)
            print(f"[WAVE] Téléchargement terminé : {video_id}", flush=True)
        except (DownloadError, RuntimeError) as error:
            self.send_json(502, {"detail": download_error_message(error)})
        except (BrokenPipeError, ConnectionResetError):
            print("[WAVE] Le navigateur a interrompu le transfert.", flush=True)
        except Exception as error:
            print(f"[WAVE] Erreur locale : {type(error).__name__}", flush=True)
            self.send_json(500, {"detail": "Erreur interne du pont Samsung."})
        finally:
            if temp_dir is not None:
                shutil.rmtree(temp_dir, ignore_errors=True)
            DOWNLOAD_LOCK.release()


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), WaveBridgeHandler)
    server.daemon_threads = True
    print("", flush=True)
    print("WAVE Samsung Bridge est démarré.", flush=True)
    print(f"Adresse locale : http://{HOST}:{PORT}", flush=True)
    print("Laisse Termux ouvert, puis utilise le bouton de téléchargement dans WAVE.", flush=True)
    print("Appuie sur Ctrl+C pour arrêter.", flush=True)
    print("", flush=True)
    try:
        server.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        print("\n[WAVE] Arrêt du pont Samsung.", flush=True)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
