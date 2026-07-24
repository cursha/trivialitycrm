import { getEnv } from "../env";
import { MockTransactionalProvider } from "./providers/mock";
import { ResendTransactionalProvider } from "./providers/resend";
import type { TransactionalEmailProvider } from "./provider";

/**
 * Selects the transactional-email provider. Same "test always forces mock"
 * rule as src/lib/comms/providers/factory.ts's getEmailProvider() — no
 * automated test may ever reach a real endpoint, regardless of what
 * EMAIL_PROVIDER happens to be set to.
 */
export function getTransactionalProvider(): TransactionalEmailProvider {
  if (process.env.NODE_ENV === "test") return new MockTransactionalProvider();

  const provider = getEnv().EMAIL_PROVIDER;
  switch (provider) {
    case "mock":
      return new MockTransactionalProvider();
    case "resend":
      return new ResendTransactionalProvider();
    default: {
      const exhaustive: never = provider;
      throw new Error(`Unknown EMAIL_PROVIDER: ${exhaustive}`);
    }
  }
}

/** Never returns the raw key — only whether one is configured. Mirrors
 * isAiApiKeyConfigured()'s (src/lib/ai/budget.ts) never-expose-the-value
 * discipline exactly. */
export function isTransactionalEmailConfigured(): boolean {
  const env = getEnv();
  return env.EMAIL_PROVIDER === "resend" && Boolean(env.RESEND_API_KEY) && Boolean(env.RESEND_FROM_ADDRESS);
}
