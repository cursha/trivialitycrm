-- CreateEnum
CREATE TYPE "DistanceUnit" AS ENUM ('MI', 'KM');

-- AlterEnum
ALTER TYPE "LeadSearchMode" ADD VALUE 'PUB_RADIUS';

-- AlterTable
ALTER TABLE "LeadSearch" ADD COLUMN     "originCompanyId" TEXT,
ADD COLUMN     "originLat" DOUBLE PRECISION,
ADD COLUMN     "originLng" DOUBLE PRECISION,
ADD COLUMN     "radiusUnit" "DistanceUnit",
ADD COLUMN     "radiusValue" INTEGER;

-- CreateIndex
CREATE INDEX "LeadSearch_originCompanyId_idx" ON "LeadSearch"("originCompanyId");

-- AddForeignKey
ALTER TABLE "LeadSearch" ADD CONSTRAINT "LeadSearch_originCompanyId_fkey" FOREIGN KEY ("originCompanyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
