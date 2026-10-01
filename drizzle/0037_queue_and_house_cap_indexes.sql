CREATE INDEX IF NOT EXISTS "search_runs_funded_by_fetched_at_idx" ON "search_runs" USING btree ("funded_by","fetched_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "serp_results_run_position_idx" ON "serp_results" USING btree ("search_run_id","position");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_project_kind_idx" ON "jobs" USING btree ("project_id","kind");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_unfinished_run_at_idx" ON "jobs" USING btree ("run_at") WHERE "jobs"."finished_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "seo_opportunities_project_keyword_idx" ON "seo_opportunities" USING btree ("project_id","keyword");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_ledger_funded_by_at_idx" ON "usage_ledger" USING btree ("funded_by","at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_ledger_search_run_idx" ON "usage_ledger" USING btree ("search_run_id");