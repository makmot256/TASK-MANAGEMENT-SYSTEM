# syntax=docker/dockerfile:1
#
# Task Management System — single image serving the API and the built SPA.
#
# The server resolves the client bundle at ../../client/dist relative to
# server/src (see server/src/index.js), so the runtime layout must keep the
# repository's two-directory shape:
#
#   /app/server/src/...
#   /app/client/dist/...
#
# All dependencies are pure JavaScript (bcryptjs, mysql2, multer), so Alpine
# needs no build toolchain.

# ---------------------------------------------------------------------------
# Stage 1 — build the React SPA
# ---------------------------------------------------------------------------
FROM node:22-alpine AS client-build
WORKDIR /build

COPY client/package.json client/package-lock.json ./
RUN npm ci

# index.html is Vite's entry module, not an asset — the build fails without it.
COPY client/index.html client/tsconfig.json client/vite.config.ts ./
COPY client/src ./src
# `npm run build` runs `tsc --noEmit && vite build`, so a type error fails the image.
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 2 — install production server dependencies
# ---------------------------------------------------------------------------
FROM node:22-alpine AS server-deps
WORKDIR /build

COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

# ---------------------------------------------------------------------------
# Stage 3 — runtime
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runtime

# tini reaps zombies and forwards signals, so SIGTERM reaches Node directly
# and the scheduler's shutdown handler actually fires.
RUN apk add --no-cache tini

ENV NODE_ENV=production \
    PORT=4000 \
    UPLOAD_DIR=/app/uploads

WORKDIR /app/server

COPY --from=server-deps /build/node_modules ./node_modules
COPY server/package.json ./package.json
COPY server/src ./src
# The suite runs in this image via the compose `test` service.
COPY server/test ./test

COPY --from=client-build /build/dist /app/client/dist

# Uploads live outside the source tree and are backed by a named volume.
# UPLOAD_DIR is absolute, so it is independent of the process working directory.
RUN mkdir -p /app/uploads && chown -R node:node /app/uploads

USER node
EXPOSE 4000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:4000/api/health >/dev/null 2>&1 || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/index.js"]
