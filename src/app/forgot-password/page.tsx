import { ForgotPasswordForm } from "./forgot-password-form";
import { Logo } from "@/components/ui/logo";
import { Card } from "@/components/ui/card";

export const metadata = { title: "Forgot password — Triviality CRM" };

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-surface px-4">
      <Logo size="full" className="h-48 sm:h-56" priority />
      <Card className="w-full max-w-sm">
        <h1 className="text-2xl font-black text-accent">Forgot password</h1>
        <p className="mt-1 text-sm text-text-muted">Enter your account email. There is no automated email delivery — an administrator will relay a reset link to you directly.</p>
        <ForgotPasswordForm />
      </Card>
    </main>
  );
}
