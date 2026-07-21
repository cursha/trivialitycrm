import crypto from "node:crypto";
import { getEnv } from "@/lib/env";

// Deliberately no `import "server-only"` — the worker (send/sequence job
// handlers) needs to decrypt OAuth tokens too, and that guard throws under
// plain Node/tsx execution (the Module Five lesson: Vitest mocks the guard
// out, so the test suite alone won't catch this, only actually running
// `npm run worker` does). Every consumer of this module is itself a
// server-only context — Server Actions/routes in the web process, or the
// worker process — same reasoning as src/lib/prisma.ts's identical
// omission.

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12; // 96-bit IV is the GCM-recommended size — a longer IV buys no extra security here and just wastes bytes.
const KEY_LENGTH_BYTES = 32; // AES-256

function loadKey(): Buffer {
  const { TOKEN_ENCRYPTION_KEY } = getEnv();
  if (!TOKEN_ENCRYPTION_KEY) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY is not configured — cannot encrypt or decrypt provider tokens. Set it before connecting any mailbox.",
    );
  }
  const key = Buffer.from(TOKEN_ENCRYPTION_KEY, "base64");
  if (key.length !== KEY_LENGTH_BYTES) {
    throw new Error(`TOKEN_ENCRYPTION_KEY must decode to exactly ${KEY_LENGTH_BYTES} bytes (got ${key.length}) — expected a base64-encoded 256-bit key.`);
  }
  return key;
}

/**
 * Encrypts a plaintext token (an OAuth access/refresh token) for storage in
 * ProviderConnection.encryptedAccessToken/encryptedRefreshToken. Returns a
 * single string encoding IV + GCM auth tag + ciphertext together (each
 * base64, dot-separated) — nothing else needs to be stored alongside it to
 * decrypt later. Never logged, never returned to the browser — see
 * src/lib/comms/README or the ProviderConnection model's doc comment for
 * the "never expose secrets to the browser" rule this supports.
 */
export function encryptToken(plaintext: string): string {
  const key = loadKey();
  const iv = crypto.randomBytes(IV_LENGTH_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(".");
}

/**
 * Reverses encryptToken(). Throws if the ciphertext is malformed or the
 * GCM auth tag doesn't verify (tampered or encrypted under a different
 * key) — a caller must treat any thrown error as "this token cannot be
 * trusted," not attempt a partial/best-effort decrypt.
 */
export function decryptToken(encoded: string): string {
  const key = loadKey();
  const parts = encoded.split(".");
  if (parts.length !== 3) {
    throw new Error("Malformed encrypted token — expected iv.authTag.ciphertext.");
  }
  const [ivB64, authTagB64, ciphertextB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const ciphertext = Buffer.from(ciphertextB64, "base64");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}
