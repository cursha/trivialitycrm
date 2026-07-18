-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "normalizedEmail" TEXT,
ADD COLUMN     "normalizedPhone" TEXT;

-- CreateIndex
CREATE INDEX "Company_normalizedPhone_idx" ON "Company"("normalizedPhone");

-- CreateIndex
CREATE INDEX "Company_normalizedEmail_idx" ON "Company"("normalizedEmail");
