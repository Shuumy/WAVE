"""Backend public de WAVE pour la recherche YouTube Music.

Ce service ne contient aucun cookie ni identifiant YouTube. Il utilise uniquement
les fonctions publiques de ytmusicapi et est prévu pour être déployé sur Render.
"""

from __future__ import annotations

import os
from typing import Any

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from ytmusicapi import YTMusic

APP_VERSION = "1.0.0"
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
    description="Backend de recherche YouTube Music pour l'application WAVE.",
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
