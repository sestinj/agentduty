import { db } from "@/db";
import { notifications } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";

export type ParseResult =
  | {
      type: "shortCode";
      notification: typeof notifications.$inferSelect;
      text: string;
    }
  | {
      type: "optionSelect";
      notification: typeof notifications.$inferSelect;
      selectedOption: string;
    }
  | {
      type: "freeform";
      notification: typeof notifications.$inferSelect;
      text: string;
    }
  | { type: "invalidOption" }
  | { type: "notFound"; shortCode: string }
  | { type: "noActive" };

/**
 * Parse an inbound message (SMS or Slack DM) into a structured result.
 * Supports three patterns:
 *   1. "ABC response text" — match by short code
 *   2. "1", "2", etc. — select option from most recent delivered notification
 *   3. Freeform text — respond to most recent delivered notification
 */
export async function parseInboundMessage(
  body: string,
  userId: string
): Promise<ParseResult> {
  // Pattern 1: Short code prefix e.g. "ABC some response"
  // Case-sensitive: only uppercase letters/digits to avoid matching normal words like "did", "the", etc.
  const shortCodeMatch = body.match(/^([A-Z0-9]{3})\s+(.+)$/);
  if (shortCodeMatch) {
    const shortCode = shortCodeMatch[1].toUpperCase();
    const responseText = shortCodeMatch[2];

    const [notification] = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.shortCode, shortCode),
          eq(notifications.userId, userId)
        )
      );

    if (!notification) {
      return { type: "notFound", shortCode };
    }

    return { type: "shortCode", notification, text: responseText };
  }

  // Pattern 2: Number selection
  const numberMatch = body.match(/^(\d+)$/);
  if (numberMatch) {
    const optionIndex = parseInt(numberMatch[1], 10) - 1;

    const [notification] = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.status, "delivered")
        )
      )
      .orderBy(desc(notifications.createdAt))
      .limit(1);

    if (!notification) {
      return { type: "noActive" };
    }

    if (
      notification.options &&
      optionIndex >= 0 &&
      optionIndex < notification.options.length
    ) {
      const selectedOption = notification.options[optionIndex];
      return { type: "optionSelect", notification, selectedOption };
    }

    return { type: "invalidOption" };
  }

  // Pattern 3: Freeform text
  const [notification] = await db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.status, "delivered")
      )
    )
    .orderBy(desc(notifications.createdAt))
    .limit(1);

  if (notification) {
    return { type: "freeform", notification, text: body };
  }

  return { type: "noActive" };
}
