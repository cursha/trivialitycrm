-- AlterTable
ALTER TABLE "SalesList" ADD COLUMN     "lastEvaluatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "SalesListDynamicMember" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "cachedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesListDynamicMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalesListDynamicMember_companyId_idx" ON "SalesListDynamicMember"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesListDynamicMember_listId_companyId_key" ON "SalesListDynamicMember"("listId", "companyId");

-- AddForeignKey
ALTER TABLE "SalesListDynamicMember" ADD CONSTRAINT "SalesListDynamicMember_listId_fkey" FOREIGN KEY ("listId") REFERENCES "SalesList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesListDynamicMember" ADD CONSTRAINT "SalesListDynamicMember_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
