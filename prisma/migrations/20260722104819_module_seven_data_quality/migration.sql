-- CreateEnum
CREATE TYPE "ContactStatus" AS ENUM ('ACTIVE', 'MERGED');

-- CreateEnum
CREATE TYPE "DataQualityEntityType" AS ENUM ('COMPANY', 'CONTACT');

-- CreateEnum
CREATE TYPE "DataQualityRuleType" AS ENUM ('REQUIRED_FIELD', 'INVALID_EMAIL_FORMAT', 'INVALID_PHONE_FORMAT', 'INVALID_URL_FORMAT', 'DUPLICATE_EXACT_MATCH', 'DUPLICATE_NORMALIZED_MATCH', 'DUPLICATE_FUZZY_MATCH', 'STALE_RECORD', 'CUSTOM_REVIEW_FLAG');

-- CreateEnum
CREATE TYPE "DataQualitySeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "DataQualityIssueStatus" AS ENUM ('OPEN', 'DEFERRED', 'RESOLVED', 'IGNORED', 'REOPENED');

-- CreateEnum
CREATE TYPE "DuplicateReviewStatus" AS ENUM ('PENDING', 'NOT_DUPLICATE', 'CONFIRMED', 'DEFERRED', 'MERGED');

-- CreateEnum
CREATE TYPE "EnrichmentDecision" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DataQualityAuditAction" AS ENUM ('RULE_CREATED', 'RULE_UPDATED', 'RULE_ARCHIVED', 'RULE_RESTORED', 'ISSUE_STATUS_CHANGED', 'ISSUE_ASSIGNED', 'ISSUE_BULK_UPDATED', 'RECORD_CORRECTED', 'DUPLICATE_REVIEWED', 'COMPANY_MERGED', 'CONTACT_MERGED', 'SCAN_STARTED', 'SCAN_COMPLETED', 'SCAN_FAILED', 'SCAN_CANCELLED', 'ENRICHMENT_SUGGESTED', 'ENRICHMENT_ACCEPTED', 'ENRICHMENT_REJECTED');

-- AlterEnum
ALTER TYPE "ActivityType" ADD VALUE 'COMPANY_MERGED';

