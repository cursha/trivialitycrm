/*
  Warnings:

  - Added the required column `payload` to the `GeneratedReport` table without a default value. This is not possible if the table is not empty.
  - Added the required column `periodEnd` to the `GeneratedReport` table without a default value. This is not possible if the table is not empty.
  - Added the required column `periodStart` to the `GeneratedReport` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "GeneratedReport" ADD COLUMN     "payload" JSONB NOT NULL,
ADD COLUMN     "periodEnd" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "periodStart" TIMESTAMP(3) NOT NULL;
