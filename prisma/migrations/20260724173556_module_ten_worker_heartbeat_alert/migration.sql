-- AlterEnum
ALTER TYPE "TransactionalEmailPurpose" ADD VALUE 'SYSTEM_ALERT';

-- CreateTable
CREATE TABLE "WorkerHeartbeatAlert" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "staleAlertSentAt" TIMESTAMP(3),

    CONSTRAINT "WorkerHeartbeatAlert_pkey" PRIMARY KEY ("id")
);
