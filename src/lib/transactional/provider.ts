// Provider-neutral interface for transactional/system email (Module Nine) —
// deliberately separate from src/lib/comms/providers/types.ts's
// EmailProvider (Module Six's per-user OAuth mailbox model for CRM
// outreach). A transactional send has no OAuth account, no calendar, no
// inbound sync, and no per-user connection — just "send this one message
// from the app itself."
//
// No `import "server-only"` — the worker's send-system-email job handler
// needs this too; same reasoning as every other provider module in this
// codebase (see src/lib/prisma.ts).
export type TransactionalSendInput = {
  toAddress: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  /** Passed through to the provider as its own idempotency mechanism where
   * supported (Resend accepts an Idempotency-Key header) — defense in depth
   * on top of the app's own idempotencyKey-unique TransactionalEmailMessage
   * row and the worker queue's singletonKey. */
  idempotencyKey: string;
};

export type TransactionalSendResult = { providerMessageId: string };

export interface TransactionalEmailProvider {
  send(input: TransactionalSendInput): Promise<TransactionalSendResult>;
}
