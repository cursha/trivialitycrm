-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'SCHEDULED_EMAIL_STAGE_SUGGESTED';

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "primaryContactId" TEXT;

-- AlterTable
ALTER TABLE "EmailMessage" ADD COLUMN     "links" JSONB,
ADD COLUMN     "pipelineStageAppliedAt" TIMESTAMP(3),
ADD COLUMN     "pipelineStageAppliedById" TEXT,
ADD COLUMN     "suggestedPipelineStageId" TEXT;

-- CreateTable
CREATE TABLE "EmailTemplateCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailTemplateCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailTemplateLink" (
    "id" TEXT NOT NULL,
    "emailTemplateId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailTemplateLink_pkey" PRIMARY KEY ("id")
);

-- AlterTable: add categoryId nullable FIRST, category (old free-text column)
-- stays in place until the data migration below has run.
ALTER TABLE "EmailTemplate" ADD COLUMN     "categoryId" TEXT;

-- Data migration: backfill EmailTemplateCategory rows from every distinct
-- existing EmailTemplate.category free-text value, then point categoryId at
-- them, before the old column is dropped. Attribution defaults to the
-- earliest Administrator account (a structural migration, not a real admin
-- action). IDs use gen_random_uuid() rather than the app's usual cuid()
-- (a Prisma-client-side default, not available in raw SQL) -- functionally
-- identical opaque TEXT primary keys, just a different id format for this
-- one backfilled batch. No-op if no template currently has a category.
INSERT INTO "EmailTemplateCategory" ("id", "name", "sortOrder", "isActive", "createdById", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  t."category",
  0,
  true,
  (SELECT u."id" FROM "User" u JOIN "Role" r ON r."id" = u."roleId" WHERE r."name" = 'Administrator' ORDER BY u."createdAt" ASC LIMIT 1),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "category" FROM "EmailTemplate" WHERE "category" IS NOT NULL AND "category" <> '') t;

UPDATE "EmailTemplate" et
SET "categoryId" = etc."id"
FROM "EmailTemplateCategory" etc
WHERE et."category" = etc."name";

-- AlterTable: now safe to drop the old free-text column.
ALTER TABLE "EmailTemplate" DROP COLUMN "category";

-- CreateIndex
CREATE UNIQUE INDEX "EmailTemplateCategory_name_key" ON "EmailTemplateCategory"("name");

-- CreateIndex
CREATE INDEX "EmailTemplateCategory_isActive_sortOrder_idx" ON "EmailTemplateCategory"("isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "EmailTemplateLink_emailTemplateId_idx" ON "EmailTemplateLink"("emailTemplateId");

-- CreateIndex
CREATE UNIQUE INDEX "Company_primaryContactId_key" ON "Company"("primaryContactId");

-- CreateIndex
CREATE INDEX "EmailMessage_suggestedPipelineStageId_idx" ON "EmailMessage"("suggestedPipelineStageId");

-- CreateIndex
CREATE INDEX "EmailTemplate_categoryId_idx" ON "EmailTemplate"("categoryId");

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_primaryContactId_fkey" FOREIGN KEY ("primaryContactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailTemplate" ADD CONSTRAINT "EmailTemplate_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "EmailTemplateCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailTemplateCategory" ADD CONSTRAINT "EmailTemplateCategory_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailTemplateCategory" ADD CONSTRAINT "EmailTemplateCategory_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailTemplateLink" ADD CONSTRAINT "EmailTemplateLink_emailTemplateId_fkey" FOREIGN KEY ("emailTemplateId") REFERENCES "EmailTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_suggestedPipelineStageId_fkey" FOREIGN KEY ("suggestedPipelineStageId") REFERENCES "PipelineStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_pipelineStageAppliedById_fkey" FOREIGN KEY ("pipelineStageAppliedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
