ALTER TYPE "public"."message_status" ADD VALUE 'queued' BEFORE 'sent';--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "messages_reply_to_uq" ON "messages" USING btree ("reply_to_message_id") WHERE "messages"."direction" = 'outbound';--> statement-breakpoint
CREATE UNIQUE INDEX "messages_idempotency_key_uq" ON "messages" USING btree ("idempotency_key") WHERE "messages"."idempotency_key" is not null;