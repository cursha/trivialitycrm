-- Rename to match the "active" naming convention already used by every
-- other admin lookup in this schema (LeadType, PipelineStage,
-- RejectionReason, Competitor) -- isActive was an inconsistency introduced
-- in the immediately preceding migration, corrected here before any code
-- depends on it.
ALTER TABLE "EmailTemplateCategory" RENAME COLUMN "isActive" TO "active";

DROP INDEX "EmailTemplateCategory_isActive_sortOrder_idx";
CREATE INDEX "EmailTemplateCategory_active_sortOrder_idx" ON "EmailTemplateCategory"("active", "sortOrder");
