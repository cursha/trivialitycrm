-- AlterEnum
ALTER TYPE "ActivityType" ADD VALUE 'VISIT';

-- AlterTable
ALTER TABLE "Activity" ADD COLUMN     "callOutcomeId" TEXT;

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "location" TEXT;

-- AlterTable
ALTER TABLE "CallOutcome" ADD COLUMN     "appliesToCalls" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "appliesToVisits" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "booksDemo" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "currentEntertainment" TEXT,
ADD COLUMN     "slowNight" "Weekday",
ADD COLUMN     "slowNightHeadcount" INTEGER;

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "bestTimeToReach" TEXT,
ADD COLUMN     "isChampion" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isDecisionMaker" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Activity_callOutcomeId_idx" ON "Activity"("callOutcomeId");

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_callOutcomeId_fkey" FOREIGN KEY ("callOutcomeId") REFERENCES "CallOutcome"("id") ON DELETE SET NULL ON UPDATE CASCADE;
