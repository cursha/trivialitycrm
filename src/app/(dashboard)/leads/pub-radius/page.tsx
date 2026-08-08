import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { PubRadiusForm } from "./pub-radius-form";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Pub Lead Finder — Triviality CRM" };

export default async function PubRadiusPage() {
  const user = await requireUser();
  requirePermission(user, "run_pub_lead_finder");

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title="Pub Lead Finder" description="Find pub-like venues within a radius of an existing pub already in the CRM." />
      <PubRadiusForm />
    </div>
  );
}
