import "server-only";
import { prisma } from "@/lib/prisma";

export async function getDataQualityCounts() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [
    duplicateCompanies,
    duplicateContacts,
    missingCompanyAddress,
    missingCompanyPhone,
    missingCompanyEmail,
    missingCompanyUrl,
    missingContactPhone,
    missingContactEmail,
    invalidEmail,
    invalidPhone,
    invalidUrl,
    openIssues,
    recentlyResolved,
    lastScan,
  ] = await Promise.all([
    prisma.potentialDuplicate.count({ where: { entityType: "COMPANY", status: "PENDING" } }),
    prisma.potentialDuplicate.count({ where: { entityType: "CONTACT", status: "PENDING" } }),
    prisma.dataQualityIssue.count({ where: { entityType: "COMPANY", field: "address1", status: { in: ["OPEN", "REOPENED"] } } }),
    prisma.dataQualityIssue.count({ where: { entityType: "COMPANY", field: "phone", status: { in: ["OPEN", "REOPENED"] }, rule: { ruleType: "REQUIRED_FIELD" } } }),
    prisma.dataQualityIssue.count({ where: { entityType: "COMPANY", field: "email", status: { in: ["OPEN", "REOPENED"] }, rule: { ruleType: "REQUIRED_FIELD" } } }),
    prisma.dataQualityIssue.count({ where: { entityType: "COMPANY", field: "websiteUrl", status: { in: ["OPEN", "REOPENED"] } } }),
    prisma.dataQualityIssue.count({ where: { entityType: "CONTACT", field: "phone", status: { in: ["OPEN", "REOPENED"] }, rule: { ruleType: "REQUIRED_FIELD" } } }),
    prisma.dataQualityIssue.count({ where: { entityType: "CONTACT", field: "email", status: { in: ["OPEN", "REOPENED"] }, rule: { ruleType: "REQUIRED_FIELD" } } }),
    prisma.dataQualityIssue.count({ where: { status: { in: ["OPEN", "REOPENED"] }, rule: { ruleType: "INVALID_EMAIL_FORMAT" } } }),
    prisma.dataQualityIssue.count({ where: { status: { in: ["OPEN", "REOPENED"] }, rule: { ruleType: "INVALID_PHONE_FORMAT" } } }),
    prisma.dataQualityIssue.count({ where: { status: { in: ["OPEN", "REOPENED"] }, rule: { ruleType: "INVALID_URL_FORMAT" } } }),
    prisma.dataQualityIssue.count({ where: { status: { in: ["OPEN", "DEFERRED", "REOPENED"] } } }),
    prisma.dataQualityIssue.count({ where: { status: "RESOLVED", resolvedAt: { gte: sevenDaysAgo } } }),
    prisma.dataQualityScan.findFirst({ where: { status: "SUCCEEDED" }, orderBy: { completedAt: "desc" } }),
  ]);

  return {
    duplicateCompanies,
    duplicateContacts,
    missingCompanyAddress,
    missingCompanyPhone,
    missingCompanyEmail,
    missingCompanyUrl,
    missingContactPhone,
    missingContactEmail,
    invalidEmail,
    invalidPhone,
    invalidUrl,
    openIssues,
    recentlyResolved,
    lastScanAt: lastScan?.completedAt ?? null,
  };
}
