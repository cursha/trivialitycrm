-- Quick Search: a box for each service club under "Search for".
-- AlterEnum
ALTER TYPE "SearchVenueKind" ADD VALUE IF NOT EXISTS 'ROTARY_CLUB';
ALTER TYPE "SearchVenueKind" ADD VALUE IF NOT EXISTS 'LIONS_CLUB';
ALTER TYPE "SearchVenueKind" ADD VALUE IF NOT EXISTS 'KIWANIS_CLUB';
ALTER TYPE "SearchVenueKind" ADD VALUE IF NOT EXISTS 'LEGION';
