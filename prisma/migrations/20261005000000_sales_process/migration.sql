-- CreateEnum
CREATE TYPE "SalesTrack" AS ENUM ('LOCAL', 'REMOTE');

-- CreateEnum
CREATE TYPE "SalesStep" AS ENUM ('TARGET', 'INTRODUCED', 'DEMO_BOOKED', 'DEMO_HELD', 'TRIAL_BOOKED', 'TRIAL_LIVE');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "salesTrack" "SalesTrack" NOT NULL DEFAULT 'LOCAL';

-- AlterTable
ALTER TABLE "PipelineStage" ADD COLUMN     "playbookLocal" TEXT,
ADD COLUMN     "playbookRemote" TEXT,
ADD COLUMN     "processStep" "SalesStep";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "timezone" TEXT;

-- CreateTable
CREATE TABLE "PipelineStageTask" (
    "id" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "track" "SalesTrack",
    "title" TEXT NOT NULL,
    "daysAfter" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PipelineStageTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesTarget" (
    "userId" TEXT NOT NULL,
    "visits" INTEGER NOT NULL DEFAULT 10,
    "intros" INTEGER NOT NULL DEFAULT 0,
    "demosBooked" INTEGER NOT NULL DEFAULT 2,
    "demosHeld" INTEGER NOT NULL DEFAULT 2,
    "trialsBooked" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesTarget_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "PipelineStageTask_stageId_idx" ON "PipelineStageTask"("stageId");

-- CreateIndex
CREATE UNIQUE INDEX "PipelineStage_processStep_key" ON "PipelineStage"("processStep");

-- AddForeignKey
ALTER TABLE "PipelineStageTask" ADD CONSTRAINT "PipelineStageTask_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "PipelineStage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesTarget" ADD CONSTRAINT "SalesTarget_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Data: turn the original seeded stages into the sales-process steps.
-- Renames keep each stage's id, so every company stays in place and its
-- stage history is untouched. Each rename only applies while the stage
-- still has its original seeded name (an admin rename is left alone) and
-- the new name isn't already taken. The two brand-new steps (Demo Booked,
-- Trial Booked), playbooks and automatic follow-ups are created by the
-- seed, which runs right after migrations on every deploy.
UPDATE "PipelineStage" SET "name" = 'Target'
  WHERE "name" = 'New' AND NOT EXISTS (SELECT 1 FROM "PipelineStage" WHERE "name" = 'Target');
UPDATE "PipelineStage" SET "name" = 'Introduced'
  WHERE "name" = 'Material Sent' AND NOT EXISTS (SELECT 1 FROM "PipelineStage" WHERE "name" = 'Introduced');
UPDATE "PipelineStage" SET "name" = 'Demo Held'
  WHERE "name" = 'Demo Given' AND NOT EXISTS (SELECT 1 FROM "PipelineStage" WHERE "name" = 'Demo Held');
UPDATE "PipelineStage" SET "name" = 'Trial Live'
  WHERE "name" = 'Trial' AND NOT EXISTS (SELECT 1 FROM "PipelineStage" WHERE "name" = 'Trial Live');

UPDATE "PipelineStage" SET "processStep" = 'TARGET'     WHERE "name" = 'Target';
UPDATE "PipelineStage" SET "processStep" = 'INTRODUCED' WHERE "name" = 'Introduced';
UPDATE "PipelineStage" SET "processStep" = 'DEMO_HELD'  WHERE "name" = 'Demo Held';
UPDATE "PipelineStage" SET "processStep" = 'TRIAL_LIVE' WHERE "name" = 'Trial Live';

-- Put the steps in process order (leaving gaps at 2 and 4 for the seed's
-- Demo Booked and Trial Booked); any other stage keeps its relative order
-- after Won/Lost.
UPDATE "PipelineStage" SET "sortOrder" = CASE "name"
    WHEN 'Target' THEN 0
    WHEN 'Introduced' THEN 1
    WHEN 'Demo Booked' THEN 2
    WHEN 'Demo Held' THEN 3
    WHEN 'Trial Booked' THEN 4
    WHEN 'Trial Live' THEN 5
    WHEN 'Won' THEN 6
    WHEN 'Lost' THEN 7
    ELSE "sortOrder" + 8
  END;

-- "Booked" has no place in the sales process: hidden, not
-- deleted, so any company already in it stays there.
UPDATE "PipelineStage" SET "active" = false WHERE "name" = 'Booked' AND "isDefault" = false;
