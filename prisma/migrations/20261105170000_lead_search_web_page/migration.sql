-- AlterEnum
ALTER TYPE "LeadSearchMode" ADD VALUE 'WEB_PAGE';

-- AlterTable
ALTER TABLE "LeadSearch" ADD COLUMN "sourceUrl" TEXT;
