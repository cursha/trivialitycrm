-- AlterTable
ALTER TABLE "LeadType" ADD COLUMN     "routePlanEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "routePlanSlug" TEXT;

-- CreateTable
CREATE TABLE "RoutePlan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "leadTypeId" TEXT,
    "country" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoutePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoutePlanCompany" (
    "id" TEXT NOT NULL,
    "routePlanId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "addedById" TEXT NOT NULL,

    CONSTRAINT "RoutePlanCompany_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RoutePlan_userId_key" ON "RoutePlan"("userId");

-- CreateIndex
CREATE INDEX "RoutePlanCompany_companyId_idx" ON "RoutePlanCompany"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "RoutePlanCompany_routePlanId_companyId_key" ON "RoutePlanCompany"("routePlanId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadType_routePlanSlug_key" ON "LeadType"("routePlanSlug");

-- AddForeignKey
ALTER TABLE "RoutePlan" ADD CONSTRAINT "RoutePlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutePlan" ADD CONSTRAINT "RoutePlan_leadTypeId_fkey" FOREIGN KEY ("leadTypeId") REFERENCES "LeadType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutePlanCompany" ADD CONSTRAINT "RoutePlanCompany_routePlanId_fkey" FOREIGN KEY ("routePlanId") REFERENCES "RoutePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutePlanCompany" ADD CONSTRAINT "RoutePlanCompany_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutePlanCompany" ADD CONSTRAINT "RoutePlanCompany_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
