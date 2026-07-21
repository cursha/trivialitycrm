-- CreateEnum
CREATE TYPE "ProviderKind" AS ENUM ('MICROSOFT', 'GOOGLE');

-- CreateEnum
CREATE TYPE "ProviderConnectionStatus" AS ENUM ('CONNECTED', 'EXPIRED', 'REVOKED', 'ERROR');

-- CreateEnum
CREATE TYPE "EmailTemplateVisibility" AS ENUM ('PERSONAL', 'SHARED');

-- CreateEnum
CREATE TYPE "EmailDirection" AS ENUM ('OUTBOUND', 'INBOUND');

-- CreateEnum
CREATE TYPE "EmailMessageStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'BOUNCED', 'CANCELLED', 'REPLIED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('NEW_REPLY', 'DELIVERY_FAILURE', 'APPOINTMENT_ACCEPTED', 'APPOINTMENT_DECLINED', 'SEQUENCE_COMPLETED', 'SEQUENCE_PAUSED', 'PROVIDER_DISCONNECTED', 'FOLLOW_UP_DUE', 'SCHEDULED_EMAIL_FAILED');

-- CreateTable
CREATE TABLE "ProviderConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "ProviderKind" NOT NULL,
    "providerAccountEmail" TEXT NOT NULL,
    "encryptedAccessToken" TEXT NOT NULL,
    "encryptedRefreshToken" TEXT NOT NULL,
    "tokenEncryptionKeyVersion" INTEGER NOT NULL DEFAULT 1,
    "scopes" TEXT[],
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "status" "ProviderConnectionStatus" NOT NULL DEFAULT 'CONNECTED',
    "lastError" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disconnectedAt" TIMESTAMP(3),

    CONSTRAINT "ProviderConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "visibility" "EmailTemplateVisibility" NOT NULL DEFAULT 'PERSONAL',
    "ownerId" TEXT,
    "leadTypeId" TEXT,
    "pipelineStageId" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailMessage" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "contactId" TEXT,
    "direction" "EmailDirection" NOT NULL DEFAULT 'OUTBOUND',
    "providerConnectionId" TEXT,
    "toAddresses" TEXT[],
    "ccAddresses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "bccAddresses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "templateId" TEXT,
    "status" "EmailMessageStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduledFor" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "providerMessageId" TEXT,
    "providerThreadId" TEXT,
    "errorMessage" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "payload" JSONB NOT NULL,
    "readAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProviderConnection_userId_key" ON "ProviderConnection"("userId");

-- CreateIndex
CREATE INDEX "ProviderConnection_status_idx" ON "ProviderConnection"("status");

-- CreateIndex
CREATE INDEX "EmailTemplate_visibility_active_idx" ON "EmailTemplate"("visibility", "active");

-- CreateIndex
CREATE INDEX "EmailTemplate_ownerId_idx" ON "EmailTemplate"("ownerId");

-- CreateIndex
CREATE INDEX "EmailMessage_companyId_idx" ON "EmailMessage"("companyId");

-- CreateIndex
CREATE INDEX "EmailMessage_contactId_idx" ON "EmailMessage"("contactId");

-- CreateIndex
CREATE INDEX "EmailMessage_status_scheduledFor_idx" ON "EmailMessage"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- AddForeignKey
ALTER TABLE "ProviderConnection" ADD CONSTRAINT "ProviderConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailTemplate" ADD CONSTRAINT "EmailTemplate_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailTemplate" ADD CONSTRAINT "EmailTemplate_leadTypeId_fkey" FOREIGN KEY ("leadTypeId") REFERENCES "LeadType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailTemplate" ADD CONSTRAINT "EmailTemplate_pipelineStageId_fkey" FOREIGN KEY ("pipelineStageId") REFERENCES "PipelineStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailTemplate" ADD CONSTRAINT "EmailTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailTemplate" ADD CONSTRAINT "EmailTemplate_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_providerConnectionId_fkey" FOREIGN KEY ("providerConnectionId") REFERENCES "ProviderConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "EmailTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
