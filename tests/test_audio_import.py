"""Real FFmpeg + HTTP delivery; only YouTube acquisition is replaced by a fixture."""
import asyncio
import json
import os
from pathlib import Path
import subprocess
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
import audio_import as audio


@pytest.mark.parametrize('url', [
    'https://youtu.be/BaW_jenozKc?t=1',
    'https://www.youtube.com/watch?v=BaW_jenozKc&list=ignored',
    'https://music.youtube.com/watch?v=BaW_jenozKc',
    'https://m.youtube.com/shorts/BaW_jenozKc',
])
def test_canonical_video(url):
    assert audio.youtube_id(url) == 'BaW_jenozKc'


@pytest.mark.parametrize('url', [
    'http://youtube.com/watch?v=BaW_jenozKc', 'https://localhost/file',
    'https://youtube.com.evil.test/watch?v=BaW_jenozKc',
    'https://youtube.com@127.0.0.1/watch?v=BaW_jenozKc',
    'https://www.youtube.com:9000/watch?v=BaW_jenozKc',
    'https://www.youtube.com/playlist?list=123',
    'https://youtu.be/invalid', 'file:///etc/passwd',
])
def test_reject_arbitrary_urls(url):
    with pytest.raises(HTTPException):
        audio.youtube_id(url)


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv('AUDIO_IMPORT_ENABLED', 'true')
    # Each TestClient lifespan owns a new event loop.
    monkeypatch.setattr(audio, 'worker', asyncio.Semaphore(1))
    app = FastAPI(lifespan=audio.lifespan)
    app.include_router(audio.router)
    with TestClient(app) as client:
        yield client


def completed(client, token):
    for _ in range(100):
        job = client.get(f'/api/imports/{token}').json()
        if job['state'] in {'ready', 'failed'}:
            return job
        time.sleep(.05)
    pytest.fail('Job did not complete')


@pytest.mark.parametrize('format,codec', [('mp3', 'mp3'), ('m4a', 'aac')])
def test_conversion_and_download(client, monkeypatch, tmp_path, format, codec):
    real_run = audio.run_process

    async def fixture_acquisition(args, directory, timeout=audio.JOB_TIMEOUT):
        if 'yt_dlp' in args:
            assert args[-1] == 'https://www.youtube.com/watch?v=BaW_jenozKc'
            subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i',
                            'sine=frequency=440:duration=1', str(directory / 'source.wav')], check=True)
            (directory / 'source.info.json').write_text(json.dumps({'title': 'Demo', 'artist': 'WAVE'}))
        else:
            await real_run(args, directory, timeout)
    monkeypatch.setattr(audio, 'run_process', fixture_acquisition)
    response = client.post('/api/imports', json={'url': 'https://youtu.be/BaW_jenozKc', 'format': format})
    assert response.status_code == 202
    token = response.json()['id']
    assert completed(client, token)['state'] == 'ready'
    response = client.get(f'/api/imports/{token}/file')
    assert response.status_code == 200
    assert response.headers['content-type'].startswith('audio/')
    output = tmp_path / f'output.{format}'
    output.write_bytes(response.content)
    info = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_streams', '-of', 'json', str(output)]))
    assert info['streams'][0]['codec_name'] == codec
    assert float(info['streams'][0]['duration']) > .9
    directory = audio.jobs[token].directory
    assert len(list(directory.iterdir())) == 1
    audio.jobs[token].expires = time.time() - 1
    assert client.get(f'/api/imports/{token}/file').status_code == 404
    assert not directory.exists()


def test_failures_cleanup_and_capacity(client, monkeypatch):
    async def failing(*args, **kwargs):
        raise RuntimeError('Source indisponible')
    monkeypatch.setattr(audio, 'run_process', failing)
    for _ in range(audio.MAX_JOBS):
        token = client.post('/api/imports', json={'url': 'https://youtu.be/BaW_jenozKc'}).json()['id']
        assert completed(client, token)['state'] == 'failed'
        assert not audio.jobs[token].directory.exists()
        assert client.get(f'/api/imports/{token}/file').status_code == 409
    assert client.post('/api/imports', json={'url': 'https://youtu.be/BaW_jenozKc'}).status_code == 429


