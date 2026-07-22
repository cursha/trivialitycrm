import { prisma } from "../../src/lib/prisma";
import { assertTestDatabaseUrl } from "../setup/test-db-guard";

// Validate TEST_DATABASE_URL is unambiguously a test database, then confirm
// DATABASE_URL — what the shared Prisma singleton (src/lib/prisma.ts)
// actually connects with — was really repointed at it by
// tests/setup/load-env.ts. If that repoint didn't happen for any reason
// (setupFiles misconfigured, run outside Vitest, etc.), refuse to proceed
// rather than risk the singleton still pointing at a dev/prod DATABASE_URL.
const testDatabaseUrl = assertTestDatabaseUrl(process.env.TEST_DATABASE_URL);

if (process.env.DATABASE_URL !== testDatabaseUrl) {
  throw new Error(
    "DATABASE_URL is not pointed at TEST_DATABASE_URL in this process — refusing to run destructive test " +
      "setup. Expected tests/setup/load-env.ts to have repointed it; check Vitest's setupFiles ordering.",
  );
}

export const testPrisma = prisma;

const TABLES_TO_RESET = [
  "Session",
  "Task",
  "Activity",
  "EvidenceRecord",
  "HistoricalScoreRecord",
  "ConsentRecord",
  // Module Seven: children before parents, matching the existing
  // convention — these all reference Company/Contact/User/DataQualityRule.
  "DataQualityAuditEvent",
  "EnrichmentRecord",
  "PotentialDuplicate",
  "DataQualityIssue",
  "DataQualityScan",
  "DataQualityRule",
  // Module 8A: Essential Version 1 Administration — AuditEvent/
  // OrganizationSettings/AiSettings all reference User (and Organization
  // Settings also PipelineStage/LeadType), so they come before those;
  // WorkerHeartbeat has no FK at all.
  "AuditEvent",
  "OrganizationSettings",
  "AiSettings",
  "WorkerHeartbeat",
  "Contact",
  "CompanySource",
  "AiUsageRecord",
  "SearchResult",
  "SearchCandidate",
  "LeadSearch",
  "PromptTemplate",
  "ImportTemplate",
  "ImportBatch",
  "RateLimitBucket",
  "Notification",
  "WebhookEvent",
  "Appointment",
  "SequenceStepRun",
  "SequenceEnrollment",
  "SequenceStep",
  "FollowUpSequence",
  "EmailMessage",
  "EmailTemplate",
  "ProviderConnection",
  "GeneratedReport",
  "ScheduledReport",
  "PipelineStageHistory",
  "SavedView",
  "Territory",
  "WorkspaceSettings",
  "Company",
  "User",
  "Team",
  "RolePermission",
  "Permission",
  "Role",
  "PipelineStage",
  "LeadType",
  "RejectionReason",
  "Competitor",
];

/** Truncates every application table. Re-asserts the DB-safety guard
 * immediately before the destructive call, not just at module load. */
export async function resetDatabase() {
  assertTestDatabaseUrl(process.env.DATABASE_URL);
  const tableList = TABLES_TO_RESET.map((t) => `"${t}"`).join(", ");
  await testPrisma.$executeRawUnsafe(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`);
}
