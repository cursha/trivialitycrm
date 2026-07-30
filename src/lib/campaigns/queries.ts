// No `import "server-only"` — resolveCampaignRecipients is needed by
// run-step.ts, which the run-campaign-step/campaign-step-tick worker
// handlers need too; that guard throws under plain Node/tsx execution.
// Every consumer is itself a server-only context (web Server Actions/
// pages, or the worker process). Same reasoning as src/lib/prisma.ts's
// identical omission.
import { prisma } from "@/lib/prisma";
import { companyScope } from "@/lib/companies/scope";
import { evaluateCompanyEligibility } from "@/lib/sales-lists/eligibility";
import { salesListVisibilityWhere } from "@/lib/sales-lists/scope";
import type { AuthenticatedUser } from "@/lib/auth/current-user";
import type { Prisma } from "@/generated/prisma/client";

type ListLike = { id: string; type: "FIXED" | "DYNAMIC" };

export type ResolvedRecipient = {
  companyId: string;
  contactId: string | null;
  eligible: boolean;
  skipReason: string | null;
};

/** Every company on an EMAIL_CAMPAIGN-purpose list, resolved to its eligible
 * primary contact (or a skip reason) — used both at campaign creation (to
 * build the frozen CampaignRecipient snapshot) and by the List page's own
 * eligibility display, so the two can never disagree about who's eligible. */
export async function resolveCampaignRecipients(user: AuthenticatedUser, list: ListLike): Promise<ResolvedRecipient[]> {
  const scope = companyScope(user);
  if (!scope) return [];

  const membershipWhere: Prisma.CompanyWhereInput =
    list.type === "FIXED" ? { salesListMembers: { some: { listId: list.id } } } : { salesListDynamicMembers: { some: { listId: list.id } } };

  const companies = await prisma.company.findMany({
    where: { AND: [scope, membershipWhere] },
    include: { primaryContact: true },
  });

  const contactIds = companies.map((c) => c.primaryContact?.id).filter((id): id is string => !!id);
  const bounced = contactIds.length > 0 ? await prisma.emailMessage.findMany({ where: { contactId: { in: contactIds }, status: "BOUNCED" }, select: { contactId: true } }) : [];
  const bouncedContactIds = new Set(bounced.map((b) => b.contactId));

  return companies.map((company) => {
    const { eligible, reasons } = evaluateCompanyEligibility(
      {
        status: company.status,
        doNotContact: company.doNotContact,
        isExistingCustomer: company.isExistingCustomer,
        phone: company.phone,
        primaryContact: company.primaryContact
          ? {
              status: company.primaryContact.status,
              email: company.primaryContact.email,
              phone: company.primaryContact.phone,
              doNotContact: company.primaryContact.doNotContact,
              unsubscribedAt: company.primaryContact.unsubscribedAt,
            }
          : null,
        primaryContactHasPermanentBounce: company.primaryContact ? bouncedContactIds.has(company.primaryContact.id) : false,
      },
      "EMAIL_CAMPAIGN",
    );
    return {
      companyId: company.id,
      contactId: eligible ? company.primaryContact!.id : null,
      eligible,
      skipReason: eligible ? null : reasons.join("; "),
    };
  });
}

export async function getCampaignById(user: AuthenticatedUser, campaignId: string) {
  const listScope = salesListVisibilityWhere(user);
  if (!listScope) return null;
  return prisma.campaign.findFirst({
    where: { id: campaignId, list: listScope },
    include: {
      list: true,
      createdBy: true,
      sender: true,
      approvedBy: true,
      reusableInstructions: true,
      emailTemplate: true,
      steps: { orderBy: { stepOrder: "asc" } },
      recipients: {
        include: {
          company: true,
          contact: true,
          currentStep: true,
          snapshots: { orderBy: { stepId: "asc" } },
          stepRuns: { orderBy: { runAt: "asc" } },
        },
      },
      events: { orderBy: { occurredAt: "desc" }, include: { recipient: { include: { company: true } } } },
    },
  });
}

export async function listCampaigns(user: AuthenticatedUser) {
  const listScope = salesListVisibilityWhere(user);
  if (!listScope) return [];
  return prisma.campaign.findMany({
    where: { list: listScope },
    include: { list: true, createdBy: true, _count: { select: { recipients: true, steps: true } } },
    orderBy: { updatedAt: "desc" },
  });
}
