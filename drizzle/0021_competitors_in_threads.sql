DROP INDEX "competitor_mentions_project_competitor_post_idx";--> statement-breakpoint
ALTER TABLE "competitor_mentions" ALTER COLUMN "sentiment" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reddit_posts" ADD COLUMN "comments_read_count" integer;--> statement-breakpoint
ALTER TABLE "competitor_mentions" ADD COLUMN "comment_id" text;--> statement-breakpoint
ALTER TABLE "competitor_mentions" ADD COLUMN "quote" text;--> statement-breakpoint
ALTER TABLE "competitor_mentions" ADD CONSTRAINT "competitor_mentions_comment_id_reddit_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."reddit_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "competitor_mentions_project_competitor_comment_idx" ON "competitor_mentions" USING btree ("project_id","competitor","comment_id") WHERE comment_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "competitor_mentions_project_competitor_post_idx" ON "competitor_mentions" USING btree ("project_id","competitor","post_id") WHERE comment_id is null;