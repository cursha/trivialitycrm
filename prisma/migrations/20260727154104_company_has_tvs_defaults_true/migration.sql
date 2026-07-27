-- AlterTable
ALTER TABLE "Company" ALTER COLUMN "hasTvs" SET DEFAULT true;

-- Backfill: SET DEFAULT only affects future inserts, not the existing rows
-- created by the prior migration (which had no default, so they're
-- currently NULL/"unknown"). The new default's whole point is "assume yes
-- unless proven otherwise" for every company, not just ones created from
-- here on — a never-checked pre-existing company should read the same way
-- a never-checked new one does.
UPDATE "Company" SET "hasTvs" = true WHERE "hasTvs" IS NULL;
