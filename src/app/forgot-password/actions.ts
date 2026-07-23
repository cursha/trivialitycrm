"use server";

import { requestPasswordReset } from "@/lib/auth/password-reset";
import { ForgotPasswordSchema } from "@/lib/validation/auth";
import { formString } from "@/lib/form-data";
import { getClientIp } from "@/lib/rate-limit/client-ip";
import { checkRateLimit } from "@/lib/rate-limit/postgres-bucket";

export type ForgotPasswordState = { submitted: true } | { error: string } | undefined;

const IP_WINDOW_MS = 5 * 60 * 1000;
const IP_MAX_ATTEMPTS = 10;

export async function submitForgotPassword(_prevState: ForgotPasswordState, formData: FormData): Promise<ForgotPasswordState> {
  const clientIp = await getClientIp();
  if (clientIp) {
    const result = await checkRateLimit(`forgot-password:ip:${clientIp}`, { windowMs: IP_WINDOW_MS, limit: IP_MAX_ATTEMPTS });
    if (!result.allowed) {
      return { error: "Too many requests from this network. Please wait a few minutes and try again." };
    }
  }

  const parsed = ForgotPasswordSchema.safeParse({ email: formString(formData, "email") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Enter a valid email." };
  }

  await requestPasswordReset(parsed.data.email);

  return { submitted: true };
}
