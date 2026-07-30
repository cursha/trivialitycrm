import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { LookupTable } from "@/components/lookup-table";
import { AddLookupForm } from "@/components/add-lookup-form";
import { createCampaignInstructionTemplate, renameCampaignInstructionTemplate, setCampaignInstructionTemplateActive, moveCampaignInstructionTemplate, deleteCampaignInstructionTemplate } from "./actions";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Reusable Campaign Instructions — Triviality CRM" };

export default async function CampaignInstructionsPage() {
  const user = await requireUser();
  requirePermission(user, "manage_campaign_instructions");

  const templates = await prisma.campaignInstructionTemplate.findMany({ orderBy: { sortOrder: "asc" } });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Reusable Campaign Instructions"
        description="House-wide AI personalization guidance a campaign creator can apply instead of (or alongside) their own instructions. An instruction set already used by a campaign can be deactivated but not deleted."
      />

      <LookupTable
        items={templates}
        rename={renameCampaignInstructionTemplate}
        setActive={setCampaignInstructionTemplateActive}
        move={moveCampaignInstructionTemplate}
        remove={deleteCampaignInstructionTemplate}
        extraColumn={{
          label: "Instructions",
          cells: Object.fromEntries(
            templates.map((t) => [
              t.id,
              <Link key={t.id} href={`/settings/campaign-instructions/${t.id}`} className="text-xs font-semibold text-secondary hover:underline">
                {t.instructions ? "Edit" : "Write instructions"}
              </Link>,
            ]),
          ),
        }}
      />

      <AddLookupForm create={createCampaignInstructionTemplate} placeholder="New instruction set name" />
    </div>
  );
}
