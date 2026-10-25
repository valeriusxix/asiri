# syntax=docker/dockerfile:1
#
# One container: the API, the built web app, and zingo-cli (Agent.md Section 17).
# Build from the repo root:
#   docker build -f docker/Dockerfile -t asiri .                 # full image with zingo-cli (slow: Rust build)
#   docker build -f docker/Dockerfile --target mock -t asiri .   # mock-only image, no Rust stage
# Run (the volume keeps the SQLite database and the treasury wallet across redeploys):
#   docker run -p 8787:8787 -v asiri-data:/app/data --env-file .env asiri

ARG ZINGOLIB_TAG=zingolib_v7.0.0

############################
# 1. zingo-cli + nym-proxy
############################
FROM rust:1-bookworm AS zingo
ARG ZINGOLIB_TAG
# The zingo-cli README lists build-essential, gcc and libsqlite3-dev for Ubuntu. zingolib's own Dockerfile
# also provides protobuf. pkg-config, libssl-dev, cmake and clang are extra build tools that some crates need.
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential gcc libsqlite3-dev protobuf-compiler pkg-config libssl-dev cmake clang git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN git clone --depth 1 --branch "${ZINGOLIB_TAG}" https://github.com/zingolabs/zingolib.git .
# rust-toolchain.toml pins the toolchain; rustup installs it here. Lower this on small build machines.
ARG CARGO_BUILD_JOBS=4
ENV CARGO_BUILD_JOBS=${CARGO_BUILD_JOBS}
# These are the two steps that `makers run-cli --build-only` runs (docs/ZINGO_NOTES.md). zingo-cli cannot go
# online without nym-proxy, which it looks for beside its own binary.
RUN cargo build --release -p zingo-cli
RUN cargo build --manifest-path zingo-netutils/Cargo.toml --features nym --bin nym-proxy --release \
 && cp zingo-netutils/target/release/nym-proxy target/release/nym-proxy \
 && (ldd target/release/zingo-cli target/release/nym-proxy || true)

############################
# 2. Node build
############################
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

############################
# 3. Runtime (shared base)
############################
FROM node:24-bookworm-slim AS base
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates libsqlite3-0 libssl3 \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8787 \
    DATABASE_PATH=./data/asiri.db \
    TREASURY_DATA_DIR=./data/treasury \
    ZINGO_CLI_PATH=/usr/local/bin/zingo-cli
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /app/apps/web/package.json ./apps/web/package.json
COPY --from=build --chown=node:node /app/apps/web/dist ./apps/web/dist
RUN mkdir -p /app/data && chown node:node /app/data
# Without a persistent volume here, the treasury wallet is lost on redeploy.
VOLUME /app/data
EXPOSE 8787
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["npm", "start"]

############################
# Mock-only image (docker build --target mock): no Rust build, ZCASH_MODE=mock only
############################
FROM base AS mock

############################
# Default image: with zingo-cli and nym-proxy on PATH
############################
FROM base AS runtime
COPY --from=zingo /src/target/release/zingo-cli /src/target/release/nym-proxy /usr/local/bin/
