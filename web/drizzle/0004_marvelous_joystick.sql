ALTER TYPE "public"."channel" ADD VALUE 'web';--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "snoozed_until" timestamp;