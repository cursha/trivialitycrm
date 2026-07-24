import crypto from "node:crypto";
import type { TransactionalEmailProvider, TransactionalSendInput, TransactionalSendResult } from "../provider";

/** Same idea as src/lib/comms/providers/mock.ts's SIMULATED_SEND_FAILURE_ADDRESS
 * — sending to this address deterministically simulates a provider-side
 * failure, the only way tests exercise sendSystemEmail()'s FAILED path
 * without a real provider ever failing. */
export const SIMULATED_TRANSACTIONAL_FAILURE_ADDRESS = "trigger-transactional-failure@example.test";

/** Deterministic, no network — used whenever EMAIL_PROVIDER !== "resend" or
 * NODE_ENV === "test" (see factory.ts), matching every other mock
 * provider's idiom in this codebase. */
export class MockTransactionalProvider implements TransactionalEmailProvider {
  async send(input: TransactionalSendInput): Promise<TransactionalSendResult> {
    if (input.toAddress === SIMULATED_TRANSACTIONAL_FAILURE_ADDRESS) {
      throw new Error("Simulated transactional send failure (mock provider).");
    }
    return { providerMessageId: `mock-transactional:${crypto.randomUUID()}` };
  }
}
