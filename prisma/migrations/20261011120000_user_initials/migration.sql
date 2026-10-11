-- A two-letter code for each user (e.g. "CS"), unique when set.
ALTER TABLE "User" ADD COLUMN "initials" TEXT;

CREATE UNIQUE INDEX "User_initials_key" ON "User"("initials");
