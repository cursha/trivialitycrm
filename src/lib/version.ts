/**
 * The release version, shown at the foot of the sidebar and on
 * Administration → System Health. Format `v{release}.{version}` — bumped
 * once per push to main; see "Every release gets a version number" in
 * AGENTS.md and CHANGELOG.md. This constant is the single source of truth
 * (package.json's "version" is unused).
 */
export const APP_VERSION = "v8.2";

/** Short commit SHA of the running deploy, when Railway provides it. */
export function getBuildId(): string | null {
  return process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 8) ?? null;
}
