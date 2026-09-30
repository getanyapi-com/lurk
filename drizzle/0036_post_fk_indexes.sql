CREATE INDEX IF NOT EXISTS "reddit_comments_post_idx" ON "reddit_comments" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "search_run_posts_post_idx" ON "search_run_posts" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "candidate_sources_post_idx" ON "candidate_sources" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_evaluations_post_idx" ON "lead_evaluations" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_evaluations_comment_idx" ON "lead_evaluations" USING btree ("comment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_post_idx" ON "leads" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_comment_idx" ON "leads" USING btree ("comment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "seo_opportunities_post_idx" ON "seo_opportunities" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "competitor_mentions_post_idx" ON "competitor_mentions" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "competitor_mentions_comment_idx" ON "competitor_mentions" USING btree ("comment_id");