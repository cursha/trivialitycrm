-- "Search the web for emails", and where each found email came from.
CREATE TYPE "EmailSource" AS ENUM ('WEBSITE', 'WEB_SEARCH');

ALTER TABLE "SearchResult" ADD COLUMN "emailWebSearchAt" TIMESTAMP(3),
ADD COLUMN "emailSource" "EmailSource";
