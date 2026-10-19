"""Explicit Cobalt/Piped adapters. Never discover or rotate servers at runtime."""
from __future__ import annotations

import asyncio
import ipaddress
import json
import os
from pathlib import Path
import socket
from urllib.parse import urlsplit

import aiohttp

MAX_BYTES = 100 * 1024 * 1024


class ProviderError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def public_ip(value: str) -> bool:
    ip = ipaddress.ip_address(value)
    return ip.is_global and not ip.is_multicast and not ip.is_unspecified


def validate_url(url: str, allowed_hosts: set[str] | None = None) -> str:
    try:
        p = urlsplit(url)
        if (p.scheme != 'https' or not p.hostname or p.username or p.password
                or p.port not in (None, 443) or p.fragment or len(url) > 8192):
            raise ValueError()
        host = p.hostname.lower()
        try:
            ipaddress.ip_address(host)
        except ValueError:
            pass
        else:
            # Force DNS through the validating resolver; reject literal IPs.
            raise ValueError()
        if allowed_hosts is not None and host not in allowed_hosts:
            raise ValueError()
        return url
    except (ValueError, TypeError) as exc:
        raise ProviderError('provider_unsafe_url', 'Le service a fourni une adresse de téléchargement non autorisée.') from exc


class PublicResolver(aiohttp.abc.AbstractResolver):
    def __init__(self):
        self.inner = aiohttp.ThreadedResolver()

    async def resolve(self, host, port=0, family=socket.AF_INET):
        records = await self.inner.resolve(host, port, family)
        if not records or any(not public_ip(r['host']) for r in records):
            raise OSError('Non-public provider address rejected')
        return records

    async def close(self):
        await self.inner.close()


def configuration() -> tuple[str, str]:
    provider = os.getenv('AUDIO_IMPORT_PROVIDER', 'yt-dlp').strip().lower()
    if provider == 'yt-dlp':
        return provider, ''
    if provider not in {'cobalt', 'piped'}:
        raise ProviderError('provider_configuration', 'Le fournisseur audio est mal configuré.')
    base = os.getenv('COBALT_API_URL' if provider == 'cobalt' else 'PIPED_API_URL', '').strip().rstrip('/')
    if not base:
        raise ProviderError('provider_configuration', 'Aucun serveur audio externe n’est configuré.')
    validate_url(base)
    if urlsplit(base).query:
        raise ProviderError('provider_configuration', 'L’adresse du fournisseur est mal configurée.')
    return provider, base


def check_status(status: int):
    if status in (401, 403):
        raise ProviderError('provider_access_required', 'Le service audio exige une autorisation ou une vérification humaine.')
    if status == 429:
        raise ProviderError('provider_rate_limited', 'Le service audio limite les demandes. Réessaie plus tard.')
    if status != 200:
        raise ProviderError('provider_unavailable', 'Le service audio est momentanément indisponible.')


async def read_json(response):
    check_status(response.status)
    body = bytearray()
    async for chunk in response.content.iter_chunked(16384):
        body.extend(chunk)
        if len(body) > 1024 * 1024:
            raise ProviderError('provider_invalid_response', 'La réponse du service audio est trop volumineuse.')
    try:
        data = json.loads(body)
        if not isinstance(data, dict):
            raise ValueError()
        return data
    except (ValueError, UnicodeError) as exc:
        raise ProviderError('provider_invalid_response', 'Le service audio n’a pas renvoyé une réponse valide.') from exc


async def download(session, url: str, destination: Path, hosts: set[str]):
    validate_url(url, hosts)
    # No redirects: neither credentials nor media requests can escape the allowlist.
    async with session.get(url, allow_redirects=False) as response:
        check_status(response.status)
        if response.content_length is not None and response.content_length > MAX_BYTES:
            raise ProviderError('media_too_large', 'Le fichier dépasse la limite de 100 Mo.')
        if response.content_type in {'text/html', 'application/json'}:
            raise ProviderError('provider_invalid_media', 'Le service n’a pas renvoyé de fichier audio.')
        size = 0
        with destination.open('wb') as output:
            async for chunk in response.content.iter_chunked(65536):
                size += len(chunk)
                if size > MAX_BYTES:
                    raise ProviderError('media_too_large', 'Le fichier dépasse la limite de 100 Mo.')
                output.write(chunk)
        if not size:
            raise ProviderError('provider_invalid_media', 'Le service a renvoyé un fichier vide.')


