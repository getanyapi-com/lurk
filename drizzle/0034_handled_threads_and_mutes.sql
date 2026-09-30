CREATE TABLE "handled_threads" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"platform" text NOT NULL,
	"thread_id" text NOT NULL,
	"handled_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_mutes" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "handled_threads" ADD CONSTRAINT "handled_threads_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_mutes" ADD CONSTRAINT "lead_mutes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "handled_threads_project_thread_idx" ON "handled_threads" USING btree ("project_id","platform","thread_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_mutes_project_kind_value_idx" ON "lead_mutes" USING btree ("project_id","kind","value");