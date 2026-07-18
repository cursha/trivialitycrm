import Image from "next/image";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in — Triviality CRM" };

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f5f7fb] px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <Image
          src="/triviality-mayhem-logo.png"
          alt="Triviality Mayhem"
          width={142}
          height={80}
          className="h-[56px] w-auto object-contain"
          priority
        />
        <h1 className="mt-4 text-2xl font-black text-slate-900">Sign in</h1>
        <p className="mt-1 text-sm text-slate-500">Access is by invitation only.</p>
        <LoginForm />
      </div>
    </main>
  );
}
