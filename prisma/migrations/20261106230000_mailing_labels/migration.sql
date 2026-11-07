-- Mailing labels (v32.0): sheet templates + immutable versions, alignment
-- profiles, per-user drafts, immutable generated batches and their recipients,
-- and workspace settings. New tables only; nothing existing changes.
-- CreateTable
CREATE TABLE "LabelSheetTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "productCode" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LabelSheetTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabelSheetTemplateVersion" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "pageWidthMm" DOUBLE PRECISION NOT NULL,
    "pageHeightMm" DOUBLE PRECISION NOT NULL,
    "rows" INTEGER NOT NULL,
    "columns" INTEGER NOT NULL,
    "labelWidthMm" DOUBLE PRECISION NOT NULL,
    "labelHeightMm" DOUBLE PRECISION NOT NULL,
    "topMm" DOUBLE PRECISION NOT NULL,
    "leftMm" DOUBLE PRECISION NOT NULL,
    "gapXMm" DOUBLE PRECISION NOT NULL,
    "gapYMm" DOUBLE PRECISION NOT NULL,
    "paddingMm" DOUBLE PRECISION NOT NULL,
    "preferredFontPt" DOUBLE PRECISION NOT NULL,
    "minFontPt" DOUBLE PRECISION NOT NULL,
    "lineHeight" DOUBLE PRECISION NOT NULL,
    "measurementNote" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabelSheetTemplateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabelAlignmentProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "offsetXMm" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "offsetYMm" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LabelAlignmentProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailingLabelDraft" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "allConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "removedCompanyIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "contactOverrides" JSONB NOT NULL DEFAULT '{}',
    "templateId" TEXT,
    "alignmentProfileId" TEXT,
    "startPosition" INTEGER NOT NULL DEFAULT 1,
    "reviewedDigest" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailingLabelDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailingLabelBatch" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "parentBatchId" TEXT,
    "filters" JSONB NOT NULL,
    "removedCompanyIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "exclusions" JSONB NOT NULL,
    "templateVersionId" TEXT NOT NULL,
    "templateName" TEXT NOT NULL,
    "alignmentProfileName" TEXT,
    "offsetXMm" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "offsetYMm" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "startPosition" INTEGER NOT NULL,
    "layoutVersion" TEXT NOT NULL,
    "recipientCount" INTEGER NOT NULL,
    "pageCount" INTEGER NOT NULL,
    "layoutSha256" TEXT NOT NULL,
    "printedAt" TIMESTAMP(3),
    "printedById" TEXT,
    "mailedAt" TIMESTAMP(3),
    "mailedById" TEXT,
    "mailedNote" TEXT,
    "recipientsPurgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailingLabelBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailingLabelRecipient" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "companyId" TEXT NOT NULL,
    "contactId" TEXT,
    "companyName" TEXT NOT NULL,
    "lines" JSONB NOT NULL,

    CONSTRAINT "MailingLabelRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailingLabelSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "maxLabelsPerBatch" INTEGER NOT NULL DEFAULT 1000,
    "retentionDays" INTEGER NOT NULL DEFAULT 365,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailingLabelSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LabelSheetTemplate_name_key" ON "LabelSheetTemplate"("name");

-- CreateIndex
CREATE UNIQUE INDEX "LabelSheetTemplateVersion_templateId_version_key" ON "LabelSheetTemplateVersion"("templateId", "version");

-- CreateIndex
CREATE INDEX "LabelAlignmentProfile_userId_idx" ON "LabelAlignmentProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "LabelAlignmentProfile_userId_templateId_name_key" ON "LabelAlignmentProfile"("userId", "templateId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "MailingLabelDraft_ownerId_key" ON "MailingLabelDraft"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "MailingLabelBatch_idempotencyKey_key" ON "MailingLabelBatch"("idempotencyKey");

-- CreateIndex
CREATE INDEX "MailingLabelBatch_ownerId_createdAt_idx" ON "MailingLabelBatch"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "MailingLabelBatch_createdAt_idx" ON "MailingLabelBatch"("createdAt");

-- CreateIndex
CREATE INDEX "MailingLabelRecipient_companyId_idx" ON "MailingLabelRecipient"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "MailingLabelRecipient_batchId_sequence_key" ON "MailingLabelRecipient"("batchId", "sequence");

-- AddForeignKey
ALTER TABLE "LabelSheetTemplateVersion" ADD CONSTRAINT "LabelSheetTemplateVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "LabelSheetTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailingLabelBatch" ADD CONSTRAINT "MailingLabelBatch_parentBatchId_fkey" FOREIGN KEY ("parentBatchId") REFERENCES "MailingLabelBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailingLabelBatch" ADD CONSTRAINT "MailingLabelBatch_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES "LabelSheetTemplateVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailingLabelRecipient" ADD CONSTRAINT "MailingLabelRecipient_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "MailingLabelBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

