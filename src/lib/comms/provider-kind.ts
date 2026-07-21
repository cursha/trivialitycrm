import type { ProviderKind } from "@/generated/prisma/enums";

// No `import "server-only"` — trivial pure mapping, safe and useful from
// either process; see token-crypto.ts for the general reasoning.

/** The providers a user can actually OAuth-connect to via the URL —
 * "mock" (ProviderName's third value) is never a connectable URL slug. */
export const CONNECTABLE_PROVIDERS = ["microsoft", "google"] as const;
export type ConnectableProvider = (typeof CONNECTABLE_PROVIDERS)[number];

export function isConnectableProvider(value: string): value is ConnectableProvider {
  return (CONNECTABLE_PROVIDERS as readonly string[]).includes(value);
}

export function providerKindFromSlug(slug: ConnectableProvider): ProviderKind {
  return slug === "microsoft" ? "MICROSOFT" : "GOOGLE";
}

export function providerSlugFromKind(kind: ProviderKind): ConnectableProvider {
  return kind === "MICROSOFT" ? "microsoft" : "google";
}

export const PROVIDER_DISPLAY_NAMES: Record<ConnectableProvider, string> = {
  microsoft: "Microsoft 365 / Outlook",
  google: "Google Workspace / Gmail",
};
