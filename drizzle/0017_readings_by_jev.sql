DELETE FROM "post_readings";--> statement-breakpoint
ALTER TABLE "post_readings" DROP COLUMN "speaker";--> statement-breakpoint
ALTER TABLE "post_readings" DROP COLUMN "asking";--> statement-breakpoint
ALTER TABLE "post_readings" DROP COLUMN "need";--> statement-breakpoint
ALTER TABLE "post_readings" DROP COLUMN "category";--> statement-breakpoint
ALTER TABLE "post_readings" DROP COLUMN "constraints";--> statement-breakpoint
ALTER TABLE "post_readings" ADD COLUMN "relationship" text NOT NULL;--> statement-breakpoint
ALTER TABLE "post_readings" ADD COLUMN "need_state" text NOT NULL;--> statement-breakpoint
ALTER TABLE "post_readings" ADD COLUMN "quote" text;
