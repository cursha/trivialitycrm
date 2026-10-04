-- AlterTable
ALTER TABLE "PipelineStageTask" ADD COLUMN     "fromTrialEnd" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "trialLengthWeeks" INTEGER;


-- Data: trial length is now set per rep (Curt's call), so the wording uses
-- the {{trialWeeks}} placeholder, filled in with the bar's rep's length.
-- Targeted replacements keep any other edits.
UPDATE "PipelineStage" SET
  "playbookLocal" = replace("playbookLocal", 'up to 4 weeks', 'up to {{trialWeeks}} weeks'),
  "playbookRemote" = replace("playbookRemote", 'up to 4 weeks', 'up to {{trialWeeks}} weeks'),
  "description" = replace("description", 'up to 4 weeks', 'up to {{trialWeeks}} weeks')
  WHERE "processStep" IN ('DEMO_BOOKED', 'DEMO_HELD', 'TRIAL_LIVE');

-- The conversion follow-ups were due 21 days into Trial Live (one week
-- before a 4-week trial ends). Re-anchor them to the trial's end so they
-- stay one week before it whatever the rep's trial length — only while
-- they still have the seeded title and timing.
UPDATE "PipelineStageTask" AS t SET "fromTrialEnd" = true, "daysAfter" = 7
  FROM "PipelineStage" AS s
  WHERE t."stageId" = s."id"
    AND s."processStep" = 'TRIAL_LIVE'
    AND t."daysAfter" = 21
    AND t."title" IN ('Trial conversion meeting in person (before the trial ends)', 'Trial conversion call (before the trial ends)');
