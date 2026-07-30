import Link from "next/link";
import { CirclePlus } from "lucide-react";
import { requireUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { listSalesLists } from "@/lib/sales-lists/queries";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata = { title: "Sales Lists — Triviality CRM" };

const PURPOSE_LABEL: Record<string, string> = {
  CALLING: "Calling List",
  EMAIL_CAMPAIGN: "Email Campaign",
  GENERAL_SALES: "General Sales List",
};

const VISIBILITY_LABEL: Record<string, string> = {
  PRIVATE: "Private",
  SHARED_USERS: "Shared (selected users)",
  SHARED_TEAM: "Shared (team)",
};

function toSingle(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SalesListsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const active = toSingle(params.status) !== "archived";

  const lists = await listSalesLists(user, { active, q: toSingle(params.q) });
  const canCreate = hasPermission(user, "create_sales_lists");

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="Sales Lists"
        description="Calling lists, email campaigns, and general sales lists you own or that have been shared with you."
        actions={
          canCreate ? (
            <Link
              href="/sales-lists/new"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-white hover:bg-primary-hover"
            >
              <CirclePlus size={17} />
              New list
            </Link>
          ) : undefined
        }
      />

      <div className="flex gap-2 text-sm font-semibold">
        <Link href="/sales-lists" className={!params.status ? "text-secondary underline" : "text-text-muted"}>
          Active
        </Link>
        <Link href="/sales-lists?status=archived" className={params.status === "archived" ? "text-secondary underline" : "text-text-muted"}>
          Archived
        </Link>
      </div>

      {lists.length === 0 ? (
        <Card>
          <EmptyState>No sales lists yet{canCreate ? " — build one to get started." : "."}</EmptyState>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-left text-sm">
              <thead className="bg-black/5 text-xs uppercase text-text-muted">
                <tr>
                  <th className="px-5 py-3">Name</th>
                  <th className="px-5 py-3">Purpose</th>
                  <th className="px-5 py-3">Type</th>
                  <th className="px-5 py-3">Visibility</th>
                  <th className="px-5 py-3">Owner</th>
                  <th className="px-5 py-3">Companies</th>
                  <th className="px-5 py-3">Updated</th>
                </tr>
              </thead>
              <tbody>
                {lists.map((list) => (
                  <tr key={list.id} className="border-t border-border hover:bg-black/5">
                    <td className="px-5 py-4">
                      <Link href={`/sales-lists/${list.id}`} className="font-bold text-secondary hover:underline">
                        {list.name}
                      </Link>
                      {list.description && <div className="text-xs text-text-muted">{list.description}</div>}
                    </td>
                    <td className="px-5 py-4">
                      <Badge tone="secondary">{PURPOSE_LABEL[list.purpose]}</Badge>
                    </td>
                    <td className="px-5 py-4">{list.type === "FIXED" ? "Fixed" : "Dynamic"}</td>
                    <td className="px-5 py-4">{VISIBILITY_LABEL[list.visibility]}</td>
                    <td className="px-5 py-4">{list.owner.name}</td>
                    <td className="px-5 py-4">{list.type === "FIXED" ? list._count.members : "—"}</td>
                    <td className="px-5 py-4">{new Date(list.updatedAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="divide-y divide-border md:hidden">
            {lists.map((list) => (
              <li key={list.id} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <Link href={`/sales-lists/${list.id}`} className="font-bold text-secondary hover:underline">
                      {list.name}
                    </Link>
                    {list.description && <p className="text-xs text-text-muted">{list.description}</p>}
                  </div>
                  <Badge tone="secondary">{PURPOSE_LABEL[list.purpose]}</Badge>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                  <div>
                    <dt className="text-text-muted">Type</dt>
                    <dd className="font-medium text-text">{list.type === "FIXED" ? "Fixed" : "Dynamic"}</dd>
                  </div>
                  <div>
                    <dt className="text-text-muted">Visibility</dt>
                    <dd className="font-medium text-text">{VISIBILITY_LABEL[list.visibility]}</dd>
                  </div>
                  <div>
                    <dt className="text-text-muted">Owner</dt>
                    <dd className="font-medium text-text">{list.owner.name}</dd>
                  </div>
                  <div>
                    <dt className="text-text-muted">Companies</dt>
                    <dd className="font-medium text-text">{list.type === "FIXED" ? list._count.members : "—"}</dd>
                  </div>
                </dl>
                <p className="mt-2 text-xs text-text-muted">Updated {new Date(list.updatedAt).toLocaleDateString()}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
