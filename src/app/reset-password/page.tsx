import Link from "next/link";
import { ResetPasswordForm } from "./reset-password-form";
import { Logo } from "@/components/ui/logo";
import { Card } from "@/components/ui/card";

export const metadata = { title: "Reset password — Triviality CRM" };

function toSingle(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const token = toSingle(params.token);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-surface px-4">
      <Logo size="full" className="h-48 sm:h-56" priority />
      <Card className="w-full max-w-sm">
        <h1 className="text-2xl font-black text-accent">Reset password</h1>
        {token ? (
          <>
            <p className="mt-1 text-sm text-text-muted">Choose a new password for your account.</p>
            <ResetPasswordForm token={token} />
          </>
        ) : (
          <>
            <p className="mt-1 text-sm text-text-muted">This link is missing its reset token. Ask an administrator for a new one.</p>
            <Link href="/login" className="mt-4 block text-sm font-semibold text-secondary hover:underline">
              Back to sign in
            </Link>
          </>
        )}
      </Card>
    </main>
  );
}
