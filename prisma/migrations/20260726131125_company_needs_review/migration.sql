-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "needsReview" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "needsReviewReason" TEXT;
