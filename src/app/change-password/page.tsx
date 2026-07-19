import { requireUser } from "@/lib/auth/current-user";
import { ChangePasswordForm } from "./change-password-form";
import { Logo } from "@/components/ui/logo";
import { Card } from "@/components/ui/card";

export const metadata = { title: "Change password — Triviality CRM" };

export default async function ChangePasswordPage() {
  const user = await requireUser({ allowMustChangePassword: true });

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-surface px-4">
      <Logo size="full" className="h-32" priority />
      <Card className="w-full max-w-sm">
        <h1 className="text-2xl font-black text-accent">Set a new password</h1>
        <p className="mt-1 text-sm text-text-muted">
          {user.mustChangePassword
            ? "An administrator created this account — choose a new password before continuing."
            : "Update the password for your account."}
        </p>
        <ChangePasswordForm />
      </Card>
    </main>
  );
}
