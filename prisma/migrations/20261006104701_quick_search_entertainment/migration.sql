-- CreateEnum
CREATE TYPE "SearchEntertainment" AS ENUM ('TRIVIA', 'KARAOKE');

-- AlterTable
ALTER TABLE "LeadSearch" ADD COLUMN     "entertainment" "SearchEntertainment"[] DEFAULT ARRAY[]::"SearchEntertainment"[];
