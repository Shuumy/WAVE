"""Bounded MusicBrainz search and optional AcoustID lookup; no audio retained."""
import json
import asyncio
import os
import subprocess
import tempfile
import threading
import time
import urllib.parse
import urllib.request

from fastapi import APIRouter, HTTPException, Query, Request
from starlette.concurrency import run_in_threadpool
from identify_match import classify, classify_audio, clean_title, clean_artist, search_queries

router = APIRouter()
gate = threading.Lock()
audio_gate = threading.Lock()
last_request = 0.0
MAX_BYTES = 25 * 1024 * 1024
USER_AGENT = 'WAVE/1.0 (https://github.com/Shuumy/WAVE; shuumy03@gmail.com)'


def request_json(url, data=None):
    global last_request
    # One process (start.sh), shared budget for all users and both providers.
    with gate:
        time.sleep(max(0, 1.1 - (time.monotonic() - last_request)))
        last_request = time.monotonic()
        request = urllib.request.Request(url, data=data, headers={'User-Agent': USER_AGENT, 'Accept': 'application/json'})
        if data is not None:
            request.add_header('Content-Type', 'application/x-www-form-urlencoded')
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                content = response.read(2_000_001)
                if len(content) > 2_000_000:
                    raise ValueError('response too large')
                return json.loads(content)
        except Exception:
            raise HTTPException(503, 'Service d’identification temporairement indisponible.') from None


@router.get('/api/identify/capabilities')
def capabilities():
    return {'text': True, 'audio': bool(os.getenv('ACOUSTID_API_KEY')), 'maxAudioBytes': MAX_BYTES}


@router.get('/api/identify/search')
def search(title: str = Query(min_length=1, max_length=200), artist: str = Query(default='', max_length=200),
           duration: float = Query(default=0, ge=0, le=86400)):
    title, artist = clean_title(title), clean_artist(artist)
    if not title:
        return classify([], title, artist, duration)
    recordings = []
    result = classify([], title, artist, duration)
    for query in search_queries(title, artist):
        url = 'https://musicbrainz.org/ws/2/recording/?' + urllib.parse.urlencode({'query': query, 'fmt': 'json', 'limit': 8})
        try:
            recordings.extend(request_json(url).get('recordings', []))
        except HTTPException:
            if recordings:
                break  # Preserve useful suggestions if the fallback times out.
            raise
        result = classify(recordings, title, artist, duration)
        if result['status'] == 'matched':
            break
    return result


def recognize(content):
    key = os.getenv('ACOUSTID_API_KEY')
    if not key:
        raise HTTPException(503, 'Reconnaissance audio non configurée.')
    try:
        with tempfile.TemporaryDirectory(prefix='wave-identify-') as folder:
            wav = os.path.join(folder, 'sample.wav')
            # stdin only for input: disallow embedded network/file references.
            subprocess.run(['ffmpeg', '-v', 'error', '-nostdin', '-protocol_whitelist', 'pipe', '-i', 'pipe:0',
                            '-t', '120', '-vn', '-ac', '1', '-ar', '11025', wav], input=content,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=35, check=True)
            result = subprocess.run(['fpcalc', '-json', '-length', '120', wav], capture_output=True, timeout=20, check=True)
            fingerprint = json.loads(result.stdout)
            # AcoustID requires the full track duration; supplied separately by validated client input.
            return fingerprint['fingerprint']
    except (subprocess.SubprocessError, OSError, ValueError, KeyError):
        raise HTTPException(422, 'Ce format audio ne peut pas être identifié.') from None


@router.post('/api/identify/audio')
async def audio(request: Request, duration: float = Query(gt=0, le=86400)):
    if not os.getenv('ACOUSTID_API_KEY'):
        raise HTTPException(503, 'Reconnaissance audio non configurée.')
    if not audio_gate.acquire(blocking=False):
        raise HTTPException(429, 'Reconnaissance occupée. Réessaie plus tard.')
    try:
        data = bytearray()
        try:
            async with asyncio.timeout(45):
                async for chunk in request.stream():
                    data.extend(chunk)
                    if len(data) > MAX_BYTES:
                        raise HTTPException(413, 'Limite de reconnaissance audio : 25 Mo.')
        except TimeoutError:
            raise HTTPException(408, 'Transfert audio trop lent. Réessaie plus tard.') from None
        if not data:
            raise HTTPException(422, 'Fichier vide.')
        fingerprint = await run_in_threadpool(recognize, bytes(data))
        del data
        payload = urllib.parse.urlencode({'client': os.environ['ACOUSTID_API_KEY'], 'duration': round(duration),
                                         'fingerprint': fingerprint, 'meta': 'recordings', 'format': 'json'}).encode()
        result = await run_in_threadpool(request_json, 'https://api.acoustid.org/v2/lookup', payload)
        if result.get('status') != 'ok':
            raise HTTPException(503, 'Reconnaissance temporairement indisponible.')
        return classify_audio(result.get('results', []), duration)
    finally:
        audio_gate.release()
