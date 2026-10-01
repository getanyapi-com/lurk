-- The schema stops naming fourteen columns nobody reads (see 0039, which drops
-- them a release later, once no running revision selects them). Two of them are
-- NOT NULL with no default, so they get one here and inserts can leave them out.
-- Fail fast rather than queue every lead_evaluations read behind the ALTER: the
-- entrypoint exits, the container restarts, and the next boot tries again.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "lead_evaluations" ALTER COLUMN "requirements" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "lead_evaluations" ALTER COLUMN "answer_coverage" SET DEFAULT 'unknown';
