"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { isLockedOut, recordFailedLogin, recordSuccessfulLogin } from "@/lib/auth/rate-limit";
import { LoginSchema } from "@/lib/validation/auth";
import { formString } from "@/lib/form-data";
import { getClientIp } from "@/lib/rate-limit/client-ip";
import { checkRateLimit } from "@/lib/rate-limit/postgres-bucket";

export type LoginState = { error?: string } | undefined;

const GENERIC_ERROR = "Invalid email or password.";
const RATE_LIMIT_ERROR = "Too many login attempts from this network. Please wait a few minutes and try again.";

// Per-IP, on top of (not instead of) the existing per-account lockout in
// src/lib/auth/rate-limit.ts — that one only throttles repeated guesses
// against a single email; this closes the gap where an attacker spreads
// guesses across many different accounts from one source.
const IP_WINDOW_MS = 5 * 60 * 1000;
const IP_MAX_ATTEMPTS = 20;

export async function login(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const clientIp = await getClientIp();
  if (clientIp) {
    const result = await checkRateLimit(`login:ip:${clientIp}`, { windowMs: IP_WINDOW_MS, limit: IP_MAX_ATTEMPTS });
    if (!result.allowed) {
      return { error: RATE_LIMIT_ERROR };
    }
  }

  const parsed = LoginSchema.safeParse({
    email: formString(formData, "email"),
    password: formString(formData, "password"),
  });

  if (!parsed.success) {
    return { error: GENERIC_ERROR };
  }

  const { email, password } = parsed.data;
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user || user.disabled) {
    await verifyPassword(password, null);
    return { error: GENERIC_ERROR };
  }

  if (isLockedOut(user)) {
    // Still perform a comparably-timed comparison; don't count this attempt
    // toward the lockout counter — the account is already locked.
    await verifyPassword(password, user.passwordHash);
    return { error: GENERIC_ERROR };
  }

  const passwordValid = await verifyPassword(password, user.passwordHash);
  if (!passwordValid) {
    await recordFailedLogin(user.id);
    return { error: GENERIC_ERROR };
  }

  await recordSuccessfulLogin(user.id);
  await createSession(user.id);

  redirect(user.mustChangePassword ? "/change-password" : "/dashboard");
}
