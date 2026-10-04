-- Data: trials are offered for up to 4 weeks rather than exactly 4 (Curt's
-- call). Rewords the seeded checklists, descriptions and automatic
-- follow-up titles in place with targeted text replacements, so any other
-- edits an Administrator has made to them are kept. Follow-up tasks
-- already created for bars are left as they are.
UPDATE "PipelineStage" SET
  "playbookLocal" = replace(replace("playbookLocal", 'trial ask: 4 weeks free', 'trial ask: up to 4 weeks free'), 'the trial: 4 weeks free', 'the trial: up to 4 weeks free'),
  "playbookRemote" = replace(replace("playbookRemote", 'trial ask: 4 weeks free', 'trial ask: up to 4 weeks free'), 'the trial: 4 weeks free', 'the trial: up to 4 weeks free'),
  "description" = replace("description", 'the trial: 4 weeks free', 'the trial: up to 4 weeks free')
  WHERE "processStep" IN ('DEMO_BOOKED', 'DEMO_HELD');

UPDATE "PipelineStage" SET
  "playbookLocal" = replace("playbookLocal", 'Before week 4 ends:', 'Before the trial ends:'),
  "playbookRemote" = replace("playbookRemote", 'Before week 4 ends:', 'Before the trial ends:'),
  "description" = replace(
    "description",
    'The 4-week trial is running, one night a week. Support night 1, check in at week 2, ask for an early yes at week 3, and hold the conversion meeting before week 4 ends.',
    'The trial is running: up to 4 weeks, one night a week. Support night 1, check in at week 2, ask for an early yes at week 3, and hold the conversion meeting before the trial ends.'
  )
  WHERE "processStep" = 'TRIAL_LIVE';

UPDATE "PipelineStageTask" SET "title" = replace("title", '(before week 4 ends)', '(before the trial ends)')
  WHERE "title" LIKE '%(before week 4 ends)';
