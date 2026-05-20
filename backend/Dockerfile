# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:22-slim AS builder

WORKDIR /app

# Install pnpm (pinned to match lockfile version)
RUN corepack enable && corepack prepare pnpm@11.0.9 --activate

# Copy workspace manifests (lockfile lives at repo root)
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY backend/package.json ./backend/package.json

# Install all deps (ignore-scripts first, then rebuild native modules explicitly)
RUN pnpm install --frozen-lockfile --ignore-scripts
RUN pnpm --filter backend rebuild better-sqlite3 sharp esbuild

# Copy backend source and compile TypeScript
COPY backend/tsconfig.json ./backend/tsconfig.json
COPY backend/src ./backend/src
RUN pnpm --filter backend build

# Use pnpm deploy to produce a self-contained production directory
# (flattens the pnpm virtual store into a normal node_modules — no symlinks)
RUN pnpm --filter backend deploy --prod /deploy
# Overlay compiled dist on top of the deploy directory
RUN cp -r /app/backend/dist /deploy/dist

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM node:22-slim AS runtime

# Install GDAL with ECW/JP2/MrSID support
RUN apt-get update && apt-get install -y --no-install-recommends \
    gdal-bin \
    libgdal-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy self-contained deployment (flattened node_modules + package.json)
COPY --from=builder /deploy/node_modules ./node_modules
COPY --from=builder /deploy/package.json ./package.json
# Copy compiled TypeScript output
COPY --from=builder /deploy/dist         ./dist

# Persistent data directory (SQLite DB lives here — mount a volume)
RUN mkdir -p /var/lib/quadspectat
ENV DATA_DIR=/var/lib/quadspectat

# Non-root user for security
RUN addgroup --system app && adduser --system --ingroup app app \
    && chown -R app:app /app /var/lib/quadspectat
USER app

EXPOSE 3001

CMD ["node", "dist/index.js"]
