-- CreateEnum
CREATE TYPE "SearchCandidateStatus" AS ENUM ('PENDING', 'VERIFIED', 'SCORED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ImportBatchStatus" AS ENUM ('PENDING', 'CONFIRMED', 'IMPORTED', 'EXPIRED', 'FAILED');

-- AlterTable
ALTER TABLE "LeadSearch" ADD COLUMN     "providerJobId" TEXT;

-- AlterTable
ALTER TABLE "SearchResult" ADD COLUMN     "candidateId" TEXT;

-- CreateTable
CREATE TABLE "SearchCandidate" (
    "id" TEXT NOT NULL,
    "searchId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "normalizedIdentity" TEXT NOT NULL,
    "rawCandidate" JSONB NOT NULL,
    "status" "SearchCandidateStatus" NOT NULL DEFAULT 'PENDING',
    "verifiedData" JSONB,
    "score" INTEGER,
    "explanation" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SearchCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "status" "ImportBatchStatus" NOT NULL DEFAULT 'PENDING',
    "headers" JSONB NOT NULL,
    "payload" JSONB,
    "rowCount" INTEGER NOT NULL,
    "mapping" JSONB,
    "errorMessage" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiUsageRecord" (
    "id" TEXT NOT NULL,
    "searchId" TEXT,
    "userId" TEXT,
    "provider" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheCreationTokens" INTEGER NOT NULL DEFAULT 0,
    "serverToolUses" INTEGER NOT NULL DEFAULT 0,
    "estimatedCostUsd" DECIMAL(10,6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsageRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SearchCandidate_searchId_status_idx" ON "SearchCandidate"("searchId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SearchCandidate_searchId_normalizedIdentity_key" ON "SearchCandidate"("searchId", "normalizedIdentity");

-- CreateIndex
CREATE INDEX "ImportBatch_status_expiresAt_idx" ON "ImportBatch"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "ImportBatch_uploadedById_idx" ON "ImportBatch"("uploadedById");

-- CreateIndex
CREATE INDEX "AiUsageRecord_createdAt_idx" ON "AiUsageRecord"("createdAt");

-- CreateIndex
CREATE INDEX "AiUsageRecord_searchId_idx" ON "AiUsageRecord"("searchId");

-- CreateIndex
CREATE INDEX "RateLimitBucket_windowStart_idx" ON "RateLimitBucket"("windowStart");

-- CreateIndex
CREATE UNIQUE INDEX "RateLimitBucket_key_windowStart_key" ON "RateLimitBucket"("key", "windowStart");

-- CreateIndex
CREATE INDEX "LeadSearch_providerJobId_idx" ON "LeadSearch"("providerJobId");

-- CreateIndex
CREATE UNIQUE INDEX "SearchResult_candidateId_key" ON "SearchResult"("candidateId");

-- AddForeignKey
ALTER TABLE "SearchCandidate" ADD CONSTRAINT "SearchCandidate_searchId_fkey" FOREIGN KEY ("searchId") REFERENCES "LeadSearch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchResult" ADD CONSTRAINT "SearchResult_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "SearchCandidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUsageRecord" ADD CONSTRAINT "AiUsageRecord_searchId_fkey" FOREIGN KEY ("searchId") REFERENCES "LeadSearch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUsageRecord" ADD CONSTRAINT "AiUsageRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

