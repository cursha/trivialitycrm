-- Quick Search: leave chains and franchises out unless asked.
ALTER TABLE "LeadSearch" ADD COLUMN "excludeChains" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "chainsLeftOut" TEXT[] DEFAULT ARRAY[]::TEXT[];
