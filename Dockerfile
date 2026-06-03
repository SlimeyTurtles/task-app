# syntax=docker/dockerfile:1.7

# ─── Stage 1: install deps (cached unless lockfile changes) ────────────────
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g pnpm@10.13.1
# Copy only the manifest + lockfile + prisma schema so this layer is reused
# across code changes. `prisma generate` runs on postinstall — needs schema.
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# ─── Stage 2: build ────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g pnpm@10.13.1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Prisma client is generated in postinstall; regenerate to be safe.
RUN pnpm prisma generate
RUN pnpm build

# ─── Stage 3: runtime ─────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -g 1001 nodejs \
    && useradd  -u 1001 -g nodejs -s /bin/sh nextjs \
    # Prisma CLI globally — used for `db push` at boot. Pinned to match the
    # @prisma/client version that the standalone bundle traced in.
    && npm install -g prisma@6.19.3

# Next.js standalone output — only the files needed to serve. The standalone
# trace already includes @prisma/client + the runtime query engine.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static    ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public          ./public
COPY --from=builder --chown=nextjs:nodejs /app/prisma          ./prisma

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
