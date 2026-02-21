import { db } from "@/db";
import { notifications, deliveries, users, agentSessions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { sendSlackDM, sendSlackThreadHeader } from "./slack";
import { sendSMS } from "./twilio";

/**
 * Deliver a notification to the user via their configured channels.
 * Tries Slack first, falls back to SMS.
 * If the notification belongs to a session, routes into a Slack thread.
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
      let threadTs: string | undefined;

      // Session-aware thread routing
      if (notification.sessionId) {
        const [session] = await db
          .select()
          .from(agentSessions)
          .where(eq(agentSessions.id, notification.sessionId));

        if (session) {
          if (session.slackThreadTs) {
            // Reuse existing thread
            threadTs = session.slackThreadTs;
          } else {
            // Create thread header as top-level message
            const header = await sendSlackThreadHeader(
              user.slackUserId,
              notification.message,
              notification.shortCode
            );
            threadTs = header.ts;

            // Store thread info on session
            await db
              .update(agentSessions)
              .set({
                slackThreadTs: header.ts,
                slackChannelId: header.channel,
              })
              .where(eq(agentSessions.id, session.id));
          }
        }
      }

      const result = await sendSlackDM({
        slackUserId: user.slackUserId,
        message: notification.message,
        shortCode: notification.shortCode,
        options: notification.options ?? undefined,
        notificationId: notification.id,
        threadTs,
      });

      await db.insert(deliveries).values({
        notificationId: notification.id,
        channel: "slack",
        status: "sent",
        externalId: result.ts,
        metadata: { channel: result.channel, threadTs },
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
