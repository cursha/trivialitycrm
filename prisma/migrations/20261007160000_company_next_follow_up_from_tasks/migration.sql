-- Company."nextFollowUpAt" becomes the due date of the company's earliest
-- OPEN follow-up (Task), kept current by a trigger on "Task" so every way a
-- follow-up is created, completed, cancelled, rescheduled, moved (company
-- merge) or deleted updates it — including future code paths. Until now it
-- was only a hand-entered date on the company form, so follow-ups never
-- showed in the Companies list's Follow-up column.

CREATE OR REPLACE FUNCTION sync_company_next_follow_up(company_id TEXT) RETURNS void AS $$
BEGIN
  UPDATE "Company"
  SET "nextFollowUpAt" = (
    SELECT MIN("dueAt") FROM "Task" WHERE "companyId" = company_id AND "status" = 'OPEN'
  )
  WHERE "id" = company_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION task_sync_company_next_follow_up() RETURNS trigger AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM sync_company_next_follow_up(OLD."companyId");
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND (TG_OP = 'INSERT' OR NEW."companyId" IS DISTINCT FROM OLD."companyId") THEN
    PERFORM sync_company_next_follow_up(NEW."companyId");
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER task_sync_company_next_follow_up
AFTER INSERT OR UPDATE OF "companyId", "dueAt", "status" OR DELETE ON "Task"
FOR EACH ROW EXECUTE FUNCTION task_sync_company_next_follow_up();

-- Backfill from the follow-ups that already exist.
UPDATE "Company" c
SET "nextFollowUpAt" = (
  SELECT MIN(t."dueAt") FROM "Task" t WHERE t."companyId" = c."id" AND t."status" = 'OPEN'
);
