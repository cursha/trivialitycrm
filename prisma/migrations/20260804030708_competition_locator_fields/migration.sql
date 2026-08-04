-- AlterTable
ALTER TABLE "LeadSearch" ADD COLUMN     "runCorrelationId" TEXT;

-- AlterTable
ALTER TABLE "SearchResult" ADD COLUMN     "competitorConflict" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "duplicateConfidence" "ConfidenceLevel",
ADD COLUMN     "duplicateMatches" JSONB;

-- CreateIndex
CREATE INDEX "LeadSearch_runCorrelationId_idx" ON "LeadSearch"("runCorrelationId");

-- CreateIndex
CREATE INDEX "SearchResult_duplicateConfidence_idx" ON "SearchResult"("duplicateConfidence");

-- CreateIndex
CREATE INDEX "SearchResult_competitorConflict_idx" ON "SearchResult"("competitorConflict");
