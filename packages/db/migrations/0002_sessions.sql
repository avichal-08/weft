CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"repo_url" text NOT NULL,
	"base_ref" text,
	"test_command" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "runs" ALTER COLUMN "test_command" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "session_id" uuid;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "turn" integer;--> statement-breakpoint
CREATE INDEX "sessions_updated_idx" ON "sessions" USING btree ("updated_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "runs_session_turn_idx" ON "runs" USING btree ("session_id","turn");--> statement-breakpoint
CREATE UNIQUE INDEX "runs_one_active_turn_idx" ON "runs" USING btree ("session_id") WHERE "runs"."status" in ('queued', 'running');