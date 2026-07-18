import { requireUser } from "@/lib/auth/current-user";
import { ChangePasswordForm } from "./change-password-form";

export const metadata = { title: "Change password — Triviality CRM" };

export default async function ChangePasswordPage() {
  const user = await requireUser();

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f5f7fb] px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-black text-slate-900">Set a new password</h1>
        <p className="mt-1 text-sm text-slate-500">
          {user.mustChangePassword
            ? "An administrator created this account — choose a new password before continuing."
            : "Update the password for your account."}
        </p>
        <ChangePasswordForm />
      </div>
    </main>
  );
}
