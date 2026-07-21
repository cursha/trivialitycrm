import type { EmailProvider, ProviderName } from "./types";
import { MockEmailProvider } from "./mock";
import { MicrosoftGraphProvider } from "./microsoft-graph";
import { GoogleProvider } from "./google";

// Deliberately no `import "server-only"` — the worker's send-job handler
// needs this; see token-crypto.ts for the same reasoning.

/**
 * Selects the email provider implementation. Unlike the AI research
 * provider (one global AI_PROVIDER env var), provider choice here is
 * per-connection (ProviderConnection.provider) — a user connects Microsoft
 * *or* Google, whichever their employer's tenant is. NODE_ENV=test always
 * wins regardless of the requested kind: the app and its automated tests
 * must never make a real OAuth/send call by accident — same guarantee
 * src/lib/research/providers/factory.ts gives the AI pipeline via
 * .env.test's AI_PROVIDER=mock, enforced here structurally instead of by
 * env var since there's no single provider-selecting env var to force.
 */
export function getEmailProvider(kind: ProviderName): EmailProvider {
  if (process.env.NODE_ENV === "test") {
    return new MockEmailProvider();
  }

  switch (kind) {
    case "mock":
      return new MockEmailProvider();
    case "microsoft":
      return new MicrosoftGraphProvider();
    case "google":
      return new GoogleProvider();
    default: {
      const exhaustive: never = kind;
      throw new Error(`Unknown email provider "${exhaustive}".`);
    }
  }
}
