import "server-only";
import packageJson from "../../package.json";

/**
 * The release version (package.json "version", bumped on every merge to
 * main — see the release steps in AGENTS.md and CHANGELOG.md). Read
 * server-side only and passed down as a plain string, so client components
 * never bundle package.json itself.
 */
export const APP_VERSION: string = packageJson.version;

/** Short commit SHA of the running deploy, when Railway provides it. */
export function getBuildId(): string | null {
  return process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 8) ?? null;
}