def test_disabled_origin_and_input(client, monkeypatch):
    assert client.post('/api/imports', json={'url': 'https://127.0.0.1'}).status_code == 422
    assert client.post('/api/imports', json={'url': 'https://youtu.be/BaW_jenozKc', 'format': 'exe'}).status_code == 422
    assert client.post('/api/imports', headers={'origin': 'https://evil.test'}, json={'url': 'https://youtu.be/BaW_jenozKc'}).status_code == 403
    monkeypatch.setenv('AUDIO_IMPORT_ENABLED', 'false')
    assert client.post('/api/imports', json={'url': 'https://youtu.be/BaW_jenozKc'}).status_code == 503


def test_process_timeout(tmp_path):
    with pytest.raises(TimeoutError):
        asyncio.run(audio.run_process([sys.executable, '-c', 'import time; time.sleep(60)'], tmp_path, timeout=.1))


def test_release_cancels_active_job(client, monkeypatch):
    async def slow(*args, **kwargs):
        await asyncio.sleep(60)
    monkeypatch.setattr(audio, 'run_process', slow)
    token = client.post('/api/imports', json={'url':'https://youtu.be/BaW_jenozKc'}).json()['id']
    directory = audio.jobs[token].directory
    assert client.delete(f'/api/imports/{token}').status_code == 204
    assert client.get(f'/api/imports/{token}').status_code == 404
    assert not directory.exists()


@pytest.mark.parametrize('stderr,code', [
    ("Sign in to confirm you're not a bot", 'youtube_verification_required'),
    ('HTTP Error 403: Forbidden', 'upstream_forbidden'),
    ('HTTP Error 429', 'upstream_rate_limited'),
    ('Requested format is not available', 'audio_format_unavailable'),
    ('PO Token provider failed', 'token_provider_failed'),
    ('Read timed out', 'upstream_network_error'),
    ('Private video', 'restricted_video'),
])
def test_diagnostic_categories(stderr, code):
    assert audio.process_error(stderr, 'extractor').code == code


def test_redact_diagnostic():
    value = audio.safe_diagnostic('ERROR https://example.com/file?secret=abc\nCookie: secret\npo_token=secret\n' + 'A' * 60)
    assert 'secret' not in value
    assert 'example.com' not in value
    assert 'A' * 60 not in value


def test_stderr_is_drained_bounded_and_classified(tmp_path):
    # Exceed the pipe buffer to catch deadlocks while keeping the tail bounded.
    command = [sys.executable, '-c', "import sys; sys.stderr.write('x'*200000 + '\\nHTTP Error 403: Forbidden'); sys.exit(1)"]
    with pytest.raises(audio.AudioProcessError) as exc:
        asyncio.run(audio.run_process(command, tmp_path, timeout=5))
    assert exc.value.code == 'upstream_forbidden'


@pytest.mark.parametrize('url', ['http://api.example/a', 'https://127.0.0.1/a',
    'https://[::1]/', 'https://user:secret@api.example/a', 'https://api.example:444/a',
    'https://evil.example/a', 'file:///tmp/a'])
def test_provider_media_urls(url):
    from audio_providers import validate_url, ProviderError
    with pytest.raises(ProviderError):
        validate_url(url, {'api.example'})


@pytest.mark.parametrize('ip', ['127.0.0.1', '10.0.0.1', '169.254.169.254', '::1', 'fe80::1', '224.0.0.1'])
def test_provider_private_network_rejected(ip):
    from audio_providers import public_ip
    assert not public_ip(ip)


def test_provider_dns_rebinding_rejected(monkeypatch):
    import audio_providers as providers
    async def run():
        resolver = providers.PublicResolver()
        async def resolve(*args):
            return [{'host': '8.8.8.8'}, {'host': '127.0.0.1'}]
        monkeypatch.setattr(resolver.inner, 'resolve', resolve)
        with pytest.raises(OSError):
            await resolver.resolve('api.example')
        await resolver.close()
    asyncio.run(run())


