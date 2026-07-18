-- CreateEnum
CREATE TYPE "TriviaStatus" AS ENUM ('CURRENT_TRIVIA', 'NO_CURRENT_TRIVIA', 'UNCERTAIN');

-- CreateEnum
CREATE TYPE "SearchResultDisposition" AS ENUM ('NEW', 'REVIEWED', 'TRANSFERRED', 'REJECTED', 'BELOW_SCORE', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('PHONE', 'EMAIL', 'MEETING', 'MATERIAL_SENT', 'DEMO', 'TRIAL', 'NOTE', 'PIPELINE_CHANGE');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CompanyStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "OpportunityGrade" AS ENUM ('A_PLUS', 'A', 'B', 'C', 'D');

-- CreateEnum
CREATE TYPE "ConfidenceLevel" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "PrimaryClassification" AS ENUM ('ENTERTAINMENT_READY', 'GREENFIELD', 'REPLACEMENT', 'NEEDS_QUALIFICATION', 'EXISTING_CUSTOMER');

-- CreateEnum
CREATE TYPE "SecondaryTag" AS ENUM ('EASY_WIN', 'REVENUE_READY', 'NO_HOST_READY');

-- CreateEnum
CREATE TYPE "ScoringCategory" AS ENUM ('FOOD_BEVERAGE_FOCUS', 'WEEKNIGHT_REVENUE_OPPORTUNITY', 'COMMUNITY_ENGAGEMENT', 'EXISTING_EVENT_CULTURE', 'GROUP_SEATING_LAYOUT', 'CAPACITY_OPERATIONAL_SUITABILITY', 'DECISION_MAKER_ACCESSIBILITY', 'MARKETING_ACTIVITY_VISIBILITY', 'TURNKEY_IMPLEMENTATION_READINESS', 'COMPETITIVE_OPPORTUNITY');

-- CreateEnum
CREATE TYPE "EvidenceVerificationStatus" AS ENUM ('VERIFIED', 'INFERRED', 'UNVERIFIED', 'OUTDATED', 'CONTRADICTORY');

-- CreateEnum
CREATE TYPE "EvidenceReliability" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "roleId" TEXT NOT NULL,
    "teamId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "allowed" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "LeadType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LeadType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineStage" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PipelineStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RejectionReason" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RejectionReason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Competitor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "websiteUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Competitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "address1" TEXT,
    "city" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "postalCode" TEXT,
    "country" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "websiteUrl" TEXT,
    "websiteDomain" TEXT,
    "notes" TEXT,
    "aiScore" INTEGER,
    "aiExplanation" TEXT,
    "triviaStatus" "TriviaStatus" NOT NULL DEFAULT 'UNCERTAIN',
    "nextFollowUpAt" TIMESTAMP(3),
    "leadTypeId" TEXT NOT NULL,
    "pipelineStageId" TEXT NOT NULL,
    "competitorId" TEXT,
    "assignedToId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "status" "CompanyStatus" NOT NULL DEFAULT 'ACTIVE',
    "archivedAt" TIMESTAMP(3),
    "archivedById" TEXT,
    "eosScore" INTEGER,
    "opportunityGrade" "OpportunityGrade",
    "confidenceLevel" "ConfidenceLevel",
    "primaryClassification" "PrimaryClassification",
    "secondaryTags" "SecondaryTag"[] DEFAULT ARRAY[]::"SecondaryTag"[],
    "salesPriorityScore" INTEGER,
    "scoreExplanation" TEXT,
    "verifiedEvidenceSummary" TEXT,
    "inferredEvidenceSummary" TEXT,
    "missingInformation" TEXT,
    "recommendedSalesApproach" TEXT,
    "recommendedNextAction" TEXT,
    "lastScoredAt" TIMESTAMP(3),
    "scoringVersion" TEXT,
    "isExistingCustomer" BOOLEAN NOT NULL DEFAULT false,
    "isQualified" BOOLEAN NOT NULL DEFAULT false,
    "exclusionReason" TEXT,
    "doNotContact" BOOLEAN NOT NULL DEFAULT false,
    "currentHistoricalScoreId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "title" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanySource" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT,
    "evidence" TEXT,
    "verifiedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanySource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceRecord" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "category" "ScoringCategory" NOT NULL,
    "sourceType" TEXT,
    "sourceUrl" TEXT,
    "evidenceSummary" TEXT NOT NULL,
    "evidenceDate" TIMESTAMP(3),
    "verificationStatus" "EvidenceVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "reliability" "EvidenceReliability" NOT NULL DEFAULT 'MEDIUM',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HistoricalScoreRecord" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "eosTotal" INTEGER NOT NULL,
    "foodBeverageFocus" INTEGER NOT NULL,
    "weeknightRevenueOpportunity" INTEGER NOT NULL,
    "communityEngagement" INTEGER NOT NULL,
    "existingEventCulture" INTEGER NOT NULL,
    "groupSeatingLayout" INTEGER NOT NULL,
    "capacityOperationalSuitability" INTEGER NOT NULL,
    "decisionMakerAccessibility" INTEGER NOT NULL,
    "marketingActivityVisibility" INTEGER NOT NULL,
    "turnkeyImplementationReadiness" INTEGER NOT NULL,
    "competitiveOpportunity" INTEGER NOT NULL,
    "opportunityGrade" "OpportunityGrade" NOT NULL,
    "confidenceLevel" "ConfidenceLevel" NOT NULL,
    "primaryClassification" "PrimaryClassification" NOT NULL,
    "secondaryTags" "SecondaryTag"[] DEFAULT ARRAY[]::"SecondaryTag"[],
    "salesPriorityScore" INTEGER,
    "scoreExplanation" TEXT,
    "recommendedSalesApproach" TEXT,
    "recommendedNextAction" TEXT,
    "scoringVersion" TEXT NOT NULL,
    "scoredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scoredById" TEXT,
    "scoringSource" TEXT,

    CONSTRAINT "HistoricalScoreRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "ActivityType" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "outcome" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "assignedToId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "qualificationPrompt" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromptTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadSearch" (
    "id" TEXT NOT NULL,
    "promptId" TEXT,
    "createdById" TEXT NOT NULL,
    "leadTypeId" TEXT NOT NULL,
    "competitorId" TEXT,
    "country" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "cities" JSONB NOT NULL,
    "minimumScore" INTEGER NOT NULL DEFAULT 80,
    "promptSnapshot" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadSearch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchResult" (
    "id" TEXT NOT NULL,
    "searchId" TEXT NOT NULL,
    "companyId" TEXT,
    "rejectionReasonId" TEXT,
    "name" TEXT NOT NULL,
    "address1" TEXT,
    "city" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "postalCode" TEXT,
    "country" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "websiteUrl" TEXT,
    "contactData" JSONB,
    "score" INTEGER NOT NULL,
    "explanation" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "sources" JSONB NOT NULL,
    "disposition" "SearchResultDisposition" NOT NULL DEFAULT 'NEW',
    "researchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mapping" JSONB NOT NULL,
    "transformations" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Team_name_key" ON "Team"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_key_key" ON "Permission"("key");

-- CreateIndex
CREATE UNIQUE INDEX "LeadType_name_key" ON "LeadType"("name");

-- CreateIndex
CREATE UNIQUE INDEX "PipelineStage_name_key" ON "PipelineStage"("name");

-- CreateIndex
CREATE UNIQUE INDEX "RejectionReason_name_key" ON "RejectionReason"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Competitor_name_key" ON "Competitor"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Company_currentHistoricalScoreId_key" ON "Company"("currentHistoricalScoreId");

-- CreateIndex
CREATE INDEX "Company_normalizedName_idx" ON "Company"("normalizedName");

-- CreateIndex
CREATE INDEX "Company_websiteDomain_idx" ON "Company"("websiteDomain");

-- CreateIndex
CREATE INDEX "Company_city_region_country_idx" ON "Company"("city", "region", "country");

-- CreateIndex
CREATE INDEX "Company_assignedToId_pipelineStageId_idx" ON "Company"("assignedToId", "pipelineStageId");

-- CreateIndex
CREATE INDEX "Company_status_idx" ON "Company"("status");

-- CreateIndex
CREATE INDEX "Company_eosScore_idx" ON "Company"("eosScore");

-- CreateIndex
CREATE INDEX "Company_opportunityGrade_idx" ON "Company"("opportunityGrade");

-- CreateIndex
CREATE INDEX "Company_primaryClassification_idx" ON "Company"("primaryClassification");

-- CreateIndex
CREATE INDEX "Company_nextFollowUpAt_idx" ON "Company"("nextFollowUpAt");

-- CreateIndex
CREATE INDEX "Company_triviaStatus_idx" ON "Company"("triviaStatus");

-- CreateIndex
CREATE INDEX "EvidenceRecord_companyId_category_idx" ON "EvidenceRecord"("companyId", "category");

-- CreateIndex
CREATE INDEX "HistoricalScoreRecord_companyId_scoredAt_idx" ON "HistoricalScoreRecord"("companyId", "scoredAt");

-- CreateIndex
CREATE INDEX "SearchResult_searchId_score_idx" ON "SearchResult"("searchId", "score");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_leadTypeId_fkey" FOREIGN KEY ("leadTypeId") REFERENCES "LeadType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_pipelineStageId_fkey" FOREIGN KEY ("pipelineStageId") REFERENCES "PipelineStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_archivedById_fkey" FOREIGN KEY ("archivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_currentHistoricalScoreId_fkey" FOREIGN KEY ("currentHistoricalScoreId") REFERENCES "HistoricalScoreRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanySource" ADD CONSTRAINT "CompanySource_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceRecord" ADD CONSTRAINT "EvidenceRecord_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceRecord" ADD CONSTRAINT "EvidenceRecord_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoricalScoreRecord" ADD CONSTRAINT "HistoricalScoreRecord_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoricalScoreRecord" ADD CONSTRAINT "HistoricalScoreRecord_scoredById_fkey" FOREIGN KEY ("scoredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptTemplate" ADD CONSTRAINT "PromptTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadSearch" ADD CONSTRAINT "LeadSearch_promptId_fkey" FOREIGN KEY ("promptId") REFERENCES "PromptTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadSearch" ADD CONSTRAINT "LeadSearch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadSearch" ADD CONSTRAINT "LeadSearch_leadTypeId_fkey" FOREIGN KEY ("leadTypeId") REFERENCES "LeadType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadSearch" ADD CONSTRAINT "LeadSearch_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchResult" ADD CONSTRAINT "SearchResult_searchId_fkey" FOREIGN KEY ("searchId") REFERENCES "LeadSearch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchResult" ADD CONSTRAINT "SearchResult_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchResult" ADD CONSTRAINT "SearchResult_rejectionReasonId_fkey" FOREIGN KEY ("rejectionReasonId") REFERENCES "RejectionReason"("id") ON DELETE SET NULL ON UPDATE CASCADE;
