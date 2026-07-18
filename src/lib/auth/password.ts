import "server-only";
import bcrypt from "bcryptjs";

const BCRYPT_COST_FACTOR = 12;

// Computed once per server process, held only in memory. Used to keep
// comparison timing consistent when there is no real hash to compare
// against (unknown email, disabled account) — see verifyPassword below.
let dummyHashPromise: Promise<string> | undefined;
function getDummyHash(): Promise<string> {
  if (!dummyHashPromise) {
    dummyHashPromise = bcrypt.hash(crypto.randomUUID(), BCRYPT_COST_FACTOR);
  }
  return dummyHashPromise;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST_FACTOR);
}

/**
 * Verifies a password against a stored hash. Pass `null` when there is no
 * account/hash to check against (e.g. login with an unknown email) — this
 * still performs a comparably-timed comparison against a dummy hash so
 * login failure timing doesn't reveal whether the email exists.
 */
export async function verifyPassword(password: string, hash: string | null): Promise<boolean> {
  if (hash === null) {
    await bcrypt.compare(password, await getDummyHash());
    return false;
  }
  return bcrypt.compare(password, hash);
}
