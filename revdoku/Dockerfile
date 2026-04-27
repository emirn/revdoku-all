# syntax=docker/dockerfile:1
# check=error=true
#
# Revdoku — single image running Rails + the doc-api service.

ARG RUBY_VERSION=3.4.5

# ── Stage 1: Vite/React frontend bundle ─────────────────────────────────
FROM node:20-slim AS frontend-builder
WORKDIR /app

COPY apps/shared/js-packages/revdoku-lib /app/apps/shared/js-packages/revdoku-lib
WORKDIR /app/apps/shared/js-packages/revdoku-lib
RUN npm ci && npm run build

WORKDIR /app/apps/web
COPY apps/web/package.json apps/web/package-lock.json* ./
COPY apps/web/vite.config.ts apps/web/postcss.config.cjs apps/web/tailwind.config.cjs ./
COPY apps/web/config/vite.json ./config/
RUN npm ci

COPY apps/web/app/frontend ./app/frontend
RUN npm run build

# ── Stage 2: doc-api (Fastify, TypeScript) bundle ───────────────────────
FROM node:20-slim AS revdoku-doc-api-builder
WORKDIR /app

COPY apps/shared/js-packages/revdoku-lib /app/apps/shared/js-packages/revdoku-lib
WORKDIR /app/apps/shared/js-packages/revdoku-lib
RUN npm ci --production=false && npm run build

COPY apps/services/revdoku-doc-api /app/apps/services/revdoku-doc-api
WORKDIR /app/apps/services/revdoku-doc-api
RUN npm ci --production=false && npm run build

# Non-TS assets aren't emitted by tsc. The output layout depends on what
# tsc included: with ee/ stripped (Core build via build-core.sh), tsc's
# auto-rootDir is src/ → output is flat under build/. With ee/ intact
# (Enterprise production CI build), rootDir lifts to the project root
# and output splits into build/src/... + build/ee/.... Detect which
# layout we got and copy assets beside the compiled JS — runtime path
# resolution uses `__dirname` from the JS files, so the prompts and
# templates have to sit relative to wherever server.js landed.
RUN BUILD_BASE=$(test -f build/src/server.js && echo build/src || echo build) && \
    echo "[doc-api] non-TS asset destination: $BUILD_BASE" && \
    cp -r src/templates "$BUILD_BASE/templates" && \
    mkdir -p "$BUILD_BASE/lib" && \
    cp -r src/lib/prompts "$BUILD_BASE/lib/prompts"

RUN npm prune --production && npm cache clean --force

# Resolve the @revdoku/lib file: dependency to a real copy — symlinks
# don't survive the cross-stage COPY in Stage 5.
RUN rm -rf node_modules/@revdoku/lib && \
    cp -r /app/apps/shared/js-packages/revdoku-lib node_modules/@revdoku/lib

# ── Stage 3: Ruby base (runtime deps only) ──────────────────────────────
FROM docker.io/library/ruby:$RUBY_VERSION-slim AS base
WORKDIR /rails

# chromium + fonts are for Puppeteer (PDF rendering in doc-api).
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y \
      curl dumb-init libjemalloc2 libvips sqlite3 \
      chromium fonts-liberation fontconfig \
    && rm -rf /var/lib/apt/lists /var/cache/apt/archives

# Reuse Node from the builder so we don't carry the whole node:20-slim layer.
COPY --from=revdoku-doc-api-builder /usr/local/bin/node /usr/local/bin/node

ENV RAILS_ENV="production" \
    BUNDLE_DEPLOYMENT="1" \
    BUNDLE_PATH="/usr/local/bundle" \
    BUNDLE_WITHOUT="development" \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD="true" \
    PUPPETEER_EXECUTABLE_PATH="/usr/bin/chromium"

# ── Stage 4: gem install + bootsnap precompile + asset precompile ───────
FROM base AS build

RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y \
      build-essential git libyaml-dev pkg-config \
    && rm -rf /var/lib/apt/lists /var/cache/apt/archives

COPY apps/web/Gemfile apps/web/Gemfile.lock ./
RUN bundle install && \
    rm -rf ~/.bundle/ "${BUNDLE_PATH}"/ruby/*/cache "${BUNDLE_PATH}"/ruby/*/bundler/gems/*/.git && \
    bundle exec bootsnap precompile --gemfile

COPY apps/web/ .

# Repo-root VERSION → /VERSION. The APP_VERSION arg below overrides this
# when CI passes a release tag; otherwise the file already on disk wins.
COPY VERSION /VERSION

# Release tags from CI look like `production-v1.2.3` → write `1.2.3`.
# Anything that isn't a clean semver keeps whatever was already in
# /VERSION (typically the last released semver); only blank-AND-empty
# falls back to 0.0.0 so `Gem::Version` doesn't raise at boot.
ARG APP_VERSION=
RUN v="${APP_VERSION#production-v}"; \
    case "$v" in \
      [0-9]*.[0-9]*.[0-9]*) echo "$v" > ../../VERSION ;; \
      *)                    [ -s ../../VERSION ] || echo "0.0.0" > ../../VERSION ;; \
    esac

COPY --from=frontend-builder /app/apps/web/public/vite ./public/vite

RUN bundle exec bootsnap precompile app/ lib/

# Sprockets/propshaft only — vite assets came in from Stage 1.
# SKIP_VITE_BUILD makes lib/tasks/docker_build.rake stub the vite tasks.
RUN SECRET_KEY_BASE_DUMMY=1 SKIP_VITE_BUILD=1 ./bin/rails assets:precompile

# ── Stage 5: runtime image ──────────────────────────────────────────────
FROM base

ARG GIT_COMMIT_SHA=unknown
ARG BUILD_TIME=unknown
ENV VERSION_COMMIT=$GIT_COMMIT_SHA \
    VERSION_BUILD_TIME=$BUILD_TIME

COPY --from=build "${BUNDLE_PATH}" "${BUNDLE_PATH}"
COPY --from=build /rails /rails
COPY --from=build /VERSION /VERSION

COPY --from=revdoku-doc-api-builder /app/apps/services/revdoku-doc-api/build        /app/revdoku-doc-api/build
COPY --from=revdoku-doc-api-builder /app/apps/services/revdoku-doc-api/node_modules /app/revdoku-doc-api/node_modules
COPY --from=revdoku-doc-api-builder /app/apps/services/revdoku-doc-api/package.json /app/revdoku-doc-api/package.json

# Drop privileges. `mkdir -p` so log/storage/tmp exist even when the
# source tree was pruned of dev-state directories.
RUN groupadd --system --gid 1000 rails && \
    useradd rails --uid 1000 --gid 1000 --create-home --shell /bin/bash && \
    mkdir -p db log storage tmp public && \
    chown -R rails:rails db log storage tmp public /app/revdoku-doc-api

USER 1000:1000

# bin/docker-entrypoint runs migrations, spawns doc-api in the background,
# then execs into the CMD below.
ENTRYPOINT ["dumb-init", "--", "/rails/bin/docker-entrypoint"]
EXPOSE 80
CMD ["./bin/thrust", "./bin/rails", "server"]
