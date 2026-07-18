"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { isLockedOut, recordFailedLogin, recordSuccessfulLogin } from "@/lib/auth/rate-limit";
import { LoginSchema } from "@/lib/validation/auth";
import { formString } from "@/lib/form-data";

export type LoginState = { error?: string } | undefined;

const GENERIC_ERROR = "Invalid email or password.";

export async function login(_prevState: LoginState, formData: FormData): Promise<LoginState> {
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
