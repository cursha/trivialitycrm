// No `import "server-only"` — reused by the worker's send-job handler as
// well as web Server Actions; see token-crypto.ts for the same reasoning.

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HEADER_INJECTION_PATTERN = /[\r\n]/;

/**
 * Rejects the classic email-header-injection vector (an embedded CR/LF that
 * lets an attacker smuggle extra headers or recipients into a message) and
 * confirms a plausible email shape. Called on every to/cc/bcc address and
 * on the subject line, before any of it ever reaches a provider call —
 * this is a hard validation gate, not a UI nicety.
 */
export function validateEmailAddress(address: string): { valid: true } | { valid: false; reason: string } {
  if (HEADER_INJECTION_PATTERN.test(address)) {
    return { valid: false, reason: "Email address must not contain line breaks." };
  }
  if (!EMAIL_PATTERN.test(address.trim())) {
    return { valid: false, reason: `"${address}" is not a valid email address.` };
  }
  return { valid: true };
}

export function validateSubject(subject: string): { valid: true } | { valid: false; reason: string } {
  if (HEADER_INJECTION_PATTERN.test(subject)) {
    return { valid: false, reason: "Subject must not contain line breaks." };
  }
  if (subject.trim().length === 0) {
    return { valid: false, reason: "Enter a subject." };
  }
  return { valid: true };
}

export type RecipientValidationResult = { valid: true } | { valid: false; errors: string[] };

/**
 * Validates a full recipient set (to/cc/bcc) + subject in one pass —
 * the single call site the composer, the scheduled-send worker job, and
 * any future sequence-step/bulk sender all share, so recipient validation
 * can never be accidentally skipped by one of those paths.
 */
export function validateOutgoingEmail(input: { to: string[]; cc?: string[]; bcc?: string[]; subject: string }): RecipientValidationResult {
  const errors: string[] = [];

  if (input.to.length === 0) {
    errors.push("At least one recipient is required.");
  }
  for (const address of [...input.to, ...(input.cc ?? []), ...(input.bcc ?? [])]) {
    const result = validateEmailAddress(address);
    if (!result.valid) errors.push(result.reason);
  }
  const subjectResult = validateSubject(input.subject);
  if (!subjectResult.valid) errors.push(subjectResult.reason);

  return errors.length > 0 ? { valid: false, errors } : { valid: true };
}
