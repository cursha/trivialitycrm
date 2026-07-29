-- CreateEnum
CREATE TYPE "Weekday" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "competitorTriviaDay" "Weekday",
ADD COLUMN     "competitorTriviaProvider" TEXT;
