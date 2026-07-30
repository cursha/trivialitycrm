-- Phase 3 restructures Campaign's recipient/message model to support
-- multi-step sequences. These WIP feature tables have never held
-- production data (no commit of this feature has ever shipped), so this
-- migration truncates them outright rather than attempting a data-
-- preserving column/enum migration for rows that don't exist anywhere real.
TRUNCATE TABLE "CampaignMessageSnapshot", "CampaignRecipient", "Campaign" CASCADE;

-- DropForeignKey
ALTER TABLE "CampaignRecipient" DROP CONSTRAINT "CampaignRecipient_emailMessageId_fkey";

-- DropIndex
DROP INDEX "CampaignRecipient_emailMessageId_key";

-- DropIndex
DROP INDEX "CampaignMessageSnapshot_recipientId_key";

-- AlterTable: CampaignRecipient loses its single-send columns (moved to
-- CampaignRecipientStepRun, one row per attempted step) and gains
-- step-progression columns (mirrors SequenceEnrollment).
ALTER TABLE "CampaignRecipient"
  DROP COLUMN "emailMessageId",
  DROP COLUMN "sentAt",
  DROP COLUMN "errorMessage",
  ADD COLUMN "currentStepId" TEXT,
  ADD COLUMN "nextStepDueAt" TIMESTAMP(3),
  ADD COLUMN "stoppedAt" TIMESTAMP(3),
  ADD COLUMN "stopReason" TEXT;

-- AlterEnum: CampaignRecipientStatus now represents sequence-enrollment
-- progress (ACTIVE/COMPLETED/STOPPED_*), not a single send's outcome.
ALTER TYPE "CampaignRecipientStatus" RENAME TO "CampaignRecipientStatus_old";
CREATE TYPE "CampaignRecipientStatus" AS ENUM ('PENDING', 'ACTIVE', 'COMPLETED', 'SKIPPED', 'STOPPED_OPT_OUT', 'STOPPED_STAGE', 'STOPPED_REPLY', 'CANCELLED');
ALTER TABLE "CampaignRecipient" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "CampaignRecipient" ALTER COLUMN "status" TYPE "CampaignRecipientStatus" USING ("status"::text::"CampaignRecipientStatus");
ALTER TABLE "CampaignRecipient" ALTER COLUMN "status" SET DEFAULT 'PENDING';
DROP TYPE "CampaignRecipientStatus_old";

-- AlterTable: admin-chosen stop stages (plain scalar array — an unordered
-- set-membership check, same idiom as ProviderConnection.scopes).
ALTER TABLE "Campaign" ADD COLUMN "stopOnPipelineStageIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "CampaignStep" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "waitDays" INTEGER NOT NULL DEFAULT 0,
    "instructions" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignStep_pkey" PRIMARY KEY ("id")
);

-- AlterTable: every message snapshot now belongs to one step, not just one
-- recipient (a multi-step campaign generates and freezes one snapshot per
-- recipient per step, all at preview time).
ALTER TABLE "CampaignMessageSnapshot" ADD COLUMN "stepId" TEXT NOT NULL;

-- CreateEnum
CREATE TYPE "CampaignRecipientStepRunStatus" AS ENUM ('SENT', 'FAILED');

-- CreateTable
CREATE TABLE "CampaignRecipientStepRun" (
    "id" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "status" "CampaignRecipientStepRunStatus" NOT NULL,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "emailMessageId" TEXT,
    "errorMessage" TEXT,

    CONSTRAINT "CampaignRecipientStepRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CampaignStep_campaignId_stepOrder_key" ON "CampaignStep"("campaignId", "stepOrder");

-- CreateIndex
CREATE INDEX "CampaignRecipient_status_nextStepDueAt_idx" ON "CampaignRecipient"("status", "nextStepDueAt");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignMessageSnapshot_recipientId_stepId_key" ON "CampaignMessageSnapshot"("recipientId", "stepId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignRecipientStepRun_emailMessageId_key" ON "CampaignRecipientStepRun"("emailMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignRecipientStepRun_recipientId_stepId_key" ON "CampaignRecipientStepRun"("recipientId", "stepId");

-- AddForeignKey
ALTER TABLE "CampaignStep" ADD CONSTRAINT "CampaignStep_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_currentStepId_fkey" FOREIGN KEY ("currentStepId") REFERENCES "CampaignStep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignMessageSnapshot" ADD CONSTRAINT "CampaignMessageSnapshot_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "CampaignStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignRecipientStepRun" ADD CONSTRAINT "CampaignRecipientStepRun_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "CampaignRecipient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignRecipientStepRun" ADD CONSTRAINT "CampaignRecipientStepRun_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "CampaignStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignRecipientStepRun" ADD CONSTRAINT "CampaignRecipientStepRun_emailMessageId_fkey" FOREIGN KEY ("emailMessageId") REFERENCES "EmailMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
