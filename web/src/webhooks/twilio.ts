import { db } from "@/db";
import { notifications, responses, users } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { inngest } from "@/inngest/client";

interface TwilioInboundSMS {
  From: string;
  Body: string;
  MessageSid: string;
}

export async function handleInboundSMS(
  payload: TwilioInboundSMS
): Promise<string> {
  const body = payload.Body.trim();
  const from = payload.From;

  // Find user by phone number
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.phone, from));

  if (!user) {
    return twimlResponse("Unknown phone number. Please register your phone in AgentDuty.");
  }

  // Try to parse short code prefix: e.g. "ABC some response"
  const shortCodeMatch = body.match(/^([A-Z0-9]{3})\s+(.+)$/i);

  if (shortCodeMatch) {
    const shortCode = shortCodeMatch[1].toUpperCase();
    const responseText = shortCodeMatch[2];

    const [notification] = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.shortCode, shortCode),
          eq(notifications.userId, user.id)
        )
      );

    if (!notification) {
      return twimlResponse(`No active notification found with code ${shortCode}.`);
    }

    await recordResponse(notification, user, responseText);
    return twimlResponse("Response recorded.");
  }

  // Try to parse as a number (option selection) for the most recent active notification
  const numberMatch = body.match(/^(\d+)$/);

  if (numberMatch) {
    const optionIndex = parseInt(numberMatch[1], 10) - 1;

    // Find the most recent pending/delivered notification for this user
    const [notification] = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, user.id),
          eq(notifications.status, "delivered")
        )
      );

    if (!notification) {
      return twimlResponse("No active notification to respond to.");
    }

    if (
      notification.options &&
      optionIndex >= 0 &&
      optionIndex < notification.options.length
    ) {
      const selectedOption = notification.options[optionIndex];
      await recordResponse(notification, user, undefined, selectedOption);
      return twimlResponse(`Selected: ${selectedOption}`);
    }

    return twimlResponse("Invalid option number.");
  }

  // Freeform text - find most recent active notification
  const [notification] = await db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, user.id),
        eq(notifications.status, "delivered")
      )
    );

  if (notification) {
    await recordResponse(notification, user, body);
    return twimlResponse("Response recorded.");
  }

  return twimlResponse("No active notification to respond to.");
}

async function recordResponse(
  notification: typeof notifications.$inferSelect,
  user: typeof users.$inferSelect,
  text?: string,
  selectedOption?: string
) {
  await db.insert(responses).values({
    notificationId: notification.id,
    channel: "sms",
    text: text ?? null,
    selectedOption: selectedOption ?? null,
    responderId: user.id,
  });

  await db
    .update(notifications)
    .set({ status: "responded", updatedAt: new Date() })
    .where(eq(notifications.id, notification.id));

  await inngest.send({
    name: "notification/responded",
    data: { notificationId: notification.id },
  });
}

function twimlResponse(message: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${message}</Message></Response>`;
}
