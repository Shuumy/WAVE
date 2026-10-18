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
