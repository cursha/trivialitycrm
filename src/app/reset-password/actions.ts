"use server";

import { redirect } from "next/navigation";
import { completePasswordReset } from "@/lib/auth/password-reset";
import { CompletePasswordResetSchema } from "@/lib/validation/auth";
import { formString } from "@/lib/form-data";
import { getClientIp } from "@/lib/rate-limit/client-ip";
import { checkRateLimit } from "@/lib/rate-limit/postgres-bucket";

export type ResetPasswordState = { error?: string } | undefined;

const IP_WINDOW_MS = 5 * 60 * 1000;
const IP_MAX_ATTEMPTS = 10;

export async function submitPasswordReset(_prevState: ResetPasswordState, formData: FormData): Promise<ResetPasswordState> {
  const clientIp = await getClientIp();
  if (clientIp) {
    const result = await checkRateLimit(`reset-password:ip:${clientIp}`, { windowMs: IP_WINDOW_MS, limit: IP_MAX_ATTEMPTS });
    if (!result.allowed) {
      return { error: "Too many attempts from this network. Please wait a few minutes and try again." };
    }
  }

  const parsed = CompletePasswordResetSchema.safeParse({
    token: formString(formData, "token"),
    newPassword: formString(formData, "newPassword"),
    confirmPassword: formString(formData, "confirmPassword"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please correct the highlighted fields." };
  }

  const result = await completePasswordReset(parsed.data.token, parsed.data.newPassword);
  if (!result.ok) {
    return { error: result.error };
  }

  redirect("/login");
}
