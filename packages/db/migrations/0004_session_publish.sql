ALTER TABLE "sessions" ADD COLUMN "branch" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "pushed_turn" integer;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "pushed_sha" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "publish_error" text;