-- "Find emails" on the search results page.
ALTER TABLE "SearchResult" ADD COLUMN "emailLookupAt" TIMESTAMP(3),
ADD COLUMN "emailLookupNote" TEXT;
