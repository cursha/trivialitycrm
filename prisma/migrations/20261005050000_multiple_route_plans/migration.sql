-- DropIndex
DROP INDEX "RoutePlan_userId_key";

-- AlterTable
ALTER TABLE "RoutePlan" ADD COLUMN     "name" TEXT NOT NULL DEFAULT 'My route',
ADD COLUMN     "plannedDate" DATE;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "activeRoutePlanId" TEXT;

-- CreateIndex
CREATE INDEX "RoutePlan_userId_idx" ON "RoutePlan"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "User_activeRoutePlanId_key" ON "User"("activeRoutePlanId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_activeRoutePlanId_fkey" FOREIGN KEY ("activeRoutePlanId") REFERENCES "RoutePlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Data: everyone's existing route (at most one each before this migration)
-- becomes their current route, named "My route" by the column default, so
-- nothing anyone had planned is lost.
UPDATE "User" AS u SET "activeRoutePlanId" = r."id"
  FROM "RoutePlan" AS r
  WHERE r."userId" = u."id" AND u."activeRoutePlanId" IS NULL;
