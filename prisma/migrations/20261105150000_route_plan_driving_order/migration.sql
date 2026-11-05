-- AlterTable
ALTER TABLE "RoutePlan" ADD COLUMN     "optimizedAt" TIMESTAMP(3),
ADD COLUMN     "startAddress" TEXT,
ADD COLUMN     "totalDistanceMeters" INTEGER,
ADD COLUMN     "totalDurationSeconds" INTEGER;

-- AlterTable
ALTER TABLE "RoutePlanCompany" ADD COLUMN     "position" INTEGER;
