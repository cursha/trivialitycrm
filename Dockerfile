# Multi-stage build producing two runtime targets from one image build:
# `web` (Next.js server) and `worker` (pg-boss job consumer, run via tsx).
# `docker build --target web` / `--target worker` against this file both work
# fine locally (and did, repeatedly, in this module's deployment-gate
# testing) — but Railway itself has no equivalent of `--target` anywhere in
# its build settings or config-as-code (confirmed directly against Railway's
# own current docs during Module Ten, after this gap caused a real
# production incident: a second Railway service pointed at this file built
# `web` regardless, since Docker defaults to the file's LAST stage —
# `final`, aliased to `web` below — whenever no target is specified). The
# `worker` Railway service is built from the separate, single-purpose
# `Dockerfile.worker` instead — see that file's header for the full
# explanation. This file's own worker stage is kept only for local
# `--target worker` testing/parity, not because Railway can reach it.
#
# node:22-slim (Debian, not alpine) — matches package.json's engines.node
# (pg-boss requires >=22.12 for CommonJS require(esm)) and avoids the
# musl/glibc engine-binary mismatch Prisma's engines can hit on alpine
# unless linux-musl is added as an explicit binaryTarget, which this schema
# doesn't declare. OpenSSL is installed explicitly — confirmed by an actual
# container run during this module's build verification that node:22-slim
# lacks it, which makes Prisma's query engine silently fall back to a
# guessed libssl version ("openssl-1.1.x") instead of detecting the real
# one; harmless if the guess happens to match, a genuine correctness risk if
# it doesn't. See MODULE_3_REPORT.md.
FROM node:22-slim AS base
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# ---- deps: install once, shared by every stage below ----
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- builder: generate the Prisma client and produce the Next build ----
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# prisma.config.ts's env("DATABASE_URL") resolves eagerly even for `prisma
# generate`, which never actually connects to a database — only reads the
# schema file to emit client code. A placeholder satisfies that resolution;
# it is never a real credential and does not appear in the final `web` or
# `worker` stages below (they start fresh FROM base, not FROM builder, so
# nothing set here carries over).
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
RUN npx prisma generate
RUN npm run build

# ---- web: Next's build output, running on the FULL node_modules (not
# .next/standalone's pruned trace). Next's output-file-tracing only follows
# actual import/require/fs usage from application code — the Prisma CLI is
# invoked as a subprocess (Railway's Pre-Deploy Command: `npx prisma migrate
# deploy`), never imported, so tracing omits it and files it depends on.
# Verified during this module's build testing: a surgical copy of just
# node_modules/prisma + node_modules/.bin/prisma broke at runtime (missing
# prisma_schema_build_bg.wasm, which npm's packaging places relative to
# .bin/ in a way the pruned trace didn't preserve). Using the full
# node_modules trades a larger image for eliminating that whole class of
# "which specific files does the CLI need" risk — deliberate, not an
# oversight; see MODULE_3_REPORT.md. Confirmed against Railway's own
# reference Next.js Dockerfile (docs.railway.com/guides/nextjs), which does
# NOT address this gap.
FROM base AS web
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/package.json ./package.json
# `next start` re-transpiles/re-requires next.config.ts at runtime, not just
# at build time — confirmed by an actual container run during this module's
# build testing that failed with MODULE_NOT_FOUND on next.config.ts's
# relative import of ./src/lib/security/headers until src/ was copied here.
COPY --from=builder /app/src ./src
RUN chown -R nextjs:nodejs /app/.next
USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
# The local binary directly, not `npm run start` / `npx next start` — npm
# and npx do not reliably forward SIGTERM to the process they spawn when
# running as PID 1 in a container. Confirmed by an actual `docker stop` run
# during this module's build testing against the equivalent worker CMD
# (see below): the graceful-shutdown handler never ran, npm just reported
# "command failed / signal SIGTERM" and the process was killed outright.
# Invoking the binary directly makes it PID 1, so it receives the signal
# itself. See MODULE_3_REPORT.md.
CMD ["node_modules/.bin/next", "start"]

# ---- worker: full node_modules (tsx transpiles on the fly, no Next build
# step applies here) plus the raw source the worker imports from, including
# src/generated/prisma (gitignored in the repo — present here because the
# builder stage already ran `prisma generate`). ----
FROM base AS worker
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/worker ./worker
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/package.json ./package.json
USER nextjs
EXPOSE 8080
# The local binary directly, not `npx tsx` — see the `web` stage's CMD
# comment above for why (verified here first: `docker stop` sent SIGTERM,
# and worker/index.ts's own shutdown handler — which logs "received SIGTERM,
# shutting down gracefully..." — never ran; npm intercepted the signal and
# killed the child instead of letting it propagate).
CMD ["node_modules/.bin/tsx", "worker/index.ts"]
# Docker builds the LAST stage in the file when no --target is given — this
# is what Railway's `web` service actually relies on, not an explicit
# selection (see the file header). Keep this as the last stage.
FROM web AS final
