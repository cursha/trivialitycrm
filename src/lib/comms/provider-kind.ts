import type { ProviderKind } from "@/generated/prisma/enums";

// No `import "server-only"` — trivial pure mapping, safe and useful from
// either process; see token-crypto.ts for the general reasoning.

/** The providers a user can actually connect — "mock" (ProviderName's
 * fourth value) is never a connectable slug. Microsoft/Google connect via
 * the OAuth redirect flow (/api/comms/oauth/[provider]); Titan connects
 * via a plain email+password form (see PASSWORD_BASED_PROVIDERS below) —
 * both land on the same ProviderConnection row shape either way. */
export const CONNECTABLE_PROVIDERS = ["microsoft", "google", "titan"] as const;
export type ConnectableProvider = (typeof CONNECTABLE_PROVIDERS)[number];

export function isConnectableProvider(value: string): value is ConnectableProvider {
  return (CONNECTABLE_PROVIDERS as readonly string[]).includes(value);
}

/** Connected via a plain email+password form (settings/email-connections'
 * TitanConnectForm), never the OAuth redirect routes — those routes reject
 * a password-based provider slug outright (see authorize/route.ts). */
export const PASSWORD_BASED_PROVIDERS = ["titan"] as const;

export function isPasswordBasedProvider(value: ConnectableProvider): boolean {
  return (PASSWORD_BASED_PROVIDERS as readonly string[]).includes(value);
}

const SLUG_TO_KIND: Record<ConnectableProvider, ProviderKind> = {
  microsoft: "MICROSOFT",
  google: "GOOGLE",
  titan: "TITAN",
};

const KIND_TO_SLUG: Record<ProviderKind, ConnectableProvider> = {
  MICROSOFT: "microsoft",
  GOOGLE: "google",
  TITAN: "titan",
};

export function providerKindFromSlug(slug: ConnectableProvider): ProviderKind {
  return SLUG_TO_KIND[slug];
}

export function providerSlugFromKind(kind: ProviderKind): ConnectableProvider {
  return KIND_TO_SLUG[kind];
}

export const PROVIDER_DISPLAY_NAMES: Record<ConnectableProvider, string> = {
  microsoft: "Microsoft 365 / Outlook",
  google: "Google Workspace / Gmail",
  titan: "Titan Email",
};
