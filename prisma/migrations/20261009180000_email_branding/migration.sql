-- The branded frame around CRM email, and its footer details.
ALTER TABLE "WorkspaceSettings" ADD COLUMN "emailBrandingEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "emailFooterPhone" TEXT,
ADD COLUMN "emailFooterWebsite" TEXT;
