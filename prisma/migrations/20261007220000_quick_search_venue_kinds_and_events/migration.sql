-- AlterEnum
ALTER TYPE "SearchEntertainment" ADD VALUE IF NOT EXISTS 'BINGO';
ALTER TYPE "SearchEntertainment" ADD VALUE IF NOT EXISTS 'EVENTS';

-- CreateEnum
CREATE TYPE "SearchVenueKind" AS ENUM ('PUB', 'BAR', 'TAVERN');

-- AlterTable
ALTER TABLE "LeadSearch" ADD COLUMN     "venueKinds" "SearchVenueKind"[] DEFAULT ARRAY[]::"SearchVenueKind"[];
