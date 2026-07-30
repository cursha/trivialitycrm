-- DropForeignKey
ALTER TABLE "Campaign" DROP CONSTRAINT "Campaign_senderId_fkey";

-- AlterTable
ALTER TABLE "Campaign" ALTER COLUMN "senderId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
