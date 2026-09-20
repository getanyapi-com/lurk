ALTER TABLE "leads" ADD COLUMN "found_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
-- Every lead already held was last scored before its channel last sent, so it
-- keeps that moment and no open alert window picks it up a second time.
UPDATE "leads" SET "found_at" = "scored_at";
