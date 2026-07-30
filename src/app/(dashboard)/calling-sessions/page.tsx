import Link from "next/link";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { getActiveSessionForUser } from "@/lib/calling/queries";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata = { title: "Calling Sessions — Triviality CRM" };

export default async function CallingSessionsIndexPage() {
  const user = await requireUser();
  requirePermission(user, "use_calling_lists");

  const active = await getActiveSessionForUser(user.id);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Calling Sessions" description="Your in-progress guided calling session, if any — closing the browser never loses your place." />

      {active ? (
        <Card className="flex items-center justify-between gap-3">
          <div>
            <p className="font-bold text-text">{active.list.name}</p>
            <p className="text-sm text-text-muted">{active.status === "PAUSED" ? "Paused" : "In progress"}</p>
          </div>
          <Link href={`/calling-sessions/${active.id}`} className="rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-white hover:bg-primary-hover">
            Continue
          </Link>
        </Card>
      ) : (
        <Card>
          <EmptyState>
            No calling session in progress. Start one from a Calling List&rsquo;s page — see{" "}
            <Link href="/sales-lists" className="text-secondary hover:underline">
              Sales Lists
            </Link>
            .
          </EmptyState>
        </Card>
      )}
    </div>
  );
}
