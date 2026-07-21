import crypto from "node:crypto";
import { getEnv } from "@/lib/env";

// No `import "server-only"` — token creation happens inside send-email.ts,
// which the Phase C scheduled-send/sequence-step worker handlers will call
// directly; same reasoning as token-crypto.ts.

// CAN-SPAM only requires an unsubscribe mechanism to keep working for 30
// days after a message is sent — 400 days is generous headroom for a
// contact who saves an old email, while still being a real, bounded expiry
// rather than a token that's valid forever.
const EXPIRY_MS = 400 * 24 * 60 * 60 * 1000;

function loadSecret(): string {
  const { UNSUBSCRIBE_TOKEN_SECRET } = getEnv();
  if (!UNSUBSCRIBE_TOKEN_SECRET) {
    throw new Error("UNSUBSCRIBE_TOKEN_SECRET is not configured — cannot create or verify unsubscribe links.");
  }
  return UNSUBSCRIBE_TOKEN_SECRET;
}

function sign(encodedPayload: string): string {
  return crypto.createHmac("sha256", loadSecret()).update(encodedPayload).digest("base64url");
}

/**
 * A self-verifying token — no DB lookup needed to confirm it hasn't been
 * tampered with or forged — for the one-click, no-login unsubscribe link
 * every outbound template must include (src/lib/comms/templates.ts's
 * mandatory `{{unsubscribeLink}}` placeholder). The payload (contact id +
 * expiry) isn't secret, so this signs rather than encrypts, unlike
 * token-crypto.ts's OAuth-token storage.
 */
export function createUnsubscribeToken(contactId: string): string {
  const payload = JSON.stringify({ contactId, exp: Date.now() + EXPIRY_MS });
  const encodedPayload = Buffer.from(payload, "utf8").toString("base64url");
  return `${encodedPayload}.${sign(encodedPayload)}`;
}

/**
 * Verifies signature and expiry, returning the contact id only if both
 * check out. A constant-time comparison prevents a timing attack from
 * narrowing down a valid signature byte-by-byte.
 */
export function verifyUnsubscribeToken(token: string): { contactId: string } | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encodedPayload, signature] = parts;

  const expectedSignature = sign(encodedPayload);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return null;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (
    typeof payload !== "object" ||
    payload === null ||
    typeof (payload as { contactId: unknown }).contactId !== "string" ||
    typeof (payload as { exp: unknown }).exp !== "number"
  ) {
    return null;
  }

  const { contactId, exp } = payload as { contactId: string; exp: number };
  if (Date.now() > exp) return null;

  return { contactId };
}
