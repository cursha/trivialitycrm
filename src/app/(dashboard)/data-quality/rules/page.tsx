import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/ui/page-header";
import { RuleManager } from "./rule-manager";

export const metadata = { title: "Data Quality Rules — Triviality CRM" };

export default async function DataQualityRulesPage() {
  const user = await requireUser();
  requirePermission(user, "manage_data_quality_rules");

  const rules = await prisma.dataQualityRule.findMany({
    orderBy: [{ entityType: "asc" }, { sortOrder: "asc" }],
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Data Quality Rules" description="Table-driven checks — enable, disable, reorder, or archive without touching code. Archived rules keep their history explainable rather than being deleted." />

      <RuleManager
        rules={rules.map((rule) => ({
          id: rule.id,
          name: rule.name,
          description: rule.description,
          entityType: rule.entityType,
          field: rule.field,
          ruleType: rule.ruleType,
          severity: rule.severity,
          enabled: rule.enabled,
          sortOrder: rule.sortOrder,
          config: (rule.config as Record<string, unknown>) ?? {},
          archivedAt: rule.archivedAt ? rule.archivedAt.toISOString() : null,
        }))}
      />
    </div>
  );
}
