"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/auth/permissions";
import { formString } from "@/lib/form-data";
import { parseRuleConfig, type DataQualityRuleTypeKey } from "@/lib/data-quality/rules";

export type RuleActionResult = { error?: string } | undefined;

const PATH = "/data-quality/rules";

const RULE_TYPES = [
  "REQUIRED_FIELD",
  "INVALID_EMAIL_FORMAT",
  "INVALID_PHONE_FORMAT",
  "INVALID_URL_FORMAT",
  "DUPLICATE_EXACT_MATCH",
  "DUPLICATE_NORMALIZED_MATCH",
  "DUPLICATE_FUZZY_MATCH",
  "STALE_RECORD",
  "CUSTOM_REVIEW_FLAG",
] as const;

const RuleFormSchema = z.object({
  name: z.string().trim().min(1, { error: "Enter a rule name." }).max(150),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  entityType: z.enum(["COMPANY", "CONTACT"]),
  field: z.string().trim().min(1, { error: "Enter a field name." }).max(100),
  ruleType: z.enum(RULE_TYPES),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  minSimilarity: z.string().trim().optional().or(z.literal("")),
  staleDays: z.string().trim().optional().or(z.literal("")),
});

async function requireRuleManager() {
  const user = await requireUser();
  requirePermission(user, "manage_data_quality_rules");
  return user;
}

function parseRuleForm(formData: FormData) {
  return RuleFormSchema.safeParse({
    name: formString(formData, "name"),
    description: formString(formData, "description"),
    entityType: formString(formData, "entityType"),
    field: formString(formData, "field"),
    ruleType: formString(formData, "ruleType"),
    severity: formString(formData, "severity"),
    minSimilarity: formString(formData, "minSimilarity"),
    staleDays: formString(formData, "staleDays"),
  });
}

function buildConfig(ruleType: DataQualityRuleTypeKey, minSimilarity?: string, staleDays?: string): Record<string, unknown> {
  if (ruleType === "DUPLICATE_FUZZY_MATCH") {
    return minSimilarity ? { minSimilarity: Number(minSimilarity) } : {};
  }
  if (ruleType === "STALE_RECORD") {
    return staleDays ? { staleDays: Number(staleDays) } : {};
  }
  return {};
}

export async function createRule(_prevState: RuleActionResult, formData: FormData): Promise<RuleActionResult> {
  const user = await requireRuleManager();

  const parsed = parseRuleForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please correct the highlighted fields." };
  }

  let config: Record<string, unknown>;
  try {
    config = parseRuleConfig(parsed.data.ruleType, buildConfig(parsed.data.ruleType, parsed.data.minSimilarity, parsed.data.staleDays));
  } catch {
    return { error: "Invalid rule configuration for this rule type." };
  }

  const maxSortOrder = await prisma.dataQualityRule.aggregate({ where: { entityType: parsed.data.entityType }, _max: { sortOrder: true } });

  const rule = await prisma.dataQualityRule.create({
    data: {
      name: parsed.data.name,
      description: parsed.data.description || null,
      entityType: parsed.data.entityType,
      field: parsed.data.field,
      ruleType: parsed.data.ruleType,
      severity: parsed.data.severity,
      config: config as never,
      sortOrder: (maxSortOrder._max.sortOrder ?? -1) + 1,
      createdById: user.id,
    },
  });

  await prisma.dataQualityAuditEvent.create({ data: { action: "RULE_CREATED", actorId: user.id, ruleId: rule.id, afterData: rule as never } });

  revalidatePath(PATH);
}

export async function updateRule(id: string, formData: FormData): Promise<RuleActionResult> {
  const user = await requireRuleManager();

  const existing = await prisma.dataQualityRule.findUnique({ where: { id } });
  if (!existing) return { error: "Rule not found." };

  const parsed = parseRuleForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please correct the highlighted fields." };
  }

  let config: Record<string, unknown>;
  try {
    config = parseRuleConfig(parsed.data.ruleType, buildConfig(parsed.data.ruleType, parsed.data.minSimilarity, parsed.data.staleDays));
  } catch {
    return { error: "Invalid rule configuration for this rule type." };
  }

  const updated = await prisma.dataQualityRule.update({
    where: { id },
    data: {
      name: parsed.data.name,
      description: parsed.data.description || null,
      entityType: parsed.data.entityType,
      field: parsed.data.field,
      ruleType: parsed.data.ruleType,
      severity: parsed.data.severity,
      config: config as never,
      updatedById: user.id,
    },
  });

  await prisma.dataQualityAuditEvent.create({ data: { action: "RULE_UPDATED", actorId: user.id, ruleId: id, beforeData: existing as never, afterData: updated as never } });

  revalidatePath(PATH);
}

export async function setRuleEnabled(id: string, enabled: boolean): Promise<void> {
  const user = await requireRuleManager();
  await prisma.dataQualityRule.update({ where: { id }, data: { enabled, updatedById: user.id } });
  revalidatePath(PATH);
}

export async function reorderRule(id: string, direction: "up" | "down"): Promise<void> {
  const user = await requireRuleManager();

  const rule = await prisma.dataQualityRule.findUnique({ where: { id } });
  if (!rule) return;

  const neighbor = await prisma.dataQualityRule.findFirst({
    where: { entityType: rule.entityType, archivedAt: null, sortOrder: direction === "up" ? { lt: rule.sortOrder } : { gt: rule.sortOrder } },
    orderBy: { sortOrder: direction === "up" ? "desc" : "asc" },
  });
  if (!neighbor) return;

  await prisma.$transaction([
    prisma.dataQualityRule.update({ where: { id: rule.id }, data: { sortOrder: neighbor.sortOrder, updatedById: user.id } }),
    prisma.dataQualityRule.update({ where: { id: neighbor.id }, data: { sortOrder: rule.sortOrder, updatedById: user.id } }),
  ]);

  revalidatePath(PATH);
}

export async function archiveRule(id: string): Promise<void> {
  const user = await requireRuleManager();
  await prisma.dataQualityRule.update({ where: { id }, data: { archivedAt: new Date(), updatedById: user.id } });
  await prisma.dataQualityAuditEvent.create({ data: { action: "RULE_ARCHIVED", actorId: user.id, ruleId: id } });
  revalidatePath(PATH);
}

export async function restoreRule(id: string): Promise<void> {
  const user = await requireRuleManager();
  await prisma.dataQualityRule.update({ where: { id }, data: { archivedAt: null, updatedById: user.id } });
  await prisma.dataQualityAuditEvent.create({ data: { action: "RULE_RESTORED", actorId: user.id, ruleId: id } });
  revalidatePath(PATH);
}
