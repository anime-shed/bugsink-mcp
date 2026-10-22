# syntax=docker/dockerfile:1

# ── Build stage: compile with Bun (fast bundler) ──────────────────────────────
FROM oven/bun:1-slim AS build
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile || bun install
COPY tsconfig.json ./
COPY src ./src
RUN bun run build

# ── Node runtime stage (default) ─────────────────────────────────────────────
FROM node:20-slim AS runtime-node
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist

ENV PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --retries=3 \
  CMD node -e "fetch('http://localhost:8080/healthz').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"
CMD ["node", "dist/index.js"]

# ── Bun runtime stage ────────────────────────────────────────────────────────
FROM oven/bun:1-slim AS runtime-bun
WORKDIR /app
ENV NODE_ENV=production
COPY package.json bun.lock* ./
RUN bun install --production
COPY --from=build /app/dist ./dist

ENV PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --retries=3 \
  CMD bun -e "fetch('http://localhost:8080/healthz').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"
CMD ["bun", "dist/index.js"]

# Default runtime
FROM runtime-node AS runtime
