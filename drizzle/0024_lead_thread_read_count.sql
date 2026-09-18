ALTER TABLE "leads" ADD COLUMN "thread_read_count" integer;--> statement-breakpoint
-- A project that already holds a verdict on a comment in the thread did read it,
-- so it keeps the count it read at. Every other post lead starts unread.
UPDATE "leads" SET "thread_read_count" = "reddit_posts"."comments_read_count"
FROM "reddit_posts"
WHERE "reddit_posts"."id" = "leads"."post_id"
  AND "leads"."comment_id" IS NULL
  AND EXISTS (
    SELECT 1 FROM "lead_evaluations"
    WHERE "lead_evaluations"."project_id" = "leads"."project_id"
      AND "lead_evaluations"."post_id" = "leads"."post_id"
      AND "lead_evaluations"."comment_id" IS NOT NULL
  );
