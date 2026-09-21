CREATE TABLE "facts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text DEFAULT 'gloria' NOT NULL,
	"subject" text NOT NULL,
	"predicate" text NOT NULL,
	"value" text NOT NULL,
	"confidence" real DEFAULT 0.8,
	"source_id" bigint,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"message_id" bigint NOT NULL,
	"signal" smallint NOT NULL,
	"ts" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text DEFAULT 'gloria' NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"tg_update_id" bigint,
	"tg_message_id" bigint,
	"tags" text[],
	"processed" boolean DEFAULT false NOT NULL,
	CONSTRAINT "messages_tg_update_id_unique" UNIQUE("tg_update_id")
);
--> statement-breakpoint
CREATE TABLE "proactive_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now(),
	"content" text,
	"replied" boolean DEFAULT false,
	"latency_s" integer,
	"sentiment" real
);
--> statement-breakpoint
CREATE TABLE "traces" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ts" timestamp with time zone DEFAULT now(),
	"kind" text NOT NULL,
	"model" text,
	"system_prompt" text,
	"input" jsonb,
	"output" text,
	"raw_output" text,
	"latency_ms" integer,
	"cost_usd" numeric(10, 6),
	"error" text
);
--> statement-breakpoint
CREATE TABLE "trigger_state" (
	"type" text PRIMARY KEY NOT NULL,
	"score" real DEFAULT 1 NOT NULL,
	"cooldown_until" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "messages_ts_idx" ON "messages" USING btree ("ts");--> statement-breakpoint
CREATE INDEX "traces_ts_idx" ON "traces" USING btree ("ts");