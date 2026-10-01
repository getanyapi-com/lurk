-- The fourteen columns 0038 took out of the schema. No revision that can still be
-- running names them, so they go now. Each DROP is a catalog change, but it needs
-- a brief exclusive lock: fail fast rather than queue every read of these tables
-- behind it, and the entrypoint exits and the next boot tries again.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "lead_evaluations" DROP COLUMN IF EXISTS "requirements";--> statement-breakpoint
ALTER TABLE "lead_evaluations" DROP COLUMN IF EXISTS "answer_coverage";--> statement-breakpoint
ALTER TABLE "leads" DROP COLUMN IF EXISTS "seller_side";--> statement-breakpoint
ALTER TABLE "llm_usage" DROP COLUMN IF EXISTS "attempt";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN IF EXISTS "discovery_version";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN IF EXISTS "tier_snapshot";--> statement-breakpoint
ALTER TABLE "wallet_connections" DROP COLUMN IF EXISTS "cap_usd";--> statement-breakpoint
ALTER TABLE "wallet_connections" DROP COLUMN IF EXISTS "cap_period";--> statement-breakpoint
ALTER TABLE "x_evaluations" DROP COLUMN IF EXISTS "priority";--> statement-breakpoint
ALTER TABLE "x_evaluations" DROP COLUMN IF EXISTS "content_hash";--> statement-breakpoint
ALTER TABLE "x_evaluations" DROP COLUMN IF EXISTS "profile_version";--> statement-breakpoint
ALTER TABLE "x_evaluations" DROP COLUMN IF EXISTS "judged_at";--> statement-breakpoint
ALTER TABLE "x_leads" DROP COLUMN IF EXISTS "priority";--> statement-breakpoint
ALTER TABLE "x_projects" DROP COLUMN IF EXISTS "lang";
