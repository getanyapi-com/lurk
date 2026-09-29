CREATE TABLE "x_authors" (
	"username" text PRIMARY KEY NOT NULL,
	"author_id" text,
	"name" text,
	"bio" text,
	"followers" integer,
	"following" integer,
	"account_created_at" timestamp with time zone,
	"verified" boolean,
	"private" boolean,
	"website" text,
	"location" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "x_evaluations" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"tweet_id" text NOT NULL,
	"lane_id" text,
	"matched_phrase" text,
	"stage" text NOT NULL,
	"free_reject" text,
	"level" text,
	"decision" text,
	"reason_code" text,
	"reason" text,
	"signals" jsonb,
	"fit" integer,
	"intent" integer,
	"engagement" integer,
	"score" integer,
	"priority" text,
	"need_quote" text,
	"context" jsonb,
	"llm_attempts" integer DEFAULT 0 NOT NULL,
	"content_hash" text,
	"profile_version" integer,
	"scorer_version" text,
	"judged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "x_lanes" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"family" text NOT NULL,
	"seeds" text[] NOT NULL,
	"terms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"label" text,
	"rank" integer DEFAULT 0 NOT NULL,
	"body" text NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"pause_reason" text,
	"last_error" text,
	"covered_until" timestamp with time zone,
	"next_due_at" timestamp with time zone,
	"empty_streak" integer DEFAULT 0 NOT NULL,
	"runs" integer DEFAULT 0 NOT NULL,
	"pages" integer DEFAULT 0 NOT NULL,
	"empty_pages" integer DEFAULT 0 NOT NULL,
	"full_pages" integer DEFAULT 0 NOT NULL,
	"posts" integer DEFAULT 0 NOT NULL,
	"new_posts" integer DEFAULT 0 NOT NULL,
	"screened_out" integer DEFAULT 0 NOT NULL,
	"judged" integer DEFAULT 0 NOT NULL,
	"leads" integer DEFAULT 0 NOT NULL,
	"reviews" integer DEFAULT 0 NOT NULL,
	"replies" integer DEFAULT 0 NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_lead_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "x_leads" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"tweet_id" text NOT NULL,
	"kind" text DEFAULT 'ask' NOT NULL,
	"moment" text,
	"score" integer NOT NULL,
	"fit" integer,
	"intent" integer,
	"engagement" integer,
	"reason" text,
	"matched_phrase" text,
	"priority" text,
	"author_username" text NOT NULL,
	"conversation_id" text,
	"status" text DEFAULT 'new' NOT NULL,
	"not_fit_reason" text,
	"found_at" timestamp with time zone DEFAULT now() NOT NULL,
	"scored_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "x_posts" (
	"id" text PRIMARY KEY NOT NULL,
	"text" text NOT NULL,
	"lang" text,
	"created_at" timestamp with time zone NOT NULL,
	"author_username" text NOT NULL,
	"author_name" text,
	"author_id" text,
	"author_image" text,
	"author_followers" integer,
	"author_verified" boolean,
	"is_reply" boolean DEFAULT false NOT NULL,
	"in_reply_to_id" text,
	"conversation_id" text,
	"like_count" integer,
	"reply_count" integer,
	"retweet_count" integer,
	"quote_count" integer,
	"view_count" integer,
	"bookmark_count" integer,
	"media_count" integer,
	"unavailable_at" timestamp with time zone,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "x_projects" (
	"project_id" text PRIMARY KEY NOT NULL,
	"lang" text DEFAULT 'en' NOT NULL,
	"enabled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_opened_at" timestamp with time zone,
	"last_scan_at" timestamp with time zone,
	"lanes_input_hash" text,
	"seeds" jsonb
);
--> statement-breakpoint
CREATE TABLE "x_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"job_id" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"first_lead_at" timestamp with time zone,
	"lanes_run" integer DEFAULT 0 NOT NULL,
	"pages" integer DEFAULT 0 NOT NULL,
	"empty_pages" integer DEFAULT 0 NOT NULL,
	"full_pages" integer DEFAULT 0 NOT NULL,
	"posts_fetched" integer DEFAULT 0 NOT NULL,
	"posts_new" integer DEFAULT 0 NOT NULL,
	"screened_out" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"parents" integer DEFAULT 0 NOT NULL,
	"judged" integer DEFAULT 0 NOT NULL,
	"profiles" integer DEFAULT 0 NOT NULL,
	"finals" integer DEFAULT 0 NOT NULL,
	"reply_checks" integer DEFAULT 0 NOT NULL,
	"leads" integer DEFAULT 0 NOT NULL,
	"replies" integer DEFAULT 0 NOT NULL,
	"reviews" integer DEFAULT 0 NOT NULL,
	"data_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"llm_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"partial_reason" text
);
--> statement-breakpoint
CREATE TABLE "x_search_run_posts" (
	"search_run_id" text NOT NULL,
	"tweet_id" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "x_search_run_posts_search_run_id_tweet_id_pk" PRIMARY KEY("search_run_id","tweet_id")
);
--> statement-breakpoint
ALTER TABLE "x_evaluations" ADD CONSTRAINT "x_evaluations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "x_evaluations" ADD CONSTRAINT "x_evaluations_tweet_id_x_posts_id_fk" FOREIGN KEY ("tweet_id") REFERENCES "public"."x_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "x_evaluations" ADD CONSTRAINT "x_evaluations_lane_id_x_lanes_id_fk" FOREIGN KEY ("lane_id") REFERENCES "public"."x_lanes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "x_lanes" ADD CONSTRAINT "x_lanes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "x_leads" ADD CONSTRAINT "x_leads_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "x_leads" ADD CONSTRAINT "x_leads_tweet_id_x_posts_id_fk" FOREIGN KEY ("tweet_id") REFERENCES "public"."x_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "x_projects" ADD CONSTRAINT "x_projects_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "x_runs" ADD CONSTRAINT "x_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "x_search_run_posts" ADD CONSTRAINT "x_search_run_posts_search_run_id_search_runs_id_fk" FOREIGN KEY ("search_run_id") REFERENCES "public"."search_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "x_search_run_posts" ADD CONSTRAINT "x_search_run_posts_tweet_id_x_posts_id_fk" FOREIGN KEY ("tweet_id") REFERENCES "public"."x_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "x_authors_fetched_at_idx" ON "x_authors" USING btree ("fetched_at");--> statement-breakpoint
CREATE UNIQUE INDEX "x_evaluations_project_tweet_idx" ON "x_evaluations" USING btree ("project_id","tweet_id");--> statement-breakpoint
CREATE INDEX "x_evaluations_project_stage_idx" ON "x_evaluations" USING btree ("project_id","stage");--> statement-breakpoint
CREATE INDEX "x_evaluations_project_created_at_idx" ON "x_evaluations" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "x_evaluations_tweet_idx" ON "x_evaluations" USING btree ("tweet_id");--> statement-breakpoint
CREATE INDEX "x_evaluations_lane_idx" ON "x_evaluations" USING btree ("lane_id");--> statement-breakpoint
CREATE UNIQUE INDEX "x_lanes_project_body_idx" ON "x_lanes" USING btree ("project_id","body");--> statement-breakpoint
CREATE INDEX "x_lanes_project_state_due_idx" ON "x_lanes" USING btree ("project_id","state","next_due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "x_leads_project_tweet_idx" ON "x_leads" USING btree ("project_id","tweet_id");--> statement-breakpoint
CREATE INDEX "x_leads_project_found_at_idx" ON "x_leads" USING btree ("project_id","found_at");--> statement-breakpoint
CREATE INDEX "x_leads_project_score_idx" ON "x_leads" USING btree ("project_id","score" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "x_leads_project_conversation_idx" ON "x_leads" USING btree ("project_id","conversation_id");--> statement-breakpoint
CREATE INDEX "x_leads_tweet_idx" ON "x_leads" USING btree ("tweet_id");--> statement-breakpoint
CREATE INDEX "x_posts_created_at_idx" ON "x_posts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "x_posts_conversation_idx" ON "x_posts" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "x_posts_fetched_at_idx" ON "x_posts" USING btree ("fetched_at");--> statement-breakpoint
CREATE INDEX "x_runs_project_started_at_idx" ON "x_runs" USING btree ("project_id","started_at");--> statement-breakpoint
CREATE INDEX "x_search_run_posts_tweet_idx" ON "x_search_run_posts" USING btree ("tweet_id");