-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'EMAIL_BOUNCED';
ALTER TYPE "NotificationType" ADD VALUE 'REPORT_GENERATED';

-- AlterTable
ALTER TABLE "GeneratedReport" DROP COLUMN "seenByIds";
