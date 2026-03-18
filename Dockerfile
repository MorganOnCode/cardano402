# Stage 1: Build
FROM node:20-alpine AS build

# Enable corepack for pnpm
RUN corepack enable

WORKDIR /app

# Copy package files first (layer caching)
COPY package.json pnpm-lock.yaml ./

# Install all dependencies (including dev for build)
RUN pnpm install --frozen-lockfile

# Copy source code
COPY src/ src/
COPY tsconfig.json tsconfig.build.json tsup.config.ts ./

# Build
RUN pnpm build

# Stage 2: Production
FROM node:20-alpine AS production

RUN corepack enable

WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install production dependencies only (--ignore-scripts: husky prepare not needed in prod)
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

# Copy built output from build stage
COPY --from=build /app/dist ./dist

# Copy landing page (served at / by @fastify/static)
COPY landing/ ./landing/

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
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Start the application
CMD ["node", "dist/index.js"]
