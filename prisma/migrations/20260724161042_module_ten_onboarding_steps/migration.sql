-- CreateTable
CREATE TABLE "UserOnboardingStep" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stepKey" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserOnboardingStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserOnboardingStep_userId_idx" ON "UserOnboardingStep"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserOnboardingStep_userId_stepKey_key" ON "UserOnboardingStep"("userId", "stepKey");

-- AddForeignKey
ALTER TABLE "UserOnboardingStep" ADD CONSTRAINT "UserOnboardingStep_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
