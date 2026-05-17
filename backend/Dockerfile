# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy manifests first (layer-cache friendly)
COPY backend/package.json backend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Copy source and compile TypeScript
COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN pnpm build

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
COPY --from=builder /app/dist        ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# Persistent data directory (SQLite DB lives here — mount a volume)
RUN mkdir -p /var/lib/quadspectat
ENV DATA_DIR=/var/lib/quadspectat

# Non-root user for security
RUN addgroup --system app && adduser --system --ingroup app app \
    && chown -R app:app /app /var/lib/quadspectat
USER app

EXPOSE 3001

CMD ["node", "dist/index.js"]
