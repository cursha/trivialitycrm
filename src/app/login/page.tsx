import { LoginForm } from "./login-form";
import { Logo } from "@/components/ui/logo";
import { Card } from "@/components/ui/card";

export const metadata = { title: "Sign in — Triviality CRM" };

export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-surface px-4">
      <Logo size="full" className="h-48 sm:h-56" priority />
      <Card className="w-full max-w-sm">
        <h1 className="text-2xl font-black text-accent">Sign in</h1>
        <p className="mt-1 text-sm text-text-muted">Access is by invitation only.</p>
        <LoginForm />
      </Card>
    </main>
  );
}
