import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * The user manual, shown in-app at Administration → User Manual. The
 * Markdown files at the repo root stay the single source of truth; the
 * Dockerfile copies exactly these two into the web image (and
 * .dockerignore lets them through), since every other *.md is excluded
 * from the build.
 */
export const MANUALS = [
  { slug: "sales-quick-start", title: "Sales Quick Start", file: "SALES_QUICKSTART.md", audience: "For salespeople" },
  { slug: "admin-guide", title: "Admin Guide", file: "ADMIN_GUIDE.md", audience: "For administrators and managers" },
] as const;

export type ManualSlug = (typeof MANUALS)[number]["slug"];

export function findManual(slug: string | undefined) {
  return MANUALS.find((manual) => manual.slug === slug) ?? MANUALS[0];
}

/** The manual's Markdown, or null if the file is missing from this build. */
export async function readManual(file: (typeof MANUALS)[number]["file"]): Promise<string | null> {
  try {
    // turbopackIgnore: a runtime read of a file the Dockerfile copies in,
    // not something to bundle or trace.
    return await readFile(path.join(/*turbopackIgnore: true*/ process.cwd(), file), "utf8");
  } catch {
    return null;
  }
}
