// No `import "server-only"` — same reasoning as logger.ts and env.ts.
import { logger } from "./logger";

/**
 * Error-reporting interface. Logs via the structured logger by default — no
 * paid monitoring dependency is required to use this app. If SENTRY_DSN is
 * set, lazily imports @sentry/node and forwards there too; that package is
 * NOT a project dependency (see package.json) — it's an explicit, optional
 * opt-in. If SENTRY_DSN is set but the package was never installed, this
 * logs a warning once and falls back to logging-only rather than crashing
 * the process over an observability integration.
 */

// @sentry/node is NOT a project dependency (see package.json) — this shape
// covers only the two calls this module makes, so no @types package or the
// real library is needed just to typecheck the optional integration.
type MinimalSentryModule = {
  init(options: { dsn?: string }): void;
  captureException(error: unknown, hint?: { extra?: Record<string, unknown> }): void;
};

let sentryModule: MinimalSentryModule | null | undefined;
let warnedMissingSentry = false;

async function loadSentry(): Promise<MinimalSentryModule | null> {
  if (sentryModule !== undefined) return sentryModule;

  try {
    // Dynamic, string-built specifier so bundlers (webpack/turbopack) don't
    // try to statically resolve an optional dependency that may not be
    // installed — a static `import("@sentry/node")` would fail the Next
    // build itself if the package is absent, not just at runtime.
    const specifier = "@sentry/node";
    const imported = (await import(/* webpackIgnore: true */ specifier)) as unknown as MinimalSentryModule;
    imported.init({ dsn: process.env.SENTRY_DSN });
    sentryModule = imported;
  } catch {
    if (!warnedMissingSentry) {
      logger.warn("SENTRY_DSN is set but the optional @sentry/node package is not installed — falling back to log-only error reporting.");
      warnedMissingSentry = true;
    }
    sentryModule = null;
  }

  return sentryModule;
}

export async function captureException(error: unknown, context?: Record<string, unknown>): Promise<void> {
  logger.error({ err: error, ...context }, error instanceof Error ? error.message : "Unhandled error");

  if (!process.env.SENTRY_DSN) return;

  const sentry = await loadSentry();
  sentry?.captureException(error, context ? { extra: context } : undefined);
}
