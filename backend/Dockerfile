# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy workspace manifests (lockfile lives at repo root)
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY backend/package.json ./backend/package.json

# Install only backend dependencies
RUN pnpm install --frozen-lockfile --filter backend

# Copy backend source and compile TypeScript
COPY backend/tsconfig.json ./backend/tsconfig.json
COPY backend/src ./backend/src
RUN pnpm --filter backend build

# Prune to production deps only
RUN pnpm prune --prod

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM node:20-slim AS runtime

# Install GDAL with ECW/JP2/MrSID support
RUN apt-get update && apt-get install -y --no-install-recommends \
    gdal-bin \
    libgdal-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy built artifacts + production node_modules
COPY --from=builder /app/backend/dist        ./dist
COPY --from=builder /app/backend/node_modules ./node_modules
COPY --from=builder /app/backend/package.json ./package.json

# Persistent data directory (SQLite DB lives here — mount a volume)
RUN mkdir -p /var/lib/quadspectat
ENV DATA_DIR=/var/lib/quadspectat

# Non-root user for security
RUN addgroup --system app && adduser --system --ingroup app app \
    && chown -R app:app /app /var/lib/quadspectat
USER app

EXPOSE 3001

CMD ["node", "dist/index.js"]
