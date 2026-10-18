FROM node:24-bookworm-slim AS javascript
FROM python:3.12-slim-bookworm
COPY --from=javascript /usr/local/bin/node /usr/local/bin/node

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libchromaprint-tools \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./requirements.txt
RUN pip install --upgrade pip setuptools wheel \
    && pip install -r requirements.txt

COPY main.py ./main.py
COPY audio_import.py ./audio_import.py
COPY identify.py ./identify.py
COPY identify_match.py ./identify_match.py
COPY start.sh ./start.sh
RUN chmod 755 /app/start.sh \
    && useradd --create-home --uid 10001 wave \
    && chown -R wave:wave /app

USER wave
EXPOSE 10000
CMD ["/app/start.sh"]
