-- CreateEnum
CREATE TYPE "TransactionalEmailPurpose" AS ENUM ('PASSWORD_RESET', 'ADMIN_TEST');

-- CreateEnum
CREATE TYPE "TransactionalEmailStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'BOUNCED', 'COMPLAINED', 'DEFERRED');

-- AlterTable
ALTER TABLE "AiSettings" ADD COLUMN     "maxCostPerSearchUsd" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "WorkspaceSettings" ADD COLUMN     "quietHoursEndHour" INTEGER,
ADD COLUMN     "quietHoursStartHour" INTEGER;

-- CreateTable
CREATE TABLE "IntegrationSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "emailSendingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "IntegrationSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransactionalEmailMessage" (
    "id" TEXT NOT NULL,
    "purpose" "TransactionalEmailPurpose" NOT NULL,
    "toAddress" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" "TransactionalEmailStatus" NOT NULL DEFAULT 'QUEUED',
    "idempotencyKey" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "errorMessage" TEXT,
    "failureCategory" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TransactionalEmailMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailSuppression" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailSuppression_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailDeliveryEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailDeliveryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TransactionalEmailMessage_idempotencyKey_key" ON "TransactionalEmailMessage"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "TransactionalEmailMessage_providerMessageId_key" ON "TransactionalEmailMessage"("providerMessageId");

-- CreateIndex
CREATE INDEX "TransactionalEmailMessage_createdAt_idx" ON "TransactionalEmailMessage"("createdAt");

-- CreateIndex
CREATE INDEX "TransactionalEmailMessage_toAddress_idx" ON "TransactionalEmailMessage"("toAddress");

-- CreateIndex
CREATE UNIQUE INDEX "EmailSuppression_address_key" ON "EmailSuppression"("address");

-- CreateIndex
CREATE UNIQUE INDEX "EmailDeliveryEvent_provider_providerEventId_key" ON "EmailDeliveryEvent"("provider", "providerEventId");

-- AddForeignKey
ALTER TABLE "IntegrationSettings" ADD CONSTRAINT "IntegrationSettings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionalEmailMessage" ADD CONSTRAINT "TransactionalEmailMessage_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
