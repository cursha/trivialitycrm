// Runs once when a new web server instance starts. Config is validated
// eagerly so a bad deployment fails fast at boot rather than on first use.
//
// Module Three note: this used to also sweep LeadSearch rows stuck RUNNING
// after a restart, back when run-search.ts executed inline in this same
// process (see git history / MODULE_2_REPORT.md). That's no longer
// meaningful here — job execution moved entirely to the worker (see
// worker/index.ts), which is a separate, independently-restarting process.
// A web-boot sweep checking LeadSearch.heartbeatAt would now race a
// legitimate in-progress pg-boss retry in the worker and could mark a
// search FAILED while it's still safely resuming. Stale/abandoned job
// recovery is pg-boss's job now (bounded retries + expireInSeconds), not
// this hook's.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { getEnv } = await import("@/lib/env");
  getEnv();

  const { logger } = await import("@/lib/logger");
  logger.info("web server started.");
}
