/*
  Warnings:

  - Added the required column `createdById` to the `ImportTemplate` table without a default value. This is not possible if the table is not empty.
  - Added the required column `normalizedName` to the `SearchResult` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "SearchJobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LeadSearchMode" AS ENUM ('TRIVIA_GAP', 'TRIVIA_CONFIRMED', 'COMPETITOR', 'GENERAL');

-- AlterEnum
ALTER TYPE "ActivityType" ADD VALUE 'LEAD_TRANSFERRED';

-- AlterTable
ALTER TABLE "ImportTemplate" ADD COLUMN     "createdById" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "LeadSearch" ADD COLUMN     "candidatesFound" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "errorMessage" TEXT,
ADD COLUMN     "heartbeatAt" TIMESTAMP(3),
ADD COLUMN     "mode" "LeadSearchMode" NOT NULL DEFAULT 'GENERAL',
ADD COLUMN     "startedAt" TIMESTAMP(3),
ADD COLUMN     "status" "SearchJobStatus" NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "PromptTemplate" ADD COLUMN     "archived" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "SearchResult" ADD COLUMN     "competitorId" TEXT,
ADD COLUMN     "normalizedEmail" TEXT,
ADD COLUMN     "normalizedName" TEXT NOT NULL,
ADD COLUMN     "normalizedPhone" TEXT,
ADD COLUMN     "triviaStatus" "TriviaStatus" NOT NULL DEFAULT 'UNCERTAIN',
ADD COLUMN     "websiteDomain" TEXT;

-- CreateIndex
CREATE INDEX "LeadSearch_status_heartbeatAt_idx" ON "LeadSearch"("status", "heartbeatAt");

-- CreateIndex
CREATE INDEX "SearchResult_normalizedName_idx" ON "SearchResult"("normalizedName");

-- CreateIndex
CREATE INDEX "SearchResult_websiteDomain_idx" ON "SearchResult"("websiteDomain");

-- CreateIndex
CREATE INDEX "SearchResult_normalizedPhone_idx" ON "SearchResult"("normalizedPhone");

-- CreateIndex
CREATE INDEX "SearchResult_normalizedEmail_idx" ON "SearchResult"("normalizedEmail");

-- CreateIndex
CREATE INDEX "SearchResult_disposition_idx" ON "SearchResult"("disposition");

-- AddForeignKey
ALTER TABLE "SearchResult" ADD CONSTRAINT "SearchResult_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportTemplate" ADD CONSTRAINT "ImportTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
