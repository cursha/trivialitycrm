-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "triviaHistory" TEXT;

-- AlterTable
ALTER TABLE "PipelineStage" ADD COLUMN     "description" TEXT;


-- Data: the Target step's checklist now starts with getting the manager's
-- contact info and the bar's trivia history (Curt's call). The seed only
-- fills empty checklists, so update them here, and only while they still
-- read exactly as v3.0 seeded them; an edited checklist is left alone.
UPDATE "PipelineStage"
  SET "playbookLocal" = E'Get the manager''s name, phone and email, and add them as a contact\nFind out their trivia history: do they run trivia now, with whom and which night, and have they tried it before? Note it on the Bar intel card\nCheck the Bar intel card: slow night, typical crowd, current entertainment\nAdd the bar to your route plan\nBring flyers'
  WHERE "processStep" = 'TARGET'
    AND "playbookLocal" = E'Check the Bar intel card: slow night, typical crowd, current entertainment\nAdd the bar to your route plan\nBring flyers';

UPDATE "PipelineStage"
  SET "playbookRemote" = E'Get the manager''s name, phone and email, and add them as a contact\nFind out their trivia history: do they run trivia now, with whom and which night, and have they tried it before? Note it on the Bar intel card\nCheck the Bar intel card: slow night, typical crowd, current entertainment\nSend the intro email with the short video, or call'
  WHERE "processStep" = 'TARGET'
    AND "playbookRemote" = E'Find the owner or manager''s name and the best way to reach them\nCheck the Bar intel card: slow night, typical crowd, current entertainment\nSend the intro email with the short video, or call';
