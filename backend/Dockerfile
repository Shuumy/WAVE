FROM node:20-bookworm

ARG BGUTIL_VERSION=1.3.1

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH="/opt/venv/bin:${PATH}" \
    POT_PROVIDER_URL="http://127.0.0.1:4416"

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 \
      python3-venv \
      python3-pip \
      git \
      ca-certificates \
      curl \
      build-essential \
      libcairo2-dev \
      libjpeg-dev \
      libpango1.0-dev \
      libgif-dev \
      librsvg2-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./requirements.txt
RUN python3 -m venv /opt/venv \
    && pip install --no-cache-dir --upgrade pip setuptools wheel \
    && pip install --no-cache-dir -r requirements.txt

RUN git clone --depth 1 --branch "${BGUTIL_VERSION}" \
      https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /opt/bgutil \
    && cd /opt/bgutil/server \
    && npm ci \
    && npx tsc \
    && npm cache clean --force

COPY . /app
RUN chmod 755 /app/start.sh \
    && useradd --create-home --uid 10001 wave \
    && chown -R wave:wave /app /opt/bgutil

USER wave

EXPOSE 10000

CMD ["/app/start.sh"]
