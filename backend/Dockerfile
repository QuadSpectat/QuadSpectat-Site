# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:22-slim AS builder

WORKDIR /app

# Install pnpm (pinned to match lockfile version)
RUN corepack enable && corepack prepare pnpm@11.0.9 --activate

# Copy workspace manifests (lockfile lives at repo root)
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY backend/package.json ./backend/package.json

# Install all deps; ignore-scripts first, then rebuild native modules explicitly
RUN pnpm install --frozen-lockfile --ignore-scripts
# Rebuild native deps against the current Node ABI
RUN pnpm --filter backend rebuild better-sqlite3 sharp
# Install esbuild globally via npm so the platform binary is reliably available
RUN npm install -g esbuild@0.21.5

# Copy backend source
COPY backend/tsconfig.json ./backend/tsconfig.json
COPY backend/src ./backend/src

# Bundle ALL JS deps into a single file with esbuild (installed globally above).
# Mark native modules as external — they are copied separately.
# This eliminates node_modules symlink resolution issues in Docker.
RUN esbuild backend/src/index.ts \
      --bundle \
      --platform=node \
      --format=cjs \
      --outfile=backend/dist/bundle.js \
      --external:better-sqlite3 \
      --external:sharp

# Stage the native module directories (dereference pnpm symlinks with cp -rL)
# so Docker COPY works cleanly across stage boundaries.
RUN mkdir -p /native/node_modules \
 && src=$(cd /app/backend/node_modules/better-sqlite3 && pwd -P) \
 && cp -rL "$src" /native/node_modules/better-sqlite3 \
 && src=$(cd /app/backend/node_modules/sharp && pwd -P) \
 && cp -rL "$src" /native/node_modules/sharp

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM node:22-slim AS runtime

# Install GDAL with ECW/JP2/MrSID support
RUN apt-get update && apt-get install -y --no-install-recommends \
    gdal-bin \
    libgdal-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Runtime only needs the bundle + native module binaries (no other node_modules)
COPY --from=builder /app/backend/dist/bundle.js  ./dist/index.js
COPY --from=builder /app/backend/package.json    ./package.json
COPY --from=builder /native/node_modules         ./node_modules

# Persistent data directory (SQLite DB lives here — mount a volume)
RUN mkdir -p /var/lib/quadspectat
ENV DATA_DIR=/var/lib/quadspectat

# Non-root user for security
RUN addgroup --system app && adduser --system --ingroup app app \
    && chown -R app:app /app /var/lib/quadspectat
USER app

EXPOSE 3001

CMD ["node", "dist/index.js"]
