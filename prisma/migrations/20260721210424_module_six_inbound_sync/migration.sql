-- AlterEnum
ALTER TYPE "EmailMessageStatus" ADD VALUE 'RECEIVED';

-- DropForeignKey
ALTER TABLE "EmailMessage" DROP CONSTRAINT "EmailMessage_companyId_fkey";

-- AlterTable
ALTER TABLE "EmailMessage" ADD COLUMN     "fromAddress" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT,
ALTER COLUMN "companyId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "ProviderConnection" ADD COLUMN     "inboundClientState" TEXT,
ADD COLUMN     "inboundSubscriptionExpiresAt" TIMESTAMP(3),
ADD COLUMN     "inboundSubscriptionId" TEXT;

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" "ProviderKind" NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_provider_providerEventId_key" ON "WebhookEvent"("provider", "providerEventId");

-- CreateIndex
CREATE INDEX "EmailMessage_direction_reviewedAt_idx" ON "EmailMessage"("direction", "reviewedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailMessage_providerConnectionId_providerMessageId_key" ON "EmailMessage"("providerConnectionId", "providerMessageId");

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
