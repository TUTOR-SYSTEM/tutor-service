# syntax=docker/dockerfile:1
# --- BUILD ---- #
# node (not bun) runs `nest build`: under bun, nest's path-alias rewrite (@packages/*) is skipped
FROM docker.io/node:22-alpine AS builder
COPY --from=docker.io/oven/bun:1-alpine /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
COPY package.json bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile
COPY . .
# generated Prisma client (+ query engine) lands in node_modules/.prisma, copied to the runtime stage
RUN node node_modules/prisma/build/index.js generate
RUN node node_modules/@nestjs/cli/bin/nest.js build && test -f dist/main.js

# --- PROD DEPS: runtime-only node_modules ---
FROM docker.io/oven/bun:1-alpine AS prod-deps
WORKDIR /app
COPY package.json bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --production --ignore-scripts

# --- RUNTIME ---
FROM docker.io/node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
# Prisma's query engine needs OpenSSL on Alpine
RUN apk add --no-cache openssl
COPY --chown=node:node --from=prod-deps /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --chown=node:node --from=builder /app/dist ./dist
COPY package.json tsconfig.json ./
USER node
EXPOSE 4003
CMD ["node", "dist/main"]
