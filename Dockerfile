# Stage 1: Build
FROM node:20-alpine AS build

# Enable corepack for pnpm
RUN corepack enable

WORKDIR /app

# Copy package files first (layer caching)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/ packages/

# Install all dependencies (including dev for build)
RUN pnpm install --frozen-lockfile

# Build workspace packages explicitly (prepare also does this, but being
# explicit means a future --ignore-scripts here can't silently skip it).
# packages/*/dist never comes from the build context (see .dockerignore),
# so the runtime core is always built from this commit's source (#138).
RUN pnpm --filter @cardano402/core build

# Copy source code AND landing page AND build scripts so `pnpm build`
# can produce both the backend dist/ and landing/dist/app.js bundle.
COPY src/ src/
COPY landing/ landing/
COPY scripts/build-landing.mjs scripts/
COPY tsconfig.json tsconfig.build.json tsup.config.ts ./

# `pnpm build` runs tsup (backend -> dist/) and build-landing
# (landing JSX -> landing/dist/app.js, with React + ReactDOM bundled).
RUN pnpm build

# Stage 2: Production
FROM node:20-alpine AS production

RUN corepack enable

WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/ packages/

# Install production dependencies only (--ignore-scripts: husky prepare not needed in prod)
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

# Copy built output from build stage
COPY --from=build /app/dist ./dist

# The production install above runs with --ignore-scripts and the build
# context carries no packages/*/dist, so supply the freshly built core the
# workspace link resolves to at runtime (#138).
COPY --from=build /app/packages/core/dist ./packages/core/dist

# Copy the landing page WITH its precompiled bundle from the build stage.
# The host-side landing/ doesn't have landing/dist (it's gitignored and only
# materialised during a build), so we pull the whole tree from the build
# stage where the bundle exists at landing/dist/app.js.
COPY --from=build /app/landing ./landing

# Copy agent-discovery surface (served at /SKILL.md by the agent-discovery plugin)
COPY SKILL.md ./SKILL.md

# Copy config example (actual config mounted at runtime)
COPY config/config.example.json ./config/config.example.json

# Create config directory for runtime mount
RUN mkdir -p config && chown appuser:appgroup config

# Switch to non-root user
USER appuser

# Expose default port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/health || exit 1

# Start the application
CMD ["node", "dist/index.js"]
