// No `import "server-only"` — loaded by both the Next.js server (web) and
// worker/index.ts under plain tsx, same reasoning as src/lib/env.ts.
import pino from "pino";

/**
 * Structured JSON logging in production (what Railway's log aggregation
 * wants), pretty-printed in local dev. `redact` strips known-sensitive
 * fields from any logged object before it's serialized — never the values
 * themselves, the whole path is removed — so a stray `logger.info({ user })`
 * can't leak a password hash or session token hash into aggregated logs.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  redact: {
    paths: [
      "passwordHash",
      "*.passwordHash",
      "tokenHash",
      "*.tokenHash",
      "apiKey",
      "*.apiKey",
      "req.headers.cookie",
      "req.headers.authorization",
      "*.req.headers.cookie",
      "*.req.headers.authorization",
    ],
    remove: true,
  },
  transport:
    process.env.NODE_ENV !== "production"
      ? { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" } }
      : undefined,
});
