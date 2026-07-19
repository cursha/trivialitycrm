// Thin bootstrap, kept deliberately separate from main.ts. `next start`
// loads `.env` automatically; running the worker directly via `tsx` does
// not, so it must be done explicitly — same reasoning and same pattern as
// prisma.config.ts. This has to happen in its own module, before main.ts
// (and everything it imports, including src/lib/logger.ts, which reads
// NODE_ENV/LOG_LEVEL at module-load time) is ever evaluated: static
// `import` side effects always run before any of this file's own top-level
// code, so loading .env here and then *statically* importing "./main"
// wouldn't work — main's imports would already have run against an empty
// process.env by the time control reached this file's own statements. The
// dynamic import() below defers loading main.ts until after .env has been
// loaded, which is the whole point of this file existing.
try {
  process.loadEnvFile();
} catch {
  // No .env file present (e.g. Railway/Docker, where real env vars are
  // already in process.env before this process even starts) — nothing to
  // do.
}

import("./main");
