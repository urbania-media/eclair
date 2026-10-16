# syntax=docker/dockerfile:1

# The Eclair image: the API, the workers and the eclair CLI, with every binary the built-in
# operations need (decision 0006). Build it from the repository root:
#
#   docker build -f docker/Dockerfile -t eclair .
#
# Binaries come from Debian 13 (trixie). A Debian stable release only takes security fixes, so the
# upstream versions stay fixed: ffmpeg 7.1, ImageMagick 7.1.1, libvips 8.16, Ghostscript 10.05,
# poppler 25.03, fonttools 4.57. The base image is pinned by digest, and docker/smoke-test.sh fails
# when one of these versions changes. audiowaveform and whisper.cpp are built from pinned sources,
# checked against their SHA-256.

FROM node:24.22.0-trixie-slim@sha256:7f486cabe892bff8fef04c0f7da8dba84a560be3e4e2740b7a86afc57ebec315 AS node

FROM node AS build-base

ARG DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates cmake curl g++ make \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src

# audiowaveform: waveform data and images for audio.waveform.
FROM build-base AS audiowaveform

ARG DEBIAN_FRONTEND=noninteractive

ARG AUDIOWAVEFORM_VERSION=1.10.3
ARG AUDIOWAVEFORM_SHA256=191b7d46964de9080b6321411d79c6a2746c6da40bda283bb0d46cc7e718c90b

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libboost-filesystem-dev libboost-program-options-dev libboost-regex-dev \
        libgd-dev libid3tag0-dev libmad0-dev libsndfile1-dev \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL -o source.tar.gz \
        "https://github.com/bbc/audiowaveform/archive/refs/tags/${AUDIOWAVEFORM_VERSION}.tar.gz" \
    && echo "${AUDIOWAVEFORM_SHA256}  source.tar.gz" | sha256sum -c - \
    && tar -xzf source.tar.gz --strip-components=1 \
    && cmake -S . -B build -DCMAKE_BUILD_TYPE=Release -DENABLE_TESTS=0 \
    && cmake --build build -j"$(nproc)" \
    && install -D -m 0755 build/audiowaveform /out/usr/local/bin/audiowaveform

# whisper.cpp: local speech-to-text for ai.transcribe. Built for any CPU of the target
# architecture (GGML_NATIVE=OFF), which on x86-64 still means AVX2, FMA and F16C (2013 and later).
# Models aren't in the image.
FROM build-base AS whisper

ARG WHISPER_CPP_VERSION=1.9.5
ARG WHISPER_CPP_SHA256=ff1a9053feb509ff9d7729703355541ae9690073a6b1c40eb692c962e0dc1720

RUN curl -fsSL -o source.tar.gz \
        "https://github.com/ggml-org/whisper.cpp/archive/refs/tags/v${WHISPER_CPP_VERSION}.tar.gz" \
    && echo "${WHISPER_CPP_SHA256}  source.tar.gz" | sha256sum -c - \
    && tar -xzf source.tar.gz --strip-components=1 \
    && cmake -S . -B build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DGGML_NATIVE=OFF \
        -DWHISPER_BUILD_IS_DEV=OFF \
        -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF \
    && cmake --build build --target whisper-cli -j"$(nproc)" \
    && install -D -m 0755 build/bin/whisper-cli /out/usr/local/bin/whisper-cli

# The Eclair packages, as they are published to npm, with their production dependencies.
FROM node AS app

WORKDIR /src

COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY packages/protocol/package.json packages/protocol/
COPY packages/operation/package.json packages/operation/
COPY packages/operations-core/package.json packages/operations-core/
COPY packages/operations-video/package.json packages/operations-video/
COPY packages/operations-audio/package.json packages/operations-audio/
COPY packages/operations-document/package.json packages/operations-document/
COPY packages/client/package.json packages/client/
COPY packages/server/package.json packages/server/
RUN npm ci --ignore-scripts

COPY config config
COPY packages packages
RUN npm run build \
    && mkdir /tmp/packs \
    && npm pack --workspaces --pack-destination /tmp/packs

# Unpack each package where npm expects its workspace, then install the production dependencies.
WORKDIR /app
RUN cp /src/package.json /src/package-lock.json . \
    && for workspace in $(node -p "require('./package.json').workspaces.join(' ')"); do \
        name=$(node -p "require('/src/${workspace}/package.json').name.replace('@', '').replace('/', '-')"); \
        mkdir -p "${workspace}"; \
        tar -xzf /tmp/packs/${name}-*.tgz -C "${workspace}" --strip-components=1; \
    done \
    && npm ci --omit=dev --ignore-scripts \
    && rm -rf /root/.npm

FROM node AS runtime

ARG DEBIAN_FRONTEND=noninteractive

# npm, Yarn and Corepack come with the Node image. Eclair doesn't run them, and they bring their own
# dependencies to keep patched. An image with extra operation packages installs them in a build stage.
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx \
        /usr/local/bin/corepack /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg \
        /usr/local/bin/docker-entrypoint.sh

RUN apt-get update \
    && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends \
        ca-certificates tini \
        ffmpeg \
        imagemagick libheif-plugin-aomenc libheif-plugin-dav1d libheif-plugin-libde265 \
            libheif-plugin-x265 \
        libvips-tools \
        ghostscript poppler-utils \
        fonttools python3-brotli \
        libboost-filesystem1.83.0 libboost-program-options1.83.0 libboost-regex1.83.0 \
            libgd3 libid3tag0 libmad0 libsndfile1 \
        libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && fc-cache -f

COPY --from=audiowaveform /out/ /
COPY --from=whisper /out/ /

# ImageMagick only reads and writes raster formats, never calls a delegate and has resource limits.
# Ghostscript has no policy file: -dSAFER is its default, and GS_OPTIONS makes sure of it.
COPY docker/imagemagick/policy.xml /etc/ImageMagick-7/policy.xml

COPY --from=app /app /app
COPY --chmod=0755 docker/entrypoint.sh /usr/local/bin/eclair-entrypoint

# npm doesn't link the bin of a workspace package, so the eclair command is a small wrapper.
RUN printf '#!/bin/sh\nexec node /app/packages/server/dist/cli/main.js "$@"\n' >/usr/local/bin/eclair \
    && chmod 0755 /usr/local/bin/eclair

# The eclair user can only write to ECLAIR_TMP_DIR, and to /var/lib/eclair, the mount point of the
# data volume (SQLite database and local temporary storage). /tmp and /var/tmp are read-only, so
# every binary goes through TMPDIR, which the entry point sets to ECLAIR_TMP_DIR.
RUN userdel --remove node \
    && groupadd --gid 10001 eclair \
    && useradd --uid 10001 --gid eclair --home-dir /nonexistent --no-create-home \
        --shell /usr/sbin/nologin eclair \
    && install -d -o eclair -g eclair -m 0700 /tmp/eclair /var/lib/eclair \
    && chmod 0755 /tmp /var/tmp

ENV NODE_ENV=production \
    PATH=/app/node_modules/.bin:$PATH \
    ECLAIR_TMP_DIR=/tmp/eclair \
    GS_OPTIONS=-dSAFER \
    PYTHONDONTWRITEBYTECODE=1

LABEL org.opencontainers.image.title="Eclair" \
    org.opencontainers.image.description="Self-hosted media processing server" \
    org.opencontainers.image.source="https://github.com/urbania-media/eclair" \
    org.opencontainers.image.licenses="MIT"

USER eclair
WORKDIR /app

ENTRYPOINT ["/usr/bin/tini", "--", "eclair-entrypoint"]
CMD ["all"]