-- AlterEnum
ALTER TYPE "CompanyStatus" ADD VALUE 'MERGED';

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "mergedAt" TIMESTAMP(3),
ADD COLUMN     "mergedById" TEXT,
ADD COLUMN     "mergedIntoId" TEXT,
ADD COLUMN     "normalizedCity" TEXT,
ADD COLUMN     "normalizedPostalCode" TEXT,
ADD COLUMN     "normalizedRegion" TEXT;

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "mergedAt" TIMESTAMP(3),
ADD COLUMN     "mergedById" TEXT,
ADD COLUMN     "mergedIntoId" TEXT,
ADD COLUMN     "normalizedEmail" TEXT,
ADD COLUMN     "normalizedFirstName" TEXT,
ADD COLUMN     "normalizedLastName" TEXT,
ADD COLUMN     "normalizedPhone" TEXT,
ADD COLUMN     "status" "ContactStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateTable
CREATE TABLE "DataQualityRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "entityType" "DataQualityEntityType" NOT NULL,
    "field" TEXT NOT NULL,
    "ruleType" "DataQualityRuleType" NOT NULL,
    "severity" "DataQualitySeverity" NOT NULL DEFAULT 'MEDIUM',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "config" JSONB NOT NULL DEFAULT '{}',
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataQualityRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataQualityIssue" (
    "id" TEXT NOT NULL,
    "entityType" "DataQualityEntityType" NOT NULL,
    "companyId" TEXT,
    "contactId" TEXT,
    "ruleId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "severity" "DataQualitySeverity" NOT NULL,
    "status" "DataQualityIssueStatus" NOT NULL DEFAULT 'OPEN',
    "description" TEXT NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolutionAction" TEXT,
    "assignedToId" TEXT,
    "notes" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataQualityIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PotentialDuplicate" (
    "id" TEXT NOT NULL,
    "entityType" "DataQualityEntityType" NOT NULL,
    "companyAId" TEXT,
    "companyBId" TEXT,
    "contactAId" TEXT,
    "contactBId" TEXT,
    "score" INTEGER NOT NULL,
    "confidence" "ConfidenceLevel" NOT NULL,
    "reasons" TEXT[],
    "matchedFields" TEXT[],
    "conflictingFields" TEXT[],
    "status" "DuplicateReviewStatus" NOT NULL DEFAULT 'PENDING',
    "dismissedFieldsSnapshot" JSONB,
    "assignedToId" TEXT,
    "reviewNote" TEXT,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,

    CONSTRAINT "PotentialDuplicate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataQualityScan" (
    "id" TEXT NOT NULL,
    "entityType" "DataQualityEntityType",
    "status" "SearchJobStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "recordsScanned" INTEGER NOT NULL DEFAULT 0,
    "issuesFound" INTEGER NOT NULL DEFAULT 0,
    "duplicatesFound" INTEGER NOT NULL DEFAULT 0,
    "lastProcessedCompanyId" TEXT,
    "lastProcessedContactId" TEXT,
    "triggeredById" TEXT,
    "providerJobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataQualityScan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnrichmentRecord" (
    "id" TEXT NOT NULL,
    "entityType" "DataQualityEntityType" NOT NULL,
    "companyId" TEXT,
    "contactId" TEXT,
    "field" TEXT NOT NULL,
    "previousValue" TEXT,
    "suggestedValue" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "evidence" TEXT,
    "confidence" "ConfidenceLevel" NOT NULL,
    "requestId" TEXT,
    "suggestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decision" "EnrichmentDecision" NOT NULL DEFAULT 'PENDING',
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "estimatedCostUsd" DECIMAL(10,6),

    CONSTRAINT "EnrichmentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataQualityAuditEvent" (
    "id" TEXT NOT NULL,
    "action" "DataQualityAuditAction" NOT NULL,
    "actorId" TEXT,
    "companyId" TEXT,
    "contactId" TEXT,
    "ruleId" TEXT,
    "issueId" TEXT,
    "potentialDuplicateId" TEXT,
    "enrichmentRecordId" TEXT,
    "beforeData" JSONB,
    "afterData" JSONB,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataQualityAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DataQualityRule_entityType_enabled_archivedAt_idx" ON "DataQualityRule"("entityType", "enabled", "archivedAt");

-- CreateIndex
CREATE INDEX "DataQualityRule_ruleType_idx" ON "DataQualityRule"("ruleType");

-- CreateIndex
CREATE INDEX "DataQualityIssue_entityType_status_severity_idx" ON "DataQualityIssue"("entityType", "status", "severity");

-- CreateIndex
CREATE INDEX "DataQualityIssue_assignedToId_idx" ON "DataQualityIssue"("assignedToId");

-- CreateIndex
CREATE INDEX "DataQualityIssue_status_detectedAt_idx" ON "DataQualityIssue"("status", "detectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DataQualityIssue_companyId_ruleId_key" ON "DataQualityIssue"("companyId", "ruleId");

-- CreateIndex
CREATE UNIQUE INDEX "DataQualityIssue_contactId_ruleId_key" ON "DataQualityIssue"("contactId", "ruleId");

-- CreateIndex
CREATE INDEX "PotentialDuplicate_entityType_status_score_idx" ON "PotentialDuplicate"("entityType", "status", "score");

-- CreateIndex
CREATE INDEX "PotentialDuplicate_assignedToId_idx" ON "PotentialDuplicate"("assignedToId");

-- CreateIndex
CREATE UNIQUE INDEX "PotentialDuplicate_companyAId_companyBId_key" ON "PotentialDuplicate"("companyAId", "companyBId");

-- CreateIndex
CREATE UNIQUE INDEX "PotentialDuplicate_contactAId_contactBId_key" ON "PotentialDuplicate"("contactAId", "contactBId");

-- CreateIndex
CREATE INDEX "DataQualityScan_status_heartbeatAt_idx" ON "DataQualityScan"("status", "heartbeatAt");

-- CreateIndex
CREATE INDEX "DataQualityScan_providerJobId_idx" ON "DataQualityScan"("providerJobId");

-- CreateIndex
CREATE INDEX "EnrichmentRecord_entityType_decision_idx" ON "EnrichmentRecord"("entityType", "decision");

-- CreateIndex
CREATE INDEX "EnrichmentRecord_companyId_idx" ON "EnrichmentRecord"("companyId");

-- CreateIndex
CREATE INDEX "EnrichmentRecord_contactId_idx" ON "EnrichmentRecord"("contactId");

-- CreateIndex
CREATE INDEX "EnrichmentRecord_requestId_idx" ON "EnrichmentRecord"("requestId");

-- CreateIndex
CREATE INDEX "DataQualityAuditEvent_action_occurredAt_idx" ON "DataQualityAuditEvent"("action", "occurredAt");

-- CreateIndex
CREATE INDEX "DataQualityAuditEvent_companyId_idx" ON "DataQualityAuditEvent"("companyId");

-- CreateIndex
CREATE INDEX "DataQualityAuditEvent_contactId_idx" ON "DataQualityAuditEvent"("contactId");

-- CreateIndex
CREATE INDEX "Company_normalizedRegion_idx" ON "Company"("normalizedRegion");

-- CreateIndex
CREATE INDEX "Company_normalizedCity_idx" ON "Company"("normalizedCity");

-- CreateIndex
CREATE INDEX "Company_normalizedPostalCode_idx" ON "Company"("normalizedPostalCode");

-- CreateIndex
CREATE INDEX "Company_mergedIntoId_idx" ON "Company"("mergedIntoId");

-- CreateIndex
CREATE INDEX "Contact_normalizedFirstName_normalizedLastName_idx" ON "Contact"("normalizedFirstName", "normalizedLastName");

-- CreateIndex
CREATE INDEX "Contact_normalizedPhone_idx" ON "Contact"("normalizedPhone");

-- CreateIndex
CREATE INDEX "Contact_normalizedEmail_idx" ON "Contact"("normalizedEmail");

-- CreateIndex
CREATE INDEX "Contact_status_idx" ON "Contact"("status");

-- CreateIndex
CREATE INDEX "Contact_mergedIntoId_idx" ON "Contact"("mergedIntoId");

-- CreateIndex
CREATE INDEX "Contact_companyId_status_idx" ON "Contact"("companyId", "status");

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_mergedById_fkey" FOREIGN KEY ("mergedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_mergedById_fkey" FOREIGN KEY ("mergedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataQualityRule" ADD CONSTRAINT "DataQualityRule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataQualityRule" ADD CONSTRAINT "DataQualityRule_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataQualityIssue" ADD CONSTRAINT "DataQualityIssue_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataQualityIssue" ADD CONSTRAINT "DataQualityIssue_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataQualityIssue" ADD CONSTRAINT "DataQualityIssue_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "DataQualityRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataQualityIssue" ADD CONSTRAINT "DataQualityIssue_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataQualityIssue" ADD CONSTRAINT "DataQualityIssue_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PotentialDuplicate" ADD CONSTRAINT "PotentialDuplicate_companyAId_fkey" FOREIGN KEY ("companyAId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PotentialDuplicate" ADD CONSTRAINT "PotentialDuplicate_companyBId_fkey" FOREIGN KEY ("companyBId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PotentialDuplicate" ADD CONSTRAINT "PotentialDuplicate_contactAId_fkey" FOREIGN KEY ("contactAId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PotentialDuplicate" ADD CONSTRAINT "PotentialDuplicate_contactBId_fkey" FOREIGN KEY ("contactBId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PotentialDuplicate" ADD CONSTRAINT "PotentialDuplicate_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PotentialDuplicate" ADD CONSTRAINT "PotentialDuplicate_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataQualityScan" ADD CONSTRAINT "DataQualityScan_triggeredById_fkey" FOREIGN KEY ("triggeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnrichmentRecord" ADD CONSTRAINT "EnrichmentRecord_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnrichmentRecord" ADD CONSTRAINT "EnrichmentRecord_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnrichmentRecord" ADD CONSTRAINT "EnrichmentRecord_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataQualityAuditEvent" ADD CONSTRAINT "DataQualityAuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataQualityAuditEvent" ADD CONSTRAINT "DataQualityAuditEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataQualityAuditEvent" ADD CONSTRAINT "DataQualityAuditEvent_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
