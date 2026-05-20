# ── Stage 1: build ────────────────────────────────────────────────────────────
# Use full Debian image so build tools (python3, make, g++) are available
# for compiling better-sqlite3 and sharp native addons.
FROM node:22-bookworm AS builder

WORKDIR /app

# Install pnpm (pinned to match lockfile version)
RUN corepack enable && corepack prepare pnpm@11.0.9 --activate

# Copy workspace manifests (lockfile lives at repo root)
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY backend/package.json ./backend/package.json

# Install ALL deps.
# --ignore-scripts avoids pnpm v11's ERR_PNPM_IGNORED_BUILDS approval gate.
# Native modules are compiled explicitly below.
RUN pnpm install --frozen-lockfile --ignore-scripts

# Rebuild native deps explicitly.
# node:22-bookworm provides python3, make, g++ that node-gyp requires.
# pnpm rebuild bypasses the onlyBuiltDependencies filter.
RUN pnpm rebuild better-sqlite3 sharp
# Fail-fast: verify the binary was actually compiled
RUN find /app/node_modules/.pnpm -name "better_sqlite3.node" | grep -q . \
 || (echo "ERROR: better_sqlite3.node was not compiled by node-gyp" >&2 && exit 1)

# Install esbuild globally via npm so the bundler binary is reliably available
RUN npm install -g esbuild@0.21.5

# Copy backend source and bundle all JS into a single file.
# --external marks native addons so they stay as require() calls at runtime.
COPY backend/tsconfig.json ./backend/tsconfig.json
COPY backend/src ./backend/src

RUN esbuild backend/src/index.ts \
      --bundle \
      --platform=node \
      --format=cjs \
      --outfile=backend/dist/bundle.js \
      --external:better-sqlite3 \
      --external:sharp

# Create a self-contained flat node_modules for the backend (no pnpm symlinks).
# pnpm deploy resolves all production dependencies (direct + transitive) into
# a single directory that is safe to COPY across Docker stage boundaries.
# --ignore-scripts prevents re-running build scripts on already-compiled modules.
RUN pnpm --filter backend deploy --prod --ignore-scripts /backend-deploy

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM node:22-slim AS runtime

# Install GDAL with ECW/JP2/MrSID support
RUN apt-get update && apt-get install -y --no-install-recommends \
    gdal-bin \
    libgdal-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the esbuild bundle (contains all JS code; native addons load from node_modules)
COPY --from=builder /app/backend/dist/bundle.js  ./dist/index.js
COPY --from=builder /app/backend/package.json    ./package.json
# Copy the flat, symlink-free node_modules produced by pnpm deploy
COPY --from=builder /backend-deploy/node_modules ./node_modules

# Persistent data directory (SQLite DB lives here — mount a volume)
RUN mkdir -p /var/lib/quadspectat
ENV DATA_DIR=/var/lib/quadspectat

# Non-root user for security
RUN addgroup --system app && adduser --system --ingroup app app \
    && chown -R app:app /app /var/lib/quadspectat
USER app

EXPOSE 3001

CMD ["node", "dist/index.js"]
