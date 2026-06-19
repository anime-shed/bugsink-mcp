# syntax=docker/dockerfile:1

# ── Build stage: compile TypeScript ──────────────────────────────────────────
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ── Runtime stage: production deps + compiled output ─────────────────────────
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist

# Streamable-HTTP mode is enabled when PORT (or MCP_HTTP_PORT) is set. Cloud Run
# injects PORT and overrides this default. Provide BUGSINK_URL, BUGSINK_TOKEN,
# and MCP_HTTP_AUTH_TOKEN as service environment variables (tokens as secrets).
ENV PORT=8080
EXPOSE 8080
CMD ["node", "dist/index.js"]
