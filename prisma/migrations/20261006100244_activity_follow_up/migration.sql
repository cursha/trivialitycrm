-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "activityId" TEXT;

-- CreateIndex
CREATE INDEX "Task_activityId_idx" ON "Task"("activityId");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