@pytest.mark.parametrize('format', ['mp3', 'm4a'])
def test_external_provider_conversion(client, monkeypatch, format):
    monkeypatch.setenv('AUDIO_IMPORT_PROVIDER', 'cobalt')
    monkeypatch.setenv('COBALT_API_URL', 'https://api.example')
    async def acquire(video, directory):
        assert video == 'BaW_jenozKc'
        subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i',
                        'sine=duration=1', '-f', 'wav', str(directory / 'source.media')], check=True)
        (directory / 'source.info.json').write_text(json.dumps({'title': 'Cobalt fixture'}))
    monkeypatch.setattr(audio.audio_providers, 'acquire', acquire)
    token = client.post('/api/imports', json={'url': 'https://youtu.be/BaW_jenozKc', 'format': format}).json()['id']
    job = completed(client, token)
    assert job['state'] == 'ready', job
    assert job['title'] == 'Cobalt fixture'
    assert client.get(f'/api/imports/{token}/file').status_code == 200
    client.delete(f'/api/imports/{token}')


def test_provider_reject_long_audio(client, monkeypatch):
    monkeypatch.setenv('AUDIO_IMPORT_PROVIDER', 'piped')
    monkeypatch.setenv('PIPED_API_URL', 'https://api.example')
    async def acquire(video, directory):
        (directory / 'source.media').write_bytes(b'fixture')
        (directory / 'source.info.json').write_text('{}')
    async def probe(args, directory, **kwargs):
        assert args[0] == 'ffprobe'
        (directory / 'probe.json').write_text(json.dumps({'format': {'duration': 1801}, 'streams': [{'codec_type': 'audio'}]}))
    monkeypatch.setattr(audio.audio_providers, 'acquire', acquire)
    monkeypatch.setattr(audio, 'run_process', probe)
    token = client.post('/api/imports', json={'url': 'https://youtu.be/BaW_jenozKc'}).json()['id']
    assert completed(client, token)['errorCode'] == 'media_duration'
    assert not audio.jobs[token].directory.exists()


def test_cobalt_request_and_key_isolation(monkeypatch, tmp_path):
    import audio_providers as p
    monkeypatch.setenv('AUDIO_IMPORT_PROVIDER', 'cobalt')
    monkeypatch.setenv('COBALT_API_URL', 'https://api.example')
    monkeypatch.setenv('COBALT_API_KEY', 'test-key')
    calls = []
    class Body:
        async def iter_chunked(self, _):
            yield json.dumps({'status': 'tunnel', 'url': 'https://api.example/tunnel?id=test', 'filename': 'Demo.mp3'}).encode()
    class Response:
        status = 200
        content = Body()
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
    class Session:
        def __init__(self, **kwargs):
            self.connector = kwargs['connector']
            assert 'Authorization' not in kwargs['headers']
        async def __aenter__(self): return self
        async def __aexit__(self, *args): await self.connector.close()
        def post(self, url, **kwargs):
            calls.append(kwargs)
            return Response()
    async def download(session, url, dest, hosts):
        assert hosts == {'api.example'}
        dest.write_bytes(b'fixture')
    monkeypatch.setattr(p.aiohttp, 'ClientSession', Session)
    monkeypatch.setattr(p, 'download', download)
    asyncio.run(p.acquire('BaW_jenozKc', tmp_path))
    assert calls[0]['headers']['Authorization'] == 'Api-Key test-key'
    assert calls[0]['json']['alwaysProxy'] is True
    assert calls[0]['allow_redirects'] is False
    assert json.loads((tmp_path / 'source.info.json').read_text())['title'] == 'Demo'


@pytest.mark.parametrize('status,code', [(401, 'provider_access_required'), (403, 'provider_access_required'), (429, 'provider_rate_limited'), (302, 'provider_unavailable')])
def test_provider_status_no_retry(status, code):
    from audio_providers import check_status, ProviderError
    with pytest.raises(ProviderError) as error:
        check_status(status)
    assert error.value.code == code
