import { db } from "@/db";
import { notifications, deliveries, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { sendSlackDM } from "./slack";
import { sendSMS } from "./twilio";

/**
 * Deliver a notification to the user via their configured channels.
 * Tries Slack first, falls back to SMS.
 */
export async function deliverNotification(notificationId: string) {
  const [notification] = await db
    .select()
    .from(notifications)
    .where(eq(notifications.id, notificationId));

  if (!notification) return;

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, notification.userId));

  if (!user) return;

  const channels: string[] = [];

  // Try Slack
  if (user.slackUserId) {
    try {
      const result = await sendSlackDM({
        slackUserId: user.slackUserId,
        message: notification.message,
        shortCode: notification.shortCode,
        options: notification.options ?? undefined,
        notificationId: notification.id,
      });

      await db.insert(deliveries).values({
        notificationId: notification.id,
        channel: "slack",
        status: "sent",
        externalId: result.ts,
        metadata: { channel: result.channel },
      });

      channels.push("slack");
    } catch (err) {
      console.error("Slack delivery failed:", err);
      await db.insert(deliveries).values({
        notificationId: notification.id,
        channel: "slack",
        status: "failed",
        error: String(err),
      });
    }
  }

  // Try SMS
  if (user.phone) {
    try {
      const result = await sendSMS({
        to: user.phone,
        message: notification.message,
        shortCode: notification.shortCode,
        options: notification.options ?? undefined,
      });

      await db.insert(deliveries).values({
        notificationId: notification.id,
        channel: "sms",
        status: "sent",
        externalId: result.sid,
      });

      channels.push("sms");
    } catch (err) {
      console.error("SMS delivery failed:", err);
      // SMS is optional, don't insert a failed delivery if Twilio isn't configured
    }
  }

  // Update notification status if any channel succeeded
  if (channels.length > 0) {
    await db
      .update(notifications)
      .set({ status: "delivered", updatedAt: new Date() })
      .where(eq(notifications.id, notification.id));
  }
}
