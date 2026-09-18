ALTER TABLE "search_runs" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
-- Every run stored before this column existed finished storing long ago.
UPDATE "search_runs" SET "completed_at" = "fetched_at";
