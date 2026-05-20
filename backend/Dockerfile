# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:22-slim AS builder

WORKDIR /app

# Install pnpm (pinned to match lockfile version)
RUN corepack enable && corepack prepare pnpm@11.0.9 --activate

# Copy workspace manifests (lockfile lives at repo root)
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY backend/package.json ./backend/package.json

# Install all deps; ignore-scripts so native builds happen in a controlled step
RUN pnpm install --frozen-lockfile --ignore-scripts
# Rebuild native modules explicitly against the current Node ABI
RUN pnpm --filter backend rebuild better-sqlite3 sharp esbuild

# Copy backend source and compile TypeScript
COPY backend/tsconfig.json ./backend/tsconfig.json
COPY backend/src ./backend/src
RUN pnpm --filter backend build

# Dereference ALL symlinks in backend's node_modules into a plain directory.
# pnpm's default linker stores real files in .pnpm and uses symlinks in
# workspace node_modules — Docker's COPY preserves broken symlinks across
# stages, so we materialise them here with cp -rL before the stage boundary.
RUN cp -rL /app/backend/node_modules /app/backend/node_modules_flat

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM node:22-slim AS runtime

# Install GDAL with ECW/JP2/MrSID support
RUN apt-get update && apt-get install -y --no-install-recommends \
    gdal-bin \
    libgdal-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy dereferenced (symlink-free) node_modules + compiled dist
COPY --from=builder /app/backend/node_modules_flat ./node_modules
COPY --from=builder /app/backend/dist              ./dist
COPY --from=builder /app/backend/package.json      ./package.json

# Persistent data directory (SQLite DB lives here — mount a volume)
RUN mkdir -p /var/lib/quadspectat
ENV DATA_DIR=/var/lib/quadspectat

# Non-root user for security
RUN addgroup --system app && adduser --system --ingroup app app \
    && chown -R app:app /app /var/lib/quadspectat
USER app

EXPOSE 3001

CMD ["node", "dist/index.js"]
