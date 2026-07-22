import Link from "next/link";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission, hasPermission } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/ui/page-header";
import { Card, SectionHeading } from "@/components/ui/card";
import { getDataQualityCounts } from "./queries";

export const metadata = { title: "Data Quality — Triviality CRM" };

function StatCard({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <Link href={href} className="block rounded-2xl border border-border-strong bg-surface-raised p-4 shadow-sm transition-colors hover:border-focus">
      <p className="text-3xl font-black text-accent">{value}</p>
      <p className="mt-1 text-sm font-semibold text-text-muted">{label}</p>
    </Link>
  );
}

export default async function DataQualityPage() {
  const user = await requireUser();
  requirePermission(user, "view_data_quality");

  const counts = await getDataQualityCounts();
  const canScan = hasPermission(user, "run_duplicate_scan");

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Data Quality"
        description="Find duplicate or incomplete records, review them safely, and merge without losing history. Counts reflect the most recent completed scan, not a live query."
        actions={
          canScan ? (
            <Link
              href="/data-quality/scans"
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary-hover"
            >
              Run a scan
            </Link>
          ) : undefined
        }
      />

      <Card>
        <p className="text-sm text-text-muted">
          {counts.lastScanAt ? (
            <>Last scan completed {counts.lastScanAt.toLocaleString()}.</>
          ) : (
            <>No scan has completed yet — run one to populate these counts.</>
          )}
        </p>
      </Card>

      <div>
        <SectionHeading>Possible duplicates</SectionHeading>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          <StatCard label="Possible duplicate companies" value={counts.duplicateCompanies} href="/data-quality/duplicates?entityType=COMPANY" />
          <StatCard label="Possible duplicate contacts" value={counts.duplicateContacts} href="/data-quality/duplicates?entityType=CONTACT" />
        </div>
      </div>

      <div>
        <SectionHeading>Missing information</SectionHeading>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          <StatCard label="Companies missing address" value={counts.missingCompanyAddress} href="/data-quality/issues?entityType=COMPANY&field=address1" />
          <StatCard label="Companies missing phone" value={counts.missingCompanyPhone} href="/data-quality/issues?entityType=COMPANY&field=phone" />
          <StatCard label="Companies missing email" value={counts.missingCompanyEmail} href="/data-quality/issues?entityType=COMPANY&field=email" />
          <StatCard label="Companies missing URL" value={counts.missingCompanyUrl} href="/data-quality/issues?entityType=COMPANY&field=websiteUrl" />
          <StatCard label="Contacts missing phone" value={counts.missingContactPhone} href="/data-quality/issues?entityType=CONTACT&field=phone" />
          <StatCard label="Contacts missing email" value={counts.missingContactEmail} href="/data-quality/issues?entityType=CONTACT&field=email" />
        </div>
      </div>

      <div>
        <SectionHeading>Invalid or suspicious values</SectionHeading>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          <StatCard label="Invalid or suspicious emails" value={counts.invalidEmail} href="/data-quality/issues?ruleType=INVALID_EMAIL_FORMAT" />
          <StatCard label="Invalid or suspicious phones" value={counts.invalidPhone} href="/data-quality/issues?ruleType=INVALID_PHONE_FORMAT" />
          <StatCard label="Invalid or suspicious URLs" value={counts.invalidUrl} href="/data-quality/issues?ruleType=INVALID_URL_FORMAT" />
        </div>
      </div>

      <div>
        <SectionHeading>Review status</SectionHeading>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          <StatCard label="Records requiring manual review" value={counts.openIssues} href="/data-quality/issues" />
          <StatCard label="Recently resolved (7 days)" value={counts.recentlyResolved} href="/data-quality/issues?status=RESOLVED" />
        </div>
      </div>
    </div>
  );
}
