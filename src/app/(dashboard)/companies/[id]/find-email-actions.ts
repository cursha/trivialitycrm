"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission, hasPermission } from "@/lib/auth/permissions";
import { companyScope } from "@/lib/companies/scope";
import { normalizeEmail } from "@/lib/duplicates/normalize";
import { writeAuditEvent } from "@/lib/audit/log";
import { checkRateLimit } from "@/lib/rate-limit/postgres-bucket";
import { checkAiBudget } from "@/lib/ai/budget";
import { findEmailOnWebsite } from "@/lib/research/website-email";
import { getEmailSearchProvider } from "@/lib/research/providers/factory";

export type FindCompanyEmailResult = { error: string } | { email: string } | { email: null; note: string; canSearchWeb: boolean };

async function companyWithoutEmail(companyId: string) {
  const user = await requireUser();
  requirePermission(user, "edit_leads");
  const scope = companyScope(user);
  const company = scope ? await prisma.company.findFirst({ where: { id: companyId, ...scope } }) : null;
  if (!company) return { ok: false, error: "You do not have access to this company." } as const;
  if (company.email) return { ok: false, error: "This company already has an email." } as const;
  return { ok: true, user, company } as const;
}

// Fills the company's email only while it's still empty, so an email typed
// in meanwhile is never overwritten. False when one was.
async function saveFoundEmail(companyId: string, userId: string, email: string, how: "website" | "web_search", sourceHost: string | null): Promise<boolean> {
  const { count } = await prisma.company.updateMany({
    where: { id: companyId, email: null },
    data: { email, normalizedEmail: normalizeEmail(email), updatedById: userId },
  });
  if (count === 0) return false;
  await writeAuditEvent({
    actorId: userId,
    module: "companies",
    action: "company.email_found",
    entityType: "Company",
    entityId: companyId,
    afterData: { email },
    metadata: { how, ...(sourceHost ? { sourceHost } : {}) },
  });
  revalidatePath(`/companies/${companyId}`);
  return true;
}

/**
 * Quick Sales Actions "Find email": reads the bar's own website (home page,
 * then its contact page) for a public email, the same free check as "Find
 * emails" on search results (see website-email.ts). No AI and no paid API.
 */
export async function findCompanyEmail(companyId: string): Promise<FindCompanyEmailResult> {
  const found = await companyWithoutEmail(companyId);
  if (!found.ok) return { error: found.error };
  const { user, company } = found;

  const rateLimit = await checkRateLimit(`find-emails:${user.id}`, { windowMs: 60_000, limit: 10 });
  if (!rateLimit.allowed) return { error: "Too many email lookups — wait a minute and try again." };

  const lookup = await findEmailOnWebsite(company.websiteUrl);
  if (lookup.email !== null) {
    if (!(await saveFoundEmail(company.id, user.id, lookup.email, "website", null))) return { error: "Someone added an email meanwhile — refresh the page." };
    return { email: lookup.email };
  }
  return { email: null, note: lookup.note, canSearchWeb: hasPermission(user, "run_research") };
}

/**
 * "Search the web" when the website didn't show an email: one short AI web
 * search for the bar's public email, about 8–10¢, charged to the AI budget
 * like any research. Only for people who can run research.
 */
export async function searchWebForCompanyEmail(companyId: string): Promise<FindCompanyEmailResult> {
  const found = await companyWithoutEmail(companyId);
  if (!found.ok) return { error: found.error };
  const { user, company } = found;
  requirePermission(user, "run_research");

  const budgetCheck = await checkAiBudget();
  if (!budgetCheck.allowed) return { error: budgetCheck.reason ?? "The AI budget limit has been reached." };

  const rateLimit = await checkRateLimit(`web-search-emails:${user.id}`, { windowMs: 60_000, limit: 3 });
  if (!rateLimit.allowed) return { error: "Too many email searches — wait a minute and try again." };

  let result: { email: string | null; sourceUrl: string | null };
  try {
    result = await getEmailSearchProvider().findEmail(
      { name: company.name, city: company.city, region: company.region, country: company.country, phone: company.phone, websiteUrl: company.websiteUrl },
      { userId: user.id },
    );
  } catch {
    return { error: "The web search didn't work this time — try again later." };
  }

  if (!result.email) return { email: null, note: "No email found in a web search", canSearchWeb: false };
  const sourceHost = result.sourceUrl ? safeHost(result.sourceUrl) : null;
  if (!(await saveFoundEmail(company.id, user.id, result.email, "web_search", sourceHost))) return { error: "Someone added an email meanwhile — refresh the page." };
  return { email: result.email };
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}
