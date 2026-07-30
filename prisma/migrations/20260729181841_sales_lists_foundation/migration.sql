-- CreateEnum
CREATE TYPE "SalesListPurpose" AS ENUM ('CALLING', 'EMAIL_CAMPAIGN', 'GENERAL_SALES');

-- CreateEnum
CREATE TYPE "SalesListType" AS ENUM ('FIXED', 'DYNAMIC');

-- CreateEnum
CREATE TYPE "SalesListVisibility" AS ENUM ('PRIVATE', 'SHARED_USERS', 'SHARED_TEAM');

-- CreateTable
CREATE TABLE "SalesList" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "purpose" "SalesListPurpose" NOT NULL,
    "type" "SalesListType" NOT NULL,
    "visibility" "SalesListVisibility" NOT NULL DEFAULT 'PRIVATE',
    "ownerId" TEXT NOT NULL,
    "filters" JSONB,
    "defaultSortBy" TEXT,
    "defaultSortDir" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesListMember" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "addedById" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesListMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesListShare" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "SalesListShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalesList_ownerId_idx" ON "SalesList"("ownerId");

-- CreateIndex
CREATE INDEX "SalesList_purpose_active_idx" ON "SalesList"("purpose", "active");

-- CreateIndex
CREATE INDEX "SalesListMember_companyId_idx" ON "SalesListMember"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesListMember_listId_companyId_key" ON "SalesListMember"("listId", "companyId");

-- CreateIndex
CREATE INDEX "SalesListShare_userId_idx" ON "SalesListShare"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesListShare_listId_userId_key" ON "SalesListShare"("listId", "userId");

-- AddForeignKey
ALTER TABLE "SalesList" ADD CONSTRAINT "SalesList_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesListMember" ADD CONSTRAINT "SalesListMember_listId_fkey" FOREIGN KEY ("listId") REFERENCES "SalesList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesListMember" ADD CONSTRAINT "SalesListMember_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesListMember" ADD CONSTRAINT "SalesListMember_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesListShare" ADD CONSTRAINT "SalesListShare_listId_fkey" FOREIGN KEY ("listId") REFERENCES "SalesList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesListShare" ADD CONSTRAINT "SalesListShare_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
