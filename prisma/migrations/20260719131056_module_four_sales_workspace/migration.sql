-- CreateEnum
CREATE TYPE "PipelineStageOutcome" AS ENUM ('WON', 'LOST');

-- CreateEnum
CREATE TYPE "SavedViewVisibility" AS ENUM ('PRIVATE', 'SHARED');

-- AlterEnum
ALTER TYPE "ActivityType" ADD VALUE 'ASSIGNMENT_CHANGE';

-- DropForeignKey
ALTER TABLE "Company" DROP CONSTRAINT "Company_assignedToId_fkey";

-- AlterTable
ALTER TABLE "Company" ALTER COLUMN "assignedToId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "PipelineStage" ADD COLUMN     "outcomeType" "PipelineStageOutcome";

-- CreateTable
CREATE TABLE "Territory" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "country" TEXT NOT NULL,
    "region" TEXT,
    "city" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "assignedToId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Territory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedView" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "visibility" "SavedViewVisibility" NOT NULL DEFAULT 'PRIVATE',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "filters" JSONB NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "noActivityThresholdDays" INTEGER NOT NULL DEFAULT 14,
    "newlyAssignedThresholdDays" INTEGER NOT NULL DEFAULT 3,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Territory_assignedToId_idx" ON "Territory"("assignedToId");

-- CreateIndex
CREATE UNIQUE INDEX "Territory_country_region_city_key" ON "Territory"("country", "region", "city");

-- CreateIndex
CREATE INDEX "SavedView_ownerId_idx" ON "SavedView"("ownerId");

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Territory" ADD CONSTRAINT "Territory_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedView" ADD CONSTRAINT "SavedView_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
