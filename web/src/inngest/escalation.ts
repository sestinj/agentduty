import { inngest } from "./client";
import { db } from "@/db";
import {
  notifications,
  escalationSteps,
  deliveries,
  users,
  escalationPolicies,
  agentSessions,
} from "@/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { sendSlackDM } from "@/channels/slack";
import { sendSMS } from "@/channels/twilio";

async function getSessionThreadTs(
  sessionId: string | null
): Promise<string | undefined> {
  if (!sessionId) return undefined;
  const [session] = await db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.id, sessionId));
  return session?.slackThreadTs ?? undefined;
}

export const escalateNotification = inngest.createFunction(
  {
    id: "escalate-notification",
    cancelOn: [
      {
        event: "notification/responded",
        match: "data.notificationId",
      },
    ],
  },
  { event: "notification/created" },
  async ({ event, step }) => {
    const { notificationId } = event.data;

    const [notification] = await step.run("fetch-notification", async () => {
      return db
        .select()
        .from(notifications)
        .where(eq(notifications.id, notificationId));
    });

    if (!notification) return { error: "Notification not found" };

    const policyId = notification.policyId;
    if (!policyId) {
      // No escalation policy - just deliver via default channel (slack)
      await step.run("deliver-default", async () => {
        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.id, notification.userId));

        if (user.slackUserId) {
          const threadTs = await getSessionThreadTs(notification.sessionId);

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
        } else if (user.phone) {
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
        }

        await db
          .update(notifications)
          .set({ status: "delivered", updatedAt: new Date() })
          .where(eq(notifications.id, notification.id));
      });

      return { delivered: true };
    }

    // Fetch escalation steps ordered by step_order
    const steps = await step.run("fetch-steps", async () => {
      return db
        .select()
        .from(escalationSteps)
        .where(eq(escalationSteps.policyId, policyId))
        .orderBy(asc(escalationSteps.stepOrder));
    });

    // Execute each escalation step with delays
    for (let i = 0; i < steps.length; i++) {
      const escalationStep = steps[i];

      if (i > 0) {
        await step.sleep(
          `wait-step-${i}`,
          `${escalationStep.delaySeconds}s`
        );
      }

      await step.run(`deliver-step-${i}`, async () => {
        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.id, notification.userId));

        if (escalationStep.channel === "slack" && user.slackUserId) {
          const threadTs = await getSessionThreadTs(notification.sessionId);

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
        } else if (escalationStep.channel === "sms" && user.phone) {
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
        }

        await db
          .update(notifications)
          .set({
            status: "delivered",
            currentEscalationStep: i,
            updatedAt: new Date(),
          })
          .where(eq(notifications.id, notification.id));
      });
    }

    return { escalated: true, steps: steps.length };
  }
);
