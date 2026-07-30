-- CreateEnum
CREATE TYPE "CallOutcomeResultCategory" AS ENUM ('UNREACHABLE', 'INTERESTED', 'DEMO_REQUESTED', 'NOT_INTERESTED');

-- CreateEnum
CREATE TYPE "CallingSessionStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED', 'ENDED');

-- CreateEnum
CREATE TYPE "CallingSessionEntryStatus" AS ENUM ('PENDING', 'COMPLETED', 'SKIPPED');

-- AlterTable
ALTER TABLE "WorkspaceSettings" ADD COLUMN     "defaultCallingOrderBy" TEXT NOT NULL DEFAULT 'salesPriorityScore',
ADD COLUMN     "defaultCallingOrderDir" TEXT NOT NULL DEFAULT 'desc';

-- CreateTable
CREATE TABLE "CallOutcome" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "requiresNotes" BOOLEAN NOT NULL DEFAULT false,
    "requiresNextAction" BOOLEAN NOT NULL DEFAULT false,
    "defaultNextActionDays" INTEGER,
    "defaultNextActionTitle" TEXT,
    "defaultPipelineStageId" TEXT,
    "opensEmailComposer" BOOLEAN NOT NULL DEFAULT false,
    "requiresRejectionReason" BOOLEAN NOT NULL DEFAULT false,
    "skipRestOfSession" BOOLEAN NOT NULL DEFAULT false,
    "resultCategory" "CallOutcomeResultCategory",

    CONSTRAINT "CallOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallingSession" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "startedById" TEXT NOT NULL,
    "status" "CallingSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "orderBy" TEXT NOT NULL,
    "orderDir" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pausedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "CallingSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallingSessionEntry" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "status" "CallingSessionEntryStatus" NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "CallingSessionEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallRecord" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "outcomeId" TEXT NOT NULL,
    "notes" TEXT,
    "recordedById" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activityId" TEXT,
    "taskId" TEXT,
    "appliedPipelineStageId" TEXT,
    "rejectionReasonId" TEXT,

    CONSTRAINT "CallRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CallOutcome_name_key" ON "CallOutcome"("name");

-- CreateIndex
CREATE INDEX "CallOutcome_active_sortOrder_idx" ON "CallOutcome"("active", "sortOrder");

-- CreateIndex
CREATE INDEX "CallingSession_listId_idx" ON "CallingSession"("listId");

-- CreateIndex
CREATE INDEX "CallingSession_startedById_status_idx" ON "CallingSession"("startedById", "status");

-- CreateIndex
CREATE INDEX "CallingSessionEntry_sessionId_position_idx" ON "CallingSessionEntry"("sessionId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "CallingSessionEntry_sessionId_companyId_key" ON "CallingSessionEntry"("sessionId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "CallRecord_entryId_key" ON "CallRecord"("entryId");

-- CreateIndex
CREATE UNIQUE INDEX "CallRecord_activityId_key" ON "CallRecord"("activityId");

-- CreateIndex
CREATE UNIQUE INDEX "CallRecord_taskId_key" ON "CallRecord"("taskId");

-- CreateIndex
CREATE INDEX "CallRecord_sessionId_idx" ON "CallRecord"("sessionId");

-- CreateIndex
CREATE INDEX "CallRecord_companyId_idx" ON "CallRecord"("companyId");

-- AddForeignKey
ALTER TABLE "CallOutcome" ADD CONSTRAINT "CallOutcome_defaultPipelineStageId_fkey" FOREIGN KEY ("defaultPipelineStageId") REFERENCES "PipelineStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallingSession" ADD CONSTRAINT "CallingSession_listId_fkey" FOREIGN KEY ("listId") REFERENCES "SalesList"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallingSession" ADD CONSTRAINT "CallingSession_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallingSessionEntry" ADD CONSTRAINT "CallingSessionEntry_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CallingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallingSessionEntry" ADD CONSTRAINT "CallingSessionEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallRecord" ADD CONSTRAINT "CallRecord_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CallingSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallRecord" ADD CONSTRAINT "CallRecord_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "CallingSessionEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallRecord" ADD CONSTRAINT "CallRecord_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallRecord" ADD CONSTRAINT "CallRecord_outcomeId_fkey" FOREIGN KEY ("outcomeId") REFERENCES "CallOutcome"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallRecord" ADD CONSTRAINT "CallRecord_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallRecord" ADD CONSTRAINT "CallRecord_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallRecord" ADD CONSTRAINT "CallRecord_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallRecord" ADD CONSTRAINT "CallRecord_appliedPipelineStageId_fkey" FOREIGN KEY ("appliedPipelineStageId") REFERENCES "PipelineStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallRecord" ADD CONSTRAINT "CallRecord_rejectionReasonId_fkey" FOREIGN KEY ("rejectionReasonId") REFERENCES "RejectionReason"("id") ON DELETE SET NULL ON UPDATE CASCADE;
