"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { verifyPassword, hashPassword } from "@/lib/auth/password";
import { invalidateAllSessionsForUser, createSession } from "@/lib/auth/session";
import { ChangePasswordSchema } from "@/lib/validation/auth";
import { formString } from "@/lib/form-data";

export type ChangePasswordState = { error?: string } | undefined;

export async function changePassword(
  _prevState: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const user = await requireUser();

  const parsed = ChangePasswordSchema.safeParse({
    currentPassword: formString(formData, "currentPassword"),
    newPassword: formString(formData, "newPassword"),
    confirmPassword: formString(formData, "confirmPassword"),
  });

  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return { error: firstIssue?.message ?? "Please correct the highlighted fields." };
  }

  const { currentPassword, newPassword } = parsed.data;

  const currentValid = await verifyPassword(currentPassword, user.passwordHash);
  if (!currentValid) {
    return { error: "Current password is incorrect." };
  }

  const newHash = await hashPassword(newPassword);

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: newHash, mustChangePassword: false },
  });

  // A changed password shouldn't leave other open sessions valid — clear
  // all of them (including this one) and issue a fresh session.
  await invalidateAllSessionsForUser(user.id);
  await createSession(user.id);

  redirect("/dashboard");
}