async def _acquire(video_id: str, directory: Path):
    provider, base = configuration()
    host = urlsplit(base).hostname
    connector = aiohttp.TCPConnector(resolver=PublicResolver(), use_dns_cache=False)
    timeout = aiohttp.ClientTimeout(total=180, connect=15, sock_read=30)
    async with aiohttp.ClientSession(connector=connector, timeout=timeout,
                                   trust_env=False, cookie_jar=aiohttp.DummyCookieJar(),
                                   headers={'User-Agent': 'WAVE-audio-import/2.2'}) as session:
        if provider == 'cobalt':
            headers = {'Accept': 'application/json'}
            key = os.getenv('COBALT_API_KEY', '').strip()
            if key:
                headers['Authorization'] = 'Api-Key ' + key
            async with session.post(base + '/', json={
                'url': f'https://www.youtube.com/watch?v={video_id}',
                'downloadMode': 'audio', 'audioFormat': 'mp3', 'audioBitrate': '128',
                'alwaysProxy': True, 'localProcessing': 'disabled',
            }, headers=headers, allow_redirects=False) as response:
                data = await read_json(response)
            if data.get('status') == 'error':
                code = str((data.get('error') or {}).get('code', ''))
                if 'auth' in code or 'login' in code:
                    raise ProviderError('provider_access_required', 'Le service audio exige une autorisation ou une vérification humaine.')
                raise ProviderError('provider_extraction_failed', 'Le service audio n’a pas pu récupérer cette vidéo.')
            if data.get('status') != 'tunnel':
                raise ProviderError('provider_invalid_response', 'Le service audio ne propose pas de téléchargement compatible.')
            url = data.get('url', '')
            hosts = {host}
            title = Path(str(data.get('filename', 'Audio YouTube.mp3'))).stem[:200]
            artist = ''
        elif provider == 'piped':
            async with session.get(base + '/streams/' + video_id, allow_redirects=False) as response:
                data = await read_json(response)
            duration = data.get('duration')
            if data.get('livestream') or not isinstance(duration, (int, float)) or not 0 < duration <= 1800:
                raise ProviderError('media_duration', 'Choisis une vidéo de 30 minutes maximum, hors direct.')
            streams = [s for s in data.get('audioStreams', []) if isinstance(s, dict)
                       and s.get('url') and not s.get('videoOnly') and s.get('mimeType', '').startswith('audio/')]
            if not streams:
                raise ProviderError('provider_no_audio', 'Le service ne propose aucune piste audio pour cette vidéo.')
            stream = max(streams, key=lambda s: float(s.get('bitrate') or 0))
            url = stream['url']
            hosts = {host} | {h.strip().lower() for h in os.getenv('PIPED_MEDIA_HOSTS', '').split(',') if h.strip()}
            title, artist = str(data.get('title') or 'Audio YouTube')[:200], str(data.get('uploader') or '')[:200]
        else:
            raise ProviderError('provider_configuration', 'Aucun fournisseur externe sélectionné.')
        await download(session, url, directory / 'source.media', hosts)
        (directory / 'source.info.json').write_text(json.dumps({'title': title, 'artist': artist}))


async def acquire(video_id: str, directory: Path):
    try:
        async with asyncio.timeout(210):
            await _acquire(video_id, directory)
    except (aiohttp.ClientError, OSError, TimeoutError) as exc:
        raise ProviderError('provider_network_error', 'La connexion au service audio a échoué ou dépassé le délai.') from exc
