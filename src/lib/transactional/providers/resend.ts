// Real provider — confirmed against the installed resend@6.18.0 SDK's own
// type definitions (node_modules/resend/dist/index.d.mts), not assumed:
// `resend.emails.send(payload, {idempotencyKey})` sends the key as a real
// `Idempotency-Key` header (provider-side dedup, on top of this app's own
// TransactionalEmailMessage.idempotencyKey unique constraint and the
// worker queue's singletonKey — three independent layers). The SDK does
// NOT throw on an API-level rejection; it returns a `{data, error}`
// discriminated union, so failures are surfaced via ResendApiError below
// rather than a caught exception, and classifyProviderError()
// (src/lib/integrations/provider-errors.ts) is taught to recognize it.
import { Resend } from "resend";
import { callEmailProvider } from "../../comms/providers/http";
import { getEnv } from "../../env";
import type { TransactionalEmailProvider, TransactionalSendInput, TransactionalSendResult } from "../provider";

/** Carries Resend's own error code (RESEND_ERROR_CODE_KEY) so
 * classifyProviderError() can map it to a safe category without needing to
 * import the Resend SDK itself. */
export class ResendApiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ResendApiError";
    this.code = code;
  }
}

function client(): Resend {
  const apiKey = getEnv().RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not set — required to use the Resend transactional provider.");
  }
  return new Resend(apiKey);
}

export class ResendTransactionalProvider implements TransactionalEmailProvider {
  async send(input: TransactionalSendInput): Promise<TransactionalSendResult> {
    const env = getEnv();
    const from = env.RESEND_FROM_ADDRESS;
    if (!from) {
      throw new Error("RESEND_FROM_ADDRESS is not set — required to use the Resend transactional provider.");
    }

    // callEmailProvider (src/lib/comms/providers/http.ts) — reused as-is,
    // not duplicated, under its own bucket namespace ("transactional-email")
    // so this never shares a rate-limit budget with Module Six's per-
    // mailbox CRM-outreach sends.
    return callEmailProvider({ providerName: "resend", bucketPrefix: "transactional-email", timeoutMs: 30_000 }, async () => {
      const result = await client().emails.send(
        { from, to: input.toAddress, subject: input.subject, text: input.bodyText, html: input.bodyHtml },
        { idempotencyKey: input.idempotencyKey },
      );

      if (result.error) {
        throw new ResendApiError(result.error.name, result.error.message);
      }
      return { providerMessageId: result.data.id };
    });
  }
}
