ALTER TABLE "leads" ADD COLUMN "quality" double precision;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "scoring" jsonb;--> statement-breakpoint
-- Every lead stored so far was scored by foldScore (scan/constants.ts), which
-- can be undone given its engagement, so the ranking weights can re-rank the
-- leads a project already holds without judging them again.
UPDATE "leads" SET "quality" = CASE
  WHEN "score" >= 50 THEN LEAST(1, GREATEST(0.5, 0.5 + 0.5 * ((("score" - 50) / 50.0) - 0.2 * coalesce("engagement", 0) / 4.0) / 0.8))
  ELSE LEAST(0.4999, "score" / 98.0)
END;
