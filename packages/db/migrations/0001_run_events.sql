CREATE TYPE "public"."run_event_type" AS ENUM('llm', 'tool');--> statement-breakpoint
CREATE TABLE "run_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"seq" integer NOT NULL,
	"type" "run_event_type" NOT NULL,
	"step" integer NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "run_events_run_attempt_seq_idx" ON "run_events" USING btree ("run_id","attempt","seq");