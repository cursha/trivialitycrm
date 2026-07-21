import { unsubscribeByToken } from "@/lib/comms/consent";
import { getClientIp } from "@/lib/rate-limit/client-ip";
import { checkRateLimit } from "@/lib/rate-limit/postgres-bucket";
import { Logo } from "@/components/ui/logo";
import { Card } from "@/components/ui/card";

export const metadata = { title: "Unsubscribe — Triviality CRM" };

// No login required (CAN-SPAM: "no fees or extra steps" to opt out) — kept
// permissive on /unsubscribe by src/proxy.ts. Still rate-limited per IP:
// the token itself is unguessable (HMAC-signed), but this closes off
// pointless load from an automated re-fetch loop.
const WINDOW_MS = 60 * 1000;
const MAX_ATTEMPTS = 20;

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  const clientIp = await getClientIp();
  if (clientIp) {
    const result = await checkRateLimit(`unsubscribe:ip:${clientIp}`, { windowMs: WINDOW_MS, limit: MAX_ATTEMPTS });
    if (!result.allowed) {
      return (
        <Shell>
          <p className="text-sm text-danger">Too many requests from this network. Please wait a minute and try again.</p>
        </Shell>
      );
    }
  }

  if (!token) {
    return (
      <Shell>
        <p className="text-sm text-danger">This unsubscribe link is missing its token.</p>
      </Shell>
    );
  }

  const outcome = await unsubscribeByToken(token);

  return (
    <Shell>
      {outcome.ok ? (
        <p className="text-sm text-text">You&apos;ve been unsubscribed and will no longer receive email from us. Sorry to see you go.</p>
      ) : (
        <p className="text-sm text-danger">{outcome.error}</p>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-surface px-4">
      <Logo size="full" className="h-32 sm:h-40" priority />
      <Card className="w-full max-w-sm text-center">
        <h1 className="text-xl font-black text-accent">Unsubscribe</h1>
        <div className="mt-3">{children}</div>
      </Card>
    </main>
  );
}
